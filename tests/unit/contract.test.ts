// Contract test: the same scenario runs against (a) the real Apps Script backend code,
// reached through the real sheetsApi client with fetch pointed at the backend's router,
// and (b) the in-memory mock API the app uses in demo mode. Both must behave the same,
// so the screens built against the mock keep working against the real backend.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JavaScript test harness of the backend
import { bootstrapAdmin, createEnv } from '../../backend/apps-script/tests/harness.mjs';
import { createMockApi } from '../../src/api/mockApi';
import { createSheetsApi } from '../../src/api/sheetsApi';
import { ApiError, type Api, type EventRow, type Notification, type UploadRow } from '../../src/api/types';
import {
  applyFilters, blockedSummary, buildIndex, DEFAULT_SETTINGS, emptyFilter, eventIdFromFingerprint, fingerprint, isBlocked,
} from '../../src/calc';

interface Subject {
  name: string;
  api: Api;
  admin: { email: string; password: string };
  /** moves the clock of the subject (the backend harness clock, or the mock's clock) to a UTC instant in ms */
  setClock(ms: number): void;
}

function backendSubject(): Subject {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const b = JSON.parse(init.body) as { action: string; token: string; params: Record<string, unknown> };
    return new Response(JSON.stringify(env.call(b.action, b.token, b.params)));
  });
  return {
    name: 'real backend via sheetsApi', api: createSheetsApi('http://backend.test'),
    admin: { email: admin.email, password: admin.password }, setClock: (ms) => { env.clock.now = ms; },
  };
}

function mockSubject(): Subject {
  const api = createMockApi({ seed: 7 });
  return { name: 'mock api', api, admin: { email: 'admin@demo.test', password: 'Demo-Pass-1234' }, setClock: (ms) => api.__setNow(() => ms) };
}

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected the call to be refused');
}

const YEAR = 2030; // a year no synthetic data uses
const STOP = `${YEAR}-05-05 10:00:00.000`;
const START = `${YEAR}-05-05 10:30:00.000`;

async function uploadRow(): Promise<UploadRow> {
  const fp = await fingerprint({ area_id: 'K.1', code: '900.ZZ01', stop_ts: STOP, start_ts: START, occurrence: 1 });
  return {
    source_row: 5, event_date: `${YEAR}-05-05`, line_id: 'L.1', area_id: 'K.1', code_raw: '900.ZZ01',
    stop_ts: STOP, start_ts: START, freq: 1, classification: 'MEC', criticality: 'INC', is_failure: true,
    reason_raw: 'Contract reason', description: 'contract test', fingerprint: fp,
  };
}

