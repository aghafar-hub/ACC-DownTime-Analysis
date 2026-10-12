// Every key this app stores starts with `acc_dt_`. Test builds also set
// VITE_STORAGE_PREFIX so a test copy on the same address never reads the live
// copy's login or cache. Storage can be missing or blocked (private window,
// previews), so every call is wrapped and the app must work without it.
const TEST_PREFIX = (import.meta.env.VITE_STORAGE_PREFIX as string | undefined) || '';
export const STORAGE_PREFIX = `${TEST_PREFIX}acc_dt_`;

export const storageKey = (name: string): string => `${STORAGE_PREFIX}${name}`;

type Scope = 'local' | 'session';
const area = (scope: Scope): Storage => (scope === 'local' ? localStorage : sessionStorage);

export const store = {
  get(name: string, scope: Scope = 'local'): string | null {
    try {
      return area(scope).getItem(storageKey(name));
    } catch {
      return null;
    }
  },
  set(name: string, value: string, scope: Scope = 'local'): void {
    try {
      area(scope).setItem(storageKey(name), value);
    } catch {
      /* blocked or full: the app works without it */
    }
  },
  remove(name: string, scope: Scope = 'local'): void {
    try {
      area(scope).removeItem(storageKey(name));
    } catch {
      /* ignore */
    }
  },
};
