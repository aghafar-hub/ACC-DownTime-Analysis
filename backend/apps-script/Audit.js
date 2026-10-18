/** Append-only audit log. Callers hold the lock. Never write secrets here. */

function auditEntry_(userId, action, entity, entityId, detail) {
  return {
    at: nowTs_(), user_id: userId || '', action: action, entity: entity || '',
    entity_id: entityId || '', detail: String(detail || '').slice(0, 500)
  };
}

function auditLog_(userId, action, entity, entityId, detail) {
  appendRow_(T.AUDIT, auditEntry_(userId, action, entity, entityId, detail));
}

function auditLogMany_(entries) {
  appendRows_(T.AUDIT, entries);
}

/** One value for an audit detail: short, on one line, blank shown as (blank). */
function auditValue_(v, max) {
  if (v === true) return 'yes';
  if (v === false) return 'no';
  var s = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
  if (!s) return '(blank)';
  var m = max || 60;
  return s.length > m ? s.slice(0, m - 1) + '…' : s;
}

/** 'field: old -> new; ...' for the fields of `after` that differ from `before` (fields named in `fields`). */
function auditChanges_(before, after, fields, max) {
  var out = [];
  fields.forEach(function (f) {
    var a = before ? before[f] : undefined;
    var b = after[f];
    if (b === undefined) return;
    if (auditValue_(a, 500) === auditValue_(b, 500)) return;
    out.push(f + ': ' + auditValue_(a, max) + ' -> ' + auditValue_(b, max));
  });
  return out.join('; ');
}

// ---------- reading the log (1.6.0, Admin only) ----------

/**
 * The plain-English groups of the Activity log filter (src/admin/settings/auditText.ts has the same list). An action
 * not listed is in 'system'.
 */
var AUDIT_GROUPS_ = {
  signin: ['login', 'login_failed', 'login_locked', 'login_throttled', 'logout', 'change_password', 'sign_out_everywhere'],
  users: ['create_user', 'update_user', 'reset_password', 'set_tab_access', 'create_first_admin', 'sign_out_user_everywhere'],
  settings: ['save_setting', 'save_contractors', 'save_area_targets', 'save_task_templates'],
  master: ['add_equipment', 'update_equipment', 'add_area', 'update_area', 'add_reason', 'update_reason', 'add_alias', 'update_alias', 'delete_alias'],
  events: ['edit_event', 'void_event', 'unvoid_event', 'accept_event_flags', 'revalidate_events'],
  upload: ['upload_start', 'upload_chunk', 'upload_finish'],
  actions: ['create_action', 'merge_action', 'update_action', 'comment_action', 'action_check', 'create_task', 'update_task', 'apply_template'],
  areas: ['activate_area', 'deactivate_area'],
  notifications: ['notification_check', 'notification_failed', 'digest_sent', 'digest_failed', 'send_report', 'send_test_email'],
  system: ['seed_defaults', 'migrate_actions']
};
var AUDIT_PAGE_DEFAULT_ = 100;
var AUDIT_PAGE_MAX_ = 200;
var AUDIT_BLOCK_ROWS_ = 1000;   // rows read per range call, from the bottom of the sheet up
var AUDIT_SCAN_MAX_ = 20000;    // rows looked at per call; a rare filter continues with the cursor ("Load more")

function auditGroupOf_(action) {
  var keys = Object.keys(AUDIT_GROUPS_);
  for (var i = 0; i < keys.length; i++) if (AUDIT_GROUPS_[keys[i]].indexOf(action) >= 0) return keys[i];
  return 'system';
}

function cleanAuditFilter_(filter) {
  var f = filter === undefined || filter === null ? {} : filter;
  requireObject_(f, 'Filter');
  onlyKeys_(f, ['user_id', 'group', 'from', 'to', 'q', 'limit'], 'Filter');
  var out = { user_id: '', group: '', from: '', to: '', q: '', limit: AUDIT_PAGE_DEFAULT_ };
  if (f.user_id !== undefined && f.user_id !== null && f.user_id !== '') out.user_id = cleanText_(f.user_id, 'User', true, 60);
  if (f.group !== undefined && f.group !== null && f.group !== '') {
    if (!Object.prototype.hasOwnProperty.call(AUDIT_GROUPS_, f.group)) throw apiError_(ERR.BAD_REQUEST, 'Unknown kind of change.');
    out.group = f.group;
  }
  ['from', 'to'].forEach(function (k) {
    if (f[k] === undefined || f[k] === null || f[k] === '') return;
    if (!isValidDate_(f[k])) throw apiError_(ERR.BAD_REQUEST, 'Dates must look like 2026-10-14.');
    out[k] = f[k];
  });
  if (out.from && out.to && out.from > out.to) throw apiError_(ERR.BAD_REQUEST, 'The start date is after the end date.');
  if (f.q !== undefined && f.q !== null) out.q = cleanText_(f.q, 'Search text', false, 100).toLowerCase();
  if (f.limit !== undefined && f.limit !== null) {
    if (typeof f.limit !== 'number' || f.limit % 1 !== 0 || f.limit < 1 || f.limit > AUDIT_PAGE_MAX_) {
      throw apiError_(ERR.BAD_REQUEST, 'Page size must be a whole number from 1 to ' + AUDIT_PAGE_MAX_ + '.');
    }
    out.limit = f.limit;
  }
  return out;
}

