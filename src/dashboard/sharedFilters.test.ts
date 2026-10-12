import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { forgetDashFilters, rememberedQuery, rememberQuery } from './sharedFilters';

// The filters shared by the four Analyze pages are remembered in sessionStorage; a blocked storage must not break them.
describe('shared filters memory', () => {
  const g = globalThis as unknown as { sessionStorage?: Storage };
  const saved = g.sessionStorage;
  let data: Record<string, string>;
  beforeEach(() => {
    data = {};
    g.sessionStorage = {
      getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; }, removeItem: (k: string) => { delete data[k]; },
    } as unknown as Storage;
    forgetDashFilters();
  });
  afterEach(() => { g.sessionStorage = saved; });

  it('keeps the last query in memory and in sessionStorage and forgets it on reset', () => {
    rememberQuery('area=K.1&r=last30');
    expect(rememberedQuery()).toBe('area=K.1&r=last30');
    expect(Object.values(data)).toContain('area=K.1&r=last30');
    forgetDashFilters();
    expect(rememberedQuery()).toBe('');
    expect(Object.keys(data)).toHaveLength(0);
  });

  it('works when the storage throws', () => {
    g.sessionStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(() => rememberQuery('fail=1')).not.toThrow();
    expect(rememberedQuery()).toBe('fail=1');
    expect(() => forgetDashFilters()).not.toThrow();
  });
});
