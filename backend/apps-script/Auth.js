/** Sign-in, password change, the wait after wrong passwords (1.10.0), sessions and sign-out of all devices (1.10.0). */

function normEmail_(email) { return typeof email === 'string' ? email.trim().toLowerCase() : ''; }

function readUsers_() { return readTable_(T.USERS); }
function findUserByEmail_(email) { return findBy_(T.USERS, 'email', email); }
function findUserById_(id) { return findBy_(T.USERS, 'user_id', id); }

/** Short fingerprint of the current password: a password change or reset ends every open session. */
function pwVersion_(u) { return String(u.password_hash || '').slice(0, 12); }

function publicUser_(u) {
  return { user_id: u.user_id, email: u.email, display_name: u.display_name, role_id: u.role_id };
}

function isLocked_(user, now) {
  return !!user.locked_until && Date.parse(user.locked_until) > now;
}

function lockedError_(user, now) {
  var mins = Math.max(1, Math.ceil((Date.parse(user.locked_until) - now) / 60000));
  return apiError_(ERR.LOCKED, 'Too many attempts. Try again in ' + mins + ' minute' + (mins === 1 ? '' : 's') + '.');
}

/**
 * 1.10.0: the wait after the n-th wrong password beyond the limit (n = 0, 1, ...): 1, 2, 4, 8, 16 minutes, then the cap
 * (lockout_minutes, 30 by default). Nothing is locked outright and no session is ended.
 */
function failureWaitMinutes_(beyond) {
  var cap = Math.max(1, settingNum_('lockout_minutes', 30));
  return Math.min(Math.pow(2, Math.min(beyond, 20)), cap);
}

/** Count a wrong password; from the limit on, each further attempt must wait (failureWaitMinutes_). Returns the user row. */
function recordFailure_(userId) {
  return withLock_(function () {
    var u = findUserById_(userId);
    if (!u) return null;
    var limit = settingNum_('lockout_attempts', 5);
    var attempts = u.failed_attempts + 1;
    var patch = { failed_attempts: attempts };
    if (attempts >= limit) {
      var wait = failureWaitMinutes_(attempts - limit);
      patch.locked_until = new Date(nowMs_() + wait * 60000).toISOString();
      auditLog_(u.user_id, 'login_throttled', T.USERS, u.user_id, 'Wrong password (' + attempts + '); next attempt allowed in ' + wait + ' min');
    } else {
      auditLog_(u.user_id, 'login_failed', T.USERS, u.user_id, 'Wrong password (' + attempts + ' of ' + limit + ')');
    }
    updateRow_(T.USERS, u._row, patch);
    return findUserById_(userId);
  });
}

function login_(email, password, keepSignedIn) {
  email = normEmail_(email);
  if (!email || typeof password !== 'string' || !password) throw apiError_(ERR.BAD_REQUEST, 'Enter your email and password.');
  var bad = apiError_(ERR.BAD_CREDENTIALS, 'Incorrect email or password.');
  var user = findUserByEmail_(email);
  if (!user || !user.active) {
    hashPassword_(password, 'no-such-user', getHashRounds_()); // same time as a real check
    throw bad;
  }
  if (isLocked_(user, nowMs_())) throw lockedError_(user, nowMs_());
  if (!verifyPassword_(user, password)) {
    var after = recordFailure_(user.user_id);
    if (after && isLocked_(after, nowMs_())) throw lockedError_(after, nowMs_());
    throw bad;
  }
  var fresh = withLock_(function () {
    var u = findUserById_(user.user_id);
    var patch = { failed_attempts: 0, locked_until: '', last_login_at: nowTs_() };
    if (u.hash_rounds < getHashRounds_()) {
      var c = newCredentials_(password);
      patch.password_salt = c.password_salt; patch.hash_rounds = c.hash_rounds; patch.password_hash = c.password_hash;
    }
    updateRow_(T.USERS, u._row, patch);
    auditLog_(u.user_id, 'login', T.USERS, u.user_id, patch.password_hash ? 'Signed in (password rehashed)' : 'Signed in');
    return findUserById_(u.user_id);
  });
  return buildSession_(fresh, keepSignedIn === true);
}

function buildSession_(user, keep) {
  var hours = keep ? settingNum_('session_hours_keep', 336) : settingNum_('session_hours', 12);
  var iat = nowMs_();
  var exp = iat + hours * 3600000;
  var token = signToken_({ uid: user.user_id, role: user.role_id, iat: iat, exp: exp, pv: pwVersion_(user) });
  return {
    token: token, expires_at: new Date(exp).toISOString(), user: publicUser_(user),
    must_change: user.must_change, access: computeAccess_(user, readTable_(T.TAB_ACCESS)),
    theme: accountTheme_(user.user_id), server_version: APP_VERSION
  };
}

