/**
 * Tasks inside actions (backend 1.7.0; docs/actions-mockups/tasks, docs/wire-protocol.md section 13).
 *
 * An action is the problem (one event or a group: equipment + reason); its tasks are the work. Two levels only.
 * The mock API (src/api/mockActions.ts) implements the same rules; tests/unit/contract.test.ts keeps the two in step.
 *
 * - Task statuses: Open, Contractor informed (only for an external contractor's task), Waiting stoppage, In progress, Done
 *   (needs a note of what was done) and Not needed (needs a reason). Tasks are never deleted.
 * - The action's status follows the tasks: Draft stays until it is accepted by hand; otherwise In progress as soon as any task
 *   has left Open, else Open. Closed / Cancelled stay manual (closers only); closing is refused while a task is open
 *   (error tasks_open). An action without tasks keeps the 1.4.0 behaviour.
 * - When the last open task of an accepted action closes, the closers get action_ready_to_close; reopening a task resolves it.
 * - Anyone with Edit on actions may add and change tasks. On a closed or cancelled action only a note may be added.
 * - Task templates (task_templates + task_template_steps) fill the tasks of a new action; an auto draft gets the active template
 *   that applies to its rule. "Check after 60 days" is not a task: it is the effectiveness check that starts on close.
 */

var TASK_CLOSED_ = ['Done', 'Not needed'];
var TASK_NOTE_MIN_ = 3;
var TASKS_PER_ACTION_MAX_ = 50;
var TEMPLATE_STEPS_MAX_ = 20;
var TEMPLATES_MAX_ = 30;
var TASK_TITLE_MAX_ = 200;
var AREA_CONTRACTOR_ = 'area_contractor';
var REMOVED_ACTION_STATUSES_ = ['Contractor informed', 'Waiting stoppage'];
var TASK_INPUT_FIELDS_ = ['title', 'owner', 'assignee', 'due_date', 'needs_stop', 'est_stop_h', 'notes', 'template_step'];
var TASK_CHANGE_FIELDS_ = ['title', 'owner', 'assignee', 'due_date', 'status', 'needs_stop', 'est_stop_h', 'notes', 'note'];
var TASK_FILTER_FIELDS_ = ['mine', 'overdue', 'needs_stop', 'status', 'owner', 'assignee', 'area_id', 'line_id', 'action_id', 'done_since', 'include_drafts'];

// ---------- small helpers ----------

function taskEnum_(column) { return enumOf_(T.ACTION_TASKS, column); }

function isTaskOpen_(t) { return TASK_CLOSED_.indexOf(t.status) < 0; }

function byTask_(a, b) {
  return a.action_id < b.action_id ? -1 : a.action_id > b.action_id ? 1 : (a.seq - b.seq) || (a.task_id < b.task_id ? -1 : 1);
}

/** Every task (sorted by action and seq), or [] before ensureSchema has made the sheet. */
function readAllTasks_() { return optionalTable_(T.ACTION_TASKS).sort(byTask_); }

function tasksOfAction_(actionId) {
  return optionalTable_(T.ACTION_TASKS).filter(function (t) { return t.action_id === actionId; }).sort(byTask_);
}

function tasksByAction_(tasks) {
  var by = {};
  tasks.forEach(function (t) { (by[t.action_id] = by[t.action_id] || []).push(t); });
  return by;
}

/** The API shape of a task row: est_stop_h null when not estimated or not needing a stop. */
function taskOut_(r) {
  var o = {};
  Object.keys(r).forEach(function (k) { o[k] = r[k]; });
  o.est_stop_h = r.needs_stop && r.est_stop_h !== null && r.est_stop_h !== '' && r.est_stop_h !== undefined ? Number(r.est_stop_h) : null;
  return o;
}

function taskLogRow_(actionId, taskId, by, kind, from, to, text, at) {
  var r = actionLogRow_(actionId, by, kind, from, to, text, at);
  r.task_id = taskId;
  return r;
}

/** Draft, Closed, Cancelled and actions without tasks keep their status; else In progress once a task has left Open. */
function deriveActionStatus_(status, tasks) {
  if (status === 'Draft' || isTerminal_(status) || !tasks.length) return status;
  return tasks.some(function (t) { return t.status !== 'Open'; }) ? 'In progress' : 'Open';
}

/** due_date_derived: the latest due date of the open tasks ('' when none has one); the stored due date without tasks. */
function derivedDue_(action, tasks) {
  if (!tasks || !tasks.length) return action.due_date || '';
  var max = '';
  tasks.forEach(function (t) { if (isTaskOpen_(t) && t.due_date && t.due_date > max) max = t.due_date; });
  return max;
}

function plantToday_() { return nowTs_().slice(0, 10); }

function cleanEstStop_(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1000) throw apiError_(ERR.BAD_REQUEST, 'Estimated stop hours must be a number from 0 to 1000, or blank.');
  return v;
}

/** A new task from the app (addTask, createAction tasks), cleaned. */
function cleanTaskInput_(input, mctx) {
  if (!plainObject_(input)) throw apiError_(ERR.BAD_REQUEST, 'Each task must be an object.');
  onlyKeys_(input, TASK_INPUT_FIELDS_, 'A task');
  var owner = cleanOwner_(input.owner, mctx);
  var needs = cleanNeedsStop_(input.needs_stop);
  var est = cleanEstStop_(input.est_stop_h);
  return {
    title: cleanText_(input.title, 'Task title', true, TASK_TITLE_MAX_), owner: owner.owner, owner_kind: owner.owner_kind,
    assignee: cleanText_(input.assignee, 'Person', false, 100), due_date: cleanDue_(input.due_date), needs_stop: needs,
    est_stop_h: needs ? est : null, notes: cleanText_(input.notes, 'Task notes', false, ACTION_LONG_TEXT_MAX_),
    template_step: cleanText_(input.template_step, 'Template step', false, TASK_TITLE_MAX_)
  };
}

