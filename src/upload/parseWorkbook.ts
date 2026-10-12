// Reads the 'Downtime' sheet of the monthly workbook in the browser.
//
// - The sheet's formula columns (DATE, Freq, Status, CRITICALITY, Failure,
//   durations) are read as their CACHED values (a formula cell is read as its
//   stored result, never as formula text). Empty cached values reject the file.
// - The file is read by our own small reader (xlsxReader.ts), which returns the
//   cached value of every formula cell, including 0 and empty text.
// - Excel date-times have no time zone. A serial number is converted as if it were
//   UTC and ROUNDED to the nearest millisecond (a floor would put about a quarter of
//   the real stamps 1 ms low, and a re-save in Excel can change the last bits of the
//   serial). Every part is read with the getUTC* accessors, so the numbers come out
//   exactly as typed in Excel, whatever the browser's time zone or daylight saving.
// - In a workbook that uses the 1904 date system, 1462 days are added to the serial
//   of the DATE, Stop Time and Start Time columns only.
// - Row numbers are sheet row numbers (row 1 = first row of the sheet).
import { assignOccurrences, codeKey, fingerprint, normalizeClassification, type DiffUploadRow } from '../calc';
import type { Criticality } from '../api/types';
import { t } from '../i18n/t';
import { sha256Hex } from '../util/sha256';
import { readXlsxSheet } from './xlsxReader';

export const SHEET_NAME = 'Downtime';
/** Largest workbook the browser will read (a monthly file is a few hundred KB). */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

export type ProblemCode =
  | 'unreadable' | 'too_big' | 'no_sheet' | 'no_headings' | 'missing_columns'
  | 'empty_cached' | 'bad_time' | 'bad_date' | 'no_rows';

/** Why the whole file is refused. Messages are plain English for the person uploading. */
export interface FileProblem { code: ProblemCode; message: string; rows?: number[] }

export interface RowReject { source_row: number; reason: string }
export interface CaseFix { source_row: number; from: string; to: string }

export interface ParsedFile {
  ok: true;
  /** rows that can be compared and uploaded (rows with a row-level reject are not here) */
  rows: DiffUploadRow[];
  /** rows with data that cannot be uploaded (listed in the review, never sent) */
  rejected: RowReject[];
  caseFixes: CaseFix[];
  /** rows with data (kept + rejected) */
  rowsRead: number;
  /** rows without any data (formulas only), skipped silently */
  blankRows: number;
  dateFrom: string;
  dateTo: string;
}
export interface RefusedFile { ok: false; message: string; problems: FileProblem[] }
export type ParseResult = ParsedFile | RefusedFile;

// ---------------------------------------------------------------- headings
type Key =
  | 'date' | 'freq' | 'line' | 'area' | 'code' | 'stop' | 'start' | 'total' | 'classification'
  | 'criticality' | 'reason' | 'failure' | 'description';

const HEADINGS: Record<Key, { names: string[]; required: boolean; label: string }> = {
  date: { names: ['date'], required: true, label: 'DATE' },
  freq: { names: ['freq'], required: true, label: 'Freq' },
  line: { names: ['line'], required: true, label: 'Line' },
  area: { names: ['equipment'], required: true, label: 'EQUIPMENT' },
  code: { names: ['equipment code'], required: true, label: 'EQUIPMENT CODE' },
  stop: { names: ['stop time'], required: true, label: 'Stop Time' },
  start: { names: ['start time'], required: true, label: 'Start Time' },
  total: { names: ['total stoppage duration (h)'], required: false, label: 'TOTAL STOPPAGE DURATION (h)' },
  // the workbook spells it CLASIFICATION; the correct spelling is accepted too
  classification: { names: ['stoppage clasification', 'stoppage classification'], required: true, label: 'STOPPAGE CLASIFICATION' },
  criticality: { names: ['criticality'], required: true, label: 'CRITICALITY' },
  reason: { names: ['reason'], required: true, label: 'REASON' },
  failure: { names: ['failure'], required: true, label: 'Failure' },
  description: { names: ['description'], required: false, label: 'DESCRIPTION' },
};
const KEYS = Object.keys(HEADINGS) as Key[];

const headingText = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').toLowerCase() : '');

function findHeaderRow(data: unknown[][]): { index: number; cols: Partial<Record<Key, number>> } | null {
  let best: { index: number; cols: Partial<Record<Key, number>>; hits: number } | null = null;
  for (let i = 0; i < Math.min(data.length, 25); i++) {
    const cols: Partial<Record<Key, number>> = {};
    (data[i] ?? []).forEach((cell, c) => {
      const h = headingText(cell);
      if (!h) return;
      for (const k of KEYS) if (cols[k] === undefined && HEADINGS[k].names.includes(h)) cols[k] = c;
    });
    const hits = Object.keys(cols).length;
    if (hits >= 3 && (!best || hits > best.hits)) best = { index: i, cols, hits };
  }
  return best;
}

