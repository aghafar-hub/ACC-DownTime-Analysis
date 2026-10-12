// Joins what the server returned (stored alerts and updates, the person's own state and preferences) with the action
// items the app derived, and works out what the person sees and what the badge counts. Also the optimistic updates for
// seen / snoozed / dismissed (with rollback). Pure: the clock is passed in.
import type { Notification, NotificationState, NotificationStateValue } from '../api/types';
import { formatStamp, parseStamp } from './age';
import type { FeedItem } from './model';
import { wanted, type Prefs } from './prefs';

export interface FeedInput {
  stored: readonly Notification[];
  /** the caller's own state rows */
  state: readonly NotificationState[];
  prefs: Prefs;
  derived: readonly FeedItem[];
  nowMs: number;
  /** turns a stored notification into the item's link and button label */
  target: (n: Notification) => Pick<FeedItem, 'link' | 'linkLabel'>;
}

export interface Feed {
  /** what the panel shows: action items first, then alerts, then updates (each newest first) */
  items: FeedItem[];
  /** open action items: the red badge */
  actionCount: number;
  /** visible alerts the person has not opened yet: the amber dot */
  unseenAlerts: number;
  /** ids of visible alerts and updates not opened yet */
  unseenIds: string[];
}

export const stateMap = (rows: readonly NotificationState[]): Map<string, NotificationState> => new Map(rows.map((r) => [r.notification_id, r]));

/** True while a snooze is running. A snooze that has ended no longer hides the item. */
export function isSnoozed(s: NotificationState | undefined, nowMs: number): boolean {
  if (!s || s.state !== 'snoozed') return false;
  const until = parseStamp(s.snooze_until);
  return until !== null && until > nowMs;
}

/** Hidden by the person's own choice: dismissed, or snoozed and not yet due. */
export const isHidden = (s: NotificationState | undefined, nowMs: number): boolean => s?.state === 'dismissed' || isSnoozed(s, nowMs);

export function buildFeed(input: FeedInput): Feed {
  const { prefs, nowMs } = input;
  const states = stateMap(input.state);
  const stored: FeedItem[] = [];
  for (const n of input.stored) {
    if (n.status !== 'open') continue;
    if (n.expires_at) {
      const exp = parseStamp(n.expires_at);
      if (exp !== null && exp <= nowMs) continue;
    }
    if (!wanted(n, prefs)) continue;
    const s = states.get(n.notification_id);
    if (isHidden(s, nowMs)) continue;
    const tg = input.target(n);
    stored.push({
      id: n.notification_id, kind: n.severity === 'alert' ? 'alert' : 'update', type: n.type, title: n.title, detail: n.detail ?? '',
      area_id: n.area_id ?? '', line_id: n.line_id ?? '', created_at: n.created_at, source_ref: n.source_ref ?? '', dedupe_key: n.dedupe_key,
      link: tg.link, linkLabel: tg.linkLabel, unseen: s?.state !== 'seen',
    });
  }
  // newest first, stable by id
  stored.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : 1));
  const alerts = stored.filter((i) => i.kind === 'alert');
  const updates = stored.filter((i) => i.kind === 'update');
  return {
    items: [...input.derived, ...alerts, ...updates],
    actionCount: input.derived.length,
    unseenAlerts: alerts.filter((i) => i.unseen).length,
    unseenIds: stored.filter((i) => i.unseen).map((i) => i.id),
  };
}

/** The badge text: the number, capped at 99+. */
export const badgeText = (n: number): string => (n > 99 ? '99+' : String(n));

// ---------------------------------------------------------------- optimistic updates

export const snoozeUntilStamp = (days: number, nowMs: number): string => formatStamp(nowMs + days * 86_400_000);

/** The rows with this notification's state set (added or replaced). */
export function withState(
  rows: readonly NotificationState[], userId: string, id: string, state: NotificationStateValue, snoozeUntil: string | undefined, nowMs: number,
): NotificationState[] {
  const row: NotificationState = { user_id: userId, notification_id: id, state, snooze_until: state === 'snoozed' ? snoozeUntil ?? '' : '', updated_at: formatStamp(nowMs) };
  const at = rows.findIndex((r) => r.notification_id === id);
  if (at < 0) return [...rows, row];
  const next = rows.slice();
  next[at] = row;
  return next;
}

/** Puts one notification's row back to what it was (undefined: there was none). The rollback after a refused save. */
export function restoreState(rows: readonly NotificationState[], id: string, previous: NotificationState | undefined): NotificationState[] {
  const rest = rows.filter((r) => r.notification_id !== id);
  return previous ? [...rest, previous] : rest;
}

/** Replaces the row with what the server answered. */
export function settleState(rows: readonly NotificationState[], saved: NotificationState): NotificationState[] {
  return [...rows.filter((r) => r.notification_id !== saved.notification_id), saved];
}