function cleanTaskList_(list, mctx) {
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list)) throw apiError_(ERR.BAD_REQUEST, 'Tasks must be a list.');
  if (list.length > TASKS_PER_ACTION_MAX_) throw apiError_(ERR.BAD_REQUEST, 'An action can have at most ' + TASKS_PER_ACTION_MAX_ + ' tasks.');
  return list.map(function (t) { return cleanTaskInput_(t, mctx); });
}

function newTaskRow_(actionId, seq, c, by, stamp) {
  return {
    task_id: newId_('AT-', 12), action_id: actionId, seq: seq, title: c.title, owner_kind: c.owner ? c.owner_kind : 'internal',
    owner: c.owner || '', assignee: c.assignee || '', due_date: c.due_date || '', status: 'Open', needs_stop: !!c.needs_stop,
    est_stop_h: c.needs_stop && c.est_stop_h !== null && c.est_stop_h !== undefined ? c.est_stop_h : '', notes: c.notes || '',
    template_step: c.template_step || '', created_at: stamp, created_by: by, updated_at: stamp, updated_by: by,
    done_at: '', done_by: '', done_note: ''
  };
}

function taskCreateText_(t) {
  return '#' + t.seq + ' ' + t.title + ' (' + (t.owner || 'no owner') + (t.due_date ? ', due ' + t.due_date : '') + (t.needs_stop ? ', needs a stop' : '') + ')';
}

/**
 * New task rows (and their task_create history) for an action that has `existing` tasks. skipSteps: a task whose
 * template_step the action already has is left out (applyTemplate, merged createAction).
 */
function buildTaskRows_(actionId, existing, inputs, by, stamp, skipSteps) {
  var seq = existing.reduce(function (m, t) { return Math.max(m, t.seq || 0); }, 0);
  var have = {};
  existing.forEach(function (t) { if (t.template_step) have[t.template_step] = true; });
  var rows = [], logs = [];
  inputs.forEach(function (c) {
    if (skipSteps && c.template_step && have[c.template_step]) return;
    if (c.template_step) have[c.template_step] = true;
    var row = newTaskRow_(actionId, ++seq, c, by, stamp);
    rows.push(row);
    logs.push(taskLogRow_(actionId, row.task_id, by, 'task_create', '', 'Open', taskCreateText_(row), stamp));
  });
  if (existing.length + rows.length > TASKS_PER_ACTION_MAX_) throw apiError_(ERR.BAD_REQUEST, 'An action can have at most ' + TASKS_PER_ACTION_MAX_ + ' tasks.');
  return { rows: rows, logs: logs };
}

/** The action status the tasks set, as a patch and a history row; null when it does not change. */
function followTasks_(row, tasks, by, stamp) {
  var to = deriveActionStatus_(row.status, tasks);
  if (to === row.status) return null;
  return {
    from: row.status, to: to,
    log: actionLogRow_(row.action_id, by, 'status', row.status, to, to === 'In progress' ? 'Follows the tasks: a task has started' : 'Follows the tasks: no task has started', stamp)
  };
}

// ---------- templates ----------

/** Every template with its steps, by sort order and name ([] before ensureSchema has made the sheets). */
function readTemplates_() {
  var steps = {};
  optionalTable_(T.TASK_TEMPLATE_STEPS).forEach(function (s) {
    (steps[s.template_id] = steps[s.template_id] || []).push({
      seq: s.seq, title: s.title, default_owner: s.default_owner, due_offset_days: s.due_offset_days === null ? 0 : s.due_offset_days,
      needs_stop: !!s.needs_stop, est_stop_h: s.needs_stop && s.est_stop_h !== null ? s.est_stop_h : null
    });
  });
  return optionalTable_(T.TASK_TEMPLATES).map(function (t) {
    return {
      template_id: t.template_id, name: t.name, applies_to: csv_(t.applies_to), active: !!t.active, sort_order: t.sort_order === null ? 0 : t.sort_order,
      updated_at: t.updated_at, updated_by: t.updated_by,
      steps: (steps[t.template_id] || []).sort(function (a, b) { return a.seq - b.seq; })
    };
  }).sort(function (a, b) { return (a.sort_order - b.sort_order) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.template_id < b.template_id ? -1 : 1); });
}

/** The active template an action source gets first (lowest sort order), or null. */
function templateForSource_(templates, source) {
  return templates.filter(function (t) { return t.active && t.applies_to.indexOf(source) >= 0; })[0] || null;
}

/** Owner of a template step for an action in `areaId`: the area's contractor, or the named active contractor or team. */
function stepOwner_(step, areaId, contractors) {
  var c = null;
  if (step.default_owner === AREA_CONTRACTOR_) c = contractorForArea_(contractors, areaId);
  else c = contractors.filter(function (x) { return x.contractor_id === step.default_owner && x.active; })[0] || null;
  return c ? { owner: c.contractor_id, owner_kind: c.kind, assignee: c.default_assignee || '' } : { owner: '', owner_kind: 'internal', assignee: '' };
}

