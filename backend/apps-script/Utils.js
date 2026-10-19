/**
 * Sheet access, typing, JSON output and the script lock.
 * Rules: read whole ranges, write whole ranges, never touch cells one by one.
 * Columns are always found by header name, so column order does not matter.
 */

var LOCK_DEPTH_ = 0;

// ---------- time (functions so tests can replace the clock) ----------

function nowMs_() { return Date.now(); }
function nowDate_() { return new Date(nowMs_()); }
/** Plant-local timestamp text 'YYYY-MM-DD HH:MM:SS.mmm'. */
function nowTs_() { return Utilities.formatDate(nowDate_(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss.SSS'); }
function compactTs_(pattern) { return Utilities.formatDate(nowDate_(), TIMEZONE, pattern); }

// ---------- errors and output ----------

function apiError_(code, message) {
  var e = new Error(message);
  e.isApiError = true;
  e.code = code;
  e.accessDenied = code === ERR.FORBIDDEN;
  return e;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function okEnvelope_(data) { return { status: 'ok', data: data === undefined ? null : data }; }

function errorEnvelope_(code, message) {
  return { status: 'error', error: { message: message, code: code, accessDenied: code === ERR.FORBIDDEN } };
}

// ---------- lock ----------

/** Runs fn while holding the script lock; a busy lock gives the 'busy' error. */
function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) return fn();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw apiError_(ERR.BUSY, 'Server is busy - please try again.');
  LOCK_DEPTH_++;
  try {
    return fn();
  } finally {
    LOCK_DEPTH_--;
    lock.releaseLock();
  }
}

// ---------- properties and ids ----------

function getProp_(name) { return PropertiesService.getScriptProperties().getProperty(name) || ''; }

/** A required secret; short or missing values stop the server with a clear message. */
function getSecret_(name) {
  var v = getProp_(name);
  if (!v || v.length < MIN_SECRET_LENGTH) {
    throw apiError_(ERR.SERVER, 'The server is not set up yet (' + name + ' is missing or too short). See the README.');
  }
  return v;
}

function randomHex_(n) {
  var s = '';
  while (s.length < n) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, n);
}

function newId_(prefix, n) { return prefix + randomHex_(n || 12); }

// ---------- schema helpers ----------

function tableDef_(table) {
  var t = SCHEMA.tables[table];
  if (!t) throw new Error('Unknown table ' + table);
  return t;
}

function columnTypes_(table) {
  var m = {};
  tableDef_(table).columns.forEach(function (c) { m[c.name] = c.type; });
  return m;
}

function isTextual_(type) { return type === 'text' || type === 'date' || type === 'timestamp' || type === 'enum'; }

function getSpreadsheet_() {
  var id = getProp_(PROP.SPREADSHEET);
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw apiError_(ERR.SERVER, 'The server cannot find its spreadsheet. See the README.');
  return ss;
}

function getSheet_(table) {
  tableDef_(table);
  var sh = getSpreadsheet_().getSheetByName(table);
  if (!sh) throw apiError_(ERR.SERVER, 'The sheet "' + table + '" is missing. Run ensureSchema.');
  return sh;
}

function sheetHeaders_(sheet) {
  var n = sheet.getLastColumn();
  if (n < 1) return [];
  return sheet.getRange(1, 1, 1, n).getValues()[0].map(function (h) { return String(h); });
}

// ---------- typing ----------

function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

function fromSheet_(v, type) {
  if (type === 'bool') return v === true || v === 1 || String(v).toUpperCase() === 'TRUE';
  if (type === 'int' || type === 'float') {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(v);
    if (isNaN(n)) return null;
    return type === 'int' ? Math.trunc(n) : n;
  }
  if (isDate_(v)) {
    // Only happens if a cell lost its Plain Text format; keep the text form.
    return Utilities.formatDate(v, TIMEZONE, type === 'date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss.SSS');
  }
  return v === null || v === undefined ? '' : String(v);
}

/**
 * 1.10.0: text that starts with = + - or @ could run as a formula if its cell ever loses the Plain Text format. A leading
 * apostrophe keeps it text; Sheets does not return the apostrophe, so reading gives the text back unchanged.
 */
var FORMULA_START_ = /^\s*[=+\-@]/;

function toSheet_(v, type) {
  if (type === 'bool') return v === true || v === 'TRUE' || v === 1;
  if (type === 'int' || type === 'float') return v === null || v === undefined || v === '' ? '' : Number(v);
  var s = v === null || v === undefined ? '' : String(v);
  return FORMULA_START_.test(s) ? "'" + s : s;
}

function rowToObject_(types, headers, row, rowNum) {
  var o = {};
  for (var c = 0; c < headers.length; c++) o[headers[c]] = fromSheet_(row[c], types[headers[c]] || 'text');
  Object.defineProperty(o, '_row', { value: rowNum, enumerable: false });
  return o;
}

// ---------- reads ----------

/** All data rows as typed objects. where(rawRow, indexByHeader) may filter before typing. */
function readTable_(table, where) {
  var sheet = getSheet_(table);
  var headers = sheetHeaders_(sheet);
  var last = sheet.getLastRow();
  if (last < 2 || !headers.length) return [];
  var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  var types = columnTypes_(table);
  var idx = {};
  headers.forEach(function (h, i) { idx[h] = i; });
  var out = [];
  for (var i = 0; i < values.length; i++) {
    if (where && !where(values[i], idx)) continue;
    out.push(rowToObject_(types, headers, values[i], i + 2));
  }
  return out;
}

/** One column as typed values (fast: a single range read). */
function readColumn_(table, column) {
  var sheet = getSheet_(table);
  var headers = sheetHeaders_(sheet);
  var i = headers.indexOf(column);
  if (i < 0) throw new Error('Column ' + column + ' is missing in ' + table);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var type = columnTypes_(table)[column] || 'text';
  return sheet.getRange(2, i + 1, last - 1, 1).getValues().map(function (r) { return fromSheet_(r[0], type); });
}

function readRowAt_(table, rowNum) {
  var sheet = getSheet_(table);
  var headers = sheetHeaders_(sheet);
  var row = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
  return rowToObject_(columnTypes_(table), headers, row, rowNum);
}

function findBy_(table, field, value) {
  var rows = readTable_(table);
  for (var i = 0; i < rows.length; i++) if (rows[i][field] === value) return rows[i];
  return null;
}

// ---------- writes (caller holds the lock) ----------

/** A value read from the sheet, written back unchanged: formula-like text gets its apostrophe again (1.10.0). */
function keepCell_(v) {
  return typeof v === 'string' && FORMULA_START_.test(v) ? "'" + v : v;
}

function objectToRow_(table, headers, obj, existing) {
  var types = columnTypes_(table);
  return headers.map(function (h, i) {
    if (Object.prototype.hasOwnProperty.call(obj, h)) return toSheet_(obj[h], types[h] || 'text');
    return existing ? keepCell_(existing[i]) : '';
  });
}

/** Append many rows with one setValues call. */
function appendRows_(table, objs) {
  if (!objs.length) return;
  var sheet = getSheet_(table);
  var headers = sheetHeaders_(sheet);
  var start = Math.max(sheet.getLastRow(), 1) + 1;
  var values = objs.map(function (o) { return objectToRow_(table, headers, o, null); });
  var needed = start + values.length - 1;
  var grew = false;
  if (needed > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
    grew = true;
  }
  var range = sheet.getRange(start, 1, values.length, headers.length);
  if (grew) {
    var types = columnTypes_(table);
    var fmt = headers.map(function (h) { return isTextual_(types[h] || 'text') ? '@' : 'General'; });
    range.setNumberFormats(values.map(function () { return fmt; }));
  }
  range.setValues(values);
}

function appendRow_(table, obj) { appendRows_(table, [obj]); }

/** Change some fields of one row; other columns keep their values. */
function updateRow_(table, rowNum, patch) {
  var sheet = getSheet_(table);
  var headers = sheetHeaders_(sheet);
  var range = sheet.getRange(rowNum, 1, 1, headers.length);
  var existing = range.getValues()[0];
  range.setValues([objectToRow_(table, headers, patch, existing)]);
}

/**
 * 1.10.0: keeps the rows for which keep(typedRow) is true and removes the others with one write (and one delete of the
 * rows left over at the end), instead of deleting row by row. Caller holds the lock. Returns how many were removed.
 */
function keepRows_(table, keep) {
  var sheet = getSheet_(table);
  var headers = sheetHeaders_(sheet);
  var last = sheet.getLastRow();
  if (last < 2 || !headers.length) return 0;
  var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  var types = columnTypes_(table);
  var kept = values.filter(function (v, i) { return keep(rowToObject_(types, headers, v, i + 2)); });
  var removed = values.length - kept.length;
  if (!removed) return 0;
  if (kept.length) sheet.getRange(2, 1, kept.length, headers.length).setValues(kept.map(function (l) { return l.map(keepCell_); }));
  sheet.deleteRows(2 + kept.length, removed);
  return removed;
}

function deleteRows_(table, rowNums) {
  var sheet = getSheet_(table);
  rowNums.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sheet.deleteRow(r); });
}

