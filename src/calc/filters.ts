import type { ClassificationCode, Criticality, EventRow } from '../api/types';
import { rowSeconds, rowSpan, type ChainedEvent } from './events';
import { blockingFlagsOf, isBlocked, BLOCKING_FLAGS } from './flags';
import type { MasterIndex } from './masters';
import { codeKey, matchKey, rowCode } from './normalize';
import type { CalcSettings } from './settings';
import { rangeToInterval, type DateRange } from './time';

export type DurationBand = 'short' | 'medium' | 'long';

/** Empty arrays / null / false mean "no restriction", except includeVoid (default false). */
export interface Filter {
  lineIds: string[];
  areaIds: string[];
  /** canonical equipment codes (the stop's cause) */
  equipmentIds: string[];
  /** equipment_type of the resolved code (needs master data) */
  equipmentTypes: string[];
  /** equipment master criticality text (High, Medium ...) of the resolved code */
  equipmentCriticality: string[];
  /** rows overlapping these calendar days (inclusive) are kept; use clipped hours afterwards */
  dateRange: DateRange | null;
  classifications: ClassificationCode[];
  /** event criticality, INC / NO_INC (sheet value) */
  criticality: Criticality[];
  failureOnly: boolean;
  /** match keys (see matchKey) */
  reasonKeys: string[];
  /** band of the row's own duration, from the duration settings */
  durationBand: DurationBand | null;
  includeVoid: boolean;
  /** keep records with a blocking data problem (see flags.ts); default false: they stay out of every calculation until fixed */
  includeInvalid: boolean;
}

export interface FilterContext {
  settings: Pick<CalcSettings, 'durationShortMaxMin' | 'durationLongMinMin'>;
  index?: MasterIndex;
}

export function emptyFilter(): Filter {
  return {
    lineIds: [], areaIds: [], equipmentIds: [], equipmentTypes: [], equipmentCriticality: [],
    dateRange: null, classifications: [], criticality: [], failureOnly: false,
    reasonKeys: [], durationBand: null, includeVoid: false, includeInvalid: false,
  };
}

export function durationBandOf(seconds: number, s: Pick<CalcSettings, 'durationShortMaxMin' | 'durationLongMinMin'>): DurationBand {
  const min = seconds / 60;
  if (min <= s.durationShortMaxMin) return 'short';
  if (min >= s.durationLongMinMin) return 'long';
  return 'medium';
}

/** Number of active filter fields (for "N filters active" labels). */
export function activeFilterCount(f: Filter): number {
  return [f.lineIds, f.areaIds, f.equipmentIds, f.equipmentTypes, f.equipmentCriticality, f.classifications, f.criticality, f.reasonKeys]
    .filter((a) => a.length > 0).length
    + (f.dateRange ? 1 : 0) + (f.failureOnly ? 1 : 0) + (f.durationBand ? 1 : 0) + (f.includeVoid ? 1 : 0) + (f.includeInvalid ? 1 : 0);
}

/**
 * Row-level filter. Voided events are always dropped unless includeVoid, and so are blocked events (a blocking
 * data problem, see flags.ts) unless includeInvalid. The line filter resolves through the area master
 * (area -> line) when `ctx.index` is given: the sheet's own line can be wrong. Without an index it falls back
 * to the event's line_id. Dates are matched on the stop
 * timestamp: a row is kept when it overlaps the date range (a row that crosses the range edge is kept).
 * Note: row-level filters can remove continuation rows of an event; build events from rows filtered only
 * by date/area when event chains must stay whole.
 */
