/**
 * Actions (docs/actions-design.md, docs/wire-protocol.md section 10, backend 1.4.0).
 *
 * An action is a piece of improvement work that comes from the downtime data: drafted by the server rules below, or
 * created by a person from a report, a Pareto bar, a repeated-failure row, an event record, a notification or by hand.
 * The mock API (src/api/mockActions.ts) implements the same rules over the calc library; tests/unit/contract.test.ts
 * keeps the two in step.
 *
 * Decisions that the design left open (all documented in docs/wire-protocol.md section 10):
 * - At most one OPEN action (not Closed, not Cancelled) per dedupe_key. A new action with the key of an open one is
 *   merged into it: its evidence is added and a log row says so. A manual equipment action with a reason uses the key
 *   of the repeated-failure rule (repeat|<equipment>|<reason_key>), so "same equipment + reason" is one action.
 * - The rules never draft a key again once an action with it exists, except the repeated-failure rule after the action
 *   was closed or cancelled AND a failure of the group started after that.
 * - "Now" for the rules is the latest stored event date (as for the notifications), never the wall clock.
 * - Closed and Cancelled need a closing note, and only people in actions_closers (or an Admin) may close, cancel,
 *   reopen (only to Open) or change a closed action. Everyone with Edit may comment.
 */

var ACTION_TERMINAL_ = ['Closed', 'Cancelled'];
var ACTION_EVIDENCE_MAX_ = 200;
var ACTION_NOTE_MIN_ = 3;
var ACTION_TITLE_MAX_ = 200;
var ACTION_LONG_TEXT_MAX_ = 2000;
var ACTION_EDIT_FIELDS_ = [
  'title', 'detail', 'status', 'priority', 'scope_kind', 'area_id', 'line_id', 'equipment_id', 'reason_key', 'owner',
  'assignee', 'due_date', 'needs_stop', 'root_cause', 'required_action', 'closure_note'
];
var ACTION_INPUT_FIELDS_ = [
  'title', 'detail', 'status', 'priority', 'source', 'source_ref', 'scope_kind', 'area_id', 'line_id', 'equipment_id',
  'reason_key', 'owner', 'assignee', 'due_date', 'needs_stop', 'root_cause', 'required_action', 'evidence', 'dedupe_key'
];
var CONTRACTOR_ID_PATTERN_ = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;
var EVENT_ID_PATTERN_ = /^EV-[0-9a-f]{16}$/;
var ACTION_SPLIT_TOLERANCE_ = 0.1;

// ---------- small helpers ----------

function isTerminal_(status) { return ACTION_TERMINAL_.indexOf(status) >= 0; }

function actionEnum_(column) { return enumOf_(T.ACTIONS, column); }

/** Rows of a table, or [] when the sheet does not exist yet (ensureSchema not run after pasting 1.4.0). */
function optionalTable_(table) {
  try {
    if (!getSpreadsheet_().getSheetByName(table)) return [];
    return readTable_(table);
  } catch (e) {
    return [];
  }
}

function round2_(n) { return Math.round(n * 100) / 100; }

/** 'YYYY-MM-DD HH:MM:SS.mmm' of a time from parseTs_ (plant-local clock readings are kept as UTC milliseconds). */
function plantTs_(ms) { return new Date(ms).toISOString().replace('T', ' ').replace('Z', ''); }

/** The settings the actions read, with the defaults of schema/tables.json when a row is missing or invalid. */
function actionSettings_() {
  var map = {};
  readSettings_().forEach(function (r) { map[r.key] = r.value; });
  var auto = String(map.actions_auto_draft === undefined ? 'true' : map.actions_auto_draft).trim().toLowerCase();
  return {
    closers: csv_(map.actions_closers),
    repeatN: Math.round(notifNum_(map, 'actions_repeat_n', 3, 2, 100)),
    repeatDays: notifNum_(map, 'actions_repeat_days', 30, 1, 3650),
    chronicTop: Math.round(notifNum_(map, 'actions_chronic_top', 10, 1, 100)),
    chronicMonths: Math.round(notifNum_(map, 'actions_chronic_months', 3, 1, 24)),
    effectDays: notifNum_(map, 'actions_effect_days', 60, 1, 3650),
    autoDraft: auto !== 'false' && auto !== '0' && auto !== 'no'
  };
}

function isCloser_(session, ast) {
  return session.user.role_id === 'ROLE-ADMIN' || ast.closers.indexOf(session.user.user_id) >= 0;
}

function parseEvidence_(text) {
  if (!text) return [];
  try {
    var list = JSON.parse(text);
    return Array.isArray(list) ? list.filter(function (x) { return x && typeof x === 'object'; }) : [];
  } catch (e) {
    return [];
  }
}

/** The API shape of an action row: evidence as a list (stored as JSON text). */
function actionOut_(r) {
  var o = {};
  Object.keys(r).forEach(function (k) { o[k] = r[k]; });
  o.evidence = parseEvidence_(r.evidence);
  return o;
}

function contractorOut_(r) {
  var o = {};
  Object.keys(r).forEach(function (k) { o[k] = r[k]; });
  o.areas = csv_(r.areas);
  return o;
}

function sortContractors_(list) {
  return list.sort(function (a, b) { return (a.sort_order - b.sort_order) || (a.contractor_id < b.contractor_id ? -1 : 1); });
}

/** The active external contractor responsible for an area, or null. */
function contractorForArea_(contractors, areaId) {
  if (!areaId) return null;
  for (var i = 0; i < contractors.length; i++) {
    var c = contractors[i];
    if (c.active && c.kind === 'contractor' && csv_(c.areas).indexOf(areaId) >= 0) return c;
  }
  return null;
}

/** Adds evidence items; an event already listed is not added twice. Keeps the latest ACTION_EVIDENCE_MAX_ items. */
function mergeEvidence_(list, add) {
  var have = {};
  list.forEach(function (x) { if (x.event_id) have[x.event_id] = true; });
  var added = 0;
  var out = list.slice();
  add.forEach(function (x) {
    if (x.event_id) {
      if (have[x.event_id]) return;
      have[x.event_id] = true;
    }
    out.push(x);
    added++;
  });
  if (out.length > ACTION_EVIDENCE_MAX_) out = out.slice(out.length - ACTION_EVIDENCE_MAX_);
  return { list: out, added: added };
}

function actionLogRow_(actionId, by, kind, from, to, text, at) {
  return {
    log_id: newId_('AL-', 16), action_id: actionId, at: at, by: by, kind: kind,
    from_status: from || '', to_status: to || '', text: String(text === null || text === undefined ? '' : text).slice(0, ACTION_LONG_TEXT_MAX_)
  };
}

/** AC-<yyyymm>-<4-digit sequence within the month>, after the highest number already used in the month. */
function nextActionId_(rows, stamp) {
  var prefix = 'AC-' + stamp.slice(0, 4) + stamp.slice(5, 7) + '-';
  var max = 0;
  rows.forEach(function (r) {
    var id = String(r.action_id || '');
    if (id.indexOf(prefix) !== 0) return;
    var n = Number(id.slice(prefix.length));
    if (isFinite(n) && n > max) max = n;
  });
  var seq = String(max + 1);
  while (seq.length < 4) seq = '0' + seq;
  return prefix + seq;
}

