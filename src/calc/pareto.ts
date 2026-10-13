/** Pareto analysis. Percentages are always against the COMPLETE filtered total, never the displayed top N. */
import { attributeRows, type Attribution } from './attribution';
import { analysableChains, chainHours, startedIn, type ChainedEvent } from './events';
import { areasOf, type MasterIndex } from './masters';
import { matchKey, resolvedKey, rowCode, type ResolvedCode } from './normalize';
import { rangeToInterval, type DateRange, type Interval } from './time';

export type TopN = 5 | 10 | 20 | 'all';
export type ParetoMeasure = 'hours' | 'count';
export const PARETO_REFERENCE_PCT = 80;

export interface ParetoEntry {
  key: string;
  label: string;
  value: number;
  eventIds: string[];
}

export interface ParetoBar {
  key: string;
  label: string;
  value: number;
  /** share of the complete total, percent */
  sharePct: number;
  /** running share of the complete total, percent */
  cumulativePct: number;
  /** the "Others" bucket (style it differently) */
  isOthers: boolean;
  /** underlying events for click-through (for Others: all merged events) */
  eventIds: string[];
  /** number of entries merged into this bar (1 for ordinary bars) */
  entryCount: number;
}

export interface ParetoResult {
  bars: ParetoBar[];
  /** the complete total over all entries (not just the shown bars) */
  total: number;
  /** entries before the top-N cut */
  entryCount: number;
  topN: TopN;
  referencePct: number;
  /** index of the first bar whose cumulative share reaches the reference, or null */
  referenceIndex: number | null;
}

/**
 * Sum entries with the same key. Zero and negative values are dropped. A bar only carries the event ids of the
 * entries that contribute to it (value > 0): an event worth 0 in the window (no hours inside it, or a count event
 * that started outside it) is not part of the bar, so opening the bar shows exactly the events it counts.
 */
export function mergeEntries(entries: ParetoEntry[]): ParetoEntry[] {
  const m = new Map<string, ParetoEntry>();
  for (const e of entries) {
    const ids = e.value > 0 ? e.eventIds : [];
    const cur = m.get(e.key);
    if (cur) {
      cur.value += e.value;
      cur.eventIds.push(...ids);
    } else m.set(e.key, { key: e.key, label: e.label, value: e.value, eventIds: [...ids] });
  }
  return [...m.values()].filter((e) => e.value > 0);
}

/** Descending bars, cumulative %, share % of the full total, top-N with an Others bar. */
export function buildPareto(entries: ParetoEntry[], topN: TopN = 'all'): ParetoResult {
  const sorted = mergeEntries(entries).sort((a, b) => b.value - a.value || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) || (a.key < b.key ? -1 : 1));
  const total = sorted.reduce((s, e) => s + e.value, 0);
  const pct = (v: number): number => (total > 0 ? (v / total) * 100 : 0);
  const cut = topN === 'all' ? sorted.length : topN;
  const shown = sorted.slice(0, cut);
  const rest = sorted.slice(cut);
  const bars: ParetoBar[] = [];
  let cum = 0;
  for (const e of shown) {
    cum += e.value;
    bars.push({ key: e.key, label: e.label, value: e.value, sharePct: pct(e.value), cumulativePct: pct(cum), isOthers: false, eventIds: e.eventIds, entryCount: 1 });
  }
  if (rest.length > 0) {
    const value = rest.reduce((s, e) => s + e.value, 0);
    bars.push({
      key: 'others', label: 'Others', value, sharePct: pct(value), cumulativePct: total > 0 ? 100 : 0,
      isOthers: true, eventIds: rest.flatMap((e) => e.eventIds), entryCount: rest.length,
    });
  }
  const idx = bars.findIndex((b) => b.cumulativePct >= PARETO_REFERENCE_PCT);
  return { bars, total, entryCount: sorted.length, topN, referencePct: PARETO_REFERENCE_PCT, referenceIndex: idx < 0 ? null : idx };
}

