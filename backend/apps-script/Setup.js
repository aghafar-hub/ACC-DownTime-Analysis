/**
 * One-time and maintenance functions, run by hand from the Apps Script editor
 * (Run button). Nothing here is reachable from the web app.
 */

/** Creates missing sheets and columns. Never deletes or reorders anything. Safe to run again. */
function ensureSchema() {
  var ss = getSpreadsheet_();
  var report = [];
  SCHEMA.tableOrder.forEach(function (name) {
    var def = SCHEMA.tables[name];
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); report.push('Created sheet ' + name); }
    var headers = sheetHeaders_(sh);
    var missing = def.columns.map(function (c) { return c.name; }).filter(function (n) { return headers.indexOf(n) < 0; });
    if (missing.length) {
      var start = headers.length + 1;
      var over = start + missing.length - 1 - sh.getMaxColumns();
      if (over > 0) sh.insertColumnsAfter(sh.getMaxColumns(), over);
      sh.getRange(1, start, 1, missing.length).setValues([missing]);
      headers = headers.concat(missing);
      if (headers.length > missing.length) report.push('Added columns to ' + name + ': ' + missing.join(', '));
    }
    applyColumnFormats_(sh, name, headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  });
  report.push('Schema is up to date (' + SCHEMA.tableOrder.length + ' sheets).');
  Logger.log(report.join('\n'));
  return report;
}

/** Plain Text format on text, date, timestamp and enum columns so Sheets never converts them. */
function applyColumnFormats_(sheet, table, headers) {
  var types = columnTypes_(table);
  var rows = sheet.getMaxRows();
  var i = 0;
  while (i < headers.length) {
    if (!isTextual_(types[headers[i]] || 'text')) { i++; continue; }
    var j = i;
    while (j + 1 < headers.length && isTextual_(types[headers[j + 1]] || 'text')) j++;
    sheet.getRange(1, i + 1, rows, j - i + 1).setNumberFormat('@');
    i = j + 1;
  }
}

/**
 * Adds the starting lines, areas, classifications, roles, settings, role access, contractors and task templates. Never
 * overwrites. 1.7.0: also moves the old action statuses to tasks, once (migrateActions_ in Tasks.js). 1.10.0: new defaults
 * for two untouched settings (updateUntouchedSettings_).
 */
function seedDefaults() {
  var seeds = SCHEMA.seeds;
  var added = {};
  withLock_(function () {
    function seed(table, keyOf, items) {
      var have = {};
      readTable_(table).forEach(function (r) { have[keyOf(r)] = true; });
      var fresh = items.filter(function (it) { return !have[keyOf(it)]; });
      appendRows_(table, fresh);
      added[table] = fresh.length;
    }
    seed(T.LINES, function (r) { return r.line_id; }, seeds.lines);
    seed(T.AREAS, function (r) { return r.area_id; }, seeds.areas.map(function (a) {
      return { area_id: a.area_id, name: a.name, line_id: a.line_id, sort_order: a.sort_order, active: true,
        in_downtime_sheet: a.in_downtime_sheet, notes: a.notes || '' };
    }));
    seed(T.CLASSIFICATIONS, function (r) { return r.code; }, seeds.classifications);
    seed(T.ROLES, function (r) { return r.role_id; }, seeds.roles);
    seed(T.SETTINGS, function (r) { return r.key; }, seeds.settings.map(function (s) {
      return { key: s.key, value: s.value, description: s.description, updated_by: 'setup', updated_at: nowTs_() };
    }));
    var access = [];
    Object.keys(seeds.tabAccess).forEach(function (role) {
      Object.keys(seeds.tabAccess[role]).forEach(function (tab) {
        access.push({ subject_type: 'role', subject_id: role, tab_id: tab, level: seeds.tabAccess[role][tab] });
      });
    });
    seed(T.TAB_ACCESS, function (r) { return r.subject_type + '|' + r.subject_id + '|' + r.tab_id; }, access);
    // contractors and internal teams of the Actions page (1.4.0); an existing id is never touched
    seed(T.CONTRACTORS, function (r) { return r.contractor_id; }, seeds.contractors || []);
    // 1.7.0: the three task templates (an existing template id is never touched), then the one-time move of the old action
    // statuses Contractor informed / Waiting stoppage / In progress to tasks (Tasks.js migrateActions_; runs once)
    added[T.TASK_TEMPLATES] = seedTaskTemplates_(seeds.taskTemplates || []);
    // 1.10.0: new defaults for settings nobody has changed since setup (keep me signed in 30 -> 14 days, the longest
    // wait after wrong passwords 15 -> 30 minutes); a value someone saved is left alone
    added.settings_updated = updateUntouchedSettings_({ session_hours_keep: ['720', '336'], lockout_minutes: ['15', '30'] });
    var moved = migrateActions_();
    added.actions_moved_to_tasks = moved.migrated;
    auditLog_('setup', 'seed_defaults', '', '', JSON.stringify(added));
  });
  Logger.log('Defaults added: ' + JSON.stringify(added));
  return added;
}

