// Page adapters: pick the calc function for each dashboard element and hand it the scope. No arithmetic of
// their own beyond joining calc outputs (tests compare every headline number with a direct calc call).
import {
  areaPareto, buildPareto, classificationPareto, compareValues, avail, durationHistogram, equipmentMonthHeatmap,
  equipmentPareto, equipmentReasonHeatmap, findRepeatedFailures, longestEvents, monthlySeries, reasonPareto,
  reasonParetoForEquipment, resolvedKey, rollingFailureCounts, rowCode, yearOverYear,
  type AreaKpis, type Change, type ChainedEvent, type DateRange, type DurationHistogram, type EquipmentParetoResult, type Heatmap,
  type KpiChanges, type KpiOk, type LongEvent, type MonthPoint, type ParetoBar, type ParetoMeasure, type ParetoResult, type RepeatResult,
  type RollingPoint, type TopN, type YoyMonth,
} from '../calc';
import type { DashCtx } from './scope';

// ---------------------------------------------------------------- overview

export interface OverviewModel {
  /** null when there is no data for the window */
  kpi: KpiOk | null;
  noDataReason: string | null;
  prev: KpiOk | null;
  changes: KpiChanges | null;
  downtimeChange: Change | null;
  otherChange: Change | null;
  repeatedChange: Change | null;
  monthly: MonthPoint[];
  perArea: AreaKpis[];
}

export function overviewModel(ctx: DashCtx): OverviewModel {
  const cur = ctx.kpis.current;
  const kpi = cur.status === 'ok' ? cur : null;
  const cmp = ctx.kpis.comparison;
  const prev = cmp && cmp.previous.status === 'ok' ? cmp.previous : null;
  const both = kpi && prev;
  return {
    kpi,
    noDataReason: cur.status === 'no_data' ? cur.reason : null,
    prev,
    changes: cmp?.changes ?? null,
    downtimeChange: both ? compareValues(avail(kpi.total.downtimeHours), avail(prev.total.downtimeHours), 'lower') : null,
    otherChange: both ? compareValues(avail(kpi.total.otherHours), avail(prev.total.otherHours), 'none') : null,
    repeatedChange: both ? compareValues(avail(kpi.repeatedFailureCount), avail(prev.repeatedFailureCount), 'lower') : null,
    monthly: monthly(ctx),
    perArea: kpi?.areas ?? [],
  };
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

// ---------------------------------------------------------------- repeats

export interface ScatterPoint { code: string; count: number; avgHours: number; totalHours: number; eventIds: string[] }

export interface RepeatsModel {
  result: RepeatResult;
  heatMonthHours: Heatmap;
  heatMonthCount: Heatmap;
  heatReasonHours: Heatmap;
  heatReasonCount: Heatmap;
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

export type { ParetoBar };
