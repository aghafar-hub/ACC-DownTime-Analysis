// Loads what a report needs: master data, the latest year (for "the last day with data"), then every year the period,
// its comparison and the repeated-failure history need. Own hook: a report never reads or writes the dashboards' shared
// filters.
import { useCallback, useMemo } from 'react';
import { dataRangeOf, formatDate, type DateRange } from '../calc';
import { yearsNeeded, buildMaster } from '../dashboard/scope';
import { useEventsForYears, type MultiYear } from '../dashboard/useDash';
import { useStartup, type StartupHook } from '../data/useStartup';
import type { EventRow, Startup } from '../api/types';
import { comparisonKindFor, resolvePeriod } from './period';
import { toDashFilters, type ReportSetup } from './setup';

export interface ReportData {
  st: StartupHook;
  startup: Startup | null;
  /** master data and every year needed are loaded */
  ready: boolean;
  rows: EventRow[];
  /** the last day with data */
  asOf: string | null;
  range: DateRange | null;
  /** loading / error state of the event years, for the status line */
  data: MultiYear;
  reload: () => void;
}

export function useReportData(setup: Pick<ReportSetup, 'preset' | 'from' | 'to' | 'compare' | 'filters'> & Partial<ReportSetup>): ReportData {
  const st = useStartup();
  const startup = st.startup;
  const available = startup?.years ?? [];
  const latest = available.length ? Math.max(...available) : null;
  const first = useEventsForYears(latest === null ? [] : [latest]);
  const asOf = useMemo(() => {
    if (!first.ready) return null;
    const cov = dataRangeOf(first.rows.filter((r) => !r.is_void));
    return cov ? cov.to : formatDate(Date.now());
  }, [first.ready, first.rows]);
  const settings = useMemo(() => (startup ? buildMaster(startup).settings : null), [startup]);
  const range = useMemo(() => (asOf ? resolvePeriod(setup.preset, setup.from, setup.to, asOf) : null), [asOf, setup.preset, setup.from, setup.to]);
  const kind = comparisonKindFor(setup.preset);
  const years = useMemo(
    () => (range && settings ? yearsNeeded(range, toDashFilters(setup as ReportSetup, range, setup.compare ? kind : 'none'), settings, available) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range, settings, setup.compare, kind, available.join(',')],
  );
  const wanted = useMemo(() => (latest === null ? years : [...new Set([latest, ...years])].sort((a, b) => a - b)), [latest, years]);
  const data = useEventsForYears(first.ready ? wanted : []);
  const ready = !!startup && first.ready && data.ready && !!range;
  const reload = useCallback(() => {
    st.reload();
    first.reload();
    data.reload();
  }, [st, first, data]);
  return { st, startup, ready, rows: data.rows, asOf, range, data: first.ready ? data : first, reload };
}
