// Page adapters: pick the calc function for each dashboard element and hand it the scope. No arithmetic of
// their own beyond joining calc outputs (tests compare every headline number with a direct calc call).
import {
  areaMonthAvailability, areaPareto, availabilityByArea, failureStartHeatmap, linePareto, mtbfMttrQuadrants, rankAreas, reasonMonthHeatmap, buildPareto, classificationPareto, dailySeries, daysInRange, monthlyHoursByClassification, compareValues, avail, durationHistogram, equipmentMonthHeatmap,
  equipmentPareto, equipmentReasonHeatmap, findRepeatedFailures, longestEvents, monthlySeries, reasonPareto,
  reasonParetoForEquipment, resolvedKey, rollingFailureCounts, rowCode, yearOverYear,
  type AreaAvailability, type AreaKpis, type AreaMonthAvailability, type AreaRank, type QuadrantResult, type ClassMonthPoint, type DayPoint, type Metric, type Change, type ChainedEvent, type DateRange, type DurationHistogram, type EquipmentParetoResult, type Heatmap,
  type KpiChanges, type KpiOk, type LongEvent, type MonthPoint, type ParetoBar, type ParetoMeasure, type ParetoResult, type RepeatResult,
  type RollingPoint, type TopN, type YoyMonth,
} from '../calc';
import type { CompareMode } from './filters';
import { areaTargetStatuses, belowTargetCount, getTargets, kpiTargetStatuses, type KpiTargetStatuses, type Targets } from './targets';
import type { DashCtx } from './scope';

// ---------------------------------------------------------------- overview

export interface OverviewModel {
  /** null when there is no data for the window */
  kpi: KpiOk | null;
  noDataReason: string | null;
  prev: KpiOk | null;
  /** the comparison the user chose; with 'none' there is no change line, otherwise a null change means the other period has no data */
  compare: CompareMode;
  changes: KpiChanges | null;
  downtimeChange: Change | null;
  otherChange: Change | null;
  repeatedChange: Change | null;
  monthly: MonthPoint[];
  perArea: AreaKpis[];
  /** one point per day of the effective window, with the 7-day rolling mean of the stopped hours */
  daily: DayPoint[];
  /** stopped hours per month and classification */
  byClass: ClassMonthPoint[];
  /** the ten equipment codes with most failure hours (own-stop rule); shares are against the full total */
  topEquipment: { bars: ParetoBar[]; total: number };
  /** availability per area (lowest first) and for all areas together */
  availability: { areas: AreaAvailability[]; overall: Metric } | null;
  /** the optional targets from the settings (null = off) */
  targets: Targets;
  /** all-area availability and MTTR against their targets; MTBF only when exactly one area is in scope (as the MTBF tile) */
  status: KpiTargetStatuses;
  /** areas below the availability target ("N of M areas below target"); null while that target is off */
  belowTarget: { below: string[]; total: number } | null;
}

export const ROLLING_DAYS = 7;

export function overviewModel(ctx: DashCtx): OverviewModel {
  const cur = ctx.kpis.current;
  const kpi = cur.status === 'ok' ? cur : null;
  const cmp = ctx.kpis.comparison;
  const prev = cmp && cmp.previous.status === 'ok' ? cmp.previous : null;
  const both = kpi && prev;
  const targets = getTargets(ctx.master.settings);
  const availability = kpi ? availabilityByArea(kpi) : null;
  const one = kpi && kpi.areas.length === 1 ? kpi.areas[0]! : null;
  const status = kpi ? kpiTargetStatuses(kpi.total, targets) : { availability: null, mtbf: null, mttr: null };
  return {
    kpi,
    noDataReason: cur.status === 'no_data' ? cur.reason : null,
    prev,
    compare: ctx.win.compare,
    changes: cmp?.changes ?? null,
    downtimeChange: both ? compareValues(avail(kpi.total.downtimeHours), avail(prev.total.downtimeHours), 'lower') : null,
    otherChange: both ? compareValues(avail(kpi.total.otherHours), avail(prev.total.otherHours), 'none') : null,
    repeatedChange: both ? compareValues(avail(kpi.repeatedFailureCount), avail(prev.repeatedFailureCount), 'lower') : null,
    monthly: monthly(ctx),
    perArea: kpi?.areas ?? [],
    daily: daily(ctx),
    byClass: ctx.win.range ? monthlyHoursByClassification({ rows: ctx.scope.kpiRows, range: ctx.win.range, dataRange: ctx.coverage, areaIds: ctx.base.areaIds }) : [],
    topEquipment: topEquipment(ctx, 10),
    availability,
    targets,
    status: { ...status, mtbf: one ? kpiTargetStatuses(one, targets).mtbf : null },
    belowTarget: availability ? belowTargetCount(availability.areas, targets) : null,
  };
}

