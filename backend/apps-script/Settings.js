/** Settings: read, and save with validation of known keys and values. */

var SETTING_RULES = {
  availability_basis: { type: 'enum', values: ['A', 'B', 'C'] },
  scheduled_hours_per_day: { type: 'int', min: 1, max: 24 },
  scheduled_days_per_week: { type: 'int', min: 1, max: 7 },
  repeat_min_events: { type: 'int', min: 2, max: 100 },
  repeat_window_days: { type: 'int', min: 1, max: 3650 },
  duration_short_max_min: { type: 'int', min: 1, max: 10000 },
  duration_long_min_min: { type: 'int', min: 1, max: 100000 },
  availability_target_pct: { type: 'number_or_blank', min: 0, max: 100 },
  default_comparison: { type: 'enum', values: ['previous_period', 'same_period_last_year'] },
  lockout_attempts: { type: 'int', min: 1, max: 100 },
  lockout_minutes: { type: 'int', min: 1, max: 1440 },
  session_hours: { type: 'int', min: 1, max: 168 },
  session_hours_keep: { type: 'int', min: 1, max: 8760 },
  min_password_length: { type: 'int', min: 8, max: 128 },
  notif_long_stop_hours: { type: 'int', min: 1, max: 720 },
  notif_spike_pct: { type: 'int', min: 1, max: 1000 },
  notif_upload_gap_days: { type: 'int', min: 1, max: 3650 },
  notif_repeat_alert: { type: 'enum', values: ['true', 'false'] },
  notif_retention_days: { type: 'int', min: 1, max: 3650 },
  app_url: { type: 'url_or_blank' },
  // Targets shown on the dashboards (blank = no target). Hours must be above 0.
  target_mtbf_h: { type: 'number_or_blank', min: 0, max: 100000, minExclusive: true },
  target_mttr_h: { type: 'number_or_blank', min: 0, max: 100000, minExclusive: true }
};

function readSettings_() { return readTable_(T.SETTINGS); }

function settingNum_(key, fallback) {
  var rows = readSettings_();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].key === key) {
      var n = Number(rows[i].value);
      return rows[i].value !== '' && !isNaN(n) ? n : fallback;
    }
  }
  return fallback;
}

/** Returns the cleaned text to store, or throws a plain-English error. */
function validateSetting_(key, value) {
  var rule = SETTING_RULES[key];
  var s = String(value === null || value === undefined ? '' : value).trim();
  if (rule.type === 'enum') {
    if (rule.values.indexOf(s) < 0) throw apiError_(ERR.BAD_REQUEST, 'Setting ' + key + ' must be one of: ' + rule.values.join(', ') + '.');
    return s;
  }
  if (rule.type === 'url_or_blank') {
    if (s !== '' && (s.length > 300 || !/^https?:\/\/[^\s<>"']+$/i.test(s))) {
      throw apiError_(ERR.BAD_REQUEST, 'Setting ' + key + ' must be a web address starting with http:// or https://, or blank.');
    }
    return s;
  }
  if (rule.type === 'number_or_blank' && s === '') return '';
  var n = Number(s);
  var bad = s === '' || isNaN(n) || n < rule.min || n > rule.max || (rule.minExclusive && n <= rule.min) ||
    (rule.type === 'int' && Math.floor(n) !== n);
  if (bad) throw apiError_(ERR.BAD_REQUEST, 'Setting ' + key + ' must be ' + (rule.type === 'int' ? 'a whole number' : 'a number') +
    (rule.minExclusive ? ' above ' + rule.min + ' and up to ' : ' between ' + rule.min + ' and ') + rule.max + '.');
  return String(n);
}

function saveSettings_(session, changes) {
  requireObject_(changes, 'Changes');
  var keys = Object.keys(changes);
  if (!keys.length) throw apiError_(ERR.BAD_REQUEST, 'No changes to save.');
  var clean = {};
  keys.forEach(function (k) {
    if (!SETTING_RULES[k]) throw apiError_(ERR.BAD_REQUEST, 'Unknown setting: ' + k + '.');
    clean[k] = validateSetting_(k, changes[k]);
  });
  withLock_(function () {
    var rows = readSettings_();
    var audit = [];
    Object.keys(clean).forEach(function (k) {
      var row = rows.filter(function (r) { return r.key === k; })[0];
      var stamp = { value: clean[k], updated_by: session.user.user_id, updated_at: nowTs_() };
      if (row) {
        if (row.value === clean[k]) return;
        updateRow_(T.SETTINGS, row._row, stamp);
      } else {
        appendRow_(T.SETTINGS, { key: k, value: clean[k], description: '', updated_by: stamp.updated_by, updated_at: stamp.updated_at });
      }
      audit.push(auditEntry_(session.user.user_id, 'save_setting', T.SETTINGS, k, (row ? row.value : '(none)') + ' -> ' + clean[k]));
    });
    auditLogMany_(audit);
  });
  return null;
}
