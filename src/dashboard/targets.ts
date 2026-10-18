// Targets (all optional; blank = off) and the status of a figure against its target. Pure: no React.
//  - availability, the reliability factor and MTBF want to be AT LEAST the target ("On target" / "Below target"),
//  - MTTR wants to be AT MOST the target ("On target" / "Above target").
// A figure is judged as it is shown (availability to 0.1 points, MTBF to 0.1 h, MTTR to 0.01 h), so a card that reads
// "95.0%" is never "below" a 95% target. Nothing is produced for a target that is off or a figure that is unavailable.
import type { AreaKpis, CalcSettings, Metric } from '../calc';
import { t } from '../i18n/t';

export interface Targets { availabilityPct: number | null; mtbfH: number | null; mttrH: number | null; reliabilityPct?: number | null; utilizationPct?: number | null }

export type TargetMetric = 'availability' | 'reliability' | 'utilization' | 'mtbf' | 'mttr';

/** The targets from the parsed settings; null = off. */
export function getTargets(settings: Pick<CalcSettings, 'availabilityTargetPct' | 'targetMtbfH' | 'targetMttrH'> & Partial<Pick<CalcSettings, 'reliabilityTargetPct' | 'utilizationTargetPct'>>): Targets {
  return {
    availabilityPct: settings.availabilityTargetPct ?? null, mtbfH: settings.targetMtbfH ?? null, mttrH: settings.targetMttrH ?? null,
    reliabilityPct: settings.reliabilityTargetPct ?? null, utilizationPct: settings.utilizationTargetPct ?? null,
  };
}

export const anyTarget = (t: Targets): boolean => t.availabilityPct !== null || t.mtbfH !== null || t.mttrH !== null || (t.reliabilityPct ?? null) !== null || (t.utilizationPct ?? null) !== null;

export interface TargetStatus {
  metric: TargetMetric;
  /** availability: percent; MTBF and MTTR: hours */
  target: number;
  /** the figure in the same unit as the target (availability in percent), rounded as shown */
  value: number;
  unit: '%' | 'h';
  ok: boolean;
  /** value - target in the same unit (percentage points or hours), rounded as shown */
  gap: number;
  /** 'on' | 'below' (availability, MTBF) | 'above' (MTTR) */
  state: 'on' | 'below' | 'above';
}

/** Decimals a figure is shown with. */
const DECIMALS: Record<TargetMetric, number> = { availability: 1, reliability: 1, utilization: 1, mtbf: 1, mttr: 2 };
const round = (n: number, d: number): number => Math.round((n + Number.EPSILON * Math.sign(n)) * 10 ** d) / 10 ** d;

/**
 * The status of a figure against its target, or null when there is no target or no figure.
 * `value`: availability and reliability factor as a fraction (0 to 1, as a Metric holds it); MTBF and MTTR in hours.
 */
export function targetStatus(metric: TargetMetric, value: number | null | undefined, targets: Targets): TargetStatus | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const target = metric === 'availability' ? targets.availabilityPct : metric === 'reliability' ? (targets.reliabilityPct ?? null) : metric === 'utilization' ? (targets.utilizationPct ?? null) : metric === 'mtbf' ? targets.mtbfH : targets.mttrH;
  if (target === null || target === undefined) return null;
  const d = DECIMALS[metric];
  const pct = metric === 'availability' || metric === 'reliability' || metric === 'utilization';
  const shown = round(pct ? value * 100 : value, d);
  const gap = round(shown - target, d);
  const wantsHigh = metric !== 'mttr';
  const ok = wantsHigh ? shown >= target : shown <= target;
  return { metric, target, value: shown, unit: pct ? '%' : 'h', ok, gap, state: ok ? 'on' : wantsHigh ? 'below' : 'above' };
}

/** The same for a Metric (unavailable -> null). */
export function metricStatus(metric: TargetMetric, m: Metric, targets: Targets): TargetStatus | null {
  return targetStatus(metric, m.available ? m.value : null, targets);
}

export interface KpiTargetStatuses { availability: TargetStatus | null; reliability?: TargetStatus | null; utilization?: TargetStatus | null; mtbf: TargetStatus | null; mttr: TargetStatus | null }

