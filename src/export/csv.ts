// CSV writer: UTF-8 with a byte order mark (so Excel opens Arabic and accented text correctly), comma separated,
// fields with a comma, quote, line break or edge space in double quotes (quotes doubled), CRLF line ends.
// Text that a spreadsheet would run as a formula (starts with = + - @ or a tab / return) gets a leading apostrophe,
// so opening the file in Excel never executes anything. Plain numbers such as "-5" are left alone.
export type CsvCell = string | number | boolean | null | undefined;

export const CSV_BOM = '﻿';
export const CSV_MIME = 'text/csv;charset=utf-8';

const NUMBERISH = /^[-+]?\d+([.,]\d+)?$/;

/** The text of one field before quoting. */
export function csvText(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(15)));
  }
  if (/^[=+\-@\t\r]/.test(v) && !NUMBERISH.test(v) && !/^[-+]$/.test(v)) return `'${v}`;
  return v;
}

export function csvField(v: CsvCell): string {
  const s = csvText(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The CSV file text (with the byte order mark), one CRLF after every row. */
export function toCsv(rows: CsvCell[][]): string {
  return CSV_BOM + rows.map((r) => r.map(csvField).join(',') + '\r\n').join('');
}