/** Task inputs from a template's steps, due counted from `today`. */
function templateTaskInputs_(tmpl, areaId, contractors, today) {
  return tmpl.steps.map(function (s) {
    var o = stepOwner_(s, areaId, contractors);
    return {
      title: s.title, owner: o.owner, owner_kind: o.owner_kind, assignee: o.assignee, due_date: addDays_(today, s.due_offset_days || 0),
      needs_stop: !!s.needs_stop, est_stop_h: s.needs_stop ? s.est_stop_h : null, notes: '', template_step: s.title
    };
  });
}

// ---------- ready to close (the notification follows the tasks at once) ----------

function readyCandidate_(action, tasks) {
  if (action.status === 'Draft' || isTerminal_(action.status) || !tasks.length || tasks.some(isTaskOpen_)) return null;
  var n = tasks.length;
  var notNeeded = tasks.filter(function (t) { return t.status === 'Not needed'; }).length;
  var c = notifCandidate_('action_ready_to_close', 'ready|' + action.action_id + '|' + n,
    'Ready to close: ' + action.action_id + ' - ' + oneLine_(action.title, 120),
    'All ' + n + ' task' + (n === 1 ? '' : 's') + ' done or not needed (' + (n - notNeeded) + ' done, ' + notNeeded + ' not needed). ' +
      'Only the people on the "Who can close actions" list can close it.',
    action.area_id, action.line_id, action.action_id);
  c.recipients = '@closers';
  return c;
}

/**
 * Creates, re-opens or resolves the action's action_ready_to_close notification right after a task or status change.
 * Caller holds the lock. Never throws (a notification cannot fail the change it follows).
 */
function syncReadyToClose_(action, tasks) {
  try {
    if (!getSpreadsheet_().getSheetByName(T.NOTIFICATIONS)) return;
    var cand = readyCandidate_(action, tasks);
    var rows = readTable_(T.NOTIFICATIONS, function (row, idx) {
      return row[idx.type] === 'action_ready_to_close' && row[idx.source_ref] === action.action_id;
    });
    var st = notifSettings_();
    var nowMs = nowMs_();
    var stamp = fmtTsMs_(nowMs);
    rows.forEach(function (r) {
      if (r.status === 'open' && (!cand || r.dedupe_key !== cand.dedupe_key)) updateRow_(T.NOTIFICATIONS, r._row, { status: 'resolved', resolved_at: stamp });
    });
    if (!cand) return;
    var ex = rows.filter(function (r) { return r.dedupe_key === cand.dedupe_key; })[0];
    if (!ex) appendRow_(T.NOTIFICATIONS, notifRowFrom_(cand, st, nowMs));
    else if (ex.status === 'resolved') {
      updateRow_(T.NOTIFICATIONS, ex._row, { status: 'open', resolved_at: '', expires_at: fmtTsMs_(nowMs + st.retentionDays * MS_DAY_) });
    }
  } catch (err) {
    notifLogFailure_('ready to close', err);
  }
}

// ---------- notification rules (called by notifCandidates_) ----------

/** The people a task's overdue alert goes to: its person and the action owner; the closers when neither is set. */
function taskRecipients_(task, action) {
  var out = [];
  [task.assignee, action.assignee].forEach(function (p) { if (p && out.indexOf(p) < 0) out.push(p); });
  return out.length ? out.join(',') : '@closers';
}

/** task_overdue: an open task of an accepted, open action whose due date is before today (plant date). */
function notifRuleTaskOverdue_(ctx, actions, byAction) {
  var out = [];
  actions.filter(function (a) { return a.status !== 'Draft' && !isTerminal_(a.status); })
    .sort(function (a, b) { return a.action_id < b.action_id ? -1 : 1; })
    .forEach(function (a) {
      (byAction[a.action_id] || []).forEach(function (t) {
        if (!isTaskOpen_(t) || !t.due_date || !isValidDate_(t.due_date) || !(t.due_date < ctx.today)) return;
        var days = Math.round((dateMs_(ctx.today) - dateMs_(t.due_date)) / MS_DAY_);
        var c = notifCandidate_('task_overdue', 'task_due|' + t.task_id + '|' + t.due_date,
          'Task overdue: ' + a.action_id + ' - ' + oneLine_(t.title, 120),
          'Due ' + t.due_date + ', ' + days + ' day' + (days === 1 ? '' : 's') + ' ago. Task ' + t.seq + ' of ' + a.action_id + ', status ' + t.status +
            ', owner ' + (t.owner || 'nobody yet') + ', person ' + (t.assignee || 'nobody yet') + '.',
          a.area_id, a.line_id, a.action_id);
        c.recipients = taskRecipients_(t, a);
        out.push(c);
      });
    });
  return out;
}

/** action_ready_to_close for every accepted, open action whose tasks are all done or not needed. */
function notifRuleReady_(actions, byAction) {
  var out = [];
  actions.slice().sort(function (a, b) { return a.action_id < b.action_id ? -1 : 1; }).forEach(function (a) {
    var c = readyCandidate_(a, byAction[a.action_id] || []);
    if (c) out.push(c);
  });
  return out;
}

// ---------- calls ----------

function findTaskOrThrow_(taskId) {
  var id = cleanText_(taskId, 'Task', true, 40);
  var t = optionalTable_(T.ACTION_TASKS).filter(function (r) { return r.task_id === id; })[0];
  if (!t) throw apiError_(ERR.NOT_FOUND, 'Task not found.');
  return t;
}

/** { action, tasks, logs } of one action as stored now (plus `task` and `added` when given). */
function taskResult_(row, taskId, added) {
  var tasks = tasksOfAction_(row.action_id);
  var out = { action: actionOut_(row, tasks), tasks: tasks.map(taskOut_), logs: actionLogsOf_(row.action_id) };
  if (taskId) out.task = taskOut_(tasks.filter(function (t) { return t.task_id === taskId; })[0]);
  if (added !== undefined) out.added = added;
  return out;
}

