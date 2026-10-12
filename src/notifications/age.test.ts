import { describe, expect, it } from 'vitest';
import { formatStamp, parseStamp, relativeAge } from './age';

const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number => new Date(y, mo - 1, d, h, mi, s).getTime();

describe('stamps', () => {
  it('round-trips the stored spelling', () => {
    const ms = at(2026, 3, 5, 10, 4, 9) + 7;
    expect(formatStamp(ms)).toBe('2026-03-05 10:04:09.007');
    expect(parseStamp('2026-03-05 10:04:09.007')).toBe(ms);
  });
  it('reads dates, minutes and ISO-style T separators; rejects junk', () => {
    expect(parseStamp('2026-03-05')).toBe(at(2026, 3, 5));
    expect(parseStamp('2026-03-05 10:04')).toBe(at(2026, 3, 5, 10, 4));
    expect(parseStamp('2026-03-05T10:04:09')).toBe(at(2026, 3, 5, 10, 4, 9));
    expect(parseStamp('')).toBeNull();
    expect(parseStamp(undefined)).toBeNull();
    expect(parseStamp('soon')).toBeNull();
  });
});

describe('relativeAge', () => {
  const now = at(2026, 10, 12, 14, 0, 0);
  const age = (ts: string) => relativeAge(ts, now);
  it('just now, minutes, hours', () => {
    expect(age('2026-10-12 13:59:30')).toBe('just now');
    expect(age('2026-10-12 13:59:00')).toBe('1 min ago');
    expect(age('2026-10-12 13:15:00')).toBe('45 min ago');
    expect(age('2026-10-12 12:00:00')).toBe('2 h ago');
    expect(age('2026-10-11 15:00:00')).toBe('23 h ago');
  });
  it('yesterday, days, then the date', () => {
    expect(age('2026-10-11 09:00:00')).toBe('yesterday');
    expect(age('2026-10-10 20:00:00')).toBe('2 days ago');
    expect(age('2026-10-06 09:00:00')).toBe('6 days ago');
    expect(age('2026-10-04 09:00:00')).toBe('4 Oct');
    expect(age('2025-12-24 09:00:00')).toBe('24 Dec 2025');
  });
  it('a time in the future reads as just now; an unreadable one is blank', () => {
    expect(age('2026-10-12 14:30:00')).toBe('just now');
    expect(age('')).toBe('');
  });
});
