// Dashboard filter state: one shape shared by the four dashboard tabs, kept in
// the URL query (so reload and drill-through work). Pure: no React, no storage.
import type { ClassificationCode, Criticality } from '../api/types';
import {
  addDays, addMonthsToKey, emptyFilter, lastDayOfMonth, monthKey, monthRange,
  type CalcSettings, type ComparisonKind, type DateRange, type DurationBand, type Filter,
} from '../calc';
import { CLASSIFICATION_CODES, matchKey } from '../calc';

export type RangePreset = 'last7' | 'last30' | 'last90' | 'ytd' | 'thismonth' | 'prevmonth' | 'year' | 'month' | 'custom';
export const RANGE_PRESETS: RangePreset[] = ['last7', 'last30', 'last90', 'ytd', 'thismonth', 'prevmonth', 'year', 'month', 'custom'];
export const DEFAULT_PRESET: RangePreset = 'last90';

export type CompareMode = ComparisonKind | 'none';

export interface DashFilters {
  lineIds: string[];
  areaIds: string[];
  equipmentIds: string[];
  equipmentTypes: string[];
  preset: RangePreset;
  /** year picker (preset 'year') */
  year: number | null;
  /** month picker, YYYY-MM (preset 'month') */
  month: string | null;
  /** custom range */
  from: string;
  to: string;
  classifications: ClassificationCode[];
  criticality: Criticality[];
  failureOnly: boolean;
  /** reason match keys */
  reasonKeys: string[];
  durationBand: DurationBand | null;
  /** null = the setting's default comparison */
  compare: CompareMode | null;
}

export function defaultFilters(): DashFilters {
  return {
    lineIds: [], areaIds: [], equipmentIds: [], equipmentTypes: [], preset: DEFAULT_PRESET, year: null, month: null,
    from: '', to: '', classifications: [], criticality: [], failureOnly: false, reasonKeys: [], durationBand: null, compare: null,
  };
}

const KEYS = ['line', 'area', 'code', 'type', 'r', 'y', 'm', 'from', 'to', 'cls', 'crit', 'fail', 'reason', 'band', 'cmp'] as const;

/** The parameters of a query that are NOT dashboard filters (for example the month pair of Month vs month); filter changes keep them. */
export function nonFilterParams(sp: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  sp.forEach((v, k) => { if (!(KEYS as readonly string[]).includes(k)) out.append(k, v); });
  return out;
}

/** Does this query carry any dashboard filter? */
export function hasFilterParams(sp: URLSearchParams): boolean {
  return KEYS.some((k) => sp.has(k));
}

