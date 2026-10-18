/**
 * Per-area reliability views built from figures that already exist (AreaKpis), so every number equals the
 * "By area" table. MTBF, MTTR and the failure rate are area-level figures: they are ranked and plotted per area,
 * and the all-area value is the area-hours aggregate (total failures over total operating hours), never an
 * average of the area figures.
 */
import type { EventRow } from '../api/types';
import type { ChainedEvent } from './events';
import type { AreaKpis } from './kpis';
import type { Metric } from './metric';
import { notUploadedMonths } from './kpis';
import { monthlySeries, type MonthlyInput } from './trends';
import type { DateRange } from './time';

export interface AreaRank {
  area_id: string;
  /** null when the metric is not available */
  value: number | null;
  /** why there is no value: 'no_failures' or another unavailable code */
  code: string | null;
  reason: string | null;
}

/**
 * One entry per area, ranked by `pick`. `asc`: smallest first (MTBF, worst first); `desc`: largest first (MTTR,
 * failure rate). Areas without a value (no failures, no exposure) come last, in the order given.
 */
export function rankAreas(areas: AreaKpis[], pick: (a: AreaKpis) => Metric, order: 'asc' | 'desc'): AreaRank[] {
  const ranks: AreaRank[] = areas.map((a) => {
    const m = pick(a);
    return m.available ? { area_id: a.area_id, value: m.value, code: null, reason: null } : { area_id: a.area_id, value: null, code: m.code, reason: m.reason };
  });
  const dir = order === 'asc' ? 1 : -1;
  return ranks
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      if (x.r.value === null || y.r.value === null) return x.r.value === y.r.value ? x.i - y.i : x.r.value === null ? 1 : -1;
      return (x.r.value - y.r.value) * dir || x.i - y.i;
    })
    .map((x) => x.r);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export type Quadrant = 'worst' | 'frequent_quick' | 'rare_long' | 'best' | 'on_median';

export interface QuadrantPoint {
  area_id: string;
  /** x: MTBF, hours */
  mtbf: number;
  /** y: MTTR, hours */
  mttr: number;
  failureEvents: number;
  failures: number;
  quadrant: Quadrant;
}

export interface QuadrantResult {
  points: QuadrantPoint[];
  /** areas left out: no failures (or no exposure), so MTBF or MTTR is not defined */
  excluded: { area_id: string; reason: string }[];
  /** null with fewer than two points: a median of one area says nothing */
  medianMtbf: number | null;
  medianMttr: number | null;
  /** areas in the worst quadrant: MTBF below its median and MTTR above its median */
  worst: string[];
}

/**
 * MTBF against MTTR per area. The medians of the plotted areas split the plane in four. Worst = lower MTBF and
 * higher MTTR than the median (strictly: an area on a median line is in no quadrant, `on_median`).
 */
export function mtbfMttrQuadrants(areas: AreaKpis[]): QuadrantResult {
  const pts: Omit<QuadrantPoint, 'quadrant'>[] = [];
  const excluded: QuadrantResult['excluded'] = [];
  for (const a of areas) {
    if (a.mtbfHours.available && a.mttrHours.available) {
      pts.push({ area_id: a.area_id, mtbf: a.mtbfHours.value, mttr: a.mttrHours.value, failureEvents: a.failureEventCount, failures: a.failureCount });
    } else {
      const m = !a.mtbfHours.available ? a.mtbfHours : a.mttrHours;
      excluded.push({ area_id: a.area_id, reason: m.available ? '' : m.reason });
    }
  }
  const enough = pts.length >= 2;
  const medianMtbf = enough ? median(pts.map((p) => p.mtbf)) : null;
  const medianMttr = enough ? median(pts.map((p) => p.mttr)) : null;
  const points: QuadrantPoint[] = pts.map((p) => {
    let quadrant: Quadrant = 'on_median';
    if (medianMtbf !== null && medianMttr !== null && p.mtbf !== medianMtbf && p.mttr !== medianMttr) {
      const lowMtbf = p.mtbf < medianMtbf;
      const highMttr = p.mttr > medianMttr;
      quadrant = lowMtbf && highMttr ? 'worst' : lowMtbf ? 'frequent_quick' : highMttr ? 'rare_long' : 'best';
    }
    return { ...p, quadrant };
  });
  return { points, excluded, medianMtbf, medianMttr, worst: points.filter((p) => p.quadrant === 'worst').map((p) => p.area_id) };
}

export interface AreaMonthAvailability {
  months: { month: string; partial: boolean; window: DateRange | null; notUploaded: boolean }[];
  /** one row per area in the order given; one availability metric per month (unavailable = no data: a gap) */
  areas: { area_id: string; values: Metric[]; reliability: Metric[]; utilization: Metric[] }[];
}

/**
 * Availability (the headline basis from the settings) of every area for every month of the range. Each cell is the
 * monthly series of that one area, so a single-month range equals the area's KPI for that month.
 */
export function areaMonthAvailability(input: MonthlyInput & { areaIds: string[]; rows: EventRow[] }): AreaMonthAvailability {
  const rowsBy = new Map<string, EventRow[]>();
  for (const r of input.rows) {
    const l = rowsBy.get(r.area_id);
    if (l) l.push(r); else rowsBy.set(r.area_id, [r]);
  }
  const chainsBy = new Map<string, ChainedEvent[]>();
  for (const c of input.chains ?? []) {
    const l = chainsBy.get(c.area_id);
    if (l) l.push(c); else chainsBy.set(c.area_id, [c]);
  }
  let months: AreaMonthAvailability['months'] = [];
  const areas = input.areaIds.map((area_id) => {
    const pts = monthlySeries({
      rows: rowsBy.get(area_id) ?? [], chains: input.chains ? chainsBy.get(area_id) ?? [] : undefined, range: input.range,
      dataRange: input.dataRange, areaIds: [area_id], settings: input.settings, attribution: input.attribution,
      // months not uploaded are plant-wide: never re-derive them from one area's rows
      notUploaded: input.notUploaded ?? (input.dataRange === undefined ? notUploadedMonths(input.rows) : []),
    });
    if (months.length === 0) months = pts.map((p) => ({ month: p.month, partial: p.partial, window: p.window, notUploaded: p.notUploaded }));
    const of = (k: 'reliabilityFactor' | 'utilizationFactor') => pts.map((p) => (p.hasData && p.kpis ? p.kpis[k] : p.availability));
    return { area_id, values: pts.map((p) => p.availability), reliability: of('reliabilityFactor'), utilization: of('utilizationFactor') };
  });
  return { months, areas };
}
