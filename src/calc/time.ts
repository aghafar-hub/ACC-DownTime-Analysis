/**
 * Plant-local time handling. Timestamps are text 'YYYY-MM-DD HH:MM:SS.mmm' with no
 * time zone. The numbers are treated as UTC internally so the machine time zone
 * (and daylight saving) can never change a result.
 */
import type { CalcSettings, ComparisonKind } from './settings';

export const MS_SECOND = 1000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;

/** Inclusive calendar-day range, 'YYYY-MM-DD'. */
export interface DateRange { from: string; to: string }
/** Half-open interval [fromMs, toMs) in plant-local milliseconds. */
export interface Interval { fromMs: number; toMs: number }
export interface DayPiece extends Interval { date: string }
export interface MonthPiece extends Interval { month: string }

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Days since 1970-01-01 of a proleptic Gregorian date (integer arithmetic, no Date objects). */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function validDay(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return d <= (mo === 2 && leap ? 29 : MONTH_DAYS[mo - 1]!);
}

function utcChecked(y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number): number | null {
  if (h > 23 || mi > 59 || s > 59 || !validDay(y, mo, d)) return null;
  return daysFromCivil(y, mo, d) * MS_DAY + h * MS_HOUR + mi * 60_000 + s * MS_SECOND + ms;
}

function digits(text: string, from: number, len: number): number {
  let n = 0;
  for (let i = from; i < from + len; i++) {
    const c = text.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return -1;
    n = n * 10 + c;
  }
  return n;
}

/** 'YYYY-MM-DD HH:MM:SS(.mmm)' to plant-local ms, or null when unreadable. */
export function parseTs(text: string): number | null {
  const n = text.length;
  if (n < 19 || n > 23 || (text[10] !== ' ' && text[10] !== 'T') || text[4] !== '-' || text[7] !== '-' || text[13] !== ':' || text[16] !== ':') return null;
  if (n !== 19 && (text[19] !== '.' || n === 20)) return null;
  const y = digits(text, 0, 4); const mo = digits(text, 5, 2); const d = digits(text, 8, 2);
  const h = digits(text, 11, 2); const mi = digits(text, 14, 2); const s = digits(text, 17, 2);
  let ms = 0;
  if (n > 19) {
    ms = digits(text, 20, n - 20);
    if (ms < 0) return null;
    for (let k = n - 20; k < 3; k++) ms *= 10;
  }
  if (y < 0 || mo < 0 || d < 0 || h < 0 || mi < 0 || s < 0) return null;
  return utcChecked(y, mo, d, h, mi, s, ms);
}

/** 'YYYY-MM-DD' to plant-local midnight ms, or null. */
export function parseDate(text: string): number | null {
  const m = DATE_RE.exec(text);
  return m ? utcChecked(+m[1]!, +m[2]!, +m[3]!, 0, 0, 0, 0) : null;
}

export function formatTs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 23).replace('T', ' ');
}

export function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Date part of a timestamp or date string. */
export function dateOf(text: string): string {
  return text.slice(0, 10);
}

/** 'YYYY-MM' of a timestamp or date string. */
export function monthKey(text: string): string {
  return text.slice(0, 7);
}

export function yearKey(text: string): number {
  return Number(text.slice(0, 4));
}

/** Seconds from stop to start; null when either timestamp is unreadable. Negative when start is before stop. */
export function durationSeconds(stopTs: string, startTs: string): number | null {
  const a = parseTs(stopTs);
  const b = parseTs(startTs);
  return a === null || b === null ? null : (b - a) / MS_SECOND;
}

export function secondsToHours(s: number): number {
  return s / 3600;
}

export function hoursToSeconds(h: number): number {
  return h * 3600;
}

export function minutesOf(seconds: number): number {
  return seconds / 60;
}

// ---- intervals ----

/** Overlap of two intervals, or null when they do not overlap. */
export function clipInterval(i: Interval, window: Interval): Interval | null {
  const fromMs = Math.max(i.fromMs, window.fromMs);
  const toMs = Math.min(i.toMs, window.toMs);
  return toMs > fromMs ? { fromMs, toMs } : null;
}

/** Hours of `i` that fall inside `window`. */
export function clippedHours(i: Interval, window: Interval): number {
  const fromMs = Math.max(i.fromMs, window.fromMs);
  const toMs = Math.min(i.toMs, window.toMs);
  return toMs > fromMs ? (toMs - fromMs) / MS_HOUR : 0;
}

function splitBy<T extends Interval>(i: Interval, boundaryAfter: (ms: number) => number, label: (ms: number) => Omit<T, 'fromMs' | 'toMs'>): T[] {
  const out: T[] = [];
  let cur = i.fromMs;
  while (cur < i.toMs) {
    const end = Math.min(boundaryAfter(cur), i.toMs);
    out.push({ ...label(cur), fromMs: cur, toMs: end } as T);
    cur = end;
  }
  return out;
}

function nextMidnight(ms: number): number {
  return Math.floor(ms / MS_DAY) * MS_DAY + MS_DAY;
}

function nextMonthStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

/** Split an interval at midnights. */
export function splitByDay(i: Interval): DayPiece[] {
  return splitBy<DayPiece>(i, nextMidnight, (ms) => ({ date: formatDate(ms) }));
}

/** Split an interval at month boundaries. */
export function splitByMonth(i: Interval): MonthPiece[] {
  return splitBy<MonthPiece>(i, nextMonthStart, (ms) => ({ month: formatDate(ms).slice(0, 7) }));
}

// ---- calendar helpers ----

function mustDate(date: string): number {
  const ms = parseDate(date);
  if (ms === null) throw new Error(`Invalid date: ${date}`);
  return ms;
}

export function addDays(date: string, n: number): string {
  return formatDate(mustDate(date) + n * MS_DAY);
}

