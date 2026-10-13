/** Area-hour KPIs, availability bases A/B/C, reliability figures and comparison (docs section 8). */
import type { EventRow } from '../api/types';
import { analysableChains, buildFailureEvents, isAnalysable, rowSpan, type ChainedEvent } from './events';
import type { MasterIndex } from './masters';
import { avail, ratio, unavail, type Metric } from './metric';
import { equipmentPareto } from './pareto';
import { findRepeatedFailures } from './repeats';
import type { CalcSettings, ComparisonKind } from './settings';
import { clippedHours, comparisonRange, dateOf, formatDate, intersectRanges, lastDayOfMonth, parseTs, rangeToInterval, sameRange, scheduledHours, type DateRange } from './time';

export interface AvailabilitySet { A: Metric; B: Metric; C: Metric }

export interface AreaKpis {
  /** area id, or 'ALL' for the area-hours aggregate */
  area_id: string;
  /** scheduled time T in the effective window (summed over areas for the aggregate: area-hours) */
  scheduledHours: number;
  plannedHours: number;
  /** INC hours: every row that is not PL or CIR, continuations included */
  failureHours: number;
  /** CIR hours */
  otherHours: number;
  downtimeHours: number;
  /** T - (PL + INC + CIR); unavailable when there is no scheduled time */
  operatingHours: Metric;
  /** rows with is_failure whose stop is inside the window */
  failureCount: number;
  /** failure events (chains) that started in the window: the MTTR cohort */
  failureEventCount: number;
  availability: AvailabilitySet;
  /** availability on the basis chosen in settings */
  availabilityHeadline: Metric;
  mtbfHours: Metric;
  failureRatePer1000h: Metric;
  mttrHours: Metric;
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
}

export interface HourSums { pl: number; inc: number; cir: number; failures: number; events: number; eventSeconds: number }

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
  return { pl: 0, inc: 0, cir: 0, failures: 0, events: 0, eventSeconds: 0 };
}

const clamp01 = (m: Metric): Metric => (m.available ? avail(Math.min(1, Math.max(0, m.value))) : m);

/**
 * Compose the KPI metrics from summed hours; used for each area and for the aggregate.
 * A = (T - downtime) / T;  B = (T - PL - (INC + CIR)) / (T - PL);  C = (T - PL - CIR - INC) / (T - PL - CIR).
 * MTBF = operating hours / failures (unavailable with zero failures or no exposure, never Infinity or 0).
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
    failureCount: a.failures, failureEventCount: a.events, availability,
    availabilityHeadline: availability[settings.availabilityBasis],
    mtbfHours: a.failures === 0 ? unavail('no_failures', NO_FAIL) : op > 0 ? avail(op / a.failures) : noExposure,
    failureRatePer1000h: op > 0 ? avail((a.failures / op) * 1000) : noExposure,
    mttrHours: a.events === 0 ? unavail('no_failures', NO_FAIL) : avail(a.eventSeconds / 3600 / a.events),
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
  const w = rangeToInterval(eff);
  const areaIds = input.areaIds ?? [...new Set(rows.map((r) => r.area_id))].sort();
  const accs = new Map<string, HourSums>(areaIds.map((a) => [a, emptySums()]));
  for (const r of rows) {
    const acc = accs.get(r.area_id);
    const span = acc ? rowSpan(r) : null;
    if (!acc || !span) continue;
    const h = clippedHours(span, w);
    if (h > 0) addRowHours(acc, r, h);
    if (r.is_failure && span.fromMs >= w.fromMs && span.fromMs < w.toMs) acc.failures++;
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
  const t = scheduledHours(eff, input.settings);
  const areas = areaIds.map((a) => composeKpis(a, t, accs.get(a)!, input.settings));
  const sum = emptySums();
  for (const a of accs.values()) {
    sum.pl += a.pl; sum.inc += a.inc; sum.cir += a.cir; sum.failures += a.failures; sum.events += a.events; sum.eventSeconds += a.eventSeconds;
  }
  const total = composeKpis('ALL', t * areaIds.length, sum, input.settings);
  const repeats = findRepeatedFailures(failureChains, { settings: input.settings, window: eff, lookup: input.index });
  return {
    status: 'ok', requestedWindow: input.window, window: eff, partial: !sameRange(eff, input.window) || isMonthInProgress(eff, range),
    areas, total, ...contributors(areas, total, failureChains, eff, input.index),
    repeatGroups: repeats.groups.length, repeatedFailureCount: repeats.recurrences.length,
    orphanCount: chains.filter((c) => c.orphan && c.startMs >= w.fromMs && c.startMs < w.toMs).length,
  };
}

function contributors(
  areas: AreaKpis[], total: AreaKpis, failureChains: ChainedEvent[], window: DateRange, index: MasterIndex | undefined,
): Pick<KpiOk, 'topArea' | 'topEquipmentByHours' | 'mostFrequentEquipment'> {
  const best = areas.reduce<AreaKpis | null>((b, a) => (a.failureHours > (b?.failureHours ?? 0) ? a : b), null);
  const topArea: TopArea = best && total.failureHours > 0
    ? { ...avail(best.failureHours), areaId: best.area_id, sharePct: (best.failureHours / total.failureHours) * 100 }
    : unavail('no_failures', NO_FAIL);
  if (!index) {
    const u = unavail('no_master', 'Equipment master data is not loaded');
    return { topArea, topEquipmentByHours: u, mostFrequentEquipment: u };
  }
  const hours = equipmentPareto(failureChains, index, { measure: 'hours', window }).own.bars[0];
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
  | { available: true; current: number; previous: number; abs: number; pct: number | null; direction: Direction; assessment: Assessment }
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
}

export function kpiChanges(cur: AreaKpis, prev: AreaKpis): KpiChanges {
  return {
    failureHours: compareValues(avail(cur.failureHours), avail(prev.failureHours), 'lower'),
    plannedHours: compareValues(avail(cur.plannedHours), avail(prev.plannedHours), 'none'),
    failureCount: compareValues(avail(cur.failureCount), avail(prev.failureCount), 'lower'),
    availability: compareValues(cur.availabilityHeadline, prev.availabilityHeadline, 'higher'),
    mtbfHours: compareValues(cur.mtbfHours, prev.mtbfHours, 'higher'),
    mttrHours: compareValues(cur.mttrHours, prev.mttrHours, 'lower'),
    failureRatePer1000h: compareValues(cur.failureRatePer1000h, prev.failureRatePer1000h, 'lower'),
    operatingHours: compareValues(cur.operatingHours, prev.operatingHours, 'higher'),
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
  changes: KpiChanges | null;
}

export function computeKpisWithComparison(input: KpiInput, kind: ComparisonKind = input.settings.defaultComparison): KpiComparison {
  const current = computeKpis(input);
  if (current.status !== 'ok') {
    return { kind, current, previous: { status: 'no_data', requestedWindow: input.window, reason: 'No current data' }, previousWindow: null, previousPartial: false, changes: null };
  }
  const pw = comparisonRange(current.window, kind);
  const previous = computeKpis({ ...input, window: pw });
  return {
    kind, current, previous, previousWindow: pw, previousPartial: previous.status === 'ok' && previous.partial,
    changes: previous.status === 'ok' ? kpiChanges(current.total, previous.total) : null,
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
