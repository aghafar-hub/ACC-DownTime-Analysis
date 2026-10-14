import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EventRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useEventsForYears, type MultiYear } from '../dashboard/useDash';
import { eventsResource } from '../data/stores';
import { useStartup, useYear, type StartupHook } from '../data/useStartup';
import { whenIdle } from '../routes/lazyPages';
import { buildClassificationSuggester, buildValidation, recheckRecord, type ValidationList, type ValidationRecord } from './model';

// One shared copy of "which records need checking", built from the events of EVERY year. The shell,
// the page tabs, the banners and the Validate page all read it, so the numbers are the same everywhere
// and the list is worked out once per change.
//
// Loading (R5): sign-in first loads only the latest year (and the year picked in the year switcher), so the
// page badges get a first count quickly (`early`, marked 'checking older years…'); the older years follow
// when the browser is idle (or at once when the Validate page asks for them with `loadAll`). `ready`, `rows`
// and `list` keep their meaning: every year is loaded and the list is complete.
export interface ValidationState {
  /** the person may read events (any dashboard page) */
  enabled: boolean;
  /** every year is loaded */
  ready: boolean;
  /** the latest (and selected) year is loaded and `early` holds its records to check; older years may still be loading */
  earlyReady: boolean;
  /** the list from the years loaded so far: the complete list once `ready`, the first years' list before that, else empty */
  early: ValidationList;
  /** the first years are counted but older years are still being loaded: show counts as 'checking older years…' */
  checkingOlder: boolean;
  /** Load every year now instead of waiting for idle time (the Validate page needs the whole list). */
  loadAll: () => void;
  st: StartupHook;
  data: MultiYear;
  /** every loaded record of active areas (records of inactive areas are left out, src/data/activeAreas.ts) */
  rows: EventRow[];
  list: ValidationList;
  /** records of inactive areas that would need checking: hidden from the list and every count (0 when none) */
  hiddenInactive: number;
  /** classification most used for the same area and code, from the loaded records */
  suggest: ReturnType<typeof buildClassificationSuggester>;
  reload: () => void;
  /** Puts an edited or voided record into the loaded years (and the device cache); the list follows. */
  replaceEvent: (row: EventRow) => void;
  /** The record as it now stands with the others, or null when nothing is left to fix. */
  recheck: (updated: EventRow) => ValidationRecord | null;
}

const EMPTY_LIST: ValidationList = { records: [], overlapRecords: [], keptRecords: [], summary: { total: 0, blocked: { count: 0, hours: 0 }, kept: { count: 0, leftOut: { count: 0, hours: 0 } }, review: { count: 0 }, overlapping: 0, byFlag: {} } };
const ctx = createContext<ValidationState | null>(null);

const yearOf = (e: Pick<EventRow, 'event_date'>): number => Number(String(e.event_date).slice(0, 4));

export function ValidationProvider({ children }: { children: ReactNode }) {
  const { canView } = useAuth();
  const st = useStartup();
  const [selectedYear] = useYear();
  const enabled = (['overview', 'pareto', 'repeats', 'reliability', 'reports', 'events'] as const).some((t) => canView(t));
  const allYears = useMemo(() => (enabled && st.startup ? st.startup.years : []), [enabled, st.startup]);
  // step 1: the latest year and the year picked in the year switcher
  const firstKey = useMemo(() => {
    if (allYears.length === 0) return '';
    const latest = Math.max(...allYears);
    const picked = selectedYear !== null && allYears.includes(selectedYear) ? [selectedYear] : [];
    return [...new Set([latest, ...picked])].sort((a, b) => a - b).join(',');
  }, [allYears, selectedYear]);
  const firstYears = useMemo(() => (firstKey ? firstKey.split(',').map(Number) : []), [firstKey]);
  const first = useEventsForYears(firstYears);
  // step 2: every year, once the first ones are in and the browser is idle (or when asked)
  const [wantAll, setWantAll] = useState(false);
  const onlyFirst = allYears.length > 0 && allYears.length === firstYears.length;
  useEffect(() => {
    if (wantAll || onlyFirst || !first.ready) return undefined;
    return whenIdle(() => setWantAll(true), 3000);
  }, [wantAll, onlyFirst, first.ready]);
  const years = wantAll || onlyFirst ? allYears : [];
  const data = useEventsForYears(years);
  const rows = data.rows;
  const list = useMemo(() => (data.ready ? buildValidation(rows) : EMPTY_LIST), [data.ready, rows]);
  // the records of inactive areas are not checked here; only how many would need it is told (Validate shows a note)
  const hiddenInactive = useMemo(() => (data.ready && data.hidden.length ? buildValidation(data.hidden).summary.total : 0), [data.ready, data.hidden]);
  const firstList = useMemo(() => (first.ready && !data.ready ? buildValidation(first.rows) : EMPTY_LIST), [first.ready, first.rows, data.ready]);
  const early = data.ready ? list : firstList;
  const earlyReady = data.ready || first.ready;
  const checkingOlder = !data.ready && first.ready;
  const suggest = useMemo(() => buildClassificationSuggester(rows), [rows]);
  const loadAll = useCallback(() => setWantAll(true), []);
  // the data shown for loading and errors: every year once asked for, else the first years
  const shown = years.length > 0 ? data : first;

  const replaceEvent = useCallback(
    (row: EventRow) => {
      // the year it is stored under can change when the date is edited
      const target = yearOf(row);
      for (const y of st.startup?.years ?? []) {
        const res = eventsResource(y);
        const held = res.getSnapshot().data;
        if (!held || !held.some((e) => e.event_id === row.event_id)) continue;
        if (y === target) res.patch((l) => l.map((e) => (e.event_id === row.event_id ? row : e)));
        else {
          res.patch((l) => l.filter((e) => e.event_id !== row.event_id));
          const to = eventsResource(target);
          if (to.getSnapshot().data) to.patch((l) => [...l, row]);
        }
        return;
      }
    },
    [st.startup],
  );
  const recheck = useCallback((updated: EventRow) => recheckRecord(rows, updated), [rows]);
  const reload = useCallback(() => {
    st.reload();
    first.reload();
    data.reload();
  }, [st, first, data]);

  const value = useMemo<ValidationState>(
    () => ({ enabled, ready: data.ready, earlyReady, early, checkingOlder, loadAll, st, data: shown, rows, list, hiddenInactive, suggest, reload, replaceEvent, recheck }),
    [enabled, data.ready, earlyReady, early, checkingOlder, loadAll, shown, st, rows, list, hiddenInactive, suggest, reload, replaceEvent, recheck],
  );
  return <ctx.Provider value={value}>{children}</ctx.Provider>;
}

export function useValidation(): ValidationState {
  const v = useContext(ctx);
  if (!v) throw new Error('useValidation needs the ValidationProvider');
  return v;
}

/** Same as useValidation, or null outside the shell (tests, pages shown on their own). */
export function useValidationOptional(): ValidationState | null {
  return useContext(ctx);
}
