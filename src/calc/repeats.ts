/** Repeated failures: same equipment code and reason, several occurrences (failure events, merged across areas within 10 min) inside a sliding window. */
import type { ChainedEvent } from './events';
import { analysableChains, chainHours } from './events';
import { matchKey, rowCode, type CodeLookup } from './normalize';
import type { CalcSettings } from './settings';
import { MS_DAY, formatDate, rangeToInterval, type DateRange } from './time';

export interface RepeatOptions {
  settings: Pick<CalcSettings, 'repeatMinEvents' | 'repeatWindowDays'>;
  /** Report recurrences that started in this window. History before it is still used to find clusters. */
  window?: DateRange;
  /** Counted per group as previousPeriodOccurrences (all occurrences of the group in this window, merged across areas the same way). */
  previousWindow?: DateRange;
  lookup?: CodeLookup;
  /** keep events with a blank reason (default false: a blank reason says nothing about "same reason") */
  includeBlankReason?: boolean;
}

/** P5: the same code and reason in DIFFERENT areas starting within this many minutes is one occurrence. */
export const CROSS_AREA_MERGE_MINUTES = 10;
/** P5: an occurrence in the same area that starts less than this many minutes after the previous one restarted is a burst. */
export const BURST_GAP_MINUTES = 60;

export interface RepeatGroup {
  /** `${equipment code}|${reason match key}` */
  key: string;
  equipmentId: string;
  reasonKey: string;
  reasonLabel: string;
  areaIds: string[];
  /**
   * occurrences in qualifying clusters that started in the window. One occurrence = failure events of the group that
   * start within 10 minutes of each other in DIFFERENT areas (one cause seen by several areas); bursts still count.
   */
  occurrences: number;
  /** hours of the occurrences' failure events (each event's own length; area-hours when an occurrence spans areas) */
  totalHours: number;
  avgHours: number;
  maxHours: number;
  /** YYYY-MM-DD of the latest occurrence */
  lastFailureDate: string;
  /** days between successive occurrences (start to start) */
  daysBetween: number[];
  /** YYYY-MM-DD of every occurrence in the window, oldest first (the mini timeline of the investigation table) */
  occurrenceDates: string[];
  /** recurrences = occurrences after the first of each cluster */
  recurrenceCount: number;
  /** occurrences of the group (merged the same way) that started in the previous window, clustered or not */
  previousPeriodOccurrences: number;
  /** failure events of the occurrences (every area) */
  eventIds: string[];
  /**
   * occurrences in the window that are BURSTS: in an area where the previous occurrence of the group restarted less
   * than 1 h before. They are counted as occurrences too; shown apart so a quick re-trip is not read as a new problem.
   */
  burstCount: number;
  /** occurrences in the window that joined events of several areas (within 10 minutes) */
  mergedOccurrences: number;
}

export interface RecurrenceEvent {
  /** the first failure event of the occurrence */
  eventId: string;
  /** every failure event of the occurrence (several when areas were merged) */
  eventIds: string[];
  groupKey: string;
  equipmentId: string;
  reasonLabel: string;
  areaId: string;
  areaIds: string[];
  startDate: string;
  hours: number;
  /** days since the previous occurrence in the same group (null for the first occurrence of the group in the data) */
  daysSincePrevious: number | null;
  /** a burst: less than 1 h after the previous occurrence restarted in the same area */
  burst: boolean;
}

export interface RepeatResult {
  groups: RepeatGroup[];
  recurrences: RecurrenceEvent[];
}

interface Keyed { chain: ChainedEvent; equipmentId: string; reasonKey: string }

/** One occurrence: failure events of one group that start within 10 minutes in different areas. */
export interface Occurrence {
  members: ChainedEvent[];
  startMs: number;
  areaIds: string[];
  burst: boolean;
}

/**
 * Merge the failure events of ONE group (sorted by start) into occurrences: an event joins the current occurrence when it
 * starts at most CROSS_AREA_MERGE_MINUTES after the occurrence's first event and its area is not in it yet. Then each
 * occurrence is marked a burst when, in one of its areas, the previous occurrence restarted less than BURST_GAP_MINUTES
 * before this one stopped.
 */
export function groupOccurrences(sorted: ChainedEvent[]): Occurrence[] {
  const out: (Occurrence & { areas: Set<string> })[] = [];
  const mergeMs = CROSS_AREA_MERGE_MINUTES * 60_000;
  for (const c of sorted) {
    const cur = out[out.length - 1];
    if (cur && c.startMs - cur.startMs <= mergeMs && !cur.areas.has(c.area_id)) {
      cur.members.push(c);
      cur.areas.add(c.area_id);
    } else {
      out.push({ members: [c], startMs: c.startMs, areaIds: [], burst: false, areas: new Set([c.area_id]) });
    }
  }
  const lastEnd = new Map<string, number>();
  const gapMs = BURST_GAP_MINUTES * 60_000;
  for (const o of out) {
    for (const m of o.members) {
      const prev = lastEnd.get(m.area_id);
      if (prev !== undefined && m.startMs - prev < gapMs) o.burst = true;
    }
    for (const m of o.members) lastEnd.set(m.area_id, Math.max(lastEnd.get(m.area_id) ?? -Infinity, m.endMs));
    o.areaIds = [...o.areas].sort();
  }
  return out.map(({ areas: _a, ...o }) => o);
}

/**
 * Indices (sorted by start) of events that belong to a window of >= minEvents events whose start times differ
 * by at most windowDays (inclusive: exactly windowDays still qualifies). Clusters are the merged index runs.
 */
