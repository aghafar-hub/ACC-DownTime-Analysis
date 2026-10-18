/** Area-hour KPIs, availability bases A/B/C, reliability figures and comparison (docs section 8). */
import type { EventRow } from '../api/types';
import { attributedHours, attributeRows, type Attribution } from './attribution';
import { analysableChains, buildFailureEvents, isAnalysable, type ChainedEvent } from './events';
import type { MasterIndex } from './masters';
import { avail, ratio, unavail, type Metric } from './metric';
import { equipmentPareto } from './pareto';
import { findRepeatedFailures } from './repeats';
import type { CalcSettings, ComparisonKind } from './settings';
import {
  comparisonRange, daysInRange, dateOf, formatDate, intersectRanges, lastDayOfMonth, monthRange, monthsBetween, parseTs, rangeToInterval, sameRange,
  scheduledHours, type DateRange,
} from './time';

export interface AvailabilitySet { A: Metric; B: Metric; C: Metric }

export interface AreaKpis {
  /** area id, or 'ALL' for the area-hours aggregate */
  area_id: string;
  /** scheduled time T in the effective window, months not uploaded left out (summed over areas for the aggregate: area-hours) */
  scheduledHours: number;
  plannedHours: number;
  /** INC hours: time owned by rows that are not PL or CIR, continuations included (overlaps: PL > INC > CIR) */
  failureHours: number;
  /** CIR hours */
  otherHours: number;
  /** the union of the stops of each area (overlapping stops of one area counted once), summed over areas */
  downtimeHours: number;
  /** T - (PL + INC + CIR); unavailable when there is no scheduled time */
  operatingHours: Metric;
  /** failure EVENTS that started in the window (P2: chains whose head is Freq = 1, Failure = YES, not PL or CIR) */
  failureCount: number;
  /** the same failure events: the MTTR cohort (kept as its own name for the screens that show both) */
  failureEventCount: number;
  availability: AvailabilitySet;
  /** availability on the basis chosen in settings */
  availabilityHeadline: Metric;
  mtbfHours: Metric;
  failureRatePer1000h: Metric;
  mttrHours: Metric;
  /** reliability factor RF = running ÷ (running + INC), 0..1: the share of the time it was meant to run that it was not
   * lost to its own failures (PL and CIR left out; the same arithmetic as availability basis C) */
  reliabilityFactor: Metric;
  /** utilization factor UF = running ÷ scheduled (calendar) time, 0..1 (every stop counts; the same arithmetic as basis A) */
  utilizationFactor: Metric;
}

export type TopArea = Metric & { areaId?: string; sharePct?: number };
export type TopEquipment = Metric & { code?: string; sharePct?: number; count?: number };

export interface KpiOk {
  status: 'ok';
  requestedWindow: DateRange;
  /** requested window clipped to the data range */
  window: DateRange;
  /** true when the window was shortened to the data range, or is a month to date that ends with the data (the current month is not over) */
  partial: boolean;
  areas: AreaKpis[];
  total: AreaKpis;
  topArea: TopArea;
  topEquipmentByHours: TopEquipment;
  mostFrequentEquipment: TopEquipment;
  repeatGroups: number;
  /** recurrence events (occurrences after the first) in the window */
  repeatedFailureCount: number;
  orphanCount: number;
  /** months inside the window with no record at all in the loaded data (plant-wide): left out of T, shown as 'Not uploaded' */
  notUploaded: string[];
  /** days of the window with data (the window minus the days of months not uploaded): the divisor of per-day rates */
  coveredDays: number;
}
export interface KpiNoData { status: 'no_data'; requestedWindow: DateRange; reason: string }
export type KpiResult = KpiOk | KpiNoData;

export interface KpiInput {
  /** all rows of the scope (after area/line filters, before date filters); voided rows are ignored */
  rows: EventRow[];
  /** pre-built chains of `rows` (optional, saves rebuilding) */
  chains?: ChainedEvent[];
  window: DateRange;
  /** dates for which data exists. Default: first stop date to last restart date of `rows`. */
  dataRange?: DateRange | null;
  /** areas included in the aggregate and T. Default: areas present in `rows`. */
  areaIds?: string[];
  settings: CalcSettings;
  /** enables the equipment contributors (own-stop rule) */
  index?: MasterIndex;
  /** who owns overlapping time (attribution.ts); default: attributeRows over the analysable `rows` */
  attribution?: Attribution;
  /**
   * Months (YYYY-MM) with no record at all in the loaded data, plant-wide (notUploadedMonths). Default: worked out from
   * `rows` when `dataRange` is not given either; with a given `dataRange` and no list, every month counts as uploaded.
   */
  notUploaded?: readonly string[];
}

