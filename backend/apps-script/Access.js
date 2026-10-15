/**
 * Tab access (Hidden < View < Edit), role defaults with per-user overrides,
 * and the one table that says what each action needs (docs/wire-protocol.md section 3).
 */

/**
 * auth: 'none' (no session), 'session' (any valid session), 'anyTab' (at least
 * one tab not Hidden), 'tabs' (one of `tabs` at `level` or above), 'admin' (the
 * Admin role, ROLE-ADMIN; 1.5.0).
 * mustChangeOk: allowed while the user still has a temporary password.
 */
var ACTION_RULES = {
  login: { auth: 'none' },
  changePassword: { auth: 'session', mustChangeOk: true },
  getMyAccess: { auth: 'session', mustChangeOk: true },
  getStartup: { auth: 'anyTab' },
  getEvents: { auth: 'tabs', tabs: ['overview', 'pareto', 'repeats', 'reliability', 'reports', 'actions', 'events'], level: 'View' },
  getEventEdits: { auth: 'tabs', tabs: ['events'], level: 'View' },
  getUploadHistory: { auth: 'tabs', tabs: ['upload'], level: 'View' },
  getUploadWarnings: { auth: 'tabs', tabs: ['upload'], level: 'View' },
  uploadStart: { auth: 'tabs', tabs: ['upload'], level: 'Edit' },
  uploadChunk: { auth: 'tabs', tabs: ['upload'], level: 'Edit' },
  uploadFinish: { auth: 'tabs', tabs: ['upload'], level: 'Edit' },
  revalidateEvents: { auth: 'tabs', tabs: ['events'], level: 'Edit' },
  editEvent: { auth: 'tabs', tabs: ['events'], level: 'Edit' },
  voidEvent: { auth: 'tabs', tabs: ['events'], level: 'Edit' },
  acceptEventFlags: { auth: 'tabs', tabs: ['events'], level: 'Edit' },
  saveEquipment: { auth: 'tabs', tabs: ['master'], level: 'Edit' },
  saveArea: { auth: 'tabs', tabs: ['master'], level: 'Edit' },
  // 1.5.0: only the Admin role (ROLE-ADMIN), whatever the tab access says.
  setAreaActive: { auth: 'admin' },
  saveReason: { auth: 'tabs', tabs: ['master'], level: 'Edit' },
  saveAlias: { auth: 'tabs', tabs: ['master'], level: 'Edit' },
  deleteAlias: { auth: 'tabs', tabs: ['master'], level: 'Edit' },
  saveSettings: { auth: 'tabs', tabs: ['settings'], level: 'Edit' },
  listUsers: { auth: 'tabs', tabs: ['users'], level: 'View' },
  createUser: { auth: 'tabs', tabs: ['users'], level: 'Edit' },
  updateUser: { auth: 'tabs', tabs: ['users'], level: 'Edit' },
  resetPassword: { auth: 'tabs', tabs: ['users'], level: 'Edit' },
  setUserTabAccess: { auth: 'tabs', tabs: ['users'], level: 'Edit' },
  // Notifications: any signed-in user, and only their own state and preferences (see Notifications.js).
  getNotifications: { auth: 'session' },
  setNotificationState: { auth: 'session' },
  saveNotificationPrefs: { auth: 'session' },
  runNotificationChecks: { auth: 'tabs', tabs: ['settings'], level: 'Edit' },
  // Actions (Actions.js). Closing and cancelling also need the caller in actions_closers or an Admin (checked in the handler).
  listActions: { auth: 'tabs', tabs: ['actions'], level: 'View' },
  createAction: { auth: 'tabs', tabs: ['actions'], level: 'Edit' },
  updateAction: { auth: 'tabs', tabs: ['actions'], level: 'Edit' },
  addActionComment: { auth: 'tabs', tabs: ['actions'], level: 'Edit' },
  saveContractors: { auth: 'tabs', tabs: ['settings'], level: 'Edit' },
  getAreaTargets: { auth: 'session' },
  saveAreaTargets: { auth: 'tabs', tabs: ['settings'], level: 'Edit' },
  runActionChecks: { auth: 'tabs', tabs: ['settings'], level: 'Edit' },
  // 1.7.0: anyone with Edit on actions works the tasks; the templates are part of Settings.
  addTask: { auth: 'tabs', tabs: ['actions'], level: 'Edit' },
  updateTask: { auth: 'tabs', tabs: ['actions'], level: 'Edit' },
  applyTemplate: { auth: 'tabs', tabs: ['actions'], level: 'Edit' },
  listTasks: { auth: 'tabs', tabs: ['actions'], level: 'View' },
  listTaskTemplates: { auth: 'session' },
  saveTaskTemplates: { auth: 'tabs', tabs: ['settings'], level: 'Edit' },
  // 1.6.0: signing out is logged; who is online and the change log are for the Admin role only.
  logout: { auth: 'session', mustChangeOk: true },
  listActiveUsers: { auth: 'admin' },
  listAuditLog: { auth: 'admin' }
};

function levelRank_(level) { return LEVELS.indexOf(level); }

function isLevel_(v) { return LEVELS.indexOf(v) >= 0; }

/** Access map for a user: user override, else role row, else Hidden. */
function computeAccess_(user, accessRows) {
  var access = {};
  TAB_IDS.forEach(function (tab) { access[tab] = 'Hidden'; });
  accessRows.forEach(function (r) {
    if (r.subject_type === 'role' && r.subject_id === user.role_id && isLevel_(r.level) && TAB_IDS.indexOf(r.tab_id) >= 0) access[r.tab_id] = r.level;
  });
  accessRows.forEach(function (r) {
    if (r.subject_type === 'user' && r.subject_id === user.user_id && isLevel_(r.level) && TAB_IDS.indexOf(r.tab_id) >= 0) access[r.tab_id] = r.level;
  });
  return access;
}

function userOverrides_(userId, accessRows) {
  var o = {};
  accessRows.forEach(function (r) {
    if (r.subject_type === 'user' && r.subject_id === userId && isLevel_(r.level) && TAB_IDS.indexOf(r.tab_id) >= 0) o[r.tab_id] = r.level;
  });
  return o;
}

function accessAllows_(rule, access, user) {
  if (rule.auth === 'none' || rule.auth === 'session') return true;
  if (rule.auth === 'admin') return !!user && user.role_id === 'ROLE-ADMIN';
  if (rule.auth === 'anyTab') return TAB_IDS.some(function (t) { return access[t] !== 'Hidden'; });
  var need = levelRank_(rule.level);
  return rule.tabs.some(function (t) { return levelRank_(access[t]) >= need; });
}

function requireAccess_(action, access, user) {
  var rule = ACTION_RULES[action];
  if (!rule || !accessAllows_(rule, access, user)) throw apiError_(ERR.FORBIDDEN, 'You do not have access to do this.');
}