/** Writes new tasks, lets the action follow, syncs the ready notification. Caller holds the lock. Returns the follow result. */
function storeNewTasks_(row, existing, built, by, stamp, extraPatch) {
  appendRows_(T.ACTION_TASKS, built.rows);
  var all = existing.concat(built.rows);
  var logs = built.logs.slice();
  var f = followTasks_(row, all, by, stamp);
  var patch = { updated_at: stamp, updated_by: by };
  Object.keys(extraPatch || {}).forEach(function (k) { patch[k] = extraPatch[k]; });
  if (f) { patch.status = f.to; logs.push(f.log); }
  updateRow_(T.ACTIONS, row._row, patch);
  appendRows_(T.ACTION_LOG, logs);
  Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
  syncReadyToClose_(row, all);
  return f;
}

/** addTask: one new task (Open) on an action that is not closed or cancelled. */
function addTask_(session, actionId, task) {
  var uid = session.user.user_id;
  return withLock_(function () {
    var stamp = nowTs_();
    var row = findActionOrThrow_(actionId);
    if (isTerminal_(row.status)) throw apiError_(ERR.BAD_REQUEST, 'The action is ' + row.status.toLowerCase() + ': reopen it before adding tasks.');
    var c = cleanTaskInput_(task, actionMasterCtx_());
    var existing = tasksOfAction_(row.action_id);
    var built = buildTaskRows_(row.action_id, existing, [c], uid, stamp, false);
    var f = storeNewTasks_(row, existing, built, uid, stamp);
    var t = built.rows[0];
    auditLog_(uid, 'create_task', T.ACTION_TASKS, t.task_id, row.action_id + ': ' + taskCreateText_(t) + (f ? '. Action status: ' + f.from + ' -> ' + f.to : ''));
    return taskResult_(row, t.task_id);
  });
}

/**
 * updateTask: changes one task. Done needs a note (what was done), Not needed a reason (3+ characters); Contractor informed only
 * for an external contractor's task. On a closed or cancelled action only a note may be added.
 */
function updateTask_(session, taskId, changes) {
  requireObject_(changes, 'Changes');
  onlyKeys_(changes, TASK_CHANGE_FIELDS_, 'Changes');
  if (!Object.keys(changes).length) throw apiError_(ERR.BAD_REQUEST, 'No changes to save.');
  var uid = session.user.user_id;
  return withLock_(function () {
    var stamp = nowTs_();
    var task = findTaskOrThrow_(taskId);
    var row = findActionOrThrow_(task.action_id);
    var has = function (k) { return Object.prototype.hasOwnProperty.call(changes, k); };
    if (isTerminal_(row.status) && Object.keys(changes).some(function (k) { return k !== 'note'; })) {
      throw apiError_(ERR.BAD_REQUEST, 'The action is ' + row.status.toLowerCase() + ': reopen it before changing its tasks. A note can still be added.');
    }
    var next = {};
    if (has('title')) next.title = cleanText_(changes.title, 'Task title', true, TASK_TITLE_MAX_);
    if (has('assignee')) next.assignee = cleanText_(changes.assignee, 'Person', false, 100);
    if (has('due_date')) next.due_date = cleanDue_(changes.due_date);
    if (has('notes')) next.notes = cleanText_(changes.notes, 'Task notes', false, ACTION_LONG_TEXT_MAX_);
    if (has('owner')) {
      var ow = cleanOwner_(changes.owner, actionMasterCtx_());
      next.owner = ow.owner;
      next.owner_kind = ow.owner_kind;
    }
    if (has('needs_stop')) next.needs_stop = cleanNeedsStop_(changes.needs_stop);
    if (has('est_stop_h')) next.est_stop_h = cleanEstStop_(changes.est_stop_h);
    var to = has('status') ? pickEnum_(changes.status, taskEnum_('status'), 'Task status') : task.status;
    var note = has('note') ? cleanText_(changes.note, 'Note', false, ACTION_LONG_TEXT_MAX_) : '';
    var ownerKind = next.owner_kind !== undefined ? next.owner_kind : task.owner_kind;
    var from = task.status;
    if (to === 'Contractor informed' && ownerKind !== 'contractor') {
      throw apiError_(ERR.BAD_REQUEST, 'Contractor informed is only for a task owned by an external contractor.');
    }
    if (to !== from && to === 'Done' && note.length < TASK_NOTE_MIN_) throw apiError_(ERR.BAD_REQUEST, 'Write what was done (at least ' + TASK_NOTE_MIN_ + ' characters).');
    if (to !== from && to === 'Not needed' && note.length < TASK_NOTE_MIN_) throw apiError_(ERR.BAD_REQUEST, 'Write why the task is not needed (at least ' + TASK_NOTE_MIN_ + ' characters).');
    var needsAfter = next.needs_stop !== undefined ? next.needs_stop : !!task.needs_stop;
    var estBefore = taskOut_(task).est_stop_h;
    if (has('needs_stop') || has('est_stop_h')) next.est_stop_h = needsAfter ? (has('est_stop_h') ? next.est_stop_h : estBefore) : null;

    var patch = {}, edits = [];
    ['title', 'owner', 'assignee', 'due_date', 'needs_stop', 'est_stop_h', 'notes'].forEach(function (k) {
      if (next[k] === undefined) return;
      var old = k === 'est_stop_h' ? estBefore : task[k];
      if (next[k] === old) return;
      patch[k] = k === 'est_stop_h' && next[k] === null ? '' : next[k];
      if (k === 'owner') patch.owner_kind = next.owner_kind;
      edits.push(k === 'title' || k === 'notes' ? k + ' changed' : k + ': ' + logValue_(old) + ' -> ' + logValue_(next[k]));
    });
    var logs = [];
    if (to !== from) {
      patch.status = to;
      if (TASK_CLOSED_.indexOf(to) >= 0) { patch.done_at = stamp; patch.done_by = uid; patch.done_note = note; }
      else if (TASK_CLOSED_.indexOf(from) >= 0) { patch.done_at = ''; patch.done_by = ''; patch.done_note = ''; }
      logs.push(taskLogRow_(row.action_id, task.task_id, uid, 'task_status', from, to, note, stamp));
    } else if (note) {
      logs.push(taskLogRow_(row.action_id, task.task_id, uid, 'task_note', '', '', note, stamp));
    }
    if (edits.length) logs.push(taskLogRow_(row.action_id, task.task_id, uid, 'task_edit', '', '', '#' + task.seq + ' ' + edits.join('; '), stamp));
    if (!logs.length) throw apiError_(ERR.BAD_REQUEST, 'Nothing was changed.');
    patch.updated_at = stamp;
    patch.updated_by = uid;
    updateRow_(T.ACTION_TASKS, task._row, patch);
    Object.keys(patch).forEach(function (k) { task[k] = patch[k]; });

    var all = tasksOfAction_(row.action_id).map(function (t) { return t.task_id === task.task_id ? task : t; });
    var f = followTasks_(row, all, uid, stamp);
    var apatch = { updated_at: stamp, updated_by: uid };
    if (f) { apatch.status = f.to; logs.push(f.log); }
    updateRow_(T.ACTIONS, row._row, apatch);
    appendRows_(T.ACTION_LOG, logs);
    Object.keys(apatch).forEach(function (k) { row[k] = apatch[k]; });
    syncReadyToClose_(row, all);

    var said = [];
    if (to !== from) said.push('status: ' + from + ' -> ' + to + (note ? ' (' + auditValue_(note, 80) + ')' : ''));
    else if (note) said.push('note: ' + auditValue_(note, 160));
    if (edits.length) said.push(edits.join('; '));
    if (f) said.push('action status: ' + f.from + ' -> ' + f.to);
    auditLog_(uid, 'update_task', T.ACTION_TASKS, task.task_id, row.action_id + ' #' + task.seq + ': ' + said.join('; '));
    return taskResult_(row, task.task_id);
  });
}

