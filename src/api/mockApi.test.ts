import { beforeAll, describe, expect, it } from 'vitest';
import { createMockApi, type MockApi } from './mockApi';
import { ApiError, TAB_IDS, type EventRow, type Session, type UploadRow } from './types';
import { DEMO_PASSWORD, DEMO_TEMP_EMAIL, DEMO_TEMP_PASSWORD } from '../mock/synthetic';
import { codeKey, durationSeconds, eventIdOf, fingerprintOf, matchKey } from '../util/normalize';
import { sha256Hex } from '../util/sha256';

let api: MockApi;
const sessions: Record<string, Session> = {};

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ApiError ? e.code : `other:${String(e)}`;
  }
}
const tok = (role: string) => sessions[role].token;

beforeAll(async () => {
  api = createMockApi();
  for (const r of ['admin', 'manager', 'engineer', 'viewer']) sessions[r] = await api.login(`${r}@demo.test`, DEMO_PASSWORD, true);
});

describe('normalisation helpers', () => {
  it('code_key upper-cases, drops spaces and collapses dots', () => {
    expect(codeKey(' 111..ab 100 ')).toBe('111.AB100');
    expect(codeKey('n/a')).toBe('N/A');
  });
  it('match_key trims, collapses spaces and lower-cases', () => {
    expect(matchKey('  Bearing   Failure ')).toBe('bearing failure');
  });
  it('sha256 matches the known test vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('duration is start minus stop in seconds', () => {
    expect(durationSeconds('2026-03-01 10:00:00.000', '2026-03-01 10:01:30.500')).toBe(90.5);
    expect(durationSeconds('2026-03-01 10:00:00.000', '2026-03-01 09:00:00.000')).toBe(-3600);
    expect(durationSeconds('nonsense', '2026-03-01 09:00:00.000')).toBeNull();
  });
});

describe('synthetic data', () => {
  it('has the expected size and shape', async () => {
    const s = await api.getStartup(tok('viewer'));
    expect(s.areas).toHaveLength(19);
    expect(s.reasons.length).toBeGreaterThanOrEqual(55);
    expect(s.equipment.length).toBeGreaterThanOrEqual(140);
    expect(s.years).toEqual([2026, 2025]);
    const shared = new Set(s.equipment_areas.map((e) => e.equipment_id)).size < s.equipment_areas.length;
    expect(shared).toBe(true);
    const ev = [...(await api.getEvents(tok('viewer'), 2025)), ...(await api.getEvents(tok('viewer'), 2026))];
    expect(ev.length).toBeGreaterThan(3000);
    expect(ev.some((e) => e.freq === 0)).toBe(true);
    expect(ev.some((e) => e.edited)).toBe(true);
    expect(ev.some((e) => e.is_void)).toBe(true);
    expect(ev.some((e) => e.is_area_level)).toBe(true);
    expect(ev.every((e) => e.event_id === eventIdOf(e.fingerprint))).toBe(true);
  });
  it('is deterministic', () => {
    const a = createMockApi({ seed: 7 }).__db().events.slice(0, 20).map((e) => e.fingerprint);
    const b = createMockApi({ seed: 7 }).__db().events.slice(0, 20).map((e) => e.fingerprint);
    expect(a).toEqual(b);
  });
  it('never splits a row across midnight', async () => {
    const ev = await api.getEvents(tok('viewer'), 2026);
    const bad = ev.filter((e) => e.stop_ts.slice(0, 10) !== e.start_ts.slice(0, 10) && !e.start_ts.endsWith('00:00:00.000') && e.duration_s > 0);
    expect(bad).toHaveLength(0);
  });
});

describe('sign-in', () => {
  it('gives the same message for a bad email and a bad password', async () => {
    const m1 = await api.login('nobody@demo.test', 'x', false).catch((e: ApiError) => e);
    const m2 = await api.login('viewer@demo.test', 'wrong', false).catch((e: ApiError) => e);
    expect((m1 as ApiError).message).toBe((m2 as ApiError).message);
    expect((m1 as ApiError).code).toBe('bad_credentials');
  });
  it('locks after the configured number of failures and refuses even the right password', async () => {
    const a = createMockApi();
    for (let i = 0; i < 5; i++) await code(a.login('viewer@demo.test', 'bad', false));
    expect(await code(a.login('viewer@demo.test', DEMO_PASSWORD, false))).toBe('locked');
    a.__setNow(() => Date.now() + 16 * 60_000);
    expect(await code(a.login('viewer@demo.test', DEMO_PASSWORD, false))).toBe('ok');
  });
  it('keep-signed-in gives a longer session', async () => {
    const short = await api.login('viewer@demo.test', DEMO_PASSWORD, false);
    const long = await api.login('viewer@demo.test', DEMO_PASSWORD, true);
    expect(Date.parse(long.expires_at)).toBeGreaterThan(Date.parse(short.expires_at) + 24 * 3_600_000);
  });
  it('refuses an expired token with "unauthenticated"', async () => {
    const a = createMockApi();
    const s = await a.login('viewer@demo.test', DEMO_PASSWORD, false);
    a.__setNow(() => Date.now() + 13 * 3_600_000);
    expect(await code(a.getMyAccess(s.token))).toBe('unauthenticated');
    expect(await code(a.getMyAccess('garbage'))).toBe('unauthenticated');
    expect(await code(a.getMyAccess(''))).toBe('unauthenticated');
  });
  it('the admin demo account needs no password change', () => {
    expect(sessions.admin.must_change).toBe(false);
  });
  it('a user with a temporary password can only change it', async () => {
    const a = createMockApi();
    const s = await a.login(DEMO_TEMP_EMAIL, DEMO_TEMP_PASSWORD, false);
    expect(s.must_change).toBe(true);
    expect((await a.getMyAccess(s.token)).must_change).toBe(true);
    expect(await code(a.getStartup(s.token))).toBe('forbidden');
    expect(await code(a.getEvents(s.token, 2026))).toBe('forbidden');
    expect(await code(a.changePassword(s.token, DEMO_TEMP_PASSWORD, 'short'))).toBe('bad_request');
    expect(await code(a.changePassword(s.token, DEMO_TEMP_PASSWORD, DEMO_TEMP_PASSWORD))).toBe('bad_request');
    expect(await code(a.changePassword(s.token, 'wrong-current', 'A-New-Password-1'))).toBe('bad_credentials');
    const s2 = await a.changePassword(s.token, DEMO_TEMP_PASSWORD, 'A-New-Password-1');
    expect(s2.must_change).toBe(false);
    expect((await a.getStartup(s2.token)).areas.length).toBe(19);
    expect(await code(a.login(DEMO_TEMP_EMAIL, DEMO_TEMP_PASSWORD, false))).toBe('bad_credentials');
    expect(await code(a.login(DEMO_TEMP_EMAIL, 'A-New-Password-1', false))).toBe('ok');
  });
});

