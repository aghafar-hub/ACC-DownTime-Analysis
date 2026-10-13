// Month vs month: two calendar months side by side. Pure: no React.
// It respects the OTHER dashboard filters (line, area, equipment, reason, classification, criticality, failures) and
// ignores the date range and the comparison filter. Every figure is the dashboard's own KPI for the single-month
// range, so the numbers equal what the Dashboard shows when its range is that month.
import type { EventRow, Startup } from '../api/types';
import { compareValues, avail, daysInRange, isBlocked, monthRange, unavail, type AreaKpis, type Change, type DateRange, type KpiResult, type Metric } from '../calc';
import type { DashFilters } from './filters';
import { buildCtx } from './scope';

/** URL query of the section: `mvm=YYYY-MM,YYYY-MM` (Month A, Month B). `cmp` is the comparison-mode filter, so the pair has its own name; a pair written as `cmp=YYYY-MM,YYYY-MM` is read too. */
export const MONTH_PAIR_PARAM = 'mvm';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const PAIR = /^(\d{4}-(?:0[1-9]|1[0-2])),(\d{4}-(?:0[1-9]|1[0-2]))$/;

export interface MonthPair { a: string; b: string }

/** The pair named by the query, or null. */
export function parseMonthPair(sp: URLSearchParams): MonthPair | null {
  for (const key of [MONTH_PAIR_PARAM, 'cmp']) {
    const m = PAIR.exec((sp.get(key) ?? '').trim());
    if (m) return { a: m[1]!, b: m[2]! };
  }
  return null;
}

export const monthPairText = (p: MonthPair): string => `${p.a},${p.b}`;
export const isMonthKey = (s: string): boolean => MONTH.test(s);

/** Months (YYYY-MM, oldest first) in which some record that counts (not voided, not left out of the numbers) stopped. */
export function monthsWithData(rows: readonly EventRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) if (!r.is_void && !isBlocked(r) && r.stop_ts.length >= 7) set.add(r.stop_ts.slice(0, 7));
  return [...set].sort();
}

/** The month lies wholly inside the data coverage (the data neither starts nor ends inside it). */
export function isCompleteMonth(month: string, coverage: DateRange | null): boolean {
  if (!coverage) return false;
  const r = monthRange(month);
  return coverage.from <= r.from && coverage.to >= r.to;
}

/**
 * Month A = the latest COMPLETE month with data, Month B = the complete one before it, so the default never sets a
 * month in progress against a whole month. With fewer than two complete months: the latest complete month against
 * the month with data before it, else the latest month and the one before (the same month when there is only one).
 * Without `coverage` every month counts as complete. null without data.
 */
export function defaultMonthPair(months: readonly string[], coverage?: DateRange | null): MonthPair | null {
  if (months.length === 0) return null;
  const sorted = [...months].sort();
  const complete = coverage === undefined ? sorted : sorted.filter((m) => isCompleteMonth(m, coverage));
  if (complete.length >= 2) return { a: complete[complete.length - 1]!, b: complete[complete.length - 2]! };
  const a = complete.length === 1 ? complete[0]! : sorted[sorted.length - 1]!;
  const before = sorted.filter((m) => m < a);
  return { a, b: before.length ? before[before.length - 1]! : a };
}

export type CompareId = 'stoppage' | 'failureHours' | 'planned' | 'other' | 'failureCount' | 'operating' | 'availability' | 'mttr' | 'mtbf' | 'repeated';

export interface CompareRow {
  id: CompareId;
  /** the number format of the row */
  kind: 'hours' | 'hours2' | 'count' | 'pct';
  a: Metric;
  b: Metric;
  /** A against B (A is the "current" value) with the usual better / worse rules (neutral when `perDay`) */
  change: Change;
  /** the value is a per-day rate (hours or count per day with data) */
  perDay: boolean;
  better: 'higher' | 'lower' | 'none';
}

export interface AreaPair { area_id: string; a: AreaKpis | null; b: AreaKpis | null }

export interface MonthCompareModel {
  a: string;
  b: string;
  basis: 'A' | 'B' | 'C';
  /** a month has records in scope */
  hasA: boolean;
  hasB: boolean;
  /** the month is cut short by the data (it starts or ends inside the month) */
  partialA: boolean;
  partialB: boolean;
  /**
   * Either month is partial: hours and counts are shown per day (days with data), and no change is called better or
   * worse, because a part month is not like a whole one.
   */
  perDay: boolean;
  /** days with data in each month (the divisor of the per-day rates) */
  daysA: number;
  daysB: number;
  rows: CompareRow[];
  /** areas in scope (ids in the dashboard's order), with the KPIs of each month */
  areas: AreaPair[];
}

