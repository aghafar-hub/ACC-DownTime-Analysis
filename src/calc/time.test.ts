import { describe, expect, it } from 'vitest';
import {
  addMonthsClamped, clipInterval, clippedHours, comparisonRange, daysInRange, durationSeconds, elapsedEquivalent, formatTs,
  intersectRanges, isPartialMonth, monthKey, monthsBetween, parseDate, parseTs, previousPeriod, rangeToInterval, sameLastYear,
  scheduledHours, splitByDay, splitByMonth, MS_HOUR,
} from './time';

const t = (s: string): number => parseTs(s)!;

describe('parsing and formatting', () => {
  it('round-trips timestamps and ignores the machine time zone', () => {
    const s = '2026-03-29 02:30:15.250'; // inside a spring-forward gap in some zones
    expect(parseTs(s)).toBe(Date.UTC(2026, 2, 29, 2, 30, 15, 250));
    expect(formatTs(parseTs(s)!)).toBe(s);
  });
  it('accepts missing milliseconds and pads partial ones', () => {
    expect(t('2026-03-01 00:00:01')).toBe(t('2026-03-01 00:00:01.000'));
    expect(t('2026-03-01 00:00:01.5')).toBe(t('2026-03-01 00:00:01.500'));
  });
  it('rejects unreadable values', () => {
    for (const bad of ['', 'abc', '2026-02-30 10:00:00.000', '2026-13-01 10:00:00.000', '2026-01-01 24:00:00.000', '2026-01-01']) {
      expect(parseTs(bad)).toBeNull();
    }
    expect(parseDate('2026-02-29')).toBeNull();
    expect(parseDate('2024-02-29')).not.toBeNull();
  });
  it('computes durations in seconds, negative when the restart precedes the stop', () => {
    expect(durationSeconds('2026-03-01 08:00:00.000', '2026-03-01 09:30:30.500')).toBe(5430.5);
    expect(durationSeconds('2026-03-01 09:00:00.000', '2026-03-01 08:00:00.000')).toBe(-3600);
    expect(durationSeconds('bad', '2026-03-01 08:00:00.000')).toBeNull();
  });
  it('gives month keys', () => expect(monthKey('2026-03-15 10:00:00.000')).toBe('2026-03'));
});

describe('clipping and splitting', () => {
  const iv = (a: string, b: string) => ({ fromMs: t(a), toMs: t(b) });
  it('clips to a window', () => {
    const w = rangeToInterval({ from: '2026-03-01', to: '2026-03-10' });
    // stop 2026-03-10 22:00 to 03-11 02:00: only 2 h are inside the window (22:00-24:00)
    expect(clippedHours(iv('2026-03-10 22:00:00', '2026-03-11 02:00:00'), w)).toBe(2);
    expect(clipInterval(iv('2026-02-20 00:00:00', '2026-02-21 00:00:00'), w)).toBeNull();
    expect(clippedHours(iv('2026-02-28 23:00:00', '2026-03-01 01:00:00'), w)).toBe(1);
  });
  it('splits a midnight-crossing stop into per-day pieces', () => {
    const pieces = splitByDay(iv('2026-03-10 23:00:00', '2026-03-11 02:00:00'));
    expect(pieces.map((p) => [p.date, (p.toMs - p.fromMs) / MS_HOUR])).toEqual([['2026-03-10', 1], ['2026-03-11', 2]]);
  });
  it('keeps a 24 h stop on one day when it runs midnight to midnight, and splits it otherwise', () => {
    expect(splitByDay(iv('2026-03-10 00:00:00', '2026-03-11 00:00:00'))).toHaveLength(1);
    const p = splitByDay(iv('2026-03-10 12:00:00', '2026-03-11 12:00:00'));
    expect(p.map((x) => (x.toMs - x.fromMs) / MS_HOUR)).toEqual([12, 12]);
  });
  it('splits across months (and a year end)', () => {
    const p = splitByMonth(iv('2026-01-31 22:00:00', '2026-02-01 03:00:00'));
    expect(p.map((x) => [x.month, (x.toMs - x.fromMs) / MS_HOUR])).toEqual([['2026-01', 2], ['2026-02', 3]]);
    expect(splitByMonth(iv('2025-12-31 23:00:00', '2026-01-01 01:00:00')).map((x) => x.month)).toEqual(['2025-12', '2026-01']);
  });
  it('returns nothing for an empty interval', () => expect(splitByDay(iv('2026-03-10 10:00:00', '2026-03-10 10:00:00'))).toEqual([]));
});

