// In-memory implementation of the whole Api interface. It behaves like the
// server (docs/wire-protocol.md): same access rules per action, same
// normalisation, edit and void semantics, user administration and temporary
// passwords. Data lives in memory only: a page reload starts again.
import type {
  Access, AccessLevel, AdminUser, Api, Area, ClassificationCode, Equipment, EquipmentAlias, EventChanges,
  EventRow, Reason, Session, SessionUser, TabId, UploadRow,
} from './types';
import { ApiError, TAB_IDS } from './types';
import { buildSyntheticDb, fmtTs, type MockUser, type SyntheticDb } from '../mock/synthetic';
import {
  buildLookup, codeKey, durationSeconds, eventIdOf, isValidDate, matchKey, mergeFlags, parseTs, resolveRow,
} from '../util/normalize';

const LEVEL_RANK: Record<AccessLevel, number> = { Hidden: 0, View: 1, Edit: 2 };
const CLASS_CODES: ClassificationCode[] = ['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'];
const EDITABLE: string[] = [
  'event_date', 'line_id', 'area_id', 'code_raw', 'stop_ts', 'start_ts', 'freq', 'classification', 'criticality', 'is_failure', 'reason_raw', 'description',
];
const DASHBOARD_TABS: TabId[] = ['overview', 'pareto', 'repeats', 'reliability', 'events'];

const BAD_LOGIN = 'Email or password is not correct.';

function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

function randomTempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

export interface MockApi extends Api {
  /** Test helpers: the live data and a clock override. Not part of Api. */
  __db(): SyntheticDb;
  __setNow(fn: () => number): void;
}