function actionLogsOf_(actionId) {
  return readTable_(T.ACTION_LOG, function (row, idx) { return row[idx.action_id] === actionId; })
    .sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
}

// ---------- validation ----------

/** Master data the checks need, read once. */
function actionMasterCtx_() {
  var areas = {}, areaLower = {}, lines = {}, equipment = {}, eqAreas = {};
  readTable_(T.AREAS).forEach(function (a) { areas[a.area_id] = a; areaLower[a.area_id.toLowerCase()] = a.area_id; });
  readTable_(T.LINES).forEach(function (l) { lines[l.line_id] = l; });
  readColumn_(T.EQUIPMENT, 'equipment_id').forEach(function (id) { equipment[codeKey_(id)] = id; });
  readTable_(T.EQUIPMENT_AREAS).forEach(function (r) { (eqAreas[r.equipment_id] = eqAreas[r.equipment_id] || []).push(r.area_id); });
  var contractors = {};
  readTable_(T.CONTRACTORS).forEach(function (c) { contractors[c.contractor_id] = c; });
  return { areas: areas, areaLower: areaLower, lines: lines, equipment: equipment, eqAreas: eqAreas, contractors: contractors };
}

function pickEnum_(v, allowed, label, dflt) {
  if (v === undefined || v === null || v === '') {
    if (dflt !== undefined) return dflt;
    throw apiError_(ERR.BAD_REQUEST, label + ' is required.');
  }
  if (allowed.indexOf(v) < 0) throw apiError_(ERR.BAD_REQUEST, label + ' must be one of: ' + allowed.filter(Boolean).join(', ') + '.');
  return v;
}

function cleanDue_(v) {
  var s = cleanText_(v, 'Due date', false, 20);
  if (s && !isValidDate_(s)) throw apiError_(ERR.BAD_REQUEST, 'Due date must be a date like 2026-10-25, or blank.');
  return s;
}

/** Evidence sent by the app: a list of {event_id} or {note} (or both). */
function cleanEvidenceInput_(list, by, at) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw apiError_(ERR.BAD_REQUEST, 'Evidence must be a list.');
  if (list.length > ACTION_EVIDENCE_MAX_) throw apiError_(ERR.BAD_REQUEST, 'At most ' + ACTION_EVIDENCE_MAX_ + ' evidence items at once.');
  return list.map(function (x) {
    if (!plainObject_(x)) throw apiError_(ERR.BAD_REQUEST, 'Each evidence item must be an object.');
    onlyKeys_(x, ['event_id', 'note'], 'An evidence item');
    var ev = x.event_id === undefined || x.event_id === null ? '' : x.event_id;
    if (typeof ev !== 'string' || (ev && !EVENT_ID_PATTERN_.test(ev))) throw apiError_(ERR.BAD_REQUEST, 'An evidence event id must look like EV- and 16 hex characters.');
    var note = cleanText_(x.note === null ? '' : x.note, 'An evidence note', false, 500);
    if (!ev && !note) throw apiError_(ERR.BAD_REQUEST, 'An evidence item needs an event id or a note.');
    var item = { added_at: at, added_by: by };
    if (ev) item.event_id = ev;
    if (note) item.note = note;
    return item;
  });
}

/**
 * Scope fields: equipment (equipment_id from master data; area and line follow it when blank), area (area_id; line
 * follows it), line (line_id) or plant. Fields that do not belong to the scope are cleared. `strictEquipment` false keeps
 * an equipment code that is not in master data (a code the rules found in the events).
 */
function cleanScope_(c, mctx, strictEquipment) {
  var kind = pickEnum_(c.scope_kind, actionEnum_('scope_kind'), 'Scope');
  var area = cleanText_(c.area_id, 'Area', false, 40);
  var line = cleanText_(c.line_id, 'Line', false, 20);
  var eq = cleanText_(c.equipment_id, 'Equipment', false, 60);
  if (area) {
    var real = mctx.areaLower[area.toLowerCase()];
    if (!real) throw apiError_(ERR.BAD_REQUEST, 'Area "' + oneLine_(area, 40) + '" is not in the list of areas.');
    area = real;
  }
  if (line && !mctx.lines[line]) throw apiError_(ERR.BAD_REQUEST, 'Line "' + oneLine_(line, 20) + '" is not in the list of lines.');
  if (kind === 'equipment') {
    if (!eq) throw apiError_(ERR.BAD_REQUEST, 'Choose the equipment.');
    var key = codeKey_(eq);
    if (mctx.equipment[key] !== undefined) eq = mctx.equipment[key];
    else if (strictEquipment) throw apiError_(ERR.BAD_REQUEST, 'Equipment "' + oneLine_(eq, 40) + '" is not in Master Data.');
    else eq = key;
    if (!area) area = (mctx.eqAreas[eq] || [])[0] || '';
  } else {
    eq = '';
  }
  if (kind === 'area' && !area) throw apiError_(ERR.BAD_REQUEST, 'Choose the area.');
  if (kind === 'line' || kind === 'plant') area = '';
  if (area && !line) line = mctx.areas[area] ? mctx.areas[area].line_id : '';
  if (kind === 'line' && !line) throw apiError_(ERR.BAD_REQUEST, 'Choose the line.');
  if (kind === 'plant') line = '';
  return { scope_kind: kind, area_id: area, line_id: line, equipment_id: eq };
}

function cleanOwner_(v, mctx) {
  var owner = cleanText_(v, 'Owner', false, 40);
  if (!owner) return { owner: '', owner_kind: 'internal' };
  var c = mctx.contractors[owner];
  if (!c || !c.active) throw apiError_(ERR.BAD_REQUEST, 'Owner "' + oneLine_(owner, 40) + '" is not an active contractor or team.');
  return { owner: owner, owner_kind: c.kind };
}

function cleanNeedsStop_(v) {
  if (v === undefined || v === null) return false;
  if (typeof v !== 'boolean') throw apiError_(ERR.BAD_REQUEST, 'Needs stoppage must be true or false.');
  return v;
}

/** A new action from the app, cleaned. Returns the row fields (without ids and stamps) and the evidence items. */
function cleanActionInput_(input, mctx, by, at) {
  requireObject_(input, 'Action');
  onlyKeys_(input, ACTION_INPUT_FIELDS_, 'An action');
  var status = pickEnum_(input.status, actionEnum_('status'), 'Status', 'Draft');
  if (isTerminal_(status)) throw apiError_(ERR.BAD_REQUEST, 'A new action cannot start ' + status + '.');
  var scope = cleanScope_(input, mctx, true);
  var owner = cleanOwner_(input.owner, mctx);
  var c = {
    title: cleanText_(input.title, 'Title', true, ACTION_TITLE_MAX_),
    detail: cleanText_(input.detail, 'Detail', false, ACTION_LONG_TEXT_MAX_),
    status: status,
    priority: pickEnum_(input.priority, actionEnum_('priority'), 'Priority', 'Medium'),
    source: pickEnum_(input.source, actionEnum_('source'), 'Source', 'manual'),
    source_ref: cleanText_(input.source_ref, 'Source reference', false, 200),
    scope_kind: scope.scope_kind, area_id: scope.area_id, line_id: scope.line_id, equipment_id: scope.equipment_id,
    reason_key: matchKey_(cleanText_(input.reason_key, 'Reason', false, 200)),
    owner: owner.owner, owner_kind: owner.owner_kind,
    assignee: cleanText_(input.assignee, 'Assignee', false, 100),
    due_date: cleanDue_(input.due_date),
    needs_stop: cleanNeedsStop_(input.needs_stop),
    root_cause: pickEnum_(input.root_cause === undefined || input.root_cause === null ? '' : input.root_cause, actionEnum_('root_cause'), 'Root cause', ''),
    required_action: cleanText_(input.required_action, 'Required action', false, ACTION_LONG_TEXT_MAX_),
    dedupe_key: cleanText_(input.dedupe_key, 'Dedupe key', false, 300)
  };
  if (c.scope_kind !== 'equipment') c.reason_key = c.scope_kind === 'area' ? c.reason_key : '';
  if (!c.dedupe_key && c.scope_kind === 'equipment' && c.reason_key) c.dedupe_key = 'repeat|' + c.equipment_id + '|' + c.reason_key;
  return { row: c, evidence: cleanEvidenceInput_(input.evidence, by, at) };
}

