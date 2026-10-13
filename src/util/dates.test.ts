import { describe, expect, it } from 'vitest';
import { dateText, dayText, monthShort, monthText, rangeText, timeText, tsShort, tsText, whenShort, whenText } from './dates';

describe('the one date format', () => {
  it('months read "Aug 2026"', () => {
    expect(monthText('2026-08')).toBe('Aug 2026');
    expect(monthText('2026-08-26')).toBe('Aug 2026');
    expect(monthText('2025-12')).toBe('Dec 2025');
    expect(monthShort('2026-01')).toBe('Jan');
    expect(monthText('')).toBe('');
  });

  it('days read "26 Aug", with the year when it matters "26 Aug 2026"', () => {
    expect(dayText('2026-08-26')).toBe('26 Aug');
    expect(dayText('2026-08-02')).toBe('2 Aug');
    expect(dateText('2026-08-26')).toBe('26 Aug 2026');
    expect(dateText('2026-08-26 14:05:00.000')).toBe('26 Aug 2026');
    expect(dateText('not a date')).toBe('not a date');
  });

  it('timestamps read "26 Aug 2026 14:05", as written in plant time (no time-zone shift)', () => {
    expect(tsText('2026-08-26 14:05:59.123')).toBe('26 Aug 2026 14:05');
    expect(tsText('2026-08-26T00:21:00')).toBe('26 Aug 2026 00:21');
    expect(tsText('2026-08-26')).toBe('26 Aug 2026');
    expect(tsShort('2026-08-26 14:05:00')).toBe('26 Aug 14:05');
    expect(timeText('2026-08-26 07:09:00')).toBe('07:09');
    expect(tsText('')).toBe('');
  });

  it('ranges say each part once', () => {
    expect(rangeText({ from: '2026-08-26', to: '2026-08-26' })).toBe('26 Aug 2026');
    expect(rangeText({ from: '2026-10-01', to: '2026-10-12' })).toBe('1–12 Oct 2026');
    expect(rangeText({ from: '2026-01-01', to: '2026-08-31' })).toBe('1 Jan – 31 Aug 2026');
    expect(rangeText({ from: '2025-08-12', to: '2026-10-11' })).toBe('12 Aug 2025 – 11 Oct 2026');
  });

  it('real instants are shown in local time, without the year when it is this year', () => {
    const d = new Date(2026, 7, 26, 14, 5);
    expect(whenText(d)).toBe('26 Aug 2026 14:05');
    expect(whenShort(d, new Date(2026, 9, 1))).toBe('26 Aug 14:05');
    expect(whenShort(d, new Date(2027, 0, 1))).toBe('26 Aug 2026 14:05');
    expect(whenText('nonsense')).toBe('nonsense');
    expect(whenText(null)).toBe('');
  });
});
