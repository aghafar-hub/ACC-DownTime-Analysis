// Builds small synthetic monthly workbooks for tests (never committed as files).
// The columns that hold formulas in the real workbook (DATE, Freq, Status,
// CRITICALITY, Failure and the durations) are written as formulas WITH cached
// results, so the "use the cached value" path is genuinely exercised.
import { buildXlsx, serialOf, type RawCell, type XlsxOptions } from './xlsxWriter';

export interface SheetRowSpec {
  /** 'YYYY-MM-DD'; defaults to the date part of stop */
  date?: string;
  freq?: 0 | 1 | null;
  line: string;
  area: string;
  /** EQUIPMENT CODE */
  code: string;
  /** 'YYYY-MM-DD HH:MM:SS.mmm' typed as-is (no time zone) */
  stop: string;
  start: string;
  classification: string;
  criticality?: 'INC' | 'NO_INC' | null;
  reason?: string;
  failure?: 'YES' | 'NO' | null;
  description?: string;
  /** cached TOTAL STOPPAGE DURATION (h); defaults to start - stop */
  totalHours?: number | null;
}

export const HEADERS = [
  'DATE', 'Freq', 'Line', 'EQUIPMENT', 'EQUIPMENT CODE', 'Stop Time', 'Start Time',
  'STOPPAGE DURATION (day)', 'STOPPAGE DURATION (h)', 'STOPPAGE DURATION (min)', 'STOPPAGE DURATION (sec)',
  'TOTAL STOPPAGE DURATION (h)', 'Status', 'STOPPAGE CLASIFICATION', 'CRITICALITY', 'REASON', 'Failure', 'DESCRIPTION',
];

export interface WorkbookOptions {
  sheetName?: string;
  /** header names to leave out */
  dropHeaders?: string[];
  /** rename headers, e.g. {'Freq': ' freq '} */
  renameHeaders?: Record<string, string>;
  /** empty rows before the header row */
  blankRowsAbove?: number;
  /** formula rows with no data after the real rows (the real sheet has hundreds) */
  trailingBlankFormulaRows?: number;
  /** write formulas without cached results (a file made by a script, never opened in Excel) */
  noCachedValues?: boolean;
  /** write Stop/Start as text instead of Excel date-times */
  timesAsText?: boolean;
  /** replace a cell with a raw value after building: [rowIndex (0-based data row), header, value] */
  overrides?: [number, string, string | number | Date | null][];
  /** extra sheets to add */
  otherSheets?: string[];
  /** put the extra sheets AFTER the Downtime sheet (default: before it, so Downtime is not first) */
  otherSheetsAfter?: boolean;
  /** shared (default) or inline strings */
  strings?: 'shared' | 'inline';
  /** write the workbook in the 1904 date system */
  date1904?: boolean;
  /** move every Stop/Start serial by this many last bits (what a re-save in Excel can do) */
  serialUlps?: number;
  /** store the sheets under odd file names with absolute targets */
  oddSheetPaths?: boolean;
}

