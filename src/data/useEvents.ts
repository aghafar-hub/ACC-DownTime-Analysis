import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { EventRow } from '../api/types';
import { splitInactive, inactiveAreaIds } from './activeAreas';
import { eventsResource, startupResource, type ResState } from './stores';

export interface EventsHook extends ResState<EventRow[]> {
  /** the year's records without those of inactive areas (src/data/activeAreas.ts) */
  events: EventRow[];
  reload: () => void;
  /** Puts an updated row (after an edit or void) into the loaded list and the device cache. */
  replaceEvent: (row: EventRow) => void;
}

const NONE: ResState<EventRow[]> = { data: null, loading: false, refreshing: false, error: null, accessDenied: false, fromCache: false, savedAt: null };
const noSubscribe = () => () => {};
const noSnapshot = () => NONE;

/** All events of one year (null year: nothing to load yet), records of inactive areas left out. Cached on the device, readable offline. */
export function useEvents(year: number | null): EventsHook {
  const { token } = useAuth();
  const res = year === null ? null : eventsResource(year);
  const state = useSyncExternalStore(res ? res.subscribe : noSubscribe, res ? res.getSnapshot : noSnapshot);
  const startup = useSyncExternalStore(startupResource.subscribe, startupResource.getSnapshot).data;
  const off = inactiveAreaIds(startup);
  useEffect(() => {
    if (token && res) void res.load(token);
  }, [token, res]);
  const reload = useCallback(() => {
    if (token && res) void res.load(token, true);
  }, [token, res]);
  const replaceEvent = useCallback(
    (row: EventRow) => res?.patch((list) => list.map((e) => (e.event_id === row.event_id ? row : e))),
    [res],
  );
  return useMemo(() => ({ ...state, events: splitInactive(state.data ?? [], off).rows, reload, replaceEvent }), [state, off, reload, replaceEvent]);
}
