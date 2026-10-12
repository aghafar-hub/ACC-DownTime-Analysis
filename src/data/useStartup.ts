import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { Startup } from '../api/types';
import { store } from '../storagePrefix';
import { startupResource, type ResState } from './stores';

export interface StartupHook extends ResState<Startup> {
  startup: Startup | null;
  reload: () => void;
}

/** Master data, settings and the list of years. Cached on the device. */
export function useStartup(): StartupHook {
  const { token } = useAuth();
  const state = useSyncExternalStore(startupResource.subscribe, startupResource.getSnapshot);
  useEffect(() => {
    if (token) void startupResource.load(token);
  }, [token]);
  const reload = useCallback(() => {
    if (token) void startupResource.load(token, true);
  }, [token]);
  return useMemo(() => ({ ...state, startup: state.data, reload }), [state, reload]);
}

// ---- the year chosen in the year switcher, kept on this device
let selected: number | null = (() => {
  const n = Number(store.get('year'));
  return Number.isInteger(n) && n > 1990 ? n : null;
})();
const yearListeners = new Set<() => void>();
const subscribeYear = (l: () => void) => {
  yearListeners.add(l);
  return () => yearListeners.delete(l);
};

/** [selected year, setter, all years]. Falls back to the latest year when the stored one has no data. */
export function useYear(): [number | null, (y: number) => void, number[]] {
  const { startup } = useStartup();
  const chosen = useSyncExternalStore(subscribeYear, () => selected);
  const years = startup?.years ?? [];
  const year = chosen !== null && years.includes(chosen) ? chosen : (years[0] ?? null);
  const setYear = useCallback((y: number) => {
    selected = y;
    store.set('year', String(y));
    yearListeners.forEach((l) => l());
  }, []);
  return [year, setYear, years];
}
