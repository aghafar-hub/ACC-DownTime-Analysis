import type { Setting } from '../api/types';

export type AvailabilityBasis = 'A' | 'B' | 'C';
export type ComparisonKind = 'previous_period' | 'same_period_last_year';

/** Settings the calculation layer needs, parsed from the `settings` table. */
export interface CalcSettings {
  availabilityBasis: AvailabilityBasis;
  scheduledHoursPerDay: number;
  /** Scheduled days per week; the first N days of a Monday-based week are scheduled. */
  scheduledDaysPerWeek: number;
  repeatMinEvents: number;
  repeatWindowDays: number;
  durationShortMaxMin: number;
  durationLongMinMin: number;
  availabilityTargetPct: number | null;
  defaultComparison: ComparisonKind;
}

export const DEFAULT_SETTINGS: CalcSettings = {
  availabilityBasis: 'B',
  scheduledHoursPerDay: 24,
  scheduledDaysPerWeek: 7,
  repeatMinEvents: 2,
  repeatWindowDays: 30,
  durationShortMaxMin: 30,
  durationLongMinMin: 120,
  availabilityTargetPct: null,
  defaultComparison: 'previous_period',
};

function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** Parse settings rows (or a key/value map). Missing or invalid values fall back to defaults. */
export function parseSettings(source: Setting[] | Record<string, string> = []): CalcSettings {
  const map: Record<string, string> = {};
  if (Array.isArray(source)) for (const s of source) map[s.key] = s.value;
  else Object.assign(map, source);
  const d = DEFAULT_SETTINGS;
  const basis = (map.availability_basis ?? '').trim().toUpperCase();
  const cmp = (map.default_comparison ?? '').trim();
  const target = (map.availability_target_pct ?? '').trim();
  return {
    availabilityBasis: basis === 'A' || basis === 'B' || basis === 'C' ? basis : d.availabilityBasis,
    scheduledHoursPerDay: num(map.scheduled_hours_per_day, d.scheduledHoursPerDay, 0, 24),
    scheduledDaysPerWeek: Math.round(num(map.scheduled_days_per_week, d.scheduledDaysPerWeek, 0, 7)),
    repeatMinEvents: Math.max(2, Math.round(num(map.repeat_min_events, d.repeatMinEvents, 1, 1000))),
    repeatWindowDays: num(map.repeat_window_days, d.repeatWindowDays, 0, 3650),
    durationShortMaxMin: num(map.duration_short_max_min, d.durationShortMaxMin, 0, 100000),
    durationLongMinMin: num(map.duration_long_min_min, d.durationLongMinMin, 0, 100000),
    availabilityTargetPct: target === '' || !Number.isFinite(Number(target)) ? null : Number(target),
    defaultComparison: cmp === 'same_period_last_year' ? cmp : d.defaultComparison,
  };
}
