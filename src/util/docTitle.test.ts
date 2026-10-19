import { describe, expect, it } from 'vitest';
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