export interface ParetoSpec<T> {
  key: (item: T) => string;
  label: (item: T) => string;
  /** the measure: hours, a count (1 per item), anything additive */
  measure: (item: T) => number;
  eventId: (item: T) => string;
}

/** Generic Pareto over any items. */
export function pareto<T>(items: T[], spec: ParetoSpec<T>, topN: TopN = 'all'): ParetoResult {
  return buildPareto(items.map((i) => ({ key: spec.key(i), label: spec.label(i), value: spec.measure(i), eventIds: [spec.eventId(i)] })), topN);
}

// ---- builders over events (chains) ----

export interface ChainParetoOptions {
  measure: ParetoMeasure;
  /** hours are clipped to the window; events count where they start. Omit for no window. */
  window?: DateRange;
  topN?: TopN;
  /**
   * Who owns overlapping time (attribution.ts). Pass the attribution of the KPI scope so the Pareto hours equal the KPI
   * hours; default: the attribution of every row of the chains passed in (before any failure-only selection).
   */
  attribution?: Attribution;
}

/** The attribution to use for hours: the one given, else one over all rows of the chains passed in. Null for counts. */
export function attributionFor(chains: ChainedEvent[], o: { measure?: ParetoMeasure; attribution?: Attribution }): Attribution | undefined {
  if (o.measure === 'count') return undefined;
  return o.attribution ?? attributeRows(analysableChains(chains).flatMap((c) => c.rows));
}

function windowOf(o: { window?: DateRange }): Interval | null {
  return o.window ? rangeToInterval(o.window) : null;
}

/**
 * Value of one event for a measure. Hours: all rows of the chain, clipped to the window (a chain that started
 * before the window still contributes its hours inside it); with an attribution each row counts only the time it owns
 * (overlaps in one area counted once). Count: 1 if the event started in the window.
 */
export function chainValue(c: ChainedEvent, measure: ParetoMeasure, window: Interval | null, attr?: Attribution): number {
  if (measure === 'hours') return chainHours(c, window, attr);
  return window === null || startedIn(c, window) ? 1 : 0;
}

function chainPareto(
  chains: ChainedEvent[], o: ChainParetoOptions, keyOf: (c: ChainedEvent) => string, labelOf: (c: ChainedEvent) => string,
  attr: Attribution | undefined,
): ParetoResult {
  const w = windowOf(o);
  return pareto(analysableChains(chains), { key: keyOf, label: labelOf, measure: (c) => chainValue(c, o.measure, w, attr), eventId: (c) => c.id }, o.topN ?? 'all');
}

export interface EquipmentParetoResult {
  /** codes that belong to the stopped area (any of the code's areas): the equipment Pareto proper */
  own: ParetoResult;
  /** valid codes that belong to other areas only: "stopped by other areas" */
  otherAreas: ParetoResult;
  /** valid codes that are in no area at all */
  unassigned: ParetoResult;
  /** N/A: the whole area stopped */
  areaLevel: ParetoResult;
  /** codes not in the equipment master */
  unknown: ParetoResult;
}

export type OwnStopClass = 'own' | 'otherAreas' | 'unassigned' | 'areaLevel' | 'unknown';

/** Where does this event's cause fall under the own-stop rule? */
export function classifyOwnStop(c: ChainedEvent, index: MasterIndex): { cls: OwnStopClass; code: ResolvedCode } {
  const code = rowCode(c.head, index);
  if (code.kind === 'area_level') return { cls: 'areaLevel', code };
  if (code.kind === 'unknown') return { cls: 'unknown', code };
  const areas = areasOf(index, code.equipmentId);
  if (areas.has(c.area_id)) return { cls: 'own', code };
  return { cls: areas.size === 0 ? 'unassigned' : 'otherAreas', code };
}

/**
 * Equipment-code Pareto with the OWN-STOP RULE: only events whose equipment code belongs to the stopped area
 * are in `own`. Events caused by a code of another area are in `otherAreas`, so a cause is never counted twice.
 * Input should be failure events (ChainedEvent.isFailure); other chains are ignored.
 */
