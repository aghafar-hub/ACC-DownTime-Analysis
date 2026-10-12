/** Reliability trends: monthly series, rolling counts, year-over-year, histograms, heatmaps, longest events. */
import type { ClassificationCode, EventRow } from '../api/types';
import { analysableChains, buildFailureEvents, isAnalysable, type ChainedEvent } from './events';
import { durationBandOf, type DurationBand } from './filters';
import { addRowHours, compareValues, composeKpis, dataRangeOf, emptySums, type AreaKpis, type Change, type HourSums } from './kpis';
import type { MasterIndex } from './masters';
import { avail, unavail, type Metric } from './metric';
import { CLASSIFICATION_CODES, matchKey, resolvedKey, rowCode } from './normalize';
import { chainValue, type ParetoMeasure } from './pareto';
import type { CalcSettings } from './settings';
import {
  MS_DAY, addDays, clippedHours, daysInRange, formatTs, intersectRanges, monthKey, monthRange, monthsOfRange, rangeToInterval, sameRange,
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
  const rows = input.rows.filter(isAnalysable);
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
  const chains = analysableChains(input.chains ?? buildFailureEvents(rows).chains);
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

// ---- daily series ----

export interface DayPoint {
  date: string;
  /** the day lies inside the data coverage; without data every figure is 0 and `kpis` is null */
  hasData: boolean;
  plannedHours: number;
  failureHours: number;
  otherHours: number;
  /** planned + failure + other (area-hours; blocked and voided rows are not counted) */
  downtimeHours: number;
  failureCount: number;
  /** the day's KPIs (scheduled time of the day x areas); null without data */
  kpis: AreaKpis | null;
  /** trailing mean of `downtimeHours` over the last `rollingDays` days of the range that have data (fewer at the start of the range) */
  rollingDowntimeHours: number | null;
}

export interface DailyInput extends MonthlyInput {
  /** length of the trailing mean; default 7 */
  rollingDays?: number;
}

/** Trailing mean of the last `n` values (fewer at the start); null entries are skipped and a window with no values stays null. */
export function rollingMean(values: (number | null)[], n: number): (number | null)[] {
  const k = Math.max(1, Math.floor(n));
  return values.map((v, i) => {
    if (v === null) return null;
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - k + 1); j <= i; j++) {
      const x = values[j];
      if (x !== null && x !== undefined) { sum += x; cnt++; }
    }
    return cnt > 0 ? sum / cnt : null;
  });
}

/**
 * One point per calendar day of the range, aggregated over the areas (area-hours). Days without any event are 0
 * (not missing) as long as the data covers them. Hours are split at midnight; failures count on the day they start.
 * Summed over the range the hours equal the monthly series and computeKpis for the same window.
 */
export function dailySeries(input: DailyInput): DayPoint[] {
  const rows = input.rows.filter(isAnalysable);
  const dataRange = input.dataRange === undefined ? dataRangeOf(rows) : input.dataRange;
  const areaIds = input.areaIds ?? [...new Set(rows.map((r) => r.area_id))].sort();
  const areaSet = new Set(areaIds);
  const n = daysInRange(input.range);
  const firstMs = rangeToInterval({ from: input.range.from, to: input.range.from }).fromMs;
  const dates = Array.from({ length: n }, (_, i) => addDays(input.range.from, i));
  const covered = dates.map((d) => !!dataRange && d >= dataRange.from && d <= dataRange.to);
  const sums = dates.map(() => emptySums());
  const dayIndex = (ms: number): number => Math.floor((ms - firstMs) / MS_DAY);
  for (const r of rows) {
    const span = areaSet.has(r.area_id) ? rowSpan(r) : null;
    if (!span) continue;
    const lo = Math.max(0, dayIndex(span.fromMs));
    const hi = Math.min(n - 1, dayIndex(span.toMs - 1));
    for (let i = lo; i <= hi; i++) {
      if (!covered[i]) continue;
      const h = clippedHours(span, { fromMs: firstMs + i * MS_DAY, toMs: firstMs + (i + 1) * MS_DAY });
      if (h > 0) addRowHours(sums[i]!, r, h);
    }
    const si = dayIndex(span.fromMs);
    if (r.is_failure && si >= 0 && si < n && covered[si]) sums[si]!.failures++;
  }
  for (const c of analysableChains(input.chains ?? buildFailureEvents(rows).chains)) {
    if (!c.isFailure || !areaSet.has(c.area_id)) continue;
    const si = dayIndex(c.startMs);
    if (si >= 0 && si < n && covered[si]) {
      sums[si]!.events++;
      sums[si]!.eventSeconds += c.durationS;
    }
  }
  const points = dates.map((date, i): Omit<DayPoint, 'rollingDowntimeHours'> => {
    const s = sums[i]!;
    if (!covered[i]) {
      return { date, hasData: false, plannedHours: 0, failureHours: 0, otherHours: 0, downtimeHours: 0, failureCount: 0, kpis: null };
    }
    const kpis = composeKpis('ALL', scheduledHours({ from: date, to: date }, input.settings) * areaIds.length, s, input.settings);
    return { date, hasData: true, plannedHours: s.pl, failureHours: s.inc, otherHours: s.cir, downtimeHours: s.pl + s.inc + s.cir, failureCount: s.failures, kpis };
  });
  const rolling = rollingMean(points.map((p) => (p.hasData ? p.downtimeHours : null)), input.rollingDays ?? 7);
  return points.map((p, i) => ({ ...p, rollingDowntimeHours: rolling[i] ?? null }));
}

