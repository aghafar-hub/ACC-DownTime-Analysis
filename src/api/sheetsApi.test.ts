import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSheetsApi } from './sheetsApi';
import { ApiError } from './types';

// The wire protocol (docs/wire-protocol.md): text/plain POST, { action, token, params },
// { status: 'ok', data } or { status: 'error', error: { message, code, accessDenied } }.
const URL = 'https://backend.example.invalid/exec';

function stubFetch(body: unknown, init: { ok?: boolean; json?: boolean } = {}) {
  const fn = vi.fn(async (_url: string, _init: RequestInit) => ({
    ok: init.ok ?? true,
    json: async () => {
      if (init.json === false) throw new Error('not json');
      return body;
    },
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const lastCall = (fn: ReturnType<typeof stubFetch>) => {
  const [url, init] = fn.mock.calls[fn.mock.calls.length - 1];
  return { url, init, body: JSON.parse(String(init.body)) };
};

afterEach(() => vi.unstubAllGlobals());

describe('sheetsApi', () => {
  it('posts text/plain JSON with action, token and the documented params', async () => {
    const fn = stubFetch({ status: 'ok', data: { years: [2026] } });
    const api = createSheetsApi(URL);
    await api.getEvents('tok', 2026);
    let c = lastCall(fn);
    expect(c.url).toBe(URL);
    expect(c.init.method).toBe('POST');
    expect((c.init.headers as Record<string, string>)['Content-Type']).toBe('text/plain;charset=utf-8');
    expect(c.body).toEqual({ action: 'getEvents', token: 'tok', params: { year: 2026 } });

    await api.login('a@b.co', 'pw', true);
    c = lastCall(fn);
    expect(c.body).toEqual({ action: 'login', token: '', params: { email: 'a@b.co', password: 'pw', keepSignedIn: true } });

    await api.changePassword('tok', 'old', 'new');
    expect(lastCall(fn).body.params).toEqual({ current: 'old', next: 'new' });
    await api.editEvent('tok', 'EV-1', { description: 'x' }, 'why');
    expect(lastCall(fn).body).toEqual({ action: 'editEvent', token: 'tok', params: { eventId: 'EV-1', changes: { description: 'x' }, note: 'why' } });
    await api.voidEvent('tok', 'EV-1', true, 'dup');
    expect(lastCall(fn).body.params).toEqual({ eventId: 'EV-1', isVoid: true, note: 'dup' });
    await api.uploadStart('tok', 'f.xlsx', 'abc');
    expect(lastCall(fn).body.params).toEqual({ fileName: 'f.xlsx', fileHash: 'abc' });
    await api.uploadChunk('tok', 'B-1', []);
    expect(lastCall(fn).body.params).toEqual({ batchId: 'B-1', rows: [] });
    await api.uploadFinish('tok', 'B-1', { rows_read: 1, rows_skipped: 0 }, []);
    expect(lastCall(fn).body.params).toEqual({ batchId: 'B-1', summary: { rows_read: 1, rows_skipped: 0 }, warnings: [] });
    await api.saveEquipment('tok', { equipment_id: 'X', status: 'Active', needs_review: false }, ['CR']);
    expect(lastCall(fn).body.params).toMatchObject({ areaIds: ['CR'], row: { equipment_id: 'X' } });
    await api.createUser('tok', { email: 'a@b.co', display_name: 'A', role_id: 'ROLE-VIEW' });
    expect(lastCall(fn).body.params).toEqual({ u: { email: 'a@b.co', display_name: 'A', role_id: 'ROLE-VIEW' } });
    await api.updateUser('tok', 'U-1', { active: false });
    expect(lastCall(fn).body.params).toEqual({ userId: 'U-1', changes: { active: false } });
    await api.setUserTabAccess('tok', 'U-1', { events: 'Edit' });
    expect(lastCall(fn).body.params).toEqual({ userId: 'U-1', overrides: { events: 'Edit' } });
    await api.deleteAlias('tok', 'ABC');
    expect(lastCall(fn).body.params).toEqual({ alias: 'ABC' });
    await api.saveSettings('tok', { min_password_length: '12' });
    expect(lastCall(fn).body.params).toEqual({ changes: { min_password_length: '12' } });
    await api.getEventEdits('tok', 'EV-1');
    expect(lastCall(fn).body.params).toEqual({ eventId: 'EV-1' });
    await api.getUploadWarnings('tok', 'B-1');
    expect(lastCall(fn).body.params).toEqual({ batchId: 'B-1' });
    await api.resetPassword('tok', 'U-1');
    expect(lastCall(fn).body.params).toEqual({ userId: 'U-1' });
    await api.getStartup('tok');
    expect(lastCall(fn).body).toEqual({ action: 'getStartup', token: 'tok', params: {} });
  });

  it('sends the four notification actions with the documented params', async () => {
    const fn = stubFetch({ status: 'ok', data: null });
    const api = createSheetsApi(URL);
    await api.getNotifications('tok');
    expect(lastCall(fn).body).toEqual({ action: 'getNotifications', token: 'tok', params: {} });
    await api.setNotificationState('tok', 'NT-1', 'seen');
    expect(lastCall(fn).body).toEqual({ action: 'setNotificationState', token: 'tok', params: { notificationId: 'NT-1', state: 'seen' } });
    await api.setNotificationState('tok', 'NT-1', 'snoozed', '2026-10-13 09:00:00');
    expect(lastCall(fn).body.params).toEqual({ notificationId: 'NT-1', state: 'snoozed', snoozeUntil: '2026-10-13 09:00:00' });
    await api.saveNotificationPrefs('tok', { digest: 'daily', watch_areas: 'K.1' });
    expect(lastCall(fn).body).toEqual({ action: 'saveNotificationPrefs', token: 'tok', params: { prefs: { digest: 'daily', watch_areas: 'K.1' } } });
    await api.runNotificationChecks('tok');
    expect(lastCall(fn).body).toEqual({ action: 'runNotificationChecks', token: 'tok', params: {} });
  });

  it('returns data from an ok envelope', async () => {
    stubFetch({ status: 'ok', data: [{ event_id: 'EV-1' }] });
    expect(await createSheetsApi(URL).getEvents('t', 2026)).toEqual([{ event_id: 'EV-1' }]);
  });

  it('maps an error envelope to ApiError with code and accessDenied', async () => {
    stubFetch({ status: 'error', error: { message: 'You do not have access to this.', code: 'forbidden', accessDenied: true } });
    const err = await createSheetsApi(URL).listUsers('t').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: 'You do not have access to this.', code: 'forbidden', accessDenied: true });

    stubFetch({ status: 'error', error: { message: 'Email or password is not correct.', code: 'bad_credentials', accessDenied: false } });
    const e2 = await createSheetsApi(URL).login('a', 'b', false).catch((e) => e);
    expect(e2).toMatchObject({ code: 'bad_credentials', accessDenied: false });

    stubFetch({ status: 'error', error: { message: 'Session ended', code: 'unauthenticated' } });
    expect(await createSheetsApi(URL).getStartup('t').catch((e) => e)).toMatchObject({ code: 'unauthenticated', accessDenied: false });
  });

  it('treats code "forbidden" as access denied even if the flag is missing', async () => {
    stubFetch({ status: 'error', error: { message: 'No.', code: 'forbidden' } });
    expect(await createSheetsApi(URL).getStartup('t').catch((e) => e)).toMatchObject({ accessDenied: true });
  });

  it('gives plain messages for a network failure and for an unreadable answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const net = await createSheetsApi(URL).getStartup('t').catch((e) => e);
    expect(net).toMatchObject({ code: 'network' });
    expect(net.message).toMatch(/Cannot reach the server/);

    stubFetch(null, { json: false });
    expect(await createSheetsApi(URL).getStartup('t').catch((e) => e)).toMatchObject({ code: 'server' });

    stubFetch({ nonsense: true });
    expect(await createSheetsApi(URL).getStartup('t').catch((e) => e)).toMatchObject({ code: 'server' });
  });
});
