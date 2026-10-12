/** Reliability trends: monthly series, rolling counts, year-over-year, histograms, heatmaps, longest events. */
import type { EventRow } from '../api/types';
import { buildFailureEvents, type ChainedEvent } from './events';
import { durationBandOf, type DurationBand } from './filters';
import { addRowHours, compareValues, composeKpis, dataRangeOf, emptySums, type AreaKpis, type Change, type HourSums } from './kpis';
import type { MasterIndex } from './masters';
import { avail, unavail, type Metric } from './metric';
import { matchKey, resolvedKey, rowCode } from './normalize';
import { chainValue, type ParetoMeasure } from './pareto';
import type { CalcSettings } from './settings';
import {
  addDays, clippedHours, daysInRange, formatTs, intersectRanges, monthKey, monthRange, monthsOfRange, rangeToInterval, sameRange,
  scheduledHours, splitByMonth, type DateRange, type Interval,
} from './time';
import { rowSpan } from './events';

// ---- monthly series ----

export interface MonthPoint {
  month: string;
  /** requested days of the month (the range may start or end mid-month) */
  requested: DateRange;
  /** days with data; shorter than `requested` for a month still in progress */
  window: DateRange | null;
  hasData: boolean;
  /** the month is only partly covered by data: compare with an elapsed-equivalent period, not a full month */
  partial: boolean;
  plannedHours: number;
  failureHours: number;
  otherHours: number;
  failureCount: number;
  operatingHours: Metric;
  mtbfHours: Metric;
  mttrHours: Metric;
  failureRatePer1000h: Metric;
  availability: Metric;
  kpis: AreaKpis | null;
}

export interface MonthlyInput {
  rows: EventRow[];
  chains?: ChainedEvent[];
  range: DateRange;
  dataRange?: DateRange | null;
  areaIds?: string[];
  settings: CalcSettings;
}

const NO_DATA = (): Metric => unavail('no_data', 'No data for this month');

function noDataPoint(month: string, requested: DateRange): MonthPoint {
  return {
    month, requested, window: null, hasData: false, partial: false, plannedHours: 0, failureHours: 0, otherHours: 0, failureCount: 0,
    operatingHours: NO_DATA(), mtbfHours: NO_DATA(), mttrHours: NO_DATA(), failureRatePer1000h: NO_DATA(), availability: NO_DATA(), kpis: null,
  };
}

function monthNumber(key: string): number {
  return Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7));
}

interface MonthSlot { month: string; requested: DateRange; window: DateRange | null; interval: Interval | null; sums: HourSums }

/**
 * One point per calendar month of the range, aggregated over the areas (area-hours). Single pass over the rows;
 * each month equals computeKpis for that month's window (clipped to the data range).
 */
export function monthlySeries(input: MonthlyInput): MonthPoint[] {
  const rows = input.rows.filter((r) => !r.is_void);
  const dataRange = input.dataRange === undefined ? dataRangeOf(rows) : input.dataRange;
  const areaIds = input.areaIds ?? [...new Set(rows.map((r) => r.area_id))].sort();
  const areaSet = new Set(areaIds);
  const slots: MonthSlot[] = monthsOfRange(input.range).map((month) => {
    const requested = intersectRanges(monthRange(month), input.range) ?? monthRange(month);
    const window = dataRange ? intersectRanges(requested, dataRange) : null;
    return { month, requested, window, interval: window ? rangeToInterval(window) : null, sums: emptySums() };
  });
  const first = monthNumber(slots[0]?.month ?? '1970-01');
  const last = slots.length - 1;
  for (const r of rows) {
    const span = areaSet.has(r.area_id) ? rowSpan(r) : null;
    if (!span) continue;
    const lo = Math.max(0, monthNumber(r.stop_ts) - first);
    const hi = Math.min(last, monthNumber(r.start_ts) - first);
    for (let i = lo; i <= hi; i++) {
      const s = slots[i]!;
      if (!s.interval) continue;
      const h = clippedHours(span, s.interval);
      if (h > 0) addRowHours(s.sums, r, h);
    }
    const si = monthNumber(r.stop_ts) - first;
    const slot = si >= 0 && si <= last ? slots[si]! : null;
    if (r.is_failure && slot?.interval && span.fromMs >= slot.interval.fromMs && span.fromMs < slot.interval.toMs) slot.sums.failures++;
  }
  const chains = input.chains ?? buildFailureEvents(rows).chains;
  for (const c of chains) {
    if (!c.isFailure || !areaSet.has(c.area_id)) continue;
    const si = monthNumber(c.startDate) - first;
    const slot = si >= 0 && si <= last ? slots[si]! : null;
    if (slot?.interval && c.startMs >= slot.interval.fromMs && c.startMs < slot.interval.toMs) {
      slot.sums.events++;
      slot.sums.eventSeconds += c.durationS;
    }
  }
  return slots.map((s) => {
    if (!s.window) return noDataPoint(s.month, s.requested);
    const t = composeKpis('ALL', scheduledHours(s.window, input.settings) * areaIds.length, s.sums, input.settings);
    return {
      month: s.month, requested: s.requested, window: s.window, hasData: true, partial: !sameRange(s.window, s.requested),
      plannedHours: t.plannedHours, failureHours: t.failureHours, otherHours: t.otherHours, failureCount: t.failureCount,
      operatingHours: t.operatingHours, mtbfHours: t.mtbfHours, mttrHours: t.mttrHours, failureRatePer1000h: t.failureRatePer1000h,
      availability: t.availabilityHeadline, kpis: t,
    };
  });
}

