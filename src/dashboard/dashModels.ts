// The Dashboard cards (docs/redesign R2): one pure model per card, built from the calc layer and the page adapters
// in models.ts. No figure of its own: hours, counts, availability, MTBF and MTTR come from the same calc functions
// as the KPIs, and every card also names the exact records behind it (the ids the 'Open records' link opens), so a
// drill-through always shows the events the card counts.
import {
  addMonthsToKey, areaMonthAvailability, chainHours, dailyHoursByClassification, daysInRange, findRepeatedFailures, intersectRanges, listedRepeats, lastDayOfMonth, monthRange,
  monthlyHoursByClassification, monthlySeries, monthsOfRange, rangeToInterval, startedIn,
  type DateRange, type DayPoint, type Metric, type MonthPoint, type ParetoBar, type ParetoMeasure, type ParetoResult, type RepeatGroup,
} from '../calc';
import { monthShort, monthText, rangeText } from '../util/dates';
import type { DashFilters } from './filters';
import { areaModel, daily, equipmentModel, lineModel, reasonModel } from './models';
import type { DashCtx } from './scope';
import { getTargets, targetsOfArea, targetStatus, type OwnTargets, type TargetStatus, type Targets } from './targets';

// ---------------------------------------------------------------- ranges

const monthStart = (d: string): string => `${d.slice(0, 7)}-01`;
const minD = (a: string, b: string): string => (a < b ? a : b);
const maxD = (a: string, b: string): string => (a > b ? a : b);

/** At most this many months on the year-context charts (trend, heat map). */
export const CONTEXT_MAX_MONTHS = 24;

/**
 * The year around the period, for the cards that show months (trend by month, availability heat map): from 1 Jan of
 * the year the period ends in (or the start month of the period when that is earlier) to the end of the data in that
 * year, so the months after the period, a month not uploaded and a month in progress are shown as such.
 */
export function contextRange(ctx: Pick<DashCtx, 'win' | 'coverage'>): DateRange | null {
  const eff = ctx.win.effective;
  if (!eff || !ctx.coverage) return null;
  const y = eff.to.slice(0, 4);
  let from = minD(`${y}-01-01`, monthStart(ctx.win.range.from));
  const to = maxD(eff.to, minD(ctx.coverage.to, `${y}-12-31`));
  const earliest = `${addMonthsToKey(to.slice(0, 7), -(CONTEXT_MAX_MONTHS - 1))}-01`;
  if (from < earliest) from = earliest;
  return { from, to };
}

/** From the start of the context year to the end of the period: the KPI sparklines and failures / MTTR by month. */
export function yearToPeriodRange(ctx: Pick<DashCtx, 'win' | 'coverage'>): DateRange | null {
  const c = contextRange(ctx);
  const eff = ctx.win.effective;
  return c && eff ? { from: c.from, to: eff.to } : null;
}

// ---------------------------------------------------------------- the records behind a card

/** Events (chain ids) with stopped hours inside the range, as the KPIs count them (overlaps owned once, P1). */
export function idsWithHours(ctx: Pick<DashCtx, 'scope'>, range: DateRange, areaId?: string): string[] {
  const w = rangeToInterval(range);
  const attr = ctx.scope.attribution;
  return ctx.scope.chains.filter((c) => (!areaId || c.area_id === areaId) && chainHours(c, w, attr) > 0).map((c) => c.id);
}

/** The same, per area (one pass). */
export function idsWithHoursByArea(ctx: Pick<DashCtx, 'scope'>, range: DateRange): Map<string, string[]> {
  const w = rangeToInterval(range);
  const attr = ctx.scope.attribution;
  const out = new Map<string, string[]>();
  for (const c of ctx.scope.chains) {
    if (!(chainHours(c, w, attr) > 0)) continue;
    const l = out.get(c.area_id);
    if (l) l.push(c.id); else out.set(c.area_id, [c.id]);
  }
  return out;
}

