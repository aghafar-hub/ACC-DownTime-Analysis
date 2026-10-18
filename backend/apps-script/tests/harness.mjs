/**
 * Test harness: loads every backend file into one vm context with in-memory
 * mocks of the Apps Script services. Synthetic data only.
 */
import vm from 'node:vm';
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = resolve(here, '..');

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

// ---------- spreadsheet mock ----------

class MockRange {
  constructor(sheet, row, col, nr, nc) {
    if (row < 1 || col < 1 || nr < 1 || nc < 1) throw new Error('Invalid range');
    if (row + nr - 1 > sheet.maxRows || col + nc - 1 > sheet.maxCols) throw new Error('Range is outside the sheet grid');
    Object.assign(this, { sheet, row, col, nr, nc });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(values) {
    if (values.length !== this.nr || values.some((l) => l.length !== this.nc)) throw new Error('Dimensions do not match');
    this.sheet.stats.setValues++;
    for (let r = 0; r < this.nr; r++) {
      for (let c = 0; c < this.nc; c++) this.sheet.putCell(this.row + r, this.col + c, values[r][c]);
    }
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat(f) {
    for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sheet.formats.set(`${this.row + r},${this.col + c}`, f);
    return this;
  }
  setNumberFormats(fs) {
    fs.forEach((line, r) => line.forEach((f, c) => this.sheet.formats.set(`${this.row + r},${this.col + c}`, f)));
    return this;
  }
  setFontWeight() { return this; }
}

class MockSheet {
  constructor(name) {
    this.name = name; this.data = []; this.maxRows = 1000; this.maxCols = 26;
    this.formats = new Map(); this.stats = { setValues: 0 };
  }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_pos, n) { this.maxRows += n; }
  insertColumnsAfter(_pos, n) { this.maxCols += n; }
  setFrozenRows() {}
  getLastRow() {
    for (let r = this.data.length; r >= 1; r--) if ((this.data[r - 1] || []).some((v) => v !== '' && v !== undefined)) return r;
    return 0;
  }
  getLastColumn() {
    let last = 0;
    this.data.forEach((line) => (line || []).forEach((v, i) => { if (v !== '' && v !== undefined) last = Math.max(last, i + 1); }));
    return last;
  }
  getRange(r, c, nr = 1, nc = 1) { return new MockRange(this, r, c, nr, nc); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  /** Mimics Google Sheets: without Plain Text format, date-like text becomes a Date, number-like text a number. */
  putCell(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const line = this.data[r - 1];
    while (line.length < c) line.push('');
    const fmt = this.formats.get(`${r},${c}`);
    let stored = v;
    if (fmt === '@') {
      if (typeof v === 'number') stored = String(v);
    } else if (typeof v === 'string') {
      if (DATE_ONLY.test(v)) stored = new Date(v + 'T00:00:00Z');
      else if (DATE_TIME.test(v)) stored = new Date(v.replace(' ', 'T') + 'Z');
      else if (v.trim() !== '' && !isNaN(Number(v))) stored = Number(v);
    }
    line[c - 1] = stored;
  }
}

class MockSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getName() { return 'Test Spreadsheet'; }
  getSheetByName(n) { return this.sheets.get(n) || null; }
  insertSheet(n) { const s = new MockSheet(n); this.sheets.set(n, s); return s; }
}

// ---------- Utilities mock (signed bytes like the real service) ----------

const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const toBuf = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v.map((b) => b & 0xff)));

function fmtDate(date, tz, pattern) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return pattern
    .replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
    .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second)
    .replace('SSS', String(date.getUTCMilliseconds()).padStart(3, '0'));
}