// ---------- 1.10.0: sign out of all devices ----------

/** Sessions are signed tokens; ending them all means: tokens issued before this moment are refused (script property). */
var SIGNED_OUT_PREFIX_ = 'SIGNED_OUT_';

function signedOutAt_(userId) {
  var v = Number(getProp_(SIGNED_OUT_PREFIX_ + userId));
  return isFinite(v) && v > 0 ? v : 0;
}

function endSessions_(userId) {
  PropertiesService.getScriptProperties().setProperty(SIGNED_OUT_PREFIX_ + userId, String(nowMs_()));
}

/** signOutEverywhere: ends every session of the caller, this one included. */
function signOutEverywhere_(session) {
  endSessions_(session.user.user_id);
  try {
    withLock_(function () { auditLog_(session.user.user_id, 'sign_out_everywhere', T.USERS, session.user.user_id, 'Signed out on all devices'); });
  } catch (e) { /* the sessions are ended anyway */ }
  return null;
}

/** signOutUserEverywhere (Admin): ends every session of another person. */
function signOutUserEverywhere_(session, userId) {
  var u = userOrThrow_(userId);
  endSessions_(u.user_id);
  withLock_(function () { auditLog_(session.user.user_id, 'sign_out_user_everywhere', T.USERS, u.user_id, 'Signed ' + u.email + ' out on all devices'); });
  return null;
}

/** Verifies the token, re-reads the user (active, role, lock) and computes access. */
function requireSession_(token) {
  var payload = verifyToken_(token);
  if (!payload) throw apiError_(ERR.UNAUTHENTICATED, 'Please sign in again.');
  var user = findUserById_(payload.uid);
  if (!user || !user.active) throw apiError_(ERR.UNAUTHENTICATED, 'This account is not active.');
  if (payload.pv !== pwVersion_(user)) throw apiError_(ERR.UNAUTHENTICATED, 'Your password changed. Please sign in again.');
  // 1.10.0: a wait after wrong passwords never ends a session; 'sign out of all devices' does
  if (payload.iat < signedOutAt_(user.user_id)) throw apiError_(ERR.UNAUTHENTICATED, 'You were signed out on all devices. Please sign in again.');
  return { user: user, payload: payload, access: computeAccess_(user, readTable_(T.TAB_ACCESS)) };
}

function getMyAccess_(session) {
  return { user: publicUser_(session.user), access: session.access, must_change: session.user.must_change, theme: accountTheme_(session.user.user_id), server_version: APP_VERSION };
}

function changePassword_(session, current, next) {
  if (typeof current !== 'string' || typeof next !== 'string' || !current || !next) {
    throw apiError_(ERR.BAD_REQUEST, 'Enter your current and new password.');
  }
  var user = session.user;
  if (isLocked_(user, nowMs_())) throw lockedError_(user, nowMs_());
  if (!verifyPassword_(user, current)) {
    var after = recordFailure_(user.user_id);
    if (after && isLocked_(after, nowMs_())) throw lockedError_(after, nowMs_());
    throw apiError_(ERR.BAD_CREDENTIALS, 'Your current password is not correct.');
  }
  var min = settingNum_('min_password_length', 10);
  if (next.length < min) throw apiError_(ERR.BAD_REQUEST, 'The new password must be at least ' + min + ' characters.');
  if (next.length > 200) throw apiError_(ERR.BAD_REQUEST, 'The new password is too long.');
  if (next === current) throw apiError_(ERR.BAD_REQUEST, 'The new password must be different from the current one.');
  var creds = newCredentials_(next);
  var updated = withLock_(function () {
    var u = findUserById_(user.user_id);
    updateRow_(T.USERS, u._row, {
      password_hash: creds.password_hash, password_salt: creds.password_salt, hash_rounds: creds.hash_rounds,
      must_change: false, failed_attempts: 0, locked_until: ''
    });
    auditLog_(u.user_id, 'change_password', T.USERS, u.user_id, 'Password changed by the user');
    return findUserById_(u.user_id);
  });
  var p = session.payload;
  var keep = (p.exp - p.iat) > settingNum_('session_hours', 12) * 3600000;
  return buildSession_(updated, keep);
}

/**
 * logout (1.6.0): writes the sign-out to the audit log. Sessions are signed tokens, so nothing else is stored; the app
 * forgets its token. Best effort: a busy lock does not refuse the sign-out.
 */
function logout_(session) {
  try {
    withLock_(function () { auditLog_(session.user.user_id, 'logout', T.USERS, session.user.user_id, 'Signed out'); });
  } catch (e) { /* the app signs out anyway */ }
  return null;
}
