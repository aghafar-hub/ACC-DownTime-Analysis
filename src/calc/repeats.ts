/** Repeated failures: same equipment code and reason, several failure events inside a sliding window. */
import type { ChainedEvent } from './events';
import { analysableChains, chainHours } from './events';
import { matchKey, rowCode, type CodeLookup } from './normalize';
import type { CalcSettings } from './settings';
import { MS_DAY, formatDate, rangeToInterval, type DateRange } from './time';

export interface RepeatOptions {
  settings: Pick<CalcSettings, 'repeatMinEvents' | 'repeatWindowDays'>;
  /** Report recurrences that started in this window. History before it is still used to find clusters. */
  window?: DateRange;
  /** Counted per group as previousPeriodOccurrences (all failure events of the group in this window). */
  previousWindow?: DateRange;
  lookup?: CodeLookup;
  /** keep events with a blank reason (default false: a blank reason says nothing about "same reason") */
  includeBlankReason?: boolean;
}

export interface RepeatGroup {
  /** `${equipment code}|${reason match key}` */
  key: string;
  equipmentId: string;
  reasonKey: string;
  reasonLabel: string;
  areaIds: string[];
  /** events in qualifying clusters that started in the window */
  occurrences: number;
  totalHours: number;
  avgHours: number;
  maxHours: number;
  /** YYYY-MM-DD of the latest occurrence */
  lastFailureDate: string;
  /** days between successive occurrences (start to start) */
  daysBetween: number[];
  /** recurrences = occurrences after the first of each cluster */
  recurrenceCount: number;
  previousPeriodOccurrences: number;
  eventIds: string[];
}

export interface RecurrenceEvent {
  eventId: string;
  groupKey: string;
  equipmentId: string;
  reasonLabel: string;
  areaId: string;
  startDate: string;
  hours: number;
  /** days since the previous failure in the same group (null for the first occurrence of the group in the data) */
  daysSincePrevious: number | null;
}

export interface RepeatResult {
  groups: RepeatGroup[];
  recurrences: RecurrenceEvent[];
}

interface Keyed { chain: ChainedEvent; equipmentId: string; reasonKey: string }

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

export function findRepeatedFailures(chains: ChainedEvent[], o: RepeatOptions): RepeatResult {
  const win = o.window ? rangeToInterval(o.window) : null;
  const prev = o.previousWindow ? rangeToInterval(o.previousWindow) : null;
  const groups: RepeatGroup[] = [];
  const recurrences: RecurrenceEvent[] = [];
  for (const [key, list] of groupChains(analysableChains(chains), o)) {
    list.sort((a, b) => a.chain.startMs - b.chain.startMs || (a.chain.id < b.chain.id ? -1 : 1));
    const clusters = findClusters(list.map((k) => k.chain.startMs), o.settings.repeatMinEvents, o.settings.repeatWindowDays);
    const inWin = (idx: number): boolean => win === null || (list[idx]!.chain.startMs >= win.fromMs && list[idx]!.chain.startMs < win.toMs);
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
    const hours = occ.map((i) => chainHours(list[i]!.chain));
    const first = list[0]!;
    const label = (first.chain.head.reason_raw ?? '').trim().replace(/\s+/g, ' ');
    const gaps: number[] = [];
    for (let k = 1; k < occ.length; k++) gaps.push((list[occ[k]!]!.chain.startMs - list[occ[k - 1]!]!.chain.startMs) / MS_DAY);
    const total = hours.reduce((s, h) => s + h, 0);
    groups.push({
      key, equipmentId: first.equipmentId, reasonKey: first.reasonKey, reasonLabel: label,
      areaIds: [...new Set(occ.map((i) => list[i]!.chain.area_id))].sort(),
      occurrences: occ.length, totalHours: total, avgHours: total / occ.length, maxHours: Math.max(...hours),
      lastFailureDate: formatDate(list[occ[occ.length - 1]!]!.chain.startMs),
      daysBetween: gaps, recurrenceCount: rec.length,
      previousPeriodOccurrences: prev ? list.filter((k) => k.chain.startMs >= prev.fromMs && k.chain.startMs < prev.toMs).length : 0,
      eventIds: occ.map((i) => list[i]!.chain.id),
    });
    for (const idx of rec) {
      const k = list[idx]!;
      recurrences.push({
        eventId: k.chain.id, groupKey: key, equipmentId: k.equipmentId, reasonLabel: label, areaId: k.chain.area_id,
        startDate: k.chain.startDate, hours: chainHours(k.chain),
        daysSincePrevious: idx > 0 ? (k.chain.startMs - list[idx - 1]!.chain.startMs) / MS_DAY : null,
      });
    }
  }
  groups.sort((a, b) => b.occurrences - a.occurrences || b.totalHours - a.totalHours || (a.key < b.key ? -1 : 1));
  recurrences.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.eventId < b.eventId ? -1 : 1));
  return { groups, recurrences };
}
