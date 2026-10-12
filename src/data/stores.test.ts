import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/types';

// The device cache (IndexedDB) is replaced by a Map so the cache-then-network
// behaviour of Resource can be tested without a browser.
const memory = new Map<string, { value: unknown; savedAt: string }>();
vi.mock('./cache', () => ({
  getCached: vi.fn(async (key: string) => memory.get(key) ?? null),
  setCached: vi.fn(async (key: string, value: unknown) => {
    const savedAt = '2026-10-12T08:00:00.000Z';
    memory.set(key, { value, savedAt });
    return savedAt;
  }),
  clearDataCaches: vi.fn(async () => memory.clear()),
}));

import { Resource } from './stores';

beforeEach(() => memory.clear());
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Resource (cache first, then the server)', () => {
  it('loads from the server and writes the device cache', async () => {
    const r = new Resource<number[]>('k', async () => [1, 2]);
    await r.load('tok');
    expect(r.getSnapshot()).toMatchObject({ data: [1, 2], fromCache: false, loading: false, error: null });
    expect(memory.get('k')?.value).toEqual([1, 2]);
  });

  it('shows the cached copy first, then replaces it with the server copy', async () => {
    memory.set('k', { value: [9], savedAt: '2026-10-01T00:00:00.000Z' });
    let release!: (v: number[]) => void;
    const r = new Resource<number[]>('k', () => new Promise((res) => (release = res)));
    const seen: unknown[] = [];
    r.subscribe(() => seen.push({ data: r.getSnapshot().data, fromCache: r.getSnapshot().fromCache }));
    const p = r.load('tok');
    await tick();
    expect(r.getSnapshot()).toMatchObject({ data: [9], fromCache: true, refreshing: true, savedAt: '2026-10-01T00:00:00.000Z' });
    release([1, 2, 3]);
    await p;
    expect(r.getSnapshot()).toMatchObject({ data: [1, 2, 3], fromCache: false, refreshing: false });
  });

  it('offline with a cached copy keeps the data and says so; without one it reports the error', async () => {
    memory.set('k', { value: [9], savedAt: 'x' });
    const offline = new Resource<number[]>('k', async () => { throw new ApiError('Cannot reach the server.', 'network'); });
    await offline.load('tok');
    expect(offline.getSnapshot().data).toEqual([9]);
    expect(offline.getSnapshot().error).toMatch(/offline/i);
    expect(offline.getSnapshot().fromCache).toBe(true);

    memory.clear();
    const cold = new Resource<number[]>('k', async () => { throw new ApiError('Cannot reach the server.', 'network'); });
    await cold.load('tok');
    expect(cold.getSnapshot()).toMatchObject({ data: null, error: 'Cannot reach the server.', loading: false });
  });

  it('access denied clears the data and flags it', async () => {
    memory.set('k', { value: [9], savedAt: 'x' });
    const r = new Resource<number[]>('k', async () => { throw new ApiError('You do not have access to this.', 'forbidden', true); });
    await r.load('tok');
    expect(r.getSnapshot()).toMatchObject({ data: null, accessDenied: true });
  });

  it('does not refetch within five minutes unless forced, and shares one in-flight request', async () => {
    const fetcher = vi.fn(async () => [1]);
    const r = new Resource<number[]>('k', fetcher);
    await Promise.all([r.load('tok'), r.load('tok')]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await r.load('tok');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await r.load('tok', true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('patch updates the data and the device cache; reset forgets everything', async () => {
    const r = new Resource<number[]>('k', async () => [1, 2]);
    await r.load('tok');
    r.patch((d) => d.map((x) => x * 10));
    expect(r.getSnapshot().data).toEqual([10, 20]);
    expect(memory.get('k')?.value).toEqual([10, 20]);
    r.reset();
    expect(r.getSnapshot().data).toBeNull();
  });
});
