import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('parseSettings', () => {
  it('returns the documented defaults for no input', () => expect(parseSettings()).toEqual(DEFAULT_SETTINGS));
  it('parses settings rows', () => {
    const s = parseSettings([
      { key: 'availability_basis', value: 'c' }, { key: 'scheduled_hours_per_day', value: '20' }, { key: 'scheduled_days_per_week', value: '6' },
      { key: 'repeat_min_events', value: '3' }, { key: 'repeat_window_days', value: '14' }, { key: 'availability_target_pct', value: '92.5' },
      { key: 'default_comparison', value: 'same_period_last_year' },
    ]);
    expect(s).toMatchObject({ availabilityBasis: 'C', scheduledHoursPerDay: 20, scheduledDaysPerWeek: 6, repeatMinEvents: 3, repeatWindowDays: 14, availabilityTargetPct: 92.5, defaultComparison: 'same_period_last_year' });
  });
  it('falls back to defaults for blank or invalid values', () => {
    const s = parseSettings({ availability_basis: 'Z', scheduled_hours_per_day: 'abc', scheduled_days_per_week: '9', repeat_min_events: '', availability_target_pct: '' });
    expect(s).toEqual(DEFAULT_SETTINGS);
  });
  it('parses the MTBF and MTTR targets: blank, zero, negative or text mean no target', () => {
    expect(parseSettings({ target_mtbf_h: '120.5', target_mttr_h: '2' })).toMatchObject({ targetMtbfH: 120.5, targetMttrH: 2 });
    for (const bad of ['', '0', '-3', 'x', '100001']) expect(parseSettings({ target_mtbf_h: bad, target_mttr_h: bad })).toMatchObject({ targetMtbfH: null, targetMttrH: null });
  });
  it('never lets the repeat rule drop below two events', () => expect(parseSettings({ repeat_min_events: '1' }).repeatMinEvents).toBe(2));
});