describe('access per action (docs/wire-protocol.md section 3)', () => {
  const ev = async (r: string) => (await api.getEvents(tok(r), 2026))[100];
  it('tab levels per role match the defaults', () => {
    expect(sessions.viewer.access).toMatchObject({ overview: 'View', events: 'View', upload: 'Hidden', master: 'Hidden', settings: 'Hidden', users: 'Hidden' });
    expect(sessions.engineer.access).toMatchObject({ events: 'Edit', upload: 'Edit', master: 'Edit', settings: 'Hidden', users: 'Hidden' });
    expect(sessions.manager.access).toMatchObject({ events: 'View', upload: 'Hidden', master: 'View' });
    expect(Object.values(sessions.admin.access).every((l) => l === 'Edit')).toBe(true);
  });
  it('reads', async () => {
    for (const r of ['admin', 'manager', 'engineer', 'viewer']) {
      expect(await code(api.getStartup(tok(r)))).toBe('ok');
      expect(await code(api.getEvents(tok(r), 2026))).toBe('ok');
      expect(await code(api.getEventEdits(tok(r), (await ev(r)).event_id))).toBe('ok');
    }
    expect(await code(api.getUploadHistory(tok('admin')))).toBe('ok');
    expect(await code(api.getUploadHistory(tok('engineer')))).toBe('ok');
    expect(await code(api.getUploadHistory(tok('manager')))).toBe('forbidden');
    expect(await code(api.getUploadHistory(tok('viewer')))).toBe('forbidden');
    expect(await code(api.getUploadWarnings(tok('viewer'), 'x'))).toBe('forbidden');
    expect(await code(api.listUsers(tok('admin')))).toBe('ok');
    for (const r of ['manager', 'engineer', 'viewer']) expect(await code(api.listUsers(tok(r)))).toBe('forbidden');
  });
  it('refusals carry accessDenied', async () => {
    const err = await api.listUsers(tok('viewer')).catch((e: ApiError) => e);
    expect((err as ApiError).accessDenied).toBe(true);
  });
  it('writes', async () => {
    const e = await ev('admin');
    expect(await code(api.editEvent(tok('viewer'), e.event_id, { description: 'x' }, 'n'))).toBe('forbidden');
    expect(await code(api.editEvent(tok('manager'), e.event_id, { description: 'x' }, 'n'))).toBe('forbidden');
    expect(await code(api.voidEvent(tok('viewer'), e.event_id, true, 'n'))).toBe('forbidden');
    expect(await code(api.uploadStart(tok('manager'), 'f.xlsx', 'h'))).toBe('forbidden');
    expect(await code(api.uploadStart(tok('viewer'), 'f.xlsx', 'h'))).toBe('forbidden');
    expect(await code(api.saveArea(tok('manager'), { ...(await api.getStartup(tok('admin'))).areas[0] }))).toBe('forbidden');
    expect(await code(api.saveSettings(tok('engineer'), { min_password_length: '12' }))).toBe('forbidden');
    expect(await code(api.createUser(tok('engineer'), { email: 'a@b.co', display_name: 'A', role_id: 'ROLE-VIEW' }))).toBe('forbidden');
    expect(await code(api.deleteAlias(tok('viewer'), 'x'))).toBe('forbidden');
  });
  it('a per-user override wins over the role', async () => {
    const a = createMockApi();
    const admin = await a.login('admin@demo.test', DEMO_PASSWORD, false);
    const users = await a.listUsers(admin.token);
    const viewer = users.find((u) => u.email === 'viewer@demo.test')!;
    const updated = await a.setUserTabAccess(admin.token, viewer.user_id, { upload: 'View', events: 'Edit', overview: 'Hidden' });
    expect(updated.overrides).toEqual({ upload: 'View', events: 'Edit', overview: 'Hidden' });
    const s = await a.login('viewer@demo.test', DEMO_PASSWORD, false);
    expect(s.access).toMatchObject({ upload: 'View', events: 'Edit', overview: 'Hidden', pareto: 'View' });
    expect(await code(a.getUploadHistory(s.token))).toBe('ok');
    expect(await code(a.uploadStart(s.token, 'f', 'h'))).toBe('forbidden');
    const evs = await a.getEvents(s.token, 2026);
    expect(await code(a.editEvent(s.token, evs[3].event_id, { description: 'via override' }, 'because'))).toBe('ok');
  });
  it('a user with every tab hidden gets nothing', async () => {
    const a = createMockApi();
    const admin = await a.login('admin@demo.test', DEMO_PASSWORD, false);
    const viewer = (await a.listUsers(admin.token)).find((u) => u.email === 'viewer@demo.test')!;
    const hidden = Object.fromEntries(TAB_IDS.map((t) => [t, 'Hidden']));
    await a.setUserTabAccess(admin.token, viewer.user_id, hidden);
    const s = await a.login('viewer@demo.test', DEMO_PASSWORD, false);
    expect(await code(a.getStartup(s.token))).toBe('forbidden');
    expect(await code(a.getEvents(s.token, 2026))).toBe('forbidden');
  });
  it('a deactivated user is refused even with a valid token', async () => {
    const a = createMockApi();
    const admin = await a.login('admin@demo.test', DEMO_PASSWORD, false);
    const viewerSession = await a.login('viewer@demo.test', DEMO_PASSWORD, false);
    const viewer = (await a.listUsers(admin.token)).find((u) => u.email === 'viewer@demo.test')!;
    await a.updateUser(admin.token, viewer.user_id, { active: false });
    expect(await code(a.getEvents(viewerSession.token, 2026))).toBe('unauthenticated');
    expect(await code(a.login('viewer@demo.test', DEMO_PASSWORD, false))).toBe('bad_credentials');
  });
});