/** Remove the dashboard keys from a query (other keys are kept). */
export function stripFilterParams(sp: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(sp);
  for (const k of KEYS) out.delete(k);
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const uniq = (xs: string[]): string[] => [...new Set(xs.filter((x) => x !== ''))];

export function parseFilters(sp: URLSearchParams): DashFilters {
  const d = defaultFilters();
  // an old Event Explorer link or saved view has from / to without a preset: that is a custom range
  const legacyCustom = !sp.has('r') && (DATE_RE.test(sp.get('from') ?? '') || DATE_RE.test(sp.get('to') ?? ''));
  const preset = (legacyCustom ? 'custom' : sp.get('r')) as RangePreset | null;
  const year = Number(sp.get('y'));
  const month = sp.get('m') ?? '';
  const band = sp.get('band');
  const cmp = sp.get('cmp');
  return {
    ...d,
    lineIds: uniq(sp.getAll('line')),
    areaIds: uniq(sp.getAll('area')),
    equipmentIds: uniq(sp.getAll('code')),
    equipmentTypes: uniq(sp.getAll('type')),
    preset: preset && RANGE_PRESETS.includes(preset) ? preset : d.preset,
    year: Number.isInteger(year) && year > 1990 && year < 2200 ? year : null,
    month: MONTH_RE.test(month) ? month : null,
    from: DATE_RE.test(sp.get('from') ?? '') ? sp.get('from')! : '',
    to: DATE_RE.test(sp.get('to') ?? '') ? sp.get('to')! : '',
    classifications: uniq(sp.getAll('cls')).filter((c): c is ClassificationCode => (CLASSIFICATION_CODES as string[]).includes(c)),
    criticality: uniq(sp.getAll('crit')).filter((c): c is Criticality => c === 'INC' || c === 'NO_INC'),
    failureOnly: sp.get('fail') === '1',
    reasonKeys: uniq(sp.getAll('reason')),
    durationBand: band === 'short' || band === 'medium' || band === 'long' ? band : null,
    compare: cmp === 'previous_period' || cmp === 'same_period_last_year' || cmp === 'none' ? cmp : null,
  };
}

/** Only non-default values are written, so a default view has an empty query. */
export function serializeFilters(f: DashFilters): URLSearchParams {
  const sp = new URLSearchParams();
  f.lineIds.forEach((v) => sp.append('line', v));
  f.areaIds.forEach((v) => sp.append('area', v));
  f.equipmentIds.forEach((v) => sp.append('code', v));
  f.equipmentTypes.forEach((v) => sp.append('type', v));
  if (f.preset !== DEFAULT_PRESET) sp.set('r', f.preset);
  if (f.preset === 'year' && f.year !== null) sp.set('y', String(f.year));
  if (f.preset === 'month' && f.month) sp.set('m', f.month);
  if (f.preset === 'custom') {
    if (f.from) sp.set('from', f.from);
    if (f.to) sp.set('to', f.to);
  }
  f.classifications.forEach((v) => sp.append('cls', v));
  f.criticality.forEach((v) => sp.append('crit', v));
  if (f.failureOnly) sp.set('fail', '1');
  f.reasonKeys.forEach((v) => sp.append('reason', v));
  if (f.durationBand) sp.set('band', f.durationBand);
  if (f.compare) sp.set('cmp', f.compare);
  return sp;
}

const minDate = (a: string, b: string): string => (a < b ? a : b);

/**
 * The ONE range the filters resolve to. Relative presets count back from `asOf` (the last day with data, not
 * the machine clock, so a dashboard opened on a Monday still shows the latest week of data). Presets that run
 * into the future (this month, a year picker) end at `asOf`.
 */
export function resolveRange(f: DashFilters, asOf: string): DateRange {
  const mk = monthKey(asOf);
  switch (f.preset) {
    case 'last7': return { from: addDays(asOf, -6), to: asOf };
    case 'last30': return { from: addDays(asOf, -29), to: asOf };
    case 'last90': return { from: addDays(asOf, -89), to: asOf };
    case 'ytd': return { from: `${asOf.slice(0, 4)}-01-01`, to: asOf };
    case 'thismonth': return { from: `${mk}-01`, to: asOf };
    case 'prevmonth': return monthRange(addMonthsToKey(mk, -1));
    case 'year': {
      const y = f.year ?? Number(asOf.slice(0, 4));
      return { from: `${y}-01-01`, to: minDate(`${y}-12-31`, asOf) < `${y}-01-01` ? `${y}-12-31` : minDate(`${y}-12-31`, asOf) };
    }
    case 'month': {
      const m = f.month ?? mk;
      return { from: `${m}-01`, to: minDate(lastDayOfMonth(m), asOf) < `${m}-01` ? lastDayOfMonth(m) : minDate(lastDayOfMonth(m), asOf) };
    }
    case 'custom': {
      const from = f.from || addDays(asOf, -29);
      const to = f.to || asOf;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

export const PRESET_LABELS: Record<RangePreset, string> = {
  last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days', ytd: 'Year to date', thismonth: 'This month',
  prevmonth: 'Previous month', year: 'Year', month: 'Month', custom: 'Custom range',
};

export function compareKind(f: DashFilters, settings: Pick<CalcSettings, 'defaultComparison'>): CompareMode {
  return f.compare ?? settings.defaultComparison;
}

/** Filter fields that do not narrow the scope by line / area / date (event-level). */
export function eventLevelFilter(f: DashFilters, dateRange: DateRange | null = null): Filter {
  return {
    ...emptyFilter(), equipmentIds: f.equipmentIds, equipmentTypes: f.equipmentTypes, classifications: f.classifications,
    criticality: f.criticality, failureOnly: f.failureOnly, reasonKeys: f.reasonKeys.map(matchKey), durationBand: f.durationBand, dateRange,
  };
}

export function hasEventLevelFilter(f: DashFilters): boolean {
  return f.equipmentIds.length > 0 || f.equipmentTypes.length > 0 || f.classifications.length > 0 || f.criticality.length > 0
    || f.failureOnly || f.reasonKeys.length > 0 || f.durationBand !== null;
}

/** Number of narrowing filters (the date range and comparison are not counted). */
export function activeCount(f: DashFilters): number {
  return [f.lineIds, f.areaIds, f.equipmentIds, f.equipmentTypes, f.classifications, f.criticality, f.reasonKeys].filter((a) => a.length > 0).length
    + (f.failureOnly ? 1 : 0) + (f.durationBand ? 1 : 0);
}

export function isDefaultRange(f: DashFilters): boolean {
  return f.preset === DEFAULT_PRESET;
}

/** Areas allowed by the line and area selections: selecting a line narrows the areas. */
export function areasInScope(
  areas: { area_id: string; line_id: string; active: boolean; in_downtime_sheet: boolean; sort_order: number }[], f: DashFilters,
): string[] {
  return areas
    .filter((a) => a.active && a.in_downtime_sheet)
    .filter((a) => f.lineIds.length === 0 || f.lineIds.includes(a.line_id))
    .filter((a) => f.areaIds.length === 0 || f.areaIds.includes(a.area_id))
    .sort((a, b) => a.sort_order - b.sort_order || (a.area_id < b.area_id ? -1 : 1))
    .map((a) => a.area_id);
}

/**
 * Chips that can never match together: a failure is always an incident (INC) of a class other than PL and CIR, so
 * 'Failures only' with only PL / CIR, or with only NO_INC, leaves nothing; nor do only PL / CIR with only INC.
 * Returns the English sentence to show (passed through t() by the screen), or null.
 */
export function conflictingFilters(f: Pick<DashFilters, 'classifications' | 'criticality' | 'failureOnly'>): string | null {
  const onlyNoInc = f.classifications.length > 0 && f.classifications.every((c) => c === 'PL' || c === 'CIR');
  if (f.failureOnly && onlyNoInc) return 'These filters exclude each other: planned (PL) and other (CIR) stops are not failures, so Failures only with PL or CIR matches nothing.';
  if (f.failureOnly && f.criticality.length > 0 && !f.criticality.includes('INC')) return 'These filters exclude each other: every failure is an incident (INC), so Failures only with NO_INC matches nothing.';
  if (onlyNoInc && f.criticality.length > 0 && !f.criticality.includes('NO_INC')) return 'These filters exclude each other: PL and CIR stops are NO_INC, so with INC only they match nothing.';
  return null;
}