/** Failure events (P2) that started inside the range: the cohort of the failure count, MTTR and MTBF. */
export function failureIdsStarted(ctx: Pick<DashCtx, 'scope'>, range: DateRange): string[] {
  const w = rangeToInterval(range);
  return ctx.scope.failureChains.filter((c) => startedIn(c, w)).map((c) => c.id);
}

// ---------------------------------------------------------------- slots (months or days) with their status

export type SlotStatus = 'full' | 'partial' | 'notUploaded' | 'noData';
export const hasValues = (s: SlotStatus): boolean => s === 'full' || s === 'partial';

const statusOf = (m: { hasData: boolean; notUploaded: boolean; partial?: boolean }): SlotStatus =>
  (m.hasData ? (m.partial ? 'partial' : 'full') : m.notUploaded ? 'notUploaded' : 'noData');

export interface Slot {
  /** 'YYYY-MM' or 'YYYY-MM-DD' */
  key: string;
  status: SlotStatus;
  /** days with data (null without data) */
  window: DateRange | null;
  /** the slot lies in the selected period (highlighted) */
  inPeriod: boolean;
}

// ---------------------------------------------------------------- KPI sparklines

export interface KpiSparks {
  slots: Slot[];
  downtimeHours: (number | null)[];
  failureCount: (number | null)[];
  /** 0..1 */
  availability: (number | null)[];
  mttrHours: (number | null)[];
  mtbfHours: (number | null)[];
  /** running (operating) hours, area-hours */
  operatingHours: (number | null)[];
  /** reliability factor and utilization factor, 0..1 */
  reliability: (number | null)[];
  utilization: (number | null)[];
}

const num = (m: Metric): number | null => (m.available ? m.value : null);

export function monthlyOver(ctx: DashCtx, range: DateRange): MonthPoint[] {
  return monthlySeries({
    rows: ctx.scope.kpiRows, chains: ctx.scope.chains, range, dataRange: ctx.coverage, areaIds: ctx.base.areaIds,
    settings: ctx.master.settings, attribution: ctx.scope.attribution, notUploaded: ctx.notUploaded,
  });
}

const monthSlot = (ctx: DashCtx, m: { month: string; window: DateRange | null; hasData: boolean; notUploaded: boolean; partial: boolean }): Slot => ({
  key: m.month, status: statusOf(m), window: m.window, inPeriod: !!intersectRanges(monthRange(m.month), ctx.win.range),
});

/** One point per month from January to the end of the period (gaps for months not uploaded or without data). */
export function kpiSparks(ctx: DashCtx): KpiSparks | null {
  const r = yearToPeriodRange(ctx);
  if (!r) return null;
  const ms = monthlyOver(ctx, r);
  return {
    slots: ms.map((m) => monthSlot(ctx, m)),
    downtimeHours: ms.map((m) => (m.hasData ? m.plannedHours + m.failureHours + m.otherHours : null)),
    failureCount: ms.map((m) => (m.hasData ? m.failureCount : null)),
    availability: ms.map((m) => num(m.availability)),
    mttrHours: ms.map((m) => num(m.mttrHours)),
    mtbfHours: ms.map((m) => num(m.mtbfHours)),
    operatingHours: ms.map((m) => (m.hasData ? num(m.operatingHours) : null)),
    reliability: ms.map((m) => (m.hasData && m.kpis ? num(m.kpis.reliabilityFactor) : null)),
    utilization: ms.map((m) => (m.hasData && m.kpis ? num(m.kpis.utilizationFactor) : null)),
  };
}

// ---------------------------------------------------------------- (2) stoppage by month or day, by type or class

export type Grain = 'month' | 'day';
export type SplitBy = 'type' | 'class';
export const TYPE_KEYS = ['inc', 'pl', 'cir'] as const;
export const CLASS_KEYS = ['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'] as const;

export interface TrendSlot extends Slot {
  /** hours per key (type or class); 0 without data */
  values: Record<string, number>;
  total: number;
}

export interface TrendModel {
  grain: Grain;
  by: SplitBy;
  keys: readonly string[];
  range: DateRange;
  slots: TrendSlot[];
}

