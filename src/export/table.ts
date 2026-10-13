// The shape every export is first turned into: one table (columns with a format, rows, an optional total row and notes).
// From it come an Excel sheet and a CSV file, so both always carry the same numbers. Pure.
import { toCsv, type CsvCell } from './csv';
import type { XCell, XSheet } from './xlsx';

/** 'pct' values are percentage points (25.3 means 25.3 %): Excel gets the fraction with a 0.0 % format, CSV the number with "(%)" in the header. */
export type ColFormat = 'text' | 'int' | 'h1' | 'h2' | 'num' | 'pct' | 'date' | 'datetime';
export interface ExportColumn { header: string; format: ColFormat }
export type ExportValue = string | number | null;

export interface ExportTable {
  /** short stable id (used in the CSV file name) */
  id: string;
  /** wanted sheet name (made valid and unique when the workbook is built) */
  sheet: string;
  columns: ExportColumn[];
  rows: ExportValue[][];
  /** shown under the rows in Excel (bold); left out of CSV so a sum over the file is not doubled */
  total?: ExportValue[];
  /** sentences under the table in Excel only */
  notes?: string[];
}

export const exportCol = (header: string, format: ColFormat = 'text'): ExportColumn => ({ header, format });

const cellOf = (v: ExportValue, f: ColFormat, bold = false): XCell => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') return bold ? { v, bold: true } : v;
  if (!Number.isFinite(v)) return null;
  switch (f) {
    case 'pct': return { v: v / 100, fmt: 'pct', bold };
    case 'int': case 'h1': case 'h2': return { v, fmt: f, bold };
    default: return bold ? { v, bold: true } : v;
  }
};

/** An Excel sheet: header row 1 (frozen, filtered), the rows, then the total in bold, then the notes after a blank row. */
export function tableToSheet(t: ExportTable): XSheet {
  const rows: XCell[][] = [t.columns.map((c) => c.header)];
  for (const r of t.rows) {
    rows.push(r.map((v, i) => {
      const f = t.columns[i]?.format ?? 'text';
      if ((f === 'date' || f === 'datetime') && typeof v === 'string') return v === '' ? null : { v, fmt: f };
      return cellOf(v, f);
    }));
  }
  if (t.total) rows.push(t.total.map((v, i) => cellOf(v, t.columns[i]?.format ?? 'text', true)));
  if (t.notes?.length) {
    rows.push([]);
    for (const n of t.notes) if (n) rows.push([n]);
  }
  return { name: t.sheet, rows, headerRow: 0, filterRows: t.rows.length, measureRows: 1 + t.rows.length + (t.total ? 1 : 0) };
}

/** CSV rows (header first) of the table's data rows. */
export function tableCsvRows(t: ExportTable): CsvCell[][] {
  const head = t.columns.map((c) => (c.format === 'pct' ? `${c.header} (%)` : c.header));
  const body = t.rows.map((r) => r.map((v, i) => {
    const f = t.columns[i]?.format;
    return typeof v === 'string' && f === 'datetime' ? v.replace('T', ' ') : v;
  }));
  return [head, ...body];
}

export const tableToCsv = (t: ExportTable): string => toCsv(tableCsvRows(t));
