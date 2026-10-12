// The logic behind the review screen: late decisions (per month or per row), what will be sent, the records
// that will need checking, the warnings recorded with the upload, and the downloadable list.
// Nothing is dropped: every row of the workbook is stored. Pure functions, no screens, no network.
import type { EventRow, Startup, UploadRow, UploadWarning, WarningResolution, WarningType } from '../api/types';
import {
  BLOCKING_FLAGS, buildIndex, compareUpload, eventIdFromFingerprint, FLAG_INFO, isBlockingFlag, isInfoFlag, WARNING_FLAGS,
  type DiffUploadRow, type DiffWarning, type FieldChange, type LateMonth, type UploadDiff,
} from '../calc';
import { t } from '../i18n/t';
import type { ParsedFile } from './parseWorkbook';
import { CHECK_TYPES, fieldName, INFO_CHECK_TYPES, resolutionLabel, warningLabel } from './warningText';

export type Decision = 'add' | 'skip';
/** Late choices: by row fingerprint for a late row, by `month:YYYY-MM` (see monthKey) for a late month. No entry = undecided. */
export type Decisions = Record<string, Decision>;
export const monthKey = (month: string): string => `month:${month}`;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2026-06' -> 'June 2026' */
export function monthLabel(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTH_NAMES[m - 1] ? `${t(MONTH_NAMES[m - 1] as string)} ${month.slice(0, 4)}` : month;
}

export interface LateRow { fingerprint: string; row: DiffUploadRow; warnings: DiffWarning[] }
export interface ChangedRow { source_row: number; fingerprint: string; storedEventId?: string; changes: FieldChange[] }

export interface Counts {
  rowsRead: number;
  identical: number;
  new: number;
  /** late rows decided one by one (their month already has stored events) */
  late: number;
  /** late months (no stored events in the month) and the rows in them */
  lateMonths: number;
  lateMonthRows: number;
  changed: number;
  missing: number;
  edited: number;
}

export interface Review {
  parsed: ParsedFile;
  diff: UploadDiff;
  rowByFingerprint: Map<string, DiffUploadRow>;
  /** late rows with a per-row decision */
  late: LateRow[];
  /** months with a per-month decision */
  lateMonths: LateMonth[];
  changed: ChangedRow[];
  missing: DiffWarning[];
  edited: DiffWarning[];
  counts: Counts;
}

export function buildReview(parsed: ParsedFile, startup: Startup, stored: EventRow[], editedFields?: Map<string, ReadonlySet<string>>): Review {
  const diff = compareUpload({ uploaded: parsed.rows, stored, index: buildIndex(startup), editedFields });
  const rowByFingerprint = new Map(diff.normalizedRows.map((r) => [r.fingerprint, r]));
  const late: LateRow[] = diff.rows
    .filter((d) => d.status === 'late_row' && d.lateScope !== 'month')
    .map((d) => ({ fingerprint: d.fingerprint, row: rowByFingerprint.get(d.fingerprint) as DiffUploadRow, warnings: d.warnings }));
  const changed: ChangedRow[] = diff.rows
    .filter((d) => d.status === 'changed_row')
    .map((d) => ({ source_row: d.source_row, fingerprint: d.fingerprint, storedEventId: d.storedEventId, changes: d.changes }));
  const missing = diff.warnings.filter((w) => w.type === 'missing_row');
  const edited = diff.warnings.filter((w) => w.type === 'edited_in_app');
  const s = diff.summary;
  return {
    parsed, diff, rowByFingerprint, late, lateMonths: diff.lateMonths, changed, missing, edited,
    counts: {
      rowsRead: parsed.rowsRead, identical: s.identical, new: s.new, late: late.length, lateMonths: s.lateMonths, lateMonthRows: s.lateMonthRows,
      changed: s.changed, missing: s.missing, edited: edited.length,
    },
  };
}

// ---------------------------------------------------------------- decisions
export function decideAll(review: Review, d: Decision): Decisions {
  const out: Decisions = {};
  for (const l of review.late) out[l.fingerprint] = d;
  for (const m of review.lateMonths) out[monthKey(m.month)] = d;
  return out;
}
export const undecidedCount = (review: Review, decisions: Decisions): number =>
  review.late.filter((l) => !decisions[l.fingerprint]).length + review.lateMonths.filter((m) => !decisions[monthKey(m.month)]).length;
export const decisionsComplete = (review: Review, decisions: Decisions): boolean => undecidedCount(review, decisions) === 0;