// ---- rolling counts ----

export interface RollingPoint { date: string; count: number }

/** For each day of the range, failure events that started in the trailing `windowDays` days (the day included). */
export function rollingFailureCounts(failureEvents: ChainedEvent[], range: DateRange, windowDays: number): RollingPoint[] {
  const n = daysInRange(range);
  const lead = Math.max(0, windowDays - 1);
  const first = addDays(range.from, -lead);
  const perDay = new Array<number>(n + lead).fill(0);
  const firstMs = rangeToInterval({ from: first, to: first }).fromMs;
  for (const c of failureEvents) {
    if (!c.isFailure) continue;
    const idx = Math.floor((c.startMs - firstMs) / 86_400_000);
    if (idx >= 0 && idx < perDay.length) perDay[idx]!++;
  }
  const out: RollingPoint[] = [];
  let sum = 0;
  for (let i = 0; i < perDay.length; i++) {
    sum += perDay[i]!;
    if (i >= windowDays) sum -= perDay[i - windowDays]!;
    if (i >= lead) out.push({ date: addDays(range.from, i - lead), count: sum });
  }
  return out;
}

// ---- year over year ----

export interface YoyMonth {
  /** 1..12 */
  monthNumber: number;
  current: MonthPoint;
  previous: MonthPoint;
  failureHours: Change;
  failureCount: Change;
  mtbfHours: Change;
  failureRatePer1000h: Change;
}

export interface YoyInput extends Omit<MonthlyInput, 'range'> { year: number }

/** Month-by-month comparison of `year` against `year - 1`. */
export function yearOverYear(input: YoyInput): YoyMonth[] {
  const chains = input.chains ?? buildFailureEvents(input.rows).chains;
  const mk = (y: number): MonthPoint[] => monthlySeries({ ...input, chains, range: { from: `${y}-01-01`, to: `${y}-12-31` } });
  const cur = mk(input.year);
  const prev = mk(input.year - 1);
  return cur.map((c, i) => {
    const p = prev[i]!;
    const both = c.hasData && p.hasData;
    const none = (): Change => ({ available: false, reason: 'No data for one of the months' });
    return {
      monthNumber: i + 1, current: c, previous: p,
      failureHours: both ? compareValues(avail(c.failureHours), avail(p.failureHours), 'lower') : none(),
      failureCount: both ? compareValues(avail(c.failureCount), avail(p.failureCount), 'lower') : none(),
      mtbfHours: compareValues(c.mtbfHours, p.mtbfHours, 'higher'),
      failureRatePer1000h: compareValues(c.failureRatePer1000h, p.failureRatePer1000h, 'lower'),
    };
  });
}

// ---- duration distribution ----

export interface HistogramBin { fromMin: number; toMin: number | null; label: string; count: number; hours: number }
export interface BandSummary { band: DurationBand; count: number; hours: number; countPct: number; hoursPct: number }
export interface DurationHistogram { bins: HistogramBin[]; bands: BandSummary[]; eventCount: number }

