/**
 * Pure comparison of an uploaded workbook against stored events (docs section 6).
 * Never writes anything; the UI shows the result and the user decides what to add.
 */
import type { EventRow, UploadRow, UploadWarning, WarningType } from '../api/types';
import { rowSeconds, rowSpan } from './events';
import { findOverlaps } from './overlaps';
import { computeEventFlags, findArea } from './validate';
import type { MasterIndex } from './masters';
import { areasOf } from './masters';
import { codeKey, isAreaLevelCode, matchKey, normalizeClassification, resolveCode, resolveReason } from './normalize';
import { MS_SECOND, durationSeconds } from './time';

export type RowStatus = 'identical' | 'new' | 'late_row' | 'changed_row';
export type Severity = 'warning' | 'info';

export type DiffWarning = Omit<UploadWarning, 'warning_id' | 'batch_id'> & {
  type: WarningType;
  severity: Severity;
  /** fingerprint of the uploaded row (absent for missing_row, which refers to a stored event) */
  fingerprint?: string;
  /** YYYY-MM, for late_month */
  month?: string;
};

/** An uploaded row, optionally with the sheet's own total duration for the duration_mismatch check. */
export type DiffUploadRow = UploadRow & { sheet_duration_s?: number };

export type DiffField = 'freq' | 'classification' | 'criticality' | 'is_failure' | 'reason_raw' | 'description' | 'event_date' | 'line_id';
export const COMPARED_FIELDS: DiffField[] = ['freq', 'classification', 'criticality', 'is_failure', 'reason_raw', 'description', 'event_date', 'line_id'];

export interface FieldChange { field: DiffField; stored: string; uploaded: string }

/** A late row is decided on its own ('row': its month already has stored events) or with its whole month ('month'). */
export type LateScope = 'row' | 'month';

export interface RowDiff {
  source_row: number;
  fingerprint: string;
  status: RowStatus;
  /** only for status late_row */
  lateScope?: LateScope;
  /** the data-problem flags the row will be stored with (new and late rows; blocking ones first), see validate.ts */
  flags: string[];
  /** stored event with the same fingerprint (identical / changed_row) */
  storedEventId?: string;
  changes: FieldChange[];
  /** validation warnings for rows that may be added (new, late_row) */
  warnings: DiffWarning[];
}

export interface Normalisation { source_row: number; field: 'classification'; from: string; to: string }

/** A month older than the latest stored date that has no stored events at all: decided as a whole. */
export interface LateMonth {
  /** YYYY-MM */
  month: string;
  rows: number;
  /** summed duration of the rows, hours */
  hours: number;
}

export interface DiffSummary {
  rowsRead: number;
  identical: number;
  new: number;
  /** all late rows (both scopes) */
  late: number;
  /** late rows of a late month (lateScope 'month') and the number of such months */
  lateMonthRows: number;
  lateMonths: number;
  changed: number;
  missing: number;
  /** warnings by type */
  warningCounts: Partial<Record<WarningType, number>>;
}

export interface UploadDiff {
  rows: RowDiff[];
  /** warnings not tied to one status: late_row, late_month, changed_row, missing_row, edited_in_app, plus every validation warning */
  warnings: DiffWarning[];
  /** uploaded rows with normalised values (classification upper-cased) */
  normalizedRows: DiffUploadRow[];
  normalisations: Normalisation[];
  /** months decided as a whole, oldest first */
  lateMonths: LateMonth[];
  summary: DiffSummary;
}

export interface DiffInput {
  uploaded: DiffUploadRow[];
  /** every stored event, voided included (a voided event re-uploaded is identical, not new) */
  stored: EventRow[];
  index: MasterIndex;
  /** fields edited in the app per stored event_id (from event_edits). Without it, every field of an edited event is treated as edited. */
  editedFields?: Map<string, ReadonlySet<string>>;
  /** tolerance for the duration and overlap checks, seconds (default 1) */
  toleranceS?: number;
}

const norm = (s: string | undefined): string => (s ?? '').trim().replace(/\s+/g, ' ');

function fieldValue(r: Pick<EventRow, DiffField>, f: DiffField): string {
  switch (f) {
    case 'freq': return String(r.freq);
    case 'is_failure': return String(r.is_failure);
    case 'classification': return r.classification.trim().toUpperCase();
    case 'reason_raw': case 'description': return norm(r[f]);
    default: return String(r[f]).trim();
  }
}