const utc = (ts: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(ts);
  if (!m) throw new Error(`bad test timestamp ${ts}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0);
};

export async function buildWorkbook(rows: SheetRowSpec[], opts: WorkbookOptions = {}): Promise<Uint8Array> {
  const keep = HEADERS.filter((h) => !(opts.dropHeaders ?? []).includes(h));
  const grid: RawCell[][] = [];
  for (let i = 0; i < (opts.blankRowsAbove ?? 0); i++) grid.push([]);
  const headerRow = (opts.blankRowsAbove ?? 0) + 1;
  grid.push(keep.map((h) => opts.renameHeaders?.[h] ?? h));
  const d1904 = !!opts.date1904;
  const put = (r: number, h: string, v: RawCell) => {
    const c = keep.indexOf(h);
    if (c < 0) return;
    const row = (grid[r - 1] ??= []);
    while (row.length < c) row.push(null);
    row[c] = v;
  };
  const serial = (ms: number, ulps = 0) => serialOf(ms, { date1904: d1904, ulps });
  // a formula with its cached result; the 'no cached values' option stores the formula alone
  const formula = (f: string, v: number | string | boolean): RawCell => (opts.noCachedValues ? { f } : { f, v });
  const ulps = opts.serialUlps ?? 0;

  rows.forEach((s, i) => {
    const r = headerRow + 1 + i;
    const stop = utc(s.stop), start = utc(s.start);
    const hours = s.totalHours === undefined ? (start - stop) / 3_600_000 : s.totalHours;
    put(r, 'DATE', formula(`INT(F${r})`, serial(utc(`${s.date ?? s.stop.slice(0, 10)} 00:00:00`))));
    put(r, 'Freq', formula(`IF(F${r}=G${r - 1},0,1)`, s.freq === null ? '' : (s.freq ?? 1)));
    put(r, 'Line', s.line);
    put(r, 'EQUIPMENT', s.area);
    put(r, 'EQUIPMENT CODE', s.code);
    put(r, 'Stop Time', opts.timesAsText ? s.stop : serial(stop, ulps));
    put(r, 'Start Time', opts.timesAsText ? s.start : serial(start, ulps));
    put(r, 'STOPPAGE DURATION (day)', formula(`INT(G${r}-F${r})`, 0));
    put(r, 'STOPPAGE DURATION (h)', formula(`HOUR(G${r}-F${r})`, Math.floor(Math.max(0, hours ?? 0))));
    put(r, 'STOPPAGE DURATION (min)', formula(`MINUTE(G${r}-F${r})`, 0));
    put(r, 'STOPPAGE DURATION (sec)', formula(`SECOND(G${r}-F${r})`, 0));
    put(r, 'TOTAL STOPPAGE DURATION (h)', formula(`(G${r}-F${r})*24`, hours === null ? '' : hours));
    put(r, 'Status', formula(`IF(G${r}>0,"Closed","Open")`, 'Closed'));
    put(r, 'STOPPAGE CLASIFICATION', s.classification);
    put(r, 'CRITICALITY', formula(`IF(N${r}="PL","NO_INC","INC")`, s.criticality === null ? '' : (s.criticality ?? 'INC')));
    put(r, 'REASON', s.reason ?? '');
    put(r, 'Failure', formula(`IF(AND(O${r}="INC",B${r}=1),"YES","NO")`, s.failure === null ? '' : (s.failure ?? 'YES')));
    put(r, 'DESCRIPTION', s.description ?? '');
  });
  const last = headerRow + rows.length;
  for (let i = 0; i < (opts.trailingBlankFormulaRows ?? 0); i++) {
    const r = last + 1 + i;
    put(r, 'DATE', formula(`IF(F${r}="","",INT(F${r}))`, ''));
    put(r, 'Freq', formula(`IF(F${r}="","",IF(F${r}=G${r - 1},0,1))`, ''));
    put(r, 'STOPPAGE DURATION (day)', formula(`IF(F${r}="","",INT(G${r}-F${r}))`, ''));
    put(r, 'TOTAL STOPPAGE DURATION (h)', formula(`IF(F${r}="","",(G${r}-F${r})*24)`, ''));
    put(r, 'Status', formula(`IF(F${r}="","","Closed")`, ''));
    put(r, 'CRITICALITY', formula(`IF(F${r}="","",IF(N${r}="PL","NO_INC","INC"))`, ''));
    put(r, 'Failure', formula(`IF(F${r}="","",IF(AND(O${r}="INC",B${r}=1),"YES","NO"))`, ''));
  }
  for (const [idx, header, value] of opts.overrides ?? []) {
    put(headerRow + 1 + idx, header, value instanceof Date ? serial(value.getTime()) : value);
  }

  const others = (opts.otherSheets ?? []).map((name) => ({ name, rows: [['nothing here']] as RawCell[][] }));
  const main = { name: opts.sheetName ?? 'Downtime', rows: grid };
  const sheets = opts.otherSheetsAfter ? [main, ...others] : [...others, main];
  const mainIndex = sheets.indexOf(main);
  const xo: XlsxOptions = { strings: opts.strings, date1904: d1904 };
  if (opts.oddSheetPaths) {
    xo.absoluteTargets = true;
    xo.sheetPaths = Object.fromEntries(sheets.map((_s, i) => [i, i === mainIndex ? 'xl/worksheets/data_main.xml' : `xl/worksheets/other_${i}.xml`]));
  }
  return buildXlsx(sheets, xo);
}

/** A tidy run of events for tests: n rows in area K.1 (line L.1), one per day from `firstDate`. */
export function simpleRows(n: number, firstDate = '2026-11-01', over: Partial<SheetRowSpec> = {}): SheetRowSpec[] {
  const out: SheetRowSpec[] = [];
  const base = Date.parse(`${firstDate}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    const day = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
    out.push({
      line: 'L.1', area: 'K.1', code: '131.BC100', stop: `${day} 08:10:05.000`, start: `${day} 09:40:35.000`,
      classification: 'MEC', reason: 'Belt torn', description: `Synthetic row ${i + 1}`, ...over,
    });
  }
  return out;
}
