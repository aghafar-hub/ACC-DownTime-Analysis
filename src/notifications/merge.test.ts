import { describe, expect, it } from 'vitest';
import type { Notification, NotificationState } from '../api/types';
import { formatStamp } from './age';
import { applyRecent, badgeText, buildFeed, RECENT_KEEP_MS, isHidden, isSnoozed, restoreState, settleState, snoozeUntilStamp, stateMap, withState } from './merge';
import { groupItems, type FeedItem } from './model';
import { parsePrefs } from './prefs';

const NOW = new Date(2026, 9, 12, 14, 0, 0).getTime();
const stamp = (offsetH: number): string => formatStamp(NOW + offsetH * 3_600_000);

const note = (id: string, over: Partial<Notification> = {}): Notification => ({
  notification_id: id, type: 'long_stop', severity: 'alert', dedupe_key: `long_stop|${id}`, title: `Title ${id}`, detail: 'd', area_id: 'K.1', line_id: 'L.1',
  source_ref: 'EV-1', created_at: stamp(-2), expires_at: stamp(24 * 30), status: 'open', ...over,
});
const st = (id: string, state: NotificationState['state'], until?: string): NotificationState => ({ user_id: 'U1', notification_id: id, state, snooze_until: until, updated_at: stamp(-1) });
const action = (id: string): FeedItem => ({
  id: `action:${id}`, kind: 'action', type: 'validate', title: id, detail: '', area_id: '', line_id: '', created_at: '', source_ref: '', dedupe_key: `action|${id}`,
  link: { to: '/validate' }, linkLabel: 'Open', unseen: false,
});
const target = () => ({ link: { to: '/x' }, linkLabel: 'Go' });
const feed = (over: Partial<Parameters<typeof buildFeed>[0]> = {}) =>
  buildFeed({ stored: [], state: [], prefs: parsePrefs({}), derived: [], nowMs: NOW, target, ...over });

describe('buildFeed', () => {
  it('puts action items first, then alerts, then updates (newest first), and counts', () => {
    const f = feed({
      derived: [action('a'), action('b')],
      stored: [
        note('old', { created_at: stamp(-30) }), note('new', { created_at: stamp(-1) }),
        note('up', { type: 'upload_done', severity: 'update', area_id: '', created_at: stamp(-3) }),
      ],
    });
    expect(f.items.map((i) => i.id)).toEqual(['action:a', 'action:b', 'new', 'old', 'up']);
    expect(f.actionCount).toBe(2);
    expect(f.unseenAlerts).toBe(2);
    expect(f.unseenIds).toEqual(['new', 'up', 'old']);
    expect(groupItems(f.items).map((g) => [g.kind, g.items.length])).toEqual([['action', 2], ['alert', 2], ['update', 1]]);
  });
  it('hides empty groups and counts nothing for an empty feed', () => {
    const f = feed();
    expect(f.items).toEqual([]);
    expect(groupItems(f.items)).toEqual([]);
    expect(f.actionCount + f.unseenAlerts).toBe(0);
  });
  it('seen alerts stay listed but no longer count for the amber dot; updates never do', () => {
    const f = feed({
      stored: [note('a'), note('b'), note('u', { type: 'upload_done', severity: 'update', area_id: '' })],
      state: [st('a', 'seen')],
    });
    expect(f.items).toHaveLength(3);
    expect(f.unseenAlerts).toBe(1);
    expect(f.items.find((i) => i.id === 'a')!.unseen).toBe(false);
  });
  it('dismissed items are hidden', () => {
    const f = feed({ stored: [note('a'), note('b')], state: [st('a', 'dismissed')] });
    expect(f.items.map((i) => i.id)).toEqual(['b']);
  });
  it('snoozed items are hidden until snooze_until, then come back', () => {
    const state = [st('a', 'snoozed', stamp(24))];
    expect(feed({ stored: [note('a')], state }).items).toEqual([]);
    expect(feed({ stored: [note('a')], state, nowMs: NOW + 25 * 3_600_000 }).items.map((i) => i.id)).toEqual(['a']);
    // a snooze that has ended no longer counts as seen
    expect(feed({ stored: [note('a')], state, nowMs: NOW + 25 * 3_600_000 }).unseenAlerts).toBe(1);
  });
  it('applies the watched areas and the alert types', () => {
    const stored = [note('k1', { area_id: 'K.1' }), note('rm', { area_id: 'RM.2' }), note('gap', { type: 'upload_gap', area_id: '' })];
    expect(feed({ stored, prefs: parsePrefs({ watch_areas: 'RM.2' }) }).items.map((i) => i.id).sort()).toEqual(['gap', 'rm']);
    expect(feed({ stored, prefs: parsePrefs({ alert_types: 'upload_gap' }) }).items.map((i) => i.id)).toEqual(['gap']);
    // watching areas never hides the action items
    expect(feed({ stored, derived: [action('v')], prefs: parsePrefs({ watch_areas: 'ZZ' }) }).items.map((i) => i.id)).toEqual(['action:v', 'gap']);
  });
  it('leaves out resolved, expired and past-expiry rows', () => {
    const stored = [note('ok'), note('res', { status: 'resolved' }), note('exp', { status: 'expired' }), note('late', { expires_at: stamp(-1) })];
    expect(feed({ stored }).items.map((i) => i.id)).toEqual(['ok']);
  });
  it('takes the link from the target function', () => {
    expect(feed({ stored: [note('a')] }).items[0]).toMatchObject({ link: { to: '/x' }, linkLabel: 'Go', area_id: 'K.1', kind: 'alert' });
  });
});

