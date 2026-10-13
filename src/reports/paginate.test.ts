import { describe, expect, it } from 'vitest';
import { paginate, type Sizes, type TableSize } from './paginate';

const table = (n: number, row = 20, extra: Partial<TableSize> = {}): TableSize => ({ caption: 20, head: 24, rows: Array.from({ length: n }, () => row), pad: 10, cols: [100], ...extra });
const sec = (id: string, ...blocks: { key: string; kind: 'node' | 'table'; keepNext?: boolean }[]) => ({ id, blocks });

describe('paginate', () => {
  it('starts every section on a new page and keeps a chart whole', () => {
    const sizes: Sizes = new Map([['a:h', 60], ['a:c', 300], ['b:h', 60], ['b:c', 500], ['b:d', 500]]);
    const pages = paginate([
      sec('a', { key: 'a:h', kind: 'node', keepNext: true }, { key: 'a:c', kind: 'node' }),
      sec('b', { key: 'b:h', kind: 'node', keepNext: true }, { key: 'b:c', kind: 'node' }, { key: 'b:d', kind: 'node' }),
    ], sizes, 700);
    expect(pages.map((p) => [p.sectionId, p.items.map((i) => i.key)])).toEqual([['a', ['a:h', 'a:c']], ['b', ['b:h', 'b:c']], ['b', ['b:d']]]);
    expect(pages.map((p) => p.first)).toEqual([true, true, false]);
  });
  it('a heading is never left alone at the bottom of a page', () => {
    const sizes: Sizes = new Map([['x:h', 60], ['x:c', 300], ['y', 380], ['y:h', 60]]);
    const pages = paginate([sec('x', { key: 'y', kind: 'node' }, { key: 'y:h', kind: 'node', keepNext: true }, { key: 'x:c', kind: 'node' })], sizes, 700);
    expect(pages[0]!.items.map((i) => i.key)).toEqual(['y']);
    expect(pages[1]!.items.map((i) => i.key)).toEqual(['y:h', 'x:c']);
  });
  it('splits a table between rows, repeats the header and loses no row', () => {
    const sizes: Sizes = new Map<string, number | TableSize>([['t', table(100)]]);
    const pages = paginate([sec('s', { key: 't', kind: 'table' })], sizes, 500);
    const rows = pages.flatMap((p) => p.items.map((i) => i.rows!));
    expect(rows[0]![0]).toBe(0);
    for (let i = 1; i < rows.length; i++) expect(rows[i]![0]).toBe(rows[i - 1]![1]);
    expect(rows[rows.length - 1]![1]).toBe(100);
    expect(pages.slice(1).every((p) => p.items[0]!.continued)).toBe(true);
    for (const p of pages) {
      const [a, b] = p.items[0]!.rows!;
      const h = 24 + (p.items[0]!.continued ? 0 : 20) + (b - a) * 20;
      expect(h).toBeLessThanOrEqual(500);
    }
  });
  it('never leaves one row alone on the last page', () => {
    // 23 rows of 20 px, page 500: first page takes 20 rows (24+20+... fits 22), leaving 1 -> pulled back
    const sizes: Sizes = new Map<string, number | TableSize>([['t', table(23, 20, { caption: 0 })]]);
    const pages = paginate([sec('s', { key: 't', kind: 'table' })], sizes, 24 + 22 * 20);
    const last = pages[pages.length - 1]!.items[0]!.rows!;
    expect(last[1] - last[0]).toBeGreaterThanOrEqual(2);
  });
  it('a table after a chart starts on the same page when its first rows fit, else on the next', () => {
    const fits: Sizes = new Map<string, number | TableSize>([['c', 300], ['t', table(10)]]);
    expect(paginate([sec('s', { key: 'c', kind: 'node' }, { key: 't', kind: 'table' })], fits, 700)).toHaveLength(1);
    const tight: Sizes = new Map<string, number | TableSize>([['c', 640], ['t', table(10)]]);
    expect(paginate([sec('s', { key: 'c', kind: 'node' }, { key: 't', kind: 'table' })], tight, 700)).toHaveLength(2);
  });
  it('always advances, even when a row is taller than the page', () => {
    const sizes: Sizes = new Map<string, number | TableSize>([['t', table(3, 900)]]);
    const pages = paginate([sec('s', { key: 't', kind: 'table' })], sizes, 500);
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });
});