describe('edit and void semantics', () => {
  const pickEvent = async (a: MockApi, token: string, filter: (e: EventRow) => boolean): Promise<EventRow> => {
    const evs = await a.getEvents(token, 2026);
    return evs.find((e) => !e.is_void && !e.edited && !e.flags && filter(e))!;
  };
  it('needs a note and a real change, and only editable fields', async () => {
    const a = createMockApi();
    const s = await a.login('engineer@demo.test', DEMO_PASSWORD, false);
    const e = await pickEvent(a, s.token, (x) => x.freq === 1);
    expect(await code(a.editEvent(s.token, e.event_id, { description: 'x' }, '   '))).toBe('bad_request');
    expect(await code(a.editEvent(s.token, e.event_id, { duration_s: 5 } as never, 'why'))).toBe('bad_request');
    expect(await code(a.editEvent(s.token, e.event_id, { fingerprint: 'x' } as never, 'why'))).toBe('bad_request');
    expect(await code(a.editEvent(s.token, e.event_id, { description: e.description }, 'same'))).toBe('bad_request');
    expect(await code(a.editEvent(s.token, 'EV-missing', { description: 'x' }, 'why'))).toBe('not_found');
    expect(await code(a.editEvent(s.token, e.event_id, { freq: 2 as never }, 'why'))).toBe('bad_request');
    expect(await code(a.editEvent(s.token, e.event_id, { classification: 'XYZ' as never }, 'why'))).toBe('bad_request');
    expect(await code(a.editEvent(s.token, e.event_id, { stop_ts: 'yesterday' }, 'why'))).toBe('bad_request');
    expect(await code(a.editEvent(s.token, e.event_id, { area_id: 'NOPE' }, 'why'))).toBe('bad_request');
    expect((await a.getEventEdits(s.token, e.event_id))).toHaveLength(0);
  });
  it('recomputes duration, sets edited, writes one history row per changed field, keeps the fingerprint', async () => {
    const a = createMockApi();
    const s = await a.login('engineer@demo.test', DEMO_PASSWORD, false);
    const e = await pickEvent(a, s.token, (x) => x.freq === 1);
    const newStart = '2026-04-01 12:00:00';
    const out = await a.editEvent(s.token, e.event_id, { stop_ts: '2026-04-01 11:00:00.000', start_ts: newStart, description: ' fixed ' }, ' Corrected from the log ');
    expect(out.edited).toBe(true);
    expect(out.duration_s).toBe(3600);
    expect(out.start_ts).toBe('2026-04-01 12:00:00.000');
    expect(out.description).toBe('fixed');
    expect(out.fingerprint).toBe(e.fingerprint);
    expect(out.event_id).toBe(e.event_id);
    const hist = await a.getEventEdits(s.token, e.event_id);
    expect(hist.map((h) => h.field).sort()).toEqual(['description', 'start_ts', 'stop_ts']);
    expect(hist.every((h) => h.note === 'Corrected from the log' && h.edited_by === 'U-DEMO-ENG')).toBe(true);
    expect(hist.find((h) => h.field === 'stop_ts')).toMatchObject({ old_value: e.stop_ts, new_value: '2026-04-01 11:00:00.000' });
    expect(a.__db().audit_log.some((l) => l.action === 'edit_event' && l.entity_id === e.event_id)).toBe(true);
    // the stored row is what getEvents returns afterwards
    expect((await a.getEvents(s.token, 2026)).find((x) => x.event_id === e.event_id)!.edited).toBe(true);
  });
  it('derives criticality from the classification and is_failure from criticality and freq', async () => {
    const a = createMockApi();
    const s = await a.login('engineer@demo.test', DEMO_PASSWORD, false);
    const e = await pickEvent(a, s.token, (x) => x.freq === 1 && x.classification === 'MEC' && x.is_failure);
    const planned = await a.editEvent(s.token, e.event_id, { classification: 'pl' as never }, 'It was planned work');
    expect(planned.classification).toBe('PL');
    expect(planned.criticality).toBe('NO_INC');
    expect(planned.is_failure).toBe(false);
    const back = await a.editEvent(s.token, e.event_id, { classification: 'ELE' }, 'Actually electrical');
    expect(back.criticality).toBe('INC');
    expect(back.is_failure).toBe(true);
    const cont = await a.editEvent(s.token, e.event_id, { freq: 0 }, 'This continues the stop above');
    expect(cont.is_failure).toBe(false);
    // an explicit value wins over the derived one
    const forced = await a.editEvent(s.token, e.event_id, { freq: 1, is_failure: false }, 'Not counted as a failure');
    expect(forced.is_failure).toBe(false);
    const hist = await a.getEventEdits(s.token, e.event_id);
    expect(hist.filter((h) => h.field === 'criticality')).toHaveLength(2);
  });
  it('re-resolves equipment, reason and flags', async () => {
    const a = createMockApi();
    const s = await a.login('engineer@demo.test', DEMO_PASSWORD, false);
    const e = await pickEvent(a, s.token, (x) => x.freq === 1 && !x.is_area_level);
    const bad = await a.editEvent(s.token, e.event_id, { code_raw: '000.ZZ000', reason_raw: 'something not listed' }, 'testing flags');
    expect(bad.equipment_id).toBeUndefined();
    expect(bad.reason_id).toBeUndefined();
    expect(bad.flags).toContain('unknown_code');
    expect(bad.flags).toContain('unlisted_reason');
    const blank = await a.editEvent(s.token, e.event_id, { reason_raw: '' }, 'blank');
    expect(blank.flags).toContain('blank_reason');
    expect(blank.flags).not.toContain('unlisted_reason');
    const mixed = await a.editEvent(s.token, e.event_id, { code_raw: ' n/a ', reason_raw: '  BEARING   failure ', classification: 'MEC' }, 'fix');
    expect(mixed.is_area_level).toBe(true);
    expect(mixed.equipment_id).toBeUndefined();
    expect(mixed.reason_id).toBe('R-MEC-001');
    expect(mixed.flags ?? '').not.toContain('unknown_code');
    const rev = await a.editEvent(s.token, e.event_id, { stop_ts: '2026-04-01 12:00:00', start_ts: '2026-04-01 11:00:00' }, 'swapped');
    expect(rev.duration_s).toBe(-3600);
    expect(rev.flags).toContain('end_before_start');
  });
  it('changing the area moves the line, and a mismatch is refused', async () => {
    const a = createMockApi();
    const s = await a.login('engineer@demo.test', DEMO_PASSWORD, false);
    const e = await pickEvent(a, s.token, (x) => x.freq === 1 && x.line_id === 'L.1');
    const moved = await a.editEvent(s.token, e.event_id, { area_id: 'K.2' }, 'wrong area');
    expect(moved.line_id).toBe('L.2');
    // a line that disagrees with the area is stored and flagged, not refused; an unknown line or area is refused
    const mismatch = await a.editEvent(s.token, e.event_id, { area_id: 'CR', line_id: 'L.2' }, 'sheet says L.2');
    expect(mismatch.flags).toContain('line_mismatch');
    expect(await code(a.editEvent(s.token, e.event_id, { line_id: 'L.9' }, 'bad'))).toBe('bad_request');
    expect(await code(a.editEvent(s.token, e.event_id, { area_id: 'NOPE' }, 'bad'))).toBe('bad_request');
    const fixed = await a.editEvent(s.token, e.event_id, { line_id: 'L.1' }, 'back to the area line');
    expect(fixed.flags ?? '').not.toContain('line_mismatch');
  });
  it('void and restore need a note, keep the row, and write history', async () => {
    const a = createMockApi();
    const s = await a.login('engineer@demo.test', DEMO_PASSWORD, false);
    const e = await pickEvent(a, s.token, () => true);
    expect(await code(a.voidEvent(s.token, e.event_id, true, ''))).toBe('bad_request');
    const v = await a.voidEvent(s.token, e.event_id, true, 'Duplicate');
    expect(v.is_void).toBe(true);
    expect(v.edited).toBe(false);
    expect((await a.getEvents(s.token, 2026)).some((x) => x.event_id === e.event_id && x.is_void)).toBe(true);
    expect(await code(a.voidEvent(s.token, e.event_id, true, 'again'))).toBe('conflict');
    expect(await code(a.editEvent(s.token, e.event_id, { description: 'x' }, 'n'))).toBe('conflict');
    const r = await a.voidEvent(s.token, e.event_id, false, 'It was real');
    expect(r.is_void).toBe(false);
    const hist = await a.getEventEdits(s.token, e.event_id);
    expect(hist.map((h) => [h.field, h.old_value, h.new_value])).toEqual([['is_void', 'FALSE', 'TRUE'], ['is_void', 'TRUE', 'FALSE']]);
  });
  it('edits live in memory only: a new instance starts clean', async () => {
    const a = createMockApi();
    const s = await a.login('engineer@demo.test', DEMO_PASSWORD, false);
    const e = await pickEvent(a, s.token, () => true);
    await a.voidEvent(s.token, e.event_id, true, 'x');
    const b = createMockApi();
    const s2 = await b.login('engineer@demo.test', DEMO_PASSWORD, false);
    expect((await b.getEvents(s2.token, 2026)).find((x) => x.event_id === e.event_id)!.is_void).toBe(false);
  });
});