/** Hours by class plus the failure events that started in the window (`events`, `eventSeconds`: the MTTR cohort). */
export interface HourSums { pl: number; inc: number; cir: number; events: number; eventSeconds: number }

const NO_FAIL = 'No failures recorded in the window';
const NO_TIME = 'No scheduled time in the window';

/**
 * The last day a row covers: the date of its restart minus 1 ms (a restart at exactly 00:00:00.000 ends on the day
 * before, so it does not add an empty day to the coverage), never before its stop date.
 */
export function lastDayOf(r: Pick<EventRow, 'stop_ts' | 'start_ts'>): string {
  const a = dateOf(r.stop_ts);
  const ms = parseTs(r.start_ts);
  const b = ms === null ? dateOf(r.start_ts) : formatDate(ms - 1);
  return b > a ? b : a;
}

/**
 * Months inside the data coverage (first stop to last restart of the non-void rows, or `range`) in which NO record at all
 * starts or runs (voided rows do not count; rows with a data problem do: the month was uploaded). P6: such months are
 * 'Not uploaded', never 0 h or 100 %. Pass the loaded rows of every area (plant-wide), not a filtered scope.
 */
export function notUploadedMonths(rows: readonly EventRow[], range?: DateRange | null): string[] {
  let cov = range;
  if (cov === undefined) {
    // first stop to the last day a restart covers, over the non-void rows (string compare; lastDayOf only for the extremes)
    let lo = '';
    let hiStop = '';
    let hiStart: EventRow | null = null;
    for (const r of rows) {
      if (r.is_void || !r.stop_ts) continue;
      if (lo === '' || r.stop_ts < lo) lo = r.stop_ts;
      if (r.stop_ts > hiStop) hiStop = r.stop_ts;
      if (!hiStart || r.start_ts > hiStart.start_ts) hiStart = r;
    }
    if (lo === '') return [];
    const end = hiStart ? lastDayOf(hiStart) : '';
    cov = { from: dateOf(lo), to: end > dateOf(hiStop) ? end : dateOf(hiStop) };
  }
  if (!cov) return [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.is_void) continue;
    const a = (r.stop_ts ?? '').slice(0, 7);
    const b = (r.start_ts ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(a)) continue;
    seen.add(a);
    if (b > a) {
      const last = lastDayOf(r).slice(0, 7);
      for (const m of monthsBetween(a, last)) seen.add(m);
    }
  }
  return monthsBetween(cov.from.slice(0, 7), cov.to.slice(0, 7)).filter((m) => !seen.has(m));
}

/** The not-uploaded list to use: the one given; else from the rows when the data range is defaulted too; else none. */
export function resolveNotUploaded(rows: readonly EventRow[], dataRange: DateRange | null | undefined, given: readonly string[] | undefined): string[] {
  if (given) return [...given];
  return dataRange === undefined ? notUploadedMonths(rows) : [];
}

/** Days of the window that lie in a not-uploaded month. */
export function notUploadedDays(window: DateRange, notUploaded: readonly string[]): { days: number; months: string[]; ranges: DateRange[] } {
  let days = 0;
  const months: string[] = [];
  const ranges: DateRange[] = [];
  for (const m of notUploaded) {
    const r = intersectRanges(monthRange(m), window);
    if (!r) continue;
    days += daysInRange(r);
    months.push(m);
    ranges.push(r);
  }
  return { days, months, ranges };
}

/** Scheduled hours of the window (one area) without the not-uploaded months. */
export function scheduledHoursUploaded(window: DateRange, settings: Pick<CalcSettings, 'scheduledHoursPerDay' | 'scheduledDaysPerWeek'>, notUploaded: readonly string[]): number {
  let t = scheduledHours(window, settings);
  for (const r of notUploadedDays(window, notUploaded).ranges) t -= scheduledHours(r, settings);
  return Math.max(0, t);
}