/** Differences in the non-key fields between a stored event and the uploaded row. */
export function compareFields(stored: EventRow, uploaded: UploadRow): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of COMPARED_FIELDS) {
    const a = fieldValue(stored, f);
    const b = fieldValue(uploaded as unknown as Pick<EventRow, DiffField>, f);
    if (a !== b) out.push({ field: f, stored: a, uploaded: b });
  }
  return out;
}

function warn(type: WarningType, row: DiffUploadRow, detail: string, severity: Severity = 'warning', eventId?: string): DiffWarning {
  return { type, source_row: row.source_row, event_id: eventId, detail, severity, fingerprint: row.fingerprint };
}

/** Validation of one uploaded row against the masters (no neighbour context). Nothing here refuses a row: it is stored with flags. */
export function validateRow(row: DiffUploadRow, index: MasterIndex, toleranceS = 1): DiffWarning[] {
  const out: DiffWarning[] = [];
  const key = codeKey(row.code_raw);
  const rc = !key ? null : isAreaLevelCode(row.code_raw) ? ({ kind: 'area_level' } as const) : resolveCode(row.code_raw, index);
  const area = findArea(index, row.area_id);
  if (!key) out.push(warn('missing_code', row, 'The equipment code is empty'));
  if (rc && rc.kind !== 'area_level' && !key.includes('.')) out.push(warn('placeholder_code', row, `Code "${row.code_raw}" has no dot, so it looks like a placeholder`));
  if (rc && rc.kind === 'unknown') out.push(warn('unknown_code', row, `Code "${row.code_raw}" is not in the equipment master`));
  else if (rc && rc.kind === 'equipment' && area && areasOf(index, rc.equipmentId).size > 0 && !areasOf(index, rc.equipmentId).has(area.area_id)) {
    // information, not a problem: the cause sits in another area (a normal case). Needs no decision, never blocks.
    const owners = [...areasOf(index, rc.equipmentId)].sort().join(', ');
    out.push(warn('code_not_in_area', row, `Code "${rc.equipmentId}" is listed under ${owners}, not under ${row.area_id}: the cause is in another area`, 'info'));
  }
  if (!area) out.push(warn('unknown_area', row, row.area_id.trim() ? `Area "${row.area_id}" is not in the list of areas` : 'The area (EQUIPMENT column) is empty'));
  else if (row.line_id.trim() !== area.line_id) out.push(warn('line_mismatch', row, `Line "${row.line_id}" in the sheet, but area ${area.area_id} belongs to ${area.line_id}`));
  const cls = normalizeClassification(row.classification);
  if (!row.classification.trim()) out.push(warn('missing_classification', row, 'The classification is empty'));
  else if (!cls) out.push(warn('invalid_classification', row, `Classification "${row.classification}" is not one of PRO, MEC, ELE, AUT, PL, CIR`));
  if (matchKey(row.reason_raw) === '') out.push(warn('blank_reason', row, 'The reason is blank'));
  else if (cls && resolveReason(cls, row.reason_raw, index.reasons).status === 'unlisted') {
    out.push(warn('unlisted_reason', row, `Reason "${norm(row.reason_raw)}" is not listed for ${cls}`));
  }
  const calc = durationSeconds(row.stop_ts, row.start_ts);
  if (calc !== null && calc < 0) out.push(warn('end_before_start', row, `Start ${row.start_ts} is before stop ${row.stop_ts}`));
  if (calc !== null && row.sheet_duration_s !== undefined && Math.abs(calc - row.sheet_duration_s) > toleranceS) {
    out.push(warn('duration_mismatch', row, `Calculated ${calc} s but the sheet says ${row.sheet_duration_s} s`));
  }
  return out;
}

interface SpanRef { fromMs: number; toMs: number; freq: 0 | 1; key: string; row?: DiffUploadRow }

function spanRef(r: { stop_ts: string; start_ts: string; freq: 0 | 1 }, key: string, row?: DiffUploadRow): SpanRef | null {
  const s = rowSpan(r);
  return s ? { fromMs: s.fromMs, toMs: s.toMs, freq: r.freq, key, row } : null;
}