describe('upload', () => {
  const row = (over: Partial<UploadRow> = {}): UploadRow => {
    const base = { area_id: 'CR', code_raw: ' 111..bc100 ', stop_ts: '2026-10-10 01:00:00.000', start_ts: '2026-10-10 01:30:00.000' };
    const r: UploadRow = {
      source_row: 10, event_date: '2026-10-10', line_id: 'L.1', area_id: base.area_id, code_raw: base.code_raw, stop_ts: base.stop_ts, start_ts: base.start_ts,
      freq: 1, classification: 'Mec', criticality: 'INC', is_failure: true, reason_raw: '  bearing   FAILURE ', description: 'd',
      fingerprint: fingerprintOf(base.area_id, base.code_raw, base.stop_ts, base.start_ts), ...over,
    };
    return r;
  };
  it('normalises, flags, rejects, and is idempotent', async () => {
    const a = createMockApi();
    const s = await a.login('engineer@demo.test', DEMO_PASSWORD, false);
    const { batch_id } = await a.uploadStart(s.token, 'test.xlsx', 'hash');
    const good = row();
    const unknown = row({ source_row: 11, code_raw: '999.NOPE', stop_ts: '2026-10-10 02:00:00.000', start_ts: '2026-10-10 02:10:00.000', fingerprint: fingerprintOf('CR', '999.NOPE', '2026-10-10 02:00:00.000', '2026-10-10 02:10:00.000'), reason_raw: 'Not in list' });
    const badArea = row({ source_row: 12, area_id: 'ZZ', fingerprint: 'a'.repeat(64) });
    const badLine = row({ source_row: 13, line_id: 'L.2', stop_ts: '2026-10-10 03:00:00.000', start_ts: '2026-10-10 03:10:00.000', fingerprint: 'b'.repeat(64) });
    const badClass = row({ source_row: 14, classification: 'XXX', stop_ts: '2026-10-10 04:00:00.000', start_ts: '2026-10-10 04:10:00.000', fingerprint: 'c'.repeat(64) });
    const badTs = row({ source_row: 15, stop_ts: 'soon', fingerprint: 'd'.repeat(64) });
    const badFreq = row({ source_row: 16, freq: 2 as never, fingerprint: 'e'.repeat(64) });
    const r1 = await a.uploadChunk(s.token, batch_id, [good, unknown, badArea, badLine, badClass, badTs, badFreq]);
    // only rows that cannot be stored at all are refused; a wrong area, line or classification is stored with flags
    expect(r1.added).toBe(5);
    expect(r1.identical).toBe(0);
    expect(r1.rejected.map((r) => r.source_row)).toEqual([15, 16]);
    const r2 = await a.uploadChunk(s.token, batch_id, [good, unknown]);
    expect(r2).toMatchObject({ added: 0, identical: 2 });
    const all = await a.getEvents(s.token, 2026);
    const flagsOf = (src: number) => all.find((e) => e.batch_id === batch_id && e.source_row === src)!.flags;
    expect(flagsOf(12)).toContain('unknown_area');
    expect(flagsOf(13)).toBe('line_mismatch');
    expect(flagsOf(14)).toContain('invalid_classification');
    const stored = (await a.getEvents(s.token, 2026)).find((e) => e.fingerprint === good.fingerprint)!;
    expect(stored.classification).toBe('MEC');
    expect(stored.equipment_id).toBe('111.BC100');
    expect(stored.reason_id).toBe('R-MEC-001');
    expect(stored.duration_s).toBe(1800);
    expect(stored.event_id).toBe(eventIdOf(good.fingerprint));
    expect(stored.edited).toBe(false);
    const u = (await a.getEvents(s.token, 2026)).find((e) => e.fingerprint === unknown.fingerprint)!;
    expect(u.flags).toContain('unknown_code');
    expect(u.flags).toContain('unlisted_reason');
    const done = await a.uploadFinish(s.token, batch_id, { rows_read: 7, rows_skipped: 0 }, [{ type: 'unknown_code', source_row: 11, detail: 'x' }]);
    expect(done).toMatchObject({ status: 'Completed', rows_added: 5, rows_identical: 2, rows_read: 7, warning_count: 1 });
    expect((await a.getUploadWarnings(s.token, batch_id))[0].warning_id).toBe(`W-${batch_id}-1`);
    expect((await a.getUploadHistory(s.token))[0].batch_id).toBe(batch_id);
    expect(await code(a.uploadChunk(s.token, batch_id, [good]))).toBe('conflict');
  });
});

