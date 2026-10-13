import { describe, expect, it } from 'vitest';
import { comparisonKindFor, lastFullMonth, resolvePeriod } from './period';

describe('report periods', () => {
  it('last full month: the month of the last data day only when that day ends the month', () => {
    expect(lastFullMonth('2026-10-11')).toBe('2026-09');
    expect(lastFullMonth('2026-10-31')).toBe('2026-10');
    expect(lastFullMonth('2026-01-05')).toBe('2025-12');
  });
  it('presets count back from the last data day', () => {
    expect(resolvePeriod('lastmonth', '', '', '2026-10-11')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(resolvePeriod('thismonth', '', '', '2026-10-11')).toEqual({ from: '2026-10-01', to: '2026-10-11' });
    expect(resolvePeriod('last3', '', '', '2026-10-11')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(resolvePeriod('ytd', '', '', '2026-10-11')).toEqual({ from: '2026-01-01', to: '2026-10-11' });
  });
  it('custom: given dates, turned round when reversed, last full month when blank', () => {
    expect(resolvePeriod('custom', '2026-03-05', '2026-03-20', '2026-10-11')).toEqual({ from: '2026-03-05', to: '2026-03-20' });
    expect(resolvePeriod('custom', '2026-03-20', '2026-03-05', '2026-10-11')).toEqual({ from: '2026-03-05', to: '2026-03-20' });
    expect(resolvePeriod('custom', '', '', '2026-10-11')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
  it('year to date compares with the same dates last year, the rest with the previous period', () => {
    expect(comparisonKindFor('ytd')).toBe('same_period_last_year');
    expect(comparisonKindFor('lastmonth')).toBe('previous_period');
  });
});
