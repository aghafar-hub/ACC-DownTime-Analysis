/** User administration. Passwords never leave the server except the one-time temp password. */

var EMAIL_PATTERN_ = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function adminUser_(u, accessRows) {
  var a = publicUser_(u);
  a.active = u.active;
  a.must_change = u.must_change;
  a.last_login_at = u.last_login_at || undefined;
  a.overrides = userOverrides_(u.user_id, accessRows);
  return a;
}

function listUsers_() {
  var rows = readTable_(T.TAB_ACCESS);
  return readUsers_().map(function (u) { return adminUser_(u, rows); });
}

function requireRole_(roleId) {
  if (!findBy_(T.ROLES, 'role_id', roleId)) throw apiError_(ERR.BAD_REQUEST, 'That role does not exist.');
}

function userOrThrow_(userId) {
  var u = typeof userId === 'string' ? findUserById_(userId) : null;
  if (!u) throw apiError_(ERR.NOT_FOUND, 'User not found.');
  return u;
}

/**
 * 1.10.0: only an Admin manages Admins. A person with Edit on the Users tab who is not an Admin may not create an Admin,
 * give the Admin role, or change, reset, sign out or set the access of an Admin. `what` ends the sentence.
 */
function requireAdminFor_(session, isAdminTarget, what) {
  if (isAdminTarget && session.user.role_id !== 'ROLE-ADMIN') {
    throw apiError_(ERR.FORBIDDEN, 'Only an Admin can ' + what + '.');
  }
}

function activeAdminCount_(exceptUserId) {
  return readUsers_().filter(function (u) {
    return u.active && u.role_id === 'ROLE-ADMIN' && u.user_id !== exceptUserId;
  }).length;
}

/** Insert a user row (caller holds the lock). Returns the stored row. */
function insertUser_(email, displayName, roleId, tempPassword, createdBy) {
  var c = newCredentials_(tempPassword);
  var row = {
    user_id: newId_('U-', 12), email: email, display_name: displayName, role_id: roleId,
    password_hash: c.password_hash, password_salt: c.password_salt, hash_rounds: c.hash_rounds,
    must_change: true, active: true, failed_attempts: 0, locked_until: '',
    created_at: nowTs_(), last_login_at: '', created_by: createdBy
  };
  appendRow_(T.USERS, row);
  return row;
}

function createUser_(session, u) {
  requireObject_(u, 'User details');
  var email = normEmail_(u.email);
  if (!EMAIL_PATTERN_.test(email) || email.length > 200) throw apiError_(ERR.BAD_REQUEST, 'Enter a valid email address.');
  var name = cleanText_(u.display_name, 'Name', true, 100);
  var roleId = cleanText_(u.role_id, 'Role', true, 50);
  requireRole_(roleId);
  requireAdminFor_(session, roleId === 'ROLE-ADMIN', 'create an Admin');
  var temp = generateTempPassword_();
  var created = withLock_(function () {
    if (findUserByEmail_(email)) throw apiError_(ERR.CONFLICT, 'A user with this email already exists.');
    var row = insertUser_(email, name, roleId, temp, session.user.user_id);
    auditLog_(session.user.user_id, 'create_user', T.USERS, row.user_id, email + ' as ' + roleId);
    return row;
  });
  notifyUserEvent_('created', session.user, created, 'with role ' + roleId);
  return { user: adminUser_(created, readTable_(T.TAB_ACCESS)), temp_password: temp };
}