describe('master data and settings', () => {
  it('saves equipment (many-to-many), aliases, reasons, areas and settings', async () => {
    const a = createMockApi();
    const s = await a.login('engineer@demo.test', DEMO_PASSWORD, false);
    await a.saveEquipment(s.token, { equipment_id: ' 999 . tt100', status: 'Active', needs_review: false }, ['CR', 'K.1']);
    let start = await a.getStartup(s.token);
    expect(start.equipment.some((e) => e.equipment_id === '999.TT100')).toBe(true);
    expect(start.equipment_areas.filter((e) => e.equipment_id === '999.TT100').map((e) => e.area_id).sort()).toEqual(['CR', 'K.1']);
    expect(await code(a.saveEquipment(s.token, { equipment_id: 'N/A', status: 'Active', needs_review: false }, []))).toBe('bad_request');
    expect(await code(a.saveEquipment(s.token, { equipment_id: 'X1', status: 'Active', needs_review: false }, ['NOPE']))).toBe('bad_request');
    await a.saveAlias(s.token, { alias: '999 tt 10', equipment_id: '999.TT100' });
    expect((await a.getStartup(s.token)).aliases.some((x) => x.alias === '999TT10')).toBe(true);
    expect(await code(a.saveAlias(s.token, { alias: '999.TT100', equipment_id: '999.TT100' }))).toBe('conflict');
    await a.deleteAlias(s.token, '999tt10');
    expect(await code(a.deleteAlias(s.token, '999tt10'))).toBe('not_found');
    await a.saveReason(s.token, { reason_id: '', classification: 'MEC', text_as_listed: '  New  reason ', match_key: '', order_no: 0, active: true });
    start = await a.getStartup(s.token);
    const r = start.reasons.find((x) => x.match_key === 'new reason')!;
    expect(r.reason_id).toBe('R-MEC-015');
    expect(await code(a.saveReason(s.token, { reason_id: '', classification: 'MEC', text_as_listed: 'new REASON', match_key: '', order_no: 0, active: true }))).toBe('conflict');
    const admin = await a.login('admin@demo.test', DEMO_PASSWORD, false);
    await a.saveSettings(admin.token, { repeat_window_days: '45', availability_target_pct: '' });
    expect((await a.getStartup(admin.token)).settings.find((x) => x.key === 'repeat_window_days')!.value).toBe('45');
    expect(await code(a.saveSettings(admin.token, { nope: '1' }))).toBe('bad_request');
    expect(await code(a.saveSettings(admin.token, { lockout_attempts: '0' }))).toBe('bad_request');
    expect(await code(a.saveSettings(admin.token, { availability_basis: 'Z' }))).toBe('bad_request');
    await a.saveArea(s.token, { area_id: 'CR', name: 'Crusher renamed', line_id: 'L.1', sort_order: 1, active: true, in_downtime_sheet: true });
    expect((await a.getStartup(s.token)).areas.find((x) => x.area_id === 'CR')!.name).toBe('Crusher renamed');
    expect(await code(a.saveArea(s.token, { area_id: 'Q', name: 'Q', line_id: 'L.9', sort_order: 1, active: true, in_downtime_sheet: false }))).toBe('bad_request');
  });
});

