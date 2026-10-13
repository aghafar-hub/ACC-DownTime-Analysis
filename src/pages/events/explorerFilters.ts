// Event records' filters as plain data. The scope (period, line, area, equipment, type ...) is the dashboards' shared
// filter set (src/dashboard/filters.ts), so changing it on any Analyze page changes the list here and back. The page
// keeps its own choices in its own query keys: the search text, which rows to show (all, with issues, edited, voided)
// and the order. Both live in the address, so Back, a reload or a saved view restore the same list. Pure.
import type { EventRow, Startup } from '../../api/types';
import { applyFilters as applyRowFilters, buildIndex, emptyFilter, matchKey, parseSettings, type DateRange, type MasterIndex } from '../../calc';
import { hasOpenProblemFlags, isBlockingFlag, openFlagsOf } from '../../calc/flags';
import { activeCount as sharedCount, type DashFilters } from '../../dashboard/filters';
import { t } from '../../i18n/t';

export type Show = 'all' | 'issues' | 'edited' | 'void';
/** The sortable columns of the list: Started, Area, Code, Reason, Class, Hours, Freq, Status. */
export type SortKey = 'stop' | 'area' | 'code' | 'reason' | 'class' | 'dur' | 'freq' | 'status';
export type SortDir = 'asc' | 'desc';
/** A column and a direction: 'stop_desc' (newest first, the default), 'dur_desc' (longest first), 'area_asc' ... */
export type Sort = `${SortKey}_${SortDir}`;
export const SORT_KEYS: SortKey[] = ['stop', 'area', 'code', 'reason', 'class', 'dur', 'freq', 'status'];
/** The page's own choices (the scope is the shared filter set). */
export interface Filters { q: string; show: Show; sort: Sort }
export const EMPTY: Filters = { q: '', show: 'all', sort: 'stop_desc' };

/** The shared scope as the list applies it: the filters and the range they resolve to. */
export interface SharedScope { filters: DashFilters; range: DateRange | null }

/** How many of the page's own filters are on (the search box and the order are not counted). */
export function activeCount(f: Filters): number {
  return f.show !== 'all' ? 1 : 0;
}

/** Narrowing filters in total: the shared ones plus the page's own. */
export function totalActive(f: Filters, shared: SharedScope | null): number {
  return activeCount(f) + (shared ? sharedCount(shared.filters) : 0);
}

const masters = new WeakMap<Startup, { index: MasterIndex; settings: ReturnType<typeof parseSettings> }>();
function masterOf(startup: Startup) {
  let m = masters.get(startup);
  if (!m) {
    m = { index: buildIndex(startup), settings: parseSettings(startup.settings) };
    masters.set(startup, m);
  }
  return m;
}

/**
 * The rows of the shared scope, row by row (a list of records, so a continuation row is listed on its own): the
 * stop date inside the period, then line (through the area), area, equipment, equipment type, classification,
 * criticality, failures only, reason and duration band. Voided rows and rows with a data problem stay in (the list
 * shows them; 'Show' picks them out). `withDates: false` leaves the period out (the timeline has its own window).
 */
export function scopeRows(rows: readonly EventRow[], shared: SharedScope, startup: Startup | null, withDates = true): EventRow[] {
  const f = shared.filters;
  const from = withDates ? shared.range?.from ?? '' : '';
  const to = withDates ? shared.range?.to ?? '' : '';
  const dated = from || to ? rows.filter((e) => (!from || e.event_date >= from) && (!to || e.event_date <= to)) : [...rows];
  const narrowing = f.lineIds.length || f.areaIds.length || f.equipmentIds.length || f.equipmentTypes.length || f.classifications.length || f.criticality.length
    || f.failureOnly || f.reasonKeys.length || f.durationBand;
  if (!narrowing) return dated;
  const m = startup ? masterOf(startup) : null;
  const kept = applyRowFilters(dated, {
    ...emptyFilter(), lineIds: f.lineIds, areaIds: f.areaIds, equipmentIds: f.equipmentIds, equipmentTypes: f.equipmentTypes,
    classifications: f.classifications, criticality: f.criticality, failureOnly: f.failureOnly, reasonKeys: f.reasonKeys.map(matchKey),
    durationBand: f.durationBand, includeVoid: true, includeInvalid: true,
  }, { settings: m?.settings ?? { durationShortMaxMin: 30, durationLongMinMin: 120 }, index: m?.index });
  // a voided row is never a failure
  return f.failureOnly ? kept.filter((e) => !e.is_void) : kept;
}