// ---------- reads ----------

function listActions_(session) {
  var ast = actionSettings_();
  var actions = readTable_(T.ACTIONS).map(actionOut_)
    .sort(function (a, b) { return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : (a.action_id < b.action_id ? 1 : -1); });
  // by time; rows written in the same millisecond keep the order they were written in (a stable sort)
  var logs = readTable_(T.ACTION_LOG).sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
  var people = readUsers_().filter(function (u) { return u.active; })
    .map(function (u) { return { user_id: u.user_id, display_name: u.display_name }; })
    .sort(function (a, b) { return a.display_name < b.display_name ? -1 : a.display_name > b.display_name ? 1 : 0; });
  return {
    actions: actions, logs: logs, contractors: sortContractors_(readTable_(T.CONTRACTORS).map(contractorOut_)),
    people: people, closers: ast.closers, can_close: isCloser_(session, ast)
  };
}

// ---------- writes ----------

function actionResult_(row, merged) {
  var out = { action: actionOut_(row), logs: actionLogsOf_(row.action_id) };
  if (merged !== undefined) out.merged = merged;
  return out;
}

/**
 * createAction: a new action, or (options.merge, default true) the open action with the same dedupe_key receiving the
 * evidence. Returns { action, logs, merged }.
 */
function createAction_(session, input, options) {
  if (options !== undefined && options !== null) {
    requireObject_(options, 'Options');
    onlyKeys_(options, ['merge'], 'Options');
    if (options.merge !== undefined && typeof options.merge !== 'boolean') throw apiError_(ERR.BAD_REQUEST, 'Options merge must be true or false.');
  }
  var merge = !options || options.merge !== false;
  var uid = session.user.user_id;
  return withLock_(function () {
    var stamp = nowTs_();
    var clean = cleanActionInput_(input, actionMasterCtx_(), uid, stamp);
    var rows = readTable_(T.ACTIONS);
    var c = clean.row;
    if (merge && c.dedupe_key) {
      var open = rows.filter(function (r) { return r.dedupe_key === c.dedupe_key && !isTerminal_(r.status); })
        .sort(function (a, b) { return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : (a.action_id < b.action_id ? -1 : 1); })[0];
      if (open) {
        var m = mergeEvidence_(parseEvidence_(open.evidence), clean.evidence);
        var patch = { evidence: JSON.stringify(m.list), updated_at: stamp, updated_by: uid };
        updateRow_(T.ACTIONS, open._row, patch);
        appendRow_(T.ACTION_LOG, actionLogRow_(open.action_id, uid, 'evidence', '', '',
          'Merged instead of a new action (' + c.source + '): ' + c.title + '. ' + m.added + ' evidence item' + (m.added === 1 ? '' : 's') + ' added.', stamp));
        auditLog_(uid, 'merge_action', T.ACTIONS, open.action_id, 'Merged a new ' + c.source + ' action, ' + m.added + ' evidence items added');
        Object.keys(patch).forEach(function (k) { open[k] = patch[k]; });
        return actionResult_(open, true);
      }
    }
    var row = actionRowFrom_(c, nextActionId_(rows, stamp), uid, stamp, clean.evidence);
    appendRow_(T.ACTIONS, row);
    var logs = [actionLogRow_(row.action_id, uid, 'status', '', row.status, 'Created (' + row.source + ')', stamp)];
    if (clean.evidence.length) logs.push(actionLogRow_(row.action_id, uid, 'evidence', '', '', clean.evidence.length + ' evidence item' + (clean.evidence.length === 1 ? '' : 's') + ' added.', stamp));
    appendRows_(T.ACTION_LOG, logs);
    auditLog_(uid, 'create_action', T.ACTIONS, row.action_id, row.status + ': ' + row.title);
    return actionResult_(row, false);
  });
}

function actionRowFrom_(c, id, by, stamp, evidence) {
  return {
    action_id: id, title: c.title, detail: c.detail || '', status: c.status, priority: c.priority, source: c.source,
    source_ref: c.source_ref || '', scope_kind: c.scope_kind, area_id: c.area_id || '', line_id: c.line_id || '',
    equipment_id: c.equipment_id || '', reason_key: c.reason_key || '', owner_kind: c.owner_kind, owner: c.owner || '',
    assignee: c.assignee || '', due_date: c.due_date || '', needs_stop: !!c.needs_stop, root_cause: c.root_cause || '',
    required_action: c.required_action || '', created_by: by, created_at: stamp, updated_at: stamp, updated_by: by,
    closed_by: '', closed_at: '', closure_note: '', effectiveness: '', effectiveness_checked_at: '',
    evidence: JSON.stringify(mergeEvidence_([], evidence || []).list), dedupe_key: c.dedupe_key || ''
  };
}

function findActionOrThrow_(actionId) {
  var id = cleanText_(actionId, 'Action', true, 40);
  var row = findBy_(T.ACTIONS, 'action_id', id);
  if (!row) throw apiError_(ERR.NOT_FOUND, 'Action not found.');
  return row;
}

function logValue_(v) {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  return v === '' || v === null || v === undefined ? '(blank)' : String(v);
}

/**
 * updateAction: changes some fields. `changes` may also carry add_evidence (a list like createAction's evidence).
 * Status rules: moving to or from Closed / Cancelled needs a closer (actions_closers or Admin); a closed or cancelled
 * action can only be reopened to Open; closing needs closure_note (at least 3 characters).
 */