export const DEFAULT_BIN_EDGES_MIN = [0, 10, 30, 60, 120, 240, 480, 1440];

function binLabel(from: number, to: number | null): string {
  const f = (m: number): string => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`);
  return to === null ? `${f(from)}+` : `${f(from)} - ${f(to)}`;
}

/** Distribution of failure event durations (whole chains) with short / medium / long bands from the settings. */
export function durationHistogram(
  failureEvents: ChainedEvent[], settings: Pick<CalcSettings, 'durationShortMaxMin' | 'durationLongMinMin'>,
  window?: DateRange, edgesMin: number[] = DEFAULT_BIN_EDGES_MIN,
): DurationHistogram {
  const w = window ? rangeToInterval(window) : null;
  const bins: HistogramBin[] = edgesMin.map((e, i) => {
    const to = i + 1 < edgesMin.length ? edgesMin[i + 1]! : null;
    return { fromMin: e, toMin: to, label: binLabel(e, to), count: 0, hours: 0 };
  });
  const bandAcc: Record<DurationBand, { count: number; hours: number }> = { short: { count: 0, hours: 0 }, medium: { count: 0, hours: 0 }, long: { count: 0, hours: 0 } };
  let n = 0;
  let totalHours = 0;
  for (const c of failureEvents) {
    if (!c.isFailure || (w && chainValue(c, 'count', w) === 0)) continue;
    const min = c.durationS / 60;
    let bi = bins.length - 1;
    while (bi > 0 && min < bins[bi]!.fromMin) bi--;
    const h = c.durationS / 3600;
    bins[bi]!.count++;
    bins[bi]!.hours += h;
    const band = bandAcc[durationBandOf(c.durationS, settings)];
    band.count++;
    band.hours += h;
    n++;
    totalHours += h;
  }
  const bands = (['short', 'medium', 'long'] as DurationBand[]).map((band) => ({
    band, count: bandAcc[band].count, hours: bandAcc[band].hours,
    countPct: n > 0 ? (bandAcc[band].count / n) * 100 : 0, hoursPct: totalHours > 0 ? (bandAcc[band].hours / totalHours) * 100 : 0,
  }));
  return { bins, bands, eventCount: n };
}

// ---- heatmaps ----

export interface HeatmapAxis { key: string; label: string; total: number }
export interface Heatmap {
  rows: HeatmapAxis[];
  cols: HeatmapAxis[];
  /** values[r][c] */
  values: number[][];
  /** sum of every cell, including rows and columns cut by the limits */
  total: number;
  omittedRows: number;
  omittedCols: number;
}

export interface HeatCell { row: string; rowLabel: string; col: string; colLabel: string; value: number }

/** Rows (and optionally columns) are ordered by total, descending; limits keep the largest. Ties by label. */
export function buildHeatmap(cells: HeatCell[], opts: { maxRows?: number; maxCols?: number; fixedCols?: HeatmapAxis[] } = {}): Heatmap {
  const rowT = new Map<string, HeatmapAxis>();
  const colT = new Map<string, HeatmapAxis>();
  let total = 0;
  for (const c of cells) {
    if (!(c.value > 0)) continue;
    total += c.value;
    const r = rowT.get(c.row) ?? { key: c.row, label: c.rowLabel, total: 0 };
    r.total += c.value;
    rowT.set(c.row, r);
    const k = colT.get(c.col) ?? { key: c.col, label: c.colLabel, total: 0 };
    k.total += c.value;
    colT.set(c.col, k);
  }
  const order = (a: HeatmapAxis, b: HeatmapAxis): number => b.total - a.total || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  const allRows = [...rowT.values()].sort(order);
  const rows = opts.maxRows === undefined ? allRows : allRows.slice(0, opts.maxRows);
  let cols: HeatmapAxis[];
  let allColCount: number;
  if (opts.fixedCols) {
    cols = opts.fixedCols.map((c) => ({ ...c, total: colT.get(c.key)?.total ?? 0 }));
    allColCount = cols.length;
  } else {
    const allCols = [...colT.values()].sort(order);
    allColCount = allCols.length;
    cols = opts.maxCols === undefined ? allCols : allCols.slice(0, opts.maxCols);
  }
  const ri = new Map(rows.map((r, i) => [r.key, i]));
  const ci = new Map(cols.map((c, i) => [c.key, i]));
  const values = rows.map(() => cols.map(() => 0));
  for (const c of cells) {
    const r = ri.get(c.row);
    const k = ci.get(c.col);
    if (r !== undefined && k !== undefined && c.value > 0) values[r]![k]! += c.value;
  }
  return { rows, cols, values, total, omittedRows: allRows.length - rows.length, omittedCols: allColCount - cols.length };
}

export interface HeatmapOptions { measure: ParetoMeasure; maxRows?: number; maxCols?: number }

/**
 * Equipment x month. Hours are split across months at the month boundary (an event over a month end shows in
 * both); counts go to the month where the event starts. Cause = head row's code; failure events only.
 */
export function equipmentMonthHeatmap(failureEvents: ChainedEvent[], index: MasterIndex | undefined, range: DateRange, o: HeatmapOptions): Heatmap {
  const w = rangeToInterval(range);
  const months = monthsOfRange(range);
  const cells: HeatCell[] = [];
  for (const c of failureEvents) {
    if (!c.isFailure) continue;
    const code = resolvedKey(rowCode(c.head, index));
    if (o.measure === 'count') {
      if (c.startMs >= w.fromMs && c.startMs < w.toMs) cells.push({ row: code, rowLabel: code, col: monthKey(c.startDate), colLabel: monthKey(c.startDate), value: 1 });
      continue;
    }
    for (const r of c.rows) {
      const span = rowSpan(r);
      const clipped = span && { fromMs: Math.max(span.fromMs, w.fromMs), toMs: Math.min(span.toMs, w.toMs) };
      if (!clipped || clipped.toMs <= clipped.fromMs) continue;
      for (const p of splitByMonth(clipped)) cells.push({ row: code, rowLabel: code, col: p.month, colLabel: p.month, value: (p.toMs - p.fromMs) / 3_600_000 });
    }
  }
  return buildHeatmap(cells, { maxRows: o.maxRows, fixedCols: months.map((m) => ({ key: m, label: m, total: 0 })) });
}

/** Equipment x reason (reason by match key). */
export function equipmentReasonHeatmap(failureEvents: ChainedEvent[], index: MasterIndex | undefined, window: DateRange | undefined, o: HeatmapOptions): Heatmap {
  const w = window ? rangeToInterval(window) : null;
  const cells: HeatCell[] = [];
  for (const c of failureEvents) {
    if (!c.isFailure) continue;
    const code = resolvedKey(rowCode(c.head, index));
    const rk = matchKey(c.head.reason_raw);
    cells.push({
      row: code, rowLabel: code, col: rk, colLabel: (c.head.reason_raw ?? '').trim().replace(/\s+/g, ' ') || '(blank)',
      value: chainValue(c, o.measure, w),
    });
  }
  return buildHeatmap(cells, { maxRows: o.maxRows, maxCols: o.maxCols });
}

// ---- longest events ----

export interface LongEvent {
  eventId: string;
  area_id: string;
  code: string;
  reason: string;
  startTs: string;
  hours: number;
  rowCount: number;
  classification: string;
}

/** The longest events, ranked by chained event duration (not by row). */
export function longestEvents(chains: ChainedEvent[], n: number, o: { failureOnly?: boolean; window?: DateRange } = {}): LongEvent[] {
  const w = o.window ? rangeToInterval(o.window) : null;
  return chains
    .filter((c) => (o.failureOnly === false || c.isFailure) && (!w || (c.startMs >= w.fromMs && c.startMs < w.toMs)))
    .sort((a, b) => b.durationS - a.durationS || a.startMs - b.startMs || (a.id < b.id ? -1 : 1))
    .slice(0, n)
    .map((c) => ({
      eventId: c.id, area_id: c.area_id, code: c.head.code_raw, reason: (c.head.reason_raw ?? '').trim(),
      startTs: formatTs(c.startMs), hours: c.durationS / 3600, rowCount: c.rows.length, classification: c.head.classification,
    }));
}
