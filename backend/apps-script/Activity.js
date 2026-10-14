/**
 * Who is using the app (1.6.0, docs/wire-protocol.md section 12). Every signed-in call notes the person's activity, but
 * the sheet `user_activity` (one row per user) is written at most once every ACTIVITY_WRITE_MS_ per user: the script
 * cache keeps the exact last-seen time, page and device in between, so a busy person costs one cache read per call and
 * one small sheet write every few minutes. Noting activity never fails a call. Admins read the list with listActiveUsers.
 */

var ACTIVITY_WRITE_MS_ = 180000;      // at most one sheet write per user per 3 minutes
var ACTIVITY_CACHE_MS_ = 30000;       // the cached last-seen time is refreshed at most every 30 seconds
var ACTIVITY_ONLINE_MS_ = 300000;     // "Online now" = a call in the last 5 minutes
var ACTIVITY_CACHE_TTL_S_ = 21600;    // the cache keeps an entry 6 hours (the longest Apps Script allows)
var ACTIVITY_LOCK_WAIT_MS_ = 1500;    // a busy lock skips the write (the next call tries again)
var ACTIVITY_PAGE_PATTERN_ = /^\/[A-Za-z0-9\/_.-]{0,79}$/;
var ACTIVITY_DEVICES_ = ['phone', 'desktop'];

function activityCache_() {
  try {
    return typeof CacheService !== 'undefined' ? CacheService.getScriptCache() : null;
  } catch (e) {
    return null;
  }
}

function activityKey_(userId) { return 'ua:' + userId; }

/** The browser's hint { page, device }; anything not valid is dropped (never an error). */
function cleanActivityHint_(hint) {
  var out = { page: '', device: '' };
  if (!hint || typeof hint !== 'object' || Array.isArray(hint)) return out;
  if (typeof hint.page === 'string' && ACTIVITY_PAGE_PATTERN_.test(hint.page)) out.page = hint.page;
  if (ACTIVITY_DEVICES_.indexOf(hint.device) >= 0) out.device = hint.device;
  return out;
}

function readActivityCache_(cache, userId) {
  if (!cache) return null;
  try {
    var st = JSON.parse(cache.get(activityKey_(userId)) || 'null');
    return st && typeof st === 'object' ? st : null;
  } catch (e) {
    return null;
  }
}

/** Runs fn under the script lock, but gives up quickly (returns false) when the lock is busy. */
function withShortLock_(fn) {
  if (LOCK_DEPTH_ > 0) return fn();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(ACTIVITY_LOCK_WAIT_MS_)) return false;
  LOCK_DEPTH_++;
  try {
    return fn();
  } finally {
    LOCK_DEPTH_--;
    lock.releaseLock();
  }
}

/**
 * Upserts the person's row unless it was written less than ACTIVITY_WRITE_MS_ ago (the sheet is the throttle when the
 * cache is empty). Returns true when the row is up to date (written now or recently enough).
 */
function writeActivityRow_(userId, nowMs, page, device) {
  if (!getSpreadsheet_().getSheetByName(T.USER_ACTIVITY)) return true; // before ensureSchema: nothing to write to
  var stamp = fmtTsMs_(nowMs);
  function mine() {
    var rows = readTable_(T.USER_ACTIVITY, function (row, idx) { return row[idx.user_id] === userId; });
    return rows[rows.length - 1] || null;
  }
  function recent(row) {
    var last = row ? parseTs_(normTs_(row.last_seen_at) || '') : null;
    return last !== null && parseTs_(stamp) - last < ACTIVITY_WRITE_MS_;
  }
  if (recent(mine())) return true; // a read without the lock is enough to skip
  return withShortLock_(function () {
    var row = mine();
    if (recent(row)) return true;
    var rec = { user_id: userId, last_seen_at: stamp, updated_at: stamp };
    if (page) rec.last_page = page;
    if (device) rec.device = device;
    if (row) updateRow_(T.USER_ACTIVITY, row._row, rec);
    else appendRow_(T.USER_ACTIVITY, rec);
    return true;
  }) === true;
}