function updateAction_(session, actionId, changes) {
  requireObject_(changes, 'Changes');
  onlyKeys_(changes, ACTION_EDIT_FIELDS_.concat(['add_evidence']), 'Changes');
  if (!Object.keys(changes).length) throw apiError_(ERR.BAD_REQUEST, 'No changes to save.');
  var uid = session.user.user_id;
  return withLock_(function () {
    var stamp = nowTs_();
    var ast = actionSettings_();
    var mctx = actionMasterCtx_();
    var row = findActionOrThrow_(actionId);
    var closer = isCloser_(session, ast);
    var from = row.status;
    var has = function (k) { return Object.prototype.hasOwnProperty.call(changes, k); };
    var next = {};
    if (has('title')) next.title = cleanText_(changes.title, 'Title', true, ACTION_TITLE_MAX_);
    if (has('detail')) next.detail = cleanText_(changes.detail, 'Detail', false, ACTION_LONG_TEXT_MAX_);
    if (has('required_action')) next.required_action = cleanText_(changes.required_action, 'Required action', false, ACTION_LONG_TEXT_MAX_);
    if (has('priority')) next.priority = pickEnum_(changes.priority, actionEnum_('priority'), 'Priority');
    if (has('status')) next.status = pickEnum_(changes.status, actionEnum_('status'), 'Status');
    if (has('reason_key')) next.reason_key = matchKey_(cleanText_(changes.reason_key, 'Reason', false, 200));
    if (has('assignee')) next.assignee = cleanText_(changes.assignee, 'Assignee', false, 100);
    if (has('due_date')) next.due_date = cleanDue_(changes.due_date);
    if (has('needs_stop')) next.needs_stop = cleanNeedsStop_(changes.needs_stop);
    if (has('root_cause')) next.root_cause = pickEnum_(changes.root_cause === null ? '' : changes.root_cause, actionEnum_('root_cause'), 'Root cause', '');
    if (has('owner')) {
      var ow = cleanOwner_(changes.owner, mctx);
      next.owner = ow.owner;
      next.owner_kind = ow.owner_kind;
    }
    if (has('scope_kind') || has('area_id') || has('line_id') || has('equipment_id')) {
      var cand = {
        scope_kind: has('scope_kind') ? changes.scope_kind : row.scope_kind,
        area_id: has('area_id') ? changes.area_id : (has('equipment_id') || has('scope_kind') ? '' : row.area_id),
        line_id: has('line_id') ? changes.line_id : (has('area_id') || has('equipment_id') || has('scope_kind') ? '' : row.line_id),
        equipment_id: has('equipment_id') ? changes.equipment_id : row.equipment_id
      };
      var sc = cleanScope_(cand, mctx, has('equipment_id') || (has('scope_kind') && changes.scope_kind !== row.scope_kind));
      Object.keys(sc).forEach(function (k) { next[k] = sc[k]; });
    }
    var to = next.status === undefined ? from : next.status;
    var note = has('closure_note') ? cleanText_(changes.closure_note, 'Closing note', false, 1000) : null;
    var evidence = has('add_evidence') ? cleanEvidenceInput_(changes.add_evidence, uid, stamp) : [];

    // who may do what
    if ((isTerminal_(from) || isTerminal_(to)) && !closer) {
      throw apiError_(ERR.FORBIDDEN, 'Only people on the "Who can close actions" list can close, cancel, reopen or change a closed action.');
    }
    if (isTerminal_(from) && !isTerminal_(to) && to !== 'Open') throw apiError_(ERR.BAD_REQUEST, 'A closed or cancelled action can only be reopened to Open.');
    if (note !== null && !isTerminal_(to)) throw apiError_(ERR.BAD_REQUEST, 'A closing note can only be written when the action is closed or cancelled.');
    if (isTerminal_(to) && to !== from) {
      if (!note || note.length < ACTION_NOTE_MIN_) throw apiError_(ERR.BAD_REQUEST, 'Write a closing note of at least ' + ACTION_NOTE_MIN_ + ' characters.');
    }

    // what changed
    var patch = {}, edits = [];
    Object.keys(next).forEach(function (k) {
      if (k === 'status' || k === 'owner_kind') return;
      if (next[k] === row[k]) return;
      patch[k] = next[k];
      if (k === 'owner') patch.owner_kind = next.owner_kind;
      edits.push(['title', 'detail', 'required_action'].indexOf(k) >= 0 ? k + ' changed' : k + ': ' + logValue_(row[k]) + ' -> ' + logValue_(next[k]));
    });
    if (note !== null && note !== row.closure_note && to === from) {
      patch.closure_note = note;
      edits.push('closing note changed');
    }
    var logs = [];
    if (to !== from) {
      patch.status = to;
      if (isTerminal_(to)) {
        patch.closed_by = uid;
        patch.closed_at = stamp;
        patch.closure_note = note;
        var watch = to === 'Closed' && (patch.scope_kind || row.scope_kind) === 'equipment';
        patch.effectiveness = watch ? 'Watching' : '';
        patch.effectiveness_checked_at = watch ? stamp : '';
      } else if (isTerminal_(from)) {
        patch.closed_by = '';
        patch.closed_at = '';
        patch.closure_note = '';
        patch.effectiveness = '';
        patch.effectiveness_checked_at = '';
      }
      logs.push(actionLogRow_(row.action_id, uid, 'status', from, to, isTerminal_(to) ? note : (isTerminal_(from) ? 'Reopened' : ''), stamp));
    }
    if (edits.length) logs.push(actionLogRow_(row.action_id, uid, 'edit', '', '', edits.join('; '), stamp));
    if (evidence.length) {
      var m = mergeEvidence_(parseEvidence_(row.evidence), evidence);
      if (m.added) {
        patch.evidence = JSON.stringify(m.list);
        logs.push(actionLogRow_(row.action_id, uid, 'evidence', '', '', m.added + ' evidence item' + (m.added === 1 ? '' : 's') + ' added.', stamp));
      }
    }
    if (!logs.length) throw apiError_(ERR.BAD_REQUEST, 'Nothing was changed.');
    patch.updated_at = stamp;
    patch.updated_by = uid;
    updateRow_(T.ACTIONS, row._row, patch);
    appendRows_(T.ACTION_LOG, logs);
    auditLog_(uid, 'update_action', T.ACTIONS, row.action_id, logs.map(function (l) {
      if (l.kind === 'status') return 'status: ' + (l.from_status || '(new)') + ' -> ' + l.to_status + (l.text ? ' (' + auditValue_(l.text, 80) + ')' : '');
      return l.kind + ': ' + auditValue_(l.text, 200);
    }).join('. '));
    Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
    return actionResult_(row);
  });
}

function addActionComment_(session, actionId, text) {
  var body = cleanText_(text, 'Comment', true, ACTION_LONG_TEXT_MAX_);
  var uid = session.user.user_id;
  return withLock_(function () {
    var stamp = nowTs_();
    var row = findActionOrThrow_(actionId);
    appendRow_(T.ACTION_LOG, actionLogRow_(row.action_id, uid, 'comment', '', '', body, stamp));
    updateRow_(T.ACTIONS, row._row, { updated_at: stamp, updated_by: uid });
    auditLog_(uid, 'comment_action', T.ACTIONS, row.action_id, auditValue_(body, 160)); // 1.6.0
    row.updated_at = stamp;
    row.updated_by = uid;
    return actionResult_(row);
  });
}

// ---------- contractors ----------

/**
 * saveContractors: inserts or updates the rows given (by contractor_id); rows not sent stay as they are (switch one off
 * with active = false). An area may belong to at most one ACTIVE external contractor. Returns every contractor.
 */