function makeUtilities() {
  return {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    MacAlgorithm: { HMAC_SHA_256: 'HMAC_SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (_a, v) => toSigned(crypto.createHash('sha256').update(toBuf(v)).digest()),
    computeHmacSignature: (_a, v, k) => toSigned(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
    base64EncodeWebSafe: (v) => toBuf(v).toString('base64url') + '='.repeat((4 - (toBuf(v).toString('base64url').length % 4)) % 4),
    base64DecodeWebSafe: (s) => toSigned(Buffer.from(s, 'base64url')),
    newBlob: (bytes, contentType, name) => ({ getDataAsString: () => toBuf(bytes).toString('utf8'), contentType, name, size: toBuf(bytes).length }),
    base64Encode: (v) => toBuf(v).toString('base64'),
    base64Decode: (s) => toSigned(Buffer.from(s, 'base64')),
    getUuid: () => crypto.randomUUID(),
    formatDate: fmtDate,
  };
}

// ---------- environment ----------

export const ALL_FILES = () =>
  readdirSync(BACKEND_DIR).filter((f) => f.endsWith('.js')).sort((a, b) => (a === 'Schema.js' ? -1 : b === 'Schema.js' ? 1 : a.localeCompare(b)));

/**
 * Creates a fresh backend. Options: hashRounds (kept small so tests are fast),
 * prepare (default true: ensureSchema + seedDefaults + secrets).
 */
export function createEnv({ hashRounds = 25, prepare = true, files = ALL_FILES() } = {}) {
  const ss = new MockSpreadsheet();
  const props = new Map();
  const logs = [];
  const errors = [];
  const lockState = { busy: false, held: 0, tryCalls: [] };
  const clock = { now: Date.parse('2026-10-12T08:00:00Z') };
  // CacheService.getScriptCache(): a Map; cacheState.off = true makes the service unavailable (getScriptCache throws)
  const cacheState = { data: new Map(), off: false, puts: 0 };
  const scriptCache = {
    get: (k) => (cacheState.data.has(k) ? cacheState.data.get(k) : null),
    getAll: (keys) => Object.fromEntries(keys.filter((k) => cacheState.data.has(k)).map((k) => [k, cacheState.data.get(k)])),
    put: (k, v) => { cacheState.puts++; cacheState.data.set(k, String(v)); },
    remove: (k) => { cacheState.data.delete(k); },
  };

  const sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    Utilities: makeUtilities(),
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => { props.set(k, String(v)); },
        deleteProperty: (k) => { props.delete(k); },
        getKeys: () => [...props.keys()],
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: (ms) => { lockState.tryCalls.push(ms); if (lockState.busy) return false; lockState.held++; return true; },
        releaseLock: () => { lockState.held--; },
      }),
    },
    CacheService: {
      getScriptCache: () => { if (cacheState.off) throw new Error('Cache is not available'); return scriptCache; },
    },
    Logger: { log: (m) => { logs.push(String(m)); } },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (s) => ({ content: s, mime: null, getContent() { return this.content; }, setMimeType(m) { this.mime = m; return this; } }),
    },
    console: { error: (m) => { errors.push(String(m)); }, log() {} },
  };
  const ctx = vm.createContext(sandbox);
  for (const f of files) vm.runInContext(readFileSync(resolve(BACKEND_DIR, f), 'utf8'), ctx, { filename: f });
  vm.runInContext('nowMs_ = function () { return __clock.now; };', Object.assign(ctx, { __clock: clock }));

  const run = (code) => vm.runInContext(code, ctx);
  const json = (x) => JSON.parse(JSON.stringify(x));

  const env = {
    ctx, ss, props, logs, errors, lockState, clock, cacheState, run, json,
    sheet: (name) => ss.getSheetByName(name),
    /** Typed rows of a table, as plain JSON. */
    rows: (table) => json(ctx.readTable_(table)),
    /** Calls the router the way doPost does; returns the envelope as plain JSON. */
    call: (action, token, params = {}) => json(ctx.handleRequest_({ action, token, params })),
    /** Calls and returns data, throwing on error. */
    ok(action, token, params = {}) {
      const r = env.call(action, token, params);
      if (r.status !== 'ok') throw new Error(`${action} failed: ${r.error.code} ${r.error.message}`);
      return r.data;
    },
    advance: (ms) => { clock.now += ms; },
    setProp: (k, v) => props.set(k, v),
  };

  if (prepare) {
    props.set('SESSION_SIGNING_SECRET', 'test-signing-secret-0123456789-abcdef');
    props.set('PASSWORD_PEPPER', 'test-pepper-value-0123456789-abcdef');
    props.set('HASH_ROUNDS', String(hashRounds));
    ctx.ensureSchema();
    ctx.seedDefaults();
    logs.length = 0;
  }
  return env;
}

export const GOOD_PASSWORD = 'Correct-Horse-9';

/** Creates a user through the real admin flow and returns a session signed in with a chosen password. */
export function makeUser(env, adminToken, role, email, password = GOOD_PASSWORD) {
  const created = env.ok('createUser', adminToken, { u: { email, display_name: 'Test ' + role, role_id: role } });
  const first = env.ok('login', '', { email, password: created.temp_password, keepSignedIn: false });
  const session = env.ok('changePassword', first.token, { current: created.temp_password, next: password });
  return { user_id: created.user.user_id, email, password, session, token: session.token };
}

/** Creates the first admin (reads the one-time password from the log) and signs in. */
export function bootstrapAdmin(env, email = 'admin@example.com') {
  env.ctx.createFirstAdmin(email, 'Test Admin');
  const line = env.logs.find((l) => l.includes('Temporary password'));
  const temp = /now, write it down\): (\S+)/.exec(line)[1];
  const first = env.ok('login', '', { email, password: temp, keepSignedIn: false });
  const session = env.ok('changePassword', first.token, { current: temp, next: GOOD_PASSWORD });
  return { email, password: GOOD_PASSWORD, token: session.token, session, user_id: session.user.user_id };
}