export function trendModel(ctx: DashCtx, grain: Grain, by: SplitBy): TrendModel | null {
  const eff = ctx.win.effective;
  const range = grain === 'month' ? contextRange(ctx) : eff;
  if (!range) return null;
  const base = { rows: ctx.scope.kpiRows, range, dataRange: ctx.coverage, areaIds: ctx.base.areaIds, attribution: ctx.scope.attribution, notUploaded: ctx.notUploaded };
  const keys = by === 'type' ? TYPE_KEYS : CLASS_KEYS;
  let slots: TrendSlot[];
  if (grain === 'month') {
    if (by === 'type') {
      slots = monthlyOver(ctx, range).map((m) => ({ ...monthSlot(ctx, m), values: { inc: m.failureHours, pl: m.plannedHours, cir: m.otherHours }, total: m.failureHours + m.plannedHours + m.otherHours }));
    } else {
      slots = monthlyHoursByClassification(base).map((m) => ({ ...monthSlot(ctx, m), values: { ...m.hours }, total: m.total }));
    }
  } else if (by === 'type') {
    slots = daily(ctx).map((d) => ({ ...daySlot(d), values: { inc: d.failureHours, pl: d.plannedHours, cir: d.otherHours }, total: d.downtimeHours }));
  } else {
    slots = dailyHoursByClassification(base).map((d) => ({ ...daySlot(d), values: { ...d.hours }, total: d.total }));
  }
  return { grain, by, keys, range, slots };
}

function daySlot(d: Pick<DayPoint, 'date' | 'hasData' | 'notUploaded'>): Slot {
  return { key: d.date, status: d.hasData ? 'full' : d.notUploaded ? 'notUploaded' : 'noData', window: d.hasData ? { from: d.date, to: d.date } : null, inPeriod: true };
}

export interface SlotChange {
  /** current minus previous (per day with data when either slot is partial) */
  abs: number;
  /** percent change; null when the previous value is 0 */
  pct: number | null;
  perDay: boolean;
}

/** Change of one value against the previous slot with data; per day when either slot is a partial month. Null without a previous slot. */
export function slotChange(prev: TrendSlot | undefined, cur: TrendSlot, key: string | 'total'): SlotChange | null {
  if (!prev || !hasValues(prev.status) || !hasValues(cur.status) || !prev.window || !cur.window) return null;
  const perDay = prev.status === 'partial' || cur.status === 'partial';
  const v = (s: TrendSlot) => (key === 'total' ? s.total : s.values[key] ?? 0) / (perDay ? daysInRange(s.window!) : 1);
  const a = v(cur);
  const b = v(prev);
  return { abs: a - b, pct: b > 0 ? ((a - b) / b) * 100 : null, perDay };
}

// ---------------------------------------------------------------- (3) what kind of stoppage

/** Stopped hours of the period per classification (by row, overlaps owned once): sums to the KPI type split. */
export function classHours(ctx: DashCtx): { hours: Record<string, number>; total: number } | null {
  const eff = ctx.win.effective;
  if (!eff) return null;
  const pts = monthlyHoursByClassification({ rows: ctx.scope.kpiRows, range: eff, dataRange: ctx.coverage, areaIds: ctx.base.areaIds, attribution: ctx.scope.attribution, notUploaded: ctx.notUploaded });
  const hours: Record<string, number> = Object.fromEntries(CLASS_KEYS.map((c) => [c, 0]));
  for (const p of pts) for (const c of CLASS_KEYS) hours[c]! += p.hours[c];
  return { hours, total: CLASS_KEYS.reduce((s, c) => s + hours[c]!, 0) };
}

// ---------------------------------------------------------------- (4) where we lost the most time

export type LossDim = 'equipment' | 'reason' | 'area' | 'line';

export interface LossModel {
  dim: LossDim;
  measure: ParetoMeasure;
  /** the complete Pareto (every item; shares against its total) */
  all: ParetoResult;
  /** the first n items */
  top: ParetoBar[];
  /** cumulative share of the shown items, percent */
  topSharePct: number;
  /** items needed to reach 80 % of the complete total (null when there is nothing) */
  need80: number | null;
  /** the events of the shown items (what 'Open records' opens) */
  ids: string[];
}