function saveContractors_(session, rows) {
  if (!Array.isArray(rows) || !rows.length) throw apiError_(ERR.BAD_REQUEST, 'Send at least one contractor.');
  if (rows.length > 50) throw apiError_(ERR.BAD_REQUEST, 'At most 50 contractors at once.');
  var areaLower = {};
  readTable_(T.AREAS).forEach(function (a) { areaLower[a.area_id.toLowerCase()] = a.area_id; });
  var seen = {};
  var clean = rows.map(function (r) {
    if (!plainObject_(r)) throw apiError_(ERR.BAD_REQUEST, 'Each contractor must be an object.');
    onlyKeys_(r, ['contractor_id', 'name', 'areas', 'kind', 'active', 'sort_order', 'default_assignee'], 'A contractor');
    var id = typeof r.contractor_id === 'string' ? r.contractor_id.trim() : '';
    if (!CONTRACTOR_ID_PATTERN_.test(id)) throw apiError_(ERR.BAD_REQUEST, 'A contractor id must be 1 to 40 letters, digits, spaces, dots, dashes or underscores.');
    if (seen[id]) throw apiError_(ERR.BAD_REQUEST, 'Contractor ' + id + ' is listed twice.');
    seen[id] = true;
    if (!Array.isArray(r.areas)) throw apiError_(ERR.BAD_REQUEST, 'Contractor areas must be a list.');
    var areas = [];
    r.areas.forEach(function (a) {
      var real = typeof a === 'string' ? areaLower[a.trim().toLowerCase()] : undefined;
      if (!real) throw apiError_(ERR.BAD_REQUEST, 'Area "' + oneLine_(a, 40) + '" is not in the list of areas.');
      if (areas.indexOf(real) < 0) areas.push(real);
    });
    if (typeof r.active !== 'boolean') throw apiError_(ERR.BAD_REQUEST, 'Contractor active must be true or false.');
    var order = r.sort_order === undefined || r.sort_order === null ? 0 : r.sort_order;
    if (typeof order !== 'number' || order % 1 !== 0 || order < 0 || order > 1000) throw apiError_(ERR.BAD_REQUEST, 'Contractor sort order must be a whole number from 0 to 1000.');
    return {
      contractor_id: id, name: cleanText_(r.name, 'Contractor name', true, 60), areas: areas.join(','),
      kind: pickEnum_(r.kind, enumOf_(T.CONTRACTORS, 'kind'), 'Contractor kind'), active: r.active, sort_order: order,
      default_assignee: cleanText_(r.default_assignee, 'Default assignee', false, 100)
    };
  });
  var uid = session.user.user_id;
  return withLock_(function () {
    var existing = readTable_(T.CONTRACTORS);
    var after = {};
    existing.forEach(function (c) { after[c.contractor_id] = c; });
    clean.forEach(function (c) { after[c.contractor_id] = c; });
    var owner = {};
    Object.keys(after).sort().forEach(function (id) {
      var c = after[id];
      if (!c.active || c.kind !== 'contractor') return;
      csv_(c.areas).forEach(function (a) {
        if (owner[a] && owner[a] !== id) throw apiError_(ERR.CONFLICT, 'Area ' + a + ' would belong to both ' + owner[a] + ' and ' + id + '.');
        owner[a] = id;
      });
    });
    var said = [];
    clean.forEach(function (c) {
      var ex = existing.filter(function (e) { return e.contractor_id === c.contractor_id; })[0];
      if (ex) updateRow_(T.CONTRACTORS, ex._row, c); else appendRow_(T.CONTRACTORS, c);
      var what = ex ? auditChanges_(ex, c, ['name', 'areas', 'kind', 'active', 'sort_order', 'default_assignee'], 80) : 'added (' + c.kind + ', areas ' + auditValue_(c.areas, 80) + ')';
      if (what) said.push(c.contractor_id + ' ' + what);
    });
    auditLog_(uid, 'save_contractors', T.CONTRACTORS, clean.map(function (c) { return c.contractor_id; }).join(','), said.join('. ') || 'No change');
    return sortContractors_(readTable_(T.CONTRACTORS).map(contractorOut_));
  });
}

// ---------- area targets ----------

/** Allowance split evenly over the months: 2-decimal months, December takes the rounding rest (src/api/types.ts evenMonthlySplit). */
function evenMonthlySplit_(allowance) {
  var each = round2_(allowance / 12), out = [], sum = 0;
  for (var i = 0; i < 11; i++) { out.push(each); sum += each; }
  out.push(round2_(allowance - sum));
  return out;
}

function parseSplit_(text) {
  try {
    var list = JSON.parse(text);
    if (Array.isArray(list) && list.length === 12 && list.every(function (n) { return typeof n === 'number' && isFinite(n); })) return list;
  } catch (e) { /* fall through */ }
  return null;
}

function areaTargetOut_(r) {
  var allowance = r.planned_allowance_h_year === null ? 0 : r.planned_allowance_h_year;
  return {
    area_id: r.area_id, year: r.year, availability_target_pct: r.availability_target_pct,
    planned_allowance_h_year: allowance, monthly_split: parseSplit_(r.monthly_split) || evenMonthlySplit_(allowance),
    overhaul_months: csv_(r.overhaul_months).map(Number).filter(function (n) { return n >= 1 && n <= 12 && n % 1 === 0; }),
    updated_at: r.updated_at, updated_by: r.updated_by
  };
}

/** getAreaTargets: the targets of one year (or of every year when no year is given), area by area. */
function getAreaTargets_(year) {
  if (year !== undefined && year !== null && !(typeof year === 'number' && year % 1 === 0 && year >= 2000 && year <= 2100)) {
    throw apiError_(ERR.BAD_REQUEST, 'Please give a year such as 2026.');
  }
  var order = {};
  readTable_(T.AREAS).forEach(function (a) { order[a.area_id] = a.sort_order; });
  return optionalTable_(T.AREA_TARGETS)
    .filter(function (r) { return year === undefined || year === null || r.year === year; })
    .map(areaTargetOut_)
    .sort(function (a, b) { return (a.year - b.year) || ((order[a.area_id] || 0) - (order[b.area_id] || 0)) || (a.area_id < b.area_id ? -1 : 1); });
}

/**
 * saveAreaTargets: inserts or updates the targets of one year for the areas sent. monthly_split may be left out (even
 * split); when sent it is 12 numbers of 0 or more adding up to the allowance (within 0.1). Returns the year's targets.
 */
