// The Validate page's data: which records need checking, why, and how to fix several at once.
// Pure TypeScript (no React, no network) so it is unit-tested on its own.
//
// A record's problems = its stored flags (events.flags) + the derived `overlap_in_area`, found by
// comparing events (findOverlaps over the loaded events; blocked and voided ones are ignored there).
// Voided records never appear. Information flags (code_not_in_area: "Cause in another area") are not problems:
// they are dropped here, so a record whose only flag is one of them is simply fine and is not listed.
import type { EventChanges, EventRow } from '../api/types';
import { blockedSummary, BLOCKING_FLAGS, codeKey, FLAG_INFO, findOverlaps, isBlocked, isBlockingFlag, isInfoFlag, rowSeconds, splitFlags, WARNING_FLAGS } from '../calc';

export const OVERLAP_FLAG = 'overlap_in_area';

/** Every flag of the catalogue in display order: blocking first, then warnings, then the derived one. */
export const FLAG_ORDER: string[] = [...BLOCKING_FLAGS, ...WARNING_FLAGS, OVERLAP_FLAG];

export interface ValidationRecord {
  event: EventRow;
  /** stored flags (blocking first) followed by `overlap_in_area` when the record overlaps another */
  problems: string[];
  /** has at least one blocking problem: left out of the numbers until fixed */
  blocking: boolean;
  /** event ids of the records this one overlaps (empty when it does not) */
  partners: string[];
  /** 'YYYY-MM' of the stop */
  month: string;
}

export interface ValidationSummary {
  /** records needing checking */
  total: number;
  /** left out of the numbers (blocking problem) */
  blocked: { count: number; hours: number };
  /** analysed as they are, but worth a look (warnings or an overlap, and no blocking problem) */
  review: { count: number };
  /** records that overlap another record (blocking ones cannot: they are ignored by the overlap search) */
  overlapping: number;
  /** records per problem */
  byFlag: Record<string, number>;
}

export interface ValidationList {
  records: ValidationRecord[];
  summary: ValidationSummary;
}

const rank = (flag: string): number => {
  const i = FLAG_ORDER.indexOf(flag);
  return i < 0 ? FLAG_ORDER.length : i;
};

/** The stored problems of an event in catalogue order, without repeats. Unknown names count as warnings; information flags are not problems. */
export function storedProblems(e: Pick<EventRow, 'flags'>): string[] {
  return [...new Set(splitFlags(e.flags).filter((f) => !isInfoFlag(f)))].sort((a, b) => rank(a) - rank(b));
}

function recordOf(e: EventRow, partners: string[]): ValidationRecord | null {
  const problems = storedProblems(e);
  if (partners.length) problems.push(OVERLAP_FLAG);
  if (problems.length === 0) return null;
  return { event: e, problems, blocking: problems.some(isBlockingFlag), partners, month: e.stop_ts.slice(0, 7) };
}

/** Blocking records first, then newest stop first, then event id (a stable order). */
export function compareRecords(a: ValidationRecord, b: ValidationRecord): number {
  if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
  return b.event.stop_ts.localeCompare(a.event.stop_ts) || a.event.event_id.localeCompare(b.event.event_id);
}

/** The list for every loaded event (all years). */
export function buildValidation(events: readonly EventRow[]): ValidationList {
  const overlaps = findOverlaps(events);
  const records: ValidationRecord[] = [];
  for (const e of events) {
    if (e.is_void) continue;
    const r = recordOf(e, overlaps.partners.get(e.event_id) ?? []);
    if (r) records.push(r);
  }
  records.sort(compareRecords);
  const byFlag: Record<string, number> = {};
  let overlapping = 0;
  let review = 0;
  for (const r of records) {
    for (const f of r.problems) byFlag[f] = (byFlag[f] ?? 0) + 1;
    if (r.partners.length) overlapping++;
    if (!r.blocking) review++;
  }
  const b = blockedSummary(events).total;
  return { records, summary: { total: records.length, blocked: { count: b.count, hours: b.hours }, review: { count: review }, overlapping, byFlag } };
}