describe('user administration', () => {
  it('creates users with a one-time temporary password and forces a change', async () => {
    const a = createMockApi();
    const admin = await a.login('admin@demo.test', DEMO_PASSWORD, false);
    expect(await code(a.createUser(admin.token, { email: 'not-an-email', display_name: 'X', role_id: 'ROLE-VIEW' }))).toBe('bad_request');
    expect(await code(a.createUser(admin.token, { email: 'viewer@demo.test', display_name: 'X', role_id: 'ROLE-VIEW' }))).toBe('conflict');
    expect(await code(a.createUser(admin.token, { email: 'x@demo.test', display_name: 'X', role_id: 'ROLE-NOPE' }))).toBe('bad_request');
    const { user, temp_password } = await a.createUser(admin.token, { email: 'New.Person@Demo.test', display_name: 'New Person', role_id: 'ROLE-ENG' });
    expect(user.email).toBe('new.person@demo.test');
    expect(user.must_change).toBe(true);
    expect(temp_password.length).toBeGreaterThanOrEqual(10);
    expect(JSON.stringify(await a.listUsers(admin.token))).not.toContain(temp_password);
    const s = await a.login('new.person@demo.test', temp_password, false);
    expect(s.must_change).toBe(true);
    const reset = await a.resetPassword(admin.token, user.user_id);
    expect(reset.temp_password).not.toBe(temp_password);
    expect(await code(a.login('new.person@demo.test', temp_password, false))).toBe('bad_credentials');
    expect((await a.login('new.person@demo.test', reset.temp_password, false)).must_change).toBe(true);
  });
  it('updates users and protects the signed-in admin', async () => {
    const a = createMockApi();
    const admin = await a.login('admin@demo.test', DEMO_PASSWORD, false);
    const list = await a.listUsers(admin.token);
    const me = list.find((u) => u.email === 'admin@demo.test')!;
    const eng = list.find((u) => u.email === 'engineer@demo.test')!;
    expect(list.every((u) => !('password' in u))).toBe(true);
    expect(await code(a.updateUser(admin.token, me.user_id, { active: false }))).toBe('conflict');
    expect(await code(a.updateUser(admin.token, me.user_id, { role_id: 'ROLE-VIEW' }))).toBe('conflict');
    expect(await code(a.setUserTabAccess(admin.token, me.user_id, { users: 'View' }))).toBe('conflict');
    const u = await a.updateUser(admin.token, eng.user_id, { display_name: ' Eng Renamed ', role_id: 'ROLE-MGR' });
    expect(u).toMatchObject({ display_name: 'Eng Renamed', role_id: 'ROLE-MGR' });
    expect(await code(a.updateUser(admin.token, 'U-NOPE', { active: false }))).toBe('not_found');
    expect(await code(a.setUserTabAccess(admin.token, eng.user_id, { bogus: 'View' } as never))).toBe('bad_request');
    expect(await code(a.setUserTabAccess(admin.token, eng.user_id, { events: 'Maybe' } as never))).toBe('bad_request');
    expect((await a.setUserTabAccess(admin.token, eng.user_id, {})).overrides).toBeUndefined();
  });
});


