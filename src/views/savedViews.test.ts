import { describe, expect, it } from 'vitest';
import { commitList } from './commit';
import {
  addView, deleteView, newId, parseSavedViews, renameView, SAVED_VIEWS_MAX, SAVED_VIEW_QUERY_MAX, serializeSavedViews, viewNameError, viewPageOfPath, viewsForPage,
  type SavedView,
} from './savedViews';

const v = (n: number, page: SavedView['page'] = 'overview'): SavedView => ({ id: `v${n}`, name: `View ${n}`, page, query: `line=L.${n}` });

describe('saved views list logic', () => {
  it('parses what is stored; unreadable text and invalid entries are skipped', () => {
    expect(parseSavedViews(undefined)).toEqual([]);
    expect(parseSavedViews('')).toEqual([]);
    expect(parseSavedViews('{nope')).toEqual([]);
    expect(parseSavedViews('{"a":1}')).toEqual([]);
    const text = JSON.stringify([v(1), { id: 'x', name: '', page: 'overview', query: '' }, { id: 'y', name: 'Y', page: 'elsewhere', query: '' }, v(1), { id: 'z', name: 'Z', page: 'events', query: 'q=belt' }, 5, null]);
    expect(parseSavedViews(text).map((x) => x.id)).toEqual(['v1', 'z']);
  });

  it('serialises to JSON, and an empty list to blank (the server reads blank as none)', () => {
    expect(serializeSavedViews([])).toBe('');
    const list = [v(1), v(2, 'events')];
    expect(parseSavedViews(serializeSavedViews(list))).toEqual(list);
  });

  it('a view is {id, name, page, query} and nothing else', () => {
    const r = addView([], { name: '  Crushing  ', page: 'pareto', query: 'area=CR&r=last30' }, 'v-1');
    expect(r.ok && r.list).toEqual([{ id: 'v-1', name: 'Crushing', page: 'pareto', query: 'area=CR&r=last30' }]);
  });

  it('name rules: 1 to 60 characters, unique on the page ignoring case, the same name may exist on another page', () => {
    expect(viewNameError('', [], 'overview')).toMatch(/Type a name/);
    expect(viewNameError('   ', [], 'overview')).toMatch(/Type a name/);
    expect(viewNameError('x'.repeat(61), [], 'overview')).toMatch(/at most 60/);
    expect(viewNameError('x'.repeat(60), [], 'overview')).toBeNull();
    expect(viewNameError('view 1', [v(1)], 'overview')).toMatch(/already have/);
    expect(viewNameError('View 1', [v(1)], 'pareto')).toBeNull();
    expect(viewNameError('View 1', [v(1)], 'overview', 'v1')).toBeNull(); // renaming to itself
  });

  it('limit: 20 views in all, across pages, with a clear message', () => {
    const full = Array.from({ length: SAVED_VIEWS_MAX }, (_, i) => v(i, i % 2 ? 'events' : 'overview'));
    const r = addView(full, { name: 'One more', page: 'repeats', query: '' }, 'new');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/saved 20 views, the most you can keep/);
    expect(addView(full.slice(1), { name: 'One more', page: 'repeats', query: '' }, 'new').ok).toBe(true);
  });

  it('query: at most 1500 characters', () => {
    const base = { name: 'Long', page: 'overview' as const, query: 'a'.repeat(SAVED_VIEW_QUERY_MAX) };
    expect(addView([], base, 'x').ok).toBe(true);
    const r = addView([], { ...base, query: 'a'.repeat(SAVED_VIEW_QUERY_MAX + 1) }, 'x');
    expect(!r.ok && r.error).toMatch(/too long/);
  });

  it('rename keeps id, page and query; delete removes only that view; unknown ids are refused', () => {
    const list = [v(1), v(2), v(3, 'events')];
    const r = renameView(list, 'v2', ' Renamed ');
    expect(r.ok && r.list.map((x) => x.name)).toEqual(['View 1', 'Renamed', 'View 3']);
    expect(r.ok && r.list[1]).toEqual({ ...v(2), name: 'Renamed' });
    expect(renameView(list, 'v2', 'view 1').ok).toBe(false);
    expect(renameView(list, 'nope', 'X').ok).toBe(false);
    const d = deleteView(list, 'v1');
    expect(d.ok && d.list.map((x) => x.id)).toEqual(['v2', 'v3']);
    expect(deleteView(list, 'nope').ok).toBe(false);
  });

  it('views are listed per page', () => {
    const list = [v(1), v(2, 'events'), v(3)];
    expect(viewsForPage(list, 'overview').map((x) => x.id)).toEqual(['v1', 'v3']);
    expect(viewsForPage(list, 'reliability')).toEqual([]);
  });

  it('knows the page of a path', () => {
    expect(viewPageOfPath('/overview')).toBe('overview');
    expect(viewPageOfPath('/events')).toBe('events');
    expect(viewPageOfPath('/reliability/')).toBe('reliability');
    expect(viewPageOfPath('/reports')).toBeNull();
    expect(viewPageOfPath('/')).toBeNull();
  });

  it('new ids are 1 to 40 characters and unique', () => {
    const a = newId('v', []);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(40);
    const taken: string[] = [];
    for (let i = 0; i < 300; i++) taken.push(newId('v', taken));
    expect(new Set(taken).size).toBe(300);
    let calls = 0;
    const id = newId('v', ['v-1i000'], () => (calls++ ? 0.9 : 0), () => 1);
    expect(id).not.toBe('v-1i000');
  });
});

describe('committing a list change', () => {
  const ok = async () => ({ ok: true as const });
  it('shows the new list at once, sends it as the preference text, and keeps it when the save works', async () => {
    const ref = { current: [v(1)] };
    const sent: Record<string, string>[] = [];
    const r = await commitList(addView(ref.current, { name: 'New', page: 'events', query: 'q=a' }, 'n1'), ref, 'saved_views', serializeSavedViews, async (p) => { sent.push(p); return ok(); });
    expect(r.ok).toBe(true);
    expect(ref.current.map((x) => x.id)).toEqual(['v1', 'n1']);
    expect(Object.keys(sent[0]!)).toEqual(['saved_views']);
    expect(parseSavedViews(sent[0]!.saved_views).map((x) => x.id)).toEqual(['v1', 'n1']);
  });

  it('takes the list back and returns the server\'s plain message when the save is refused', async () => {
    const ref = { current: [v(1), v(2)] };
    const seen: string[][] = [];
    const r = await commitList(deleteView(ref.current, 'v1'), ref, 'saved_views', serializeSavedViews, async () => {
      seen.push(ref.current.map((x) => x.id)); // while the save is in flight the list is already the new one
      return { ok: false as const, error: 'That did not save. Check the connection and try again.' };
    });
    expect(seen).toEqual([['v2']]);
    expect(r).toEqual({ ok: false, error: 'That did not save. Check the connection and try again.' });
    expect(ref.current.map((x) => x.id)).toEqual(['v1', 'v2']);
  });

  it('a refused change (name taken, limit) never reaches the server', async () => {
    const ref = { current: [v(1)] };
    let calls = 0;
    const r = await commitList(addView(ref.current, { name: 'view 1', page: 'overview', query: '' }, 'x'), ref, 'saved_views', serializeSavedViews, async () => { calls++; return ok(); });
    expect(r.ok).toBe(false);
    expect(calls).toBe(0);
    expect(ref.current).toEqual([v(1)]);
    expect((await commitList(deleteView([v(1)], 'v1'), { current: [v(1)] }, 'saved_views', serializeSavedViews, undefined)).ok).toBe(false);
  });
});