/** First stop date to the last day a restart covers (see lastDayOf). */
export function dataRangeOf(rows: EventRow[]): DateRange | null {
  let lo = '';
  let hi = '';
  for (const r of rows) {
    if (!isAnalysable(r)) continue;
    const a = dateOf(r.stop_ts);
    const b = lastDayOf(r);
    if (lo === '' || a < lo) lo = a;
    if (b > hi) hi = b;
  }
  return lo === '' ? null : { from: lo, to: hi };
}

export function emptySums(): HourSums {
  return { pl: 0, inc: 0, cir: 0, events: 0, eventSeconds: 0 };
}

const clamp01 = (m: Metric): Metric => (m.available ? avail(Math.min(1, Math.max(0, m.value))) : m);

/**
 * Compose the KPI metrics from summed hours; used for each area and for the aggregate.
 * A = (T - downtime) / T;  B = (T - PL - (INC + CIR)) / (T - PL);  C = (T - PL - CIR - INC) / (T - PL - CIR).
 * MTBF = operating hours / failure EVENTS (unavailable with zero failures or no exposure, never Infinity or 0). For the
 * aggregate both are summed over the areas: 'MTBF · all areas (area-hours)'.
 */
export function composeKpis(id: string, t: number, a: HourSums, settings: Pick<CalcSettings, 'availabilityBasis'>): AreaKpis {
  const down = a.pl + a.inc + a.cir;
  const op = t - down;
  const availability: AvailabilitySet = {
    A: clamp01(ratio(t - down, t, 'no_scheduled_time', NO_TIME)),
    B: clamp01(ratio(t - a.pl - (a.inc + a.cir), t - a.pl, 'no_scheduled_time', 'All scheduled time was planned downtime')),
    C: clamp01(ratio(t - a.pl - a.cir - a.inc, t - a.pl - a.cir, 'no_scheduled_time', 'All scheduled time was planned or circumstantial')),
  };
  const noExposure = unavail('no_exposure', 'No operating hours in the window');
  return {
    area_id: id, scheduledHours: t, plannedHours: a.pl, failureHours: a.inc, otherHours: a.cir, downtimeHours: down,
    operatingHours: t > 0 ? avail(Math.max(0, op)) : unavail('no_scheduled_time', NO_TIME),
    failureCount: a.events, failureEventCount: a.events, availability,
    availabilityHeadline: availability[settings.availabilityBasis],
    mtbfHours: a.events === 0 ? unavail('no_failures', NO_FAIL) : op > 0 ? avail(op / a.events) : noExposure,
    failureRatePer1000h: op > 0 ? avail((a.events / op) * 1000) : noExposure,
    mttrHours: a.events === 0 ? unavail('no_failures', NO_FAIL) : avail(a.eventSeconds / 3600 / a.events),
    reliabilityFactor: clamp01(ratio(Math.max(0, op), Math.max(0, op) + a.inc, 'no_exposure', 'No running time outside planned and CIR stops')),
    utilizationFactor: clamp01(ratio(Math.max(0, op), t, 'no_scheduled_time', NO_TIME)),
  };
}

/** Add hours to planned / other / incident by the row's classification. */
export function addRowHours(acc: HourSums, row: Pick<EventRow, 'classification'>, hours: number): void {
  if (row.classification === 'PL') acc.pl += hours;
  else if (row.classification === 'CIR') acc.cir += hours;
  else acc.inc += hours;
}

/**
 * The window is a month to date that ends on the last day with data (e.g. 'This month' while the month is not over):
 * the figures cover only the elapsed days.
 */
function isMonthInProgress(eff: DateRange, data: DateRange): boolean {
  return eff.from.slice(8) === '01' && eff.from.slice(0, 7) === eff.to.slice(0, 7) && eff.to === data.to && eff.to < lastDayOfMonth(eff.to.slice(0, 7));
}

/**
 * KPIs for a window. The window is clipped to the data range (a month still in progress is "partial" and T
 * covers only the elapsed days). With no data covering the window the result is `no_data`, never zeros.
 */
