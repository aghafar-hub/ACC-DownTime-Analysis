// The one `api` the app uses: the Apps Script backend when VITE_API_URL is set
// at build time, otherwise the in-memory synthetic API (mock mode).
import { API_URL } from '../config';
import { createSheetsApi } from './sheetsApi';
import type { Api } from './types';
import { ApiError } from './types';

export { ApiError } from './types';

/** Window events the app listens to; they keep the api module free of React. */
export const SESSION_EXPIRED_EVENT = 'acc-dt-session-expired';
export const ACCESS_DENIED_EVENT = 'acc-dt-access-denied';

// The mock (and its synthetic data) is loaded on first use only, so a build
// that talks to a real backend never downloads it.
function lazyMock(): Api {
  let loaded: Promise<Api> | null = null;
  const load = () => (loaded ??= import('./mockApi').then((m) => m.mockApi));
  return new Proxy({} as Api, {
    get: (_t, method: string) => async (...args: unknown[]) => {
      const impl = (await load()) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      return impl[method](...args);
    },
  });
}

// Reports a refused session or refused access to the app, then rethrows.
function watched(base: Api): Api {
  return new Proxy(base, {
    get: (target, method: string) => {
      const fn = (target as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
      return async (...args: unknown[]) => {
        try {
          return await fn.apply(target, args);
        } catch (err) {
          if (err instanceof ApiError && method !== 'login') {
            if (err.code === 'unauthenticated') window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
            else if (err.accessDenied) window.dispatchEvent(new CustomEvent(ACCESS_DENIED_EVENT));
          }
          throw err;
        }
      };
    },
  });
}

export const api: Api = watched(API_URL ? createSheetsApi(API_URL) : lazyMock());

/** Plain-English text for any error. */
export function describeError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