/** One point per day of the window the numbers are calculated for (range clipped to the data). */
export function daily(ctx: DashCtx): DayPoint[] {
  const range = ctx.win.effective;
  if (!range) return [];
  return dailySeries({
    rows: ctx.scope.kpiRows, chains: ctx.scope.chains, range, dataRange: ctx.coverage, areaIds: ctx.base.areaIds,
    settings: ctx.master.settings, rollingDays: ROLLING_DAYS,
  });
}

/** Equipment Pareto bars by failure hours (own-stop rule), largest first. */
export function topEquipment(ctx: DashCtx, n: number): { bars: ParetoBar[]; total: number } {
  const window = ctx.win.effective;
  if (!window) return { bars: [], total: 0 };
  const own = equipmentPareto(ctx.scope.failureChains, ctx.master.index, { measure: 'hours', window }).own;
  return { bars: own.bars.filter((b) => !b.isOthers).slice(0, n), total: own.total };
}

export interface SparkSeries {
  mode: 'daily' | 'weekly' | 'monthly';
  /** first label of each point, for the accessible name */
  labels: string[];
  downtimeHours: (number | null)[];
  failureCount: (number | null)[];
  /** 0..1 */
  availability: (number | null)[];
  mttrHours: (number | null)[];
}

const num = (m: Metric): number | null => (m.available ? m.value : null);

/** Monday (ISO week start) of a YYYY-MM-DD date. */
export function isoWeekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Sparkline resolution: daily up to 28 days, weekly up to 120 days, monthly beyond. */
export function sparkMode(windowDays: number): SparkSeries['mode'] {
  return windowDays <= 28 ? 'daily' : windowDays <= 120 ? 'weekly' : 'monthly';
}

/** Weighted mean of per-day values; null when no day has a value. */
function wmean(items: { v: number | null; w: number }[]): number | null {
  let sw = 0;
  let sv = 0;
  for (const i of items) if (i.v !== null && i.w > 0) { sw += i.w; sv += i.v * i.w; }
  return sw > 0 ? sv / sw : null;
}

/** Daily points up to 28 days, ISO-week points up to 120 days (hours and counts summed, availability weighted by scheduled time, MTTR by failure events), monthly points beyond. */
export function sparkSeries(days: DayPoint[], months: MonthPoint[], windowDays: number): SparkSeries {
  const mode = sparkMode(windowDays);
  if (mode === 'daily') {
    return {
      mode, labels: days.map((d) => d.date),
      downtimeHours: days.map((d) => (d.hasData ? d.downtimeHours : null)),
      failureCount: days.map((d) => (d.hasData ? d.failureCount : null)),
      availability: days.map((d) => (d.kpis ? num(d.kpis.availabilityHeadline) : null)),
      mttrHours: days.map((d) => (d.kpis ? num(d.kpis.mttrHours) : null)),
    };
  }
  if (mode === 'weekly') {
    const weeks = new Map<string, DayPoint[]>();
    for (const d of days) {
      const k = isoWeekStart(d.date);
      const list = weeks.get(k);
      if (list) list.push(d); else weeks.set(k, [d]);
    }
    const out: SparkSeries = { mode, labels: [], downtimeHours: [], failureCount: [], availability: [], mttrHours: [] };
    for (const [k, ds] of weeks) {
      const withData = ds.filter((d) => d.hasData);
      out.labels.push(k);
      out.downtimeHours.push(withData.length ? withData.reduce((s, d) => s + d.downtimeHours, 0) : null);
      out.failureCount.push(withData.length ? withData.reduce((s, d) => s + d.failureCount, 0) : null);
      out.availability.push(wmean(withData.map((d) => ({ v: d.kpis ? num(d.kpis.availabilityHeadline) : null, w: d.kpis?.scheduledHours ?? 0 }))));
      out.mttrHours.push(wmean(withData.map((d) => ({ v: d.kpis ? num(d.kpis.mttrHours) : null, w: d.kpis?.failureEventCount ?? 0 }))));
    }
    return out;
  }
  return {
    mode, labels: months.map((m) => m.month),
    downtimeHours: months.map((m) => (m.hasData ? m.failureHours + m.plannedHours + m.otherHours : null)),
    failureCount: months.map((m) => (m.hasData ? m.failureCount : null)),
    availability: months.map((m) => num(m.availability)),
    mttrHours: months.map((m) => num(m.mttrHours)),
  };
}