/** Orphan checks need the other rows of the area (file and stored). Returns warnings for rows in `targets`. */
function orphanWarnings(targets: Set<string>, uploaded: DiffUploadRow[], stored: EventRow[], tolMs: number): DiffWarning[] {
  const byArea = new Map<string, SpanRef[]>();
  const push = (area: string, ref: SpanRef | null): void => {
    if (!ref) return;
    const l = byArea.get(area);
    if (l) l.push(ref);
    else byArea.set(area, [ref]);
  };
  const seen = new Set<string>();
  for (const u of uploaded) {
    seen.add(u.fingerprint);
    push(u.area_id, spanRef(u, u.fingerprint, u));
  }
  for (const s of stored) if (!s.is_void && !seen.has(s.fingerprint)) push(s.area_id, spanRef(s, s.fingerprint));
  const out: DiffWarning[] = [];
  for (const list of byArea.values()) {
    list.sort((a, b) => a.fromMs - b.fromMs || b.freq - a.freq);
    let tails: number[] = []; // restart times of earlier rows that a continuation could still attach to
    for (const cur of list) {
      tails = tails.filter((e) => e >= cur.fromMs - tolMs);
      const t = cur.row && targets.has(cur.key) ? cur.row : null;
      if (t && cur.freq === 0 && !tails.some((e) => Math.abs(e - cur.fromMs) <= tolMs)) {
        out.push(warn('orphan_continuation', t, 'Freq = 0 row with no preceding stop: the event may start in a month that was not uploaded'));
      }
      tails.push(cur.toMs);
    }
  }
  return out;
}

/**
 * overlap_in_area for the rows that may be added: one warning per affected row (a pile-up of three rows gives three,
 * not three pairs). Uses findOverlaps over the file's rows and the stored non-void events not in the file; rows with a
 * blocking problem are ignored, as in every calculation.
 */
function overlapWarnings(targets: Set<string>, uploaded: DiffUploadRow[], flagsByFp: Map<string, string[]>, stored: EventRow[], tolS: number): DiffWarning[] {
  const events: EventRow[] = [];
  const seen = new Set<string>();
  for (const u of uploaded) {
    seen.add(u.fingerprint);
    events.push({ event_id: u.fingerprint, area_id: u.area_id, stop_ts: u.stop_ts, start_ts: u.start_ts, flags: (flagsByFp.get(u.fingerprint) ?? []).join(','), is_void: false } as EventRow);
  }
  for (const s of stored) if (!s.is_void && !seen.has(s.fingerprint)) events.push(s);
  const hit = findOverlaps(events, tolS).ids;
  const out: DiffWarning[] = [];
  for (const u of uploaded) {
    if (targets.has(u.fingerprint) && hit.has(u.fingerprint)) out.push(warn('overlap_in_area', u, `Overlaps another stop in area ${u.area_id}`));
  }
  return out;
}

/**
 * Compare an upload with the stored events.
 * - same fingerprint, no differing field: identical;
 * - same fingerprint, differing non-key fields: changed_row (stored value kept). If the stored event was edited in
 *   the app and every difference is an edited field, an `edited_in_app` info warning is given instead and the row
 *   counts as identical;
 * - otherwise new when it is dated after the latest stored date; else a late row. A late row whose month has no
 *   stored (non-void) events at all belongs to a LATE MONTH (lateScope 'month', listed in `lateMonths`, one
 *   `late_month` warning per month); a late row in a month that already has stored events is a per-row late_row
 *   (lateScope 'row');
 * - no row is ever rejected: data problems are returned as `flags` (what will be stored) and as validation warnings;
 * - stored (non-void) rows inside the date range of the file but absent from it: missing_row (info).
 */
