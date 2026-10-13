// "Since your last visit": what changed in the loaded data after the person's last-seen time. Pure.
// An event is new when it was stored after that time (created_at); events without a created_at count by their
// event date (new when the date is after the last-seen day).
import type { EventRow } from '../api/types';
import { buildFailureEvents, findRepeatedFailures, isBlocked, isFailureHead, type CodeLookup, type CalcSettings } from '../calc';
import { parseStamp } from './age';

export interface SinceInput {
  events: readonly EventRow[];
  /** plant-local timestamp; blank = no baseline yet (nothing is reported) */
  lastSeenAt: string;
  /** repeated-failure rule and code lookup; without them new repeated groups are not counted (0) */
  repeat?: { settings: Pick<CalcSettings, 'repeatMinEvents' | 'repeatWindowDays'>; lookup?: CodeLookup };
  /** stored alerts that appeared after the last visit and are still open */
  newAlerts?: number;
}

export interface SinceSummary {
  newEvents: number;
  newFailures: number;
  /** stopped hours of the new failures that count in the numbers */
  failureHours: number;
  /** the area with the most new failures */
  topArea: { areaId: string; failures: number } | null;
  newRepeatGroups: number;
  newAlerts: number;
  /** true when there is something to say */
  any: boolean;
}

/** True when the event was stored after `lastSeenAt` (the timestamp text is compared as a time). */
export function isNewEvent(e: Pick<EventRow, 'created_at' | 'event_date'>, lastSeenMs: number, lastSeenDate: string): boolean {
  const created = parseStamp(e.created_at);
  if (created !== null) return created > lastSeenMs;
  return String(e.event_date ?? '') > lastSeenDate;
}

export const EMPTY_SINCE: SinceSummary = { newEvents: 0, newFailures: 0, failureHours: 0, topArea: null, newRepeatGroups: 0, newAlerts: 0, any: false };

export function computeSince(input: SinceInput): SinceSummary {
  const lastMs = parseStamp(input.lastSeenAt);
  if (lastMs === null) return EMPTY_SINCE;
  const lastDate = input.lastSeenAt.slice(0, 10);
  const live = input.events.filter((e) => !e.is_void);
  const fresh = live.filter((e) => isNewEvent(e, lastMs, lastDate));
  let failures = 0;
  let seconds = 0;
  const perArea = new Map<string, number>();
  for (const e of fresh) {
    if (!isFailureHead(e) || isBlocked(e)) continue; // P2: failure events (Freq 1, Failure YES, not PL / CIR)
    failures++;
    if (e.duration_s > 0) seconds += e.duration_s;
    perArea.set(e.area_id, (perArea.get(e.area_id) ?? 0) + 1);
  }
  let top: SinceSummary['topArea'] = null;
  for (const [areaId, n] of [...perArea.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    top = { areaId, failures: n };
    break;
  }
  let groups = 0;
  if (input.repeat && fresh.length > 0) {
    const keys = (rows: EventRow[]) => new Set(findRepeatedFailures(buildFailureEvents(rows).chains, { settings: input.repeat!.settings, lookup: input.repeat!.lookup }).groups.map((g) => g.key));
    const before = keys(live.filter((e) => !isNewEvent(e, lastMs, lastDate)));
    for (const k of keys(live)) if (!before.has(k)) groups++;
  }
  const newAlerts = input.newAlerts ?? 0;
  return {
    newEvents: fresh.length, newFailures: failures, failureHours: seconds / 3600, topArea: top, newRepeatGroups: groups, newAlerts,
    any: fresh.length > 0 || newAlerts > 0,
  };
}

/** Stored alerts created after the last visit that are still open. */
export function countNewAlerts(alerts: readonly { created_at: string }[], lastSeenAt: string): number {
  const last = parseStamp(lastSeenAt);
  if (last === null) return 0;
  return alerts.filter((a) => (parseStamp(a.created_at) ?? 0) > last).length;
}