// ---- monthly hours by classification ----

export interface ClassMonthPoint {
  month: string;
  hasData: boolean;
  partial: boolean;
  window: DateRange | null;
  /** stopped hours per classification (area-hours) */
  hours: Record<ClassificationCode, number>;
  total: number;
}

/** Stopped hours per month and classification code (PRO, MEC, ELE, AUT, PL, CIR). Months sum to the monthly series' planned + failure + other hours. */
export function monthlyHoursByClassification(input: Omit<MonthlyInput, 'chains' | 'settings'>): ClassMonthPoint[] {
  const rows = input.rows.filter(isAnalysable);
  const dataRange = input.dataRange === undefined ? dataRangeOf(rows) : input.dataRange;
  const areaSet = new Set(input.areaIds ?? rows.map((r) => r.area_id));
  const zero = (): Record<ClassificationCode, number> => Object.fromEntries(CLASSIFICATION_CODES.map((c) => [c, 0])) as Record<ClassificationCode, number>;
  const slots = monthsOfRange(input.range).map((month) => {
    const requested = intersectRanges(monthRange(month), input.range) ?? monthRange(month);
    const window = dataRange ? intersectRanges(requested, dataRange) : null;
    return { month, requested, window, interval: window ? rangeToInterval(window) : null, hours: zero() };
  });
  const first = monthNumber(slots[0]?.month ?? '1970-01');
  const last = slots.length - 1;
  for (const r of rows) {
    const span = areaSet.has(r.area_id) ? rowSpan(r) : null;
    if (!span || !CLASSIFICATION_CODES.includes(r.classification)) continue;
    const lo = Math.max(0, monthNumber(r.stop_ts) - first);
    const hi = Math.min(last, monthNumber(r.start_ts) - first);
    for (let i = lo; i <= hi; i++) {
      const s = slots[i]!;
      if (!s.interval) continue;
      const h = clippedHours(span, s.interval);
      if (h > 0) s.hours[r.classification] += h;
    }
  }
  return slots.map((s) => ({
    month: s.month, hasData: !!s.window, partial: !!s.window && !sameRange(s.window, s.requested), window: s.window,
    hours: s.hours, total: CLASSIFICATION_CODES.reduce((sum, c) => sum + s.hours[c], 0),
  }));
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
  for (const c of analysableChains(failureEvents)) {
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
  for (const c of analysableChains(failureEvents)) {
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
export function buildHeatmap(cells: HeatCell[], opts: { maxRows?: number; maxCols?: number; fixedCols?: HeatmapAxis[]; fixedRows?: HeatmapAxis[] } = {}): Heatmap {
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
  const rows = opts.fixedRows
    ? opts.fixedRows.map((r) => ({ ...r, total: rowT.get(r.key)?.total ?? 0 }))
    : opts.maxRows === undefined ? allRows : allRows.slice(0, opts.maxRows);
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
  return { rows, cols, values, total, omittedRows: opts.fixedRows ? 0 : allRows.length - rows.length, omittedCols: allColCount - cols.length };
}

export interface HeatmapOptions { measure: ParetoMeasure; maxRows?: number; maxCols?: number }

/**
 * Equipment x month. Hours are split across months at the month boundary (an event over a month end shows in
 * both); counts go to the month where the event starts. Cause = head row's code; failure events only.
 */
export function equipmentMonthHeatmap(failureEvents: ChainedEvent[], index: MasterIndex | undefined, range: DateRange, o: HeatmapOptions): Heatmap {
  return causeMonthHeatmap(failureEvents, range, o, (c) => {
    const code = resolvedKey(rowCode(c.head, index));
    return { key: code, label: code };
  });
}

/** Month cells of one event: hours split at month boundaries (clipped to the window), a count in the month the event starts. */
function monthCells(c: ChainedEvent, row: { key: string; label: string }, w: Interval, measure: ParetoMeasure): HeatCell[] {
  if (measure === 'count') {
    return c.startMs >= w.fromMs && c.startMs < w.toMs ? [{ row: row.key, rowLabel: row.label, col: monthKey(c.startDate), colLabel: monthKey(c.startDate), value: 1 }] : [];
  }
  const cells: HeatCell[] = [];
  for (const r of c.rows) {
    const span = rowSpan(r);
    const clipped = span && { fromMs: Math.max(span.fromMs, w.fromMs), toMs: Math.min(span.toMs, w.toMs) };
    if (!clipped || clipped.toMs <= clipped.fromMs) continue;
    for (const p of splitByMonth(clipped)) cells.push({ row: row.key, rowLabel: row.label, col: p.month, colLabel: p.month, value: (p.toMs - p.fromMs) / 3_600_000 });
  }
  return cells;
}

function causeMonthHeatmap(failureEvents: ChainedEvent[], range: DateRange, o: HeatmapOptions, rowOf: (c: ChainedEvent) => { key: string; label: string }): Heatmap {
  const w = rangeToInterval(range);
  const months = monthsOfRange(range);
  const cells: HeatCell[] = [];
  for (const c of analysableChains(failureEvents)) if (c.isFailure) cells.push(...monthCells(c, rowOf(c), w, o.measure));
  return buildHeatmap(cells, { maxRows: o.maxRows, fixedCols: months.map((m) => ({ key: m, label: m, total: 0 })) });
}

/** Reason x month (reason by match key of the head row; blank reasons are one row). Same rules as equipmentMonthHeatmap. */
export function reasonMonthHeatmap(failureEvents: ChainedEvent[], range: DateRange, o: HeatmapOptions): Heatmap {
  return causeMonthHeatmap(failureEvents, range, o, (c) => ({
    key: matchKey(c.head.reason_raw), label: (c.head.reason_raw ?? '').trim().replace(/\s+/g, ' ') || '(blank)',
  }));
}

// ---- when failures start ----

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * Hour of day (rows 00:00 to 23:00, all 24 always present) x weekday (columns Monday to Sunday) of the START of
 * failure events chained as failures and started inside the window. Plant-local time, read as written (no time
 * zone conversion). Count: 1 per event. Hours: the whole event's duration, counted where it starts.
 */
export function failureStartHeatmap(failureEvents: ChainedEvent[], window: DateRange, o: { measure: ParetoMeasure }): Heatmap {
  const w = rangeToInterval(window);
  const cells: HeatCell[] = [];
  for (const c of analysableChains(failureEvents)) {
    if (!c.isFailure || c.startMs < w.fromMs || c.startMs >= w.toMs) continue;
    const d = new Date(c.startMs);
    const hour = d.getUTCHours();
    const wd = (d.getUTCDay() + 6) % 7;
    cells.push({
      row: String(hour).padStart(2, '0'), rowLabel: `${String(hour).padStart(2, '0')}:00`, col: String(wd), colLabel: WEEKDAYS[wd]!,
      value: o.measure === 'count' ? 1 : c.durationS / 3600,
    });
  }
  return buildHeatmap(cells, {
    fixedRows: Array.from({ length: 24 }, (_, h) => ({ key: String(h).padStart(2, '0'), label: `${String(h).padStart(2, '0')}:00`, total: 0 })),
    fixedCols: WEEKDAYS.map((l, i) => ({ key: String(i), label: l, total: 0 })),
  });
}

/** Equipment x reason (reason by match key). */
export function equipmentReasonHeatmap(failureEvents: ChainedEvent[], index: MasterIndex | undefined, window: DateRange | undefined, o: HeatmapOptions): Heatmap {
  const w = window ? rangeToInterval(window) : null;
  const cells: HeatCell[] = [];
  for (const c of analysableChains(failureEvents)) {
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
  return analysableChains(chains)
    .filter((c) => (o.failureOnly === false || c.isFailure) && (!w || (c.startMs >= w.fromMs && c.startMs < w.toMs)))
    .sort((a, b) => b.durationS - a.durationS || a.startMs - b.startMs || (a.id < b.id ? -1 : 1))
    .slice(0, n)
    .map((c) => ({
      eventId: c.id, area_id: c.area_id, code: c.head.code_raw, reason: (c.head.reason_raw ?? '').trim(),
      startTs: formatTs(c.startMs), hours: c.durationS / 3600, rowCount: c.rows.length, classification: c.head.classification,
    }));
}
