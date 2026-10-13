// The report period: a preset (or a custom range) resolved against the last day with data. Pure.
import type { ReportPreset } from '../api/types';
import { addMonthsToKey, lastDayOfMonth, monthKey, monthRange, type ComparisonKind, type DateRange } from '../calc';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The latest complete calendar month at `asOf` (the last day with data): the month of `asOf` when `asOf` is its last day,
 * otherwise the month before it.
 */
export function lastFullMonth(asOf: string): string {
  const mk = monthKey(asOf);
  return asOf >= lastDayOfMonth(mk) ? mk : addMonthsToKey(mk, -1);
}

/**
 * The period a preset stands for. Presets count back from `asOf`, never from the machine clock, so a report made on a
 * Monday still covers the latest data.
 *  - lastmonth: the latest complete month; thismonth: the 1st of the month of `asOf` up to `asOf`;
 *  - last3: the three latest complete months; ytd: 1 January of the year of `asOf` up to `asOf`;
 *  - custom: from..to (a blank end falls back to the last full month; a reversed pair is turned round).
 */
export function resolvePeriod(preset: ReportPreset, from: string, to: string, asOf: string): DateRange {
  const lm = lastFullMonth(asOf);
  switch (preset) {
    case 'lastmonth': return monthRange(lm);
    case 'thismonth': return { from: `${monthKey(asOf)}-01`, to: asOf };
    case 'last3': return { from: monthRange(addMonthsToKey(lm, -2)).from, to: monthRange(lm).to };
    case 'ytd': return { from: `${asOf.slice(0, 4)}-01-01`, to: asOf };
    case 'custom': {
      const lo = DATE_RE.test(from) ? from : monthRange(lm).from;
      const hi = DATE_RE.test(to) ? to : monthRange(lm).to;
      return lo <= hi ? { from: lo, to: hi } : { from: hi, to: lo };
    }
  }
}

/** How the "compare with previous period" switch compares: year to date against the same dates last year, everything else against the period just before. */
export function comparisonKindFor(preset: ReportPreset): ComparisonKind {
  return preset === 'ytd' ? 'same_period_last_year' : 'previous_period';
}

