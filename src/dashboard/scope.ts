// Dashboard scope: turns the loaded rows + the filters into the inputs every page needs.
// Staged so the React hook can memoise each stage separately (a date change does not rebuild the chains).
// No calculation lives here: it only chooses which rows / chains / windows go into src/calc.
import type { EventRow, Startup } from '../api/types';
import {
  addDays, applyFilters, attributeRows, buildFailureEvents, buildIndex, comparisonRange, computeKpis, computeKpisWithComparison, dataRangeOf,
  emptyFilter, filterChains, intersectRanges, isAnalysable, notUploadedMonths, parseSettings, type Attribution, type CalcSettings, type ChainedEvent,
  type DateRange, type Filter, type KpiComparison, type KpiResult, type MasterIndex,
} from '../calc';
import { areasInScope, compareKind, eventLevelFilter, hasEventLevelFilter, type CompareMode, type DashFilters } from './filters';

export interface Master {
  index: MasterIndex;
  /** display name of each line (line_id -> name) */
  lineNames: Map<string, string>;
  settings: CalcSettings;
}

export function buildMaster(startup: Startup): Master {
  return { index: buildIndex(startup), lineNames: new Map(startup.lines.map((l) => [l.line_id, l.name])), settings: parseSettings(startup.settings) };
}

/** Stage 1: rows and chains of the chosen lines / areas, whole (continuation rows kept). */
export interface BaseScope {
  areaIds: string[];
  rows: EventRow[];
  chains: ChainedEvent[];
}

export function buildBase(rows: EventRow[], startup: Startup, f: Pick<DashFilters, 'lineIds' | 'areaIds'>, master: Master): BaseScope {
  const areaIds = areasInScope(startup.areas, { ...f } as DashFilters);
  const filter: Filter = { ...emptyFilter(), lineIds: f.lineIds, areaIds };
  const kept = applyFilters(rows, filter, { settings: master.settings, index: master.index });
  return { areaIds, rows: kept, chains: buildFailureEvents(kept).chains };
}

/** Stage 2: the event-level filters (classification, equipment, reason ...) on top of the base. */
export interface EventScope {
  /** the rows of the kept chains (whole events; hours are summed from these, clipped to the window) */
  kpiRows: EventRow[];
  /** chains kept by the event-level filters (P3: whole events, by their head row and whole duration) */
  chains: ChainedEvent[];
  failureChains: ChainedEvent[];
  /** who owns overlapping time among kpiRows (P1): every hour figure of the scope uses it, so KPIs and Paretos agree */
  attribution: Attribution;
}

export function buildEventScope(base: BaseScope, f: DashFilters, master: Master): EventScope {
  if (!hasEventLevelFilter(f)) {
    return { kpiRows: base.rows, chains: base.chains, failureChains: base.chains.filter((c) => c.isFailure), attribution: attributeRows(base.rows.filter(isAnalysable)) };
  }
  const ctx = { settings: master.settings, index: master.index };
  const chains = filterChains(base.chains, eventLevelFilter(f), ctx);
  const kpiRows = chains.flatMap((c) => c.rows);
  return { kpiRows, chains, failureChains: chains.filter((c) => c.isFailure), attribution: attributeRows(kpiRows) };
}

/** Stage 3: window, comparison window and the KPI results. */
export interface Windows {
  range: DateRange;
  /** the range clipped to the data coverage; every window-based calc uses this one */
  effective: DateRange | null;
  compare: CompareMode;
  /** comparison window of the effective range (null when comparison is off or there is no data) */
  compareRange: DateRange | null;
}

export function buildWindows(range: DateRange, coverage: DateRange | null, f: DashFilters, settings: CalcSettings): Windows {
  const effective = coverage ? intersectRanges(range, coverage) : null;
  const compare = compareKind(f, settings);
  return { range, effective, compare, compareRange: effective && compare !== 'none' ? comparisonRange(effective, compare) : null };
}

export interface KpiBundle {
  current: KpiResult;
  comparison: KpiComparison | null;
}

export function buildKpis(scope: EventScope, base: BaseScope, win: Windows, coverage: DateRange | null, master: Master, notUploaded: string[] = []): KpiBundle {
  const input = {
    rows: scope.kpiRows, chains: scope.chains, window: win.range, dataRange: coverage, areaIds: base.areaIds,
    settings: master.settings, index: master.index, attribution: scope.attribution, notUploaded,
  };
  if (win.compare === 'none') return { current: computeKpis(input), comparison: null };
  const comparison = computeKpisWithComparison(input, win.compare);
  return { current: comparison.current, comparison };
}

/** Rows that fall in the range and pass every filter: what the Event Explorer shows for the same filters. */
export function rowsInRange(scope: EventScope, range: DateRange): EventRow[] {
  return applyFilters(scope.kpiRows, { ...emptyFilter(), dateRange: range }, { settings: { durationShortMaxMin: 30, durationLongMinMin: 120 } });
}

export function coverageOf(rows: EventRow[]): DateRange | null {
  return dataRangeOf(rows);
}

/** P6: months inside the coverage with no record at all in the loaded rows (plant-wide, before any filter). */
export function notUploadedOf(rows: EventRow[], coverage: DateRange | null): string[] {
  return coverage ? notUploadedMonths(rows, coverage) : [];
}

/** Years that must be loaded: the range, its comparison window, the repeat-window history, and optional years back. */
export function yearsNeeded(
  range: DateRange, f: DashFilters, settings: CalcSettings, available: number[], extraYearsBack = 0,
): number[] {
  const kind = compareKind(f, settings);
  const cmp = kind === 'none' ? range : comparisonRange(range, kind);
  const lo = [range.from, cmp.from, addDays(range.from, -Math.ceil(settings.repeatWindowDays))].sort()[0]!;
  const hi = [range.to, cmp.to].sort().reverse()[0]!;
  const y0 = Number(lo.slice(0, 4)) - extraYearsBack;
  const y1 = Number(hi.slice(0, 4));
  return available.filter((y) => y >= y0 && y <= y1).sort((a, b) => a - b);
}

/** Everything a page's model needs, built once per filter change by the hook. */
export interface DashCtx {
  master: Master;
  base: BaseScope;
  scope: EventScope;
  win: Windows;
  coverage: DateRange | null;
  /** P6: months inside the coverage with no record at all (plant-wide): 'Not uploaded' */
  notUploaded: string[];
  kpis: KpiBundle;
}

export function buildCtx(rows: EventRow[], startup: Startup, f: DashFilters, range: DateRange): DashCtx {
  const master = buildMaster(startup);
  const coverage = coverageOf(rows);
  const notUploaded = notUploadedOf(rows, coverage);
  const base = buildBase(rows, startup, f, master);
  const scope = buildEventScope(base, f, master);
  const win = buildWindows(range, coverage, f, master.settings);
  return { master, base, scope, win, coverage, notUploaded, kpis: buildKpis(scope, base, win, coverage, master, notUploaded) };
}