describe.each([
  { name: 'real backend via sheetsApi', make: backendSubject },
  { name: 'mock api', make: mockSubject },
])('API contract: $name', ({ make }) => {
  let s: Subject;
  let token = '';
  let eventId = '';
  beforeAll(() => {
    s = make();
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('signs in, refuses a wrong password with the same error code', async () => {
    const session = await s.api.login(s.admin.email, s.admin.password, true);
    token = session.token;
    expect(session.user.role_id).toBe('ROLE-ADMIN');
    expect(session.access.users).toBe('Edit');
    expect(session.must_change).toBe(false);
    expect(Date.parse(session.expires_at)).toBeGreaterThan(Date.now() - 1000);
    const bad = await rejection(s.api.login(s.admin.email, 'not-the-password-1', false));
    expect(bad.code).toBe('bad_credentials');
  });

  it('serves the start-up bundle with 19 areas, years newest first', async () => {
    const st = await s.api.getStartup(token);
    expect(st.areas.map((a) => a.area_id)).toEqual(expect.arrayContaining(['K.1', 'RM.1', 'PK.1', 'HY.2']));
    expect(st.classifications.map((c) => c.code).sort()).toEqual(['AUT', 'CIR', 'ELE', 'MEC', 'PL', 'PRO']);
    const years = st.years;
    expect([...years].sort((a, b) => b - a)).toEqual(years);
  });

  it('saves equipment with areas and a reason, and reports needs_review the same way', async () => {
    await s.api.saveEquipment(token, { equipment_id: '900.zz01', description: 'Contract fan', criticality: 'High', status: 'Active', needs_review: false } as never, ['K.1']);
    await s.api.saveEquipment(token, { equipment_id: '900.ZZ02', status: 'Active', needs_review: false } as never, []);
    await s.api.saveReason(token, { reason_id: '', classification: 'MEC', text_as_listed: ' Contract reason ', match_key: '', order_no: 0, active: true });
    const st = await s.api.getStartup(token);
    const fan = st.equipment.find((e) => e.equipment_id === '900.ZZ01');
    expect(fan?.description).toBe('Contract fan');
    expect(fan?.needs_review).toBe(false);
    expect(st.equipment_areas.filter((a) => a.equipment_id === '900.ZZ01').map((a) => a.area_id)).toEqual(['K.1']);
    expect(st.equipment.find((e) => e.equipment_id === '900.ZZ02')?.needs_review).toBe(true);
    const reason = st.reasons.find((r) => r.text_as_listed === ' Contract reason ');
    expect(reason?.match_key).toBe('contract reason');
  });

  it('uploads in chunks, idempotently, and the fingerprint matches across the two languages', async () => {
    const row = await uploadRow();
    const { batch_id } = await s.api.uploadStart(token, 'contract.xlsx', 'a'.repeat(64));
    const first = await s.api.uploadChunk(token, batch_id, [row]);
    expect(first.added).toBe(1);
    expect(first.rejected).toEqual([]);
    const again = await s.api.uploadChunk(token, batch_id, [row]);
    expect(again.added).toBe(0);
    expect(again.identical).toBe(1);
    const batch = await s.api.uploadFinish(token, batch_id, { rows_read: 1, rows_skipped: 0 }, []);
    expect(batch.status).toBe('Completed');
    expect(batch.rows_added).toBe(1);

    const events = await s.api.getEvents(token, YEAR);
    expect(events).toHaveLength(1);
    const ev = events[0] as EventRow;
    eventId = ev.event_id;
    expect(eventId).toBe(eventIdFromFingerprint(row.fingerprint));
    expect(ev.duration_s).toBe(1800);
    expect(ev.equipment_id).toBe('900.ZZ01');
    expect(ev.reason_id).toBeTruthy();
    expect(ev.is_failure).toBe(true);
    expect(ev.edited).toBe(false);
    expect((await s.api.getStartup(token)).years[0]).toBe(YEAR);
  });

  it('refuses only a row that cannot be stored at all, in plain words, and stores nothing for it', async () => {
    const { batch_id } = await s.api.uploadStart(token, 'bad.xlsx', 'b'.repeat(64));
    const base = await uploadRow();
    const rows = [
      { ...base, source_row: 5, stop_ts: 'soon' },
      { ...base, source_row: 6, freq: 2 as never },
      { ...base, source_row: 7, criticality: 'MAYBE' as never },
      { ...base, source_row: 8, is_failure: 'YES' as never },
      { ...base, source_row: 9, event_date: '05/05/2030' },
    ];
    const res = await s.api.uploadChunk(token, batch_id, rows);
    expect(res.added).toBe(0);
    expect(res.rejected.map((r) => r.source_row)).toEqual([5, 6, 7, 8, 9]);
    expect(res.rejected.every((r) => r.reason.length > 5)).toBe(true);
  });

  // ---- "import never drops a row": problem rows are stored with flags and fixed later ----
  const YEAR2 = 2031;
  interface Problem { name: string; over: Partial<UploadRow>; flags: string; equipment?: string }
  const at = (n: number): { stop_ts: string; start_ts: string } => ({
    stop_ts: `${YEAR2}-03-0${n} 08:00:00.000`, start_ts: `${YEAR2}-03-0${n} 09:00:00.000`,
  });
  const PROBLEMS: Problem[] = [
    { name: 'blank code, classification and reason', over: { ...at(1), code_raw: '', classification: '', reason_raw: '' }, flags: 'missing_classification,missing_code,blank_reason' },
    { name: 'HD under L.2', over: { ...at(2), area_id: 'HD', line_id: 'L.2', code_raw: 'N/A' }, flags: 'line_mismatch' },
    { name: 'unknown area', over: { ...at(3), area_id: 'ZZ', line_id: 'L.9' }, flags: 'unknown_area', equipment: '900.ZZ01' },
    { name: 'invalid classification', over: { ...at(4), classification: 'xyz' }, flags: 'invalid_classification', equipment: '900.ZZ01' },
    { name: 'clean row', over: { ...at(5) }, flags: '', equipment: '900.ZZ01' },
    { name: 'code added later', over: { ...at(6), code_raw: 'newcode.5' }, flags: 'unknown_code' },
    { name: 'alias added later', over: { ...at(7), code_raw: 'OLDNAME.5' }, flags: 'unknown_code' },
    { name: 'unlisted reason', over: { ...at(8), reason_raw: 'Something unlisted' }, flags: 'unlisted_reason', equipment: '900.ZZ01' },
    { name: 'restart before stop', over: { stop_ts: `${YEAR2}-03-09 09:00:00.000`, start_ts: `${YEAR2}-03-09 08:00:00.000` }, flags: 'end_before_start', equipment: '900.ZZ01' },
    { name: 'code of another area', over: { stop_ts: `${YEAR2}-03-10 08:00:00.000`, start_ts: `${YEAR2}-03-10 09:00:00.000`, area_id: 'RM.1' }, flags: 'code_not_in_area', equipment: '900.ZZ01' },
    { name: 'placeholder', over: { stop_ts: `${YEAR2}-03-11 08:00:00.000`, start_ts: `${YEAR2}-03-11 09:00:00.000`, code_raw: 'AFR' }, flags: 'unknown_code,placeholder' },
  ];
  const ids: Record<string, string> = {};

  async function problemRows(): Promise<UploadRow[]> {
    const base = await uploadRow();
    const out: UploadRow[] = [];
    for (const [i, p] of PROBLEMS.entries()) {
      const row: UploadRow = { ...base, source_row: 20 + i, event_date: (p.over.stop_ts ?? at(1).stop_ts).slice(0, 10), ...p.over };
      row.fingerprint = await fingerprint({ area_id: row.area_id, code: row.code_raw, stop_ts: row.stop_ts, start_ts: row.start_ts, occurrence: 1 });
      out.push(row);
    }
    return out;
  }

  it('stores problem rows (nothing is rejected) with the right flags, HD under L.2 included', async () => {
    const rows = await problemRows();
    const { batch_id } = await s.api.uploadStart(token, 'problems.xlsx', 'c'.repeat(64));
    const res = await s.api.uploadChunk(token, batch_id, rows);
    expect(res).toMatchObject({ added: PROBLEMS.length, identical: 0, rejected: [] });
    const again = await s.api.uploadChunk(token, batch_id, rows);
    expect(again).toMatchObject({ added: 0, identical: PROBLEMS.length });
    await s.api.uploadFinish(token, batch_id, { rows_read: rows.length, rows_skipped: 0 }, []);
    const events = await s.api.getEvents(token, YEAR2);
    expect(events).toHaveLength(PROBLEMS.length);
    PROBLEMS.forEach((p, i) => {
      const ev = events.find((e) => e.source_row === 20 + i) as EventRow;
      ids[p.name] = ev.event_id;
      expect(ev.flags ?? '', p.name).toBe(p.flags);
      if (p.equipment !== undefined) expect(ev.equipment_id ?? '', p.name).toBe(p.equipment);
    });
    const blank = events.find((e) => e.event_id === ids['blank code, classification and reason']) as EventRow;
    expect([blank.code_raw, blank.classification, blank.reason_raw ?? '']).toEqual(['', '', '']);
    expect(blank.is_failure).toBe(true); // the sheet's values are kept
    const hd = events.find((e) => e.event_id === ids['HD under L.2']) as EventRow;
    expect([hd.area_id, hd.line_id, hd.flags]).toEqual(['HD', 'L.2', 'line_mismatch']);
    const unknownArea = events.find((e) => e.event_id === ids['unknown area']) as EventRow;
    expect([unknownArea.area_id, unknownArea.line_id]).toEqual(['ZZ', 'L.9']);
  });

  it('leaves blocked rows out of the calc filter and resolves the line through the area master', async () => {
    const st = await s.api.getStartup(token);
    const events = await s.api.getEvents(token, YEAR2);
    const ctx = { settings: DEFAULT_SETTINGS, index: buildIndex(st) };
    const usable = applyFilters(events, emptyFilter(), ctx);
    const blocked = events.filter(isBlocked);
    expect(blocked.map((e) => e.flags).sort()).toEqual(['end_before_start', 'invalid_classification', 'missing_classification,missing_code,blank_reason', 'unknown_area'].sort());
    expect(usable).toHaveLength(PROBLEMS.length - 4);
    expect(usable.some(isBlocked)).toBe(false);
    expect(applyFilters(events, { ...emptyFilter(), includeInvalid: true }, ctx)).toHaveLength(PROBLEMS.length);
    expect(blockedSummary(events).total.count).toBe(4);
    // HD belongs to L.1 whatever the sheet said
    const hd = ids['HD under L.2'];
    expect(applyFilters(events, { ...emptyFilter(), lineIds: ['L.1'] }, ctx).some((e) => e.event_id === hd)).toBe(true);
    expect(applyFilters(events, { ...emptyFilter(), lineIds: ['L.2'] }, ctx).some((e) => e.event_id === hd)).toBe(false);
  });

  it('editing fixes the flags; classification and area must be valid', async () => {
    const note = 'fixed on the validate page';
    expect((await rejection(s.api.editEvent(token, ids['unknown area'] as string, { area_id: 'STILL-NOPE' }, note))).code).toBe('bad_request');
    expect((await rejection(s.api.editEvent(token, ids['invalid classification'] as string, { classification: 'XYZ' as never }, note))).code).toBe('bad_request');
    const a = await s.api.editEvent(token, ids['unknown area'] as string, { area_id: 'K.1' }, note);
    expect([a.area_id, a.line_id, a.flags ?? '']).toEqual(['K.1', 'L.1', '']);
    const b = await s.api.editEvent(token, ids['invalid classification'] as string, { classification: 'mec' as never }, note);
    expect([b.classification, b.flags ?? '']).toEqual(['MEC', '']);
    const c = await s.api.editEvent(token, ids['blank code, classification and reason'] as string, { classification: 'ELE', code_raw: 'n/a', reason_raw: 'x' }, note);
    expect([c.classification, c.is_area_level, c.flags ?? '']).toEqual(['ELE', true, 'unlisted_reason']);
    const d = await s.api.editEvent(token, ids['HD under L.2'] as string, { line_id: 'L.1' }, note);
    expect(d.flags ?? '').toBe('');
    const e = await s.api.editEvent(token, ids['restart before stop'] as string, { start_ts: `${YEAR2}-03-09 10:00:00.000` }, note);
    expect([e.duration_s, e.flags ?? '']).toEqual([3600, '']);
  });

  it('revalidateEvents picks up a code and an alias added to Master Data later', async () => {
    const before = await s.api.getEvents(token, YEAR2);
    expect(before.filter((e) => (e.flags ?? '').includes('unknown_code') && !(e.flags ?? '').includes('placeholder'))).toHaveLength(2);
    expect(await s.api.revalidateEvents(token, YEAR2)).toEqual({ checked: PROBLEMS.length, changed: 0 });
    await s.api.saveEquipment(token, { equipment_id: 'NEWCODE.5', description: 'New fan', criticality: 'High', status: 'Active', needs_review: false } as never, ['K.1']);
    await s.api.saveAlias(token, { alias: 'OLDNAME.5', equipment_id: 'NEWCODE.5' });
    expect(await s.api.revalidateEvents(token, YEAR2)).toEqual({ checked: PROBLEMS.length, changed: 2 });
    const after = await s.api.getEvents(token, YEAR2);
    for (const name of ['code added later', 'alias added later']) {
      const ev = after.find((e) => e.event_id === ids[name]) as EventRow;
      expect([ev.flags ?? '', ev.equipment_id]).toEqual(['', 'NEWCODE.5']);
      expect(ev.edited).toBe(false); // a re-check is not an edit
    }
    expect((await s.api.getEventEdits(token, ids['code added later'] as string))).toEqual([]);
    // a voided event is not re-checked
    await s.api.voidEvent(token, ids['placeholder'] as string, true, 'duplicate');
    expect((await s.api.revalidateEvents(token, YEAR2)).checked).toBe(PROBLEMS.length - 1);
    await s.api.voidEvent(token, ids['placeholder'] as string, false, 'restored');
    expect((await rejection(s.api.revalidateEvents(token, 1066))).code).toBe('bad_request');
  });

  it('edits an event: recalculates, marks it edited, keeps history, needs a note', async () => {
    const noNote = await rejection(s.api.editEvent(token, eventId, { description: 'x' }, ''));
    expect(noNote.code).toBe('bad_request');
    const nothing = await rejection(s.api.editEvent(token, eventId, {}, 'no change'));
    expect(nothing.code).toBe('bad_request');

    const ev = await s.api.editEvent(token, eventId, { classification: 'PL', start_ts: `${YEAR}-05-05 10:45:30.500` }, 'Planned stop, restart time corrected');
    expect(ev.edited).toBe(true);
    expect(ev.classification).toBe('PL');
    expect(ev.criticality).toBe('NO_INC');
    expect(ev.is_failure).toBe(false);
    expect(ev.duration_s).toBeCloseTo(2730.5, 3);
    expect(ev.fingerprint).toBe((await uploadRow()).fingerprint);

    const history = await s.api.getEventEdits(token, eventId);
    const fields = history.map((h) => h.field);
    expect(fields).toEqual(expect.arrayContaining(['classification', 'start_ts']));
    expect(history.every((h) => h.note === 'Planned stop, restart time corrected' || h.note === undefined || h.note === '' || typeof h.note === 'string')).toBe(true);
  });

  it('voids and restores an event, and refuses to edit a voided one', async () => {
    const v = await s.api.voidEvent(token, eventId, true, 'Entered twice by mistake');
    expect(v.is_void).toBe(true);
    const blocked = await rejection(s.api.editEvent(token, eventId, { description: 'y' }, 'try'));
    expect(blocked.code).toBe('conflict');
    const r = await s.api.voidEvent(token, eventId, false, 'Restored after check');
    expect(r.is_void).toBe(false);
  });

  it('creates a viewer, forces a password change, and refuses what the viewer may not do', async () => {
    const created = await s.api.createUser(token, { email: 'viewer.contract@example.com', display_name: 'Contract Viewer', role_id: 'ROLE-VIEW' });
    expect(created.temp_password.length).toBeGreaterThanOrEqual(12);
    const first = await s.api.login('viewer.contract@example.com', created.temp_password, false);
    expect(first.must_change).toBe(true);
    const locked = await rejection(s.api.getEvents(first.token, YEAR));
    expect(locked.accessDenied).toBe(true);
    const session = await s.api.changePassword(first.token, created.temp_password, 'A-New-Strong-Pass-77');
    expect(session.must_change).toBe(false);
    expect(session.access.upload).toBe('Hidden');
    expect(session.access.events).toBe('View');

    expect((await s.api.getEvents(session.token, YEAR)).length).toBe(1);
    const denied = await rejection(s.api.editEvent(session.token, eventId, { description: 'z' }, 'viewer tries'));
    expect(denied.accessDenied).toBe(true);
    expect((await rejection(s.api.revalidateEvents(session.token, YEAR2))).accessDenied).toBe(true);
    expect((await rejection(s.api.saveSettings(session.token, { repeat_min_events: '3' }))).accessDenied).toBe(true);
    expect((await rejection(s.api.listUsers(session.token))).accessDenied).toBe(true);

    // a password reset by the admin ends the viewer's open session
    await s.api.resetPassword(token, created.user.user_id);
    const gone = await rejection(s.api.getMyAccess(session.token));
    expect(gone.code).toBe('unauthenticated');
  });

  it('protects the admin: cannot deactivate yourself or change your own role', async () => {
    const me = (await s.api.getMyAccess(token)).user;
    expect((await rejection(s.api.updateUser(token, me.user_id, { active: false }))).code).toBe('conflict');
    expect((await rejection(s.api.updateUser(token, me.user_id, { role_id: 'ROLE-VIEW' }))).code).toBe('conflict');
  });

  it('saves settings all-or-nothing and rejects unknown keys', async () => {
    await s.api.saveSettings(token, { repeat_min_events: '3' });
    expect((await s.api.getStartup(token)).settings.find((x) => x.key === 'repeat_min_events')?.value).toBe('3');
    await rejection(s.api.saveSettings(token, { repeat_min_events: '4', not_a_setting: '1' }));
    expect((await s.api.getStartup(token)).settings.find((x) => x.key === 'repeat_min_events')?.value).toBe('3');
  });

  it('enforces setting ranges the same way', async () => {
    expect((await rejection(s.api.saveSettings(token, { min_password_length: '3' }))).code).toBe('bad_request');
    expect((await rejection(s.api.saveSettings(token, { availability_basis: 'Z' }))).code).toBe('bad_request');
    expect((await rejection(s.api.saveSettings(token, { scheduled_hours_per_day: '40' }))).code).toBe('bad_request');
    await s.api.saveSettings(token, { availability_basis: 'C', scheduled_hours_per_day: '24' });
    expect((await s.api.getStartup(token)).settings.find((x) => x.key === 'availability_basis')?.value).toBe('C');
  });

  // ------------------------------------------------------------------ notifications
  // One scenario in 2041, run against both implementations. The expectations are written out once, so the
  // plain-JS port in the backend and the calc-based rules in the mock must both produce exactly this.
  const NOON = (day: string): number => Date.parse(`${day}T12:00:00Z`);
  let ntoken = '';
  let srcSeq = 0;
  const scenarioBatches: string[] = [];
  const ID: Record<string, string> = {};

  async function srow(stop: string, start: string, over: Partial<UploadRow> = {}): Promise<UploadRow> {
    srcSeq++;
    const row = {
      source_row: 300 + srcSeq, event_date: stop.slice(0, 10), line_id: 'L.1', area_id: 'K.1', code_raw: '900.ZZ01', stop_ts: stop, start_ts: start,
      freq: 1, classification: 'MEC', criticality: 'INC', is_failure: true, reason_raw: `Scenario ${srcSeq}`, description: '', fingerprint: '', ...over,
    } as UploadRow;
    row.fingerprint = await fingerprint({ area_id: row.area_id, code: row.code_raw, stop_ts: row.stop_ts, start_ts: row.start_ts, occurrence: 1 });
    ID[`${row.area_id}|${stop}`] = eventIdFromFingerprint(row.fingerprint);
    return row;
  }
  const t = (d: string, h: string): string => `2041-${d} ${h}:00.000`;
  /** event id of the scenario row of an area that stopped at 'MM-DD HH:MM' */
  const idOf = (area: string, stop: string): string => ID[`${area}|${t(stop.slice(0, 5), stop.slice(6))}`] as string;

  async function load(name: string, rows: UploadRow[]): Promise<string> {
    const { batch_id } = await s.api.uploadStart(ntoken, name, 'd'.repeat(64));
    const res = await s.api.uploadChunk(ntoken, batch_id, rows);
    expect(res.added).toBe(rows.length);
    await s.api.uploadFinish(ntoken, batch_id, { rows_read: rows.length, rows_skipped: 0 }, []);
    scenarioBatches.push(batch_id);
    return batch_id;
  }

  const view = (n: Notification) => ({
    type: n.type, severity: n.severity, dedupe_key: n.dedupe_key, title: n.title, detail: n.detail ?? '',
    area_id: n.area_id ?? '', line_id: n.line_id ?? '', source_ref: n.source_ref ?? '',
  });
  /** the scenario's own notifications (older ones from the other tests are left out), sorted by dedupe key */
  async function mine(token = ntoken): Promise<ReturnType<typeof view>[]> {
    const { items } = await s.api.getNotifications(token);
    const ids = new Set(Object.values(ID));
    return items
      .filter((n) => n.type !== 'user_event' && (ids.has(n.source_ref ?? '') || scenarioBatches.includes(n.source_ref ?? '') || n.dedupe_key.includes('|2041-')))
      .map(view).sort((a, b) => (a.dedupe_key < b.dedupe_key ? -1 : 1));
  }
  const keys = (list: { dedupe_key: string }[]): string[] => list.map((n) => n.dedupe_key);

  it('notifications: the rules produce the same alerts and updates in the backend and the mock', async () => {
    await s.api.saveSettings(token, { repeat_min_events: '2', notif_retention_days: '30', notif_availability_target_pct: '' });
    s.setClock(NOON('2041-06-20'));
    ntoken = (await s.api.login(s.admin.email, s.admin.password, true)).token;

    const may = [await srow(t('05-10', '00:00'), t('05-12', '00:00'))]; // 48 h, but not recent
    const june: UploadRow[] = [
      await srow(t('06-10', '02:00'), t('06-10', '14:00')), // long stop, 12 h
      await srow(t('06-11', '00:00'), t('06-11', '04:00')), // chain head 4 h ...
      await srow(t('06-11', '04:00'), t('06-11', '09:00'), { freq: 0, is_failure: false }), // ... plus 5 h: one 9 h event
      await srow(t('06-12', '00:00'), t('06-12', '12:00')), // voided later
      await srow(t('06-13', '00:00'), t('06-13', '12:00'), { classification: '' }), // blocked: left out
      await srow(t('06-14', '01:00'), t('06-14', '02:00'), { reason_raw: 'Contract reason' }),
      await srow(t('06-16', '01:00'), t('06-16', '02:00'), { reason_raw: ' contract   REASON ' }), // same group
      ...(await Promise.all(['02', '03', '04', '05', '06'].map((d) => srow(t(`06-${d}`, '03:00'), t(`06-${d}`, '04:00'), { area_id: 'HD', code_raw: 'N/A' })))),
      await srow(t('06-18', '10:00'), t('06-18', '10:30'), { area_id: 'CR' }),
    ];
    const mayBatch = await load('scenario-may.xlsx', may);
    const juneBatch = await load('scenario-june.xlsx', june);

    const long = (stop: string, hours: string) => ({
      type: 'long_stop', severity: 'alert', dedupe_key: `long_stop|${idOf('K.1', stop)}`, title: `Long stop: K.1 ${hours} h`,
      detail: `A failure stopped K.1 for ${hours} hours (limit 8 h), starting 2041-${stop}.`, area_id: 'K.1', line_id: 'L.1', source_ref: idOf('K.1', stop),
    });
    const expected = [
      long('06-10 02:00', '12.0'),
      long('06-11 00:00', '9.0'),
      long('06-12 00:00', '12.0'),
      {
        type: 'repeat_group', severity: 'alert', dedupe_key: `repeat|K.1|900.ZZ01|contract reason|${idOf('K.1', '06-14 01:00')}`,
        title: 'Repeated failure: 900.ZZ01 - Contract reason', detail: '2 failures within 30 days, latest 2041-06-16. First in K.1.',
        area_id: 'K.1', line_id: 'L.1', source_ref: idOf('K.1', '06-14 01:00'),
      },
      {
        type: 'failure_spike', severity: 'alert', dedupe_key: 'spike|HD|2041-06-18', title: 'Failures rising in HD: 5 (none before)',
        detail: '5 failures in the 30 days to 2041-06-18, against 0 in the 30 days before.', area_id: 'HD', line_id: 'L.1', source_ref: '',
      },
      {
        type: 'failure_spike', severity: 'alert', dedupe_key: 'spike|K.1|2041-06-18', title: 'Failures up 400% in K.1',
        detail: '5 failures in the 30 days to 2041-06-18, against 1 in the 30 days before.', area_id: 'K.1', line_id: 'L.1', source_ref: '',
      },
      {
        type: 'upload_done', severity: 'update', dedupe_key: `upload|${juneBatch}`, title: 'Workbook uploaded: scenario-june.xlsx (+13 rows)',
        detail: 'Read 13, added 13, identical 0, skipped 0, warnings 0.', area_id: '', line_id: '', source_ref: juneBatch,
      },
      {
        type: 'upload_done', severity: 'update', dedupe_key: `upload|${mayBatch}`, title: 'Workbook uploaded: scenario-may.xlsx (+1 rows)',
        detail: 'Read 1, added 1, identical 0, skipped 0, warnings 0.', area_id: '', line_id: '', source_ref: mayBatch,
      },
    ].sort((a, b) => (a.dedupe_key < b.dedupe_key ? -1 : 1));
    expect(await mine()).toEqual(expected);
  });

  it('notifications: a check is idempotent; a voided event resolves its alert and a restored one brings the same row back', async () => {
    expect(await s.api.runNotificationChecks(ntoken)).toEqual({ created: 0, resolved: 0, expired: 0 });
    const target = idOf('K.1', '06-12 00:00');
    const before = (await mine()).length;
    const rowId = (await s.api.getNotifications(ntoken)).items.find((n) => n.source_ref === target)?.notification_id;
    expect(rowId).toMatch(/^NT-[0-9a-f]{16}$/);
    await s.api.voidEvent(ntoken, target, true, 'entered twice');
    expect(await s.api.runNotificationChecks(ntoken)).toEqual({ created: 0, resolved: 1, expired: 0 });
    expect((await mine()).length).toBe(before - 1);
    expect(keys(await mine())).not.toContain(`long_stop|${target}`);
    await s.api.voidEvent(ntoken, target, false, 'restored');
    expect(await s.api.runNotificationChecks(ntoken)).toEqual({ created: 1, resolved: 0, expired: 0 });
    expect((await s.api.getNotifications(ntoken)).items.find((n) => n.source_ref === target)?.notification_id).toBe(rowId);
    expect((await mine()).length).toBe(before);
  });

  it('notifications: availability below target needs the target setting, and uses the latest complete month', async () => {
    expect((await mine()).some((n) => n.type === 'availability_low')).toBe(false);
    await s.api.saveSettings(ntoken, { notif_availability_target_pct: '95' });
    expect(await s.api.runNotificationChecks(ntoken)).toEqual({ created: 1, resolved: 0, expired: 0 });
    const a = (await mine()).filter((n) => n.type === 'availability_low');
    expect(a).toEqual([{
      type: 'availability_low', severity: 'alert', dedupe_key: 'availability|K.1|2041-05', title: 'Availability below target: K.1 93.5%',
      detail: '2041-05: availability 93.5% against a target of 95% (basis B).', area_id: 'K.1', line_id: 'L.1', source_ref: '',
    }]);
    expect(await s.api.runNotificationChecks(ntoken)).toEqual({ created: 0, resolved: 0, expired: 0 });
    await s.api.saveSettings(ntoken, { notif_availability_target_pct: '' });
  });

  it('notifications: state and preferences belong to the caller; validation answers agree', async () => {
    const n1 = (await s.api.getNotifications(ntoken)).items.find((n) => n.type === 'long_stop' && n.source_ref === idOf('K.1', '06-10 02:00')) as Notification;
    const st = await s.api.setNotificationState(ntoken, n1.notification_id, 'snoozed', '2041-06-22 09:00:00');
    expect(st).toMatchObject({ notification_id: n1.notification_id, state: 'snoozed', snooze_until: '2041-06-22 09:00:00.000' });
    expect((await rejection(s.api.setNotificationState(ntoken, n1.notification_id, 'snoozed'))).code).toBe('bad_request');
    expect((await rejection(s.api.setNotificationState(ntoken, n1.notification_id, 'snoozed', '2041-06-19 09:00:00'))).code).toBe('bad_request');
    expect((await rejection(s.api.setNotificationState(ntoken, n1.notification_id, 'deleted' as never))).code).toBe('bad_request');
    expect((await rejection(s.api.setNotificationState(ntoken, 'NT-0000000000000000', 'seen'))).code).toBe('not_found');
    const dismissed = await s.api.setNotificationState(ntoken, n1.notification_id, 'dismissed');
    expect(dismissed.snooze_until ?? '').toBe('');
    const got = await s.api.getNotifications(ntoken);
    expect(got.state.filter((x) => x.notification_id === n1.notification_id)).toHaveLength(1);
    expect(got.state.every((x) => x.user_id === got.state[0]?.user_id)).toBe(true);

    const prefs = await s.api.saveNotificationPrefs(ntoken, { digest: 'weekly', watch_areas: 'hd, K.1', alert_types: 'long_stop,long_stop,upload_gap' });
    expect(prefs).toMatchObject({ digest: 'weekly', watch_areas: 'HD,K.1', alert_types: 'long_stop,upload_gap' });
    expect((await s.api.getNotifications(ntoken)).prefs).toMatchObject(prefs);
    for (const bad of [{}, { digest: 'hourly' }, { watch_areas: 'NOWHERE' }, { alert_types: 'made_up' }, { last_seen_at: 'soon' }, { other: 'x' }, { last_digest_at: '2041-01-01 00:00:00.000' }]) {
      expect((await rejection(s.api.saveNotificationPrefs(ntoken, bad as never))).code, JSON.stringify(bad)).toBe('bad_request');
    }
    expect((await s.api.getNotifications(ntoken)).prefs).toMatchObject({ digest: 'weekly' });
  });

  it('notifications: nobody else sees my state or preferences; user events are for people who can see Users; only settings Edit runs checks', async () => {
    const email = 'notif.viewer@example.com';
    const created = await s.api.createUser(ntoken, { email, display_name: 'Notif Viewer', role_id: 'ROLE-VIEW' });
    const first = await s.api.login(email, created.temp_password, false);
    const session = await s.api.changePassword(first.token, created.temp_password, 'A-New-Strong-Pass-88');
    const other = await s.api.getNotifications(session.token);
    expect(other.state).toEqual([]);
    expect(other.prefs).toEqual({});
    expect(other.items.length).toBeGreaterThan(0); // everyone signed in sees alerts and updates
    expect(other.items.some((n) => n.type === 'user_event')).toBe(false);
    const mineNow = await s.api.getNotifications(ntoken);
    expect(mineNow.items.some((n) => n.type === 'user_event' && n.title === 'User created: Notif Viewer')).toBe(true);
    const adminOnly = mineNow.items.find((n) => n.type === 'user_event') as Notification;
    expect((await rejection(s.api.setNotificationState(session.token, adminOnly.notification_id, 'seen'))).code).toBe('not_found');
    const alert = other.items.find((n) => n.type === 'long_stop') as Notification;
    await s.api.setNotificationState(session.token, alert.notification_id, 'seen');
    expect((await s.api.getNotifications(session.token)).state).toHaveLength(1);
    expect((await s.api.getNotifications(ntoken)).state.some((x) => x.state === 'seen' && x.notification_id === alert.notification_id)).toBe(false);
    expect((await rejection(s.api.runNotificationChecks(session.token))).accessDenied).toBe(true);
    expect((await rejection(s.api.getNotifications(''))).code).toBe('unauthenticated');
    expect((await rejection(s.api.saveNotificationPrefs('', { digest: 'daily' }))).code).toBe('unauthenticated');
    // a password reset is announced to the admin, never with the password
    const reset = await s.api.resetPassword(ntoken, created.user.user_id);
    const events = (await s.api.getNotifications(ntoken)).items.filter((n) => n.type === 'user_event');
    expect(events.some((n) => n.title === 'Password reset: Notif Viewer')).toBe(true);
    expect(JSON.stringify(events)).not.toContain(reset.temp_password);
  });

  it('notifications: settings ranges agree', async () => {
    for (const changes of [
      { notif_long_stop_hours: '0' }, { notif_spike_pct: '0' }, { notif_upload_gap_days: '0' }, { notif_retention_days: '0' },
      { notif_availability_target_pct: '101' }, { notif_repeat_alert: 'maybe' }, { app_url: 'javascript:alert(1)' }, { app_url: 'ftp://x.example' },
    ] as Record<string, string>[]) {
      expect((await rejection(s.api.saveSettings(ntoken, changes))).code, JSON.stringify(changes)).toBe('bad_request');
    }
    await s.api.saveSettings(ntoken, { notif_long_stop_hours: '8', app_url: 'https://acc.example.test/app', notif_repeat_alert: 'true' });
    const map = Object.fromEntries((await s.api.getStartup(ntoken)).settings.map((x) => [x.key, x.value]));
    expect(map.notif_spike_pct).toBe('30');
    expect(map.notif_upload_gap_days).toBe('35');
    expect(map.notif_retention_days).toBe('30');
    expect(map.app_url).toBe('https://acc.example.test/app');
  });

  it('notifications: alerts expire, a missing upload raises the gap alert, and expired ones stay gone', async () => {
    s.setClock(NOON('2041-07-21')); // 31 days on: everything created on 20 June is past its retention
    ntoken = (await s.api.login(s.admin.email, s.admin.password, true)).token;
    expect((await s.api.getNotifications(ntoken)).items.filter((n) => n.severity === 'alert' || n.type === 'upload_done')).toEqual([]);
    const res = await s.api.runNotificationChecks(ntoken);
    expect(res.created).toBe(0); // 33 days since the latest event: not yet a gap
    expect(res.resolved).toBe(0);
    expect(res.expired).toBeGreaterThan(8);
    expect(await s.api.runNotificationChecks(ntoken)).toEqual({ created: 0, resolved: 0, expired: 0 });
    expect(keys(await mine()).some((k) => k.startsWith('long_stop|'))).toBe(false); // the same events do not raise new alerts

    s.setClock(NOON('2041-08-05'));
    ntoken = (await s.api.login(s.admin.email, s.admin.password, true)).token;
    expect(await s.api.runNotificationChecks(ntoken)).toMatchObject({ created: 1, resolved: 0 });
    const gap = (await s.api.getNotifications(ntoken)).items.find((n) => n.type === 'upload_gap');
    expect(gap && view(gap)).toEqual({
      type: 'upload_gap', severity: 'alert', dedupe_key: 'upload_gap|2041-06-18', title: 'No upload since 2041-06-18',
      detail: 'The latest stored event is dated 2041-06-18, 48 days ago (limit 35 days).', area_id: '', line_id: '', source_ref: '',
    });
    // new data resolves it
    await load('scenario-august.xlsx', [await srow(t('08-04', '01:00'), t('08-04', '01:30'), { area_id: 'CR' })]);
    expect((await s.api.getNotifications(ntoken)).items.some((n) => n.type === 'upload_gap')).toBe(false);
  });
});