export function daysInMonth(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function lastDayOfMonth(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

export function monthRange(month: string): DateRange {
  return { from: `${month}-01`, to: lastDayOfMonth(month) };
}

export function addMonthsToKey(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${String(yy).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}`;
}

/** Add months keeping the day of month, clamped to the target month's length (31 Mar - 1 month = 28/29 Feb). */
export function addMonthsClamped(date: string, n: number): string {
  const month = addMonthsToKey(date.slice(0, 7), n);
  const day = Math.min(Number(date.slice(8, 10)), daysInMonth(month));
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** Inclusive list of month keys from `fromMonth` to `toMonth`. */
/** Longest month list ever built (100 years): a bad input can never make an endless loop. */
const MAX_MONTHS = 1200;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthsBetween(fromMonth: string, toMonth: string): string[] {
  const out: string[] = [];
  if (!MONTH_KEY.test(fromMonth) || !MONTH_KEY.test(toMonth)) return out;
  for (let m = fromMonth; m <= toMonth && out.length < MAX_MONTHS; m = addMonthsToKey(m, 1)) out.push(m);
  return out;
}

export function monthsOfRange(range: DateRange): string[] {
  return monthsBetween(monthKey(range.from), monthKey(range.to));
}

export function isValidRange(range: DateRange): boolean {
  const a = parseDate(range.from);
  const b = parseDate(range.to);
  return a !== null && b !== null && a <= b;
}

/** Number of calendar days in an inclusive range. */
export function daysInRange(range: DateRange): number {
  return Math.round((mustDate(range.to) - mustDate(range.from)) / MS_DAY) + 1;
}

/** Inclusive day range as a half-open ms interval [from 00:00, to+1 day 00:00). */
export function rangeToInterval(range: DateRange): Interval {
  return { fromMs: mustDate(range.from), toMs: mustDate(range.to) + MS_DAY };
}

export function intersectRanges(a: DateRange, b: DateRange): DateRange | null {
  const from = a.from > b.from ? a.from : b.from;
  const to = a.to < b.to ? a.to : b.to;
  return from <= to ? { from, to } : null;
}

export function sameRange(a: DateRange, b: DateRange): boolean {
  return a.from === b.from && a.to === b.to;
}

// ---- scheduled time ----

/** Scheduled hours in a window: scheduled_hours_per_day for each scheduled day (first N days of a Monday-based week). */
export function scheduledHours(range: DateRange, settings: Pick<CalcSettings, 'scheduledHoursPerDay' | 'scheduledDaysPerWeek'>): number {
  const days = scheduledDays(range, settings.scheduledDaysPerWeek);
  return days * settings.scheduledHoursPerDay;
}

export function scheduledDays(range: DateRange, daysPerWeek: number): number {
  const total = daysInRange(range);
  if (daysPerWeek >= 7) return total;
  const startDow = (new Date(mustDate(range.from)).getUTCDay() + 6) % 7; // Monday = 0
  let count = 0;
  for (let k = 0; k < total; k++) if ((startDow + k) % 7 < daysPerWeek) count++;
  return count;
}

// ---- periods ----

function isFirstOfMonth(date: string): boolean {
  return date.slice(8, 10) === '01';
}

function monthSpan(range: DateRange): number {
  const a = monthKey(range.from);
  const b = monthKey(range.to);
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7)) + 1;
}

/**
 * The comparison period for a window.
 * - whole calendar months (1st to last day): the same number of whole months before / a year earlier;
 * - month-aligned partial (1st to day N, e.g. month to date): the elapsed-equivalent period (1st to day N,
 *   clamped to the month length) in the previous month(s) / a year earlier, so a partial month never compares
 *   against a full one;
 * - anything else: the same number of days immediately before / the same dates a year earlier.
 */
export function comparisonRange(range: DateRange, kind: ComparisonKind): DateRange {
  const lastYear = kind === 'same_period_last_year';
  if (isFirstOfMonth(range.from)) {
    const k = monthSpan(range);
    const shift = lastYear ? -12 : -k;
    const whole = range.to === lastDayOfMonth(monthKey(range.to));
    const from = addMonthsClamped(range.from, shift);
    const to = whole ? lastDayOfMonth(addMonthsToKey(monthKey(range.to), shift)) : addMonthsClamped(range.to, shift);
    return { from, to };
  }
  if (lastYear) return { from: addMonthsClamped(range.from, -12), to: addMonthsClamped(range.to, -12) };
  const len = daysInRange(range);
  const to = addDays(range.from, -1);
  return { from: addDays(to, -(len - 1)), to };
}

export function previousPeriod(range: DateRange): DateRange {
  return comparisonRange(range, 'previous_period');
}

export function sameLastYear(range: DateRange): DateRange {
  return comparisonRange(range, 'same_period_last_year');
}

/**
 * Elapsed-equivalent window for a partially elapsed month: if `asOfDate` falls inside `month`, the same
 * number of elapsed days (1st to the same day number, clamped) in `otherMonth`; otherwise the whole `otherMonth`.
 */
export function elapsedEquivalent(month: string, asOfDate: string, otherMonth: string): DateRange {
  const mr = monthRange(month);
  if (asOfDate < mr.from || asOfDate >= mr.to) return monthRange(otherMonth);
  const day = Math.min(Number(asOfDate.slice(8, 10)), daysInMonth(otherMonth));
  return { from: `${otherMonth}-01`, to: `${otherMonth}-${String(day).padStart(2, '0')}` };
}

/** Is the month only partly covered by data ending at `lastDataDate`? */
export function isPartialMonth(month: string, lastDataDate: string): boolean {
  return lastDataDate >= `${month}-01` && lastDataDate < lastDayOfMonth(month);
}