export function createMockApi(opts: { seed?: number } = {}): MockApi {
  let db: SyntheticDb | null = null;
  let now: () => number = () => Date.now();
  let counter = 0;

  const get = (): SyntheticDb => {
    if (!db) {
      db = buildSyntheticDb(opts.seed);
      seedHistory(db);
    }
    return db;
  };

  const p2 = (n: number, l = 2) => String(n).padStart(l, '0');
  const nowTs = (): string => {
    const d = new Date(now());
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p2(d.getMilliseconds(), 3)}`;
  };
  const setting = (key: string): string => get().settings.find((s) => s.key === key)?.value ?? '';
  const numSetting = (key: string, fallback: number): number => {
    const n = Number(setting(key));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const audit = (userId: string | undefined, action: string, entity: string, entityId: string, detail: string) => {
    get().audit_log.push({ at: nowTs(), user_id: userId, action, entity, entity_id: entityId, detail });
  };

  // ------------------------------------------------------------ access
  function roleLevel(roleId: string, tab: TabId): AccessLevel {
    const row = get().tab_access.find((r) => r.subject_type === 'role' && r.subject_id === roleId && r.tab_id === tab);
    return (row?.level as AccessLevel) ?? 'Hidden';
  }
  function accessFor(u: MockUser): Access {
    const out = {} as Access;
    for (const t of TAB_IDS) out[t] = u.overrides[t] ?? roleLevel(u.role_id, t);
    return out;
  }
  const sessionUser = (u: MockUser): SessionUser => ({ user_id: u.user_id, email: u.email, display_name: u.display_name, role_id: u.role_id });
  const adminUser = (u: MockUser): AdminUser => ({
    ...sessionUser(u), active: u.active, must_change: u.must_change, last_login_at: u.last_login_at,
    overrides: Object.keys(u.overrides).length ? { ...u.overrides } : undefined,
  });

  function makeSession(u: MockUser, lifetimeMs: number): Session {
    const iat = now();
    const exp = iat + lifetimeMs;
    const payload = b64urlEncode(JSON.stringify({ uid: u.user_id, role: u.role_id, iat, exp }));
    return {
      token: `${payload}.mock`, expires_at: new Date(exp).toISOString(), user: sessionUser(u),
      must_change: u.must_change, access: accessFor(u),
    };
  }

  function auth(token: string, allowMustChange = false): { user: MockUser; access: Access; iat: number; exp: number } {
    const fail = () => new ApiError('Your session has ended. Please sign in again.', 'unauthenticated');
    if (!token) throw fail();
    const [payloadB64, sig] = String(token).split('.');
    if (!payloadB64 || sig !== 'mock') throw fail();
    let payload: { uid?: string; iat?: number; exp?: number };
    try { payload = JSON.parse(b64urlDecode(payloadB64)); } catch { throw fail(); }
    if (!payload.exp || payload.exp <= now()) throw fail();
    const user = get().users.find((u) => u.user_id === payload.uid);
    if (!user || !user.active) throw fail();
    if (user.must_change && !allowMustChange) {
      throw new ApiError('You must set a new password before you continue.', 'forbidden', true);
    }
    return { user, access: accessFor(user), iat: payload.iat ?? 0, exp: payload.exp };
  }

  function need(token: string, tabs: TabId[], level: 'View' | 'Edit'): { user: MockUser; access: Access } {
    const a = auth(token);
    const ok = tabs.some((t) => LEVEL_RANK[a.access[t]] >= LEVEL_RANK[level]);
    if (!ok) throw new ApiError('You do not have access to this.', 'forbidden', true);
    return a;
  }

  const clone = <T,>(x: T): T => structuredClone(x);
  const lookup = () => buildLookup({ equipment: get().equipment, equipment_areas: get().equipment_areas, aliases: get().aliases, reasons: get().reasons, areas: get().areas });

  // ------------------------------------------------------------ editing
  function applyEdit(userId: string, eventId: string, changes: EventChanges, note: string, at: string): EventRow {
    const d = get();
    const ev = d.events.find((e) => e.event_id === eventId);
    if (!ev) throw new ApiError('That event was not found.', 'not_found');
    if (!String(note ?? '').trim()) throw new ApiError('Please write a short note saying why you are changing this event.', 'bad_request');
    if (ev.is_void) throw new ApiError('This event is voided. Restore it before you edit it.', 'conflict');
    const incoming = changes as Record<string, unknown>;
    for (const k of Object.keys(incoming)) {
      if (!EDITABLE.includes(k)) throw new ApiError(`The field "${k}" cannot be edited.`, 'bad_request');
    }
    const next: Record<string, unknown> = {};
    const bad = (m: string) => new ApiError(m, 'bad_request');
    for (const k of Object.keys(incoming)) {
      const v = incoming[k];
      switch (k) {
        case 'event_date':
          if (!isValidDate(String(v))) throw bad('The date must look like 2026-03-15.');
          next[k] = String(v); break;
        case 'stop_ts': case 'start_ts': {
          const t = parseTs(String(v));
          if (t === null) throw bad('Stop and restart times must look like 2026-03-15 13:45:00.');
          next[k] = fmtTs(t); break;
        }
        case 'area_id':
          if (!d.areas.some((a) => a.area_id === v)) throw bad(`The area "${String(v)}" does not exist.`);
          next[k] = v; break;
        case 'line_id':
          if (!d.lines.some((l) => l.line_id === v)) throw bad(`The line "${String(v)}" does not exist.`);
          next[k] = v; break;
        case 'code_raw':
          if (!String(v ?? '').trim()) throw bad('The equipment code cannot be empty. Use N/A when the whole area stopped.');
          next[k] = String(v).trim(); break;
        case 'freq':
          if (v !== 0 && v !== 1) throw bad('Frequency must be 1 (a new stop) or 0 (continues the stop above).');
          next[k] = v; break;
        case 'classification': {
          const c = String(v ?? '').toUpperCase();
          if (!CLASS_CODES.includes(c as ClassificationCode)) throw bad('Classification must be one of PRO, MEC, ELE, AUT, PL or CIR.');
          next[k] = c; break;
        }
        case 'criticality':
          if (v !== 'INC' && v !== 'NO_INC') throw bad('Criticality must be INC (incident) or NO_INC.');
          next[k] = v; break;
        case 'is_failure':
          if (typeof v !== 'boolean') throw bad('Failure must be yes or no.');
          next[k] = v; break;
        default: // reason_raw, description
          next[k] = String(v ?? '').trim() || undefined;
      }
    }
    // area and line must agree
    const area = d.areas.find((a) => a.area_id === (next.area_id ?? ev.area_id))!;
    if (next.area_id && next.line_id === undefined && !('line_id' in incoming)) next.line_id = area.line_id;
    const lineNow = (next.line_id ?? ev.line_id) as string;
    if (('area_id' in incoming || 'line_id' in incoming) && area.line_id !== lineNow) {
      throw bad(`Area ${area.area_id} belongs to line ${area.line_id}, not ${lineNow}.`);
    }
    // derived values (wire-protocol section 6)
    if ('classification' in next && !('criticality' in incoming)) {
      const cl = d.classifications.find((c) => c.code === next.classification)!;
      next.criticality = cl.is_incident ? 'INC' : 'NO_INC';
    }
    const critChanged = next.criticality !== undefined && next.criticality !== ev.criticality;
    const freqChanged = next.freq !== undefined && next.freq !== ev.freq;
    if ((critChanged || freqChanged) && !('is_failure' in incoming)) {
      next.is_failure = (next.criticality ?? ev.criticality) === 'INC' && (next.freq ?? ev.freq) === 1;
    }
    // what really changed
    const changed = Object.keys(next).filter((k) => (ev as unknown as Record<string, unknown>)[k] !== next[k]
      && !((ev as unknown as Record<string, unknown>)[k] === undefined && next[k] === undefined));
    if (changed.length === 0) throw bad('Nothing was changed.');

    const before = { ...ev } as unknown as Record<string, unknown>;
    Object.assign(ev, next);
    const dur = durationSeconds(ev.stop_ts, ev.start_ts);
    ev.duration_s = dur ?? 0;
    const res = resolveRow(lookup(), ev);
    ev.equipment_id = res.equipment_id;
    ev.is_area_level = res.is_area_level;
    ev.reason_id = res.reason_id;
    ev.flags = mergeFlags(ev.flags, res.flags) || undefined;
    ev.edited = true;

    const order = EDITABLE.filter((f) => changed.includes(f));
    order.forEach((f) => {
      const asText = (x: unknown) => (x === undefined || x === null ? undefined : String(x === true ? 'TRUE' : x === false ? 'FALSE' : x));
      d.event_edits.push({
        edit_id: `ED-${at.replace(/\D/g, '').slice(0, 14)}-${++counter}`, event_id: ev.event_id, edited_at: at, edited_by: userId,
        field: f, old_value: asText(before[f]), new_value: asText(ev[f as keyof EventRow]), note: String(note).trim(),
      });
    });
    d.audit_log.push({ at, user_id: userId, action: 'editEvent', entity: 'events', entity_id: ev.event_id, detail: `Changed ${order.join(', ')}. ${String(note).trim()}` });
    return ev;
  }

  function applyVoid(userId: string, eventId: string, isVoid: boolean, note: string, at: string): EventRow {
    const d = get();
    const ev = d.events.find((e) => e.event_id === eventId);
    if (!ev) throw new ApiError('That event was not found.', 'not_found');
    if (!String(note ?? '').trim()) throw new ApiError('Please write a short note saying why.', 'bad_request');
    if (typeof isVoid !== 'boolean') throw new ApiError('Void must be yes or no.', 'bad_request');
    if (ev.is_void === isVoid) throw new ApiError(isVoid ? 'This event is already voided.' : 'This event is not voided.', 'conflict');
    ev.is_void = isVoid;
    d.event_edits.push({
      edit_id: `ED-${at.replace(/\D/g, '').slice(0, 14)}-${++counter}`, event_id: ev.event_id, edited_at: at, edited_by: userId,
      field: 'is_void', old_value: isVoid ? 'FALSE' : 'TRUE', new_value: isVoid ? 'TRUE' : 'FALSE', note: String(note).trim(),
    });
    d.audit_log.push({ at, user_id: userId, action: isVoid ? 'voidEvent' : 'restoreEvent', entity: 'events', entity_id: ev.event_id, detail: String(note).trim() });
    return ev;
  }

  /** A few edited and voided rows, as a long-running installation would have. */
  function seedHistory(d: SyntheticDb) {
    const eng = 'U-DEMO-ENG';
    const clean = d.events.filter((e) => e.event_date >= '2026-03-01' && !e.flags && e.freq === 1 && !e.is_area_level && e.classification !== 'PL');
    const at = (n: number) => `2026-10-0${n} 0${6 + n}:20:00.000`;
    const step = Math.floor(clean.length / 10);
    const pickAt = (i: number) => clean[step * (i + 1)];
    applyEdit(eng, pickAt(0).event_id, { description: 'Corrected after the shift report' }, 'Description corrected from the shift report (synthetic).', at(1));
    const e1 = pickAt(1);
    applyEdit(eng, e1.event_id, { classification: e1.classification === 'ELE' ? 'MEC' : 'ELE', reason_raw: e1.classification === 'ELE' ? 'Belt torn' : 'Cable fault' }, 'Wrong classification entered at source (synthetic).', at(2));
    const e2 = pickAt(2);
    applyEdit(eng, e2.event_id, { start_ts: fmtTs((parseTs(e2.start_ts) ?? 0) + 15 * 60_000) }, 'Restart time corrected from the control-room log (synthetic).', at(3));
    applyVoid(eng, pickAt(3).event_id, true, 'Duplicate of another record (synthetic).', at(4));
    applyVoid(eng, pickAt(4).event_id, true, 'Entered in the wrong area (synthetic).', at(4));
    const e5 = pickAt(5);
    applyVoid(eng, e5.event_id, true, 'Voided by mistake (synthetic).', at(5));
    applyVoid(eng, e5.event_id, false, 'Restored, the stop did happen (synthetic).', at(6));
    d.audit_log.length = 0; // history above is only for the explorer's demo
  }

  // ------------------------------------------------------------ the Api
  const api: MockApi = {
    __db: () => get(),
    __setNow: (fn) => { now = fn; },

    // --- auth
    async login(email, password, keepSignedIn) {
      const d = get();
      const user = d.users.find((u) => u.email === String(email ?? '').trim().toLowerCase());
      if (!user || !user.active) throw new ApiError(BAD_LOGIN, 'bad_credentials');
      if (user.locked_until && user.locked_until > now()) {
        const mins = Math.max(1, Math.ceil((user.locked_until - now()) / 60_000));
        throw new ApiError(`Too many wrong passwords. This account is locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 'locked');
      }
      if (user.password !== password) {
        user.failed_attempts += 1;
        if (user.failed_attempts >= numSetting('lockout_attempts', 5)) {
          user.locked_until = now() + numSetting('lockout_minutes', 15) * 60_000;
          user.failed_attempts = 0;
        }
        throw new ApiError(BAD_LOGIN, 'bad_credentials');
      }
      user.failed_attempts = 0;
      user.locked_until = undefined;
      user.last_login_at = nowTs();
      audit(user.user_id, 'login', 'users', user.user_id, 'Signed in');
      const hours = keepSignedIn ? numSetting('session_hours_keep', 720) : numSetting('session_hours', 12);
      return clone(makeSession(user, hours * 3_600_000));
    },
    async changePassword(token, current, next) {
      const a = auth(token, true);
      if (a.user.password !== current) throw new ApiError('Your current password is not correct.', 'bad_credentials');
      const min = numSetting('min_password_length', 10);
      if (String(next ?? '').length < min) throw new ApiError(`Use at least ${min} characters.`, 'bad_request');
      if (next === current) throw new ApiError('The new password must be different from the current one.', 'bad_request');
      a.user.password = next;
      a.user.must_change = false;
      audit(a.user.user_id, 'changePassword', 'users', a.user.user_id, 'Password changed');
      return clone(makeSession(a.user, a.exp - a.iat));
    },
    async getMyAccess(token) {
      const a = auth(token, true);
      return clone({ user: sessionUser(a.user), access: a.access, must_change: a.user.must_change });
    },

    // --- reads
    async getStartup(token) {
      const a = auth(token);
      if (!TAB_IDS.some((t) => LEVEL_RANK[a.access[t]] > 0)) throw new ApiError('You do not have access to this.', 'forbidden', true);
      const d = get();
      const years = [...new Set(d.events.map((e) => Number(e.event_date.slice(0, 4))))].sort((x, y) => y - x);
      return clone({
        lines: d.lines, areas: d.areas, equipment: d.equipment, equipment_areas: d.equipment_areas, aliases: d.aliases,
        classifications: d.classifications, reasons: d.reasons, settings: d.settings, years,
      });
    },
    async getEvents(token, year) {
      need(token, DASHBOARD_TABS, 'View');
      if (!Number.isInteger(year) || year < 1990 || year > 2200) throw new ApiError('Please give a year such as 2026.', 'bad_request');
      const prefix = `${year}-`;
      return clone(get().events.filter((e) => e.event_date.startsWith(prefix)).sort((x, y) => x.stop_ts.localeCompare(y.stop_ts) || x.area_id.localeCompare(y.area_id)));
    },
    async getEventEdits(token, eventId) {
      need(token, ['events'], 'View');
      return clone(get().event_edits.filter((e) => e.event_id === eventId).sort((x, y) => x.edited_at.localeCompare(y.edited_at)));
    },
    async getUploadHistory(token) {
      need(token, ['upload'], 'View');
      return clone([...get().upload_batches].sort((x, y) => y.uploaded_at.localeCompare(x.uploaded_at)));
    },
    async getUploadWarnings(token, batchId) {
      need(token, ['upload'], 'View');
      if (!get().upload_batches.some((b) => b.batch_id === batchId)) throw new ApiError('That upload was not found.', 'not_found');
      return clone(get().upload_warnings.filter((w) => w.batch_id === batchId));
    },

    // --- upload
    async uploadStart(token, fileName, fileHash) {
      const a = need(token, ['upload'], 'Edit');
      const t = nowTs();
      const id = `B-${t.slice(0, 10).replace(/-/g, '')}-${t.slice(11, 19).replace(/:/g, '')}-${(0x1000 + (++counter % 0xefff)).toString(16)}`;
      get().upload_batches.push({
        batch_id: id, uploaded_by: a.user.user_id, uploaded_at: t, file_name: String(fileName ?? ''), file_hash: String(fileHash ?? ''),
        rows_read: 0, rows_added: 0, rows_identical: 0, rows_skipped: 0, warning_count: 0, status: 'Started',
      });
      audit(a.user.user_id, 'uploadStart', 'upload_batches', id, `Upload of ${fileName} started`);
      return { batch_id: id };
    },
    async uploadChunk(token, batchId, rows) {
      need(token, ['upload'], 'Edit');
      const d = get();
      const batch = d.upload_batches.find((b) => b.batch_id === batchId);
      if (!batch) throw new ApiError('That upload was not found.', 'not_found');
      if (batch.status !== 'Started') throw new ApiError('This upload is already finished.', 'conflict');
      if (!Array.isArray(rows)) throw new ApiError('No rows were sent.', 'bad_request');
      const known = new Set(d.events.map((e) => e.fingerprint));
      const look = lookup();
      const rejected: { source_row: number; reason: string }[] = [];
      let added = 0, identical = 0;
      for (const r of rows as UploadRow[]) {
        const why = validateUploadRow(r, d);
        if (why) { rejected.push({ source_row: r.source_row, reason: why }); continue; }
        if (known.has(r.fingerprint)) { identical++; continue; }
        const cls = String(r.classification).toUpperCase() as ClassificationCode;
        const stop = fmtTs(parseTs(r.stop_ts)!), start = fmtTs(parseTs(r.start_ts)!);
        const res = resolveRow(look, { area_id: r.area_id, code_raw: r.code_raw, classification: cls, reason_raw: r.reason_raw, stop_ts: stop, start_ts: start });
        d.events.push({
          event_id: eventIdOf(r.fingerprint), batch_id: batchId, event_date: r.event_date, line_id: r.line_id, area_id: r.area_id,
          code_raw: String(r.code_raw).trim(), equipment_id: res.equipment_id, is_area_level: res.is_area_level, stop_ts: stop, start_ts: start,
          duration_s: durationSeconds(stop, start) ?? 0, freq: r.freq, classification: cls, criticality: r.criticality, is_failure: !!r.is_failure,
          reason_raw: String(r.reason_raw ?? '').trim() || undefined, reason_id: res.reason_id, description: String(r.description ?? '').trim() || undefined,
          source_file: batch.file_name, source_row: r.source_row, fingerprint: r.fingerprint, flags: res.flags.join(',') || undefined,
          edited: false, is_void: false, created_at: nowTs(),
        });
        known.add(r.fingerprint);
        added++;
      }
      batch.rows_added += added;
      batch.rows_identical += identical;
      return { added, identical, rejected };
    },
    async uploadFinish(token, batchId, summary, warnings) {
      const a = need(token, ['upload'], 'Edit');
      const d = get();
      const batch = d.upload_batches.find((b) => b.batch_id === batchId);
      if (!batch) throw new ApiError('That upload was not found.', 'not_found');
      if (batch.status === 'Completed') return clone(batch);
      let n = 0;
      for (const w of warnings ?? []) {
        d.upload_warnings.push({ ...w, warning_id: `W-${batchId}-${++n}`, batch_id: batchId });
      }
      batch.rows_read = Number(summary?.rows_read) || 0;
      batch.rows_skipped = Number(summary?.rows_skipped) || 0;
      batch.warning_count = n;
      batch.status = 'Completed';
      audit(a.user.user_id, 'uploadFinish', 'upload_batches', batchId, `${batch.rows_added} rows added, ${batch.rows_identical} identical`);
      return clone(batch);
    },

    // --- event correction
    async editEvent(token, eventId, changes, note) {
      const a = need(token, ['events'], 'Edit');
      return clone(applyEdit(a.user.user_id, eventId, changes, note, nowTs()));
    },
    async voidEvent(token, eventId, isVoid, note) {
      const a = need(token, ['events'], 'Edit');
      return clone(applyVoid(a.user.user_id, eventId, isVoid, note, nowTs()));
    },

    // --- master data
    async saveEquipment(token, row, areaIds) {
      const a = need(token, ['master'], 'Edit');
      const d = get();
      const id = codeKey(row?.equipment_id);
      if (!id) throw new ApiError('The equipment code cannot be empty.', 'bad_request');
      if (id === 'N/A' || id === 'NA') throw new ApiError('N/A is reserved for "the whole area stopped". Use a real equipment code.', 'bad_request');
      if (row.status !== 'Active' && row.status !== 'Retired') throw new ApiError('Status must be Active or Retired.', 'bad_request');
      for (const ar of areaIds ?? []) if (!d.areas.some((x) => x.area_id === ar)) throw new ApiError(`The area "${ar}" does not exist.`, 'bad_request');
      const next: Equipment = { ...row, equipment_id: id, updated_at: nowTs(), updated_by: a.user.user_id };
      const at = d.equipment.findIndex((e) => e.equipment_id === id);
      if (at >= 0) d.equipment[at] = { ...d.equipment[at], ...next };
      else d.equipment.push({ ...next, created_at: nowTs() });
      d.equipment_areas = d.equipment_areas.filter((x) => x.equipment_id !== id);
      for (const ar of new Set(areaIds ?? [])) d.equipment_areas.push({ equipment_id: id, area_id: ar });
      audit(a.user.user_id, 'saveEquipment', 'equipment', id, at >= 0 ? 'Equipment changed' : 'Equipment added');
    },
    async saveArea(token, row) {
      const a = need(token, ['master'], 'Edit');
      const d = get();
      const id = String(row?.area_id ?? '').trim();
      if (!id) throw new ApiError('The area code cannot be empty.', 'bad_request');
      if (!String(row.name ?? '').trim()) throw new ApiError('The area needs a name.', 'bad_request');
      if (!d.lines.some((l) => l.line_id === row.line_id)) throw new ApiError(`The line "${row.line_id}" does not exist.`, 'bad_request');
      const next: Area = { ...row, area_id: id, name: row.name.trim() };
      const at = d.areas.findIndex((x) => x.area_id === id);
      if (at >= 0) d.areas[at] = { ...d.areas[at], ...next };
      else d.areas.push(next);
      audit(a.user.user_id, 'saveArea', 'areas', id, at >= 0 ? 'Area changed' : 'Area added');
    },
    async saveReason(token, row) {
      const a = need(token, ['master'], 'Edit');
      const d = get();
      if (!CLASS_CODES.includes(row?.classification)) throw new ApiError('Classification must be one of PRO, MEC, ELE, AUT, PL or CIR.', 'bad_request');
      if (!String(row.text_as_listed ?? '').trim()) throw new ApiError('The reason text cannot be empty.', 'bad_request');
      const mk = matchKey(row.text_as_listed);
      const clash = d.reasons.find((r) => r.classification === row.classification && r.match_key === mk && r.reason_id !== row.reason_id);
      if (clash) throw new ApiError(`That reason is already listed as ${clash.reason_id}.`, 'conflict');
      let id = row.reason_id;
      if (!id) {
        const order = Math.max(0, ...d.reasons.filter((r) => r.classification === row.classification).map((r) => r.order_no)) + 1;
        id = `R-${row.classification}-${String(order).padStart(3, '0')}`;
        row = { ...row, order_no: order };
      }
      const next: Reason = { ...row, reason_id: id, match_key: mk };
      const at = d.reasons.findIndex((r) => r.reason_id === id);
      if (at >= 0) d.reasons[at] = next; else d.reasons.push(next);
      audit(a.user.user_id, 'saveReason', 'reasons', id, at >= 0 ? 'Reason changed' : 'Reason added');
    },
    async saveAlias(token, row) {
      const a = need(token, ['master'], 'Edit');
      const d = get();
      const alias = codeKey(row?.alias);
      if (!alias) throw new ApiError('The alias cannot be empty.', 'bad_request');
      if (!d.equipment.some((e) => e.equipment_id === row.equipment_id)) throw new ApiError(`The equipment code "${row.equipment_id}" does not exist.`, 'bad_request');
      if (d.equipment.some((e) => e.equipment_id === alias)) throw new ApiError('That alias is already a real equipment code.', 'conflict');
      const next: EquipmentAlias = { alias, equipment_id: row.equipment_id, reason: row.reason };
      const at = d.aliases.findIndex((x) => codeKey(x.alias) === alias);
      if (at >= 0) d.aliases[at] = next; else d.aliases.push(next);
      audit(a.user.user_id, 'saveAlias', 'equipment_aliases', alias, `Alias points to ${row.equipment_id}`);
    },
    async deleteAlias(token, alias) {
      const a = need(token, ['master'], 'Edit');
      const d = get();
      const k = codeKey(alias);
      const at = d.aliases.findIndex((x) => codeKey(x.alias) === k);
      if (at < 0) throw new ApiError('That alias was not found.', 'not_found');
      d.aliases.splice(at, 1);
      audit(a.user.user_id, 'deleteAlias', 'equipment_aliases', k, 'Alias deleted');
    },
    async saveSettings(token, changes) {
      const a = need(token, ['settings'], 'Edit');
      const d = get();
      const numeric = ['scheduled_hours_per_day', 'scheduled_days_per_week', 'repeat_min_events', 'repeat_window_days', 'duration_short_max_min',
        'duration_long_min_min', 'lockout_attempts', 'lockout_minutes', 'session_hours', 'session_hours_keep', 'min_password_length'];
      for (const [k, v] of Object.entries(changes ?? {})) {
        if (!d.settings.some((s) => s.key === k)) throw new ApiError(`There is no setting called "${k}".`, 'bad_request');
        const val = String(v ?? '').trim();
        if (numeric.includes(k) && !(Number(val) > 0)) throw new ApiError(`"${k}" must be a number above zero.`, 'bad_request');
        if (k === 'availability_basis' && !['A', 'B', 'C'].includes(val)) throw new ApiError('Availability basis must be A, B or C.', 'bad_request');
        if (k === 'default_comparison' && !['previous_period', 'same_period_last_year'].includes(val)) throw new ApiError('Comparison must be previous_period or same_period_last_year.', 'bad_request');
        if (k === 'availability_target_pct' && val !== '' && !(Number(val) > 0 && Number(val) <= 100)) throw new ApiError('The availability target must be between 0 and 100, or blank.', 'bad_request');
      }
      for (const [k, v] of Object.entries(changes ?? {})) {
        const s = d.settings.find((x) => x.key === k)!;
        s.value = String(v ?? '').trim();
        s.updated_by = a.user.user_id;
        s.updated_at = nowTs();
      }
      audit(a.user.user_id, 'saveSettings', 'settings', Object.keys(changes ?? {}).join(','), 'Settings changed');
    },

    // --- users
    async listUsers(token) {
      need(token, ['users'], 'View');
      return clone(get().users.map(adminUser));
    },
    async createUser(token, u) {
      const a = need(token, ['users'], 'Edit');
      const d = get();
      const email = String(u?.email ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('Please enter a valid email address.', 'bad_request');
      if (d.users.some((x) => x.email === email)) throw new ApiError('Someone already has that email address.', 'conflict');
      if (!String(u.display_name ?? '').trim()) throw new ApiError('Please enter a name.', 'bad_request');
      if (!d.roles.some((r) => r.role_id === u.role_id)) throw new ApiError('Please choose a role.', 'bad_request');
      const temp = randomTempPassword();
      const user: MockUser = {
        user_id: `U-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, email, display_name: u.display_name.trim(), role_id: u.role_id,
        password: temp, must_change: true, active: true, failed_attempts: 0, created_at: nowTs(), overrides: {},
      };
      d.users.push(user);
      audit(a.user.user_id, 'createUser', 'users', user.user_id, `User ${email} created`);
      return clone({ user: adminUser(user), temp_password: temp });
    },
    async updateUser(token, userId, changes) {
      const a = need(token, ['users'], 'Edit');
      const d = get();
      const user = d.users.find((x) => x.user_id === userId);
      if (!user) throw new ApiError('That user was not found.', 'not_found');
      if (user.user_id === a.user.user_id && (changes.active === false || (changes.role_id && changes.role_id !== user.role_id))) {
        throw new ApiError('You cannot deactivate yourself or change your own role.', 'conflict');
      }
      if (changes.display_name !== undefined) {
        if (!String(changes.display_name).trim()) throw new ApiError('Please enter a name.', 'bad_request');
        user.display_name = String(changes.display_name).trim();
      }
      if (changes.role_id !== undefined) {
        if (!d.roles.some((r) => r.role_id === changes.role_id)) throw new ApiError('Please choose a role.', 'bad_request');
        user.role_id = changes.role_id;
      }
      if (changes.active !== undefined) user.active = !!changes.active;
      audit(a.user.user_id, 'updateUser', 'users', userId, 'User changed');
      return clone(adminUser(user));
    },
    async resetPassword(token, userId) {
      const a = need(token, ['users'], 'Edit');
      const user = get().users.find((x) => x.user_id === userId);
      if (!user) throw new ApiError('That user was not found.', 'not_found');
      const temp = randomTempPassword();
      user.password = temp;
      user.must_change = true;
      user.failed_attempts = 0;
      user.locked_until = undefined;
      audit(a.user.user_id, 'resetPassword', 'users', userId, 'Password reset');
      return { temp_password: temp };
    },
    async setUserTabAccess(token, userId, overrides) {
      const a = need(token, ['users'], 'Edit');
      const user = get().users.find((x) => x.user_id === userId);
      if (!user) throw new ApiError('That user was not found.', 'not_found');
      const clean: Partial<Access> = {};
      for (const [k, v] of Object.entries(overrides ?? {})) {
        if (!TAB_IDS.includes(k as TabId)) throw new ApiError(`There is no tab called "${k}".`, 'bad_request');
        if (v !== 'Hidden' && v !== 'View' && v !== 'Edit') throw new ApiError('Access must be Hidden, View or Edit.', 'bad_request');
        clean[k as TabId] = v;
      }
      if (user.user_id === a.user.user_id && (clean.users ?? roleLevel(user.role_id, 'users')) !== 'Edit') {
        throw new ApiError('You cannot take away your own access to Users.', 'conflict');
      }
      user.overrides = clean;
      audit(a.user.user_id, 'setUserTabAccess', 'users', userId, 'Tab access changed');
      return clone(adminUser(user));
    },
  };
  return api;
}

function validateUploadRow(r: UploadRow, d: SyntheticDb): string | null {
  if (!d.areas.some((a) => a.area_id === r.area_id)) return `Unknown area "${r.area_id}".`;
  const area = d.areas.find((a) => a.area_id === r.area_id)!;
  if (area.line_id !== r.line_id) return `Area ${r.area_id} belongs to line ${area.line_id}, not ${r.line_id}.`;
  if (parseTs(r.stop_ts) === null || parseTs(r.start_ts) === null) return 'The stop or restart time cannot be read.';
  if (!isValidDate(r.event_date)) return 'The date cannot be read.';
  if (!(['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'] as string[]).includes(String(r.classification).toUpperCase())) return `Unknown classification "${r.classification}".`;
  if (r.freq !== 0 && r.freq !== 1) return 'Frequency must be 0 or 1.';
  if (r.criticality !== 'INC' && r.criticality !== 'NO_INC') return 'Criticality must be INC or NO_INC.';
  if (!/^[0-9a-f]{64}$/.test(String(r.fingerprint ?? ''))) return 'The row fingerprint is missing or not valid.';
  if (!String(r.code_raw ?? '').trim()) return 'The equipment code is empty.';
  return null;
}

export const mockApi: MockApi = createMockApi();