/** applyTemplate: adds the template's steps the action does not have yet (by template_step), due from today. */
function applyTemplate_(session, actionId, templateId) {
  var uid = session.user.user_id;
  var tid = cleanText_(templateId, 'Template', true, 40);
  return withLock_(function () {
    var stamp = nowTs_();
    var row = findActionOrThrow_(actionId);
    if (isTerminal_(row.status)) throw apiError_(ERR.BAD_REQUEST, 'The action is ' + row.status.toLowerCase() + ': reopen it before adding tasks.');
    var tmpl = readTemplates_().filter(function (t) { return t.template_id === tid; })[0];
    if (!tmpl) throw apiError_(ERR.NOT_FOUND, 'Task template not found.');
    if (!tmpl.active) throw apiError_(ERR.BAD_REQUEST, 'The template "' + tmpl.name + '" is switched off.');
    var existing = tasksOfAction_(row.action_id);
    var inputs = templateTaskInputs_(tmpl, row.area_id, optionalTable_(T.CONTRACTORS), stamp.slice(0, 10));
    var built = buildTaskRows_(row.action_id, existing, inputs, uid, stamp, true);
    if (!built.rows.length) return taskResult_(row, '', 0);
    var f = storeNewTasks_(row, existing, built, uid, stamp, row.template_id ? {} : { template_id: tmpl.template_id });
    auditLog_(uid, 'apply_template', T.ACTIONS, row.action_id, 'Template ' + tmpl.name + ': ' + built.rows.length + ' task' + (built.rows.length === 1 ? '' : 's') +
      ' added (' + built.rows.map(function (t) { return t.title; }).join(', ') + ')' + (f ? '. Action status: ' + f.from + ' -> ' + f.to : ''));
    return taskResult_(row, '', built.rows.length);
  });
}

function cleanTaskFilter_(filter) {
  var f = filter === undefined || filter === null ? {} : filter;
  requireObject_(f, 'Filter');
  onlyKeys_(f, TASK_FILTER_FIELDS_, 'Filter');
  ['mine', 'overdue', 'needs_stop', 'include_drafts'].forEach(function (k) {
    if (f[k] !== undefined && f[k] !== null && typeof f[k] !== 'boolean') throw apiError_(ERR.BAD_REQUEST, 'Filter ' + k + ' must be true or false.');
  });
  var status = f.status === undefined || f.status === null || f.status === '' ? 'open' : f.status;
  if (Array.isArray(status)) {
    var allowed = taskEnum_('status');
    status.forEach(function (s) { if (allowed.indexOf(s) < 0) throw apiError_(ERR.BAD_REQUEST, 'Filter status must be one of: ' + allowed.join(', ') + '.'); });
  } else if (['open', 'closed', 'all'].indexOf(status) < 0) {
    throw apiError_(ERR.BAD_REQUEST, 'Filter status must be open, closed, all or a list of task statuses.');
  }
  var out = { mine: f.mine === true, overdue: f.overdue === true, needs_stop: f.needs_stop === true, include_drafts: f.include_drafts === true, status: status };
  ['owner', 'assignee', 'area_id', 'line_id', 'action_id'].forEach(function (k) { out[k] = cleanText_(f[k] === null ? '' : f[k], 'Filter ' + k, false, 100); });
  out.done_since = cleanText_(f.done_since === null ? '' : f.done_since, 'Filter done_since', false, 20);
  if (out.done_since && !isValidDate_(out.done_since)) throw apiError_(ERR.BAD_REQUEST, 'Filter done_since must be a date like 2026-07-01.');
  return out;
}

