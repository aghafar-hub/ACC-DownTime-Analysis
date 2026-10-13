// The Validate page's data: which records need checking, why, and how to fix several at once.
// Pure TypeScript (no React, no network) so it is unit-tested on its own.
//
// A record's problems = its stored flags (events.flags) + the derived WARNING `failure_flag_mismatch` (Failure = YES on a
// PL / CIR or Freq = 0 row, worked out from the row itself). Voided records never appear. Information flags are not
// problems: code_not_in_area ("Cause in another area") and the derived `overlap_in_area` (found by comparing events with
// findOverlaps; overlapping stops of one area are counted once, see calc/attribution.ts). A record whose only flags are
// information is not listed as open; overlaps stay visible as information (`partners`, the Overlaps view and tile).
//
// "Keep as entered": flags a person acknowledged (events.accepted_flags) are not open any more. A record with only accepted
// problems leaves the open list and is listed under "Kept as entered" instead. An accepted WARNING makes the record normal;
// an accepted BLOCKING problem stops being something to fix but the record stays out of the numbers (calc keeps reading the
// stored flags), so its hours are shown apart as "Kept as entered, left out of the numbers".
import type { EventChanges, EventRow } from '../api/types';
import {
  acceptedFlagsOf, blockedSummary, BLOCKING_FLAGS, codeKey, FLAG_INFO, findOverlaps, hasFailureFlagMismatch, isBlocked, isBlockingFlag, isInfoFlag, isKeptLeftOut,
  isOpenBlocked, rowSeconds, splitFlags, WARNING_FLAGS,
} from '../calc';

/** Derived INFORMATION: the record overlaps another of the same area (counted once; nothing to fix). */
export const OVERLAP_FLAG = 'overlap_in_area';
/** Derived WARNING: Failure = YES on a planned/other or continuation row. */
export const MISMATCH_FLAG = 'failure_flag_mismatch';

/** Every problem of the catalogue in display order: blocking first, then warnings (the derived mismatch last). */
export const FLAG_ORDER: string[] = [...BLOCKING_FLAGS, ...WARNING_FLAGS, MISMATCH_FLAG];

export interface ValidationRecord {
  event: EventRow;
  /** OPEN problems: stored flags (blocking first) followed by `failure_flag_mismatch` when it applies, minus the ones kept as entered */
  problems: string[];
  /** information about the record (never a problem): `overlap_in_area` when it overlaps another record of the same area */
  info: string[];
  /** flags of this record that were kept as entered (it can be in the open list for other problems) */
  kept: string[];
  /** has at least one open blocking problem: left out of the numbers until fixed */
  blocking: boolean;
  /** event ids of the records this one overlaps (empty when it does not) */
  partners: string[];
  /** 'YYYY-MM' of the stop */
  month: string;
}

/** A record with at least one flag kept as entered. */
export interface KeptRecord {
  event: EventRow;
  /** the accepted flags, catalogue order */
  flags: string[];
  /** blocked by a stored blocking problem and no open blocking problem left: nothing to fix, but still out of the numbers */
  leftOut: boolean;
  /** 'YYYY-MM' of the stop */
  month: string;
}

export interface ValidationSummary {
  /** records needing checking (open problems) */
  total: number;
  /** left out of the numbers and still to be fixed (open blocking problem) */
  blocked: { count: number; hours: number };
  /** records with something kept as entered, and among them the ones still left out of the numbers (hours) */
  kept: { count: number; leftOut: { count: number; hours: number } };
  /** analysed as they are, but worth a look (warnings, and no blocking problem) */
  review: { count: number };
  /** INFORMATION: records that overlap another record of the same area (counted once; blocking ones are ignored by the overlap search) */
  overlapping: number;
  /** records per problem */
  byFlag: Record<string, number>;
}