describe('notifications in the mock', () => {
  const NOON = Date.parse('2026-10-12T12:00:00Z');
  async function fresh() {
    const a = createMockApi({ seed: 11 });
    a.__setNow(() => NOON);
    const admin = await a.login('admin@demo.test', DEMO_PASSWORD, true);
    const viewer = await a.login('viewer@demo.test', DEMO_PASSWORD, true);
    return { a, admin, viewer };
  }

  it('fills itself only through the rules: every row has a rule type, a dedupe key of that rule and a retention', async () => {
    const { a, viewer } = await fresh();
    const { items, state, prefs } = await a.getNotifications(viewer.token);
    expect(state).toEqual([]);
    expect(prefs).toEqual({});
    expect(items.length).toBeGreaterThan(0);
    const prefix: Record<string, string> = {
      long_stop: 'long_stop|', repeat_group: 'repeat|', failure_spike: 'spike|', availability_low: 'availability|',
      upload_gap: 'upload_gap|', upload_done: 'upload|', user_event: 'user|',
    };
    for (const n of items) {
      expect(n.dedupe_key.startsWith(prefix[n.type] as string), n.dedupe_key).toBe(true);
      expect(n.status).toBe('open');
      expect(n.expires_at > n.created_at).toBe(true);
      expect(n.notification_id).toMatch(/^NT-[0-9a-f]{16}$/);
    }
    expect(new Set(items.map((n) => n.dedupe_key)).size).toBe(items.length);
  });

  it('runNotificationChecks is deterministic and idempotent', async () => {
    const one = await fresh();
    const two = await fresh();
    const first = await one.a.runNotificationChecks(one.admin.token); // the very first run creates the demo items
    expect(first.created).toBeGreaterThan(0);
    expect(await one.a.runNotificationChecks(one.admin.token)).toEqual({ created: 0, resolved: 0, expired: 0 });
    const x = await one.a.getNotifications(one.admin.token);
    const y = await two.a.getNotifications(two.admin.token);
    expect(y.items).toEqual(x.items);
    expect(await code(one.a.runNotificationChecks(one.viewer.token))).toBe('forbidden');
  });

  it('keeps state and preferences per user and refuses what the server refuses', async () => {
    const { a, admin, viewer } = await fresh();
    const first = (await a.getNotifications(viewer.token)).items.find((n) => n.severity === 'alert')!;
    const st = await a.setNotificationState(viewer.token, first.notification_id, 'dismissed');
    expect(st).toMatchObject({ state: 'dismissed', notification_id: first.notification_id });
    expect((await a.getNotifications(viewer.token)).state).toHaveLength(1);
    expect((await a.getNotifications(admin.token)).state).toEqual([]);
    expect(await code(a.setNotificationState(viewer.token, first.notification_id, 'snoozed'))).toBe('bad_request');
    expect(await code(a.setNotificationState(viewer.token, 'NT-nope', 'seen'))).toBe('not_found');
    expect(await code(a.saveNotificationPrefs(viewer.token, { digest: 'hourly' }))).toBe('bad_request');
    expect(await a.saveNotificationPrefs(viewer.token, { digest: 'daily', watch_areas: 'k.1' })).toEqual({ digest: 'daily', watch_areas: 'K.1' });
    expect((await a.getNotifications(admin.token)).prefs).toEqual({});
    expect(await code(a.getNotifications(''))).toBe('unauthenticated');
  });
});

describe('reports tab and saved_reports in the mock', () => {
  it('seeds Admin Edit, Manager Edit, Engineer View, Viewer View; the Reports tab alone allows reading events', async () => {
    const a = createMockApi({ seed: 3 });
    const admin = await a.login('admin@demo.test', DEMO_PASSWORD, false);
    const levels = await Promise.all(['admin', 'manager', 'engineer', 'viewer'].map(async (r) => (await a.getMyAccess((await a.login(`${r}@demo.test`, DEMO_PASSWORD, false)).token)).access.reports));
    expect(levels).toEqual(['Edit', 'Edit', 'View', 'View']);
    const viewer = (await a.listUsers(admin.token)).find((u) => u.email === 'viewer@demo.test')!;
    await a.setUserTabAccess(admin.token, viewer.user_id, { ...Object.fromEntries(TAB_IDS.map((t) => [t, 'Hidden'])), reports: 'View' } as never);
    const s = await a.login('viewer@demo.test', DEMO_PASSWORD, false);
    expect((await a.getEvents(s.token, 2026)).length).toBeGreaterThan(0);
    await a.setUserTabAccess(admin.token, viewer.user_id, Object.fromEntries(TAB_IDS.map((t) => [t, 'Hidden'])) as never);
    expect(await code(a.getEvents(s.token, 2026))).toBe('forbidden');
  });
});

describe('areas switched on and off, and the theme with the account (backend 1.5.0) in the mock', () => {
  it('demo data starts with every area active; only an Admin switches one, audited; getEvents still returns its records', async () => {
    const a = createMockApi({ seed: 5, demoActions: true });
    const admin = await a.login('admin@demo.test', DEMO_PASSWORD, false);
    const st = await a.getStartup(admin.token);
    expect(st.areas.every((x) => x.active)).toBe(true);
    for (const r of ['manager', 'engineer', 'viewer']) {
      const s = await a.login(`${r}@demo.test`, DEMO_PASSWORD, false);
      expect(await code(a.setAreaActive(s.token, 'AFR', false)), r).toBe('forbidden');
    }
    const eng = await a.login('engineer@demo.test', DEMO_PASSWORD, false);
    const afr = st.areas.find((x) => x.area_id === 'AFR')!;
    expect(await code(a.saveArea(eng.token, { ...afr, active: false }))).toBe('forbidden');
    const before = a.__db().audit_log.length;
    expect((await a.setAreaActive(admin.token, 'AFR', false)).active).toBe(false);
    expect(a.__db().audit_log.slice(before).map((x) => [x.action, x.entity_id])).toEqual([['deactivate_area', 'AFR']]);
    // the records stay stored and are still served: the app leaves them out (src/data/activeAreas.ts)
    expect((await a.getEvents(admin.token, 2026)).some((e) => e.area_id === 'AFR')).toBe(true);
    // the rules leave AFR out: no alert or new draft about it
    await a.runNotificationChecks(admin.token);
    expect((await a.getNotifications(admin.token)).items.some((n) => n.area_id === 'AFR' && n.type !== 'action_due')).toBe(false);
    const autoAfr = async () => (await a.listActions(admin.token)).actions.filter((x) => x.area_id === 'AFR' && x.created_by === 'system').length;
    const n = await autoAfr();
    await a.runActionChecks(admin.token);
    expect(await autoAfr()).toBe(n);
  });

  it('the theme is validated and comes back at sign-in and with getMyAccess', async () => {
    const a = createMockApi({ seed: 6 });
    const v = await a.login('viewer@demo.test', DEMO_PASSWORD, false);
    expect(v.theme).toBe('');
    expect(await code(a.saveNotificationPrefs(v.token, { theme: 'Pink' }))).toBe('bad_request');
    await a.saveNotificationPrefs(v.token, { theme: 'Warm Paper' });
    expect((await a.getMyAccess(v.token)).theme).toBe('Warm Paper');
    expect((await a.login('viewer@demo.test', DEMO_PASSWORD, false)).theme).toBe('Warm Paper');
  });
});