export function computeKpis(input: KpiInput): KpiResult {
  const rows = input.rows.filter(isAnalysable);
  const range = input.dataRange === undefined ? dataRangeOf(rows) : input.dataRange;
  if (range === null) return { status: 'no_data', requestedWindow: input.window, reason: 'No downtime data has been loaded' };
  const eff = intersectRanges(input.window, range);
  if (eff === null) return { status: 'no_data', requestedWindow: input.window, reason: 'No data covers the selected period' };
  const notUploaded = resolveNotUploaded(input.rows, input.dataRange, input.notUploaded);
  const gap = notUploadedDays(eff, notUploaded);
  if (gap.days >= daysInRange(eff)) {
    return { status: 'no_data', requestedWindow: input.window, reason: `Not uploaded: no records for ${gap.months.join(', ')}` };
  }
  const w = rangeToInterval(eff);
  const attr = input.attribution ?? attributeRows(rows);
  const areaIds = input.areaIds ?? [...new Set(rows.map((r) => r.area_id))].sort();
  const accs = new Map<string, HourSums>(areaIds.map((a) => [a, emptySums()]));
  for (const r of rows) {
    const acc = accs.get(r.area_id);
    if (!acc) continue;
    const h = attributedHours(r, w, attr);
    if (h > 0) addRowHours(acc, r, h);
  }
  const chains = analysableChains(input.chains ?? buildFailureEvents(rows).chains).filter((c) => accs.has(c.area_id));
  const failureChains = chains.filter((c) => c.isFailure);
  for (const c of failureChains) {
    if (c.startMs >= w.fromMs && c.startMs < w.toMs) {
      const acc = accs.get(c.area_id)!;
      acc.events++;
      acc.eventSeconds += c.durationS;
    }
  }
  const t = scheduledHoursUploaded(eff, input.settings, notUploaded);
  const areas = areaIds.map((a) => composeKpis(a, t, accs.get(a)!, input.settings));
  const sum = emptySums();
  for (const a of accs.values()) {
    sum.pl += a.pl; sum.inc += a.inc; sum.cir += a.cir; sum.events += a.events; sum.eventSeconds += a.eventSeconds;
  }
  const total = composeKpis('ALL', t * areaIds.length, sum, input.settings);
  const repeats = findRepeatedFailures(failureChains, { settings: input.settings, window: eff, lookup: input.index });
  return {
    status: 'ok', requestedWindow: input.window, window: eff, partial: !sameRange(eff, input.window) || isMonthInProgress(eff, range),
    areas, total, ...contributors(areas, total, failureChains, eff, input.index, attr),
    repeatGroups: repeats.groups.length, repeatedFailureCount: repeats.recurrences.length,
    orphanCount: chains.filter((c) => c.orphan && c.startMs >= w.fromMs && c.startMs < w.toMs).length,
    notUploaded: gap.months, coveredDays: daysInRange(eff) - gap.days,
  };
}

function contributors(
  areas: AreaKpis[], total: AreaKpis, failureChains: ChainedEvent[], window: DateRange, index: MasterIndex | undefined, attribution: Attribution,
): Pick<KpiOk, 'topArea' | 'topEquipmentByHours' | 'mostFrequentEquipment'> {
  const best = areas.reduce<AreaKpis | null>((b, a) => (a.failureHours > (b?.failureHours ?? 0) ? a : b), null);
  const topArea: TopArea = best && total.failureHours > 0
    ? { ...avail(best.failureHours), areaId: best.area_id, sharePct: (best.failureHours / total.failureHours) * 100 }
    : unavail('no_failures', NO_FAIL);
  if (!index) {
    const u = unavail('no_master', 'Equipment master data is not loaded');
    return { topArea, topEquipmentByHours: u, mostFrequentEquipment: u };
  }
  const hours = equipmentPareto(failureChains, index, { measure: 'hours', window, attribution }).own.bars[0];
  const count = equipmentPareto(failureChains, index, { measure: 'count', window }).own.bars[0];
  return {
    topArea,
    topEquipmentByHours: hours ? { ...avail(hours.value), code: hours.key, sharePct: hours.sharePct } : unavail('no_failures', NO_FAIL),
    mostFrequentEquipment: count ? { ...avail(count.value), code: count.key, count: count.value } : unavail('no_failures', NO_FAIL),
  };
}