describe('calendar and scheduled time', () => {
  it('adds months with clamping', () => {
    expect(addMonthsClamped('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonthsClamped('2024-02-29', -12)).toBe('2023-02-28');
    expect(addMonthsClamped('2026-01-15', -2)).toBe('2025-11-15');
  });
  it('lists months', () => expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']));
  it('counts days and intersects ranges', () => {
    expect(daysInRange({ from: '2026-02-01', to: '2026-02-28' })).toBe(28);
    expect(intersectRanges({ from: '2026-03-01', to: '2026-03-31' }, { from: '2026-03-20', to: '2026-04-30' })).toEqual({ from: '2026-03-20', to: '2026-03-31' });
    expect(intersectRanges({ from: '2026-03-01', to: '2026-03-05' }, { from: '2026-03-20', to: '2026-04-30' })).toBeNull();
  });
  it('scheduled hours: 24 x 7 by default', () => {
    // February 2026: 28 days x 24 h = 672 h
    expect(scheduledHours({ from: '2026-02-01', to: '2026-02-28' }, { scheduledHoursPerDay: 24, scheduledDaysPerWeek: 7 })).toBe(672);
  });
  it('scheduled hours honour days per week (Monday-based, first N days)', () => {
    // 1 Feb 2026 is a Sunday. Mon-Sat scheduled: 28 days minus 4 Sundays (1, 8, 15, 22) = 24 days x 24 = 576
    expect(scheduledHours({ from: '2026-02-01', to: '2026-02-28' }, { scheduledHoursPerDay: 24, scheduledDaysPerWeek: 6 })).toBe(576);
    // Mon-Fri: 20 weekdays x 8 h = 160
    expect(scheduledHours({ from: '2026-02-01', to: '2026-02-28' }, { scheduledHoursPerDay: 8, scheduledDaysPerWeek: 5 })).toBe(160);
  });
});

describe('period utilities', () => {
  it('whole month: previous whole month and same month last year', () => {
    const mar = { from: '2026-03-01', to: '2026-03-31' };
    expect(previousPeriod(mar)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(sameLastYear(mar)).toEqual({ from: '2025-03-01', to: '2025-03-31' });
  });
  it('whole quarter', () => {
    expect(previousPeriod({ from: '2026-01-01', to: '2026-03-31' })).toEqual({ from: '2025-10-01', to: '2025-12-31' });
  });
  it('partial month compares against the elapsed-equivalent period', () => {
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-15' })).toEqual({ from: '2026-02-01', to: '2026-02-15' });
    expect(previousPeriod({ from: '2026-03-01', to: '2026-03-30' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(sameLastYear({ from: '2026-03-01', to: '2026-03-15' })).toEqual({ from: '2025-03-01', to: '2025-03-15' });
  });
  it('arbitrary window: same number of days immediately before', () => {
    // 10 days 10-19 Mar -> 28 Feb - 9 Mar
    expect(previousPeriod({ from: '2026-03-10', to: '2026-03-19' })).toEqual({ from: '2026-02-28', to: '2026-03-09' });
    expect(comparisonRange({ from: '2026-03-10', to: '2026-03-19' }, 'same_period_last_year')).toEqual({ from: '2025-03-10', to: '2025-03-19' });
  });
  it('elapsedEquivalent and isPartialMonth', () => {
    expect(elapsedEquivalent('2026-03', '2026-03-15', '2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-15' });
    expect(elapsedEquivalent('2026-03', '2026-03-30', '2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(elapsedEquivalent('2026-03', '2026-03-31', '2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(elapsedEquivalent('2026-03', '2026-04-10', '2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(isPartialMonth('2026-03', '2026-03-15')).toBe(true);
    expect(isPartialMonth('2026-03', '2026-03-31')).toBe(false);
    expect(isPartialMonth('2026-03', '2026-04-02')).toBe(false);
  });
});
