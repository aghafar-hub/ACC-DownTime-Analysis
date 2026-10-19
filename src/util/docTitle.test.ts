import { describe, expect, it } from 'vitest';
import { cellText } from '../reports/model';
import { documentTitle, pageNameForPath } from './docTitle';

describe('browser tab title per page', () => {
  it('uses the side-bar names', () => {
    expect(documentTitle('/dashboard')).toBe('Dashboard · ACC Downtime');
    expect(documentTitle('/overview')).toBe('Dashboard · ACC Downtime');
    expect(documentTitle('/pareto')).toBe('Causes · ACC Downtime');
    expect(documentTitle('/repeats')).toBe('Repeated failures · ACC Downtime');
    expect(documentTitle('/reliability')).toBe('Reliability · ACC Downtime');
    expect(documentTitle('/events')).toBe('Events · ACC Downtime');
    expect(documentTitle('/validate')).toBe('Validate · ACC Downtime');
    expect(documentTitle('/master')).toBe('Master Data · ACC Downtime');
  });
  it('names sub-pages, Settings subtabs, Notifications, sign-in and unknown addresses', () => {
    expect(pageNameForPath('/actions')).toBe('Actions');
    expect(pageNameForPath('/actions/tasks')).toBe('Actions › Tasks');
    expect(pageNameForPath('/actions/shutdown')).toBe('Actions › Shutdown list');
    expect(pageNameForPath('/settings')).toBe('Settings');
    expect(pageNameForPath('/settings/users')).toBe('Settings › Users and access');
    expect(pageNameForPath('/notifications')).toBe('Notifications');
    expect(pageNameForPath('/login')).toBe('Sign in');
    expect(documentTitle('/nowhere')).toBe('Page not found · ACC Downtime');
    expect(documentTitle('/')).toBe('ACC Downtime');
  });
});

describe('report cells show dates the app way (phase 5)', () => {
  it('date, a list of dates and date-time columns', () => {
    expect(cellText('date', '2026-09-01')).toBe('1 Sep 2026');
    expect(cellText('date', '2026-09-04, 2026-09-08')).toBe('4 Sep 2026, 8 Sep 2026');
    expect(cellText('date', 'Not uploaded')).toBe('Not uploaded');
    expect(cellText('datetime', '2026-09-01 16:05')).toBe('1 Sep 2026 16:05');
    expect(cellText('date', null)).toBe('–');
  });
});
