// The logic behind the review screen: rejects, late-row decisions, what will be
// sent, the warnings recorded with the upload, and the downloadable list.
// Pure functions, no screens, no network.
import type { EventRow, Startup, UploadRow, UploadWarning, WarningResolution, WarningType } from '../api/types';
import {
  buildIndex, compareUpload, eventIdFromFingerprint, type DiffUploadRow, type DiffWarning, type FieldChange, type UploadDiff,
} from '../calc';
import { t } from '../i18n/t';
import type { ParsedFile, RowReject } from './parseWorkbook';
import { CHECK_TYPES, fieldName, resolutionLabel, warningLabel } from './warningText';

export type Decision = 'add' | 'skip';
/** Late-row choices by row fingerprint. A row with no entry is undecided. */
export type Decisions = Record<string, Decision>;

export interface LateRow { fingerprint: string; row: DiffUploadRow; warnings: DiffWarning[] }
export interface ChangedRow { source_row: number; fingerprint: string; storedEventId?: string; changes: FieldChange[] }

export interface Counts {
  rowsRead: number;
  identical: number;
  new: number;
  late: number;
  changed: number;
  missing: number;
  edited: number;
  rejected: number;
}

export interface Review {
  parsed: ParsedFile;
  diff: UploadDiff;
  rejects: RowReject[];
  rowByFingerprint: Map<string, DiffUploadRow>;
  late: LateRow[];
  changed: ChangedRow[];
  missing: DiffWarning[];
  edited: DiffWarning[];
  counts: Counts;
}

/** Row-level refusals the server would also make (it checks again): unknown area, wrong line. */
export function masterRejects(rows: DiffUploadRow[], startup: Pick<Startup, 'areas'>): RowReject[] {
  const area = new Map(startup.areas.map((a) => [a.area_id, a]));
  const out: RowReject[] = [];
  for (const r of rows) {
    const a = area.get(r.area_id);
    if (!a) out.push({ source_row: r.source_row, reason: t('The area "{area}" is not in the master data. Add it in Master Data first.', { area: r.area_id }) });
    else if (a.line_id !== r.line_id) out.push({ source_row: r.source_row, reason: t('Area {area} belongs to line {want}, but this row says line {got}.', { area: r.area_id, want: a.line_id, got: r.line_id }) });
  }
  return out;
}

export function buildReview(parsed: ParsedFile, startup: Startup, stored: EventRow[], editedFields?: Map<string, ReadonlySet<string>>): Review {
  const refused = masterRejects(parsed.rows, startup);
  const refusedRows = new Set(refused.map((r) => r.source_row));
  const comparable = parsed.rows.filter((r) => !refusedRows.has(r.source_row));
  const diff = compareUpload({ uploaded: comparable, stored, index: buildIndex(startup), editedFields });
  const rowByFingerprint = new Map(diff.normalizedRows.map((r) => [r.fingerprint, r]));
  const late: LateRow[] = diff.rows
    .filter((d) => d.status === 'late_row')
    .map((d) => ({ fingerprint: d.fingerprint, row: rowByFingerprint.get(d.fingerprint) as DiffUploadRow, warnings: d.warnings }));
  const changed: ChangedRow[] = diff.rows
    .filter((d) => d.status === 'changed_row')
    .map((d) => ({ source_row: d.source_row, fingerprint: d.fingerprint, storedEventId: d.storedEventId, changes: d.changes }));
  const missing = diff.warnings.filter((w) => w.type === 'missing_row');
  const edited = diff.warnings.filter((w) => w.type === 'edited_in_app');
  const rejects = [...parsed.rejected, ...refused].sort((a, b) => a.source_row - b.source_row);
  const s = diff.summary;
  return {
    parsed, diff, rejects, rowByFingerprint, late, changed, missing, edited,
    counts: { rowsRead: parsed.rowsRead, identical: s.identical, new: s.new, late: s.late, changed: s.changed, missing: s.missing, edited: edited.length, rejected: rejects.length },
  };
}

// ---------------------------------------------------------------- decisions
export function decideAll(review: Review, d: Decision): Decisions {
  const out: Decisions = {};
  for (const l of review.late) out[l.fingerprint] = d;
  return out;
}
export const undecidedCount = (review: Review, decisions: Decisions): number => review.late.filter((l) => !decisions[l.fingerprint]).length;
export const decisionsComplete = (review: Review, decisions: Decisions): boolean => undecidedCount(review, decisions) === 0;

// ---------------------------------------------------------------- the plan
export type FinishWarning = Omit<UploadWarning, 'warning_id' | 'batch_id'>;

export interface Plan {
  /** rows to send: new rows, late rows chosen Add, and the identical / changed rows (the server counts them as already stored and never changes them) */
  rows: UploadRow[];
  /** rows that will be inserted, as far as the browser can tell */
  willAdd: number;
  skippedLate: number;
  summary: { rows_read: number; rows_skipped: number };
  warnings: FinishWarning[];
}

const toUploadRow = (r: DiffUploadRow): UploadRow => {
  const { sheet_duration_s: _ignored, ...row } = r;
  void _ignored;
  return row;
};

const clean = (w: DiffWarning, resolution: WarningResolution | undefined, eventId?: string): FinishWarning => ({
  type: w.type, source_row: w.source_row, event_id: eventId ?? w.event_id, detail: w.detail, resolution,
});

