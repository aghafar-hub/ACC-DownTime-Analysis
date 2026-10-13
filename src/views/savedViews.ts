// Saved views: a person's named filter sets for Overview, Pareto, Repeats, Reliability and Event Explorer, kept in the
// preference `saved_views` (JSON text: a list of {id, name, page, query}; at most 20 in all, a query of at most 1500
// characters, a name of 1 to 60). Pure list logic: parsing what is stored, checking names and limits, and the changes
// (save, rename, delete) as new lists. The same rules are checked again by the server (cleanSavedViews_).
export const SAVED_VIEW_PAGES = ['overview', 'pareto', 'repeats', 'reliability', 'events'] as const;
export type ViewPage = (typeof SAVED_VIEW_PAGES)[number];

export const SAVED_VIEWS_MAX = 20;
export const SAVED_VIEW_QUERY_MAX = 1500;
export const SAVED_VIEW_NAME_MAX = 60;
/** Longest stored text the server accepts. */
export const SAVED_VIEWS_TEXT_MAX = 20000;

export interface SavedView { id: string; name: string; page: ViewPage; query: string }

export type ListResult<T> = { ok: true; list: T[]; item?: T } | { ok: false; error: string };

const isPage = (p: unknown): p is ViewPage => typeof p === 'string' && (SAVED_VIEW_PAGES as readonly string[]).includes(p);

/** The list a stored text holds. Text that cannot be read gives an empty list; entries that are not valid views are skipped. */
export function parseSavedViews(raw: string | undefined | null): SavedView[] {
  if (!raw || !raw.trim()) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: SavedView[] = [];
  for (const v of data as unknown[]) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id || typeof o.name !== 'string' || !o.name.trim() || !isPage(o.page) || typeof o.query !== 'string' || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({ id: o.id, name: o.name, page: o.page, query: o.query });
  }
  return out;
}

/** The text to store ('' for an empty list: the server reads blank as none). */
export const serializeSavedViews = (list: readonly SavedView[]): string => (list.length ? JSON.stringify(list) : '');

export const viewsForPage = (list: readonly SavedView[], page: ViewPage): SavedView[] => list.filter((v) => v.page === page);

/** The page id a path belongs to ('/overview' -> 'overview'), or null for a page without saved views. */
export function viewPageOfPath(pathname: string): ViewPage | null {
  const seg = pathname.replace(/^\/+/, '').split('/')[0] ?? '';
  return isPage(seg) ? seg : null;
}

export const VIEW_PAGE_PATH: Record<ViewPage, string> = {
  overview: '/overview', pareto: '/pareto', repeats: '/repeats', reliability: '/reliability', events: '/events',
};

/** null when the name is fine, else a plain sentence. Names are unique on a page, ignoring case and spaces at the ends. */
export function viewNameError(name: string, list: readonly SavedView[], page: ViewPage, exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return 'Type a name for the view.';
  if (n.length > SAVED_VIEW_NAME_MAX) return `Use at most ${SAVED_VIEW_NAME_MAX} characters for the name.`;
  if (list.some((v) => v.page === page && v.id !== exceptId && v.name.trim().toLowerCase() === n.toLowerCase())) return 'You already have a view with this name on this page.';
  return null;
}

const limitError = `You have saved ${SAVED_VIEWS_MAX} views, the most you can keep. Delete one to save another.`;

export function addView(list: readonly SavedView[], input: { name: string; page: ViewPage; query: string }, id: string): ListResult<SavedView> {
  const err = viewNameError(input.name, list, input.page);
  if (err) return { ok: false, error: err };
  if (list.length >= SAVED_VIEWS_MAX) return { ok: false, error: limitError };
  if (input.query.length > SAVED_VIEW_QUERY_MAX) return { ok: false, error: 'These filters are too long to save as a view. Remove some selections and try again.' };
  const view: SavedView = { id, name: input.name.trim(), page: input.page, query: input.query };
  const next = [...list, view];
  if (serializeSavedViews(next).length > SAVED_VIEWS_TEXT_MAX) return { ok: false, error: 'Your saved views are too large to save another. Delete one first.' };
  return { ok: true, list: next, item: view };
}

export function renameView(list: readonly SavedView[], id: string, name: string): ListResult<SavedView> {
  const cur = list.find((v) => v.id === id);
  if (!cur) return { ok: false, error: 'This view no longer exists.' };
  const err = viewNameError(name, list, cur.page, id);
  if (err) return { ok: false, error: err };
  const item = { ...cur, name: name.trim() };
  return { ok: true, list: list.map((v) => (v.id === id ? item : v)), item };
}

export function deleteView(list: readonly SavedView[], id: string): ListResult<SavedView> {
  const cur = list.find((v) => v.id === id);
  if (!cur) return { ok: false, error: 'This view no longer exists.' };
  return { ok: true, list: list.filter((v) => v.id !== id), item: cur };
}

/** A new id of 1 to 40 characters, unique in the list. */
export function newId(prefix: string, taken: readonly string[], rand: () => number = Math.random, now: () => number = Date.now): string {
  for (;;) {
    const id = `${prefix}-${now().toString(36)}${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')}`;
    if (!taken.includes(id)) return id;
  }
}