/** Insert or update by a single key field. Returns 'added' or 'updated'. */
function upsertBy_(table, keyField, obj) {
  var existing = findBy_(table, keyField, obj[keyField]);
  if (existing) { updateRow_(table, existing._row, obj); return 'updated'; }
  appendRow_(table, obj);
  return 'added';
}

// ---------- small validators ----------

function cleanText_(v, label, required, max) {
  if (v === null || v === undefined) v = '';
  if (typeof v !== 'string') throw apiError_(ERR.BAD_REQUEST, label + ' must be text.');
  var s = v.trim();
  if (required && !s) throw apiError_(ERR.BAD_REQUEST, label + ' is required.');
  if (s.length > (max || TEXT_MAX)) throw apiError_(ERR.BAD_REQUEST, label + ' is too long.');
  return s;
}

function requireObject_(v, label) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw apiError_(ERR.BAD_REQUEST, label + ' is missing.');
  return v;
}

function toBool_(v) { return v === true || v === 'TRUE' || v === 'true'; }
function toIntOr_(v, dflt) { var n = Number(v); return isNaN(n) || v === '' || v === null ? dflt : Math.trunc(n); }

// ---------- code / text normalisation (same rules as the browser) ----------

function codeKey_(code) {
  return String(code === null || code === undefined ? '' : code).toUpperCase().replace(/\s+/g, '').replace(/\.{2,}/g, '.');
}

function matchKey_(text) {
  return String(text === null || text === undefined ? '' : text).trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Parse 'YYYY-MM-DD HH:MM:SS[.mmm]' as a plant-local clock reading; returns ms or null. */
function parseTs_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(typeof s === 'string' ? s.trim() : '');
  if (!m) return null;
  var ms = m[7] ? Number((m[7] + '00').slice(0, 3)) : 0;
  var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
  var d = new Date(t);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] ||
      +m[4] > 23 || +m[5] > 59 || +m[6] > 59) return null;
  return t;
}

/** Canonical 'YYYY-MM-DD HH:MM:SS.mmm' or null. */
function normTs_(s) {
  var t = parseTs_(s);
  if (t === null) return null;
  var d = new Date(t);
  function p(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1, 2) + '-' + p(d.getUTCDate(), 2) + ' ' +
    p(d.getUTCHours(), 2) + ':' + p(d.getUTCMinutes(), 2) + ':' + p(d.getUTCSeconds(), 2) + '.' + p(d.getUTCMilliseconds(), 3);
}

function isValidDate_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
  if (!m) return false;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