describe('snooze helpers', () => {
  it('isSnoozed / isHidden follow the clock', () => {
    expect(isSnoozed(st('a', 'snoozed', stamp(1)), NOW)).toBe(true);
    expect(isSnoozed(st('a', 'snoozed', stamp(-1)), NOW)).toBe(false);
    expect(isSnoozed(st('a', 'seen'), NOW)).toBe(false);
    expect(isHidden(st('a', 'dismissed'), NOW)).toBe(true);
    expect(isHidden(undefined, NOW)).toBe(false);
  });
  it('snoozeUntilStamp is days ahead in the stored spelling', () => {
    expect(snoozeUntilStamp(1, NOW)).toBe('2026-10-13 14:00:00.000');
    expect(snoozeUntilStamp(7, NOW)).toBe('2026-10-19 14:00:00.000');
  });
});

describe('optimistic updates and rollback', () => {
  const base = [st('a', 'seen'), st('b', 'seen')];
  it('withState adds or replaces one row and leaves the rest alone', () => {
    const next = withState(base, 'U1', 'c', 'dismissed', undefined, NOW);
    expect(next.map((r) => [r.notification_id, r.state])).toEqual([['a', 'seen'], ['b', 'seen'], ['c', 'dismissed']]);
    const snoozed = withState(base, 'U1', 'a', 'snoozed', stamp(24), NOW);
    expect(snoozed[0]).toMatchObject({ notification_id: 'a', state: 'snoozed', snooze_until: stamp(24) });
    expect(base[0]!.state).toBe('seen'); // input untouched
  });
  it('a seen or dismissed row has no snooze time', () => {
    expect(withState([], 'U1', 'a', 'dismissed', stamp(5), NOW)[0]!.snooze_until).toBe('');
  });
  it('restoreState puts the earlier row back, or removes the row that did not exist', () => {
    const changed = withState(base, 'U1', 'a', 'dismissed', undefined, NOW);
    expect(stateMap(restoreState(changed, 'a', base[0])).get('a')!.state).toBe('seen');
    const added = withState(base, 'U1', 'c', 'seen', undefined, NOW);
    expect(restoreState(added, 'c', undefined).map((r) => r.notification_id).sort()).toEqual(['a', 'b']);
  });
  it('a refused dismiss brings the item back into the feed', () => {
    const stored = [note('a')];
    const optimistic = withState([], 'U1', 'a', 'dismissed', undefined, NOW);
    expect(feed({ stored, state: optimistic }).items).toEqual([]);
    expect(feed({ stored, state: restoreState(optimistic, 'a', undefined) }).items.map((i) => i.id)).toEqual(['a']);
  });
  it('settleState swaps in the server answer', () => {
    const saved = st('a', 'snoozed', stamp(24));
    const next = settleState(base, saved);
    expect(next).toHaveLength(2);
    expect(stateMap(next).get('a')).toBe(saved);
  });
});

describe('badgeText', () => {
  it('caps at 99+', () => {
    expect(badgeText(7)).toBe('7');
    expect(badgeText(99)).toBe('99');
    expect(badgeText(100)).toBe('99+');
  });
});

describe('a dismiss made here never comes back with an older server answer (inspection)', () => {
  const row = (state: NotificationState['state'], ms: number): NotificationState => ({ user_id: 'U1', notification_id: 'N1', state, snooze_until: '', updated_at: formatStamp(ms) });
  it('applies the recent change over a server answer that does not hold it yet', () => {
    const dismissed = row('dismissed', NOW - 1000);
    expect(applyRecent([], [{ row: dismissed, at: NOW - 1000 }], NOW)).toEqual([dismissed]);
    expect(applyRecent([row('seen', NOW - 60_000)], [{ row: dismissed, at: NOW - 1000 }], NOW)).toEqual([dismissed]);
  });
  it('a newer server row wins (changed later on another device); old changes are left to the server', () => {
    const later = row('seen', NOW);
    expect(applyRecent([later], [{ row: row('dismissed', NOW - 1000), at: NOW - 1000 }], NOW)).toEqual([later]);
    expect(applyRecent([], [{ row: row('dismissed', NOW - RECENT_KEEP_MS - 1), at: NOW - RECENT_KEEP_MS - 1 }], NOW)).toEqual([]);
  });
});