/** Sets `key` from its old default to the new one where the row was written by setup and never changed. */
function updateUntouchedSettings_(changes) {
  var n = 0;
  readTable_(T.SETTINGS).forEach(function (r) {
    var c = changes[r.key];
    if (c && r.updated_by === 'setup' && String(r.value) === c[0]) {
      updateRow_(T.SETTINGS, r._row, { value: c[1], updated_at: nowTs_() });
      n++;
    }
  });
  return n;
}

/** Creates the first Admin with a random temporary password, written to the log ONCE. */
function createFirstAdmin(email, displayName) {
  var mail = normEmail_(email);
  if (!EMAIL_PATTERN_.test(mail)) throw new Error('Enter a valid email address.');
  var name = cleanText_(displayName, 'Name', true, 100);
  var temp = generateTempPassword_();
  var row = withLock_(function () {
    if (findUserByEmail_(mail)) throw new Error('A user with this email already exists.');
    requireRole_('ROLE-ADMIN');
    var r = insertUser_(mail, name, 'ROLE-ADMIN', temp, 'setup');
    auditLog_('setup', 'create_first_admin', T.USERS, r.user_id, mail);
    return r;
  });
  Logger.log('FIRST ADMIN CREATED: ' + mail + '\nTemporary password (shown only now, write it down): ' + temp +
    '\nYou must change it at first sign-in.');
  return { user_id: row.user_id, email: mail };
}

/** Editor shortcut: put your own email and name below, then Run this function once. */
function createFirstAdminRun() {
  var email = 'CHANGE-ME@example.com';
  var name = 'Plant Admin';
  if (/example\.com$/i.test(email)) throw new Error('Edit the email and name inside createFirstAdminRun first.');
  return createFirstAdmin(email, name);
}

/**
 * Creates the two secrets and the password-hash cost, once. Run it from the editor.
 * - Only values that are missing are created; an existing value is NEVER changed
 *   (changing PASSWORD_PEPPER would stop every password working, and changing
 *   SESSION_SIGNING_SECRET would sign everyone out).
 * - The values are random, kept only in Script Properties, and never printed or logged.
 */
function generateSecrets() {
  var props = PropertiesService.getScriptProperties();
  var say = [];
  [[PROP.SECRET, 'signs the login tokens'], [PROP.PEPPER, 'is mixed into every password hash']].forEach(function (p) {
    if (getProp_(p[0])) { say.push(p[0] + ' already exists: left unchanged.'); return; }
    props.setProperty(p[0], randomHex_(96));
    say.push(p[0] + ' created: 96 random characters, stored only in Script Properties; it ' + p[1] + '.');
  });
  if (getProp_(PROP.ROUNDS)) {
    say.push(PROP.ROUNDS + ' already exists: left unchanged.');
  } else {
    var rounds = benchmarkHashRounds();
    props.setProperty(PROP.ROUNDS, String(rounds));
    say.push(PROP.ROUNDS + ' set to ' + rounds + ' (measured on this account).');
  }
  say.push('Next: run createFirstAdminRun (after putting your email and name in it), then installCheck.');
  var text = say.join('\n');
  Logger.log(text);
  return text;
}

/** Times the password hash on this Google account and suggests a HASH_ROUNDS value. */
function benchmarkHashRounds() {
  var probe = 200;
  var t0 = Date.now();
  hashPassword_('benchmark-only', 'benchmark-salt', probe);
  var perRound = Math.max((Date.now() - t0) / probe, 0.001);
  var target = 400; // milliseconds per sign-in is a good balance
  var rounds = Math.min(HASH_ROUNDS_MAX, Math.max(200, Math.round(target / perRound / 100) * 100));
  Logger.log('One hash round takes about ' + perRound.toFixed(3) + ' ms.\nSuggested HASH_ROUNDS = ' + rounds +
    ' (about ' + Math.round(rounds * perRound) + ' ms per sign-in). Add it as a Script Property named HASH_ROUNDS.');
  return rounds;
}

