import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { EventRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useEventsForYears, type MultiYear } from '../dashboard/useDash';
import { eventsResource } from '../data/stores';
import { useStartup, type StartupHook } from '../data/useStartup';
import { buildClassificationSuggester, buildValidation, recheckRecord, type ValidationList, type ValidationRecord } from './model';

// One shared copy of "which records need checking", built from the events of EVERY year. The shell,
// the page tabs, the banners and the Validate page all read it, so the numbers are the same everywhere
// and the list is worked out once per change.
export interface ValidationState {
  /** the person may read events (any dashboard page) */
  enabled: boolean;
  /** every year is loaded */
  ready: boolean;
  st: StartupHook;
  data: MultiYear;
  rows: EventRow[];
  list: ValidationList;
  /** classification most used for the same area and code, from the loaded records */
  suggest: ReturnType<typeof buildClassificationSuggester>;
  reload: () => void;
  /** Puts an edited or voided record into the loaded years (and the device cache); the list follows. */
  replaceEvent: (row: EventRow) => void;
  /** The record as it now stands with the others, or null when nothing is left to fix. */
  recheck: (updated: EventRow) => ValidationRecord | null;
}

const EMPTY_LIST: ValidationList = { records: [], keptRecords: [], summary: { total: 0, blocked: { count: 0, hours: 0 }, kept: { count: 0, leftOut: { count: 0, hours: 0 } }, review: { count: 0 }, overlapping: 0, byFlag: {} } };
const ctx = createContext<ValidationState | null>(null);

const yearOf = (e: Pick<EventRow, 'event_date'>): number => Number(String(e.event_date).slice(0, 4));

export function ValidationProvider({ children }: { children: ReactNode }) {
  const { canView } = useAuth();
  const st = useStartup();
  const enabled = (['overview', 'pareto', 'repeats', 'reliability', 'events'] as const).some((t) => canView(t));
  const years = useMemo(() => (enabled && st.startup ? st.startup.years : []), [enabled, st.startup]);
  const data = useEventsForYears(years);
  const rows = data.rows;
  const list = useMemo(() => (data.ready ? buildValidation(rows) : EMPTY_LIST), [data.ready, rows]);
  const suggest = useMemo(() => buildClassificationSuggester(rows), [rows]);

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
    data.reload();
  }, [st, data]);

  const value = useMemo<ValidationState>(
    () => ({ enabled, ready: data.ready, st, data, rows, list, suggest, reload, replaceEvent, recheck }),
    [enabled, data, st, rows, list, suggest, reload, replaceEvent, recheck],
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