export function equipmentPareto(chains: ChainedEvent[], index: MasterIndex, o: ChainParetoOptions): EquipmentParetoResult {
  const groups: Record<OwnStopClass, ChainedEvent[]> = { own: [], otherAreas: [], unassigned: [], areaLevel: [], unknown: [] };
  const attr = attributionFor(chains, o);
  for (const c of analysableChains(chains)) if (c.isFailure) groups[classifyOwnStop(c, index).cls].push(c);
  const build = (cs: ChainedEvent[]): ParetoResult => chainPareto(cs, o, (c) => resolvedKey(rowCode(c.head, index)), (c) => resolvedKey(rowCode(c.head, index)), attr);
  return {
    own: build(groups.own), otherAreas: build(groups.otherAreas), unassigned: build(groups.unassigned),
    areaLevel: build(groups.areaLevel), unknown: build(groups.unknown),
  };
}

export interface ReasonParetoOptions extends ChainParetoOptions {
  /** keep the same text under different classifications as separate bars */
  splitByClassification?: boolean;
}

const BLANK = '(blank)';

function reasonKeyOf(c: ChainedEvent, split: boolean): string {
  const k = matchKey(c.head.reason_raw);
  return split ? `${c.head.classification}|${k}` : k;
}

function reasonLabelOf(c: ChainedEvent, split: boolean): string {
  const t = (c.head.reason_raw ?? '').trim().replace(/\s+/g, ' ') || BLANK;
  return split ? `${t} (${c.head.classification})` : t;
}

/** Reason Pareto over failure events, grouped by matchKey of the head row's reason. */
export function reasonPareto(chains: ChainedEvent[], o: ReasonParetoOptions): ParetoResult {
  const split = o.splitByClassification === true;
  return chainPareto(chains.filter((c) => c.isFailure), o, (c) => reasonKeyOf(c, split), (c) => reasonLabelOf(c, split), attributionFor(chains, o));
}

/** Reason Pareto for the failure events of one equipment code (the "why does X fail" view). */
export function reasonParetoForEquipment(chains: ChainedEvent[], equipmentId: string, index: MasterIndex, o: ReasonParetoOptions): ParetoResult {
  const want = equipmentId.toUpperCase();
  const mine = chains.filter((c) => {
    const code = rowCode(c.head, index);
    return code.kind === 'equipment' && code.equipmentId.toUpperCase() === want;
  });
  return reasonPareto(mine, { ...o, attribution: attributionFor(chains, o) });
}

/** Failure Pareto by stopped area. */
export function areaPareto(chains: ChainedEvent[], o: ChainParetoOptions): ParetoResult {
  return chainPareto(chains.filter((c) => c.isFailure), o, (c) => c.area_id, (c) => c.area_id, attributionFor(chains, o));
}

export interface ClassificationParetoOptions extends ChainParetoOptions {
  /** only failure events (default false: all events, including planned and circumstantial) */
  failureOnly?: boolean;
}

/** Pareto by the head row's classification. */
export function classificationPareto(chains: ChainedEvent[], o: ClassificationParetoOptions): ParetoResult {
  const src = o.failureOnly ? chains.filter((c) => c.isFailure) : chains;
  return chainPareto(src, o, (c) => c.head.classification, (c) => c.head.classification, attributionFor(chains, o));
}

export interface LineParetoOptions extends ChainParetoOptions {
  /** line of an area in the master data (the area decides the line, never the event's own line_id) */
  lineOf: (areaId: string) => string;
  lineLabel?: (lineId: string) => string;
}

/** Failure Pareto by production line: the line of the stopped area. Totals equal the area Pareto. */
export function linePareto(chains: ChainedEvent[], o: LineParetoOptions): ParetoResult {
  const label = o.lineLabel ?? ((l: string) => l);
  return chainPareto(chains.filter((c) => c.isFailure), o, (c) => o.lineOf(c.area_id) || '(no line)', (c) => label(o.lineOf(c.area_id)) || '(no line)', attributionFor(chains, o));
}