export function findClusters(startsMs: number[], minEvents: number, windowDays: number): number[][] {
  const w = windowDays * MS_DAY;
  const n = startsMs.length;
  const clusters: number[][] = [];
  let cur: number[] = [];
  let runEnd = -1;
  let e = 0;
  for (let i = 0; i < n; i++) {
    if (e < i) e = i;
    while (e + 1 < n && startsMs[e + 1]! - startsMs[i]! <= w) e++;
    if (e - i + 1 < minEvents) continue;
    if (i > runEnd) {
      if (cur.length) clusters.push(cur);
      cur = [];
      for (let k = i; k <= e; k++) cur.push(k);
    } else {
      for (let k = runEnd + 1; k <= e; k++) cur.push(k);
    }
    runEnd = Math.max(runEnd, e);
  }
  if (cur.length) clusters.push(cur);
  return clusters;
}

function groupChains(chains: ChainedEvent[], o: RepeatOptions): Map<string, Keyed[]> {
  const groups = new Map<string, Keyed[]>();
  for (const c of chains) {
    if (!c.isFailure) continue;
    const code = rowCode(c.head, o.lookup);
    if (code.kind === 'area_level') continue; // N/A is excluded
    const equipmentId = code.kind === 'equipment' ? code.equipmentId : code.key;
    const reasonKey = matchKey(c.head.reason_raw);
    if (reasonKey === '' && !o.includeBlankReason) continue;
    const key = `${code.kind === 'equipment' ? equipmentId.toUpperCase() : equipmentId}|${reasonKey}`;
    const list = groups.get(key);
    if (list) list.push({ chain: c, equipmentId, reasonKey });
    else groups.set(key, [{ chain: c, equipmentId, reasonKey }]);
  }
  return groups;
}

/**
 * The one count of repeated failures every page shows: the groups with at least two occurrences in the window (a group
 * whose earlier occurrences fall before the window is not listed) and the distinct failure events of those groups.
 */
export function listedRepeats(result: RepeatResult): { groups: RepeatGroup[]; eventIds: string[] } {
  const groups = result.groups.filter((g) => g.occurrences >= 2);
  return { groups, eventIds: [...new Set(groups.flatMap((g) => g.eventIds))] };
}

export function findRepeatedFailures(chains: ChainedEvent[], o: RepeatOptions): RepeatResult {
  const win = o.window ? rangeToInterval(o.window) : null;
  const prev = o.previousWindow ? rangeToInterval(o.previousWindow) : null;
  const groups: RepeatGroup[] = [];
  const recurrences: RecurrenceEvent[] = [];
  for (const [key, list] of groupChains(analysableChains(chains), o)) {
    list.sort((a, b) => a.chain.startMs - b.chain.startMs || (a.chain.id < b.chain.id ? -1 : 1));
    const occs = groupOccurrences(list.map((k) => k.chain));
    const clusters = findClusters(occs.map((x) => x.startMs), o.settings.repeatMinEvents, o.settings.repeatWindowDays);
    const inWin = (idx: number): boolean => win === null || (occs[idx]!.startMs >= win.fromMs && occs[idx]!.startMs < win.toMs);
    const occ: number[] = [];
    const rec: number[] = [];
    for (const cl of clusters) {
      cl.forEach((idx, pos) => {
        if (!inWin(idx)) return;
        occ.push(idx);
        if (pos > 0) rec.push(idx);
      });
    }
    if (rec.length === 0) continue;
    const hoursOf = (x: Occurrence): number => x.members.reduce((sum, c) => sum + chainHours(c), 0);
    const hours = occ.map((i) => hoursOf(occs[i]!));
    const first = list[0]!;
    const label = (first.chain.head.reason_raw ?? '').trim().replace(/\s+/g, ' ');
    const gaps: number[] = [];
    for (let k = 1; k < occ.length; k++) gaps.push((occs[occ[k]!]!.startMs - occs[occ[k - 1]!]!.startMs) / MS_DAY);
    const total = hours.reduce((sum, h) => sum + h, 0);
    groups.push({
      key, equipmentId: first.equipmentId, reasonKey: first.reasonKey, reasonLabel: label,
      areaIds: [...new Set(occ.flatMap((i) => occs[i]!.areaIds))].sort(),
      occurrences: occ.length, totalHours: total, avgHours: total / occ.length, maxHours: Math.max(...hours),
      lastFailureDate: formatDate(occs[occ[occ.length - 1]!]!.startMs),
      daysBetween: gaps, occurrenceDates: occ.map((i) => occs[i]!.members[0]!.startDate), recurrenceCount: rec.length,
      previousPeriodOccurrences: prev ? occs.filter((x) => x.startMs >= prev.fromMs && x.startMs < prev.toMs).length : 0,
      eventIds: occ.flatMap((i) => occs[i]!.members.map((c) => c.id)),
      burstCount: occ.filter((i) => occs[i]!.burst).length,
      mergedOccurrences: occ.filter((i) => occs[i]!.members.length > 1).length,
    });
    for (const idx of rec) {
      const x = occs[idx]!;
      const head = x.members[0]!;
      recurrences.push({
        eventId: head.id, eventIds: x.members.map((c) => c.id), groupKey: key, equipmentId: first.equipmentId, reasonLabel: label,
        areaId: head.area_id, areaIds: x.areaIds, startDate: head.startDate, hours: hoursOf(x),
        daysSincePrevious: idx > 0 ? (x.startMs - occs[idx - 1]!.startMs) / MS_DAY : null, burst: x.burst,
      });
    }
  }
  groups.sort((a, b) => b.occurrences - a.occurrences || b.totalHours - a.totalHours || (a.key < b.key ? -1 : 1));
  recurrences.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.eventId < b.eventId ? -1 : 1));
  return { groups, recurrences };
}
