// Contract test: the same scenario runs against (a) the real Apps Script backend code,
// reached through the real sheetsApi client with fetch pointed at the backend's router,
// and (b) the in-memory mock API the app uses in demo mode. Both must behave the same,
// so the screens built against the mock keep working against the real backend.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JavaScript test harness of the backend
import { bootstrapAdmin, createEnv } from '../../backend/apps-script/tests/harness.mjs';
import { createMockApi } from '../../src/api/mockApi';
import { createSheetsApi } from '../../src/api/sheetsApi';
import { ApiError, type Api, type EventRow, type UploadRow } from '../../src/api/types';
import { eventIdFromFingerprint, fingerprint } from '../../src/calc';

interface Subject {
  name: string;
  api: Api;
  admin: { email: string; password: string };
}

function backendSubject(): Subject {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const b = JSON.parse(init.body) as { action: string; token: string; params: Record<string, unknown> };
    return new Response(JSON.stringify(env.call(b.action, b.token, b.params)));
  });
  return { name: 'real backend via sheetsApi', api: createSheetsApi('http://backend.test'), admin: { email: admin.email, password: admin.password } };
}

function mockSubject(): Subject {
  return { name: 'mock api', api: createMockApi({ seed: 7 }), admin: { email: 'admin@demo.test', password: 'Demo-Pass-1234' } };
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

  it('rejects a bad upload row in plain words and stores nothing for it', async () => {
    const { batch_id } = await s.api.uploadStart(token, 'bad.xlsx', 'b'.repeat(64));
    const row = { ...(await uploadRow()), area_id: 'NOPE', stop_ts: `${YEAR}-06-01 01:00:00.000`, start_ts: `${YEAR}-06-01 02:00:00.000` };
    const res = await s.api.uploadChunk(token, batch_id, [row]);
    expect(res.added).toBe(0);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]?.source_row).toBe(5);
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
});