export function windowDays(ctx: DashCtx): number {
  return ctx.win.effective ? daysInRange(ctx.win.effective) : 0;
}

/** One point per month of the range, for all areas in scope or for one area. */
export function monthly(ctx: DashCtx, areaId?: string): MonthPoint[] {
  return monthlySeries({
    rows: ctx.scope.kpiRows, chains: ctx.scope.chains, range: ctx.win.range, dataRange: ctx.coverage,
    areaIds: areaId ? [areaId] : ctx.base.areaIds, settings: ctx.master.settings,
  });
}

// ---------------------------------------------------------------- pareto

export interface EquipmentModel {
  hours: EquipmentParetoResult;
  count: EquipmentParetoResult;
}

export function equipmentModel(ctx: DashCtx): EquipmentModel | null {
  const window = ctx.win.effective;
  if (!window) return null;
  const chains = ctx.scope.failureChains;
  return {
    hours: equipmentPareto(chains, ctx.master.index, { measure: 'hours', window }),
    count: equipmentPareto(chains, ctx.master.index, { measure: 'count', window }),
  };
}

/** Cut an 'all' Pareto to Top N (calc buildPareto over its bars; shares stay against the complete total). */
export function cutPareto(all: ParetoResult, topN: TopN): ParetoResult {
  const entries = all.bars.filter((b) => !b.isOthers).map((b) => ({ key: b.key, label: b.label, value: b.value, eventIds: b.eventIds }));
  return buildPareto(entries, topN);
}

export interface ReasonModel {
  hours: ParetoResult;
  count: ParetoResult;
}

export function reasonModel(ctx: DashCtx, split: boolean): ReasonModel | null {
  const window = ctx.win.effective;
  if (!window) return null;
  const o = { window, splitByClassification: split };
  return { hours: reasonPareto(ctx.scope.failureChains, { ...o, measure: 'hours' }), count: reasonPareto(ctx.scope.failureChains, { ...o, measure: 'count' }) };
}

export function reasonForEquipmentModel(ctx: DashCtx, code: string, split: boolean, measure: ParetoMeasure): ParetoResult | null {
  const window = ctx.win.effective;
  if (!window || !code) return null;
  return reasonParetoForEquipment(ctx.scope.failureChains, code, ctx.master.index, { window, measure, splitByClassification: split });
}

export function areaModel(ctx: DashCtx, measure: ParetoMeasure): ParetoResult | null {
  const window = ctx.win.effective;
  return window ? areaPareto(ctx.scope.failureChains, { window, measure }) : null;
}

export function classModel(ctx: DashCtx, measure: ParetoMeasure, failureOnly: boolean): ParetoResult | null {
  const window = ctx.win.effective;
  return window ? classificationPareto(ctx.scope.chains, { window, measure, failureOnly }) : null;
}

/** Failure Pareto by production line (the line of the stopped area in the master data). */
export function lineModel(ctx: DashCtx, measure: ParetoMeasure): ParetoResult | null {
  const window = ctx.win.effective;
  if (!window) return null;
  const index = ctx.master.index;
  return linePareto(ctx.scope.failureChains, {
    window, measure, lineOf: (a) => index.areaById.get(a)?.line_id ?? '', lineLabel: (l) => ctx.master.lineNames.get(l) ?? l,
  });
}

