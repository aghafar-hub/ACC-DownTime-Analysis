import { describe, expect, it } from 'vitest';
import tables from '../../schema/tables.json';
import { TAB_IDS } from '../api/types';
import { changedSettings, groups, SETTING_FALLBACKS, SETTING_KEYS, validateSettings } from './settingsSchema';
import { ROLE_DEFAULTS } from './users/roleDefaults';

const allDefaults = Object.fromEntries((tables as { settingsDefaults: { key: string; value: string }[] }).settingsDefaults.map((s) => [s.key, s.value]));
// Every default setting is covered by the schema, including the notification thresholds (notif_*) and app_url, which
// the Settings > Notifications subtab edits (group "alert-rules").
const defaults = allDefaults;
const NOTIFICATION_KEYS = Object.keys(allDefaults).filter((k) => k.startsWith('notif_') || k === 'app_url');

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

describe('notification settings', () => {
  it('are all edited by the Notifications subtab (one group) and fall back to the stored defaults', () => {
    expect(NOTIFICATION_KEYS.length).toBe(7);
    const group = groups().find((g) => g.id === 'alert-rules')!;
    expect(group.fields.map((f) => f.key).sort()).toEqual([...NOTIFICATION_KEYS].sort());
    for (const k of NOTIFICATION_KEYS) expect(SETTING_FALLBACKS[k], k).toBe(allDefaults[k]);
    // no other group edits them
    for (const g of groups().filter((x) => x.id !== 'alert-rules')) for (const f of g.fields) expect(NOTIFICATION_KEYS).not.toContain(f.key);
  });
  it('use the ranges the server enforces, with plain messages', () => {
    const bad = validateSettings({ ...defaults, notif_long_stop_hours: '0', notif_spike_pct: '1001', notif_upload_gap_days: '2.5', notif_availability_target_pct: '101', notif_repeat_alert: 'maybe', notif_retention_days: 'abc', app_url: 'ftp://x' });
    expect(Object.keys(bad).sort()).toEqual(['app_url', 'notif_availability_target_pct', 'notif_long_stop_hours', 'notif_repeat_alert', 'notif_retention_days', 'notif_spike_pct', 'notif_upload_gap_days']);
    expect(bad.notif_long_stop_hours).toBe('Use a number from 1 to 720.');
    expect(bad.notif_upload_gap_days).toBe('Use a whole number.');
    expect(bad.notif_retention_days).toBe('Write a number.');
    expect(bad.app_url).toMatch(/http:\/\/ or https:\/\//);
  });
  it('accept a blank target and a blank or valid web address', () => {
    expect(validateSettings({ ...defaults, notif_availability_target_pct: '', app_url: '' })).toEqual({});
    expect(validateSettings({ ...defaults, notif_availability_target_pct: '92.5', app_url: 'https://acc.example.org/app/' })).toEqual({});
    expect(validateSettings({ ...defaults, app_url: 'https://acc.example.org/a b' }).app_url).toBeTruthy();
    expect(validateSettings({ ...defaults, app_url: `https://x.org/${'a'.repeat(300)}` }).app_url).toBe('Use at most 300 characters.');
  });
  it('save only what changed', () => {
    expect(changedSettings(defaults, { ...defaults, notif_long_stop_hours: ' 12 ', notif_repeat_alert: 'false' })).toEqual({ notif_long_stop_hours: '12', notif_repeat_alert: 'false' });
  });
});

describe('role defaults', () => {
  it('match schema/tables.json', () => {
    const t = tables as unknown as { tabAccessDefaults: Record<string, Record<string, string>> };
    expect(ROLE_DEFAULTS).toEqual(t.tabAccessDefaults);
    for (const r of Object.values(ROLE_DEFAULTS)) expect(Object.keys(r).sort()).toEqual([...TAB_IDS].sort());
  });
});
