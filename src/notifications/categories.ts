// The inbox categories of the Notifications page (backend 1.4.0): Reliability, Availability & planned, Data quality,
// Actions, System. Stored items take the category of their type; the items the app derives itself (records to check,
// unknown codes, equipment to review) are Data quality. Also the short type names and the day groups. Pure.
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_OF, type NotificationCategory, type NotificationType } from '../api/types';
import { t } from '../i18n/t';
import type { FeedItem } from './model';

export const CATEGORIES = NOTIFICATION_CATEGORIES;
export type CategoryFilter = 'all' | NotificationCategory;

export function categoryOf(item: Pick<FeedItem, 'kind' | 'type'>): NotificationCategory {
  if (item.kind === 'action') return 'Data quality';
  return NOTIFICATION_CATEGORY_OF[item.type as NotificationType] ?? 'System';
}

export const CATEGORY_ICON: Record<NotificationCategory, string> = {
  Reliability: 'graphs', 'Availability & planned': 'target', 'Data quality': 'shield', Actions: 'flag', System: 'settings',
};
/** CSS key of a category ('availability-planned' ...). */
export const categoryKey = (c: string): string => c.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-+$/, '');

const TYPE_LABEL: Record<string, string> = {
  long_stop: 'Long stop', repeat_group: 'Repeated failure', failure_spike: 'Failure spike', availability_low: 'Availability below target',
  planned_overrun: 'Planned overrun', upload_gap: 'No upload', upload_done: 'Upload', action_due: 'Overdue', user_event: 'Users',
  validate: 'Records to check', unknown_code: 'Unknown code', needs_review: 'Equipment to review',
};
export const typeLabel = (type: string): string => t(TYPE_LABEL[type] ?? type);

/** 'Create action' is offered on alerts about the plant (not on overdue-action reminders, updates or derived items). */
export const canCreateFrom = (item: Pick<FeedItem, 'kind' | 'type'>): boolean => item.kind === 'alert' && item.type !== 'action_due';

export function countByCategory(items: readonly FeedItem[]): Record<NotificationCategory, { total: number; fresh: number }> {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, { total: 0, fresh: 0 }])) as Record<NotificationCategory, { total: number; fresh: number }>;
  for (const i of items) {
    const c = out[categoryOf(i)];
    c.total++;
    if (i.unseen || i.kind === 'action') c.fresh++;
  }
  return out;
}

export type DayGroup = 'live' | 'today' | 'yesterday' | 'week' | 'older';
export const DAY_GROUP_LABEL: Record<DayGroup, string> = {
  live: 'Needs action now', today: 'Today', yesterday: 'Yesterday', week: 'Earlier this week', older: 'Older',
};

const dayNo = (d: Date): number => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
const parse = (ts: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(ts);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)) : null;
};

/** Which day group an item goes under (derived items have no time: 'live'). */
export function dayGroupOf(createdAt: string, nowMs: number): DayGroup {
  const d = parse(createdAt);
  if (!d) return 'live';
  const diff = dayNo(new Date(nowMs)) - dayNo(d);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return 'week';
  return 'older';
}

/** The items in day groups, in this order: live, today, yesterday, this week, older (empty groups left out). */
export function groupByDay(items: readonly FeedItem[], nowMs: number): { group: DayGroup; items: FeedItem[] }[] {
  const order: DayGroup[] = ['live', 'today', 'yesterday', 'week', 'older'];
  const map = new Map<DayGroup, FeedItem[]>();
  for (const i of items) {
    const g = dayGroupOf(i.created_at, nowMs);
    map.set(g, [...(map.get(g) ?? []), i]);
  }
  return order.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }));
}
