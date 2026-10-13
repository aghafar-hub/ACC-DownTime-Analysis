// The person's notification preferences (notification_prefs): parsing, the alert-type groups the UI offers, and the
// rules for which stored items they see. Pure.
import type { Notification, NotificationPrefs, NotificationType } from '../api/types';
import { NOTIFICATION_TYPES } from '../api/types';

export type Digest = 'none' | 'daily' | 'weekly';
export interface Prefs {
  /** enabled types; every type when the person never chose */
  alertTypes: NotificationType[];
  /** followed area ids; empty = all areas */
  watchAreas: string[];
  digest: Digest;
  /** plant-local timestamp, '' when never saved */
  lastSeenAt: string;
  /** saved views as stored (JSON text, '' when none); read with src/views/savedViews.ts */
  savedViews: string;
  /** saved report templates as stored (JSON text, '' when none); read with src/reports/savedTemplates.ts */
  savedReports: string;
}

const csv = (v: string | undefined): string[] => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export function parsePrefs(raw: NotificationPrefs | undefined | null): Prefs {
  const r = raw ?? {};
  const types = csv(r.alert_types).filter((x): x is NotificationType => (NOTIFICATION_TYPES as string[]).includes(x));
  const digest = r.digest === 'daily' || r.digest === 'weekly' ? r.digest : 'none';
  return {
    alertTypes: types.length ? types : [...NOTIFICATION_TYPES],
    watchAreas: [...new Set(csv(r.watch_areas))],
    digest,
    lastSeenAt: (r.last_seen_at ?? '').trim(),
    savedViews: r.saved_views ?? '',
    savedReports: r.saved_reports ?? '',
  };
}

/** What the person can switch on or off. "Updates" covers uploads and user changes. */
export interface AlertTypeGroup { id: string; label: string; help: string; types: NotificationType[] }
export const ALERT_TYPE_GROUPS: AlertTypeGroup[] = [
  { id: 'long_stop', label: 'Long stops', help: 'A failure stopped an area for longer than the limit.', types: ['long_stop'] },
  { id: 'repeat_group', label: 'Repeated failures', help: 'The same code and reason failed again and again.', types: ['repeat_group'] },
  { id: 'failure_spike', label: 'Failure spikes', help: 'An area had many more failures than in the period before.', types: ['failure_spike'] },
  { id: 'availability_low', label: 'Availability below target', help: 'An area ended its latest month under the target.', types: ['availability_low'] },
  { id: 'upload_gap', label: 'No recent upload', help: 'No new data has arrived for a while.', types: ['upload_gap'] },
  { id: 'updates', label: 'Updates', help: 'Workbook uploads and, for administrators, user changes.', types: ['upload_done', 'user_event'] },
];

/** Groups that are fully on. */
export function enabledGroups(types: readonly NotificationType[]): string[] {
  return ALERT_TYPE_GROUPS.filter((g) => g.types.every((x) => types.includes(x))).map((g) => g.id);
}

/** The stored value for the chosen groups: blank when everything is on (the server reads blank as all). null when nothing is chosen (not storable). */
export function serializeAlertTypes(groupIds: readonly string[]): string | null {
  const types = ALERT_TYPE_GROUPS.filter((g) => groupIds.includes(g.id)).flatMap((g) => g.types);
  if (types.length === 0) return null;
  return types.length === NOTIFICATION_TYPES.length ? '' : types.join(',');
}

export function serializeAreas(areas: readonly string[]): string {
  return [...new Set(areas)].join(',');
}

/** Alerts and updates the person wants: the type is switched on and the area is followed (an item without an area always matches). */
export function wanted(n: Pick<Notification, 'type' | 'area_id'>, prefs: Prefs): boolean {
  if (!prefs.alertTypes.includes(n.type)) return false;
  if (prefs.watchAreas.length === 0 || !n.area_id) return true;
  const lower = prefs.watchAreas.map((a) => a.toLowerCase());
  return lower.includes(n.area_id.toLowerCase());
}