export interface ReasonMonthModel {
  /** the largest 12 reasons */
  hours: Heatmap; count: Heatmap;
  /** every reason, for the Show all rows button */
  hoursAll: Heatmap; countAll: Heatmap;
}

/** Reasons x months of the effective window; same event rules as the equipment-by-month heat map. */
export function reasonMonthModel(ctx: DashCtx): ReasonMonthModel | null {
  const window = ctx.win.effective;
  if (!window) return null;
  const chains = ctx.scope.failureChains;
  return {
    hours: reasonMonthHeatmap(chains, window, { measure: 'hours', maxRows: 12 }),
    count: reasonMonthHeatmap(chains, window, { measure: 'count', maxRows: 12 }),
    hoursAll: reasonMonthHeatmap(chains, window, { measure: 'hours' }),
    countAll: reasonMonthHeatmap(chains, window, { measure: 'count' }),
  };
}

// ---------------------------------------------------------------- repeats

export interface ScatterPoint { code: string; count: number; avgHours: number; totalHours: number; eventIds: string[] }

export interface RepeatsModel {
  result: RepeatResult;
  heatMonthHours: Heatmap;
  heatMonthCount: Heatmap;
  heatReasonHours: Heatmap;
  heatReasonCount: Heatmap;
  /** the same heat maps with every row, for the 'Show all rows' button */
  heatAll: { monthHours: Heatmap; monthCount: Heatmap; reasonHours: Heatmap; reasonCount: Heatmap };
  scatter: ScatterPoint[];
  window: DateRange;
}

export function repeatsModel(ctx: DashCtx): RepeatsModel | null {
  const window = ctx.win.effective;
  if (!window) return null;
  const chains = ctx.scope.failureChains;
  const index = ctx.master.index;
  const result = findRepeatedFailures(chains, {
    settings: ctx.master.settings, window, previousWindow: ctx.win.compareRange ?? undefined, lookup: index,
  });
  const hours = equipmentPareto(chains, index, { measure: 'hours', window }).own;
  const count = equipmentPareto(chains, index, { measure: 'count', window }).own;
  const h = new Map(hours.bars.map((b) => [b.key, b]));
  const scatter: ScatterPoint[] = count.bars
    .map((c) => ({ code: c.key, count: c.value, totalHours: h.get(c.key)?.value ?? 0, avgHours: (h.get(c.key)?.value ?? 0) / c.value, eventIds: c.eventIds }))
    .filter((p) => p.count > 0);
  return {
    result, window, scatter,
    heatMonthHours: equipmentMonthHeatmap(chains, index, window, { measure: 'hours', maxRows: 15 }),
    heatMonthCount: equipmentMonthHeatmap(chains, index, window, { measure: 'count', maxRows: 15 }),
    heatReasonHours: equipmentReasonHeatmap(chains, index, window, { measure: 'hours', maxRows: 12, maxCols: 8 }),
    heatReasonCount: equipmentReasonHeatmap(chains, index, window, { measure: 'count', maxRows: 12, maxCols: 8 }),
    heatAll: {
      monthHours: equipmentMonthHeatmap(chains, index, window, { measure: 'hours' }),
      monthCount: equipmentMonthHeatmap(chains, index, window, { measure: 'count' }),
      reasonHours: equipmentReasonHeatmap(chains, index, window, { measure: 'hours', maxCols: 8 }),
      reasonCount: equipmentReasonHeatmap(chains, index, window, { measure: 'count', maxCols: 8 }),
    },
  };
}

export function rolling(ctx: DashCtx, days: 30 | 90): RollingPoint[] {
  return ctx.win.effective ? rollingFailureCounts(ctx.scope.failureChains, ctx.win.effective, days) : [];
}

/** Failure events of one equipment code inside the window, oldest first. */
export function eventsOfEquipment(ctx: DashCtx, code: string): ChainedEvent[] {
  const w = ctx.win.effective;
  if (!w) return [];
  const want = code.toUpperCase();
  return ctx.scope.failureChains
    .filter((c) => {
      const d = c.startDate;
      return d >= w.from && d <= w.to && resolvedKey(rowCode(c.head, ctx.master.index)).toUpperCase() === want;
    })
    .sort((a, b) => a.startMs - b.startMs);
}