// ---------- synthetic data helpers ----------

/** A small synthetic master: equipment codes, aliases, reasons. */
export function seedMaster(env, token) {
  env.ok('saveEquipment', token, { row: { equipment_id: '100.aa01', description: 'Test fan', criticality: 'High', status: 'Active' }, areaIds: ['K.1'] });
  env.ok('saveEquipment', token, { row: { equipment_id: '100.AB02', description: 'Test belt', criticality: 'Low', status: 'Active' }, areaIds: ['K.1', 'RM.1'] });
  env.ok('saveAlias', token, { row: { alias: '100.AA1', equipment_id: '100.AA01', reason: 'typo' } });
  env.ok('saveReason', token, { row: { reason_id: '', classification: 'MEC', text_as_listed: ' Bearing Failure ', order_no: 0, active: true } });
  env.ok('saveReason', token, { row: { reason_id: '', classification: 'ELE', text_as_listed: 'Motor trip', order_no: 0, active: true } });
}

let seq = 0;
/** One valid upload row; override any field. Each call gets different stop/start times unless given. */
export function uploadRow(over = {}) {
  seq++;
  const minute = String(seq % 60).padStart(2, '0');
  const hour = String(Math.floor(seq / 60) % 24).padStart(2, '0');
  return {
    source_row: 1000 + seq, event_date: '2026-03-05', line_id: 'L.1', area_id: 'K.1', code_raw: '100.AA01',
    stop_ts: `2026-03-05 ${hour}:${minute}:00.000`, start_ts: `2026-03-05 ${hour}:${minute}:30.000`,
    freq: 1, classification: 'MEC', criticality: 'INC', is_failure: true,
    reason_raw: 'Bearing failure', description: 'synthetic', fingerprint: '', ...over,
  };
}

export function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

export function startBatch(env, token, name = 'synthetic.xlsx') {
  return env.ok('uploadStart', token, { fileName: name, fileHash: sha256(name) }).batch_id;
}

// ---------- notification helpers ----------

/** A MailApp stub. `quota` is the daily quota; `failWith` makes every send throw that message. Returns the sent list. */
export function stubMailApp(env, { quota = 100, failWith = null } = {}) {
  const sent = [];
  env.ctx.MailApp = {
    getRemainingDailyQuota: () => quota - sent.length,
    sendEmail: (msg) => {
      if (failWith) throw new Error(failWith);
      sent.push(JSON.parse(JSON.stringify(msg)));
    },
  };
  return sent;
}

/**
 * A Gmail advanced-service stub (1.9.0). `aliases`: the verified Send-mail-as addresses (null = the list call fails);
 * `failWith` makes every send throw. Returns the sent list of { raw, mime } (mime = the decoded MIME text).
 */
export function stubGmail(env, { aliases = ['owner@example.com'], failWith = null } = {}) {
  const sent = [];
  env.ctx.Gmail = {
    Users: {
      Settings: {
        SendAs: {
          list: () => {
            if (aliases === null) throw new Error('Insufficient Permission');
            return { sendAs: aliases.map((a, i) => ({ sendAsEmail: a, isPrimary: i === 0, verificationStatus: i === 0 ? undefined : 'accepted' })) };
          },
        },
      },
      Messages: {
        send: (msg, user) => {
          if (failWith) throw new Error(failWith);
          sent.push({ raw: msg.raw, user, mime: Buffer.from(msg.raw, 'base64url').toString('utf8') });
          return { id: 'm' + sent.length };
        },
      },
    },
  };
  return sent;
}

/** A ScriptApp stub that keeps a list of triggers. `foreign` handler names start out installed (not ours). */
export function stubScriptApp(env, foreign = []) {
  const triggers = [];
  let id = 0;
  const make = (handler) => ({ handler, uid: ++id, getHandlerFunction() { return this.handler; }, getUniqueId() { return String(this.uid); } });
  foreign.forEach((h) => triggers.push(make(h)));
  env.ctx.ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
    newTrigger: (handler) => {
      const t = make(handler);
      const b = {
        timeBased() { t.kind = 'time'; return b; },
        everyDays(n) { t.everyDays = n; return b; },
        atHour(h) { t.atHour = h; return b; },
        inTimezone(tz) { t.timezone = tz; return b; },
        create() { triggers.push(t); return t; },
      };
      return b;
    },
  };
  return triggers;
}

/** Uploads rows through the real flow (start, chunk, finish). Returns the finished batch. */
export function uploadAll(env, token, rows, fileName = 'synthetic.xlsx') {
  const batchId = startBatch(env, token, fileName);
  const res = env.ok('uploadChunk', token, { batchId, rows });
  const batch = env.ok('uploadFinish', token, { batchId, summary: { rows_read: rows.length, rows_skipped: 0 }, warnings: [] });
  return { batch, res };
}