export interface ValidationList {
  /** records with open problems */
  records: ValidationRecord[];
  /** INFORMATION: every record that overlaps another of the same area (problems or not), newest stop first */
  overlapRecords: ValidationRecord[];
  /** records with problems kept as entered, newest acceptance first */
  keptRecords: KeptRecord[];
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

/** The OPEN stored problems: storedProblems minus the flags kept as entered. */
export function openStoredProblems(e: Pick<EventRow, 'flags' | 'accepted_flags'>): string[] {
  const kept = new Set(acceptedFlagsOf(e));
  return storedProblems(e).filter((f) => !kept.has(f));
}

/** The open problems of a record: stored ones plus the derived failure_flag_mismatch, minus the ones kept as entered. */
export function openProblemsOf(e: EventRow): string[] {
  const kept = acceptedFlagsOf(e);
  const problems = openStoredProblems(e);
  if (hasFailureFlagMismatch(e) && !kept.includes(MISMATCH_FLAG)) problems.push(MISMATCH_FLAG);
  return problems;
}

/** The record as Validate shows it (with its overlaps as information), or null when it has no open problem. */
function fullRecordOf(e: EventRow, partners: string[]): ValidationRecord {
  const kept = acceptedFlagsOf(e);
  const problems = openProblemsOf(e);
  return { event: e, problems, info: partners.length ? [OVERLAP_FLAG] : [], kept, blocking: problems.some(isBlockingFlag), partners, month: e.stop_ts.slice(0, 7) };
}

function recordOf(e: EventRow, partners: string[]): ValidationRecord | null {
  const r = fullRecordOf(e, partners);
  return r.problems.length === 0 ? null : r;
}

/** Newest acceptance first, then event id. */
export function compareKept(a: KeptRecord, b: KeptRecord): number {
  return (b.event.accepted_at ?? '').localeCompare(a.event.accepted_at ?? '') || a.event.event_id.localeCompare(b.event.event_id);
}

function keptOf(e: EventRow): KeptRecord | null {
  if (e.is_void) return null;
  const flags = acceptedFlagsOf(e);
  if (flags.length === 0) return null;
  return { event: e, flags, leftOut: isKeptLeftOut(e), month: e.stop_ts.slice(0, 7) };
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
  const overlapRecords: ValidationRecord[] = [];
  for (const e of events) {
    if (e.is_void) continue;
    const partners = overlaps.partners.get(e.event_id) ?? [];
    const full = fullRecordOf(e, partners);
    if (full.problems.length) records.push(full);
    if (partners.length) overlapRecords.push(full);
  }
  records.sort(compareRecords);
  overlapRecords.sort((a, b) => b.event.stop_ts.localeCompare(a.event.stop_ts) || a.event.event_id.localeCompare(b.event.event_id));
  const byFlag: Record<string, number> = {};
  let review = 0;
  for (const r of records) {
    for (const f of r.problems) byFlag[f] = (byFlag[f] ?? 0) + 1;
    if (!r.blocking) review++;
  }
  const overlapping = overlapRecords.length;
  const keptRecords: KeptRecord[] = [];
  for (const e of events) {
    const k = keptOf(e);
    if (k) keptRecords.push(k);
  }
  keptRecords.sort(compareKept);
  // calc keeps reading the STORED flags: only records with an open blocking problem are "to fix"; kept ones are shown apart
  const live = events.filter((e) => !e.is_void);
  const b = blockedSummary(live.filter(isOpenBlocked)).total;
  const lo = blockedSummary(live.filter(isKeptLeftOut)).total;
  return {
    records,
    overlapRecords,
    keptRecords,
    summary: {
      total: records.length, blocked: { count: b.count, hours: b.hours },
      kept: { count: keptRecords.length, leftOut: { count: lo.count, hours: lo.hours } },
      review: { count: review }, overlapping, byFlag,
    },
  };
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

/** Kept-as-entered records matching the area, month and search of the filter (problem chips and "blocking only" apply to open records only). */
export function applyKeptFilter(records: readonly KeptRecord[], f: ValidateFilter): KeptRecord[] {
  const needle = f.q.trim().toLowerCase();
  return records.filter((r) => {
    const e = r.event;
    if (f.flags.length && !f.flags.some((x) => r.flags.includes(x))) return false;
    if (f.area && e.area_id !== f.area) return false;
    if (f.month && r.month !== f.month) return false;
    if (needle) {
      const hay = `${e.code_raw} ${e.equipment_id ?? ''} ${e.reason_raw ?? ''} ${e.description ?? ''} ${e.event_id}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export const areasOf = (records: readonly Pick<ValidationRecord, 'event'>[]): string[] => [...new Set(records.map((r) => r.event.area_id))].sort();
export const monthsOf = (records: readonly Pick<ValidationRecord, 'month'>[]): string[] => [...new Set(records.map((r) => r.month))].sort().reverse();

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
  explain: (message: string) => string = plainReason,
): Promise<BulkResult> {
  const done: string[] = [];
  const failed: BulkFailure[] = [];
  for (let i = 0; i < ids.length; i++) {
    onProgress?.(i, ids.length);
    try {
      await edit(ids[i]);
      done.push(ids[i]);
    } catch (err) {
      failed.push({ id: ids[i], reason: explain(err instanceof Error ? err.message : String(err)) });
    }
  }
  return { done, failed };
}

// ---------------------------------------------------------------- keep as entered

/** Note the confirmation sheet starts with. */
export const KEEP_NOTE = 'Checked: entered correctly';
/** The server needs at least this many characters. */
export const KEEP_NOTE_MIN = 3;

/**
 * The FULL new set of kept flags to send for one record: what it already has kept plus its open problems that are ticked.
 * null when none of its problems is ticked (nothing to keep for it).
 */
export function keepSetFor(r: Pick<ValidationRecord, 'problems' | 'kept'>, ticked: ReadonlySet<string>): string[] | null {
  const add = r.problems.filter((f) => ticked.has(f));
  return add.length ? [...new Set([...r.kept, ...add])] : null;
}

/** The FULL new set after "Undo": what the record has kept minus the ticked flags. null when none of its kept flags is ticked. */
export function undoSetFor(r: Pick<ValidationRecord, 'kept'>, ticked: ReadonlySet<string>): string[] | null {
  const drop = r.kept.filter((f) => ticked.has(f));
  return drop.length ? r.kept.filter((f) => !ticked.has(f)) : null;
}

export interface KeepConsequence {
  /** problems the person left unticked: the record stays in the open list */
  staysListed: boolean;
  /** the record is blocked by a stored blocking problem, so it stays out of the numbers whatever is kept */
  leftOut: boolean;
  /** the plain sentence shown on the confirmation sheet */
  sentence: string;
}

/** What keeping the ticked flags of one record means, in plain words. */
export function keepConsequence(r: Pick<ValidationRecord, 'problems' | 'event'>, ticked: ReadonlySet<string>): KeepConsequence {
  const staysListed = r.problems.some((f) => !ticked.has(f));
  const leftOut = isBlocked(r.event);
  const parts = [
    'Nothing in the record changes.',
    staysListed ? 'It stays listed for the problems you did not tick.' : 'It will stop being listed.',
    leftOut ? 'It is still left out of the numbers.' : 'It counts normally.',
  ];
  return { staysListed, leftOut, sentence: parts.join(' ') };
}

/** The same sentence for several records at once. */
export function keepConsequenceMany(rs: readonly Pick<ValidationRecord, 'problems' | 'event'>[], ticked: ReadonlySet<string>): string {
  if (rs.length === 1) return keepConsequence(rs[0], ticked).sentence;
  const cs = rs.map((r) => keepConsequence(r, ticked));
  const out = cs.filter((c) => c.leftOut).length;
  const parts = [
    'Nothing in these records changes.',
    cs.some((c) => c.staysListed) ? 'A record stays listed for any problem you did not tick.' : 'They will stop being listed.',
    out === 0 ? 'They count normally.' : out === cs.length ? 'They are still left out of the numbers.' : `${out} of them are still left out of the numbers; ${cs.length - out} count normally.`,
  ];
  return parts.join(' ');
}

/** The problems on offer for a group of records: each with how many records have it, in catalogue order. */
export function keepChoices(records: readonly Pick<ValidationRecord, 'problems'>[]): { flag: string; count: number; blocking: boolean }[] {
  const counts = new Map<string, number>();
  for (const r of records) for (const f of r.problems) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([flag, count]) => ({ flag, count, blocking: isBlockingFlag(flag) }));
}

/** Server messages for keep / undo in the words a person would use. */
export function plainKeepReason(message: string): string {
  const m = (message || '').trim();
  if (/nothing was changed/i.test(m)) return 'It is already kept like this, so there was nothing to change.';
  if (/does not have the problem/i.test(m)) return 'It no longer has this problem (it may have been fixed since the list was loaded).';
  if (/void/i.test(m)) return 'It is voided. Restore it before changing it.';
  return m || 'The server refused this change.';
}