function saveAreaTargets_(session, year, rows) {
  if (!(typeof year === 'number' && year % 1 === 0 && year >= 2000 && year <= 2100)) throw apiError_(ERR.BAD_REQUEST, 'Please give a year such as 2026.');
  if (!Array.isArray(rows) || !rows.length) throw apiError_(ERR.BAD_REQUEST, 'Send at least one area.');
  if (rows.length > 100) throw apiError_(ERR.BAD_REQUEST, 'At most 100 areas at once.');
  var areaLower = {};
  readTable_(T.AREAS).forEach(function (a) { areaLower[a.area_id.toLowerCase()] = a.area_id; });
  var seen = {};
  var uid = session.user.user_id;
  var clean = rows.map(function (r) {
    if (!plainObject_(r)) throw apiError_(ERR.BAD_REQUEST, 'Each area target must be an object.');
    onlyKeys_(r, ['area_id', 'availability_target_pct', 'planned_allowance_h_year', 'monthly_split', 'overhaul_months'], 'An area target');
    var area = typeof r.area_id === 'string' ? areaLower[r.area_id.trim().toLowerCase()] : undefined;
    if (!area) throw apiError_(ERR.BAD_REQUEST, 'Area "' + oneLine_(r.area_id, 40) + '" is not in the list of areas.');
    if (seen[area]) throw apiError_(ERR.BAD_REQUEST, 'Area ' + area + ' is listed twice.');
    seen[area] = true;
    var target = r.availability_target_pct;
    if (target === undefined || target === '') target = null;
    if (target !== null && !(typeof target === 'number' && isFinite(target) && target >= 0 && target <= 100)) {
      throw apiError_(ERR.BAD_REQUEST, area + ': the availability target must be between 0 and 100, or blank.');
    }
    var allowance = r.planned_allowance_h_year;
    if (!(typeof allowance === 'number' && isFinite(allowance) && allowance >= 0 && allowance <= 8784)) {
      throw apiError_(ERR.BAD_REQUEST, area + ': the planned allowance must be between 0 and 8784 hours a year.');
    }
    var split = r.monthly_split;
    if (split === undefined || split === null) split = evenMonthlySplit_(allowance);
    if (!Array.isArray(split) || split.length !== 12 || !split.every(function (n) { return typeof n === 'number' && isFinite(n) && n >= 0; })) {
      throw apiError_(ERR.BAD_REQUEST, area + ': the monthly split must be 12 numbers of 0 or more.');
    }
    var sum = split.reduce(function (s, n) { return s + n; }, 0);
    if (Math.abs(sum - allowance) > ACTION_SPLIT_TOLERANCE_ + 1e-9) {
      throw apiError_(ERR.BAD_REQUEST, area + ': the months add up to ' + round2_(sum) + ' h, not the ' + allowance + ' h allowed in the year.');
    }
    var months = r.overhaul_months === undefined || r.overhaul_months === null ? [] : r.overhaul_months;
    if (!Array.isArray(months) || !months.every(function (n) { return typeof n === 'number' && n % 1 === 0 && n >= 1 && n <= 12; })) {
      throw apiError_(ERR.BAD_REQUEST, area + ': overhaul months must be month numbers from 1 to 12.');
    }
    var uniq = [];
    months.forEach(function (n) { if (uniq.indexOf(n) < 0) uniq.push(n); });
    uniq.sort(function (a, b) { return a - b; });
    return {
      area_id: area, year: year, availability_target_pct: target === null ? '' : target, planned_allowance_h_year: allowance,
      monthly_split: JSON.stringify(split), overhaul_months: uniq.join(','), updated_by: uid
    };
  });
  withLock_(function () {
    var stamp = nowTs_();
    var existing = readTable_(T.AREA_TARGETS);
    var said = [];
    clean.forEach(function (c) {
      c.updated_at = stamp;
      var ex = existing.filter(function (e) { return e.area_id === c.area_id && e.year === year; })[0];
      if (ex) updateRow_(T.AREA_TARGETS, ex._row, c); else appendRow_(T.AREA_TARGETS, c);
      var fields = ['availability_target_pct', 'planned_allowance_h_year', 'overhaul_months', 'monthly_split'];
      var what = auditChanges_(ex ? { availability_target_pct: ex.availability_target_pct === null ? '' : ex.availability_target_pct,
        planned_allowance_h_year: ex.planned_allowance_h_year, overhaul_months: ex.overhaul_months, monthly_split: ex.monthly_split } : {}, c, fields, 40);
      if (what) said.push(c.area_id + ' ' + what.replace(/monthly_split: [^;]*/, 'monthly split changed'));
    });
    auditLog_(uid, 'save_area_targets', T.AREA_TARGETS, String(year), said.join('. ') || 'No change');
  });
  return getAreaTargets_(year);
}

// ---------- planned overrun (shared by the notification rule and the draft rule) ----------

/**
 * Areas whose planned (PL) hours in a complete month are above that month's allowance. PL hours are the union of the
 * area's stops owned by PL rows (P1, the same attribution as availability), voided and blocked rows left out. A month
 * is complete when the latest event date is on or after its last day; only months whose last day is within
 * notif_retention_days before the latest event date are checked (older ones would expire at once).
 * Returns [{ area, line, month, used, allowed, ytdUsed, ytdAllowed, allowance, eventIds }] by area, then month.
 */
function plannedOverruns_(ctx, targets) {
  var out = [];
  if (!ctx.latest || !targets.length) return out;
  var cache = {};
  function plOf(from, to) {
    var key = from + '|' + to;
    if (!cache[key]) cache[key] = notifUnionHours_(ctx.rows, dateMs_(from), dateMs_(to) + MS_DAY_);
    return cache[key];
  }
  targets.slice().sort(function (a, b) { return (a.area_id < b.area_id ? -1 : a.area_id > b.area_id ? 1 : 0) || (a.year - b.year); }).forEach(function (t) {
    var tt = areaTargetOut_(t);
    for (var m = 1; m <= 12; m++) {
      var month = tt.year + '-' + (m < 10 ? '0' : '') + m;
      var last = lastDayOfMonth_(month);
      if (last > ctx.latest || last < ctx.cutoff) continue;
      var used = (plOf(month + '-01', last)[tt.area_id] || { pl: 0 }).pl;
      var allowed = tt.monthly_split[m - 1];
      if (!(used > allowed + 1e-9)) continue;
      var ytdAllowed = 0;
      for (var k = 0; k < m; k++) ytdAllowed += tt.monthly_split[k];
      var ytdUsed = (plOf(tt.year + '-01-01', last)[tt.area_id] || { pl: 0 }).pl;
      var ids = ctx.rows.filter(function (r) { return r.area_id === tt.area_id && r.classification === 'PL' && String(r.stop_ts).slice(0, 7) === month; })
        .sort(function (a, b) { return a.stop_ts < b.stop_ts ? -1 : a.stop_ts > b.stop_ts ? 1 : (a.event_id < b.event_id ? -1 : 1); })
        .map(function (r) { return r.event_id; });
      out.push({
        area: tt.area_id, line: notifLineOf_(ctx, tt.area_id, ''), month: month, used: used, allowed: allowed,
        ytdUsed: ytdUsed, ytdAllowed: ytdAllowed, allowance: tt.planned_allowance_h_year, eventIds: ids.slice(0, ACTION_EVIDENCE_MAX_)
      });
    }
  });
  return out;
}

function plannedOverrunText_(o) {
  return {
    title: 'Planned overrun: ' + o.area + ' used ' + o.used.toFixed(1) + ' h of ' + o.allowed.toFixed(1) + ' h allowed in ' + o.month,
    detail: 'Year to date ' + o.ytdUsed.toFixed(1) + ' h of ' + o.ytdAllowed.toFixed(1) + ' h allowed (' + o.allowance.toFixed(1) + ' h for ' + o.month.slice(0, 4) + ').'
  };
}

// ---------- the draft rules ----------

/** The code a failure is grouped by (alias resolved; null for area-level), as the repeated-failure alert. */
function actionChainCode_(ctx, c) { return notifCodeOf_(ctx, c.head); }