/** Has the person chosen to skip this row (alone or with its month)? Undecided late rows are not skipped yet. */
export function isSkipped(review: Review, decisions: Decisions, fingerprint: string): boolean {
  const d = review.diff.rows.find((x) => x.fingerprint === fingerprint);
  return !!d && d.status === 'late_row' && lateDecision(review, decisions, d) === 'skip';
}

function lateDecision(review: Review, decisions: Decisions, d: UploadDiff['rows'][number]): Decision | undefined {
  if (d.lateScope === 'month') {
    const r = review.rowByFingerprint.get(d.fingerprint);
    return r ? decisions[monthKey(r.event_date.slice(0, 7))] : undefined;
  }
  return decisions[d.fingerprint];
}

function rowAdded(review: Review, decisions: Decisions, d: UploadDiff['rows'][number]): boolean {
  if (d.status === 'new') return true;
  if (d.status !== 'late_row') return false;
  return lateDecision(review, decisions, d) === 'add';
}

// ---------------------------------------------------------------- records that will need checking
export interface FlagCount { flag: string; count: number; blocking: boolean; rows: number[] }
export interface FlagSummary {
  /** blocking flags first, in the catalogue order; only flags that occur */
  flags: FlagCount[];
  /** rows with at least one blocking flag: stored, but left out of the numbers until fixed */
  blockedRows: number;
  /** rows with warnings only (including overlaps) */
  warningRows: number;
  /** rows with any problem */
  total: number;
}

const FLAG_ORDER: string[] = [...BLOCKING_FLAGS, ...WARNING_FLAGS, 'overlap_in_area'];

/** Counts, per flag, of the rows that will be stored with a problem. Information flags (cause in another area) are not problems and are left out.  Late rows the person chose to skip are not counted; undecided ones are, as they will be unless skipped. */
export function flagSummary(review: Review, decisions: Decisions): FlagSummary {
  const overlap = new Set(review.diff.warnings.filter((w) => w.type === 'overlap_in_area' && w.fingerprint).map((w) => w.fingerprint as string));
  const by = new Map<string, FlagCount>();
  let blockedRows = 0;
  let warningRows = 0;
  for (const d of review.diff.rows) {
    if (d.status === 'identical' || d.status === 'changed_row' || (d.status === 'late_row' && lateDecision(review, decisions, d) === 'skip')) continue;
    const flags = [...d.flags.filter((f) => !isInfoFlag(f)), ...(overlap.has(d.fingerprint) ? ['overlap_in_area'] : [])];
    if (!flags.length) continue;
    if (flags.some(isBlockingFlag)) blockedRows++;
    else warningRows++;
    for (const f of flags) {
      const c = by.get(f) ?? { flag: f, count: 0, blocking: isBlockingFlag(f), rows: [] };
      c.count++;
      c.rows.push(d.source_row);
      by.set(f, c);
    }
  }
  const flags = FLAG_ORDER.filter((f) => by.has(f)).map((f) => by.get(f) as FlagCount);
  return { flags, blockedRows, warningRows, total: blockedRows + warningRows };
}

export const flagTitle = (flag: string): string => t((FLAG_INFO as Record<string, { label: string } | undefined>)[flag]?.label ?? flag);
export const flagProblem = (flag: string): string => t((FLAG_INFO as Record<string, { problem: string } | undefined>)[flag]?.problem ?? '');

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
  /** the records that will be stored with a problem */
  flagged: FlagSummary;
}

const toUploadRow = (r: DiffUploadRow): UploadRow => {
  const { sheet_duration_s: _ignored, ...row } = r;
  void _ignored;
  return row;
};

const clean = (w: DiffWarning, resolution: WarningResolution | undefined, eventId?: string): FinishWarning => ({
  type: w.type, source_row: w.source_row, event_id: eventId ?? w.event_id, detail: w.detail, resolution,
});

