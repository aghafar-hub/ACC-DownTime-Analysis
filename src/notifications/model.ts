// Shared shapes of the notification feed: one list of items the bell, the panel and the badges all read.
// Pure types, no React.
import type { NotificationType } from '../api/types';

/** Action items are derived by the app from live data (never stored). */
export type ActionType = 'validate' | 'unknown_code' | 'needs_review';
export type ItemKind = 'action' | 'alert' | 'update';

/** Where the primary button goes: a router path (with query) and optional router state. */
export interface NotifLink { to: string; state?: unknown }

export interface FeedItem {
  /** notification_id for stored items, 'action:...' for derived ones */
  id: string;
  kind: ItemKind;
  type: NotificationType | ActionType;
  title: string;
  /** one line */
  detail: string;
  area_id: string;
  line_id: string;
  /** plant-local 'YYYY-MM-DD HH:MM:SS.mmm'; blank for derived action items (they are live conditions) */
  created_at: string;
  source_ref: string;
  dedupe_key: string;
  /** null: the person may not open the place that fixes it, so the row has no primary button */
  link: NotifLink | null;
  linkLabel: string;
  /** alerts and updates the person has not opened yet */
  unseen: boolean;
}

export const KIND_ORDER: ItemKind[] = ['action', 'alert', 'update'];
export const KIND_LABEL: Record<ItemKind, string> = { action: 'Action', alert: 'Alert', update: 'Update' };
export const GROUP_LABEL: Record<ItemKind, string> = { action: 'Action needed', alert: 'Alerts', update: 'Updates' };

/** The items in panel order (Action needed, Alerts, Updates); empty groups are left out. */
export function groupItems(items: readonly FeedItem[]): { kind: ItemKind; items: FeedItem[] }[] {
  return KIND_ORDER.map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0);
}
