// Areas switched off (areas.active = FALSE, Settings > Areas, Admin only; backend 1.5.0). The ONE place the app leaves
// out the records of inactive areas: the event hooks (useEventsForYears in src/dashboard/useDash.ts and useEvents in
// src/data/useEvents.ts) split every loaded list here, so the dashboards, Pareto, Repeats, Reliability, month vs month,
// Reports, exports, Event records, Validate, the data status strip and the notification feed all see the same rows, as
// if those records did not exist. The area lists already honour `active` (areasInScope, areaOptions, the Reports builder,
// the timeline), so the scheduled time T of availability never includes an inactive area. The records stay stored and
// stay in the device cache; switching the area on again brings them back at once. Pure: no React.
import type { Area, EventRow, Startup } from '../api/types';

const EMPTY: readonly string[] = [];

/** The areas switched off, in list order. */
export function inactiveAreas(startup: Pick<Startup, 'areas'> | null | undefined): Area[] {
  if (!startup) return [];
  return startup.areas.filter((a) => a.active === false).sort((a, b) => a.sort_order - b.sort_order || a.area_id.localeCompare(b.area_id));
}

const idsMemo = new WeakMap<object, readonly string[]>();
/** Ids of the areas switched off (sorted; the same array for the same start-up payload). */
export function inactiveAreaIds(startup: Pick<Startup, 'areas'> | null | undefined): readonly string[] {
  if (!startup) return EMPTY;
  let ids = idsMemo.get(startup);
  if (!ids) {
    const list = startup.areas.filter((a) => a.active === false).map((a) => a.area_id).sort();
    ids = list.length ? list : EMPTY;
    idsMemo.set(startup, ids);
  }
  return ids;
}

export interface SplitRows {
  /** the records of active areas: what every page counts */
  rows: EventRow[];
  /** the records of inactive areas: left out everywhere (Validate says how many need checking) */
  hidden: EventRow[];
}

const NONE: EventRow[] = [];
const splitMemo = new WeakMap<EventRow[], { key: string; value: SplitRows }>();

/**
 * Splits loaded records into those of active areas and those of inactive ones. With no area switched off the input
 * array itself comes back (no copy, the memo keys of the pages stay the same). Memoised per input array and set of ids.
 */
export function splitInactive(rows: EventRow[], inactiveIds: readonly string[]): SplitRows {
  if (inactiveIds.length === 0) return { rows, hidden: NONE };
  const key = inactiveIds.join('|');
  const hit = splitMemo.get(rows);
  if (hit && hit.key === key) return hit.value;
  const off = new Set(inactiveIds);
  const kept: EventRow[] = [];
  const hidden: EventRow[] = [];
  for (const r of rows) (off.has(r.area_id) ? hidden : kept).push(r);
  const value: SplitRows = hidden.length ? { rows: kept, hidden } : { rows, hidden: NONE };
  splitMemo.set(rows, { key, value });
  return value;
}

/** The records of active areas only. */
export function withoutInactive(rows: EventRow[], startup: Pick<Startup, 'areas'> | null | undefined): EventRow[] {
  return splitInactive(rows, inactiveAreaIds(startup)).rows;
}