/** listTasks: tasks across the actions, filtered (see TaskFilter in src/api/types.ts), overdue first, then by due date. */
function listTasks_(session, filter) {
  var f = cleanTaskFilter_(filter);
  var today = plantToday_();
  var actions = {};
  optionalTable_(T.ACTIONS).forEach(function (a) { actions[a.action_id] = a; });
  var waiting = {};
  optionalTable_(T.ACTION_LOG).forEach(function (l) {
    if (l.kind === 'task_status' && l.to_status === 'Waiting stoppage' && l.task_id && !(waiting[l.task_id] > l.at)) waiting[l.task_id] = l.at;
  });
  var uid = session.user.user_id;
  var out = [];
  readAllTasks_().forEach(function (t) {
    var a = actions[t.action_id];
    if (!a || a.status === 'Cancelled' || (a.status === 'Draft' && !f.include_drafts)) return;
    var open = isTaskOpen_(t);
    if (f.status === 'open' && !open) return;
    if (f.status === 'closed' && open) return;
    if (Array.isArray(f.status) && f.status.indexOf(t.status) < 0) return;
    var overdue = open && !!t.due_date && t.due_date < today;
    if (f.mine && t.assignee !== uid) return;
    if (f.overdue && !overdue) return;
    if (f.needs_stop && !t.needs_stop) return;
    if (f.owner && t.owner !== f.owner) return;
    if (f.assignee && t.assignee !== f.assignee) return;
    if (f.area_id && a.area_id !== f.area_id) return;
    if (f.line_id && a.line_id !== f.line_id) return;
    if (f.action_id && t.action_id !== f.action_id) return;
    if (f.done_since && !(String(t.done_at).slice(0, 10) >= f.done_since)) return;
    var v = taskOut_(t);
    v.action_title = a.title;
    v.action_status = a.status;
    v.action_assignee = a.assignee;
    v.action_owner = a.owner;
    v.area_id = a.area_id;
    v.line_id = a.line_id;
    v.equipment_id = a.equipment_id;
    v.overdue = overdue;
    v.waiting_since = t.status === 'Waiting stoppage' ? (waiting[t.task_id] || t.updated_at) : '';
    out.push(v);
  });
  out.sort(function (a, b) {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.due_date !== b.due_date) return !a.due_date ? 1 : !b.due_date ? -1 : a.due_date < b.due_date ? -1 : 1;
    return byTask_(a, b);
  });
  return { tasks: out, today: today };
}

function listTaskTemplates_() { return readTemplates_(); }

function cleanTemplateStep_(s, mctx, label) {
  if (!plainObject_(s)) throw apiError_(ERR.BAD_REQUEST, label + ': each task must be an object.');
  onlyKeys_(s, ['seq', 'title', 'default_owner', 'due_offset_days', 'needs_stop', 'est_stop_h'], label + ': a task');
  var title = cleanText_(s.title, label + ': task title', true, TASK_TITLE_MAX_);
  var owner = cleanText_(s.default_owner, label + ': default owner', true, 40);
  if (owner !== AREA_CONTRACTOR_) {
    var c = mctx.contractors[owner];
    if (!c || !c.active) throw apiError_(ERR.BAD_REQUEST, label + ': default owner "' + oneLine_(owner, 40) + '" is not area_contractor or an active contractor or team.');
  }
  var days = s.due_offset_days === undefined || s.due_offset_days === null ? 0 : s.due_offset_days;
  if (typeof days !== 'number' || days % 1 !== 0 || days < 0 || days > 365) throw apiError_(ERR.BAD_REQUEST, label + ': due after must be a whole number of days from 0 to 365.');
  var needs = cleanNeedsStop_(s.needs_stop);
  var est = cleanEstStop_(s.est_stop_h);
  return { title: title, default_owner: owner, due_offset_days: days, needs_stop: needs, est_stop_h: needs ? est : null };
}

/**
 * saveTaskTemplates: inserts or updates the templates sent (template_id blank = new) and replaces their steps. Names are unique;
 * an action source belongs to at most one active template. Templates are never deleted (switch one off). Returns all.
 */
