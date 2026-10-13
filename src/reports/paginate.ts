// Page layout of the report: which blocks (and which rows of a long table) go on which A4 page. Pure: it works on
// measured heights, so it is unit-tested with made-up numbers and the browser only has to measure.
//
// Rules
//  - every section starts on a new page;
//  - a chart (any "node" block) is never split: if it does not fit in what is left of the page it moves to the next;
//  - a block marked keepNext stays on the page of the block after it (a heading is never left alone at the bottom);
//  - a table is split between rows only; its header row repeats on every page; one row is never left alone on a page
//    (or the last data row without its total row);
//  - nothing is taller than a page after the split, except a single node that is taller than the page itself (placed
//    alone on a page; the page clips it).

export interface BlockShape { key: string; kind: 'node' | 'table'; keepNext?: boolean }
export interface SectionShape { id: string; blocks: BlockShape[] }

export interface TableSize {
  /** the table's caption / title above the header row, only printed on the first page of the table */
  caption: number;
  /** header row */
  head: number;
  /** every body row, the total row last when there is one */
  rows: number[];
  /** space under the table */
  pad: number;
  /** column widths in px, measured on the whole table so every page uses the same columns */
  cols: number[];
}
export type Sizes = Map<string, number | TableSize>;

export interface PlacedItem {
  key: string;
  /** table rows [from, to) for a table block */
  rows?: [number, number];
  /** a later page of a table (the header row repeats) */
  continued?: boolean;
}
export interface PageSpec { sectionId: string; items: PlacedItem[]; /** first page of its section */ first: boolean }

const isTable = (s: number | TableSize | undefined): s is TableSize => typeof s === 'object' && s !== null;

/** Fewest rows of a table that must stay together on a page. */
const MIN_ROWS = 2;
const heightOf = (s: number | TableSize | undefined): number => (typeof s === 'number' ? s : 0);

/** What a block needs at least to start on a page: a node needs all of its height, a table its caption, header and first rows. */
function minNeed(b: BlockShape | undefined, sizes: Sizes, firstOfTable = true): number {
  if (!b) return 0;
  const s = sizes.get(b.key);
  if (isTable(s)) {
    const take = Math.min(MIN_ROWS, s.rows.length);
    return (firstOfTable ? s.caption : 0) + s.head + s.rows.slice(0, take).reduce((a, h) => a + h, 0) + (take === s.rows.length ? s.pad : 0);
  }
  return heightOf(s);
}

export function paginate(sections: SectionShape[], sizes: Sizes, pageHeight: number): PageSpec[] {
  const pages: PageSpec[] = [];
  for (const sec of sections) {
    let cur: PageSpec = { sectionId: sec.id, items: [], first: true };
    let used = 0;
    pages.push(cur);
    const newPage = () => {
      cur = { sectionId: sec.id, items: [], first: false };
      used = 0;
      pages.push(cur);
    };
    for (let i = 0; i < sec.blocks.length; i++) {
      const b = sec.blocks[i]!;
      const s = sizes.get(b.key);
      const next = b.keepNext ? sec.blocks[i + 1] : undefined;
      if (!isTable(s)) {
        const h = heightOf(s);
        const need = h + minNeed(next, sizes);
        if (used > 0 && used + need > pageHeight) newPage();
        cur.items.push({ key: b.key });
        used += h;
        continue;
      }
      // a table: place rows page by page
      let from = 0;
      let continued = false;
      const total = s.rows.length;
      const headCost = (): number => (continued ? 0 : s.caption) + s.head;
      const startNeed = (): number => headCost() + s.rows.slice(from, from + MIN_ROWS).reduce((a, h) => a + h, 0) + (from + MIN_ROWS >= total ? s.pad : 0) + (b.keepNext && from + MIN_ROWS >= total ? minNeed(next, sizes) : 0);
      if (used > 0 && used + startNeed() > pageHeight) newPage();
      for (;;) {
        let h = headCost();
        let to = from;
        while (to < total && used + h + s.rows[to]! <= pageHeight) {
          h += s.rows[to]!;
          to++;
        }
        if (to === from && to < total) {
          // not even one row fits on a fresh page: take one anyway so the layout always advances
          if (used > 0) { newPage(); continue; }
          h += s.rows[to]!;
          to++;
        }
        // do not leave fewer than MIN_ROWS rows for the next page
        const left = total - to;
        if (left > 0 && left < MIN_ROWS && to - from > MIN_ROWS) {
          const give = MIN_ROWS - left;
          for (let g = 0; g < give; g++) { to--; h -= s.rows[to]!; }
        }
        cur.items.push({ key: b.key, rows: [from, to], continued });
        used += h;
        from = to;
        if (from >= total) {
          used += s.pad;
          break;
        }
        continued = true;
        newPage();
      }
    }
  }
  return pages;
}
