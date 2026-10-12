// The filters of Overview, Pareto, Repeats and Reliability are one shared state. The URL query is the source of
// truth on a page; this module remembers the last one so a tab opened without a query gets the same filters, and
// keeps it in sessionStorage so a reload of the app (or a tab opened from the menu) still has it. Event Explorer
// has its own filters and does not touch this. Storage may be blocked: then it lives in memory only.
import { store } from '../storagePrefix';
import { parseFilters, serializeFilters } from './filters';

const KEY = 'dash_filters';
let query: string | null = null;

/** The remembered query string ('' = defaults). Read from sessionStorage once and normalised through the parser. */
export function rememberedQuery(): string {
  if (query === null) {
    const raw = store.get(KEY, 'session');
    query = raw ? serializeFilters(parseFilters(new URLSearchParams(raw))).toString() : '';
  }
  return query;
}

export function rememberQuery(q: string): void {
  query = q;
  if (q) store.set(KEY, q, 'session');
  else store.remove(KEY, 'session');
}

/** Forget the shared filters (Reset, sign-out, tests). */
export function forgetDashFilters(): void {
  rememberQuery('');
}