// ---------------------------------------------------------------- reliability

export interface ReliabilityModel {
  monthly: MonthPoint[];
  histogram: DurationHistogram;
  yoy: YoyMonth[];
  yoyYear: number;
  longest: LongEvent[];
}

export function reliabilityModel(ctx: DashCtx, areaId?: string): ReliabilityModel | null {
  const window = ctx.win.effective;
  if (!window) return null;
  const areaIds = areaId ? [areaId] : ctx.base.areaIds;
  const yoyYear = Number(window.to.slice(0, 4));
  return {
    monthly: monthly(ctx, areaId),
    histogram: durationHistogram(ctx.scope.failureChains, ctx.master.settings, window),
    yoy: yearOverYear({ rows: ctx.scope.kpiRows, chains: ctx.scope.chains, year: yoyYear, settings: ctx.master.settings, areaIds, dataRange: ctx.coverage }),
    yoyYear,
    longest: longestEvents(ctx.scope.chains, 10, { failureOnly: true, window }),
  };
}

// ---------------------------------------------------------------- reliability by area

export interface AreaReliabilityModel {
  basis: 'A' | 'B' | 'C';
  /** MTBF, lowest (worst) first; areas without failures last */
  mtbf: AreaRank[];
  /** MTTR, highest (worst) first; areas without failures last */
  mttr: AreaRank[];
  quadrant: QuadrantResult;
  /** failures per 1,000 operating hours, highest first, and the all-area figure (area-hours aggregate) */
  rate: { rows: AreaRank[]; overall: Metric };
  monthAvailability: AreaMonthAvailability;
  /** whole-range availability per area (the By area table value) */
  overallAvailability: Map<string, Metric>;
  /** failure events that started in the window, per area (click-through) */
  failureIds: Map<string, string[]>;
  /** the optional targets (null = off) */
  targets: Targets;
  /** availability, MTBF and MTTR of every area against the targets (null entries where a target is off or a figure is missing) */
  status: Map<string, KpiTargetStatuses>;
}

/** Everything the Areas block adds below the By area table; all figures come from the same AreaKpis as that table. */
export function areaReliabilityModel(ctx: DashCtx): AreaReliabilityModel | null {
  const k = ctx.kpis.current;
  const window = ctx.win.effective;
  if (k.status !== 'ok' || !window) return null;
  const failureIds = new Map<string, string[]>(k.areas.map((a) => [a.area_id, []]));
  const w0 = window.from;
  const w1 = window.to;
  for (const c of ctx.scope.failureChains) if (c.startDate >= w0 && c.startDate <= w1) failureIds.get(c.area_id)?.push(c.id);
  const targets = getTargets(ctx.master.settings);
  return {
    basis: ctx.master.settings.availabilityBasis,
    mtbf: rankAreas(k.areas, (a) => a.mtbfHours, 'asc'),
    mttr: rankAreas(k.areas, (a) => a.mttrHours, 'desc'),
    quadrant: mtbfMttrQuadrants(k.areas),
    rate: { rows: rankAreas(k.areas, (a) => a.failureRatePer1000h, 'desc'), overall: k.total.failureRatePer1000h },
    monthAvailability: areaMonthAvailability({
      rows: ctx.scope.kpiRows, chains: ctx.scope.chains, range: ctx.win.range, dataRange: ctx.coverage, areaIds: ctx.base.areaIds, settings: ctx.master.settings,
    }),
    overallAvailability: new Map(k.areas.map((a) => [a.area_id, a.availabilityHeadline])),
    failureIds,
    targets,
    status: areaTargetStatuses(k.areas, targets),
  };
}

/** Hour of day x weekday of failure-event starts (count or hours of the whole event), for the effective window. */
export function whenFailuresStart(ctx: DashCtx, measure: ParetoMeasure): Heatmap | null {
  const window = ctx.win.effective;
  return window ? failureStartHeatmap(ctx.scope.failureChains, window, { measure }) : null;
}

export type { ParetoBar };