/** The page's own choices on top: which rows to show, the search text, then the order. */
export function applyFilters(rows: readonly EventRow[], f: Filters, startup: Startup | null, q: string): EventRow[] {
  const needle = q.trim().toLowerCase();
  const reasonText = new Map(startup?.reasons.map((r) => [r.reason_id, r.text_as_listed.trim().toLowerCase()]) ?? []);
  const out = rows.filter((e) => {
    if (f.show === 'issues' && !hasOpenProblemFlags(e)) return false;
    if (f.show === 'edited' && !e.edited) return false;
    if (f.show === 'void' && !e.is_void) return false;
    if (needle) {
      const hay = `${e.code_raw} ${e.equipment_id ?? ''} ${e.reason_raw ?? ''} ${e.reason_id ? reasonText.get(e.reason_id) ?? '' : ''} ${e.description ?? ''} ${e.event_id}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  return sortRows(out, f.sort);
  return out;
}

// ---------------------------------------------------------------- order

/** One word for where a record stands, worst last: OK, edited, to check (▲ open), left out (◆ open), void. */
export type RecordStatus = 'ok' | 'edited' | 'check' | 'blocked' | 'void';
const STATUS_RANK: Record<RecordStatus, number> = { ok: 0, edited: 1, check: 2, blocked: 3, void: 4 };
export function recordStatus(e: EventRow): RecordStatus {
  if (e.is_void) return 'void';
  const open = openFlagsOf(e);
  if (open.some(isBlockingFlag)) return 'blocked';
  if (hasOpenProblemFlags(e)) return 'check';
  if (e.edited) return 'edited';
  return 'ok';
}

export const sortKeyOf = (s: Sort): SortKey => s.slice(0, s.lastIndexOf('_')) as SortKey;
export const sortDirOf = (s: Sort): SortDir => (s.endsWith('_asc') ? 'asc' : 'desc');

/** The order a column starts in when its heading is clicked: newest, longest, most and worst first; words A to Z. */
export function firstDir(key: SortKey): SortDir {
  return key === 'stop' || key === 'dur' || key === 'freq' || key === 'status' ? 'desc' : 'asc';
}

/** A click on a column heading: the same column turns round, another column starts in its natural order. */
export function nextSort(cur: Sort, key: SortKey): Sort {
  if (sortKeyOf(cur) === key) return `${key}_${sortDirOf(cur) === 'asc' ? 'desc' : 'asc'}`;
  return `${key}_${firstDir(key)}`;
}

const text = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();
/** Blank text sorts after any text, whatever the direction. */
function byText(a: string, b: string, dir: number): number {
  if (!a !== !b) return a ? -1 : 1;
  return dir * a.localeCompare(b);
}

/**
 * The rows in the order of a column. Ties fall back to the newest stop first, then the area, then the record id, so
 * the order is the same on every run (stable for the export, the paging and the tests). Pure; returns a new array.
 */
export function sortRows(rows: readonly EventRow[], sort: Sort): EventRow[] {
  const key = sortKeyOf(sort);
  const dir = sortDirOf(sort) === 'asc' ? 1 : -1;
  const cmp = (a: EventRow, b: EventRow): number => {
    switch (key) {
      case 'stop': return dir * a.stop_ts.localeCompare(b.stop_ts);
      case 'area': return dir * a.area_id.localeCompare(b.area_id);
      case 'code': return byText(text(a.code_raw), text(b.code_raw), dir);
      case 'reason': return byText(text(a.reason_raw), text(b.reason_raw), dir);
      case 'class': return byText(text(a.classification), text(b.classification), dir);
      case 'dur': return dir * (a.duration_s - b.duration_s);
      case 'freq': return dir * (a.freq - b.freq);
      case 'status': return dir * (STATUS_RANK[recordStatus(a)] - STATUS_RANK[recordStatus(b)]);
      default: return 0;
    }
  };
  return [...rows].sort((a, b) => cmp(a, b) || b.stop_ts.localeCompare(a.stop_ts) || a.area_id.localeCompare(b.area_id) || a.event_id.localeCompare(b.event_id));
}

/** The filters in words, for the export's info sheet (dates stay ISO, as in every file): 'Period 2026-08-01 to 2026-08-31, Line L.1, Area CR, search "belt"'. */
export function describeExplorerFilters(f: Filters, startup: Startup | null, shared: SharedScope | null = null): string {
  const bits: string[] = [];
  const s = shared?.filters;
  if (shared?.range) bits.push(`${t('Period')} ${shared.range.from} ${t('to')} ${shared.range.to}`);
  if (s) {
    if (s.lineIds.length) bits.push(`${t('Line')} ${s.lineIds.map((id) => startup?.lines.find((l) => l.line_id === id)?.name ?? id).join(', ')}`);
    if (s.areaIds.length) bits.push(`${t('Area')} ${s.areaIds.join(', ')}`);
    if (s.equipmentIds.length) bits.push(`${t('Equipment')} ${s.equipmentIds.join(', ')}`);
    if (s.equipmentTypes.length) bits.push(`${t('Equipment type')} ${s.equipmentTypes.join(', ')}`);
    if (s.classifications.length) bits.push(`${t('Classification')} ${s.classifications.join(', ')}`);
    if (s.criticality.length) bits.push(`${t('Criticality')} ${s.criticality.join(', ')}`);
    if (s.failureOnly) bits.push(t('Failures only'));
    if (s.reasonKeys.length) bits.push(`${t('Reason')} ${s.reasonKeys.join(', ')}`);
    if (s.durationBand) bits.push(`${t('Duration')} ${s.durationBand}`);
  }
  if (f.show === 'issues') bits.push(t('Only rows with data issues'));
  if (f.show === 'edited') bits.push(t('Only edited rows'));
  if (f.show === 'void') bits.push(t('Only voided rows'));
  if (f.q.trim()) bits.push(`${t('Search')} "${f.q.trim()}"`);
  return bits.length ? bits.join(', ') : t('No filters');
}

// ---------------------------------------------------------------- the page's own query keys

/** Query keys of the page's own choices (the shared filters use the dashboards' keys; `view` is the list / timeline switch). */
export const EXPLORER_KEYS = ['q', 'show', 'sort'] as const;

/** Query key of how many rows the list shows (Show more); not a filter, so it is not part of a saved view. */
export const SHOWN_PARAM = 'n';

export const hasExplorerParams = (sp: URLSearchParams): boolean => EXPLORER_KEYS.some((k) => sp.has(k));

const SHOWS: Show[] = ['all', 'issues', 'edited', 'void'];
const isSort = (v: string | null): v is Sort => !!v && /^[a-z]+_(asc|desc)$/.test(v) && SORT_KEYS.includes(v.slice(0, v.lastIndexOf('_')) as SortKey);

/** Only non-default values are written, so the defaults are an empty query. */
export function serializeExplorerFilters(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set('q', f.q.trim());
  if (f.show !== 'all') sp.set('show', f.show);
  if (f.sort !== 'stop_desc') sp.set('sort', f.sort);
  return sp;
}

/** The page's choices a query describes; anything missing or not valid is the default. */
export function parseExplorerFilters(sp: URLSearchParams): Filters {
  const show = sp.get('show') as Show | null;
  const sort = sp.get('sort');
  return {
    q: sp.get('q') ?? '',
    show: show && SHOWS.includes(show) ? show : 'all',
    sort: isSort(sort) ? sort : 'stop_desc',
  };
}
