// Data-quality scorecard: how clean the stored records are, month by month. Pure TypeScript (no React).
//
// Same rules as the Validate list (buildValidation): voided records are ignored; a record is "clean" when it has no OPEN
// problem (a problem kept as entered is not open, see calc/flags.ts openFlagsOf); the month is the month of the stop.
//  - left out of the numbers: records with a stored blocking problem. Keeping a blocking problem as entered does NOT bring
//    the record back into the numbers (isBlocked reads the stored flags), so it is counted here either way, with its hours.
//  - kept as entered: records with at least one problem kept as entered (they count as clean unless another problem is open).
import type { EventRow } from '../api/types';
import { isBlocked, rowSeconds } from '../calc';
import { buildValidation, type ValidationList } from './model';

export interface MonthQuality {
  /** 'YYYY-MM' of the stop */
  month: string;
  /** records that are not voided */
  records: number;
  /** records with at least one open problem (the Validate list for that month) */
  openProblems: number;
  /** records left out of the numbers (stored blocking problem, kept as entered or not) */
  leftOut: { count: number; hours: number };
  /** records with a problem kept as entered */
  keptAsEntered: number;
  /** share of records without an open problem, 0 to 100; null when the month has no records */
  cleanPct: number | null;
}

export interface Scorecard {
  /** newest month first */
  months: MonthQuality[];
  /** all months together */
  total: MonthQuality;
}

const empty = (month: string): MonthQuality => ({ month, records: 0, openProblems: 0, leftOut: { count: 0, hours: 0 }, keptAsEntered: 0, cleanPct: null });

function finish(q: MonthQuality): MonthQuality {
  q.cleanPct = q.records > 0 ? ((q.records - q.openProblems) / q.records) * 100 : null;
  return q;
}

/** The scorecard of every loaded record. Pass the validation list when you already have it (it is the same one the Validate page shows). */
export function buildScorecard(events: readonly EventRow[], list: ValidationList = buildValidation(events)): Scorecard {
  const byMonth = new Map<string, MonthQuality>();
  const get = (m: string): MonthQuality => {
    let q = byMonth.get(m);
    if (!q) { q = empty(m); byMonth.set(m, q); }
    return q;
  };
  for (const e of events) {
    if (e.is_void) continue;
    const q = get(e.stop_ts.slice(0, 7));
    q.records++;
    if (isBlocked(e)) { q.leftOut.count++; q.leftOut.hours += rowSeconds(e) / 3600; }
  }
  for (const r of list.records) get(r.month).openProblems++;
  for (const k of list.keptRecords) get(k.month).keptAsEntered++;
  const months = [...byMonth.values()].map(finish).sort((a, b) => b.month.localeCompare(a.month));
  const total = empty('');
  for (const q of months) {
    total.records += q.records;
    total.openProblems += q.openProblems;
    total.leftOut.count += q.leftOut.count;
    total.leftOut.hours += q.leftOut.hours;
    total.keptAsEntered += q.keptAsEntered;
  }
  return { months, total: finish(total) };
}

/** The Overview card appears only for a person who can open Validate, and only while something is open to check. */
export function showQualityCard(canOpenValidate: boolean, summary: Pick<Scorecard, 'total'>, toCheck: number): boolean {
  return canOpenValidate && toCheck > 0 && summary.total.cleanPct !== null;
}