export function lossModel(ctx: DashCtx, dim: LossDim, measure: ParetoMeasure, n = 10): LossModel | null {
  let all: ParetoResult | null = null;
  if (dim === 'equipment') all = equipmentModel(ctx)?.[measure].own ?? null;
  else if (dim === 'reason') all = reasonModel(ctx, false)?.[measure] ?? null;
  else if (dim === 'area') all = areaModel(ctx, measure);
  else all = lineModel(ctx, measure);
  if (!all) return null;
  const top = all.bars.filter((b) => !b.isOthers).slice(0, n);
  return {
    dim, measure, all, top,
    topSharePct: top.length ? top[top.length - 1]!.cumulativePct : 0,
    need80: paretoNeed(all),
    ids: [...new Set(top.flatMap((b) => b.eventIds))],
  };
}

/** Items of a complete Pareto needed to reach its reference share (80 %); null when nothing reaches it. */
export function paretoNeed(all: Pick<ParetoResult, 'bars' | 'referencePct'>): number | null {
  const named = all.bars.filter((b) => !b.isOthers);
  const i = named.findIndex((b) => b.cumulativePct >= all.referencePct - 1e-9);
  return i < 0 ? null : i + 1;
}

/**
 * The honest Pareto line: 'Top 10 = 38% of failure hours · 80% needs 41 items' (never 'the first 11 bars reach 80%'
 * for a chart that shows ten). With fewer items than n: 'All 7 items = 100% · 80% needs 3 items'.
 */
export function paretoHonestText(all: Pick<ParetoResult, 'bars' | 'referencePct' | 'entryCount'>, n: number, what: string): string {
  const named = all.bars.filter((b) => !b.isOthers);
  if (named.length === 0) return '';
  const shown = Math.min(n, named.length);
  const share = named[shown - 1]!.cumulativePct;
  const need = paretoNeed(all);
  const head = all.entryCount <= n ? `All ${all.entryCount} = 100% of ${what}` : `Top ${shown} = ${fmtPct0(share)} of ${what}`;
  return need === null ? head : `${head} · ${all.referencePct}% needs ${need} ${need === 1 ? 'item' : 'items'}`;
}

const fmtPct0 = (p: number): string => `${Math.round(p)}%`;

// ---------------------------------------------------------------- (5) planned or incidental, per line

export interface TypeSplit { key: string; label: string; inc: number; pl: number; cir: number; total: number }

/** Stopped hours by type per line (lines of the areas in scope, in master order) and for all lines: sums of the area KPIs. */
export function lineSplit(ctx: DashCtx): { lines: TypeSplit[]; all: TypeSplit } | null {
  const k = ctx.kpis.current;
  if (k.status !== 'ok') return null;
  const byLine = new Map<string, TypeSplit>();
  for (const a of k.areas) {
    const line = ctx.master.index.areaById.get(a.area_id)?.line_id ?? '';
    const cur = byLine.get(line) ?? { key: line, label: line || '-', inc: 0, pl: 0, cir: 0, total: 0 };
    cur.inc += a.failureHours; cur.pl += a.plannedHours; cur.cir += a.otherHours; cur.total += a.downtimeHours;
    byLine.set(line, cur);
  }
  const order = [...ctx.master.lineNames.keys()];
  const lines = [...byLine.values()].sort((a, b) => (order.indexOf(a.key) + 1 || 999) - (order.indexOf(b.key) + 1 || 999) || a.key.localeCompare(b.key));
  const t = k.total;
  return { lines, all: { key: 'all', label: 'All', inc: t.failureHours, pl: t.plannedHours, cir: t.otherHours, total: t.downtimeHours } };
}

// ---------------------------------------------------------------- (6) downtime by area

export interface AreaSplit extends TypeSplit { name: string }

