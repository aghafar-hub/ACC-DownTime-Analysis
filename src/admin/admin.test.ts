import { describe, expect, it } from 'vitest';
import tables from '../../schema/tables.json';
import { TAB_IDS } from '../api/types';
import { changedSettings, SETTING_KEYS, validateSettings } from './settingsSchema';
import { ROLE_DEFAULTS } from './users/roleDefaults';

const allDefaults = Object.fromEntries((tables as { settingsDefaults: { key: string; value: string }[] }).settingsDefaults.map((s) => [s.key, s.value]));
// The notification thresholds (notif_*) and app_url are edited on the Notifications subtab, which has its own schema and test.
const isNotificationSetting = (k: string): boolean => k.startsWith('notif_') || k === 'app_url';
const defaults = Object.fromEntries(Object.entries(allDefaults).filter(([k]) => !isNotificationSetting(k)));

describe('settings', () => {
  it('knows every setting the schema defines, and the starting values are valid', () => {
    expect([...SETTING_KEYS].sort()).toEqual(Object.keys(defaults).sort());
    expect(validateSettings(defaults)).toEqual({});
  });
  it('checks ranges in plain English', () => {
    const bad = validateSettings({ ...defaults, scheduled_hours_per_day: '25', scheduled_days_per_week: '0', repeat_min_events: '1', min_password_length: '5', lockout_minutes: 'abc', session_hours: '1.5', availability_target_pct: '101', availability_basis: 'D' });
    expect(Object.keys(bad).sort()).toEqual(['availability_basis', 'availability_target_pct', 'lockout_minutes', 'min_password_length', 'repeat_min_events', 'scheduled_days_per_week', 'scheduled_hours_per_day', 'session_hours']);
    expect(bad.scheduled_hours_per_day).toBe('Use a number from 1 to 24.');
    expect(bad.session_hours).toBe('Use a whole number.');
    expect(bad.lockout_minutes).toBe('Write a number.');
  });
  it('allows a blank target and requires long above short', () => {
    expect(validateSettings({ ...defaults, availability_target_pct: '' })).toEqual({});
    expect(validateSettings({ ...defaults, availability_target_pct: '92.5' })).toEqual({});
    expect(validateSettings({ ...defaults, duration_short_max_min: '60', duration_long_min_min: '60' }).duration_long_min_min).toMatch(/more than the short limit/);
  });
  it('sends only what changed', () => {
    expect(changedSettings(defaults, defaults)).toEqual({});
    expect(changedSettings(defaults, { ...defaults, availability_basis: 'C', repeat_window_days: ' 45 ' })).toEqual({ availability_basis: 'C', repeat_window_days: '45' });
  });
});

describe('role defaults', () => {
  it('match schema/tables.json', () => {
    const t = tables as unknown as { tabAccessDefaults: Record<string, Record<string, string>> };
    expect(ROLE_DEFAULTS).toEqual(t.tabAccessDefaults);
    for (const r of Object.values(ROLE_DEFAULTS)) expect(Object.keys(r).sort()).toEqual([...TAB_IDS].sort());
  });
});