/** Throws if a late row has no decision: the Upload button is not enabled until all are decided. */
export function buildPlan(review: Review, decisions: Decisions): Plan {
  if (!decisionsComplete(review, decisions)) throw new Error('Every late entry needs a decision first.');
  const status = new Map(review.diff.rows.map((d) => [d.fingerprint, d.status]));
  const adds = (fp: string): boolean => {
    const s = status.get(fp);
    return s === 'new' || (s === 'late_row' && decisions[fp] === 'add');
  };
  const rows: UploadRow[] = [];
  let skippedLate = 0;
  for (const r of review.diff.normalizedRows) {
    if (status.get(r.fingerprint) === 'late_row' && decisions[r.fingerprint] === 'skip') { skippedLate++; continue; }
    rows.push(toUploadRow(r));
  }
  const warnings: FinishWarning[] = [];
  for (const l of review.late) {
    const add = decisions[l.fingerprint] === 'add';
    const w = review.diff.warnings.find((x) => x.type === 'late_row' && x.fingerprint === l.fingerprint);
    if (w) warnings.push(clean(w, add ? 'added' : 'skipped', add ? eventIdFromFingerprint(l.fingerprint) : undefined));
  }
  for (const w of review.diff.warnings) {
    if (w.type === 'changed_row' || w.type === 'edited_in_app') warnings.push(clean(w, 'kept_stored'));
    else if (w.type === 'missing_row') warnings.push(clean(w, undefined));
    else if (CHECK_TYPES.includes(w.type) && w.fingerprint && adds(w.fingerprint)) warnings.push(clean(w, 'accepted', eventIdFromFingerprint(w.fingerprint)));
  }
  warnings.sort((a, b) => (a.source_row ?? 0) - (b.source_row ?? 0));
  return {
    rows,
    willAdd: review.diff.rows.filter((d) => adds(d.fingerprint)).length,
    skippedLate,
    summary: { rows_read: review.counts.rowsRead, rows_skipped: skippedLate + review.rejects.length },
    warnings,
  };
}

// ---------------------------------------------------------------- data checks, grouped for the screen
export interface CheckItem { source_row?: number; detail?: string; fingerprint?: string; skipped: boolean }
export interface CheckGroup { type: WarningType; items: CheckItem[] }

/** Data checks on rows that would be added, grouped by type. Rows the person chose to skip are left out. */
export function checkGroups(review: Review, decisions: Decisions): CheckGroup[] {
  const status = new Map(review.diff.rows.map((d) => [d.fingerprint, d.status]));
  const by = new Map<WarningType, CheckItem[]>();
  for (const w of review.diff.warnings) {
    if (!CHECK_TYPES.includes(w.type)) continue;
    const skipped = !!w.fingerprint && status.get(w.fingerprint) === 'late_row' && decisions[w.fingerprint] === 'skip';
    if (skipped) continue;
    const list = by.get(w.type) ?? [];
    list.push({ source_row: w.source_row, detail: w.detail, fingerprint: w.fingerprint, skipped });
    by.set(w.type, list);
  }
  return CHECK_TYPES.filter((ty) => by.has(ty)).map((ty) => ({ type: ty, items: (by.get(ty) as CheckItem[]).sort((a, b) => (a.source_row ?? 0) - (b.source_row ?? 0)) }));
}

// ---------------------------------------------------------------- the downloadable list
/** Spreadsheet programs run text that starts with = + - or @: put a quote in front so a cell is only ever text. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvText = (rows: unknown[][]): string => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** The list a person downloads to fix the workbook itself: one line per warning, with the sheet row. */
export function reviewCsv(review: Review, decisions: Decisions): string {
  const head = [t('Sheet row'), t('Kind'), t('Type'), t('What we found'), t('What happens')];
  const lines: { row: number; cells: string[] }[] = [];
  const kind = (ty: WarningType): string => (ty === 'missing_row' || ty === 'edited_in_app' ? t('Information') : t('Warning'));
  const status = new Map(review.diff.rows.map((d) => [d.fingerprint, d.status]));
  for (const w of review.diff.warnings) {
    let what = '';
    if (w.type === 'late_row') {
      const d = w.fingerprint ? decisions[w.fingerprint] : undefined;
      what = d === 'add' ? t('Added') : d === 'skip' ? t('Skipped') : t('Not decided yet');
    } else if (w.type === 'changed_row' || w.type === 'edited_in_app') what = t('Stored values kept');
    else if (w.type === 'missing_row') what = t('Nothing is deleted');
    else {
      const late = w.fingerprint && status.get(w.fingerprint) === 'late_row';
      what = late && decisions[w.fingerprint as string] === 'skip' ? t('Row not added') : t('Added and flagged');
    }
    lines.push({ row: w.source_row ?? 0, cells: [String(w.source_row ?? ''), kind(w.type), warningLabel(w.type), w.detail ?? '', what] });
  }
  for (const r of review.rejects) lines.push({ row: r.source_row, cells: [String(r.source_row), t('Left out'), t('Row cannot be uploaded'), r.reason, t('Row not sent')] });
  lines.sort((a, b) => a.row - b.row);
  return csvText([head, ...lines.map((l) => l.cells)]);
}

/** The same download for an upload already made (warnings read back from the server). */
export function storedWarningsCsv(warnings: UploadWarning[]): string {
  const head = [t('Sheet row'), t('Type'), t('What we found'), t('What happened'), t('Event')];
  const rows = [...warnings].sort((a, b) => (a.source_row ?? 0) - (b.source_row ?? 0))
    .map((w) => [w.source_row ?? '', warningLabel(w.type), w.detail ?? '', resolutionLabel(w.resolution), w.event_id ?? '']);
  return csvText([head, ...rows]);
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob(['\ufeff', text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { fieldName };