/** Throws if a late entry has no decision: the Upload button is not enabled until all are decided. */
export function buildPlan(review: Review, decisions: Decisions): Plan {
  if (!decisionsComplete(review, decisions)) throw new Error('Every late entry needs a decision first.');
  const statusOf = new Map(review.diff.rows.map((d) => [d.fingerprint, d]));
  const adds = (fp: string): boolean => {
    const d = statusOf.get(fp);
    return !!d && rowAdded(review, decisions, d);
  };
  const rows: UploadRow[] = [];
  let skippedLate = 0;
  for (const r of review.diff.normalizedRows) {
    const d = statusOf.get(r.fingerprint);
    if (d && d.status === 'late_row' && !rowAdded(review, decisions, d)) { skippedLate++; continue; }
    rows.push(toUploadRow(r));
  }
  const warnings: FinishWarning[] = [];
  for (const m of review.lateMonths) {
    const add = decisions[monthKey(m.month)] === 'add';
    const w = review.diff.warnings.find((x) => x.type === 'late_month' && x.month === m.month);
    if (w) warnings.push(clean(w, add ? 'added' : 'skipped'));
  }
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
  const monthWarnings = warnings.filter((w) => w.type === 'late_month');
  const others = warnings.filter((w) => w.type !== 'late_month').sort((a, b) => (a.source_row ?? 0) - (b.source_row ?? 0));
  return {
    rows,
    willAdd: review.diff.rows.filter((d) => adds(d.fingerprint)).length,
    skippedLate,
    summary: { rows_read: review.counts.rowsRead, rows_skipped: skippedLate },
    warnings: [...monthWarnings, ...others],
    flagged: flagSummary(review, decisions),
  };
}

// ---------------------------------------------------------------- data checks, grouped for the screen
export interface CheckItem { source_row?: number; detail?: string; fingerprint?: string; skipped: boolean }
export interface CheckGroup { type: WarningType; items: CheckItem[] }

/** Data checks on rows that would be added, grouped by type. Rows the person chose to skip are left out. */
export function checkGroups(review: Review, decisions: Decisions, types: WarningType[] = CHECK_TYPES): CheckGroup[] {
  const by = new Map<WarningType, CheckItem[]>();
  for (const w of review.diff.warnings) {
    if (!types.includes(w.type)) continue;
    if (w.fingerprint && (isSkipped(review, decisions, w.fingerprint) || !review.diff.rows.some((r) => r.fingerprint === w.fingerprint && (r.status === 'new' || r.status === 'late_row')))) continue;
    const list = by.get(w.type) ?? [];
    list.push({ source_row: w.source_row, detail: w.detail, fingerprint: w.fingerprint, skipped: false });
    by.set(w.type, list);
  }
  return types.filter((ty) => by.has(ty)).map((ty) => ({ type: ty, items: (by.get(ty) as CheckItem[]).sort((a, b) => (a.source_row ?? 0) - (b.source_row ?? 0)) }));
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
  const kind = (ty: WarningType): string => (ty === 'missing_row' || ty === 'edited_in_app' || INFO_CHECK_TYPES.includes(ty) ? t('Information') : t('Warning'));
  const decisionLabel = (d: Decision | undefined): string => (d === 'add' ? t('Added') : d === 'skip' ? t('Skipped') : t('Not decided yet'));
  for (const w of review.diff.warnings) {
    let what = '';
    if (w.type === 'late_row') what = decisionLabel(w.fingerprint ? decisions[w.fingerprint] : undefined);
    else if (w.type === 'late_month') what = decisionLabel(w.month ? decisions[monthKey(w.month)] : undefined);
    else if (w.type === 'changed_row' || w.type === 'edited_in_app') what = t('Stored values kept');
    else if (w.type === 'missing_row') what = t('Nothing is deleted');
    else if (INFO_CHECK_TYPES.includes(w.type)) what = w.fingerprint && isSkipped(review, decisions, w.fingerprint) ? t('Row not added') : t('Added; nothing to fix');
    else what = w.fingerprint && isSkipped(review, decisions, w.fingerprint) ? t('Row not added') : t('Added and flagged');
    lines.push({ row: w.source_row ?? 0, cells: [String(w.source_row ?? ''), kind(w.type), warningLabel(w.type), w.detail ?? '', what] });
  }
  lines.sort((a, b) => a.row - b.row);
  return csvText([head, ...lines.map((l) => l.cells)]);
}

/** The same download for an upload already made (warnings read back from the server). */
export function storedWarningsCsv(warnings: UploadWarning[]): string {
  const head = [t('Sheet row'), t('Type'), t('What we found'), t('What happened'), t('Event')];
  const rows = [...warnings].sort((a, b) => (a.source_row ?? 0) - (b.source_row ?? 0))
    .map((w) => [w.source_row ?? '', warningLabel(w.type), w.detail ?? '', INFO_CHECK_TYPES.includes(w.type) && w.resolution === 'accepted' ? t('Added; nothing to fix') : resolutionLabel(w.resolution), w.event_id ?? '']);
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