// ---------------------------------------------------------------- cell values
const isBlank = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const p2 = (n: number, w = 2): string => String(n).padStart(w, '0');

/** Text of a cell, trimmed ('' for empty). Dates read as ISO text. */
function textOf(v: unknown): string {
  if (isBlank(v)) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : dateText(v.getTime());
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v).trim();
}

function dateText(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}
function tsText(ms: number): string {
  const d = new Date(ms);
  return `${dateText(ms)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}.${p2(d.getUTCMilliseconds(), 3)}`;
}

const SERIAL_ORIGIN_MS = Date.UTC(1899, 11, 30);
const MS_DAY = 86_400_000;
const serialToMs = (n: number): number => Math.round(SERIAL_ORIGIN_MS + n * MS_DAY);
/** Days between the 1900 and the 1904 date systems. */
const DAYS_1904 = 1462;
const plausibleSerial = (n: number): boolean => Number.isFinite(n) && n >= 20_000 && n < 100_000;

const TS_TEXT = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?)?$/;
function parseTextTs(s: string, needTime: boolean): number | null {
  const m = TS_TEXT.exec(s.trim());
  if (!m || (needTime && m[4] === undefined)) return null;
  const [y, mo, d, h, mi, se, ms] = [+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), m[7] ? +m[7].padEnd(3, '0') : 0];
  const at = Date.UTC(y, mo - 1, d, h, mi, se, ms);
  const back = new Date(at);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59 || se > 59) return null;
  return at;
}

/** 'YYYY-MM-DD HH:MM:SS.mmm' from an Excel date-time, or null when it cannot be read. */
export function readTimestamp(v: unknown, date1904 = false): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : tsText(v.getTime());
  if (typeof v === 'number') {
    const n = date1904 ? v + DAYS_1904 : v;
    return plausibleSerial(n) ? tsText(serialToMs(n)) : null;
  }
  if (typeof v === 'string') {
    const at = parseTextTs(v, true);
    return at === null ? null : tsText(at);
  }
  return null;
}

/** 'YYYY-MM-DD' from an Excel date (or date-time), or null when it cannot be read. */
export function readDate(v: unknown, date1904 = false): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : dateText(v.getTime());
  if (typeof v === 'number') {
    const n = date1904 ? v + DAYS_1904 : v;
    return plausibleSerial(n) ? dateText(serialToMs(Math.floor(n))) : null;
  }
  if (typeof v === 'string') {
    const at = parseTextTs(v, false);
    return at === null ? null : dateText(at);
  }
  return null;
}

function readNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// ---------------------------------------------------------------- rows
const first = <T,>(list: T[], n: number): T[] => list.slice(0, n);

export function describeRows(rows: number[], max = 6): string {
  const shown = first(rows, max).join(', ');
  return rows.length > max ? t('{shown} and {n} more', { shown, n: rows.length - max }) : shown;
}

interface RawRow {
  source_row: number;
  event_date: string; line_id: string; area_id: string; code_raw: string; stop_ts: string; start_ts: string;
  freq: 0 | 1; classification: string; criticality: Criticality; is_failure: boolean;
  reason_raw?: string; description?: string; sheet_duration_s?: number;
}

export interface Extracted {
  rows: RawRow[];
  rejected: RowReject[];
  caseFixes: CaseFix[];
  rowsRead: number;
  blankRows: number;
  problems: FileProblem[];
}