/** Notes that `userId` is using the app (every signed-in call and every sign-in). Never throws. */
function noteActivity_(userId, hint) {
  try {
    if (!userId) return;
    var now = nowMs_();
    var h = cleanActivityHint_(hint);
    var cache = activityCache_();
    var st = readActivityCache_(cache, userId) || { s: 0, w: 0, p: '', d: '' };
    if (h.page) st.p = h.page;
    if (h.device) st.d = h.device;
    var writeDue = now - (st.w || 0) >= ACTIVITY_WRITE_MS_;
    if (writeDue && writeActivityRow_(userId, now, st.p, st.d)) st.w = now;
    if (cache && (writeDue || h.page || h.device || now - (st.s || 0) >= ACTIVITY_CACHE_MS_)) {
      st.s = now;
      cache.put(activityKey_(userId), JSON.stringify(st), ACTIVITY_CACHE_TTL_S_);
    }
  } catch (e) {
    console.error('Activity not noted: ' + (e && e.message ? e.message : e));
  }
}

/**
 * listActiveUsers (Admin only): every user with when they were last seen, the page they had open and their device,
 * newest first. online = seen in the last 5 minutes; today = seen today (plant date). Never includes emails.
 */
function listActiveUsers_() {
  var users = readUsers_();
  var byUser = {};
  optionalTable_(T.USER_ACTIVITY).forEach(function (r) { byUser[r.user_id] = r; });
  var cached = {};
  var cache = activityCache_();
  if (cache && users.length) {
    try {
      var got = cache.getAll(users.map(function (u) { return activityKey_(u.user_id); })) || {};
      Object.keys(got).forEach(function (k) {
        try { cached[k.slice(3)] = JSON.parse(got[k]); } catch (e) { /* ignore a damaged entry */ }
      });
    } catch (e) { /* the sheet alone is enough */ }
  }
  var nowTs = nowTs_();
  var nowPlant = parseTs_(nowTs);
  var today = nowTs.slice(0, 10);
  var out = users.map(function (u) {
    var r = byUser[u.user_id];
    var seen = r ? (normTs_(r.last_seen_at) || '') : '';
    var page = r ? r.last_page : '';
    var device = r ? r.device : '';
    var c = cached[u.user_id];
    if (c && c.s) {
      var cs = fmtTsMs_(c.s);
      if (!seen || cs > seen) seen = cs;
      if (c.p) page = c.p;
      if (c.d) device = c.d;
    }
    var login = normTs_(u.last_login_at || '') || '';
    if (login > seen) seen = login; // a sign-in is activity too (and covers the time before 1.6.0)
    var t = seen ? parseTs_(seen) : null;
    return {
      user_id: u.user_id, display_name: u.display_name, role_id: u.role_id, active: u.active,
      last_seen_at: seen, last_page: page || '', device: ACTIVITY_DEVICES_.indexOf(device) >= 0 ? device : '',
      online: u.active && t !== null && nowPlant - t <= ACTIVITY_ONLINE_MS_ && nowPlant - t >= -60000,
      today: u.active && seen.slice(0, 10) === today
    };
  });
  out.sort(function (a, b) {
    if (a.online !== b.online) return a.online ? -1 : 1;
    if (a.last_seen_at !== b.last_seen_at) return a.last_seen_at < b.last_seen_at ? 1 : -1;
    return a.display_name < b.display_name ? -1 : a.display_name > b.display_name ? 1 : 0;
  });
  return {
    now: nowTs, online_minutes: ACTIVITY_ONLINE_MS_ / 60000, users: out,
    online_count: out.filter(function (u) { return u.online; }).length,
    today_count: out.filter(function (u) { return u.today; }).length
  };
}
