// The "By area" table on Reliability › Areas: per area the failure hours (P1 attribution, like the Areas Pareto) and,
// behind Stopped h, Failure h and Failures, the split by classification. Pure: built from the scope's rows, chains and
// attribution, so the parts always add up to the cell they explain.
//   Stopped h  -> each row's owned hours under its own classification (PRO / MEC / ELE / AUT / PL / CIR), = KPI downtime
//   Failure h  -> failure events' hours (all their rows, clipped, owned once) under the head's classification, = Areas Pareto
//   Failures   -> failure events that started in the window, by the head's classification, = KPI failure count
import {
  attributedHours, chainHours, CLASSIFICATION_CODES, isAnalysable, rangeToInterval, startedIn,
  type Attribution, type ChainedEvent, type DateRange,
} from '../calc';
import type { EventRow } from '../api/types';

/** The classifications a failure can have (P2: never PL or CIR). */
export const FAILURE_CLASSES = ['PRO', 'MEC', 'ELE', 'AUT'] as const;
/** Every classification a stop can have. */
export const STOP_CLASSES = ['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'] as const;
/** A classification outside the list (should not happen: blocked rows are left out); kept so sums never lose time. */
export const OTHER_CLASS = 'Other';

export interface Split {
  /** value per classification, in the order of the list; an 'Other' entry only when something falls outside it */
  parts: { key: string; value: number }[];
  total: number;
}

export interface AreaBreakdown {
  area_id: string;
  stoppedHours: Split;
  failureHours: Split;
  failures: Split;
}

function split(keys: readonly string[], acc: Map<string, number>): Split {
  const parts = keys.map((k) => ({ key: k, value: acc.get(k) ?? 0 }));
  const other = [...acc.entries()].filter(([k]) => !keys.includes(k)).reduce((s, [, v]) => s + v, 0);
  if (other > 0) parts.push({ key: OTHER_CLASS, value: other });
  return { parts, total: parts.reduce((s, p) => s + p.value, 0) };
}

const add = (m: Map<string, Map<string, number>>, area: string, key: string, v: number): void => {
  let a = m.get(area);
  if (!a) { a = new Map(); m.set(area, a); }
  a.set(key, (a.get(key) ?? 0) + v);
};

export function areaBreakdowns(input: {
  /** the KPI rows of the scope */
  rows: readonly EventRow[];
  /** the failure events of the scope (P2) */
  failureChains: readonly ChainedEvent[];
  window: DateRange;
  attribution: Attribution;
  areaIds: readonly string[];
}): Map<string, AreaBreakdown> {
  const w = rangeToInterval(input.window);
  const want = new Set(input.areaIds);
  const stopped = new Map<string, Map<string, number>>();
  const failH = new Map<string, Map<string, number>>();
  const failN = new Map<string, Map<string, number>>();
  for (const r of input.rows) {
    if (!want.has(r.area_id) || !isAnalysable(r)) continue;
    const h = attributedHours(r, w, input.attribution);
    if (h > 0) add(stopped, r.area_id, (CLASSIFICATION_CODES as string[]).includes(r.classification) ? r.classification : OTHER_CLASS, h);
  }
  for (const c of input.failureChains) {
    if (!want.has(c.area_id) || !isAnalysable(c.head)) continue;
    const cls = c.head.classification;
    const h = chainHours(c, w, input.attribution);
    if (h > 0) add(failH, c.area_id, cls, h);
    if (startedIn(c, w)) add(failN, c.area_id, cls, 1);
  }
  const out = new Map<string, AreaBreakdown>();
  for (const a of input.areaIds) {
    out.set(a, {
      area_id: a,
      stoppedHours: split(STOP_CLASSES, stopped.get(a) ?? new Map()),
      failureHours: split(FAILURE_CLASSES, failH.get(a) ?? new Map()),
      failures: split(FAILURE_CLASSES, failN.get(a) ?? new Map()),
    });
  }
  return out;
}

/**
 * Round the parts to `decimals` so that the rounded parts add up to the rounded total (largest remainder), e.g. the
 * shown hours of PRO + MEC + ... equal the shown cell. Returns the rounded values in the same order.
 */
export function roundParts(values: readonly number[], decimals: number): number[] {
  const f = 10 ** decimals;
  const total = Math.round(values.reduce((s, v) => s + v, 0) * f);
  const scaled = values.map((v) => v * f);
  const floors = scaled.map((v) => Math.floor(v + 1e-9));
  let left = total - floors.reduce((s, v) => s + v, 0);
  const order = scaled.map((v, i) => ({ i, r: v - Math.floor(v + 1e-9) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) floors[order[k]!.i]! += 1;
  for (let k = order.length - 1; left < 0 && order.length; k = (k - 1 + order.length) % order.length, left++) floors[order[k]!.i]! -= 1;
  return floors.map((v) => v / f);
}

/** Shares in % (one decimal) that add up to 100.0 (0 for an empty split). */
export function sharePcts(values: readonly number[]): number[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return values.map(() => 0);
  return roundParts(values.map((v) => (v / total) * 100), 1);
}