/** Availability (settings basis), reliability factor, MTBF and MTTR of one KPI set against the targets. */
export function kpiTargetStatuses(k: Pick<AreaKpis, 'availabilityHeadline' | 'mtbfHours' | 'mttrHours'> & Partial<Pick<AreaKpis, 'reliabilityFactor' | 'utilizationFactor'>>, targets: Targets): KpiTargetStatuses {
  return {
    availability: metricStatus('availability', k.availabilityHeadline, targets),
    reliability: k.reliabilityFactor ? metricStatus('reliability', k.reliabilityFactor, targets) : null,
    utilization: k.utilizationFactor ? metricStatus('utilization', k.utilizationFactor, targets) : null,
    mtbf: metricStatus('mtbf', k.mtbfHours, targets),
    mttr: metricStatus('mttr', k.mttrHours, targets),
  };
}

/** The targets one area has for the year (Settings › Actions & targets); a missing one falls back to the plant-wide target. */
export interface OwnTargets { availability?: number; reliability?: number; utilization?: number }

/**
 * The targets an area is judged against: its own for the year when it has one, else the plant-wide ones. `perArea` is
 * either the availability targets alone (number per area) or all own targets of the area.
 */
export function targetsOfArea(targets: Targets, perArea: ReadonlyMap<string, number | OwnTargets> | null | undefined, areaId: string): Targets {
  const own = perArea?.get(areaId);
  if (own === undefined) return targets;
  if (typeof own === 'number') return { ...targets, availabilityPct: own };
  return {
    ...targets,
    ...(own.availability !== undefined ? { availabilityPct: own.availability } : {}),
    ...(own.reliability !== undefined ? { reliabilityPct: own.reliability } : {}),
    ...(own.utilization !== undefined ? { utilizationPct: own.utilization } : {}),
  };
}

/** Per area (by area id). Areas without a figure or without a target have null entries. `perArea`: availability targets per area. */
export function areaTargetStatuses(areas: readonly (Pick<AreaKpis, 'area_id' | 'availabilityHeadline' | 'mtbfHours' | 'mttrHours'> & Partial<Pick<AreaKpis, 'reliabilityFactor' | 'utilizationFactor'>>)[], targets: Targets, perArea?: ReadonlyMap<string, number | OwnTargets> | null): Map<string, KpiTargetStatuses> {
  return new Map(areas.map((a) => [a.area_id, kpiTargetStatuses(a, targetsOfArea(targets, perArea, a.area_id))]));
}

/** "N of M areas below target": areas with a figure are counted; null when the availability target is off. */
export function belowTargetCount(areas: readonly { area_id: string; availability: Metric }[], targets: Targets): { below: string[]; total: number } | null {
  if (targets.availabilityPct === null) return null;
  const judged = areas.map((a) => ({ id: a.area_id, s: metricStatus('availability', a.availability, targets) })).filter((x) => x.s);
  return { below: judged.filter((x) => !x.s!.ok).map((x) => x.id), total: judged.length };
}

const MINUS = '−';

/** Number of a target as typed ("95", "92.5", "120"). */
export const targetNumber = (n: number): string => String(n);

/** The target with its unit: "95%", "120 h". */
export const targetWithUnit = (s: Pick<TargetStatus, 'target' | 'unit'>): string => (s.unit === '%' ? `${targetNumber(s.target)}%` : `${targetNumber(s.target)} h`);

/** Signed gap with unit: "+1.2 pts", "−0.4 h". */
export function gapText(s: TargetStatus): string {
  const d = DECIMALS[s.metric];
  const sign = s.gap > 0 ? '+' : s.gap < 0 ? MINUS : '';
  return `${sign}${Math.abs(s.gap).toFixed(d)} ${s.unit === '%' ? t('pts') : 'h'}`;
}

/** "On target", "Below target" or "Above target". */
export const stateWords = (s: Pick<TargetStatus, 'state'>): string => (s.state === 'on' ? t('On target') : s.state === 'below' ? t('Below target') : t('Above target'));

/** One line: "Target 95%: on target (+1.2 pts)". */
export function statusLine(s: TargetStatus): string {
  return t('Target {x}: {w} ({g})', { x: targetWithUnit(s), w: stateWords(s).toLowerCase(), g: gapText(s) });
}
