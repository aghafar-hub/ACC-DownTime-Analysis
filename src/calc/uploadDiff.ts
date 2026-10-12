/**
 * Pure comparison of an uploaded workbook against stored events (docs section 6).
 * Never writes anything; the UI shows the result and the user decides what to add.
 */
import type { EventRow, UploadRow, UploadWarning, WarningType } from '../api/types';
import { rowSpan } from './events';
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
};

/** An uploaded row, optionally with the sheet's own total duration for the duration_mismatch check. */
export type DiffUploadRow = UploadRow & { sheet_duration_s?: number };

export type DiffField = 'freq' | 'classification' | 'criticality' | 'is_failure' | 'reason_raw' | 'description' | 'event_date' | 'line_id';
export const COMPARED_FIELDS: DiffField[] = ['freq', 'classification', 'criticality', 'is_failure', 'reason_raw', 'description', 'event_date', 'line_id'];

export interface FieldChange { field: DiffField; stored: string; uploaded: string }

export interface RowDiff {
  source_row: number;
  fingerprint: string;
  status: RowStatus;
  /** stored event with the same fingerprint (identical / changed_row) */
  storedEventId?: string;
  changes: FieldChange[];
  /** validation warnings for rows that may be added (new, late_row) */
  warnings: DiffWarning[];
}

export interface Normalisation { source_row: number; field: 'classification'; from: string; to: string }

export interface DiffSummary {
  rowsRead: number;
  identical: number;
  new: number;
  late: number;
  changed: number;
  missing: number;
  /** warnings by type */
  warningCounts: Partial<Record<WarningType, number>>;
}

export interface UploadDiff {
  rows: RowDiff[];
  /** warnings not tied to one status: late_row, changed_row, missing_row, edited_in_app, plus every validation warning */
  warnings: DiffWarning[];
  /** uploaded rows with normalised values (classification upper-cased) */
  normalizedRows: DiffUploadRow[];
  normalisations: Normalisation[];
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

/** Validation of one uploaded row against the masters (no neighbour context). */
export function validateRow(row: DiffUploadRow, index: MasterIndex, toleranceS = 1): DiffWarning[] {
  const out: DiffWarning[] = [];
  const rc = isAreaLevelCode(row.code_raw) ? ({ kind: 'area_level' } as const) : resolveCode(row.code_raw, index);
  const key = codeKey(row.code_raw);
  if (rc.kind !== 'area_level' && !key.includes('.')) out.push(warn('placeholder_code', row, `Code "${row.code_raw}" has no dot, so it looks like a placeholder`));
  if (rc.kind === 'unknown') out.push(warn('unknown_code', row, `Code "${row.code_raw}" is not in the equipment master`));
  else if (rc.kind === 'equipment' && !areasOf(index, rc.equipmentId).has(row.area_id)) {
    out.push(warn('code_not_in_area', row, `Code "${rc.equipmentId}" is not in the list of area ${row.area_id}`));
  }
  const cls = normalizeClassification(row.classification);
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

/** Orphan and overlap checks need the other rows of the area (file and stored). Returns warnings for rows in `targets`. */
function contextWarnings(targets: Set<string>, uploaded: DiffUploadRow[], stored: EventRow[], tolMs: number): DiffWarning[] {
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
  const flagged = new Set<string>();
  for (const list of byArea.values()) {
    list.sort((a, b) => a.fromMs - b.fromMs || b.freq - a.freq);
    let reach: SpanRef | null = null; // the span with the latest restart so far
    let tails: number[] = []; // restart times of earlier rows that a continuation could still attach to
    for (const cur of list) {
      tails = tails.filter((e) => e >= cur.fromMs - tolMs);
      const t = cur.row && targets.has(cur.key) ? cur.row : null;
      if (t && cur.freq === 0 && !tails.some((e) => Math.abs(e - cur.fromMs) <= tolMs)) {
        out.push(warn('orphan_continuation', t, 'Freq = 0 row with no preceding stop: the event may start in a month that was not uploaded'));
      }
      if (reach && cur.toMs > cur.fromMs && reach.toMs > reach.fromMs && reach.toMs - cur.fromMs > tolMs) {
        for (const x of [cur, reach]) {
          if (x.row && targets.has(x.key) && !flagged.has(x.key)) {
            flagged.add(x.key);
            out.push(warn('overlap_in_area', x.row, `Overlaps another stop in area ${x.row.area_id}`));
          }
        }
      }
      tails.push(cur.toMs);
      if (!reach || cur.toMs > reach.toMs) reach = cur;
    }
  }
  return out;
}

/**
 * Compare an upload with the stored events.
 * - same fingerprint, no differing field: identical;
 * - same fingerprint, differing non-key fields: changed_row (stored value kept). If the stored event was edited in
 *   the app and every difference is an edited field, an `edited_in_app` info warning is given instead and the row
 *   counts as identical;
 * - otherwise new, or late_row when its date already has stored rows or is earlier than the latest stored date;
 * - stored (non-void) rows inside the date range of the file but absent from it: missing_row (info).
 */
export function compareUpload(input: DiffInput): UploadDiff {
  const { uploaded, stored, index } = input;
  const tol = input.toleranceS ?? 1;
  const storedByFp = new Map(stored.map((s) => [s.fingerprint, s]));
  const storedDates = new Set(stored.map((s) => s.event_date));
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
    const diff: RowDiff = { source_row: u.source_row, fingerprint: u.fingerprint, status: 'new', changes: [], warnings: [] };
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
      const late = latest !== '' && (storedDates.has(u.event_date) || u.event_date <= latest);
      diff.status = late ? 'late_row' : 'new';
      addable.add(u.fingerprint);
      if (late) warnings.push(warn('late_row', u, `Row dated ${u.event_date} is new but that date is already stored (latest stored date ${latest})`));
    }
    rows.push(diff);
  }
  const byFp = new Map<string, RowDiff>();
  rows.forEach((d, i) => {
    byFp.set(d.fingerprint, d);
    if (addable.has(d.fingerprint)) d.warnings = validateRow(normalizedRows[i]!, index, tol);
  });
  for (const w of contextWarnings(addable, normalizedRows, stored, tol * MS_SECOND)) byFp.get(w.fingerprint ?? '')?.warnings.push(w);
  for (const d of rows) warnings.push(...d.warnings);
  const missing = missingRows(normalizedRows, stored);
  warnings.push(...missing);
  return { rows, warnings, normalizedRows, normalisations, summary: summarise(rows, missing.length, warnings) };
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

function summarise(rows: RowDiff[], missing: number, warnings: DiffWarning[]): DiffSummary {
  const count = (s: RowStatus): number => rows.filter((r) => r.status === s).length;
  const warningCounts: Partial<Record<WarningType, number>> = {};
  for (const w of warnings) warningCounts[w.type] = (warningCounts[w.type] ?? 0) + 1;
  return { rowsRead: rows.length, identical: count('identical'), new: count('new'), late: count('late_row'), changed: count('changed_row'), missing, warningCounts };
}
