// Event Explorer's filters as plain data: the filter shape, the rules that pick and order the rows, a count of active
// filters, a sentence that describes them, and the query used by saved views (the filters live in component state; a
// saved view stores them as a query and applying it puts them back). Pure.
import type { ClassificationCode, EventRow, Startup } from '../../api/types';
import { hasOpenProblemFlags } from '../../calc/flags';
import { t } from '../../i18n/t';

export type Show = 'all' | 'issues' | 'edited' | 'void';
export type Sort = 'stop_desc' | 'stop_asc' | 'dur_desc';
export interface Filters {
  q: string; line: string; area: string; classes: ClassificationCode[]; crit: '' | 'INC' | 'NO_INC';
  failureOnly: boolean; from: string; to: string; show: Show; sort: Sort;
}
export const EMPTY: Filters = { q: '', line: '', area: '', classes: [], crit: '', failureOnly: false, from: '', to: '', show: 'all', sort: 'stop_desc' };

/** How many filters are active (the search box and the sort order are not counted). */
export function activeCount(f: Filters, includeFailure = true): number {
  return [f.line, f.area, f.classes.length > 0, f.crit, includeFailure && f.failureOnly, f.from, f.to, f.show !== 'all'].filter(Boolean).length;
}

export function applyFilters(rows: EventRow[], f: Filters, startup: Startup | null, q: string): EventRow[] {
  const needle = q.trim().toLowerCase();
  const reasonText = new Map(startup?.reasons.map((r) => [r.reason_id, r.text_as_listed.trim().toLowerCase()]) ?? []);
  // the area decides the line (the sheet's own line can be wrong)
  const lineOfArea = new Map(startup?.areas.map((a) => [a.area_id, a.line_id]) ?? []);
  const out = rows.filter((e) => {
    if (f.line && (lineOfArea.get(e.area_id) ?? e.line_id) !== f.line) return false;
    if (f.area && e.area_id !== f.area) return false;
    if (f.classes.length && !f.classes.includes(e.classification)) return false;
    if (f.crit && e.criticality !== f.crit) return false;
    if (f.failureOnly && !(e.is_failure && !e.is_void)) return false;
    if (f.from && e.event_date < f.from) return false;
    if (f.to && e.event_date > f.to) return false;
    if (f.show === 'issues' && !hasOpenProblemFlags(e)) return false;
    if (f.show === 'edited' && !e.edited) return false;
    if (f.show === 'void' && !e.is_void) return false;
    if (needle) {
      const hay = `${e.code_raw} ${e.equipment_id ?? ''} ${e.reason_raw ?? ''} ${e.reason_id ? reasonText.get(e.reason_id) ?? '' : ''} ${e.description ?? ''} ${e.event_id}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  if (f.sort === 'stop_desc') out.sort((a, b) => b.stop_ts.localeCompare(a.stop_ts) || a.area_id.localeCompare(b.area_id));
  else if (f.sort === 'stop_asc') out.sort((a, b) => a.stop_ts.localeCompare(b.stop_ts) || a.area_id.localeCompare(b.area_id));
  else out.sort((a, b) => b.duration_s - a.duration_s);
  return out;
}

/** The filters in words, for the export's info sheet: 'Line L.1, Area CR, search "belt"'. 'No filters' when nothing is on. */
export function describeExplorerFilters(f: Filters, startup: Startup | null): string {
  const bits: string[] = [];
  if (f.line) bits.push(`${t('Line')} ${startup?.lines.find((l) => l.line_id === f.line)?.name ?? f.line}`);
  if (f.area) bits.push(`${t('Area')} ${f.area}`);
  if (f.classes.length) bits.push(`${t('Classification')} ${f.classes.join(', ')}`);
  if (f.crit) bits.push(`${t('Criticality')} ${f.crit}`);
  if (f.failureOnly) bits.push(t('Failures only'));
  if (f.from) bits.push(`${t('From date')} ${f.from}`);
  if (f.to) bits.push(`${t('To date')} ${f.to}`);
  if (f.show === 'issues') bits.push(t('Only rows with data issues'));
  if (f.show === 'edited') bits.push(t('Only edited rows'));
  if (f.show === 'void') bits.push(t('Only voided rows'));
  if (f.q.trim()) bits.push(`${t('Search')} "${f.q.trim()}"`);
  return bits.length ? bits.join(', ') : t('No filters');
}

// ---------------------------------------------------------------- saved views

/** Query keys of the explorer's filters (the view switch `view` is kept apart: it is not a filter). */
export const EXPLORER_KEYS = ['q', 'line', 'area', 'cls', 'crit', 'fail', 'from', 'to', 'show', 'sort'] as const;

export const hasExplorerParams = (sp: URLSearchParams): boolean => EXPLORER_KEYS.some((k) => sp.has(k));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHOWS: Show[] = ['all', 'issues', 'edited', 'void'];
const SORTS: Sort[] = ['stop_desc', 'stop_asc', 'dur_desc'];

/** Only non-default values are written, so an empty filter set is an empty query. */
export function serializeExplorerFilters(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set('q', f.q.trim());
  if (f.line) sp.set('line', f.line);
  if (f.area) sp.set('area', f.area);
  f.classes.forEach((c) => sp.append('cls', c));
  if (f.crit) sp.set('crit', f.crit);
  if (f.failureOnly) sp.set('fail', '1');
  if (f.from) sp.set('from', f.from);
  if (f.to) sp.set('to', f.to);
  if (f.show !== 'all') sp.set('show', f.show);
  if (f.sort !== 'stop_desc') sp.set('sort', f.sort);
  return sp;
}

/** The filters a query describes; anything missing or not valid is the default. */
export function parseExplorerFilters(sp: URLSearchParams, classCodes: readonly string[] | null = null): Filters {
  const crit = sp.get('crit');
  const show = sp.get('show') as Show | null;
  const sort = sp.get('sort') as Sort | null;
  const allowed = classCodes ?? ['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'];
  return {
    q: sp.get('q') ?? '',
    line: sp.get('line') ?? '',
    area: sp.get('area') ?? '',
    classes: [...new Set(sp.getAll('cls'))].filter((c): c is ClassificationCode => allowed.includes(c)),
    crit: crit === 'INC' || crit === 'NO_INC' ? crit : '',
    failureOnly: sp.get('fail') === '1',
    from: DATE_RE.test(sp.get('from') ?? '') ? sp.get('from')! : '',
    to: DATE_RE.test(sp.get('to') ?? '') ? sp.get('to')! : '',
    show: show && SHOWS.includes(show) ? show : 'all',
    sort: sort && SORTS.includes(sort) ? sort : 'stop_desc',
  };
}