export function compareUpload(input: DiffInput): UploadDiff {
  const { uploaded, stored, index } = input;
  const tol = input.toleranceS ?? 1;
  const storedByFp = new Map(stored.map((s) => [s.fingerprint, s]));
  const storedMonths = new Set(stored.filter((s) => !s.is_void).map((s) => s.event_date.slice(0, 7)));
  const latest = stored.reduce((m, s) => (s.event_date > m ? s.event_date : m), '');
  const normalisations: Normalisation[] = [];
  const normalizedRows = uploaded.map((u) => {
    const cls = normalizeClassification(u.classification);
    if (cls && cls !== u.classification) {
      normalisations.push({ source_row: u.source_row, field: 'classification', from: u.classification, to: cls });
      return { ...u, classification: cls };
    }
    return u;
  });
  const warnings: DiffWarning[] = [];
  const rows: RowDiff[] = [];
  const addable = new Set<string>();
  for (const u of normalizedRows) {
    const s = storedByFp.get(u.fingerprint);
    const diff: RowDiff = { source_row: u.source_row, fingerprint: u.fingerprint, status: 'new', flags: [], changes: [], warnings: [] };
    if (s) {
      diff.storedEventId = s.event_id;
      diff.changes = compareFields(s, u);
      diff.status = 'identical';
      if (diff.changes.length > 0) {
        const edited = input.editedFields?.get(s.event_id);
        const onlyEdited = s.edited && diff.changes.every((c) => edited === undefined || edited.has(c.field));
        if (onlyEdited) {
          warnings.push(warn('edited_in_app', u, `Stored event was edited in the app (${diff.changes.map((c) => c.field).join(', ')}); stored values kept`, 'info', s.event_id));
        } else {
          diff.status = 'changed_row';
          const detail = diff.changes.map((c) => `${c.field}: stored "${c.stored}", file "${c.uploaded}"`).join('; ');
          warnings.push(warn('changed_row', u, `Row differs from the stored event. ${detail}`, 'warning', s.event_id));
        }
      }
    } else {
      const late = latest !== '' && u.event_date <= latest;
      diff.status = late ? 'late_row' : 'new';
      addable.add(u.fingerprint);
      if (late) {
        diff.lateScope = storedMonths.has(u.event_date.slice(0, 7)) ? 'row' : 'month';
        if (diff.lateScope === 'row') warnings.push(warn('late_row', u, `Row dated ${u.event_date} is new but its month already has stored rows (latest stored date ${latest})`));
      }
      diff.flags = computeEventFlags(u, index);
    }
    rows.push(diff);
  }
  const byFp = new Map<string, RowDiff>();
  rows.forEach((d, i) => {
    byFp.set(d.fingerprint, d);
    if (addable.has(d.fingerprint)) d.warnings = validateRow(normalizedRows[i]!, index, tol);
  });
  const flagsByFp = new Map(rows.map((d) => [d.fingerprint, d.flags]));
  for (const w of orphanWarnings(addable, normalizedRows, stored, tol * MS_SECOND)) byFp.get(w.fingerprint ?? '')?.warnings.push(w);
  for (const w of overlapWarnings(addable, normalizedRows, flagsByFp, stored, tol)) byFp.get(w.fingerprint ?? '')?.warnings.push(w);
  const lateMonths = lateMonthsOf(rows, normalizedRows);
  for (const m of lateMonths) {
    warnings.push({ type: 'late_month', detail: `Month ${m.month}: ${m.rows} rows, ${Math.round(m.hours * 10) / 10} h, no stored events yet (latest stored date ${latest})`, severity: 'warning', month: m.month });
  }
  for (const d of rows) warnings.push(...d.warnings);
  const missing = missingRows(normalizedRows, stored);
  warnings.push(...missing);
  return { rows, warnings, normalizedRows, normalisations, lateMonths, summary: summarise(rows, lateMonths, missing.length, warnings) };
}

function lateMonthsOf(rows: RowDiff[], uploaded: DiffUploadRow[]): LateMonth[] {
  const by = new Map<string, LateMonth>();
  rows.forEach((d, i) => {
    if (d.lateScope !== 'month') return;
    const u = uploaded[i]!;
    const month = u.event_date.slice(0, 7);
    const m = by.get(month) ?? { month, rows: 0, hours: 0 };
    m.rows++;
    m.hours += rowSeconds(u) / 3600;
    by.set(month, m);
  });
  return [...by.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

function missingRows(uploaded: DiffUploadRow[], stored: EventRow[]): DiffWarning[] {
  if (uploaded.length === 0) return [];
  let lo = uploaded[0]!.event_date;
  let hi = lo;
  const fps = new Set<string>();
  for (const u of uploaded) {
    fps.add(u.fingerprint);
    if (u.event_date < lo) lo = u.event_date;
    if (u.event_date > hi) hi = u.event_date;
  }
  return stored
    .filter((s) => !s.is_void && s.event_date >= lo && s.event_date <= hi && !fps.has(s.fingerprint))
    .map((s) => ({
      type: 'missing_row' as const, source_row: s.source_row, event_id: s.event_id, severity: 'info' as const,
      detail: `Stored event ${s.event_id} (${s.area_id} ${s.code_raw}, ${s.stop_ts}) is not in the file`,
    }));
}

function summarise(rows: RowDiff[], lateMonths: LateMonth[], missing: number, warnings: DiffWarning[]): DiffSummary {
  const count = (s: RowStatus): number => rows.filter((r) => r.status === s).length;
  const warningCounts: Partial<Record<WarningType, number>> = {};
  for (const w of warnings) warningCounts[w.type] = (warningCounts[w.type] ?? 0) + 1;
  return { rowsRead: rows.length, identical: count('identical'), new: count('new'), late: count('late_row'), lateMonthRows: lateMonths.reduce((n, m) => n + m.rows, 0), lateMonths: lateMonths.length, changed: count('changed_row'), missing, warningCounts };
}
