import { describe, expect, it } from 'vitest';
import type { Notification, TabId } from '../api/types';
import { storedTarget, type LinkEnv } from './links';

const n = (over: Partial<Notification>): Notification => ({
  notification_id: 'NT-1', type: 'long_stop', severity: 'alert', dedupe_key: 'long_stop|EV-1', title: 'Long stop: K.1 9 h', area_id: 'K.1', source_ref: 'EV-1',
  created_at: '', expires_at: '', status: 'open', ...over,
});
const env = (hidden: TabId[] = []): LinkEnv => ({ canView: (t) => !hidden.includes(t), years: [2026, 2025], yearOfEvent: (id) => (id === 'EV-1' ? 2025 : undefined) });

describe('storedTarget', () => {
  it('long stop: the Event Explorer drilled to that event, in the year it lives in', () => {
    const t = storedTarget(n({}), env());
    expect(t.link?.to).toBe('/events');
    expect(t.link?.state).toEqual({ drill: { label: 'Long stop: K.1 9 h', eventIds: ['EV-1'], years: [2025], source: 'Notification' } });
    expect(storedTarget(n({ source_ref: 'EV-9' }), env()).link?.state).toMatchObject({ drill: { years: [2026, 2025] } });
  });
  it('repeated group: Repeated Failures for the area', () => {
    expect(storedTarget(n({ type: 'repeat_group', dedupe_key: 'repeat|K.1|131.PM130|belt|EV-1' }), env()).link).toEqual({ to: '/repeats?area=K.1' });
  });
  it('failure spike: the causes of the area over the last 30 days', () => {
    expect(storedTarget(n({ type: 'failure_spike', dedupe_key: 'spike|K.1|2026-10-11' }), env()).link).toEqual({ to: '/pareto?area=K.1&r=last30' });
  });
  it('availability: Reliability for the area and the month in the key', () => {
    const t = storedTarget(n({ type: 'availability_low', dedupe_key: 'availability|K.1|2026-09' }), env());
    expect(t.link).toEqual({ to: '/reliability?area=K.1&r=month&m=2026-09' });
  });
  it('uploads and users', () => {
    expect(storedTarget(n({ type: 'upload_gap', area_id: undefined }), env()).link).toEqual({ to: '/upload' });
    expect(storedTarget(n({ type: 'upload_done', area_id: undefined }), env()).link).toEqual({ to: '/upload' });
    expect(storedTarget(n({ type: 'user_event', area_id: undefined }), env()).link).toEqual({ to: '/settings/users' });
  });
  it('no button when the person may not open the place', () => {
    expect(storedTarget(n({ type: 'upload_gap' }), env(['upload'])).link).toBeNull();
    expect(storedTarget(n({}), env(['events'])).link).toBeNull();
    expect(storedTarget(n({ type: 'user_event' }), env(['users'])).link).toBeNull();
    expect(storedTarget(n({ type: 'upload_gap' }), env(['upload'])).label).toBe('Open Upload');
  });
});