// ---- comparison ----

export type Assessment = 'good' | 'bad' | 'neutral';
export type Direction = 'up' | 'down' | 'flat';

export type Change =
  | {
    available: true; current: number; previous: number; abs: number; pct: number | null; direction: Direction; assessment: Assessment;
    /** P7: the values are per-day rates because the comparison period is only partly covered (never called better or worse) */
    perDay?: boolean;
    /** the words that say so: 'per day (previous period only partly covered: N of M days)' */
    note?: string;
  }
  | { available: false; reason: string };

/** Compare two values. pct is null when the previous value is 0. `better` says which direction is good. */
export function compareValues(current: Metric, previous: Metric, better: 'higher' | 'lower' | 'none'): Change {
  if (!current.available) return { available: false, reason: current.reason };
  if (!previous.available) return { available: false, reason: previous.reason };
  const abs = current.value - previous.value;
  const flat = Math.abs(abs) < 1e-9;
  const direction: Direction = flat ? 'flat' : abs > 0 ? 'up' : 'down';
  const assessment: Assessment = flat || better === 'none' ? 'neutral' : (abs > 0) === (better === 'higher') ? 'good' : 'bad';
  return { available: true, current: current.value, previous: previous.value, abs, pct: previous.value === 0 ? null : (abs / previous.value) * 100, direction, assessment };
}

export interface KpiChanges {
  failureHours: Change; plannedHours: Change; failureCount: Change; availability: Change;
  mtbfHours: Change; mttrHours: Change; failureRatePer1000h: Change; operatingHours: Change;
  reliabilityFactor: Change; utilizationFactor: Change;
}

/** P7: below this share of covered days the comparison period's totals are not compared as totals. */
export const MIN_COMPARISON_COVERAGE = 0.9;

export interface PeriodCoverage {
  /** days of the period with data: inside the data range and not in a month that was not uploaded */
  coveredDays: number;
  totalDays: number;
  /** coveredDays / totalDays (0 for an empty period) */
  fraction: number;
}

/** How much of a requested period the data covers (data range, minus months not uploaded). */
export function periodCoverage(requested: DateRange, dataRange: DateRange | null, notUploaded: readonly string[] = []): PeriodCoverage {
  const totalDays = daysInRange(requested);
  const eff = dataRange ? intersectRanges(requested, dataRange) : null;
  const coveredDays = eff ? Math.max(0, daysInRange(eff) - notUploadedDays(eff, notUploaded).days) : 0;
  return { coveredDays, totalDays, fraction: totalDays > 0 ? coveredDays / totalDays : 0 };
}

/**
 * How totals (hours, counts) are compared. `perDay` is true when the comparison period is covered for less than 90 %:
 * then totals are compared as per-day rates (current / current days, previous / previous covered days), never
 * called better or worse, and labelled with `note`.
 */
export interface TotalsScaling {
  perDay: boolean;
  currentDays: number;
  previousDays: number;
  previousTotalDays: number;
  note: string;
}

/** 'per day (previous period only partly covered: N of M days)' */
export function perDayNote(previousDays: number, previousTotalDays: number, what = 'previous period'): string {
  return `per day (${what} only partly covered: ${previousDays} of ${previousTotalDays} days)`;
}

/** The scaling for a comparison: per day when the previous period is covered for less than MIN_COMPARISON_COVERAGE. */
export function totalsScaling(currentDays: number, previous: PeriodCoverage, what = 'previous period'): TotalsScaling {
  const perDay = previous.totalDays > 0 && previous.fraction < MIN_COMPARISON_COVERAGE && previous.coveredDays > 0 && currentDays > 0;
  return { perDay, currentDays, previousDays: previous.coveredDays, previousTotalDays: previous.totalDays, note: perDay ? perDayNote(previous.coveredDays, previous.totalDays, what) : '' };
}

/** Compare a total (hours or a count). With a per-day scaling: per-day rates, neutral, with the note. */
export function compareTotal(current: Metric, previous: Metric, better: 'higher' | 'lower' | 'none', scaling: TotalsScaling | null | undefined): Change {
  if (!scaling?.perDay) return compareValues(current, previous, better);
  const c = current.available ? avail(current.value / scaling.currentDays) : current;
  const p = previous.available ? avail(previous.value / scaling.previousDays) : previous;
  const ch = compareValues(c, p, 'none');
  return ch.available ? { ...ch, perDay: true, note: scaling.note } : ch;
}