export function applyFilters(events: EventRow[], filter: Filter, ctx: FilterContext): EventRow[] {
  const sets = {
    line: new Set(filter.lineIds), area: new Set(filter.areaIds),
    equip: new Set(filter.equipmentIds.map(codeKey)), type: new Set(filter.equipmentTypes),
    ecrit: new Set(filter.equipmentCriticality), cls: new Set<string>(filter.classifications),
    crit: new Set<string>(filter.criticality), reason: new Set(filter.reasonKeys.map(matchKey)),
  };
  const win = filter.dateRange ? rangeToInterval(filter.dateRange) : null;
  const needEquipment = sets.equip.size > 0 || sets.type.size > 0 || sets.ecrit.size > 0;
  return events.filter((e) => {
    if (e.is_void && !filter.includeVoid) return false;
    if (!filter.includeInvalid && isBlocked(e)) return false;
    if (sets.line.size && !sets.line.has(lineOf(e, ctx.index))) return false;
    if (sets.area.size && !sets.area.has(e.area_id)) return false;
    if (sets.cls.size && !sets.cls.has(e.classification)) return false;
    if (sets.crit.size && !sets.crit.has(e.criticality)) return false;
    if (filter.failureOnly && !e.is_failure) return false;
    if (sets.reason.size && !sets.reason.has(matchKey(e.reason_raw))) return false;
    if (win || filter.durationBand) {
      const span = rowSpan(e);
      if (!span) return false;
      if (win && !(span.fromMs < win.toMs && (span.toMs > win.fromMs || span.fromMs >= win.fromMs))) return false;
      if (filter.durationBand && durationBandOf(Math.max(0, span.toMs - span.fromMs) / 1000, ctx.settings) !== filter.durationBand) return false;
    }
    if (needEquipment && !matchesEquipment(e, sets, ctx.index)) return false;
    return true;
  });
}

/**
 * EVENT-level filter (P3): keeps whole chains. Classification, criticality, reason and equipment are read from the head
 * row (the cause), line and area from the stopped area, 'Failures only' keeps failure events (ChainedEvent.isFailure),
 * the duration band uses the WHOLE event's duration. The date range is not applied here (windows clip the hours).
 * KPI hours are then the rows of the kept chains (clipped to the window), so KPIs and Paretos agree for the same scope.
 */
export function filterChains(chains: ChainedEvent[], filter: Filter, ctx: FilterContext): ChainedEvent[] {
  const head = { ...filter, dateRange: null, durationBand: null, failureOnly: false, lineIds: [], areaIds: [] };
  const line = new Set(filter.lineIds);
  const area = new Set(filter.areaIds);
  return chains.filter((c) => {
    if (filter.failureOnly && !c.isFailure) return false;
    if (filter.durationBand && durationBandOf(c.durationS, ctx.settings) !== filter.durationBand) return false;
    if (area.size && !area.has(c.area_id)) return false;
    if (line.size && !line.has(lineOf(c.head, ctx.index))) return false;
    return applyFilters([c.head], head, ctx).length === 1;
  });
}

/** The line an event belongs to: the area's line from the master (an unknown area has none), else the event's own. */
function lineOf(e: EventRow, index: MasterIndex | undefined): string {
  if (!index) return e.line_id;
  return index.areaById.get(e.area_id)?.line_id ?? '';
}

export interface BlockedTotals { count: number; hours: number }
export interface BlockedSummary {
  /** records with at least one blocking flag (each counted once) */
  total: BlockedTotals;
  /** per blocking flag; a record with two blocking flags counts under both (every flag is present, possibly zero) */
  byFlag: Record<(typeof BLOCKING_FLAGS)[number], BlockedTotals>;
}

/** Counts and hours of the records kept out of the numbers because of a blocking flag. Voided events are ignored. */
export function blockedSummary(events: readonly EventRow[]): BlockedSummary {
  const out: BlockedSummary = {
    total: { count: 0, hours: 0 },
    byFlag: Object.fromEntries(BLOCKING_FLAGS.map((f) => [f, { count: 0, hours: 0 }])) as BlockedSummary['byFlag'],
  };
  for (const e of events) {
    if (e.is_void) continue;
    const flags = blockingFlagsOf(e);
    if (!flags.length) continue;
    const h = rowSeconds(e) / 3600;
    out.total.count++;
    out.total.hours += h;
    for (const f of new Set(flags)) {
      const t = out.byFlag[f as keyof BlockedSummary['byFlag']];
      if (t) { t.count++; t.hours += h; }
    }
  }
  return out;
}

function matchesEquipment(
  e: EventRow,
  sets: { equip: Set<string>; type: Set<string>; ecrit: Set<string> },
  index: MasterIndex | undefined,
): boolean {
  const rc = rowCode(e, index);
  if (rc.kind !== 'equipment') return false;
  if (sets.equip.size && !sets.equip.has(codeKey(rc.equipmentId))) return false;
  if (sets.type.size || sets.ecrit.size) {
    const eq = index?.equipmentByKey.get(codeKey(rc.equipmentId));
    if (sets.type.size && !(eq?.equipment_type && sets.type.has(eq.equipment_type))) return false;
    if (sets.ecrit.size && !(eq?.criticality && sets.ecrit.has(eq.criticality))) return false;
  }
  return true;
}

