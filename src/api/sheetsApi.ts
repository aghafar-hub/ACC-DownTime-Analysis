// Api implementation that talks to the Apps Script web app described in
// docs/wire-protocol.md. Every call is a POST with a text/plain body (no CORS
// preflight) carrying { action, token, params }.
import type { Api } from './types';
import { ApiError } from './types';

interface Envelope {
  status?: string;
  data?: unknown;
  error?: { message?: string; code?: string; accessDenied?: boolean };
}

export function createSheetsApi(url: string): Api {
  async function call<T>(action: string, token: string, params: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: token || '', params }),
        redirect: 'follow',
      });
    } catch {
      throw new ApiError('Cannot reach the server. Check your connection and try again.', 'network');
    }
    let body: Envelope;
    try {
      body = (await res.json()) as Envelope;
    } catch {
      throw new ApiError('The server sent an answer the app cannot read. Please try again.', 'server');
    }
    if (body && body.status === 'ok') return body.data as T;
    const e = body?.error;
    if (e) throw new ApiError(e.message || 'Something went wrong. Please try again.', e.code || 'server', !!e.accessDenied || e.code === 'forbidden');
    throw new ApiError('The server sent an answer the app cannot read. Please try again.', 'server');
  }

  return {
    login: (email, password, keepSignedIn) => call('login', '', { email, password, keepSignedIn }),
    changePassword: (token, current, next) => call('changePassword', token, { current, next }),
    getMyAccess: (token) => call('getMyAccess', token),

    getStartup: (token) => call('getStartup', token),
    getEvents: (token, year) => call('getEvents', token, { year }),
    getEventEdits: (token, eventId) => call('getEventEdits', token, { eventId }),
    getUploadHistory: (token) => call('getUploadHistory', token),
    getUploadWarnings: (token, batchId) => call('getUploadWarnings', token, { batchId }),

    uploadStart: (token, fileName, fileHash) => call('uploadStart', token, { fileName, fileHash }),
    uploadChunk: (token, batchId, rows) => call('uploadChunk', token, { batchId, rows }),
    uploadFinish: (token, batchId, summary, warnings) => call('uploadFinish', token, { batchId, summary, warnings }),

    revalidateEvents: (token, year) => call('revalidateEvents', token, year === undefined ? {} : { year }),
    editEvent: (token, eventId, changes, note) => call('editEvent', token, { eventId, changes, note }),
    voidEvent: (token, eventId, isVoid, note) => call('voidEvent', token, { eventId, isVoid, note }),

    saveEquipment: (token, row, areaIds) => call('saveEquipment', token, { row, areaIds }),
    saveArea: (token, row) => call('saveArea', token, { row }),
    saveReason: (token, row) => call('saveReason', token, { row }),
    saveAlias: (token, row) => call('saveAlias', token, { row }),
    deleteAlias: (token, alias) => call('deleteAlias', token, { alias }),
    saveSettings: (token, changes) => call('saveSettings', token, { changes }),

    listUsers: (token) => call('listUsers', token),
    createUser: (token, u) => call('createUser', token, { u }),
    updateUser: (token, userId, changes) => call('updateUser', token, { userId, changes }),
    resetPassword: (token, userId) => call('resetPassword', token, { userId }),
    setUserTabAccess: (token, userId, overrides) => call('setUserTabAccess', token, { userId, overrides }),

    getNotifications: (token) => call('getNotifications', token),
    setNotificationState: (token, notificationId, state, snoozeUntil) =>
      call('setNotificationState', token, snoozeUntil === undefined ? { notificationId, state } : { notificationId, state, snoozeUntil }),
    saveNotificationPrefs: (token, prefs) => call('saveNotificationPrefs', token, { prefs }),
    runNotificationChecks: (token) => call('runNotificationChecks', token),
  };
}