/** Everything except the fingerprints: works on the sheet as an array of rows (tested without a file). */
export function extractRows(data: unknown[][], date1904 = false): Extracted {
  const out: Extracted = { rows: [], rejected: [], caseFixes: [], rowsRead: 0, blankRows: 0, problems: [] };
  const head = findHeaderRow(data);
  if (!head) {
    out.problems.push({ code: 'no_headings', message: t('The "Downtime" sheet does not have the expected column headings (DATE, Freq, Line, EQUIPMENT, EQUIPMENT CODE, Stop Time, Start Time and so on). Check that you chose the monthly downtime workbook.') });
    return out;
  }
  const missing = KEYS.filter((k) => HEADINGS[k].required && head.cols[k] === undefined).map((k) => HEADINGS[k].label);
  if (missing.length) {
    out.problems.push({
      code: 'missing_columns',
      message: t('The "Downtime" sheet is missing these columns: {list}. The headings are read from row {row}. Check that you chose the right workbook and that nobody renamed a heading.', { list: missing.join(', '), row: head.index + 1 }),
    });
    return out;
  }
  const c = head.cols as Record<Key, number | undefined>;
  const cell = (row: unknown[], k: Key): unknown => (c[k] === undefined ? undefined : row[c[k] as number]);

  const emptyCached: number[] = [];
  const badTime: { row: number; what: string }[] = [];
  const badDate: number[] = [];
  const emptyCols = new Set<string>();

  for (let i = head.index + 1; i < data.length; i++) {
    const row = data[i] ?? [];
    const n = i + 1;
    const key = (['date', 'area', 'stop', 'start'] as Key[]);
    if (key.every((k) => isBlank(cell(row, k)))) {
      out.blankRows++;
      continue;
    }
    out.rowsRead++;

    // the formula columns must have values
    let cachedMissing = false;
    for (const k of ['freq', 'criticality', 'failure'] as Key[]) {
      if (isBlank(cell(row, k))) {
        cachedMissing = true;
        emptyCols.add(HEADINGS[k].label);
      }
    }
    if (cachedMissing) emptyCached.push(n);

    const eventDate = readDate(cell(row, 'date'), date1904);
    if (eventDate === null) badDate.push(n);
    const stop = readTimestamp(cell(row, 'stop'), date1904);
    const start = readTimestamp(cell(row, 'start'), date1904);
    if (stop === null) badTime.push({ row: n, what: t('Stop Time') });
    if (start === null) badTime.push({ row: n, what: t('Start Time') });
    if (cachedMissing || eventDate === null || stop === null || start === null) continue;

    // row-level problems: this row is left out, the rest can still be uploaded
    const reject = (reason: string) => out.rejected.push({ source_row: n, reason });
    const area = textOf(cell(row, 'area'));
    const code = textOf(cell(row, 'code'));
    const line = textOf(cell(row, 'line'));
    if (!area) { reject(t('No equipment (area) is written on this row.')); continue; }
    if (!line) { reject(t('No line is written on this row.')); continue; }
    if (!code) { reject(t('No equipment code. Write N/A when the whole area stopped.')); continue; }
    const freqN = readNumber(cell(row, 'freq')) ?? (cell(row, 'freq') === true ? 1 : cell(row, 'freq') === false ? 0 : null);
    if (freqN !== 0 && freqN !== 1) { reject(t('Freq must be 0 or 1, but this row has "{v}".', { v: textOf(cell(row, 'freq')) })); continue; }
    const critText = textOf(cell(row, 'criticality')).toUpperCase().replace(/[\s-]+/g, '_');
    if (critText !== 'INC' && critText !== 'NO_INC') { reject(t('CRITICALITY must be INC or NO_INC, but this row has "{v}".', { v: textOf(cell(row, 'criticality')) })); continue; }
    const failText = textOf(cell(row, 'failure')).toUpperCase();
    const failure = ['YES', 'TRUE', '1', 'Y'].includes(failText) ? true : ['NO', 'FALSE', '0', 'N'].includes(failText) ? false : null;
    if (failure === null) { reject(t('Failure must be YES or NO, but this row has "{v}".', { v: textOf(cell(row, 'failure')) })); continue; }
    const classRaw = textOf(cell(row, 'classification'));
    const classification = normalizeClassification(classRaw);
    if (!classification) { reject(t('The classification must be PRO, MEC, ELE, AUT, PL or CIR, but this row has "{v}".', { v: classRaw })); continue; }
    if (classRaw !== classification) out.caseFixes.push({ source_row: n, from: classRaw, to: classification });

    const totalH = readNumber(cell(row, 'total'));
    out.rows.push({
      source_row: n, event_date: eventDate, line_id: line, area_id: area, code_raw: code, stop_ts: stop, start_ts: start,
      freq: freqN, classification, criticality: critText, is_failure: failure,
      reason_raw: textOf(cell(row, 'reason')) || undefined,
      description: textOf(cell(row, 'description')) || undefined,
      sheet_duration_s: totalH === null ? undefined : Math.round(totalH * 3600 * 1000) / 1000,
    });
  }

  if (emptyCached.length) {
    out.problems.push({
      code: 'empty_cached',
      rows: emptyCached,
      message: t('The columns {cols} have no values in row {rows}. They are filled in by formulas, and this file was saved without the results. Open the file in Excel, save it (Ctrl+S), then choose it again, so the formulas have values.', { cols: [...emptyCols].join(', '), rows: describeRows(emptyCached) }),
    });
  }
  if (badTime.length) {
    const rows = [...new Set(badTime.map((b) => b.row))];
    out.problems.push({
      code: 'bad_time',
      rows,
      message: t('The stop or restart time cannot be read in row {rows}. These cells must hold a real date and time, for example 2026-03-15 13:45:00.', { rows: describeRows(rows) }),
    });
  }
  if (badDate.length) {
    out.problems.push({
      code: 'bad_date',
      rows: badDate,
      message: t('The date cannot be read in row {rows}. The DATE cell must hold a real date.', { rows: describeRows(badDate) }),
    });
  }
  if (out.rowsRead === 0 && out.problems.length === 0) {
    out.problems.push({ code: 'no_rows', message: t('The "Downtime" sheet has no stoppage rows under the headings.') });
  }
  return out;
}

