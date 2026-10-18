/**
 * Notifications (docs/notifications-design.md).
 *
 * Stored notifications are alerts and updates only; action items are derived live by the app.
 * The rules below use the same formulas as the browser (src/calc/events.ts, repeats.ts, kpis.ts) and
 * leave out voided and blocked records exactly like the browser does. The mock API
 * (src/api/mockNotifications.ts) implements the same rules over the calc library; the contract test
 * keeps the two in step.
 *
 * Decisions that the design left open (all documented in docs/wire-protocol.md section 9):
 * - "Now" for the data rules is the latest stored event date, never the wall clock (so historical data
 *   works); only upload_gap and expiry use today's date.
 * - A long stop or repeated-failure group is only raised when it is recent: its (last) event started
 *   within notif_retention_days before the latest stored event date. Older ones would expire at once,
 *   and without this the very first check on a database with years of history would flood the panel.
 * - dedupe_key is unique over all statuses. A resolved row is re-opened if its condition returns;
 *   an expired row is never re-opened.
 */

var NOTIF_RESOLVABLE_ = ['long_stop', 'repeat_group', 'upload_gap', 'action_due', 'action_ready_to_close', 'task_overdue'];
// Most severe first (used by the digest).
var NOTIF_SEVERITY_ORDER_ = ['long_stop', 'availability_low', 'planned_overrun', 'failure_spike', 'repeat_group', 'task_overdue', 'action_due', 'action_ready_to_close', 'upload_gap'];
// The inbox category of each type (1.4.0). Returned with every item by getNotifications; not stored.
var NOTIF_CATEGORY_ = {
  long_stop: 'Reliability', repeat_group: 'Reliability', failure_spike: 'Reliability',
  availability_low: 'Availability & planned', planned_overrun: 'Availability & planned',
  upload_gap: 'Data quality', upload_done: 'Data quality', action_due: 'Actions', user_event: 'System',
  action_ready_to_close: 'Actions', task_overdue: 'Actions' // 1.7.0
};
var NOTIF_PREF_KEYS_ = ['alert_types', 'watch_areas', 'digest', 'last_seen_at', 'saved_views', 'saved_reports', 'theme'];
// The person's theme (1.5.0), kept with their account so it follows them to every device. Mirrored in src/theme/themes.ts.
var ACCOUNT_THEMES_ = ['ACC Light', 'Warm Paper', 'High Contrast', 'Navy Dark', 'Carbon Dark'];
var SAVED_VIEWS_MAX_ = 20;
var SAVED_VIEWS_TEXT_MAX_ = 20000;
var SAVED_VIEW_PAGES_ = ['overview', 'pareto', 'repeats', 'reliability', 'events'];
// Saved report templates (Reports page): at most 20 of {id, name, template, period, filters, sections, options}.
// The lists below are mirrored in src/api/types.ts (REPORT_*); a unit test compares them.
var SAVED_REPORTS_MAX_ = 20;
var SAVED_REPORTS_TEXT_MAX_ = 20000;
var REPORT_TEMPLATES_ = ['monthly', 'area', 'failure', 'custom'];
var REPORT_PRESETS_ = ['lastmonth', 'thismonth', 'last3', 'ytd', 'custom'];
var REPORT_SECTION_IDS_ = [
  'cover', 'summary', 'daily', 'monthly', 'classes', 'area_downtime', 'availability', 'mtbf_mttr', 'failure_rate',
  'top_equipment', 'top_reasons', 'pareto', 'repeats', 'longest', 'quadrant', 'when', 'events', 'quality', 'methodology'
];
var REPORT_CLASSES_ = ['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'];
var REPORT_FILTER_LISTS_ = ['lines', 'areas', 'equipment', 'classifications', 'criticality'];
var REPORT_LIST_MAX_ = 100;
var NOTIF_DIGEST_MODES_ = ['none', 'daily', 'weekly'];
var NOTIF_DIGEST_MAX_ = 10;
var NOTIF_SPIKE_DAYS_ = 30;
var NOTIF_SPIKE_MIN_NOW_ = 5;
var NOTIF_SNOOZE_MAX_DAYS_ = 366;
var NOTIF_BLOCKING_FLAGS_ = ['missing_classification', 'invalid_classification', 'unknown_area', 'end_before_start'];
var NOTIF_INFO_FLAGS_ = ['code_not_in_area'];
var MS_DAY_ = 86400000;
// P5 (src/calc/repeats.ts): the same code and reason in different areas within 10 minutes is one occurrence.
var NOTIF_CROSS_AREA_MERGE_MS_ = 10 * 60000;

// ---------- small helpers ----------

function notifEnum_(table, column) { return enumOf_(table, column); }

function fmtTsMs_(ms) { return Utilities.formatDate(new Date(ms), TIMEZONE, 'yyyy-MM-dd HH:mm:ss.SSS'); }