/**
 * repeat: the same equipment and reason (match_key) has at least actions_repeat_n OCCURRENCES (P5, as the repeat_group
 * alert) within actions_repeat_days; only the latest cluster of a group, and only when its last occurrence started
 * within actions_repeat_days before the latest event date.
 */
function actionRuleRepeat_(ctx, chains, ast) {
  var out = [], groups = {}, order = [];
  chains.forEach(function (c) {
    if (!c.isFailure) return;
    var code = actionChainCode_(ctx, c);
    if (code === null) return;
    var reasonKey = matchKey_(c.head.reason_raw);
    if (reasonKey === '') return;
    var key = code + '|' + reasonKey;
    if (!groups[key]) { groups[key] = { code: code, reasonKey: reasonKey, list: [] }; order.push(key); }
    groups[key].list.push(c);
  });
  var recent = addDays_(ctx.latest, -ast.repeatDays);
  order.forEach(function (key) {
    var g = groups[key];
    g.list.sort(function (a, b) { return (a.startMs - b.startMs) || (a.id < b.id ? -1 : 1); });
    var occs = notifOccurrences_(g.list);
    var clusters = notifFindClusters_(occs.map(function (o) { return o.startMs; }), ast.repeatN, ast.repeatDays);
    if (!clusters.length) return;
    var cl = clusters[clusters.length - 1];
    var lastOcc = occs[cl[cl.length - 1]];
    var latest = lastOcc.members[0];
    if (latest.startDate < recent) return;
    var members = [];
    cl.forEach(function (i) { members = members.concat(occs[i].members); });
    var hours = members.reduce(function (s, c) { return s + c.durationS / 3600; }, 0);
    var label = oneLine_(occs[cl[0]].members[0].head.reason_raw, 120);
    out.push({
      dedupe_key: 'repeat|' + g.code + '|' + g.reasonKey, source: 'auto_repeat', source_ref: latest.id, priority: 'Medium',
      title: g.code + ' - ' + label + ': ' + cl.length + ' failures in ' + ast.repeatDays + ' days',
      detail: cl.length + ' failures within ' + ast.repeatDays + ' days (' + hours.toFixed(1) + ' h stopped), latest ' + latest.startDate + ' in ' +
        latest.area_id + '. Rule: ' + ast.repeatN + ' or more in ' + ast.repeatDays + ' days.',
      scope_kind: 'equipment', area_id: latest.area_id, line_id: notifLineOf_(ctx, latest.area_id, latest.line_id),
      equipment_id: g.code, reason_key: g.reasonKey, eventIds: members.map(function (c) { return c.id; }), latestTs: plantTs_(latest.startMs)
    });
  });
  return out;
}

/**
 * chronic: equipment in the top actions_chronic_top by failure hours in each of the last actions_chronic_months complete
 * months. Failure hours of an equipment in a month = the summed hours of its failure events that started in the month
 * (whole events, by the head's stop). Ties: more hours first, then the code.
 */
function actionRuleChronic_(ctx, chains, ast) {
  var out = [];
  if (!ctx.latest) return out;
  var lastMonth = ctx.latest.slice(0, 7);
  if (ctx.latest !== lastDayOfMonth_(lastMonth)) lastMonth = addMonths_(lastMonth, -1);
  var months = [];
  for (var i = ast.chronicMonths - 1; i >= 0; i--) months.push(addMonths_(lastMonth, -i));
  var hours = {}, events = {};
  months.forEach(function (m) { hours[m] = {}; events[m] = {}; });
  chains.forEach(function (c) {
    if (!c.isFailure) return;
    var m = c.startDate.slice(0, 7);
    if (!hours[m]) return;
    var code = actionChainCode_(ctx, c);
    if (code === null) return;
    hours[m][code] = (hours[m][code] || 0) + c.durationS / 3600;
    (events[m][code] = events[m][code] || []).push(c);
  });
  var tops = months.map(function (m) {
    return Object.keys(hours[m]).filter(function (k) { return hours[m][k] > 0; })
      .sort(function (a, b) { return (hours[m][b] - hours[m][a]) || (a < b ? -1 : 1); }).slice(0, ast.chronicTop);
  });
  tops[tops.length - 1].forEach(function (code) {
    if (!tops.every(function (t) { return t.indexOf(code) >= 0; })) return;
    var list = events[lastMonth][code];
    var latest = list[list.length - 1];
    var parts = months.map(function (m, k) { return m + ' ' + hours[m][code].toFixed(1) + ' h (#' + (tops[k].indexOf(code) + 1) + ')'; });
    out.push({
      dedupe_key: 'chronic|' + code + '|' + lastMonth, source: 'auto_chronic', source_ref: '', priority: 'High',
      title: code + ': top ' + ast.chronicTop + ' by failure hours for ' + ast.chronicMonths + ' months (' + months[0] + ' to ' + lastMonth + ')',
      detail: 'Failure hours: ' + parts.join(', ') + '.',
      scope_kind: 'equipment', area_id: latest.area_id, line_id: notifLineOf_(ctx, latest.area_id, latest.line_id),
      equipment_id: code, reason_key: '', eventIds: list.map(function (c) { return c.id; }), latestTs: plantTs_(latest.startMs)
    });
  });
  return out;
}

/** long stop: one draft per OPEN long_stop notification (its failure event still in the data). */
function actionRuleLongStop_(ctx, chains, notifications) {
  var out = [], byId = {};
  chains.forEach(function (c) { byId[c.id] = c; });
  notifications.filter(function (n) { return n.type === 'long_stop' && n.status === 'open'; })
    .sort(function (a, b) { return a.dedupe_key < b.dedupe_key ? -1 : 1; })
    .forEach(function (n) {
      var c = byId[n.source_ref];
      if (!c) return;
      var code = actionChainCode_(ctx, c);
      var h = (c.durationS / 3600).toFixed(1);
      var reason = oneLine_(c.head.reason_raw, 120);
      out.push({
        dedupe_key: 'long_stop|' + c.id, source: 'auto_long_stop', source_ref: n.notification_id, priority: 'High',
        title: 'Long stop: ' + c.area_id + ' ' + h + ' h' + (code !== null ? ' on ' + code : '') + (reason ? ' - ' + reason : ''),
        detail: 'A failure stopped ' + c.area_id + ' for ' + h + ' hours, starting ' + String(c.head.stop_ts).slice(0, 16) + '.',
        scope_kind: code !== null ? 'equipment' : 'area', area_id: c.area_id, line_id: notifLineOf_(ctx, c.area_id, c.line_id),
        equipment_id: code !== null ? code : '', reason_key: code !== null ? matchKey_(c.head.reason_raw) : '',
        eventIds: [c.id], latestTs: plantTs_(c.startMs)
      });
    });
  return out;
}

/** planned overrun: one draft per area and month over its allowance (the planned_overrun alert). */
function actionRulePlanned_(ctx, overruns, notifications) {
  var byKey = {};
  notifications.forEach(function (n) { byKey[n.dedupe_key] = n; });
  return overruns.map(function (o) {
    var key = 'planned|' + o.area + '|' + o.month;
    var txt = plannedOverrunText_(o);
    return {
      dedupe_key: key, source: 'auto_planned_overrun', source_ref: byKey[key] ? byKey[key].notification_id : '', priority: 'Medium',
      title: txt.title, detail: txt.detail, scope_kind: 'area', area_id: o.area, line_id: o.line, equipment_id: '', reason_key: '',
      eventIds: o.eventIds, latestTs: ''
    };
  });
}

