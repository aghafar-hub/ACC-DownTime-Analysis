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

/** How long a call may take before the app gives up and says so: 45 s, 180 s for the upload steps and the re-check. */
export const API_TIMEOUT_MS = 45_000;
export const API_LONG_TIMEOUT_MS = 180_000;
const LONG_ACTIONS: ReadonlySet<string> = new Set(['uploadStart', 'uploadChunk', 'uploadFinish', 'revalidateEvents']);
export const timeoutFor = (action: string): number => (LONG_ACTIONS.has(action) ? API_LONG_TIMEOUT_MS : API_TIMEOUT_MS);
const TIMEOUT_TEXT = 'The server took too long to answer. Check your connection and try again.';

export function createSheetsApi(url: string): Api {
  async function call<T>(action: string, token: string, params: Record<string, unknown> = {}): Promise<T> {
    // a call that never answers (a stalled network, a sleeping server) ends with a clear message instead of a spinner
    const ctrl = typeof AbortController === 'undefined' ? null : new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl?.abort();
    }, timeoutFor(action));
    try {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action, token: token || '', params }),
          redirect: 'follow',
          signal: ctrl?.signal,
        });
      } catch {
        throw new ApiError(timedOut ? TIMEOUT_TEXT : 'Cannot reach the server. Check your connection and try again.', 'network');
      }
      let body: Envelope;
      try {
        body = (await res.json()) as Envelope;
      } catch {
        if (timedOut) throw new ApiError(TIMEOUT_TEXT, 'network');
        throw new ApiError('The server sent an answer the app cannot read. Please try again.', 'server');
      }
      return unwrap<T>(body);
    } finally {
      clearTimeout(timer);
    }
  }

  function unwrap<T>(body: Envelope): T {
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
    acceptEventFlags: (token, eventId, flags, note) => call('acceptEventFlags', token, { eventId, flags, note }),

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

    listActions: (token) => call('listActions', token),
    createAction: (token, input, options) => call('createAction', token, options === undefined ? { input } : { input, options }),
    updateAction: (token, actionId, changes) => call('updateAction', token, { actionId, changes }),
    addActionComment: (token, actionId, text) => call('addActionComment', token, { actionId, text }),
    saveContractors: (token, rows) => call('saveContractors', token, { rows }),
    getAreaTargets: (token, year) => call('getAreaTargets', token, year === undefined ? {} : { year }),
    saveAreaTargets: (token, year, rows) => call('saveAreaTargets', token, { year, rows }),
    runActionChecks: (token) => call('runActionChecks', token),
  };
}