/** Plain-English status of the installation. Never prints secret values. */
function installCheck() {
  var lines = [];
  var problems = 0;
  function say(ok, text) { lines.push((ok ? 'OK:      ' : 'PROBLEM: ') + text); if (!ok) problems++; }
  var ss = null;
  try { ss = getSpreadsheet_(); say(true, 'Spreadsheet found: ' + ss.getName()); }
  catch (e) { say(false, 'Spreadsheet not found. Check the SPREADSHEET_ID property or bind the script to the sheet.'); }
  [PROP.SECRET, PROP.PEPPER].forEach(function (p) {
    var v = getProp_(p);
    say(v.length >= MIN_SECRET_LENGTH, p + (v ? (v.length >= MIN_SECRET_LENGTH ? ' is set.' : ' is set but too short.') : ' is missing.'));
  });
  lines.push('INFO:    HASH_ROUNDS in use: ' + getHashRounds_() + (getProp_(PROP.ROUNDS) ? '' : ' (default; run benchmarkHashRounds)'));
  if (ss) {
    SCHEMA.tableOrder.forEach(function (name) {
      var sh = ss.getSheetByName(name);
      if (!sh) { say(false, 'Sheet "' + name + '" is missing. Run ensureSchema.'); return; }
      var headers = sheetHeaders_(sh);
      var missing = SCHEMA.tables[name].columns.map(function (c) { return c.name; }).filter(function (n) { return headers.indexOf(n) < 0; });
      say(!missing.length, 'Sheet "' + name + '"' + (missing.length ? ' lacks columns: ' + missing.join(', ') + '. Run ensureSchema.' : ' is ready.'));
    });
    if (!problems) {
      say(readTable_(T.ROLES).length >= 4 && readTable_(T.AREAS).length > 0, 'Starting data (roles, areas) is present. If not, run seedDefaults.');
      var admins = readUsers_().filter(function (u) { return u.active && u.role_id === 'ROLE-ADMIN'; }).length;
      say(admins > 0, admins + ' active Admin user(s). If 0, run createFirstAdminRun.');
    }
  }
  lines.push(problems ? 'RESULT:  ' + problems + ' thing(s) need attention.' : 'RESULT:  Everything looks ready.');
  var text = lines.join('\n');
  Logger.log(text);
  return text;
}

// ---------- notifications: triggers and the daily job ----------

var NOTIFICATION_JOB_ = 'notificationDailyJob';

function notificationTriggersOfThisScript_() {
  return ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === NOTIFICATION_JOB_; });
}

/**
 * Creates the daily trigger (about 07:00 plant time) that runs notificationDailyJob. Safe to run again: it first
 * removes this script's own earlier notification triggers (and only those), so there is always exactly one.
 * The first run asks for two more permissions (send email, manage triggers): approve them once.
 */
function installNotificationTriggers() {
  var removed = notificationTriggersOfThisScript_();
  removed.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(NOTIFICATION_JOB_).timeBased().everyDays(1).atHour(7).inTimezone(TIMEZONE).create();
  var text = 'Notification trigger installed: ' + NOTIFICATION_JOB_ + ' runs every day around 07:00 (' + TIMEZONE + ')' +
    (removed.length ? ' (replaced ' + removed.length + ' earlier trigger' + (removed.length === 1 ? '' : 's') + ').' : '.');
  Logger.log(text);
  return text;
}

/** Removes the notification trigger(s) created by installNotificationTriggers. Other triggers are left alone. */
function removeNotificationTriggers() {
  var removed = notificationTriggersOfThisScript_();
  removed.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  var text = 'Removed ' + removed.length + ' notification trigger' + (removed.length === 1 ? '' : 's') + '.';
  Logger.log(text);
  return text;
}

/**
 * The daily job: runs the notification checks and the action checks, then sends the digests that are due. Each step is isolated, so a
 * failed check does not stop the digests and nothing here can throw into the trigger.
 */
function notificationDailyJob() {
  var out = { checks: null, actions: null, digest: null };
  try { out.checks = runNotificationChecks_({}); } catch (err) { notifLogFailure_('daily checks', err); }
  out.actions = actionChecksSafely_('daily checks'); // drafts and effectiveness (1.4.0)
  try { out.digest = sendDigest_(); } catch (err2) { notifLogFailure_('daily digest', err2); }
  Logger.log('Notification job: ' + JSON.stringify(out));
  return out;
}