export function kpiChanges(cur: AreaKpis, prev: AreaKpis, scaling?: TotalsScaling | null): KpiChanges {
  return {
    failureHours: compareTotal(avail(cur.failureHours), avail(prev.failureHours), 'lower', scaling),
    plannedHours: compareTotal(avail(cur.plannedHours), avail(prev.plannedHours), 'none', scaling),
    failureCount: compareTotal(avail(cur.failureCount), avail(prev.failureCount), 'lower', scaling),
    availability: compareValues(cur.availabilityHeadline, prev.availabilityHeadline, 'higher'),
    mtbfHours: compareValues(cur.mtbfHours, prev.mtbfHours, 'higher'),
    mttrHours: compareValues(cur.mttrHours, prev.mttrHours, 'lower'),
    failureRatePer1000h: compareValues(cur.failureRatePer1000h, prev.failureRatePer1000h, 'lower'),
    operatingHours: compareTotal(cur.operatingHours, prev.operatingHours, 'higher', scaling),
    reliabilityFactor: compareValues(cur.reliabilityFactor, prev.reliabilityFactor, 'higher'),
    utilizationFactor: compareValues(cur.utilizationFactor, prev.utilizationFactor, 'higher'),
  };
}

export interface KpiComparison {
  kind: ComparisonKind;
  current: KpiResult;
  previous: KpiResult;
  /** comparison window used; derived from the current EFFECTIVE window so a partial month compares like with like */
  previousWindow: DateRange | null;
  /** the comparison period itself is only partly covered by data */
  previousPartial: boolean;
  /** days of the comparison period with data (P7) */
  previousCoverage: PeriodCoverage | null;
  /** how totals are compared: per day when the comparison period is covered for less than 90 % (P7) */
  scaling: TotalsScaling | null;
  changes: KpiChanges | null;
}

export function computeKpisWithComparison(input: KpiInput, kind: ComparisonKind = input.settings.defaultComparison): KpiComparison {
  const notUploaded = resolveNotUploaded(input.rows, input.dataRange, input.notUploaded);
  const current = computeKpis({ ...input, notUploaded });
  if (current.status !== 'ok') {
    return {
      kind, current, previous: { status: 'no_data', requestedWindow: input.window, reason: 'No current data' }, previousWindow: null, previousPartial: false,
      previousCoverage: null, scaling: null, changes: null,
    };
  }
  const pw = comparisonRange(current.window, kind);
  const previous = computeKpis({ ...input, notUploaded, window: pw });
  const range = input.dataRange === undefined ? dataRangeOf(input.rows.filter(isAnalysable)) : input.dataRange;
  const previousCoverage = periodCoverage(pw, range, notUploaded);
  const scaling = totalsScaling(current.coveredDays, previousCoverage, kind === 'same_period_last_year' ? 'same period last year' : 'previous period');
  return {
    kind, current, previous, previousWindow: pw, previousPartial: previous.status === 'ok' && previous.partial, previousCoverage, scaling,
    changes: previous.status === 'ok' ? kpiChanges(current.total, previous.total, scaling) : null,
  };
}

// ---- availability per area ----

export interface AreaAvailability { area_id: string; availability: Metric }

/**
 * Availability (the basis chosen in settings) of every area, lowest first; areas without a value (no scheduled
 * time) come last. `overall` is the all-area figure from the area-hours aggregate, the reference line of the chart.
 */
export function availabilityByArea(k: Pick<KpiOk, 'areas' | 'total'>): { areas: AreaAvailability[]; overall: Metric } {
  const areas = k.areas
    .map((a) => ({ area_id: a.area_id, availability: a.availabilityHeadline }))
    .sort((a, b) => {
      const x = a.availability.available ? a.availability.value : Infinity;
      const y = b.availability.available ? b.availability.value : Infinity;
      return x - y || (a.area_id < b.area_id ? -1 : a.area_id > b.area_id ? 1 : 0);
    });
  return { areas, overall: k.total.availabilityHeadline };
}
