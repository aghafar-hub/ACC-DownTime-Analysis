/**
 * Overlapping stops in one area count ONCE (P1).
 *
 * The downtime of an area is the UNION of its rows' [stop, restart) intervals. Time covered by several rows of the same
 * area is given to exactly one row, the "owner" of that stretch:
 *  1. classification precedence: PL (planned) wins over INC (every incidental class: PRO, MEC, ELE, AUT) wins over CIR;
 *  2. within the same precedence, the row that STARTED FIRST (earliest stop) wins;
 *  3. then the longer row, then the lower event id (deterministic).
 * Every hour figure (availability A/B/C, operating hours, MTBF, the PL / INC / CIR split, Pareto and heat-map hours) sums
 * these attributed pieces, so the Pareto totals equal the KPI hours of the same scope and nothing is counted twice.
 * Areas are independent: the attribution of one area never depends on rows of another.
 *
 * Exact duplicates (same area, code, stop, restart and classification) are one stop: the second one owns no time
 * (union) and is left out of the event chains (events.ts), so it is never counted as a second failure either.
 */
import type { EventRow } from '../api/types';
import { codeKey } from './normalize';
import { parseTs, type Interval } from './time';

/** 0 = planned (wins), 1 = incidental, 2 = circumstantial. */
export function classPrecedence(classification: string): number {
  return classification === 'PL' ? 0 : classification === 'CIR' ? 2 : 1;
}

/** The key two rows share when they are exact duplicates: area, code, stop, restart and classification. */
export function duplicateKey(r: Pick<EventRow, 'area_id' | 'code_raw' | 'stop_ts' | 'start_ts' | 'classification'>): string {
  return `${r.area_id}|${codeKey(r.code_raw ?? '')}|${r.stop_ts}|${r.start_ts}|${r.classification}`;
}

/** Attributed pieces of time per row (event_id). A row that owns no time has an empty list; a row not seen is absent. */
export interface Attribution {
  pieces: Map<string, Interval[]>;
}

interface Item { row: EventRow; from: number; to: number; prec: number }

function better(a: Item, b: Item): boolean {
  if (a.prec !== b.prec) return a.prec < b.prec;
  if (a.from !== b.from) return a.from < b.from;
  if (a.to !== b.to) return a.to > b.to;
  return a.row.event_id < b.row.event_id;
}

function attributeArea(items: Item[], out: Map<string, Interval[]>): void {
  items.sort((a, b) => a.from - b.from || a.to - b.to);
  // fast path: nothing overlaps, every row owns its whole span
  let maxTo = -Infinity;
  let overlap = false;
  for (const it of items) {
    if (it.from < maxTo) { overlap = true; break; }
    if (it.to > maxTo) maxTo = it.to;
  }
  if (!overlap) {
    for (const it of items) out.get(it.row.event_id)!.push({ fromMs: it.from, toMs: it.to });
    return;
  }
  const pts: number[] = new Array(items.length * 2);
  for (let i = 0; i < items.length; i++) { pts[2 * i] = items[i]!.from; pts[2 * i + 1] = items[i]!.to; }
  pts.sort((a, b) => a - b);
  let next = 0;
  const active: Item[] = [];
  let lastWin: Item | null = null;
  let lastPiece: Interval | null = null;
  for (let p = 0; p + 1 < pts.length; p++) {
    const lo = pts[p]!;
    const hi = pts[p + 1]!;
    if (hi === lo) continue;
    while (next < items.length && items[next]!.from <= lo) active.push(items[next++]!);
    let w = 0;
    for (let k = 0; k < active.length; k++) if (active[k]!.to > lo) active[w++] = active[k]!;
    active.length = w;
    if (w === 0) continue;
    let win = active[0]!;
    for (let k = 1; k < w; k++) if (better(active[k]!, win)) win = active[k]!;
    if (win === lastWin && lastPiece && lastPiece.toMs === lo) lastPiece.toMs = hi;
    else {
      lastPiece = { fromMs: lo, toMs: hi };
      out.get(win.row.event_id)!.push(lastPiece);
      lastWin = win;
    }
  }
}

/**
 * Attribute the time of `rows` (the caller decides which rows count: pass analysable rows of the scope). Rows with an
 * unreadable time, or a restart not after the stop, own nothing.
 */
export function attributeRows(rows: readonly EventRow[]): Attribution {
  const pieces = new Map<string, Interval[]>();
  const byArea = new Map<string, Item[]>();
  for (const row of rows) {
    pieces.set(row.event_id, []);
    const from = parseTs(row.stop_ts);
    const to = parseTs(row.start_ts);
    if (from === null || to === null || !(to > from)) continue;
    const it: Item = { row, from, to, prec: classPrecedence(row.classification) };
    const list = byArea.get(row.area_id);
    if (list) list.push(it); else byArea.set(row.area_id, [it]);
  }
  for (const items of byArea.values()) attributeArea(items, pieces);
  return { pieces };
}

/** Sum of pieces clipped to a window (all of them when the window is null), in hours. */
export function piecesHours(pieces: readonly Interval[], window: Interval | null): number {
  let ms = 0;
  for (const p of pieces) {
    const a = window ? Math.max(p.fromMs, window.fromMs) : p.fromMs;
    const b = window ? Math.min(p.toMs, window.toMs) : p.toMs;
    if (b > a) ms += b - a;
  }
  return ms / 3_600_000;
}

/** The pieces a row owns; a row the attribution has not seen keeps its own whole span (never double counted inside one attribution). */
export function piecesOf(row: Pick<EventRow, 'event_id' | 'stop_ts' | 'start_ts'>, attr: Attribution | undefined): Interval[] {
  const p = attr?.pieces.get(row.event_id);
  if (p) return p;
  const a = parseTs(row.stop_ts);
  const b = parseTs(row.start_ts);
  return a === null || b === null || !(b > a) ? [] : [{ fromMs: a, toMs: b }];
}

/** Hours a row owns inside the window (the whole row when there is no attribution for it). */
export function attributedHours(row: Pick<EventRow, 'event_id' | 'stop_ts' | 'start_ts'>, window: Interval | null, attr: Attribution | undefined): number {
  return piecesHours(piecesOf(row, attr), window);
}
