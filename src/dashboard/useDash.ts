// Hooks for the dashboard pages: the filters (URL query shared by the four tabs), the events of every year the
// filters need, and the scope built from both.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { EventRow, Startup } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { dataRangeOf, type DateRange } from '../calc';
import { eventsResource, type ResState } from '../data/stores';
import { useStartup, type StartupHook } from '../data/useStartup';
import { formatDate } from '../calc';
import { defaultFilters, hasFilterParams, nonFilterParams, parseFilters, resolveRange, serializeFilters, type DashFilters } from './filters';
import { forgetDashFilters, rememberedQuery, rememberQuery } from './sharedFilters';
import { buildBase, buildEventScope, buildKpis, buildMaster, buildWindows, coverageOf, notUploadedOf, yearsNeeded, type DashCtx } from './scope';

// ---------------------------------------------------------------- filters in the URL

/**
 * The filters of this page. The query string is the source of truth; the last one is remembered between the four
 * Analyze tabs (and in sessionStorage, see sharedFilters.ts), so moving to another tab keeps every filter.
 */
export function useDashFilters(): { filters: DashFilters; setFilters: (patch: Partial<DashFilters>) => void; reset: () => void } {
  const [sp, setSp] = useSearchParams();
  const own = hasFilterParams(sp);
  const effective = own ? sp : new URLSearchParams(rememberedQuery());
  const key = effective.toString();
  const filters = useMemo(() => parseFilters(new URLSearchParams(key)), [key]);
  useEffect(() => {
    if (own) rememberQuery(serializeFilters(parseFilters(sp)).toString());
    else if (rememberedQuery()) {
      // the remembered filters come back; other parameters of the address (the month pair) stay
      const next = new URLSearchParams(rememberedQuery());
      nonFilterParams(sp).forEach((v, k) => next.append(k, v));
      setSp(next, { replace: true });
    }
  }, [own, sp, setSp]);
  const ref = useRef(filters);
  ref.current = filters;
  const spRef = useRef(sp);
  spRef.current = sp;
  const setFilters = useCallback(
    (patch: Partial<DashFilters>) => {
      const next = serializeFilters({ ...ref.current, ...patch });
      rememberQuery(next.toString());
      nonFilterParams(spRef.current).forEach((v, k) => next.append(k, v));
      setSp(next, { replace: true });
    },
    [setSp],
  );
  const reset = useCallback(() => {
    forgetDashFilters();
    setSp(new URLSearchParams(), { replace: true });
  }, [setSp]);
  return { filters, setFilters, reset };
}

export { forgetDashFilters };

// ---------------------------------------------------------------- several years of events

export interface MultiYear {
  rows: EventRow[];
  /** every requested year has its data */
  ready: boolean;
  state: Pick<ResState<unknown>, 'loading' | 'refreshing' | 'error' | 'fromCache' | 'savedAt' | 'data' | 'accessDenied'>;
  reload: () => void;
}

const EMPTY_STATE: MultiYear['state'] = { loading: false, refreshing: false, error: null, fromCache: false, savedAt: null, data: null, accessDenied: false };

/** Loads the events of several years (cache first, then the server) and joins them. */
export function useEventsForYears(years: number[]): MultiYear {
  const { token } = useAuth();
  const yearKey = years.join(',');
  const resources = useMemo(() => (yearKey ? yearKey.split(',').map((y) => eventsResource(Number(y))) : []), [yearKey]);
  const cache = useRef<{ snaps: unknown[]; value: MultiYear } | null>(null);

  const subscribe = useCallback(
    (cb: () => void) => {
      const offs = resources.map((r) => r.subscribe(cb));
      return () => offs.forEach((o) => o());
    },
    [resources],
  );
  const reload = useCallback(() => {
    if (token) resources.forEach((r) => void r.load(token, true));
  }, [token, resources]);
  const getSnapshot = useCallback((): MultiYear => {
    const snaps = resources.map((r) => r.getSnapshot());
    const prev = cache.current;
    if (prev && prev.snaps.length === snaps.length && prev.snaps.every((s, i) => s === snaps[i])) return prev.value;
    const ready = resources.length > 0 && snaps.every((s) => s.data !== null);
    const rows = ready ? snaps.flatMap((s) => s.data!) : [];
    const firstError = snaps.find((s) => s.error)?.error ?? null;
    const state: MultiYear['state'] = resources.length === 0 ? EMPTY_STATE : {
      loading: snaps.some((s) => s.loading && !s.data),
      refreshing: snaps.some((s) => s.refreshing),
      error: firstError,
      fromCache: snaps.some((s) => s.fromCache),
      savedAt: snaps.map((s) => s.savedAt).filter((x): x is string => !!x).sort()[0] ?? null,
      data: ready ? rows : null,
      accessDenied: snaps.some((s) => s.accessDenied),
    };
    const value: MultiYear = { rows, ready, state, reload };
    cache.current = { snaps, value };
    return value;
  }, [resources, reload]);
  const value = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    if (token) resources.forEach((r) => void r.load(token));
  }, [token, resources]);
  return value;
}