function saveTaskTemplates_(session, list) {
  if (!Array.isArray(list) || !list.length) throw apiError_(ERR.BAD_REQUEST, 'Send at least one template.');
  if (list.length > TEMPLATES_MAX_) throw apiError_(ERR.BAD_REQUEST, 'At most ' + TEMPLATES_MAX_ + ' templates at once.');
  var mctx = actionMasterCtx_();
  var sources = actionEnum_('source');
  var seenIds = {};
  var clean = list.map(function (t) {
    if (!plainObject_(t)) throw apiError_(ERR.BAD_REQUEST, 'Each template must be an object.');
    onlyKeys_(t, ['template_id', 'name', 'applies_to', 'active', 'sort_order', 'steps', 'updated_at', 'updated_by'], 'A template');
    var id = cleanText_(t.template_id === null ? '' : t.template_id, 'Template id', false, 40);
    if (id && !/^TT-[A-Za-z0-9_-]{1,37}$/.test(id)) throw apiError_(ERR.BAD_REQUEST, 'A template id must look like TT-REPEAT.');
    if (id && seenIds[id]) throw apiError_(ERR.BAD_REQUEST, 'Template ' + id + ' is listed twice.');
    if (id) seenIds[id] = true;
    var name = cleanText_(t.name, 'Template name', true, 80);
    if (!Array.isArray(t.applies_to)) throw apiError_(ERR.BAD_REQUEST, name + ': "suggested first for" must be a list.');
    var applies = [];
    t.applies_to.forEach(function (s) {
      if (sources.indexOf(s) < 0) throw apiError_(ERR.BAD_REQUEST, name + ': "' + oneLine_(s, 40) + '" is not an action source.');
      if (applies.indexOf(s) < 0) applies.push(s);
    });
    if (typeof t.active !== 'boolean') throw apiError_(ERR.BAD_REQUEST, name + ': active must be true or false.');
    var order = t.sort_order === undefined || t.sort_order === null ? 0 : t.sort_order;
    if (typeof order !== 'number' || order % 1 !== 0 || order < 0 || order > 1000) throw apiError_(ERR.BAD_REQUEST, name + ': sort order must be a whole number from 0 to 1000.');
    if (!Array.isArray(t.steps) || !t.steps.length) throw apiError_(ERR.BAD_REQUEST, name + ': add at least one task.');
    if (t.steps.length > TEMPLATE_STEPS_MAX_) throw apiError_(ERR.BAD_REQUEST, name + ': at most ' + TEMPLATE_STEPS_MAX_ + ' tasks.');
    var titles = {};
    var steps = t.steps.map(function (s) {
      var c = cleanTemplateStep_(s, mctx, name);
      var k = c.title.toLowerCase();
      if (titles[k]) throw apiError_(ERR.BAD_REQUEST, name + ': the task "' + c.title + '" is listed twice.');
      titles[k] = true;
      return c;
    });
    return { template_id: id, name: name, applies_to: applies, active: t.active, sort_order: order, steps: steps };
  });
  var uid = session.user.user_id;
  withLock_(function () {
    var stamp = nowTs_();
    var existing = optionalTable_(T.TASK_TEMPLATES);
    var before = readTemplates_();
    var byId = {};
    existing.forEach(function (r) { byId[r.template_id] = r; });
    clean.forEach(function (c) {
      if (c.template_id && !byId[c.template_id]) throw apiError_(ERR.NOT_FOUND, 'Template ' + c.template_id + ' not found.');
      if (!c.template_id) { do { c.template_id = 'TT-' + randomHex_(8).toUpperCase(); } while (byId[c.template_id]); }
    });
    // the state after saving: names unique, a source in at most one active template
    var after = {};
    before.forEach(function (t) { after[t.template_id] = t; });
    clean.forEach(function (c) { after[c.template_id] = c; });
    var names = {}, owners = {};
    Object.keys(after).sort().forEach(function (id) {
      var t = after[id];
      var k = t.name.toLowerCase();
      if (names[k] && names[k] !== id) throw apiError_(ERR.CONFLICT, 'Two templates would be called "' + t.name + '".');
      names[k] = id;
      if (!t.active) return;
      t.applies_to.forEach(function (s) {
        if (owners[s] && owners[s] !== id) throw apiError_(ERR.CONFLICT, 'Source ' + s + ' would be suggested by both "' + after[owners[s]].name + '" and "' + t.name + '".');
        owners[s] = id;
      });
    });
    var said = [];
    var stepRows = optionalTable_(T.TASK_TEMPLATE_STEPS);
    var drop = [];
    var fresh = [];
    clean.forEach(function (c) {
      var ex = byId[c.template_id];
      var rec = { template_id: c.template_id, name: c.name, applies_to: c.applies_to.join(','), active: c.active, sort_order: c.sort_order, updated_at: stamp, updated_by: uid };
      if (ex) updateRow_(T.TASK_TEMPLATES, ex._row, rec); else appendRow_(T.TASK_TEMPLATES, rec);
      stepRows.forEach(function (s) { if (s.template_id === c.template_id) drop.push(s._row); });
      c.steps.forEach(function (s, i) {
        fresh.push({ template_id: c.template_id, seq: i + 1, title: s.title, default_owner: s.default_owner, due_offset_days: s.due_offset_days,
          needs_stop: s.needs_stop, est_stop_h: s.est_stop_h === null ? '' : s.est_stop_h });
      });
      var stepText = function (list) {
        return list.map(function (s) { return s.title + ' (' + s.default_owner + ', +' + s.due_offset_days + ' d' + (s.needs_stop ? ', stop' + (s.est_stop_h !== null ? ' ' + s.est_stop_h + ' h' : '') : '') + ')'; }).join(', ');
      };
      var old = before.filter(function (t) { return t.template_id === c.template_id; })[0];
      if (!old) {
        said.push(c.template_id + ' added: ' + c.name + ' (' + c.steps.length + ' tasks: ' + stepText(c.steps) + ')');
        return;
      }
      var what = auditChanges_({ name: old.name, applies_to: old.applies_to.join(','), active: old.active, sort_order: old.sort_order },
        { name: c.name, applies_to: c.applies_to.join(','), active: c.active, sort_order: c.sort_order }, ['name', 'applies_to', 'active', 'sort_order'], 80);
      var oldSteps = stepText(old.steps), newSteps = stepText(c.steps);
      if (oldSteps !== newSteps) what = (what ? what + '; ' : '') + 'tasks: ' + auditValue_(oldSteps, 150) + ' -> ' + auditValue_(newSteps, 150);
      if (what) said.push(c.template_id + ' ' + what);
    });
    if (drop.length) deleteRows_(T.TASK_TEMPLATE_STEPS, drop);
    appendRows_(T.TASK_TEMPLATE_STEPS, fresh);
    auditLog_(uid, 'save_task_templates', T.TASK_TEMPLATES, clean.map(function (c) { return c.template_id; }).join(','), said.join('. ') || 'No change');
  });
  return readTemplates_();
}