describe('who is online and the activity log (backend 1.6.0) in the mock', () => {
  it('demo mode: a few people online, Admin only, and a varied log newest first', async () => {
    const a = createMockApi({ seed: 8, demoActions: true });
    const admin = await a.login('admin@demo.test', DEMO_PASSWORD, false);
    for (const r of ['manager', 'engineer', 'viewer']) {
      const s = await a.login(`${r}@demo.test`, DEMO_PASSWORD, false);
      expect(await code(a.listActiveUsers(s.token)), r).toBe('forbidden');
      expect(await code(a.listAuditLog(s.token, {})), r).toBe('forbidden');
    }
    const out = await a.listActiveUsers(admin.token);
    expect(out.online_count).toBeGreaterThanOrEqual(3);
    const online = out.users.filter((u) => u.online).map((u) => u.display_name);
    expect(online).toEqual(expect.arrayContaining(['Demo Admin', 'Demo Manager', 'Demo Engineer']));
    const log = await a.listAuditLog(admin.token, { limit: 200 });
    expect(new Set(log.entries.map((e) => e.group)).size).toBeGreaterThanOrEqual(8);
    expect(log.entries.every((e, i) => i === 0 || log.entries[i - 1]!.at >= e.at)).toBe(true);
    const finish = log.entries.find((e) => e.action === 'upload_finish');
    expect(finish?.detail).toMatch(/^File July_2026\.xlsx\. Read 2606, added 2594/);
  });

  it('demo people seen a while ago keep their page and device', async () => {
    const a = createMockApi({ seed: 8, demoActions: true });
    const admin = await a.login('admin@demo.test', DEMO_PASSWORD, false);
    const out = await a.listActiveUsers(admin.token);
    expect(out.users.find((u) => u.display_name === 'Demo Manager')).toMatchObject({ device: 'phone', last_page: '/pareto', online: true });
    expect(out.users.find((u) => u.display_name === 'Demo Viewer')).toMatchObject({ online: false });
  });

  it('every write is logged with the server names and before -> after values; personal preferences are not', async () => {
    const a = createMockApi({ seed: 9 });
    const admin = (await a.login('admin@demo.test', DEMO_PASSWORD, false)).token;
    const last = () => a.__db().audit_log[a.__db().audit_log.length - 1]!;
    const st = await a.getStartup(admin);
    const target = st.settings.find((x) => x.key === 'availability_target_pct')!.value;
    const next = target === '88' ? '87' : '88';
    await a.saveSettings(admin, { availability_target_pct: next });
    expect(last()).toMatchObject({ action: 'save_setting', entity_id: 'availability_target_pct', detail: `${target} -> ${next}` });
    const eq = st.equipment[0]!;
    await a.saveEquipment(admin, { ...eq, description: 'Renamed in the test' }, st.equipment_areas.filter((x) => x.equipment_id === eq.equipment_id).map((x) => x.area_id));
    expect(last().action).toBe('update_equipment');
    expect(last().detail).toContain('-> Renamed in the test');
    const view = a.__db().users.find((u) => u.role_id === 'ROLE-VIEW')!;
    await a.updateUser(admin, view.user_id, { role_id: 'ROLE-ENG' });
    expect(last()).toMatchObject({ action: 'update_user', detail: 'role_id: ROLE-VIEW -> ROLE-ENG' });
    await a.setUserTabAccess(admin, view.user_id, { upload: 'Edit' });
    expect(last()).toMatchObject({ action: 'set_tab_access', detail: 'upload: role default -> Edit' });
    const created = await a.createAction(admin, { title: 'Log me', scope_kind: 'area', area_id: 'K.1', owner: 'MEC', status: 'Open' } as never);
    await a.addActionComment(admin, created.action.action_id, 'A comment for the log');
    expect(last()).toMatchObject({ action: 'comment_action', entity_id: created.action.action_id, detail: 'A comment for the log' });
    const n = a.__db().audit_log.length;
    await a.saveNotificationPrefs(admin, { digest: 'daily' });
    await a.getMyAccess(admin, { page: '/dashboard', device: 'desktop' });
    expect(a.__db().audit_log.length).toBe(n);
    await a.logout(admin);
    expect(last()).toMatchObject({ action: 'logout' });
  });
});