// ---------------------------------------------------------------- the dashboard

export interface Dash {
  st: StartupHook;
  startup: Startup | null;
  filters: DashFilters;
  setFilters: (patch: Partial<DashFilters>) => void;
  reset: () => void;
  /** every year needed is loaded and the scope is built */
  ready: boolean;
  data: MultiYear;
  /** the ONE range the filters resolve to */
  range: DateRange | null;
  /** the last day with data: relative presets count back from it */
  asOf: string | null;
  /** all rows of the loaded years (before any filter), for option lists */
  allRows: EventRow[];
  ctx: DashCtx | null;
  years: number[];
  reload: () => void;
}

const today = (): string => formatDate(Date.now());

export function useDash(opts: { extraYearsBack?: number } = {}): Dash {
  const st = useStartup();
  const { filters, setFilters, reset } = useDashFilters();
  const startup = st.startup;
  const available = startup?.years ?? [];
  const latest = available.length ? Math.max(...available) : null;

  // step 1: the latest year gives "as of" for the relative presets
  const first = useEventsForYears(latest === null ? [] : [latest]);
  const asOf = useMemo(() => {
    if (!first.ready) return null;
    const cov = dataRangeOf(first.rows.filter((r) => !r.is_void));
    return cov ? cov.to : today();
  }, [first.ready, first.rows]);
  const settings = useMemo(() => (startup ? buildMaster(startup).settings : null), [startup]);
  const range = useMemo(() => (asOf ? resolveRange(filters, asOf) : null), [asOf, filters]);

  // step 2: every year the range, its comparison and the repeat history need
  const years = useMemo(
    () => (range && settings ? yearsNeeded(range, filters, settings, available, opts.extraYearsBack ?? 0) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [range, filters.compare, settings, available.join(','), opts.extraYearsBack],
  );
  const wanted = useMemo(() => (latest === null ? years : [...new Set([latest, ...years])].sort((a, b) => a - b)), [latest, years]);
  const data = useEventsForYears(first.ready ? wanted : []);

  const ready = !!startup && first.ready && data.ready && !!range;
  // staged so a date change does not rebuild the chains and a classification change does not rebuild the base
  const master = useMemo(() => (startup ? buildMaster(startup) : null), [startup]);
  const coverage = useMemo(() => (ready ? coverageOf(data.rows) : null), [ready, data.rows]);
  const notUploaded = useMemo(() => (ready ? notUploadedOf(data.rows, coverage) : []), [ready, data.rows, coverage]);
  const baseKey = `${filters.lineIds.join('|')}#${filters.areaIds.join('|')}`;
  const base = useMemo(
    () => (ready && startup && master ? buildBase(data.rows, startup, filters, master) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, startup, master, data.rows, baseKey],
  );
  const eventKey = serializeFilters({ ...defaultFilters(), ...filters, lineIds: [], areaIds: [], preset: 'last90', compare: null }).toString();
  const scope = useMemo(
    () => (base && master ? buildEventScope(base, filters, master) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, master, eventKey],
  );
  const winKey = `${range?.from}|${range?.to}|${filters.compare}`;
  const win = useMemo(
    () => (range && master ? buildWindows(range, coverage, filters, master.settings) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [winKey, coverage, master],
  );
  const kpis = useMemo(
    () => (scope && base && win && master ? buildKpis(scope, base, win, coverage, master, notUploaded) : null),
    [scope, base, win, coverage, master, notUploaded],
  );
  const ctx = useMemo<DashCtx | null>(
    () => (scope && base && win && master && kpis ? { master, base, scope, win, coverage, notUploaded, kpis } : null),
    [scope, base, win, master, kpis, coverage, notUploaded],
  );
  const reload = useCallback(() => {
    st.reload();
    first.reload();
    data.reload();
  }, [st, first, data]);

  return { st, startup, filters, setFilters, reset, ready, data: first.ready ? data : first, range, asOf, allRows: data.rows, ctx, years: wanted, reload };
}
