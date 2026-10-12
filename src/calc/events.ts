/** Chaining of downtime rows into events (docs section 8). */
import type { EventRow } from '../api/types';
import { MS_SECOND, clippedHours, parseTs, type Interval } from './time';

/** [stop, restart) of a row in ms, or null when a timestamp is unreadable. */
export function rowSpan(row: Pick<EventRow, 'stop_ts' | 'start_ts'>): Interval | null {
  const a = parseTs(row.stop_ts);
  const b = parseTs(row.start_ts);
  return a === null || b === null ? null : { fromMs: a, toMs: b };
}

/** Seconds of a row; 0 when unreadable or when the restart is before the stop. */
export function rowSeconds(row: Pick<EventRow, 'stop_ts' | 'start_ts'>): number {
  const s = rowSpan(row);
  return s && s.toMs > s.fromMs ? (s.toMs - s.fromMs) / MS_SECOND : 0;
}

/** Hours of a row inside a window (the whole row when window is null). */
export function rowHours(row: Pick<EventRow, 'stop_ts' | 'start_ts'>, window: Interval | null): number {
  if (window === null) return rowSeconds(row) / 3600;
  const s = rowSpan(row);
  return s ? clippedHours(s, window) : 0;
}

/** One downtime event: a head row plus the continuation rows chained to it. */
export interface ChainedEvent {
  /** event_id of the head row */
  id: string;
  area_id: string;
  line_id: string;
  head: EventRow;
  rows: EventRow[];
  /** stop of the head row, ms */
  startMs: number;
  /** latest restart of any row, ms */
  endMs: number;
  /** YYYY-MM-DD of the head's stop; the event is counted in the period containing it */
  startDate: string;
  /** sum of the rows' seconds */
  durationS: number;
  /** head row is a failure and the chain is not an orphan */
  isFailure: boolean;
  /** first row has Freq = 0: continuation of an event that is not in the data */
  orphan: boolean;
}

export interface BuildOptions {
  /** gap allowed between a row's restart and the next row's stop; default 1 second */
  toleranceMs?: number;
  /** keep voided rows (default false: voided rows are removed before chaining) */
  includeVoid?: boolean;
}

export interface EventBuild {
  /** every chain, ordered by start then area */
  chains: ChainedEvent[];
  /** chains whose head is a Freq = 1 row with is_failure */
  failureEvents: ChainedEvent[];
  /** chains that start with a Freq = 0 row; reported, never dropped */
  orphans: ChainedEvent[];
  /** rows with unreadable timestamps (cannot be chained) */
  unreadable: EventRow[];
}

interface Parsed { row: EventRow; stop: number; start: number; idx: number }

function newChain(p: Parsed, orphan: boolean): ChainedEvent {
  return {
    id: p.row.event_id,
    area_id: p.row.area_id,
    line_id: p.row.line_id,
    head: p.row,
    rows: [p.row],
    startMs: p.stop,
    endMs: p.start,
    startDate: p.row.stop_ts.slice(0, 10),
    durationS: p.start > p.stop ? (p.start - p.stop) / MS_SECOND : 0,
    isFailure: !orphan && p.row.is_failure,
    orphan,
  };
}

function extend(c: ChainedEvent, p: Parsed): void {
  c.rows.push(p.row);
  c.endMs = Math.max(c.endMs, p.start);
  if (p.start > p.stop) c.durationS += (p.start - p.stop) / MS_SECOND;
}

function chainArea(parsed: Parsed[], tol: number): ChainedEvent[] {
  parsed.sort((a, b) => a.stop - b.stop || b.row.freq - a.row.freq || a.idx - b.idx);
  const out: ChainedEvent[] = [];
  const open: { chain: ChainedEvent; tail: number }[] = [];
  for (const p of parsed) {
    // later rows cannot attach to a tail that restarted earlier than this stop minus the tolerance: drop it (in place)
    let w = 0;
    for (let r = 0; r < open.length; r++) if (open[r]!.tail >= p.stop - tol) open[w++] = open[r]!;
    open.length = w;
    if (p.row.freq === 1) {
      const c = newChain(p, false);
      out.push(c);
      open.push({ chain: c, tail: p.start });
      continue;
    }
    let best: { chain: ChainedEvent; tail: number } | null = null;
    for (const o of open) {
      if (Math.abs(o.tail - p.stop) <= tol && (!best || Math.abs(o.tail - p.stop) < Math.abs(best.tail - p.stop))) best = o;
    }
    if (best) {
      extend(best.chain, p);
      best.tail = p.start;
    } else {
      const c = newChain(p, true);
      out.push(c);
      open.push({ chain: c, tail: p.start });
    }
  }
  return out;
}

/**
 * Chain rows into events, per area. A Freq = 1 row starts an event; following Freq = 0 rows whose stop equals
 * the previous row's restart (within the tolerance, default 1 s, which also covers a midnight split) join it
 * whatever their reason or classification. A Freq = 0 row with nothing to join is an orphan chain.
 * The event is counted in the period where it starts (`startDate`).
 */
export function buildFailureEvents(rows: EventRow[], options: BuildOptions = {}): EventBuild {
  const tol = options.toleranceMs ?? MS_SECOND;
  const byArea = new Map<string, Parsed[]>();
  const unreadable: EventRow[] = [];
  rows.forEach((row, idx) => {
    if (row.is_void && !options.includeVoid) return;
    const stop = parseTs(row.stop_ts);
    const start = parseTs(row.start_ts);
    if (stop === null || start === null) {
      unreadable.push(row);
      return;
    }
    const list = byArea.get(row.area_id);
    if (list) list.push({ row, stop, start, idx });
    else byArea.set(row.area_id, [{ row, stop, start, idx }]);
  });
  const chains: ChainedEvent[] = [];
  for (const list of byArea.values()) chains.push(...chainArea(list, tol));
  chains.sort((a, b) => a.startMs - b.startMs || (a.area_id < b.area_id ? -1 : a.area_id > b.area_id ? 1 : 0) || (a.id < b.id ? -1 : 1));
  return {
    chains,
    failureEvents: chains.filter((c) => c.isFailure),
    orphans: chains.filter((c) => c.orphan),
    unreadable,
  };
}

export function chainHours(c: ChainedEvent, window: Interval | null = null): number {
  if (window === null) return c.durationS / 3600;
  let h = 0;
  for (const r of c.rows) h += rowHours(r, window);
  return h;
}

/** Did the event start (head stop) inside the window? */
export function startedIn(c: ChainedEvent, window: Interval): boolean {
  return c.startMs >= window.fromMs && c.startMs < window.toMs;
}