function updateUser_(session, userId, changes) {
  requireObject_(changes, 'Changes');
  var patch = {};
  if ('display_name' in changes) patch.display_name = cleanText_(changes.display_name, 'Name', true, 100);
  if ('role_id' in changes) { patch.role_id = cleanText_(changes.role_id, 'Role', true, 50); requireRole_(patch.role_id); }
  if ('active' in changes) {
    if (typeof changes.active !== 'boolean') throw apiError_(ERR.BAD_REQUEST, 'Active must be true or false.');
    patch.active = changes.active;
  }
  if (!Object.keys(patch).length) throw apiError_(ERR.BAD_REQUEST, 'No changes to save.');
  var roleChange = null;
  withLock_(function () {
    var u = userOrThrow_(userId);
    requireAdminFor_(session, u.role_id === 'ROLE-ADMIN', 'change an Admin');
    requireAdminFor_(session, patch.role_id === 'ROLE-ADMIN', 'give the Admin role');
    var willBeAdmin = (patch.role_id || u.role_id) === 'ROLE-ADMIN' && (patch.active === undefined ? u.active : patch.active);
    if (u.role_id === 'ROLE-ADMIN' && u.active && !willBeAdmin && activeAdminCount_(u.user_id) === 0) {
      throw apiError_(ERR.CONFLICT, 'There must be at least one active Admin.');
    }
    if (u.user_id === session.user.user_id && (patch.active === false || (patch.role_id && patch.role_id !== u.role_id))) {
      throw apiError_(ERR.CONFLICT, 'You cannot deactivate yourself or change your own role.');
    }
    if (patch.role_id && patch.role_id !== u.role_id) roleChange = { user: u, from: u.role_id, to: patch.role_id };
    updateRow_(T.USERS, u._row, patch);
    auditLog_(session.user.user_id, 'update_user', T.USERS, u.user_id, auditChanges_(u, patch, ['display_name', 'role_id', 'active']) || 'No change');
  });
  if (roleChange) notifyUserEvent_('role_changed', session.user, roleChange.user, 'from ' + roleChange.from + ' to ' + roleChange.to);
  return adminUser_(userOrThrow_(userId), readTable_(T.TAB_ACCESS));
}

function resetPassword_(session, userId) {
  var temp = generateTempPassword_();
  var c = newCredentials_(temp);
  var target = null;
  withLock_(function () {
    var u = userOrThrow_(userId);
    requireAdminFor_(session, u.role_id === 'ROLE-ADMIN', 'reset the password of an Admin');
    updateRow_(T.USERS, u._row, {
      password_hash: c.password_hash, password_salt: c.password_salt, hash_rounds: c.hash_rounds,
      must_change: true, failed_attempts: 0, locked_until: ''
    });
    auditLog_(session.user.user_id, 'reset_password', T.USERS, u.user_id, 'Temporary password issued');
    target = u;
  });
  notifyUserEvent_('password_reset', session.user, target, 'a temporary password was issued');
  return { temp_password: temp };
}

/** `overrides` is the complete set of overrides for the user; tabs left out have none. */
function setUserTabAccess_(session, userId, overrides) {
  requireObject_(overrides, 'Overrides');
  var clean = {};
  Object.keys(overrides).forEach(function (tab) {
    if (TAB_IDS.indexOf(tab) < 0) throw apiError_(ERR.BAD_REQUEST, 'Unknown tab: ' + tab + '.');
    if (!isLevel_(overrides[tab])) throw apiError_(ERR.BAD_REQUEST, 'Level must be Hidden, View or Edit.');
    clean[tab] = overrides[tab];
  });
  if (userId === session.user.user_id && clean.users && clean.users !== 'Edit') {
    throw apiError_(ERR.CONFLICT, 'You cannot remove your own access to Users.');
  }
  withLock_(function () {
    var u = userOrThrow_(userId);
    requireAdminFor_(session, u.role_id === 'ROLE-ADMIN', 'change the page access of an Admin');
    var existing = readTable_(T.TAB_ACCESS).filter(function (r) { return r.subject_type === 'user' && r.subject_id === u.user_id; });
    deleteRows_(T.TAB_ACCESS, existing.map(function (r) { return r._row; }));
    appendRows_(T.TAB_ACCESS, Object.keys(clean).map(function (tab) {
      return { subject_type: 'user', subject_id: u.user_id, tab_id: tab, level: clean[tab] };
    }));
    var was = {};
    existing.forEach(function (r) { was[r.tab_id] = r.level; });
    var tabs = TAB_IDS.filter(function (t) { return was[t] !== clean[t]; });
    auditLog_(session.user.user_id, 'set_tab_access', T.USERS, u.user_id, tabs.map(function (t) {
      return t + ': ' + (was[t] || 'role default') + ' -> ' + (clean[t] || 'role default');
    }).join('; ') || 'No change');
  });
  return adminUser_(userOrThrow_(userId), readTable_(T.TAB_ACCESS));
}