const NO_DATA = (m: string): Metric => unavail('no_data', `No data in ${m}`);

function figures(k: KpiResult, month: string): Record<CompareId, Metric> {
  if (k.status !== 'ok') {
    // P6: a month inside the data without any record is 'Not uploaded', never 0 h
    const na = k.reason.startsWith('Not uploaded') ? unavail('not_uploaded', `Not uploaded: no records in ${month}`) : NO_DATA(month);
    return { stoppage: na, failureHours: na, planned: na, other: na, failureCount: na, operating: na, availability: na, mttr: na, mtbf: na, repeated: na };
  }
  const t = k.total;
  return {
    stoppage: avail(t.downtimeHours), failureHours: avail(t.failureHours), planned: avail(t.plannedHours), other: avail(t.otherHours),
    failureCount: avail(t.failureCount), operating: t.operatingHours, availability: t.availabilityHeadline, mttr: t.mttrHours, mtbf: t.mtbfHours,
    repeated: avail(k.repeatedFailureCount),
  };
}

const ROWS: { id: CompareId; kind: CompareRow['kind']; better: CompareRow['better'] }[] = [
  { id: 'stoppage', kind: 'hours', better: 'lower' },
  { id: 'failureHours', kind: 'hours', better: 'lower' },
  { id: 'planned', kind: 'hours', better: 'none' },
  { id: 'other', kind: 'hours', better: 'none' },
  { id: 'failureCount', kind: 'count', better: 'lower' },
  { id: 'operating', kind: 'hours', better: 'higher' },
  { id: 'availability', kind: 'pct', better: 'higher' },
  { id: 'mttr', kind: 'hours2', better: 'lower' },
  { id: 'mtbf', kind: 'hours', better: 'higher' },
  { id: 'repeated', kind: 'count', better: 'lower' },
];

/** Rows that are sums over the days (shown per day when a month is partial); the others are already rates. */
const ADDITIVE: ReadonlySet<CompareId> = new Set<CompareId>(['stoppage', 'failureHours', 'planned', 'other', 'failureCount', 'operating', 'repeated']);

/** The comparison for Month A and Month B under the dashboard's current filters. `rows` are the events of every year. */
export function monthCompareModel(rows: EventRow[], startup: Startup, filters: DashFilters, pair: MonthPair): MonthCompareModel {
  // the date range and the comparison do not apply: each month is its own range
  const base: DashFilters = { ...filters, preset: 'custom', from: '', to: '', year: null, month: null, compare: 'none' };
  const ca = buildCtx(rows, startup, base, monthRange(pair.a));
  const cb = pair.b === pair.a ? ca : buildCtx(rows, startup, base, monthRange(pair.b));
  const ka = ca.kpis.current;
  const kb = cb.kpis.current;
  const fa = figures(ka, pair.a);
  const fb = figures(kb, pair.b);
  const byId = (k: KpiResult): Map<string, AreaKpis> => new Map(k.status === 'ok' ? k.areas.map((x) => [x.area_id, x]) : []);
  const ma = byId(ka);
  const mb = byId(kb);
  const partialA = ka.status === 'ok' && ka.partial;
  const partialB = kb.status === 'ok' && kb.partial;
  const perDay = partialA || partialB;
  const daysA = ka.status === 'ok' ? daysInRange(ka.window) : 0;
  const daysB = kb.status === 'ok' ? daysInRange(kb.window) : 0;
  const rate = (m: Metric, days: number): Metric => (m.available && days > 0 ? avail(m.value / days) : m);
  return {
    a: pair.a, b: pair.b, basis: ca.master.settings.availabilityBasis,
    hasA: ka.status === 'ok', hasB: kb.status === 'ok',
    partialA, partialB, perDay, daysA, daysB,
    rows: ROWS.map((r) => {
      const additive = perDay && ADDITIVE.has(r.id);
      const a = additive ? rate(fa[r.id], daysA) : fa[r.id];
      const b = additive ? rate(fb[r.id], daysB) : fb[r.id];
      return { ...r, a, b, perDay: additive, change: compareValues(a, b, perDay ? 'none' : r.better) };
    }),
    areas: ca.base.areaIds.map((id) => ({ area_id: id, a: ma.get(id) ?? null, b: mb.get(id) ?? null })),
  };
}