// ---------- seeding and the 1.7.0 migration (run from the editor through seedDefaults) ----------

/** Adds the seeded templates whose id is missing (with their steps). Never touches an existing template. Caller holds the lock. */
function seedTaskTemplates_(seeds) {
  var ss = getSpreadsheet_();
  if (!ss.getSheetByName(T.TASK_TEMPLATES) || !ss.getSheetByName(T.TASK_TEMPLATE_STEPS)) return 0;
  var have = {};
  readTable_(T.TASK_TEMPLATES).forEach(function (t) { have[t.template_id] = true; });
  var stamp = nowTs_();
  var fresh = (seeds || []).filter(function (t) { return !have[t.template_id]; });
  appendRows_(T.TASK_TEMPLATES, fresh.map(function (t) {
    return { template_id: t.template_id, name: t.name, applies_to: t.applies_to, active: t.active, sort_order: t.sort_order, updated_at: stamp, updated_by: 'setup' };
  }));
  var steps = [];
  fresh.forEach(function (t) {
    t.steps.forEach(function (s, i) {
      steps.push({ template_id: t.template_id, seq: i + 1, title: s.title, default_owner: s.default_owner, due_offset_days: s.due_offset_days,
        needs_stop: !!s.needs_stop, est_stop_h: s.est_stop_h === null || s.est_stop_h === undefined ? '' : s.est_stop_h });
    });
  });
  appendRows_(T.TASK_TEMPLATE_STEPS, steps);
  return fresh.length;
}

/**
 * The 1.7.0 move of the old action statuses to tasks. Runs once (Script Property ACTIONS_TASKS_MIGRATED), from seedDefaults,
 * after ensureSchema has made the action_tasks sheet. Every action in Contractor informed, Waiting stoppage or In progress that
 * has no task yet becomes In progress with ONE task carrying the old status (title from required_action, else the title; owner,
 * person, due date and the stop need from the action; Waiting stoppage also marks the task as needing a stop; Contractor
 * informed on an action owned by an internal team becomes In progress). Draft, Open, Closed and Cancelled stay as they are.
 * Safe to run again: it does nothing once done, and an action that already has tasks is never touched.
 */
function migrateActions_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(PROP.TASKS_MIGRATED)) return { migrated: 0, note: 'already done' };
  var ss = getSpreadsheet_();
  if (!ss.getSheetByName(T.ACTIONS) || !ss.getSheetByName(T.ACTION_TASKS) || !ss.getSheetByName(T.ACTION_LOG)) {
    return { migrated: 0, note: 'Run ensureSchema first, then seedDefaults again.' };
  }
  return withLock_(function () {
    var stamp = nowTs_();
    var have = {};
    readTable_(T.ACTION_TASKS).forEach(function (t) { have[t.action_id] = true; });
    var OLD = ['Contractor informed', 'Waiting stoppage', 'In progress'];
    var rows = [], logs = [], patches = [], said = [];
    readTable_(T.ACTIONS).forEach(function (a) {
      if (OLD.indexOf(a.status) < 0 || have[a.action_id]) return;
      var status = a.status === 'Contractor informed' && !(a.owner && a.owner_kind === 'contractor') ? 'In progress' : a.status;
      var t = newTaskRow_(a.action_id, 1, {
        title: oneLine_(a.required_action || a.title, TASK_TITLE_MAX_) || 'Task', owner: a.owner || '', owner_kind: a.owner ? a.owner_kind : 'internal',
        assignee: a.assignee || '', due_date: isValidDate_(a.due_date) ? a.due_date : '', needs_stop: !!a.needs_stop || a.status === 'Waiting stoppage',
        est_stop_h: null, notes: 'Made from the action status "' + a.status + '" when tasks came in (backend 1.7.0).', template_step: ''
      }, 'system', stamp);
      t.status = status;
      rows.push(t);
      logs.push(taskLogRow_(a.action_id, t.task_id, 'system', 'task_create', '', status, taskCreateText_(t) + ' from the action status ' + a.status, stamp));
      if (a.status !== 'In progress') {
        patches.push({ row: a, patch: { status: 'In progress', updated_at: stamp, updated_by: 'system' } });
        logs.push(actionLogRow_(a.action_id, 'system', 'status', a.status, 'In progress', 'Moved to tasks (backend 1.7.0): the old status is now on task 1', stamp));
      }
      said.push(a.action_id + ' (' + a.status + ')');
    });
    appendRows_(T.ACTION_TASKS, rows);
    patches.forEach(function (p) { updateRow_(T.ACTIONS, p.row._row, p.patch); });
    appendRows_(T.ACTION_LOG, logs);
    if (said.length) auditLog_('setup', 'migrate_actions', T.ACTIONS, '', 'Moved ' + said.length + ' action(s) to tasks: ' + said.join(', '));
    props.setProperty(PROP.TASKS_MIGRATED, stamp);
    return { migrated: said.length, actions: said };
  });
}