/**
 * After a fix: the record as it now stands (with its overlaps against the other loaded records),
 * or null when it has no problem left. `events` may still hold the old version of `updated`.
 */
export function recheckRecord(events: readonly EventRow[], updated: EventRow): ValidationRecord | null {
  if (updated.is_void) return null;
  const next = events.map((e) => (e.event_id === updated.event_id ? updated : e));
  if (!next.some((e) => e.event_id === updated.event_id)) next.push(updated);
  return recordOf(updated, findOverlaps(next).partners.get(updated.event_id) ?? []);
}

// ---------------------------------------------------------------- filters

export interface ValidateFilter {
  /** keep records that have ANY of these problems (empty: all) */
  flags: string[];
  area: string;
  /** 'YYYY-MM' */
  month: string;
  /** free text over code, reason, description (and event id) */
  q: string;
  blockingOnly: boolean;
}
export const EMPTY_FILTER: ValidateFilter = { flags: [], area: '', month: '', q: '', blockingOnly: false };

/** How many filters are on (the search text counts as one). */
export const filterCount = (f: ValidateFilter): number => f.flags.length + [f.area, f.month, f.q.trim(), f.blockingOnly].filter(Boolean).length;

/**
 * The filter named by a link's query: `flag` (comma separated problems), `area`, `month` (YYYY-MM), `q` and `blocking=1`.
 * null when the query names none of them (so opening the page by hand keeps whatever the person had set).
 */