/**
 * Effectiveness of a Closed equipment action, D = actions_effect_days: failure events of the equipment (and of the
 * action's reason, when it has one) that started in the D days before closed_at against the D days from closed_at.
 * Until the latest event date has passed closed_at + D days: Watching. Then: no failure after = Effective; at least as
 * many failures after as before = Not effective; fewer failures = Effective when the hours fell too, else Not effective.
 */
function effectivenessOf_(ctx, chains, a, days) {
  var c0 = parseTs_(a.closed_at);
  if (c0 === null || !ctx.latest) return null;
  var span = days * MS_DAY_;
  if (dateMs_(ctx.latest) + MS_DAY_ < c0 + span) return { verdict: 'Watching' };
  var eq = String(a.equipment_id).toUpperCase();
  var before = { n: 0, h: 0 }, after = { n: 0, h: 0 };
  chains.forEach(function (c) {
    if (!c.isFailure || actionChainCode_(ctx, c) !== eq) return;
    if (a.reason_key && matchKey_(c.head.reason_raw) !== a.reason_key) return;
    var w = c.startMs >= c0 - span && c.startMs < c0 ? before : c.startMs >= c0 && c.startMs < c0 + span ? after : null;
    if (!w) return;
    w.n++;
    w.h += c.durationS / 3600;
  });
  var verdict = after.n === 0 ? 'Effective' : after.n >= before.n ? 'Not effective' : after.h < before.h ? 'Effective' : 'Not effective';
  return {
    verdict: verdict,
    text: 'Effectiveness: ' + verdict + ' (' + days + ' days before closing: ' + before.n + ' failure' + (before.n === 1 ? '' : 's') + ', ' +
      before.h.toFixed(1) + ' h; ' + days + ' days after: ' + after.n + ' failure' + (after.n === 1 ? '' : 's') + ', ' + after.h.toFixed(1) + ' h)'
  };
}

/**
 * Runs the draft rules (when actions_auto_draft is on) and the effectiveness check. Idempotent: a draft whose key
 * has an open action adds only evidence it does not have yet. Returns { created, merged, effectiveness }.
 * Callers need no lock; it takes the script lock itself.
 */
function runActionChecks_() {
  return withLock_(function () {
    var ast = actionSettings_();
    var stamp = nowTs_();
    var res = { created: 0, merged: 0, effectiveness: 0 };
    var actions = optionalTable_(T.ACTIONS);
    if (!getSpreadsheet_().getSheetByName(T.ACTIONS)) return res;
    var ctx = notifLoadContext_(notifSettings_());
    var chains = notifBuildChains_(ctx.rows);
    var contractors = optionalTable_(T.CONTRACTORS);
    var fresh = [], patches = [], logs = [];

    if (ast.autoDraft && ctx.latest) {
      var notifications = readTable_(T.NOTIFICATIONS);
      var drafts = [].concat(
        actionRuleRepeat_(ctx, chains, ast), actionRuleChronic_(ctx, chains, ast), actionRuleLongStop_(ctx, chains, notifications),
        actionRulePlanned_(ctx, plannedOverruns_(ctx, optionalTable_(T.AREA_TARGETS)), notifications)
      );
      drafts.forEach(function (d) {
        var same = actions.concat(fresh).filter(function (r) { return r.dedupe_key === d.dedupe_key; });
        var open = same.filter(function (r) { return !isTerminal_(r.status); })
          .sort(function (a, b) { return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : (a.action_id < b.action_id ? -1 : 1); })[0];
        var items = d.eventIds.map(function (id) { return { event_id: id, added_at: stamp, added_by: 'system' }; });
        if (open) {
          var m = mergeEvidence_(parseEvidence_(open.evidence), items);
          if (!m.added) return;
          open.evidence = JSON.stringify(m.list);
          open.updated_at = stamp;
          open.updated_by = 'system';
          if (open._row) patches.push({ row: open, patch: { evidence: open.evidence, updated_at: stamp, updated_by: 'system' } });
          logs.push(actionLogRow_(open.action_id, 'system', 'evidence', '', '', 'Rule ' + d.source + ': ' + m.added + ' new record' + (m.added === 1 ? '' : 's') + ' added as evidence.', stamp));
          res.merged++;
          return;
        }
        if (same.length) {
          // closed or cancelled: only a repeated failure that came back after it was closed drafts again
          var lastClosed = same.reduce(function (mx, r) { return r.closed_at > mx ? r.closed_at : mx; }, '');
          if (d.source !== 'auto_repeat' || !(d.latestTs > lastClosed)) return;
        }
        var owner = contractorForArea_(contractors, d.area_id);
        var row = actionRowFrom_({
          title: oneLine_(d.title, ACTION_TITLE_MAX_), detail: oneLine_(d.detail, ACTION_LONG_TEXT_MAX_), status: 'Draft', priority: d.priority,
          source: d.source, source_ref: d.source_ref, scope_kind: d.scope_kind, area_id: d.area_id, line_id: d.line_id,
          equipment_id: d.equipment_id, reason_key: d.reason_key, owner: owner ? owner.contractor_id : '', owner_kind: owner ? 'contractor' : 'internal',
          assignee: owner ? owner.default_assignee || '' : '', dedupe_key: d.dedupe_key
        }, nextActionId_(actions.concat(fresh), stamp), 'system', stamp, items);
        fresh.push(row);
        logs.push(actionLogRow_(row.action_id, 'system', 'status', '', 'Draft', 'Drafted by rule ' + d.source, stamp));
        res.created++;
      });
    }

    actions.forEach(function (a) {
      if (a.status !== 'Closed' || a.scope_kind !== 'equipment' || a.effectiveness === 'Effective' || a.effectiveness === 'Not effective') return;
      // 1.5.0: the records of an area switched off are left out, so its actions are not judged until it is switched on again
      if (a.area_id && ctx.inactive[a.area_id]) return;
      var e = effectivenessOf_(ctx, chains, a, ast.effectDays);
      if (!e || e.verdict === a.effectiveness) return;
      patches.push({ row: a, patch: { effectiveness: e.verdict, effectiveness_checked_at: stamp } });
      if (e.text) logs.push(actionLogRow_(a.action_id, 'system', 'edit', '', '', e.text, stamp));
      res.effectiveness++;
    });

    appendRows_(T.ACTIONS, fresh);
    patches.forEach(function (p) { updateRow_(T.ACTIONS, p.row._row, p.patch); });
    appendRows_(T.ACTION_LOG, logs);
    return res;
  });
}

function runActionChecksAction_(session) {
  var res = runActionChecks_();
  withLock_(function () {
    auditLog_(session.user.user_id, 'action_check', T.ACTIONS, '',
      'Created ' + res.created + ', merged ' + res.merged + ', effectiveness ' + res.effectiveness);
  });
  return res;
}

/** Best effort after an upload or a notification check: never throws. */
function actionChecksSafely_(what) {
  try {
    return runActionChecks_();
  } catch (err) {
    notifLogFailure_('actions after ' + what, err);
    return null;
  }
}