// ---------------------------------------------------------------- the file
export type FileInput = File | Blob | ArrayBuffer | Uint8Array;

function refuse(problems: FileProblem[]): RefusedFile {
  return { ok: false, message: problems[0]?.message ?? t('This file cannot be used.'), problems };
}

const sizeOf = (f: FileInput): number => (f instanceof ArrayBuffer ? f.byteLength : f instanceof Uint8Array ? f.byteLength : f.size);

async function readDowntimeSheet(file: FileInput): Promise<{ data: unknown[][]; date1904: boolean } | { problem: FileProblem }> {
  const res = await readXlsxSheet(file, SHEET_NAME);
  if (res.ok) return { data: res.data, date1904: res.date1904 };
  if (res.reason === 'no_sheet') {
    return {
      problem: {
        code: 'no_sheet',
        message: t('This workbook has no sheet called "{name}". The sheets in it are: {list}. Choose the monthly downtime workbook.', { name: SHEET_NAME, list: res.sheets.join(', ') || t('(none)') }),
      },
    };
  }
  return {
    problem: {
      code: 'unreadable',
      message: t('This file cannot be read as an Excel workbook (.xlsx). Save it from Excel as "Excel Workbook (*.xlsx)" and choose it again.'),
    },
  };
}

/** Reads the workbook, checks it and adds the row fingerprints. Never throws for a bad file: it returns the reasons. */
export async function parseWorkbook(file: FileInput): Promise<ParseResult> {
  if (sizeOf(file) > MAX_FILE_BYTES) {
    return refuse([{ code: 'too_big', message: t('This file is larger than {mb} MB, which is far more than a monthly workbook. Check that you chose the right file.', { mb: MAX_FILE_BYTES / 1024 / 1024 }) }]);
  }
  const sheet = await readDowntimeSheet(file);
  if ('problem' in sheet) return refuse([sheet.problem]);
  const ex = extractRows(sheet.data, sheet.date1904);
  if (ex.problems.length) return refuse(ex.problems);
  return finish(ex);
}

/** The calc fingerprint (WebCrypto). On a plain-http page, where WebCrypto does not exist, the same text goes through the small built-in SHA-256. */
async function printOf(p: { area_id: string; code: string; stop_ts: string; start_ts: string; occurrence: number }): Promise<string> {
  if (globalThis.crypto?.subtle) return fingerprint(p);
  return sha256Hex(`${p.area_id}|${codeKey(p.code)}|${p.stop_ts}|${p.start_ts}|${p.occurrence}`);
}

async function finish(ex: Extracted): Promise<ParsedFile> {
  const occ = assignOccurrences(ex.rows.map((r) => ({ area_id: r.area_id, code_raw: r.code_raw, stop_ts: r.stop_ts, start_ts: r.start_ts })));
  const prints = await Promise.all(
    ex.rows.map((r, i) => printOf({ area_id: r.area_id, code: r.code_raw, stop_ts: r.stop_ts, start_ts: r.start_ts, occurrence: occ[i] as number })),
  );
  const rows: DiffUploadRow[] = ex.rows.map((r, i) => ({ ...r, fingerprint: prints[i] as string }));
  let from = '9999-12-31';
  let to = '0000-01-01';
  for (const r of rows) {
    if (r.event_date < from) from = r.event_date;
    if (r.event_date > to) to = r.event_date;
  }
  return { ok: true, rows, rejected: ex.rejected, caseFixes: ex.caseFixes, rowsRead: ex.rowsRead, blankRows: ex.blankRows, dateFrom: rows.length ? from : '', dateTo: rows.length ? to : '' };
}

/** Test helper: finish a sheet given as arrays. */
export async function parseSheetArrays(data: unknown[][], date1904 = false): Promise<ParseResult> {
  const ex = extractRows(data, date1904);
  return ex.problems.length ? refuse(ex.problems) : finish(ex);
}

/** The first problem as one line (for logs and tests). */
export const firstProblem = (r: RefusedFile): FileProblem | undefined => r.problems[0];