export function filterFromParams(sp: URLSearchParams): ValidateFilter | null {
  const flags = (sp.get('flag') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const area = (sp.get('area') ?? '').trim();
  const month = /^\d{4}-\d{2}$/.test(sp.get('month') ?? '') ? sp.get('month')! : '';
  const q = (sp.get('q') ?? '').trim();
  const blockingOnly = sp.get('blocking') === '1';
  if (!flags.length && !area && !month && !q && !blockingOnly) return null;
  return { flags, area, month, q, blockingOnly };
}

export function applyValidateFilter(records: readonly ValidationRecord[], f: ValidateFilter): ValidationRecord[] {
  const needle = f.q.trim().toLowerCase();
  return records.filter((r) => {
    const e = r.event;
    if (f.blockingOnly && !r.blocking) return false;
    if (f.flags.length && !f.flags.some((x) => r.problems.includes(x))) return false;
    if (f.area && e.area_id !== f.area) return false;
    if (f.month && r.month !== f.month) return false;
    if (needle) {
      const hay = `${e.code_raw} ${e.equipment_id ?? ''} ${e.reason_raw ?? ''} ${e.description ?? ''} ${e.event_id}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export const areasOf = (records: readonly ValidationRecord[]): string[] => [...new Set(records.map((r) => r.event.area_id))].sort();
export const monthsOf = (records: readonly ValidationRecord[]): string[] => [...new Set(records.map((r) => r.month))].sort().reverse();

/** The flags that occur in the records, with their counts, in catalogue order (unknown names last). */
export function flagCounts(records: readonly ValidationRecord[]): { flag: string; count: number; blocking: boolean }[] {
  const counts = new Map<string, number>();
  for (const r of records) for (const f of r.problems) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([flag, count]) => ({ flag, count, blocking: isBlockingFlag(flag) }));
}

/** The fix text of a record's first problem. */
export function firstFixHint(r: Pick<ValidationRecord, 'problems'>): string {
  const info = (FLAG_INFO as Record<string, { fix: string } | undefined>)[r.problems[0]];
  return info?.fix ?? '';
}

export const hoursOfEvent = (e: Pick<EventRow, 'stop_ts' | 'start_ts'>): number => rowSeconds(e) / 3600;

// ---------------------------------------------------------------- suggestions

export interface ClassificationSuggestion { code: string; count: number }

/**
 * For a record without a (valid) classification: the classification used most often for the same area and
 * the same equipment code among the loaded, valid, not voided records. Build once, ask per record.
 */
export function buildClassificationSuggester(events: readonly EventRow[]): (areaId: string, code: string) => ClassificationSuggestion | null {
  const counts = new Map<string, Map<string, number>>();
  for (const e of events) {
    if (e.is_void || !e.code_raw.trim() || isBlocked(e)) continue;
    const key = `${e.area_id}|${codeKey(e.code_raw)}`;
    const m = counts.get(key) ?? new Map<string, number>();
    m.set(e.classification, (m.get(e.classification) ?? 0) + 1);
    counts.set(key, m);
  }
  return (areaId, code) => {
    if (!code.trim()) return null;
    const m = counts.get(`${areaId}|${codeKey(code)}`);
    if (!m) return null;
    const best = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return best ? { code: best[0], count: best[1] } : null;
  };
}

// ---------------------------------------------------------------- bulk fixes

/** Most records one bulk run may change. */
export const BULK_CAP = 200;

export interface BulkFields {
  classification?: string;
  area_id?: string;
  reason_raw?: string;
  code_raw?: string;
  line_id?: string;
}

export type BulkPlan =
  | { ok: true; changes: EventChanges; fields: string[] }
  | { ok: false; error: string };

/** The changes to send to every selected record; at least one field and a note are needed. Empty fields are left alone. */
export function planBulk(fields: BulkFields, note: string): BulkPlan {
  const changes: Record<string, string> = {};
  const used: string[] = [];
  const take = (k: keyof BulkFields, v: string | undefined) => {
    const s = (v ?? '').trim();
    if (s) {
      changes[k] = s;
      used.push(k);
    }
  };
  take('classification', fields.classification?.toUpperCase());
  take('area_id', fields.area_id);
  take('line_id', fields.line_id);
  take('code_raw', fields.code_raw);
  take('reason_raw', fields.reason_raw);
  if (used.length === 0) return { ok: false, error: 'Choose at least one thing to set.' };
  if (!note.trim()) return { ok: false, error: 'Write a short note saying why you are changing these records.' };
  return { ok: true, changes: changes as EventChanges, fields: used };
}

/** The ids a bulk run will use: the first BULK_CAP of the list, and whether the rest were left out. */
export function capSelection(ids: readonly string[], cap = BULK_CAP): { ids: string[]; capped: boolean } {
  return { ids: ids.slice(0, cap), capped: ids.length > cap };
}

export interface BulkFailure { id: string; reason: string }
export interface BulkResult { done: string[]; failed: BulkFailure[] }

/** Server messages in the words a person would use. */
export function plainReason(message: string): string {
  const m = (message || '').trim();
  if (/nothing was changed/i.test(m)) return 'It already has these values, so there was nothing to change.';
  if (/void/i.test(m) && /restore/i.test(m)) return 'It is voided. Restore it before changing it.';
  return m || 'The server refused this change.';
}

/**
 * Applies the same change to each id, one after the other. A refusal is recorded and the run goes on with the
 * next record (it never stops at the first failure). `edit` is the API call; `onProgress(done, total)` is
 * called before each record.
 */
export async function runBulk(
  ids: readonly string[],
  edit: (id: string) => Promise<unknown>,
  onProgress?: (index: number, total: number) => void,
): Promise<BulkResult> {
  const done: string[] = [];
  const failed: BulkFailure[] = [];
  for (let i = 0; i < ids.length; i++) {
    onProgress?.(i, ids.length);
    try {
      await edit(ids[i]);
      done.push(ids[i]);
    } catch (err) {
      failed.push({ id: ids[i], reason: plainReason(err instanceof Error ? err.message : String(err)) });
    }
  }
  return { done, failed };
}