/** Stopped hours by type per area, largest total first (by total hours). */
export function areaSplit(ctx: DashCtx): AreaSplit[] {
  const k = ctx.kpis.current;
  if (k.status !== 'ok') return [];
  return k.areas
    .map((a) => ({ key: a.area_id, label: a.area_id, name: areaName(ctx, a.area_id), inc: a.failureHours, pl: a.plannedHours, cir: a.otherHours, total: a.downtimeHours }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

/** The area's name when it says more than its id ('Kiln 2' for K.2), else ''. */
export function areaName(ctx: Pick<DashCtx, 'master'>, id: string): string {
  const n = ctx.master.index.areaById.get(id)?.name?.trim() ?? '';
  return n && n.toUpperCase() !== id.toUpperCase() ? n : '';
}

// ---------------------------------------------------------------- (7) availability by area against the target

export interface AreaAvail {
  area_id: string;
  name: string;
  /** percent, null when it cannot be calculated */
  pct: number | null;
  reason?: string;
  status: TargetStatus | null;
  /** the target this area is judged against (its own or the plant-wide one), percent or null */
  target?: number | null;
  /** the area has its own target for the year */
  ownTarget?: boolean;
}

export interface AreaAvailModel {
  rows: AreaAvail[];
  /** percent or null (no target set) */
  target: number | null;
  /** areas below the target, and the areas judged */
  below: number;
  judged: number;
  overall: number | null;
}

/** Availability (settings basis) per area, worst first; areas without a figure last. */
/** `perArea`: availability targets of single areas for the year (Settings › Actions & targets); the others use the plant-wide one. */
export function areaAvailability(ctx: DashCtx, perArea?: ReadonlyMap<string, number> | null): AreaAvailModel | null {
  const k = ctx.kpis.current;
  if (k.status !== 'ok') return null;
  const targets = getTargets(ctx.master.settings);
  const rows = k.areas.map((a) => {
    const m = a.availabilityHeadline;
    const tg = targetsOfArea(targets, perArea, a.area_id);
    return {
      area_id: a.area_id, name: areaName(ctx, a.area_id), pct: m.available ? m.value * 100 : null, reason: m.available ? undefined : m.reason,
      status: m.available ? targetStatus('availability', m.value, tg) : null, target: tg.availabilityPct, ownTarget: perArea?.has(a.area_id) ?? false,
    };
  }).sort((a, b) => (a.pct ?? Infinity) - (b.pct ?? Infinity) || a.area_id.localeCompare(b.area_id));
  const judged = rows.filter((r) => r.status);
  const o = k.total.availabilityHeadline;
  return { rows, target: targets.availabilityPct, below: judged.filter((r) => !r.status!.ok).length, judged: judged.length, overall: o.available ? o.value * 100 : null };
}

// ---------------------------------------------------------------- (8) failures and MTTR by month

export interface FailMonth extends Slot { failures: number | null; mttr: number | null }

export function failuresByMonth(ctx: DashCtx): { months: FailMonth[]; range: DateRange } | null {
  const r = yearToPeriodRange(ctx);
  if (!r) return null;
  return {
    range: r,
    months: monthlyOver(ctx, r).map((m) => ({ ...monthSlot(ctx, m), failures: m.hasData ? m.failureCount : null, mttr: num(m.mttrHours) })),
  };
}

// ---------------------------------------------------------------- (10) what keeps failing again

export interface RepeatsTop {
  /** the first n groups (at least two occurrences in the range), most occurrences first */
  groups: RepeatGroup[];
  /** every listed group (the Repeated failures page lists the same) */
  listed: number;
  /** distinct failure events of the listed groups and their hours in the window (as the KPIs count them) */
  events: number;
  hours: number;
  /** all failure hours in the window (the KPI) */
  failureHours: number;
  bursts: number;
  ids: string[];
  window: DateRange;
}

export function repeatsTop(ctx: DashCtx, n = 5): RepeatsTop | null {
  const window = ctx.win.effective;
  const k = ctx.kpis.current;
  if (!window || k.status !== 'ok') return null;
  const res = findRepeatedFailures(ctx.scope.failureChains, {
    settings: ctx.master.settings, window, previousWindow: ctx.win.compareRange ?? undefined, lookup: ctx.master.index,
  });
  const shared = listedRepeats(res);
  const listed = [...shared.groups].sort((a, b) => b.occurrences - a.occurrences || b.totalHours - a.totalHours || a.key.localeCompare(b.key));
  const ids = shared.eventIds;
  const want = new Set(ids);
  const w = rangeToInterval(window);
  let hours = 0;
  for (const c of ctx.scope.failureChains) if (want.has(c.id)) hours += chainHours(c, w, ctx.scope.attribution);
  return {
    groups: listed.slice(0, n), listed: listed.length, events: ids.length, hours, failureHours: k.total.failureHours,
    bursts: listed.reduce((s, g) => s + g.burstCount, 0), ids, window,
  };
}

// ---------------------------------------------------------------- (11) availability / RF / UF heat map, area x month

/** 'ok' at or above the target, 'near' within 5 points below it, 'below' further down; null when no target is set. */
export type HeatTone = 'ok' | 'near' | 'below';
export const NEAR_POINTS = 5;

/** What the heat map shows: availability (settings basis), the reliability factor or the utilization factor. */
export type HeatMetric = 'availability' | 'reliability' | 'utilization';

/** The target a heat-map metric is coloured against, in percent (null = none). */
export function heatTarget(targets: Pick<Targets, 'availabilityPct'> & Partial<Pick<Targets, 'reliabilityPct' | 'utilizationPct'>>, metric: HeatMetric = 'availability'): number | null {
  return metric === 'availability' ? targets.availabilityPct : metric === 'reliability' ? targets.reliabilityPct ?? null : targets.utilizationPct ?? null;
}

export function heatTone(frac: number | null, targets: Pick<Targets, 'availabilityPct'> & Partial<Pick<Targets, 'reliabilityPct' | 'utilizationPct'>>, metric: HeatMetric = 'availability'): HeatTone | null {
  const target = heatTarget(targets, metric);
  if (frac === null || target === null) return null;
  const s = targetStatus('availability', frac, { availabilityPct: target, mtbfH: null, mttrH: null })!;
  return s.ok ? 'ok' : s.gap >= -NEAR_POINTS ? 'near' : 'below';
}

export interface HeatCell { pct: number | null; status: SlotStatus; tone: HeatTone | null }
export interface HeatModel {
  months: Slot[];
  /** worst first, by the last month of the period with a value */
  rows: { area_id: string; name: string; cells: HeatCell[] }[];
  /** the month the rows are sorted by (null when no month of the period has data) */
  sortMonth: string | null;
  target: number | null;
  range: DateRange;
  metric: HeatMetric;
}

/** `own`: targets of single areas for the year (Settings › Actions & targets); each row is coloured against its own one. */
export function availabilityHeat(ctx: DashCtx, metric: HeatMetric = 'availability', own?: ReadonlyMap<string, OwnTargets> | null): HeatModel | null {
  const range = contextRange(ctx);
  const eff = ctx.win.effective;
  if (!range || !eff) return null;
  // each cell is that area's monthly series (the same as the area's KPI for the month)
  const targets = getTargets(ctx.master.settings);
  const am = areaMonthAvailability({
    rows: ctx.scope.kpiRows, chains: ctx.scope.chains, range, dataRange: ctx.coverage, areaIds: ctx.base.areaIds,
    settings: ctx.master.settings, attribution: ctx.scope.attribution, notUploaded: ctx.notUploaded,
  });
  const months: Slot[] = am.months.map((m) => monthSlot(ctx, { ...m, hasData: !!m.window }));
  const rows = am.areas.map((a) => ({
    area_id: a.area_id, name: areaName(ctx, a.area_id),
    cells: (metric === 'reliability' ? a.reliability : metric === 'utilization' ? a.utilization : a.values).map((v, i) => {
      const x = num(v);
      return { pct: x === null ? null : x * 100, status: months[i]!.status, tone: heatTone(x, targetsOfArea(targets, own, a.area_id), metric) };
    }),
  }));
  // sort by the last month of the period that has values (worst first)
  const sortIdx = [...months.keys()].filter((i) => months[i]!.inPeriod && hasValues(months[i]!.status) && months[i]!.key <= eff.to.slice(0, 7)).pop() ?? -1;
  if (sortIdx >= 0) rows.sort((a, b) => (a.cells[sortIdx]!.pct ?? Infinity) - (b.cells[sortIdx]!.pct ?? Infinity) || a.area_id.localeCompare(b.area_id));
  return { months, rows, sortMonth: sortIdx >= 0 ? months[sortIdx]!.key : null, target: heatTarget(targets, metric), range, metric };
}

// ---------------------------------------------------------------- (12) which days were worst

/** The last n days of the period (the phone view), never more than the period. */
export function lastDays<T>(days: T[], n: number): T[] {
  return days.length <= n ? days : days.slice(days.length - n);
}

/**
 * Runs of at least two consecutive days where planned (PL) hours are most of the day and the day is above the
 * period's median: named on the chart as 'Mostly planned 12–14 Aug' (the label says what the bars show, no guess).
 */
export function plannedRuns(days: Pick<DayPoint, 'date' | 'hasData' | 'plannedHours' | 'downtimeHours'>[], minShare = 0.6): { from: string; to: string }[] {
  const withData = days.filter((d) => d.hasData).map((d) => d.downtimeHours).sort((a, b) => a - b);
  const median = withData.length ? withData[withData.length >> 1]! : 0;
  const out: { from: string; to: string }[] = [];
  let run: string[] = [];
  const flush = () => { if (run.length >= 2) out.push({ from: run[0]!, to: run[run.length - 1]! }); run = []; };
  for (const d of days) {
    if (d.hasData && d.downtimeHours > median && d.plannedHours >= minShare * d.downtimeHours) run.push(d.date); else flush();
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- scope footer

/** 'Aug 2026', 'Jan – Oct 2026', '1–12 Oct 2026' or the dates. */
export function periodText(r: DateRange): string {
  const full = (from: string, to: string) => from.endsWith('-01') && to === lastDayOfMonth(to.slice(0, 7));
  if (r.from.slice(0, 7) === r.to.slice(0, 7)) return full(r.from, r.to) ? monthText(r.from) : rangeText(r);
  if (r.from.endsWith('-01') && monthsOfRange(r).length > 1) {
    const a = r.from.slice(0, 4) === r.to.slice(0, 4) ? monthShort(r.from) : monthText(r.from);
    return `${a} – ${monthText(r.to)}`;
  }
  return rangeText(r);
}

/** 'Aug 2026 · All lines · All areas · Incidental': the period, line, area and type the card shows. */
export function scopeText(r: DateRange, f: Pick<DashFilters, 'lineIds' | 'areaIds' | 'equipmentIds' | 'classifications' | 'failureOnly'>, type: 'all' | 'failures' | 'none' = 'all'): string {
  const lines = f.lineIds.length === 0 ? 'All lines' : f.lineIds.length === 1 ? f.lineIds[0]! : `${f.lineIds.length} lines`;
  const areas = f.areaIds.length === 0 ? 'All areas' : f.areaIds.length === 1 ? f.areaIds[0]! : `${f.areaIds.length} areas`;
  const parts = [periodText(r), lines, areas];
  if (f.equipmentIds.length) parts.push(f.equipmentIds.length === 1 ? f.equipmentIds[0]! : `${f.equipmentIds.length} codes`);
  const cls = f.classifications.length ? f.classifications.join('+') : '';
  if (type === 'failures') parts.push(cls ? `Incidental ${cls}` : 'Incidental');
  else if (type === 'all') parts.push(cls || (f.failureOnly ? 'Failures only' : 'All types'));
  return parts.join(' · ');
}

/** 'vs Jul' when the comparison is one calendar month, else the long wording. */
export function compareShort(ctx: Pick<DashCtx, 'win'>): string {
  const c = ctx.win.compareRange;
  if (!c) return '';
  if (c.from.endsWith('-01') && c.from.slice(0, 7) === c.to.slice(0, 7) && c.to === lastDayOfMonth(c.to.slice(0, 7))) return `vs ${monthShort(c.from)}`;
  return ctx.win.compare === 'same_period_last_year' ? 'vs same period last year' : 'vs previous period';
}