function dateMs_(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

function msDate_(ms) { return new Date(ms).toISOString().slice(0, 10); }

function addDays_(d, n) { return msDate_(dateMs_(d) + n * MS_DAY_); }

function lastDayOfMonth_(month) {
  var y = +month.slice(0, 4), m = +month.slice(5, 7);
  var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return month + '-' + (last < 10 ? '0' : '') + last;
}

function addMonths_(month, n) {
  var y = +month.slice(0, 4), m = +month.slice(5, 7) - 1 + n;
  var yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return yy + '-' + (mm + 1 < 10 ? '0' : '') + (mm + 1);
}

function splitFlags_(flags) {
  return String(flags === null || flags === undefined ? '' : flags).split(',').map(function (f) { return f.trim(); }).filter(Boolean);
}
/** Stored flags minus the ones a user kept as entered (events.accepted_flags). Accepted flags are not open problems. */
/**
 * P2 (src/calc/flags.ts hasFailureFlagMismatch): Failure = YES on a PL / CIR row or on a continuation (Freq = 0) row.
 * Worked out from the row, never stored; a record carries it as an open problem until it is kept as entered.
 */
function failureFlagMismatch_(e) {
  return toBool_(e.is_failure) && (e.classification === 'PL' || e.classification === 'CIR' || Number(e.freq) === 0);
}

/** P2 (src/calc/events.ts isFailureHead): Freq = 1, Failure = YES, not PL and not CIR. */
function isFailureHead_(row) {
  return Number(row.freq) === 1 && row.is_failure === true && row.classification !== 'PL' && row.classification !== 'CIR';
}

function openFlags_(e) {
  var kept = splitFlags_(e.accepted_flags);
  return splitFlags_(e.flags).filter(function (f) { return kept.indexOf(f) < 0; });
}
function hasOpenProblem_(e) {
  if (openFlags_(e).some(function (f) { return NOTIF_INFO_FLAGS_.indexOf(f) < 0; })) return true;
  // the derived warning failure_flag_mismatch (the app's Validate list); overlaps are information, never counted
  return failureFlagMismatch_(e) && splitFlags_(e.accepted_flags).indexOf('failure_flag_mismatch') < 0;
}
function isBlockedFlags_(flags) { return splitFlags_(flags).some(function (f) { return NOTIF_BLOCKING_FLAGS_.indexOf(f) >= 0; }); }
function hasProblemFlags_(flags) { return splitFlags_(flags).some(function (f) { return NOTIF_INFO_FLAGS_.indexOf(f) < 0; }); }

function csv_(s) {
  return String(s === null || s === undefined ? '' : s).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}

function oneLine_(s, max) {
  var t = String(s === null || s === undefined ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '.' : t;
}

// ---------- settings ----------

function notifNum_(map, key, dflt, min, max) {
  var raw = map[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return dflt;
  var n = Number(raw);
  return isFinite(n) && n >= min && n <= max ? n : dflt;
}

/** The settings the rules read, with the same defaults as schema/tables.json when a row is missing. */
function notifSettings_() {
  var map = {};
  readSettings_().forEach(function (r) { map[r.key] = r.value; });
  var target = map.availability_target_pct;
  var targetN = target === undefined || target === null || String(target).trim() === '' ? null : Number(target);
  var repeat = String(map.notif_repeat_alert === undefined ? 'true' : map.notif_repeat_alert).trim().toLowerCase();
  return {
    longStopHours: notifNum_(map, 'notif_long_stop_hours', 8, 0, 100000),
    spikePct: notifNum_(map, 'notif_spike_pct', 30, 0, 100000),
    uploadGapDays: notifNum_(map, 'notif_upload_gap_days', 35, 0, 100000),
    availabilityTargetPct: targetN !== null && isFinite(targetN) ? targetN : null,
    repeatAlert: repeat !== 'false' && repeat !== '0' && repeat !== 'no',
    retentionDays: notifNum_(map, 'notif_retention_days', 30, 1, 100000),
    appUrl: /^https?:\/\//i.test(String(map.app_url || '').trim()) ? String(map.app_url).trim() : '',
    repeatMinEvents: Math.max(2, Math.round(notifNum_(map, 'repeat_min_events', 2, 1, 1000))),
    repeatWindowDays: notifNum_(map, 'repeat_window_days', 30, 0, 3650),
    hoursPerDay: notifNum_(map, 'scheduled_hours_per_day', 24, 0, 24),
    daysPerWeek: Math.round(notifNum_(map, 'scheduled_days_per_week', 7, 0, 7))
  };
}

// ---------- event chaining (port of src/calc/events.ts buildFailureEvents) ----------

function notifChainArea_(parsed, tol) {
  parsed.sort(function (a, b) { return (a.stop - b.stop) || (b.row.freq - a.row.freq) || (a.idx - b.idx); });
  var out = [], open = [];
  function newChain(p, orphan) {
    return {
      id: p.row.event_id, area_id: p.row.area_id, line_id: p.row.line_id, head: p.row, rows: [p.row],
      startMs: p.stop, endMs: p.start, startDate: String(p.row.stop_ts).slice(0, 10),
      durationS: p.start > p.stop ? (p.start - p.stop) / 1000 : 0, isFailure: !orphan && isFailureHead_(p.row), orphan: orphan
    };
  }
  // exact duplicates (same area, code, stop, restart, class) are one stop: they share the stop, so they are neighbours here
  var sameStop = NaN, seen = [];
  parsed.forEach(function (p) {
    if (p.stop !== sameStop) { sameStop = p.stop; seen = []; }
    var dk = codeKey_(p.row.code_raw || '') + '|' + p.row.start_ts + '|' + p.row.classification;
    if (seen.indexOf(dk) >= 0) return;
    seen.push(dk);
    var w = 0;
    for (var r = 0; r < open.length; r++) if (open[r].tail >= p.stop - tol) open[w++] = open[r];
    open.length = w;
    if (p.row.freq === 1) {
      var c = newChain(p, false);
      out.push(c);
      open.push({ chain: c, tail: p.start });
      return;
    }
    var best = null;
    open.forEach(function (o) {
      if (Math.abs(o.tail - p.stop) <= tol && (!best || Math.abs(o.tail - p.stop) < Math.abs(best.tail - p.stop))) best = o;
    });
    if (best) {
      best.chain.rows.push(p.row);
      best.chain.endMs = Math.max(best.chain.endMs, p.start);
      if (p.start > p.stop) best.chain.durationS += (p.start - p.stop) / 1000;
      best.tail = p.start;
    } else {
      var oc = newChain(p, true);
      out.push(oc);
      open.push({ chain: oc, tail: p.start });
    }
  });
  return out;
}

/** Chains of analysable rows (the caller has already left out voided and blocked rows). */
function notifBuildChains_(rows) {
  var byArea = {};
  rows.forEach(function (row, idx) {
    var stop = parseTs_(row.stop_ts), start = parseTs_(row.start_ts);
    if (stop === null || start === null) return;
    (byArea[row.area_id] = byArea[row.area_id] || []).push({ row: row, stop: stop, start: start, idx: idx });
  });
  var chains = [];
  Object.keys(byArea).forEach(function (a) { chains = chains.concat(notifChainArea_(byArea[a], 1000)); });
  chains.sort(function (a, b) {
    return (a.startMs - b.startMs) || (a.area_id < b.area_id ? -1 : a.area_id > b.area_id ? 1 : 0) || (a.id < b.id ? -1 : 1);
  });
  return chains;
}

/** Port of findClusters in src/calc/repeats.ts. */
function notifFindClusters_(starts, minEvents, windowDays) {
  var w = windowDays * MS_DAY_, n = starts.length;
  var clusters = [], cur = [], runEnd = -1, e = 0;
  for (var i = 0; i < n; i++) {
    if (e < i) e = i;
    while (e + 1 < n && starts[e + 1] - starts[i] <= w) e++;
    if (e - i + 1 < minEvents) continue;
    if (i > runEnd) {
      if (cur.length) clusters.push(cur);
      cur = [];
      for (var k = i; k <= e; k++) cur.push(k);
    } else {
      for (var j = runEnd + 1; j <= e; j++) cur.push(j);
    }
    runEnd = Math.max(runEnd, e);
  }
  if (cur.length) clusters.push(cur);
  return clusters;
}

// ---------- data for the rules ----------

function notifLoadContext_(st) {
  var areas = {}, inactive = {};
  readTable_(T.AREAS).forEach(function (a) {
    areas[a.area_id] = a;
    if (!toBool_(a.active)) inactive[a.area_id] = true;
  });
  // 1.5.0: records of an area switched off are left out of every rule, as if they did not exist
  var all = readTable_(T.EVENTS, function (row, idx) { return !toBool_(row[idx.is_void]) && !inactive[row[idx.area_id]]; });
  var equipmentByKey = {}, aliases = {};
  readColumn_(T.EQUIPMENT, 'equipment_id').forEach(function (id) { equipmentByKey[codeKey_(id)] = id; });
  readTable_(T.ALIASES).forEach(function (a) { aliases[codeKey_(a.alias)] = a.equipment_id; });
  var latest = '';
  all.forEach(function (r) { if (isValidDate_(r.event_date) && r.event_date > latest) latest = r.event_date; });
  var rows = all.filter(function (r) { return !isBlockedFlags_(r.flags); });
  var ctx = { st: st, all: all, rows: rows, areas: areas, inactive: inactive, equipmentByKey: equipmentByKey, aliases: aliases, latest: latest, today: nowTs_().slice(0, 10) };
  ctx.cutoff = latest ? addDays_(latest, -st.retentionDays) : '';
  return ctx;
}

function notifLineOf_(ctx, areaId, fallback) {
  var a = ctx.areas[areaId];
  return a ? a.line_id : (fallback || '');
}

/** Code of a failure for grouping, as in src/calc/normalize.ts rowCode + repeats.ts: null for area-level. */
function notifCodeOf_(ctx, row) {
  var key = codeKey_(row.code_raw);
  if (row.is_area_level || AREA_LEVEL_KEYS.indexOf(key) >= 0) return null;
  if (row.equipment_id) return String(row.equipment_id).toUpperCase();
  var aliased = ctx.aliases[key];
  if (aliased !== undefined && ctx.equipmentByKey[codeKey_(aliased)] !== undefined) return String(ctx.equipmentByKey[codeKey_(aliased)]).toUpperCase();
  if (ctx.equipmentByKey[key] !== undefined) return String(ctx.equipmentByKey[key]).toUpperCase();
  return key;
}

function notifCandidate_(type, key, title, detail, areaId, lineId, ref) {
  return {
    type: type, severity: 'alert', dedupe_key: key, title: oneLine_(title, 200), detail: oneLine_(detail, 500),
    area_id: areaId || '', line_id: lineId || '', source_ref: ref || ''
  };
}

// ---------- the rules ----------

/** long_stop: a chained failure event longer than notif_long_stop_hours. */
function notifRuleLongStop_(ctx, chains) {
  var out = [];
  var limit = ctx.st.longStopHours;
  chains.forEach(function (c) {
    if (!c.isFailure || !(c.durationS / 3600 > limit)) return;
    if (c.startDate < ctx.cutoff) return;
    var h = (c.durationS / 3600).toFixed(1);
    out.push(notifCandidate_('long_stop', 'long_stop|' + c.id,
      'Long stop: ' + c.area_id + ' ' + h + ' h',
      'A failure stopped ' + c.area_id + ' for ' + h + ' hours (limit ' + limit + ' h), starting ' + String(c.head.stop_ts).slice(0, 16) + '.',
      c.area_id, notifLineOf_(ctx, c.area_id, c.line_id), c.id));
  });
  return out;
}

/**
 * Port of groupOccurrences in src/calc/repeats.ts (sorted failure events of one group): an event joins the current
 * occurrence when it starts at most 10 minutes after the occurrence's first event and its area is not in it yet.
 */
function notifOccurrences_(sorted) {
  var out = [];
  sorted.forEach(function (c) {
    var cur = out.length ? out[out.length - 1] : null;
    if (cur && c.startMs - cur.startMs <= NOTIF_CROSS_AREA_MERGE_MS_ && cur.areas.indexOf(c.area_id) < 0) {
      cur.members.push(c);
      cur.areas.push(c.area_id);
    } else {
      out.push({ members: [c], startMs: c.startMs, areas: [c.area_id] });
    }
  });
  return out;
}

/**
 * repeat_group: same code and reason, at least repeat_min_events OCCURRENCES within repeat_window_days. An occurrence is
 * one failure event, or several in different areas that start within 10 minutes (P5).
 */
function notifRuleRepeat_(ctx, chains) {
  var out = [];
  if (!ctx.st.repeatAlert) return out;
  var groups = {}, order = [];
  chains.forEach(function (c) {
    if (!c.isFailure) return;
    var code = notifCodeOf_(ctx, c.head);
    if (code === null) return;
    var reasonKey = matchKey_(c.head.reason_raw);
    if (reasonKey === '') return;
    var key = code + '|' + reasonKey;
    if (!groups[key]) { groups[key] = { code: code, reasonKey: reasonKey, list: [] }; order.push(key); }
    groups[key].list.push(c);
  });
  order.forEach(function (key) {
    var g = groups[key];
    g.list.sort(function (a, b) { return (a.startMs - b.startMs) || (a.id < b.id ? -1 : 1); });
    var occs = notifOccurrences_(g.list);
    var clusters = notifFindClusters_(occs.map(function (o) { return o.startMs; }), ctx.st.repeatMinEvents, ctx.st.repeatWindowDays);
    clusters.forEach(function (cl) {
      var first = occs[cl[0]].members[0], last = occs[cl[cl.length - 1]].members[0];
      if (last.startDate < ctx.cutoff) return;
      var label = oneLine_(first.head.reason_raw, 120);
      out.push(notifCandidate_('repeat_group', 'repeat|' + first.area_id + '|' + g.code + '|' + g.reasonKey + '|' + first.id,
        'Repeated failure: ' + g.code + ' - ' + label,
        cl.length + ' failures within ' + ctx.st.repeatWindowDays + ' days, latest ' + last.startDate + '. First in ' + first.area_id + '.',
        first.area_id, notifLineOf_(ctx, first.area_id, first.line_id), first.id));
    });
  });
  return out;
}

/** failure_spike: failure EVENTS (P2: chains with a Freq 1, Failure YES, not PL / CIR head) that started in the 30 days ending at the latest event date vs the 30 days before. */
function notifRuleSpike_(ctx, chains) {
  var out = [];
  if (!ctx.latest) return out;
  var nowFrom = dateMs_(addDays_(ctx.latest, -(NOTIF_SPIKE_DAYS_ - 1)));
  var nowTo = dateMs_(ctx.latest) + MS_DAY_;
  var prevFrom = nowFrom - NOTIF_SPIKE_DAYS_ * MS_DAY_;
  var counts = {};
  chains.forEach(function (ch) {
    if (!ch.isFailure) return;
    var stop = ch.startMs;
    var c = counts[ch.area_id] || (counts[ch.area_id] = { now: 0, prev: 0 });
    if (stop >= nowFrom && stop < nowTo) c.now++;
    else if (stop >= prevFrom && stop < nowFrom) c.prev++;
  });
  Object.keys(counts).sort().forEach(function (area) {
    var c = counts[area];
    if (c.now < NOTIF_SPIKE_MIN_NOW_) return;
    var pct = c.prev === 0 ? null : ((c.now - c.prev) / c.prev) * 100;
    if (pct !== null && !(pct > ctx.st.spikePct)) return;
    out.push(notifCandidate_('failure_spike', 'spike|' + area + '|' + ctx.latest,
      pct === null ? 'Failures rising in ' + area + ': ' + c.now + ' (none before)' : 'Failures up ' + Math.round(pct) + '% in ' + area,
      c.now + ' failures in the ' + NOTIF_SPIKE_DAYS_ + ' days to ' + ctx.latest + ', against ' + c.prev + ' in the ' + NOTIF_SPIKE_DAYS_ + ' days before.',
      area, notifLineOf_(ctx, area, ''), ''));
  });
  return out;
}

/** upload_gap: the latest stored event is older than notif_upload_gap_days. */
function notifRuleGap_(ctx) {
  if (!ctx.latest) return [];
  var days = Math.round((dateMs_(ctx.today) - dateMs_(ctx.latest)) / MS_DAY_);
  if (!(days > ctx.st.uploadGapDays)) return [];
  return [notifCandidate_('upload_gap', 'upload_gap|' + ctx.latest, 'No upload since ' + ctx.latest,
    'The latest stored event is dated ' + ctx.latest + ', ' + days + ' days ago (limit ' + ctx.st.uploadGapDays + ' days).', '', '', '')];
}

function notifScheduledDays_(from, to, perWeek) {
  var total = Math.round((dateMs_(to) - dateMs_(from)) / MS_DAY_) + 1;
  if (perWeek >= 7) return total;
  var startDow = (new Date(dateMs_(from)).getUTCDay() + 6) % 7;
  var count = 0;
  for (var k = 0; k < total; k++) if ((startDow + k) % 7 < perWeek) count++;
  return count;
}

/**
 * Port of attributeRows in src/calc/attribution.ts for one window (P1): the downtime of an area is the UNION of its rows;
 * time covered by several rows goes to one of them: PL before incidental before CIR, then the row that started first,
 * then the longer one, then the lower event id. Returns { area: { pl, inc, cir } } in hours inside [wFrom, wTo).
 */
function notifUnionHours_(rows, wFrom, wTo) {
  var byArea = {};
  rows.forEach(function (r) {
    var s = parseTs_(r.stop_ts), e = parseTs_(r.start_ts);
    if (s === null || e === null || !(e > s)) return;
    var prec = r.classification === 'PL' ? 0 : r.classification === 'CIR' ? 2 : 1;
    (byArea[r.area_id] = byArea[r.area_id] || []).push({ row: r, from: s, to: e, prec: prec });
  });
  function better(a, b) {
    if (a.prec !== b.prec) return a.prec < b.prec;
    if (a.from !== b.from) return a.from < b.from;
    if (a.to !== b.to) return a.to > b.to;
    return a.row.event_id < b.row.event_id;
  }
  var out = {};
  Object.keys(byArea).forEach(function (area) {
    var items = byArea[area].sort(function (a, b) { return (a.from - b.from) || (a.to - b.to); });
    var pts = [];
    items.forEach(function (i) { pts.push(i.from, i.to); });
    pts.sort(function (a, b) { return a - b; });
    var acc = out[area] = { pl: 0, inc: 0, cir: 0 };
    var next = 0, active = [];
    for (var p = 0; p + 1 < pts.length; p++) {
      var lo = pts[p], hi = pts[p + 1];
      if (hi === lo) continue;
      while (next < items.length && items[next].from <= lo) active.push(items[next++]);
      active = active.filter(function (i) { return i.to > lo; });
      if (!active.length) continue;
      var win = active[0];
      for (var k = 1; k < active.length; k++) if (better(active[k], win)) win = active[k];
      var f = Math.max(lo, wFrom), u = Math.min(hi, wTo);
      if (!(u > f)) continue;
      var h = (u - f) / 3600000;
      if (win.prec === 0) acc.pl += h;
      else if (win.prec === 2) acc.cir += h;
      else acc.inc += h;
    }
  });
  return out;
}

/**
 * availability_low: availability on basis B, B = (T - PL - (INC + CIR)) / (T - PL), of each area for the latest
 * complete month in the data (the month of the latest event date if that date is its last day, else the month
 * before), clipped to the data range like computeKpis. Overlapping stops of one area count once (P1, union per area);
 * a month without any record is 'not uploaded' and raises nothing (P6). Only when availability_target_pct is set.
 */
function notifRuleAvailability_(ctx) {
  var out = [];
  var target = ctx.st.availabilityTargetPct;
  if (target === null || !ctx.latest) return out;
  var month = ctx.latest.slice(0, 7);
  if (ctx.latest !== lastDayOfMonth_(month)) month = addMonths_(month, -1);
  var lo = '', hi = '';
  ctx.rows.forEach(function (r) {
    var a = String(r.stop_ts).slice(0, 10), b = String(r.start_ts).slice(0, 10);
    if (b < a) b = a;
    if (lo === '' || a < lo) lo = a;
    if (b > hi) hi = b;
  });
  if (lo === '') return out;
  var from = month + '-01', to = lastDayOfMonth_(month);
  if (lo > from) from = lo;
  if (hi < to) to = hi;
  if (from > to) return out;
  // P6: no record at all (voided ones aside) starts or runs in the month: not uploaded, nothing to judge
  var mFrom = dateMs_(month + '-01'), mTo = dateMs_(lastDayOfMonth_(month)) + MS_DAY_;
  var uploaded = ctx.all.some(function (r) {
    var s = parseTs_(r.stop_ts), e = parseTs_(r.start_ts);
    return s !== null && s < mTo && (s >= mFrom || (e !== null && e > mFrom));
  });
  if (!uploaded) return out;
  var wFrom = dateMs_(from), wTo = dateMs_(to) + MS_DAY_;
  var t = notifScheduledDays_(from, to, ctx.st.daysPerWeek) * ctx.st.hoursPerDay;
  var acc = notifUnionHours_(ctx.rows, wFrom, wTo);
  ctx.rows.forEach(function (r) { if (!acc[r.area_id]) acc[r.area_id] = { pl: 0, inc: 0, cir: 0 }; });
  Object.keys(acc).sort().forEach(function (area) {
    var a = acc[area];
    var den = t - a.pl;
    if (!(den > 0)) return;
    var b = Math.min(1, Math.max(0, (t - a.pl - (a.inc + a.cir)) / den));
    var pct = b * 100;
    if (!(pct < target)) return;
    out.push(notifCandidate_('availability_low', 'availability|' + area + '|' + month,
      'Availability below target: ' + area + ' ' + pct.toFixed(1) + '%',
      month + ': availability ' + pct.toFixed(1) + '% against a target of ' + String(target) + '% (basis B).',
      area, notifLineOf_(ctx, area, ''), ''));
  });
  return out;
}

/** planned_overrun (1.4.0): an area's planned hours in a complete month above the month's allowance (Actions.js plannedOverruns_). */
function notifRulePlanned_(ctx) {
  return plannedOverruns_(ctx, optionalTable_(T.AREA_TARGETS)).map(function (o) {
    var txt = plannedOverrunText_(o);
    return notifCandidate_('planned_overrun', 'planned|' + o.area + '|' + o.month, txt.title, txt.detail, o.area, o.line, '');
  });
}

/**
 * action_due (1.4.0): an action that is not closed or cancelled and whose due date is before today (plant date). 1.7.0: an
 * action with tasks uses the latest due date of its open tasks (due_date_derived) and is left out while it is a Draft.
 */
function notifRuleActionDue_(ctx, actions, byAction) {
  var out = [];
  actions.filter(function (a) { return !isTerminal_(a.status); })
    .sort(function (a, b) { return a.action_id < b.action_id ? -1 : 1; })
    .forEach(function (a) {
      var tasks = byAction[a.action_id] || [];
      if (tasks.length && a.status === 'Draft') return;
      var due = derivedDue_(a, tasks);
      if (!due || !isValidDate_(due) || !(due < ctx.today)) return;
      var days = Math.round((dateMs_(ctx.today) - dateMs_(due)) / MS_DAY_);
      out.push(notifCandidate_('action_due', 'action_due|' + a.action_id + '|' + due,
        'Action overdue: ' + a.action_id + ' - ' + oneLine_(a.title, 120),
        'Due ' + due + ', ' + days + ' day' + (days === 1 ? '' : 's') + ' ago. Status ' + a.status + ', owner ' + (a.owner || 'nobody yet') + '.',
        a.area_id, a.line_id, a.action_id));
    });
  return out;
}

/** All data-driven candidates, in a fixed order. */
function notifCandidates_(ctx) {
  var chains = notifBuildChains_(ctx.rows);
  var actions = optionalTable_(T.ACTIONS);
  var byAction = tasksByAction_(readAllTasks_());
  return [].concat(
    notifRuleLongStop_(ctx, chains), notifRuleRepeat_(ctx, chains), notifRuleSpike_(ctx, chains),
    notifRuleAvailability_(ctx), notifRulePlanned_(ctx), notifRuleGap_(ctx), notifRuleActionDue_(ctx, actions, byAction),
    notifRuleTaskOverdue_(ctx, actions, byAction), notifRuleReady_(actions, byAction) // 1.7.0 (Tasks.js)
  );
}

function uploadDoneCandidate_(batch) {
  var file = oneLine_(batch.file_name, 80) || 'workbook';
  return {
    type: 'upload_done', severity: 'update', dedupe_key: 'upload|' + batch.batch_id,
    title: 'Workbook uploaded: ' + file + ' (+' + batch.rows_added + ' rows)',
    detail: 'Read ' + batch.rows_read + ', added ' + batch.rows_added + ', identical ' + batch.rows_identical +
      ', skipped ' + batch.rows_skipped + ', warnings ' + batch.warning_count + '.',
    area_id: '', line_id: '', source_ref: batch.batch_id
  };
}

// ---------- storing, dedupe, expire, resolve ----------

function notifRowFrom_(c, st, nowMs) {
  return {
    notification_id: newId_('NT-', 16), type: c.type, severity: c.severity, dedupe_key: c.dedupe_key, title: c.title,
    detail: c.detail, area_id: c.area_id, line_id: c.line_id, source_ref: c.source_ref,
    created_at: fmtTsMs_(nowMs), expires_at: fmtTsMs_(nowMs + st.retentionDays * MS_DAY_), status: 'open', resolved_at: '',
    recipients: c.recipients || ''
  };
}

/**
 * Runs every rule, stores new alerts once (dedupe_key), expires old ones and resolves the ones whose condition
 * no longer holds. opts.batch (a completed upload batch row) also writes the upload_done update.
 * Returns { created, resolved, expired }. Callers need no lock; it takes the script lock itself.
 */
function runNotificationChecks_(opts) {
  opts = opts || {};
  return withLock_(function () {
    var st = notifSettings_();
    var nowMs = nowMs_();
    var stamp = fmtTsMs_(nowMs);
    var existing = readTable_(T.NOTIFICATIONS);
    var byKey = {};
    existing.forEach(function (r) { byKey[r.dedupe_key] = r; });
    var res = { created: 0, resolved: 0, expired: 0 };
    var patches = [], fresh = [];

    existing.forEach(function (r) {
      if (r.status === 'open' && r.expires_at && r.expires_at <= stamp) {
        patches.push({ row: r, patch: { status: 'expired' } });
        r.status = 'expired';
        res.expired++;
      }
    });

    var cands = notifCandidates_(notifLoadContext_(st));
    if (opts.batch) cands.push(uploadDoneCandidate_(opts.batch));
    var current = {};
    cands.forEach(function (c) {
      var resolvable = NOTIF_RESOLVABLE_.indexOf(c.type) >= 0;
      if (resolvable) current[c.dedupe_key] = true;
      var ex = byKey[c.dedupe_key];
      if (!ex) {
        var row = notifRowFrom_(c, st, nowMs);
        fresh.push(row);
        byKey[c.dedupe_key] = row;
        res.created++;
      } else if (ex.status === 'resolved' && resolvable) {
        patches.push({ row: ex, patch: { status: 'open', resolved_at: '', expires_at: fmtTsMs_(nowMs + st.retentionDays * MS_DAY_), recipients: c.recipients || '' } });
        ex.status = 'open';
        res.created++;
      } else if (ex.status === 'open' && ex._row && (ex.recipients || '') !== (c.recipients || '')) {
        // 1.7.0: a task's person or the action owner changed: the alert follows them
        patches.push({ row: ex, patch: { recipients: c.recipients || '' } });
        ex.recipients = c.recipients || '';
      }
    });

    existing.forEach(function (r) {
      if (r.status === 'open' && NOTIF_RESOLVABLE_.indexOf(r.type) >= 0 && !current[r.dedupe_key]) {
        patches.push({ row: r, patch: { status: 'resolved', resolved_at: stamp } });
        r.status = 'resolved';
        res.resolved++;
      }
    });

    appendRows_(T.NOTIFICATIONS, fresh);
    patches.forEach(function (p) { updateRow_(T.NOTIFICATIONS, p.row._row, p.patch); });
    return res;
  });
}

function runNotificationChecksAction_(session) {
  var res = runNotificationChecks_({});
  actionChecksSafely_('notification check');
  withLock_(function () {
    auditLog_(session.user.user_id, 'notification_check', T.NOTIFICATIONS, '',
      'Created ' + res.created + ', resolved ' + res.resolved + ', expired ' + res.expired);
  });
  return res;
}

/** Best effort after an upload: never throws, so an upload cannot fail because of notifications. */
function notifyAfterUpload_(batch) {
  try {
    runNotificationChecks_({ batch: batch });
  } catch (err) {
    notifLogFailure_('upload', err);
  }
  actionChecksSafely_('upload'); // after the alerts, so a new long stop already has its notification
}

/** Best effort 'user created / password reset / role changed' update, visible to people with access to Users. */
function notifyUserEvent_(kind, actor, target, extra) {
  try {
    if (!target) return;
    var st = notifSettings_();
    var who = target.display_name || target.email;
    var by = (actor && (actor.display_name || actor.email)) || 'An administrator';
    var title, detail;
    if (kind === 'created') {
      title = 'User created: ' + who;
      detail = by + ' created the account for ' + target.email + ' (role ' + target.role_id + ').';
    } else if (kind === 'password_reset') {
      title = 'Password reset: ' + who;
      detail = by + ' reset the password of ' + target.email + '; a temporary password was issued.';
    } else {
      title = 'Role changed: ' + who;
      detail = by + ' changed the role of ' + target.email + ' ' + extra + '.';
    }
    withLock_(function () {
      var nowMs = nowMs_();
      appendRow_(T.NOTIFICATIONS, notifRowFrom_({
        type: 'user_event', severity: 'update', dedupe_key: 'user|' + kind + '|' + target.user_id + '|' + nowMs,
        title: oneLine_(title, 200), detail: oneLine_(detail, 500), area_id: '', line_id: '', source_ref: target.user_id
      }, st, nowMs));
    });
  } catch (err) {
    notifLogFailure_('user event', err);
  }
}

function notifLogFailure_(what, err) {
  var msg = err && err.message ? err.message : String(err);
  try { console.error('Notification step failed (' + what + '): ' + msg); } catch (e) { /* ignore */ }
  try {
    withLock_(function () { auditLog_('system', 'notification_failed', T.NOTIFICATIONS, '', what + ': ' + msg); });
  } catch (e2) { /* the audit is best effort too */ }
}

// ---------- reads and per-user writes ----------

/**
 * 1.5.0: an alert about an area that is switched off is not shown (overdue actions are: the action itself stays visible).
 * It comes back when the area is switched on again and the alert has not expired.
 */
function notifOfInactiveArea_(n, inactive) {
  return !!n.area_id && !!inactive[n.area_id] && NOTIF_CATEGORY_[n.type] !== 'Actions';
}

/** 1.7.0: who a person is for the recipients column: their user id and whether they may close actions. */
function notifWho_(user, ast) {
  return { user_id: user.user_id, closer: isCloser_({ user: user }, ast || actionSettings_()) };
}

/** 1.7.0: blank recipients = everyone; else one of the user ids, or @closers for the closers and Admins. */
function notifForUser_(n, who) {
  var list = csv_(n.recipients);
  if (!list.length || !who) return !list.length;
  return list.some(function (r) { return r === '@closers' ? who.closer : r === who.user_id; });
}

function notifVisible_(n, access, stamp, who) {
  if (n.status !== 'open') return false;
  if (n.expires_at && n.expires_at <= stamp) return false;
  if (n.type === 'user_event' && access.users === 'Hidden') return false; // only people who can see the Users page
  return notifForUser_(n, who);
}

function prefsOf_(userId) {
  var out = {};
  readTable_(T.NOTIFICATION_PREFS, function (row, idx) { return row[idx.user_id] === userId; }).forEach(function (r) { out[r.key] = r.value; });
  return out;
}

/** The theme saved with the account ('' when none or not readable): sent at sign-in and with getMyAccess (1.5.0). */
function accountTheme_(userId) {
  try {
    var row = readTable_(T.NOTIFICATION_PREFS, function (r, idx) { return r[idx.user_id] === userId && r[idx.key] === 'theme'; })[0];
    var v = row ? String(row.value || '').trim() : '';
    return ACCOUNT_THEMES_.indexOf(v) >= 0 ? v : '';
  } catch (err) {
    return ''; // a missing sheet must never block a sign-in
  }
}

function getNotifications_(session) {
  var uid = session.user.user_id, stamp = nowTs_();
  var inactive = inactiveAreaIds_();
  var who = notifWho_(session.user);
  var items = readTable_(T.NOTIFICATIONS).filter(function (n) { return notifVisible_(n, session.access, stamp, who) && !notifOfInactiveArea_(n, inactive); })
    .sort(function (a, b) {
      return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : (a.notification_id < b.notification_id ? -1 : 1);
    });
  var ids = {};
  items.forEach(function (n) { ids[n.notification_id] = true; });
  var state = readTable_(T.NOTIFICATION_STATE, function (row, idx) { return row[idx.user_id] === uid; })
    .filter(function (s) { return ids[s.notification_id]; });
  items.forEach(function (n) { n.category = NOTIF_CATEGORY_[n.type] || 'System'; });
  return { items: items, state: state, prefs: prefsOf_(uid) };
}

function setNotificationState_(session, notificationId, state, snoozeUntil) {
  var id = cleanText_(notificationId, 'Notification', true, 60);
  if (notifEnum_(T.NOTIFICATION_STATE, 'state').indexOf(state) < 0) throw apiError_(ERR.BAD_REQUEST, 'State must be seen, snoozed or dismissed.');
  var until = '';
  if (state === 'snoozed') {
    if (typeof snoozeUntil !== 'string' || !snoozeUntil.trim()) throw apiError_(ERR.BAD_REQUEST, 'Choose how long to snooze.');
    var raw = snoozeUntil.trim();
    until = normTs_(isValidDate_(raw) ? raw + ' 00:00:00.000' : raw);
    if (until === null) throw apiError_(ERR.BAD_REQUEST, 'The snooze time is not valid.');
    var nowMs = nowMs_();
    if (until <= fmtTsMs_(nowMs)) throw apiError_(ERR.BAD_REQUEST, 'The snooze time must be in the future.');
    if (until > fmtTsMs_(nowMs + NOTIF_SNOOZE_MAX_DAYS_ * MS_DAY_)) throw apiError_(ERR.BAD_REQUEST, 'The snooze time is too far ahead.');
  }
  var uid = session.user.user_id;
  return withLock_(function () {
    var n = findBy_(T.NOTIFICATIONS, 'notification_id', id);
    if (!n || !notifVisible_(n, session.access, nowTs_(), notifWho_(session.user))) throw apiError_(ERR.NOT_FOUND, 'Notification not found.');
    var rec = { user_id: uid, notification_id: id, state: state, snooze_until: until, updated_at: nowTs_() };
    var mine = readTable_(T.NOTIFICATION_STATE, function (row, idx) { return row[idx.user_id] === uid && row[idx.notification_id] === id; })[0];
    if (mine) updateRow_(T.NOTIFICATION_STATE, mine._row, rec); else appendRow_(T.NOTIFICATION_STATE, rec);
    return rec;
  });
}

/** Saved views: JSON text, at most 20 of {id, name, page, query}. Returned as given (trimmed); blank clears them. */
function cleanSavedViews_(text) {
  if (text === '') return '';
  if (text.length > SAVED_VIEWS_TEXT_MAX_) throw apiError_(ERR.BAD_REQUEST, 'Saved views are too long.');
  var list;
  try { list = JSON.parse(text); } catch (e) { throw apiError_(ERR.BAD_REQUEST, 'Saved views are not readable.'); }
  if (!Array.isArray(list)) throw apiError_(ERR.BAD_REQUEST, 'Saved views must be a list.');
  if (list.length > SAVED_VIEWS_MAX_) throw apiError_(ERR.BAD_REQUEST, 'You can save at most ' + SAVED_VIEWS_MAX_ + ' views.');
  var seen = {};
  list.forEach(function (v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw apiError_(ERR.BAD_REQUEST, 'Each saved view must be an object.');
    Object.keys(v).forEach(function (k) {
      if (['id', 'name', 'page', 'query'].indexOf(k) < 0) throw apiError_(ERR.BAD_REQUEST, 'A saved view has an unknown field: ' + oneLine_(k, 40) + '.');
    });
    if (typeof v.id !== 'string' || !v.id || v.id.length > 40) throw apiError_(ERR.BAD_REQUEST, 'A saved view needs an id of 1 to 40 characters.');
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 60) throw apiError_(ERR.BAD_REQUEST, 'A saved view needs a name of 1 to 60 characters.');
    if (SAVED_VIEW_PAGES_.indexOf(v.page) < 0) throw apiError_(ERR.BAD_REQUEST, 'A saved view page must be one of: ' + SAVED_VIEW_PAGES_.join(', ') + '.');
    if (typeof v.query !== 'string' || v.query.length > 1500) throw apiError_(ERR.BAD_REQUEST, 'A saved view query must be text of at most 1500 characters.');
    if (seen[v.id]) throw apiError_(ERR.BAD_REQUEST, 'Two saved views have the same id.');
    seen[v.id] = true;
  });
  return text;
}

/** One list of short strings (lines, areas, equipment ...): at most 100, each 1 to 60 characters, no repeats. */
function cleanReportList_(list, label, allowed) {
  if (!Array.isArray(list)) throw apiError_(ERR.BAD_REQUEST, 'Report ' + label + ' must be a list.');
  if (list.length > REPORT_LIST_MAX_) throw apiError_(ERR.BAD_REQUEST, 'Report ' + label + ' has too many entries.');
  var seen = {};
  list.forEach(function (x) {
    if (typeof x !== 'string' || !x || x.length > 60) throw apiError_(ERR.BAD_REQUEST, 'Report ' + label + ' must be text of 1 to 60 characters.');
    if (allowed && allowed.indexOf(x) < 0) throw apiError_(ERR.BAD_REQUEST, 'Report ' + label + ' has an unknown value: ' + oneLine_(x, 40) + '.');
    if (seen[x]) throw apiError_(ERR.BAD_REQUEST, 'Report ' + label + ' repeats a value.');
    seen[x] = true;
  });
}

function onlyKeys_(obj, keys, what) {
  Object.keys(obj).forEach(function (k) {
    if (keys.indexOf(k) < 0) throw apiError_(ERR.BAD_REQUEST, what + ' has an unknown field: ' + oneLine_(k, 40) + '.');
  });
}

function plainObject_(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/** Saved report templates: JSON text, at most 20 of {id, name, template, period, filters, sections, options}. Returned as given; blank clears them. */
function cleanSavedReports_(text) {
  if (text === '') return '';
  if (text.length > SAVED_REPORTS_TEXT_MAX_) throw apiError_(ERR.BAD_REQUEST, 'Saved reports are too long.');
  var list;
  try { list = JSON.parse(text); } catch (e) { throw apiError_(ERR.BAD_REQUEST, 'Saved reports are not readable.'); }
  if (!Array.isArray(list)) throw apiError_(ERR.BAD_REQUEST, 'Saved reports must be a list.');
  if (list.length > SAVED_REPORTS_MAX_) throw apiError_(ERR.BAD_REQUEST, 'You can save at most ' + SAVED_REPORTS_MAX_ + ' report templates.');
  var seen = {};
  list.forEach(function (v) {
    if (!plainObject_(v)) throw apiError_(ERR.BAD_REQUEST, 'Each saved report must be an object.');
    onlyKeys_(v, ['id', 'name', 'template', 'period', 'filters', 'sections', 'options'], 'A saved report');
    if (typeof v.id !== 'string' || !v.id || v.id.length > 40) throw apiError_(ERR.BAD_REQUEST, 'A saved report needs an id of 1 to 40 characters.');
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 60) throw apiError_(ERR.BAD_REQUEST, 'A saved report needs a name of 1 to 60 characters.');
    if (REPORT_TEMPLATES_.indexOf(v.template) < 0) throw apiError_(ERR.BAD_REQUEST, 'A saved report template must be one of: ' + REPORT_TEMPLATES_.join(', ') + '.');
    // period
    var p = v.period;
    if (!plainObject_(p)) throw apiError_(ERR.BAD_REQUEST, 'A saved report needs a period.');
    onlyKeys_(p, ['preset', 'from', 'to', 'compare'], 'A saved report period');
    if (REPORT_PRESETS_.indexOf(p.preset) < 0) throw apiError_(ERR.BAD_REQUEST, 'A saved report period preset must be one of: ' + REPORT_PRESETS_.join(', ') + '.');
    ['from', 'to'].forEach(function (k) {
      if (typeof p[k] !== 'string' || (p[k] !== '' && !isValidDate_(p[k]))) throw apiError_(ERR.BAD_REQUEST, 'A saved report period ' + k + ' must be a date like 2026-03-05 or blank.');
    });
    if (p.from && p.to && p.from > p.to) throw apiError_(ERR.BAD_REQUEST, 'A saved report period must not end before it starts.');
    if (typeof p.compare !== 'boolean') throw apiError_(ERR.BAD_REQUEST, 'A saved report period compare must be true or false.');
    // filters
    var f = v.filters;
    if (!plainObject_(f)) throw apiError_(ERR.BAD_REQUEST, 'A saved report needs filters.');
    onlyKeys_(f, REPORT_FILTER_LISTS_.concat(['failuresOnly']), 'A saved report filter set');
    cleanReportList_(f.lines, 'lines');
    cleanReportList_(f.areas, 'areas');
    cleanReportList_(f.equipment, 'equipment');
    cleanReportList_(f.classifications, 'classifications', REPORT_CLASSES_);
    cleanReportList_(f.criticality, 'criticality', ['INC', 'NO_INC']);
    if (typeof f.failuresOnly !== 'boolean') throw apiError_(ERR.BAD_REQUEST, 'A saved report failuresOnly must be true or false.');
    // sections
    cleanReportList_(v.sections, 'sections', REPORT_SECTION_IDS_);
    // options: per section {top: 1..1000 or 'all', measure: 'hours' | 'count'}
    var o = v.options;
    if (!plainObject_(o)) throw apiError_(ERR.BAD_REQUEST, 'A saved report needs options.');
    Object.keys(o).forEach(function (sid) {
      if (REPORT_SECTION_IDS_.indexOf(sid) < 0) throw apiError_(ERR.BAD_REQUEST, 'A saved report has options for an unknown section: ' + oneLine_(sid, 40) + '.');
      var so = o[sid];
      if (!plainObject_(so)) throw apiError_(ERR.BAD_REQUEST, 'Report options of a section must be an object.');
      onlyKeys_(so, ['top', 'measure'], 'Report options');
      if (so.top !== undefined && so.top !== 'all' && !(typeof so.top === 'number' && so.top % 1 === 0 && so.top >= 1 && so.top <= 1000)) throw apiError_(ERR.BAD_REQUEST, 'Report option top must be a whole number from 1 to 1000 or "all".');
      if (so.measure !== undefined && so.measure !== 'hours' && so.measure !== 'count') throw apiError_(ERR.BAD_REQUEST, 'Report option measure must be hours or count.');
    });
    if (seen[v.id]) throw apiError_(ERR.BAD_REQUEST, 'Two saved reports have the same id.');
    seen[v.id] = true;
  });
  return text;
}

function cleanNotifPref_(key, value) {
  if (typeof value !== 'string') throw apiError_(ERR.BAD_REQUEST, 'Preference ' + key + ' must be text.');
  var v = value.trim();
  if (key === 'digest') {
    if (NOTIF_DIGEST_MODES_.indexOf(v) < 0) throw apiError_(ERR.BAD_REQUEST, 'Digest must be none, daily or weekly.');
    return v;
  }
  if (key === 'alert_types') {
    var types = notifEnum_(T.NOTIFICATIONS, 'type'), picked = [];
    csv_(v).forEach(function (t) {
      if (types.indexOf(t) < 0) throw apiError_(ERR.BAD_REQUEST, 'Unknown alert type: ' + oneLine_(t, 40) + '.');
      if (picked.indexOf(t) < 0) picked.push(t);
    });
    return picked.join(',');
  }
  if (key === 'watch_areas') {
    var lower = {};
    readTable_(T.AREAS).forEach(function (a) { lower[a.area_id.toLowerCase()] = a.area_id; });
    var chosen = [];
    csv_(v).forEach(function (a) {
      var real = lower[a.toLowerCase()];
      if (!real) throw apiError_(ERR.BAD_REQUEST, 'Area "' + oneLine_(a, 40) + '" is not in the list of areas.');
      if (chosen.indexOf(real) < 0) chosen.push(real);
    });
    return chosen.join(',');
  }
  if (key === 'theme') {
    if (v !== '' && ACCOUNT_THEMES_.indexOf(v) < 0) throw apiError_(ERR.BAD_REQUEST, 'Theme must be one of: ' + ACCOUNT_THEMES_.join(', ') + '.');
    return v;
  }
  if (key === 'saved_views') return cleanSavedViews_(v);
  if (key === 'saved_reports') return cleanSavedReports_(v);
  var ts = normTs_(v);
  if (ts === null) throw apiError_(ERR.BAD_REQUEST, 'Last seen must be a time like 2026-03-05 10:00:00.000.');
  return ts;
}

function saveNotificationPrefs_(session, prefs) {
  requireObject_(prefs, 'Preferences');
  var keys = Object.keys(prefs);
  if (!keys.length) throw apiError_(ERR.BAD_REQUEST, 'No changes to save.');
  var clean = {};
  keys.forEach(function (k) {
    if (NOTIF_PREF_KEYS_.indexOf(k) < 0) throw apiError_(ERR.BAD_REQUEST, 'Unknown preference: ' + oneLine_(k, 40) + '.');
    clean[k] = cleanNotifPref_(k, prefs[k]);
  });
  var uid = session.user.user_id;
  return withLock_(function () {
    var mine = readTable_(T.NOTIFICATION_PREFS, function (row, idx) { return row[idx.user_id] === uid; });
    var stamp = nowTs_();
    Object.keys(clean).forEach(function (k) {
      var row = mine.filter(function (r) { return r.key === k; })[0];
      var rec = { user_id: uid, key: k, value: clean[k], updated_at: stamp };
      if (row) updateRow_(T.NOTIFICATION_PREFS, row._row, rec); else appendRow_(T.NOTIFICATION_PREFS, rec);
    });
    return prefsOf_(uid);
  });
}

function setServerPref_(userId, key, value) {
  withLock_(function () {
    var row = readTable_(T.NOTIFICATION_PREFS, function (r, idx) { return r[idx.user_id] === userId && r[idx.key] === key; })[0];
    var rec = { user_id: userId, key: key, value: value, updated_at: nowTs_() };
    if (row) updateRow_(T.NOTIFICATION_PREFS, row._row, rec); else appendRow_(T.NOTIFICATION_PREFS, rec);
  });
}

// ---------- digest ----------

function htmlEscape_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Everything the digests need, read once. */
function digestContext_() {
  var st = notifSettings_();
  var stamp = nowTs_();
  var inactive = inactiveAreaIds_();
  var events = readTable_(T.EVENTS, function (row, idx) { return !toBool_(row[idx.is_void]) && !inactive[row[idx.area_id]]; });
  var validate = 0, blocked = 0, codes = 0;
  events.forEach(function (e) {
    if (!hasOpenProblem_(e)) return; // a record whose only problems are kept as entered is not counted
    validate++;
    var f = openFlags_(e);
    if (f.some(function (x) { return NOTIF_BLOCKING_FLAGS_.indexOf(x) >= 0; })) blocked++;
    if (f.indexOf('unknown_code') >= 0 || f.indexOf('placeholder') >= 0) codes++;
  });
  var prefsBy = {};
  readTable_(T.NOTIFICATION_PREFS).forEach(function (r) { (prefsBy[r.user_id] = prefsBy[r.user_id] || {})[r.key] = r.value; });
  var stateBy = {};
  readTable_(T.NOTIFICATION_STATE).forEach(function (r) { (stateBy[r.user_id] = stateBy[r.user_id] || {})[r.notification_id] = r.state; });
  return {
    st: st, stamp: stamp, today: stamp.slice(0, 10),
    users: readUsers_(), accessRows: readTable_(T.TAB_ACCESS), prefsBy: prefsBy, stateBy: stateBy, ast: actionSettings_(),
    alerts: readTable_(T.NOTIFICATIONS).filter(function (n) {
      return n.severity === 'alert' && n.status === 'open' && !(n.expires_at && n.expires_at <= stamp) && !notifOfInactiveArea_(n, inactive);
    }),
    counts: { validate: validate, blocked: blocked, codes: codes },
    needsReview: readTable_(T.EQUIPMENT).filter(function (e) { return e.needs_review; }).length
  };
}

function digestRank_(type) {
  var i = NOTIF_SEVERITY_ORDER_.indexOf(type);
  return i < 0 ? NOTIF_SEVERITY_ORDER_.length : i;
}

/**
 * The digest for one user, or null when there is nothing to say. Counts only (never event rows):
 * open action items the server can know for this person, and new alerts since the last digest
 * (at most 10, most severe first) that match the person's alert types and watched areas.
 */
function buildDigest_(user, dctx) {
  var prefs = dctx.prefsBy[user.user_id] || {};
  var mode = prefs.digest === 'daily' || prefs.digest === 'weekly' ? prefs.digest : 'none';
  var access = computeAccess_(user, dctx.accessRows);
  var actions = [];
  if (access.events === 'Edit') {
    if (dctx.counts.validate > 0) {
      actions.push(dctx.counts.validate + (dctx.counts.validate === 1 ? ' record' : ' records') + ' to validate' +
        (dctx.counts.blocked > 0 ? ' (' + dctx.counts.blocked + ' left out of the numbers)' : ''));
    }
  }
  if (access.master === 'Edit') {
    if (dctx.counts.codes > 0) actions.push(dctx.counts.codes + (dctx.counts.codes === 1 ? ' record' : ' records') + ' with an unknown or placeholder code');
    if (dctx.needsReview > 0) actions.push(dctx.needsReview + ' equipment ' + (dctx.needsReview === 1 ? 'item' : 'items') + ' to review');
  }
  var types = csv_(prefs.alert_types), watch = csv_(prefs.watch_areas);
  var since = prefs.last_digest_at || '';
  var dismissed = dctx.stateBy[user.user_id] || {};
  var who = notifWho_(user, dctx.ast);
  var alerts = dctx.alerts.filter(function (n) {
    if (!notifForUser_(n, who)) return false; // 1.7.0: alerts for some people only (recipients)
    if (since && n.created_at <= since) return false;
    if (types.length && types.indexOf(n.type) < 0) return false;
    if (watch.length && n.area_id && watch.indexOf(n.area_id) < 0) return false;
    return dismissed[n.notification_id] !== 'dismissed';
  }).sort(function (a, b) {
    return (digestRank_(a.type) - digestRank_(b.type)) || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0) ||
      (a.notification_id < b.notification_id ? -1 : 1);
  });
  if (!actions.length && !alerts.length) return null;
  var shown = alerts.slice(0, NOTIF_DIGEST_MAX_);
  var more = alerts.length - shown.length;
  var link = dctx.st.appUrl;
  var heading = 'ACC Downtime ' + (mode === 'weekly' ? 'weekly' : 'daily') + ' digest';
  var text = [heading, dctx.today, ''];
  var html = ['<h2 style="margin:0 0 4px">' + htmlEscape_(heading) + '</h2>', '<p style="margin:0 0 12px;color:#555">' + htmlEscape_(dctx.today) + '</p>'];
  if (actions.length) {
    text.push('Needs action'); actions.forEach(function (a) { text.push('- ' + a); }); text.push('');
    html.push('<h3 style="margin:12px 0 4px">Needs action</h3><ul>' + actions.map(function (a) { return '<li>' + htmlEscape_(a) + '</li>'; }).join('') + '</ul>');
  }
  if (alerts.length) {
    var h = 'New alerts (' + alerts.length + ')';
    text.push(h);
    shown.forEach(function (n) { text.push('- ' + n.title + (n.area_id ? ' [' + n.area_id + ']' : '')); });
    if (more > 0) text.push('and ' + more + ' more - open the app to see them all');
    text.push('');
    html.push('<h3 style="margin:12px 0 4px">' + htmlEscape_(h) + '</h3><ul>' + shown.map(function (n) {
      return '<li>' + htmlEscape_(n.title) + (n.area_id ? ' <span style="color:#555">[' + htmlEscape_(n.area_id) + ']</span>' : '') + '</li>';
    }).join('') + '</ul>' + (more > 0 ? '<p>and ' + more + ' more - open the app to see them all</p>' : ''));
  }
  if (link) {
    text.push('Open the app: ' + link, '');
    html.push('<p><a href="' + htmlEscape_(link) + '">Open the app</a></p>');
  }
  text.push('You get this email because you chose it in Settings > Notifications. Choose "none" there to stop it.');
  html.push('<p style="color:#555;font-size:12px">You get this email because you chose it in Settings &gt; Notifications. Choose "none" there to stop it.</p>');
  return {
    subject: heading + ' - ' + alerts.length + ' new ' + (alerts.length === 1 ? 'alert' : 'alerts') + ', ' + actions.length + ' ' + (actions.length === 1 ? 'item needs' : 'items need') + ' action',
    text: text.join('\n'), html: html.join('\n'), alertCount: alerts.length, shown: shown.length, actionLines: actions.length, mode: mode
  };
}

function digestAudit_(action, userId, detail) {
  try { withLock_(function () { auditLog_(userId || 'system', action, T.NOTIFICATIONS, '', detail); }); } catch (e) { /* best effort */ }
}

/**
 * Sends the digests that are due today: daily for people who chose daily, weekly (Sunday, plant time) for people
 * who chose weekly; only active users with an email who did not already get one today. Never throws: mail quota
 * or permission errors are written to the audit log. Returns { sent, skipped, failed }.
 */
function sendDigest_() {
  var out = { sent: 0, skipped: 0, failed: 0 };
  var dctx = digestContext_();
  var sunday = new Date(dateMs_(dctx.today)).getUTCDay() === 0;
  var stop = false;
  dctx.users.forEach(function (user) {
    if (stop) return;
    var prefs = dctx.prefsBy[user.user_id] || {};
    var mode = prefs.digest;
    if (!user.active || !user.email || (mode !== 'daily' && mode !== 'weekly')) return;
    if ((mode === 'weekly' && !sunday) || String(prefs.last_digest_at || '').slice(0, 10) === dctx.today) { out.skipped++; return; }
    var d = buildDigest_(user, dctx);
    if (!d) { out.skipped++; return; }
    try {
      if (typeof MailApp === 'undefined' && !mailSender_().email) throw new Error('Mail is not available (MailApp).');
      var left = remainingQuota_();
      if (left !== null && left < 1) {
        digestAudit_('digest_failed', user.user_id, 'Daily mail quota used up; no more digests today');
        out.failed++;
        stop = true;
        return;
      }
      // 1.9.0: through the one mail helper (Mail.js): the system email when it is set, else MailApp
      sendMail_({ to: [user.email], cc: [], subject: d.subject, text: d.text, html: d.html, attachments: [] });
    } catch (err) {
      out.failed++;
      digestAudit_('digest_failed', user.user_id, oneLine_(err && err.message ? err.message : err, 300));
      return;
    }
    out.sent++;
    try {
      setServerPref_(user.user_id, 'last_digest_at', nowTs_());
      digestAudit_('digest_sent', user.user_id, d.mode + ' digest: ' + d.alertCount + ' alerts, ' + d.actionLines + ' action lines');
    } catch (e) { /* the mail went out; the next run may repeat it only if the pref could not be saved */ }
  });
  return out;
}