/** The last data row whose `at` is on or before `maxAt` (binary search; rows are in time order). 1 when none. */
function auditRowAtOrBefore_(sheet, atCol, top, maxAt) {
  var lo = 2, hi = top, found = 1;
  while (lo <= hi) {
    var mid = Math.floor((lo + hi) / 2);
    var at = fromSheet_(sheet.getRange(mid, atCol).getValue(), 'timestamp');
    if (at <= maxAt) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/**
 * listAuditLog (Admin only): the audit log newest first, filtered on the server, a page at a time. The sheet is only
 * ever appended to in time order, so the newest rows are at the bottom: the server reads blocks of rows from the bottom
 * up and stops as soon as the page is full, so a page costs the same however long the log grows. A date range ending
 * in the past starts with a binary search for its last row; the scan stops at the first row before the start date.
 * The cursor is the sheet row to continue from (rows are never deleted or moved, so it stays valid).
 * Returns { entries, next_cursor, scanned, users }.
 */
function listAuditLog_(filter, cursor) {
  var f = cleanAuditFilter_(filter);
  var startRow = null;
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    var m = /^r(\d{1,9})$/.exec(typeof cursor === 'string' ? cursor : '');
    if (!m) throw apiError_(ERR.BAD_REQUEST, 'The page marker is not valid. Start again from the top.');
    startRow = Number(m[1]);
  }
  var users = readUsers_();
  var names = {};
  users.forEach(function (u) { names[u.user_id] = String(u.display_name || '').toLowerCase(); });
  var groupActions = f.group ? AUDIT_GROUPS_[f.group] : null;
  var minAt = f.from ? f.from + ' 00:00:00.000' : '';
  var maxAt = f.to ? f.to + ' 23:59:59.999' : '';

  var sheet = getSheet_(T.AUDIT);
  var headers = sheetHeaders_(sheet);
  var idx = {};
  headers.forEach(function (h, i) { idx[h] = i; });
  var types = columnTypes_(T.AUDIT);
  var last = sheet.getLastRow();
  var row = startRow === null ? last : Math.min(startRow, last);
  if (maxAt && row >= 2 && idx.at !== undefined) {
    var lastAt = fromSheet_(sheet.getRange(row, idx.at + 1).getValue(), 'timestamp');
    if (lastAt > maxAt) row = auditRowAtOrBefore_(sheet, idx.at + 1, row, maxAt);
  }

  var entries = [], scanned = 0, done = false, next = null;
  while (row >= 2 && !done && entries.length < f.limit && scanned < AUDIT_SCAN_MAX_) {
    var top = Math.max(2, row - AUDIT_BLOCK_ROWS_ + 1);
    var values = sheet.getRange(top, 1, row - top + 1, headers.length).getValues();
    for (var i = values.length - 1; i >= 0; i--) {
      var rowNum = top + i;
      if (scanned >= AUDIT_SCAN_MAX_ || entries.length >= f.limit) { next = rowNum; done = true; break; }
      scanned++;
      var e = rowToObject_(types, headers, values[i], rowNum);
      if (!e.at && !e.action) continue;
      if (minAt && e.at < minAt) { done = true; break; }
      if (maxAt && e.at > maxAt) continue;
      if (f.user_id && e.user_id !== f.user_id) continue;
      if (groupActions && (f.group === 'system' ? auditGroupOf_(e.action) !== 'system' : groupActions.indexOf(e.action) < 0)) continue;
      if (f.q) {
        var hay = [e.action, e.entity, e.entity_id, e.detail, e.user_id, names[e.user_id] || ''].join(' ').toLowerCase();
        if (hay.indexOf(f.q) < 0) continue;
      }
      entries.push({
        at: e.at, user_id: e.user_id, action: e.action, entity: e.entity, entity_id: e.entity_id, detail: e.detail,
        group: auditGroupOf_(e.action)
      });
    }
    row = top - 1;
  }
  if (!done && row >= 2) next = row;
  return {
    entries: entries, next_cursor: next !== null && next >= 2 ? 'r' + next : null, scanned: scanned,
    users: users.map(function (u) { return { user_id: u.user_id, display_name: u.display_name }; })
  };
}
