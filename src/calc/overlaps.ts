// Finds events of the same area that cover the same time. Two events that only touch (one
// restarts at the very second the next stops) do not overlap. Voided events and events with a
// blocking problem are ignored. Pure and deterministic; a year of events takes a few milliseconds.
import type { EventRow } from '../api/types';
import { isBlocked } from './flags';

const ms = (ts: string): number => Date.parse(ts.replace(' ', 'T') + 'Z');

export interface OverlapResult {
  /** event ids that overlap at least one other event of the same area */
  ids: Set<string>;
  /** for each such event, the ids it overlaps */
  partners: Map<string, string[]>;
  /** overlapping pairs found */
  pairs: number;
}

/** tolerance: overlaps of up to this many seconds are ignored (default 1, as rows are timed to the second) */
export function findOverlaps(events: readonly EventRow[], toleranceS = 1): OverlapResult {
  const byArea = new Map<string, { id: string; a: number; b: number }[]>();
  for (const e of events) {
    if (e.is_void || isBlocked(e)) continue;
    const a = ms(e.stop_ts);
    const b = ms(e.start_ts);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const list = byArea.get(e.area_id) ?? [];
    list.push({ id: e.event_id, a, b });
    byArea.set(e.area_id, list);
  }
  const ids = new Set<string>();
  const partners = new Map<string, string[]>();
  let pairs = 0;
  const tol = toleranceS * 1000;
  const link = (x: string, y: string): void => {
    ids.add(x);
    ids.add(y);
    (partners.get(x) ?? partners.set(x, []).get(x))!.push(y);
    (partners.get(y) ?? partners.set(y, []).get(y))!.push(x);
  };
  for (const list of byArea.values()) {
    list.sort((p, q) => p.a - q.a || p.b - q.b);
    let active: { id: string; a: number; b: number }[] = [];
    for (const cur of list) {
      active = active.filter((x) => x.b - tol > cur.a); // still running when `cur` starts
      for (const x of active) {
        link(x.id, cur.id);
        pairs++;
      }
      active.push(cur);
    }
  }
  return { ids, partners, pairs };
}
