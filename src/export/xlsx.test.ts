import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readXlsxSheet } from '../upload/xlsxReader';
import { csvField, csvText, toCsv, CSV_BOM } from './csv';
import { exportFileName, periodSlug, slug } from './files';
import { exportCol, tableToCsv, tableToSheet, type ExportTable } from './table';
import { buildXlsx, cleanText, colName, serialOfStamp, sheetNames, type XSheet } from './xlsx';

const files = (bytes: Uint8Array): Record<string, string> => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]));
const read = async (bytes: Uint8Array, name: string) => {
  const r = await readXlsxSheet(bytes, name);
  if (!r.ok) throw new Error(`${r.reason} ${r.sheets.join('|')}`);
  return r;
};

/** The number-format code of the cell at `ref` on sheet n (1-based), from styles.xml. */
function formatOf(bytes: Uint8Array, sheet: number, ref: string): string {
  const f = files(bytes);
  const cell = new RegExp(`<c r="${ref}"([^>]*)>`).exec(f[`xl/worksheets/sheet${sheet}.xml`]!);
  const s = Number(/\bs="(\d+)"/.exec(cell?.[1] ?? '')?.[1] ?? 0);
  const styles = f['xl/styles.xml']!;
  const xfs = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '').matchAll(/<xf\b([^>]*?)\/?>/g)].map((m) => m[1]!);
  const id = Number(/numFmtId="(\d+)"/.exec(xfs[s] ?? '')?.[1] ?? 0);
  const custom = new Map([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), m[2]!.replace(/&quot;/g, '"')]));
  return custom.get(id) ?? ({ 0: 'General', 3: '#,##0', 49: '@' } as Record<number, string>)[id] ?? `builtin ${id}`;
}
const xfOf = (bytes: Uint8Array, sheet: number, ref: string): string => {
  const f = files(bytes);
  const cell = new RegExp(`<c r="${ref}"([^>]*)>`).exec(f[`xl/worksheets/sheet${sheet}.xml`]!);
  const s = Number(/\bs="(\d+)"/.exec(cell?.[1] ?? '')?.[1] ?? 0);
  const xfs = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(f['xl/styles.xml']!)?.[1] ?? '').matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((m) => m[0]);
  return xfs[s] ?? '';
};

describe('xlsx writer: round trip with the app reader', () => {
  const sheet: XSheet = {
    name: 'Data', headerRow: 0,
    rows: [
      ['Name', 'Hours', 'Share', 'Day', 'Stopped', 'Count'],
      ['Crusher <1> & "co"', { v: 12.3456, fmt: 'h1' }, { v: 0.253, fmt: 'pct' }, { v: '2026-09-30', fmt: 'date' }, { v: '2026-09-30 13:45:07', fmt: 'datetime' }, { v: 1234567, fmt: 'int' }],
      ['مطحنة الأسمنت – café', { v: 0, fmt: 'h2' }, null, { v: 'not a date', fmt: 'date' }, { v: '2026-01-02T03:04', fmt: 'datetime' }, 0],
      ['=1+1', 1e-7, -5.5, true, false, 'two\nlines'],
    ],
  };
  const bytes = buildXlsx([sheet, { name: 'Other', rows: [['x']] }], { title: 'T', creator: 'Me', created: '2026-10-13T10:00:00.000Z' });

  it('reads back text (escaping, Arabic, newlines, a formula-looking string) and numbers exactly', async () => {
    const r = await read(bytes, 'Data');
    expect(r.sheets).toEqual(['Data', 'Other']);
    expect(r.data[0]).toEqual(['Name', 'Hours', 'Share', 'Day', 'Stopped', 'Count']);
    expect(r.data[1]![0]).toBe('Crusher <1> & "co"');
    expect(r.data[1]![1]).toBe(12.3456);
    expect(r.data[1]![2]).toBe(0.253);
    expect(r.data[1]![5]).toBe(1234567);
    expect(r.data[2]![0]).toBe('مطحنة الأسمنت – café');
    expect(r.data[2]![1]).toBe(0);
    expect(r.data[2]![3]).toBe('not a date'); // an unreadable date stays text
    expect(r.data[3]).toEqual(['=1+1', 1e-7, -5.5, true, false, 'two\nlines']);
  });

  it('dates and timestamps are Excel serial numbers with the plant-local time as typed', async () => {
    const r = await read(bytes, 'Data');
    expect(r.data[1]![3]).toBe(46295); // 2026-09-30
    expect(serialOfStamp('2026-09-30')).toBe(46295);
    expect(r.data[1]![4]).toBeCloseTo(46295 + (13 * 3600 + 45 * 60 + 7) / 86400, 9);
    expect(serialOfStamp('2026-01-02T03:04')).toBeCloseTo(46024 + (3 * 3600 + 4 * 60) / 86400, 9);
    expect(serialOfStamp('2026-02-30')).toBeNull();
    expect(serialOfStamp('nope')).toBeNull();
    expect(serialOfStamp('2026-09-30 13:45:07.250')! - serialOfStamp('2026-09-30 13:45:07')!).toBeCloseTo(0.25 / 86400, 9);
  });

  it('number formats: 0.0 hours, 0.00 hours, 0.0% as a fraction, yyyy-mm-dd, yyyy-mm-dd hh:mm:ss, #,##0', () => {
    expect(formatOf(bytes, 1, 'B2')).toBe('0.0');
    expect(formatOf(bytes, 1, 'B3')).toBe('0.00');
    expect(formatOf(bytes, 1, 'C2')).toBe('0.0%');
    expect(formatOf(bytes, 1, 'D2')).toBe('yyyy-mm-dd');
    expect(formatOf(bytes, 1, 'E2')).toBe('yyyy-mm-dd hh:mm:ss');
    expect(formatOf(bytes, 1, 'F2')).toBe('#,##0');
    expect(formatOf(bytes, 1, 'A2')).toBe('General');
  });

  it('header row: bold with a fill, frozen, filtered; the sheet has a dimension and widths', () => {
    const f = files(bytes);
    const xf = xfOf(bytes, 1, 'A1');
    expect(xf).toContain('fontId="1"');
    expect(xf).toContain('fillId="2"');
    const styles = f['xl/styles.xml']!;
    expect(styles).toMatch(/<font><b\/>/);
    expect(styles).toContain('patternType="solid"');
    const xml = f['xl/worksheets/sheet1.xml']!;
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(xml).toContain('<autoFilter ref="A1:F4"/>');
    expect(xml).toContain('<dimension ref="A1:F4"/>');
    expect(f['xl/workbook.xml']).toContain("_xlnm._FilterDatabase");
    expect(f['xl/workbook.xml']).toContain("'Data'!$A$1:$F$4");
    expect(f['docProps/core.xml']).toContain('<dc:creator>Me</dc:creator>');
    expect(f['[Content_Types].xml']).toContain('/xl/styles.xml');
    // the second sheet has no header row: no pane, no filter
    expect(f['xl/worksheets/sheet2.xml']).not.toContain('<pane');
    expect(f['xl/worksheets/sheet2.xml']).not.toContain('autoFilter');
  });

  it('column widths follow the content and are capped', () => {
    const long = buildXlsx([{ name: 'W', headerRow: 0, rows: [['A', 'B'], ['x'.repeat(200), 'ok']] }]);
    const xml = files(long)['xl/worksheets/sheet1.xml']!;
    const widths = [...xml.matchAll(/<col min="(\d)" max="\d" width="([\d.]+)"/g)].map((m) => Number(m[2]));
    expect(widths[0]).toBe(60);
    expect(widths[1]).toBeGreaterThanOrEqual(8);
    expect(widths[1]).toBeLessThan(20);
    const fixed = buildXlsx([{ name: 'W', rows: [['abc']], widths: [30] }]);
    expect(files(fixed)['xl/worksheets/sheet1.xml']).toContain('width="30"');
  });

  it('notes under a table do not widen its columns', () => {
    const b = buildXlsx([{ name: 'N', headerRow: 0, measureRows: 2, rows: [['Area'], ['CR'], [], ['A long sentence of notes that sits under the table and goes on and on for a while.']] }]);
    const xml = files(b)['xl/worksheets/sheet1.xml']!;
    const w = Number(/<col min="1" max="1" width="([\d.]+)"/.exec(xml)![1]);
    expect(w).toBeLessThan(15);
  });

  it('autoFilter can be switched off and limited to the data rows (a total row below stays out)', () => {
    const b = buildXlsx([{ name: 'T', headerRow: 0, filterRows: 2, rows: [['a'], [1], [2], ['total']] }, { name: 'N', headerRow: 0, autoFilter: false, rows: [['a'], [1]] }]);
    const f = files(b);
    expect(f['xl/worksheets/sheet1.xml']).toContain('<autoFilter ref="A1:A3"/>');
    expect(f['xl/worksheets/sheet2.xml']).not.toContain('autoFilter');
    expect(f['xl/worksheets/sheet2.xml']).toContain('state="frozen"');
  });

  it('drops characters XML cannot hold, keeps tabs and line breaks, cuts text over Excel\'s cell limit', async () => {
    expect(cleanText('a\u0000b\u0008c\td\ne\uD800f')).toBe('abc\td\nef');
    const b = buildXlsx([{ name: 'S', rows: [['x\u0001y', 'z'.repeat(40000)]] }]);
    const r = await read(b, 'S');
    expect(r.data[0]![0]).toBe('xy');
    expect((r.data[0]![1] as string).length).toBe(32767);
  });

  it('ignores NaN and Infinity instead of writing invalid XML; very large and tiny numbers survive', async () => {
    const b = buildXlsx([{ name: 'S', rows: [[Number.NaN, Number.POSITIVE_INFINITY, 1e21, 123456789.123456789]] }]);
    const r = await read(b, 'S');
    expect(r.data[0]).toEqual([null, null, 1e21, 123456789.123456789]);
  });

  it('requires a sheet', () => {
    expect(() => buildXlsx([])).toThrow();
    expect(colName(0)).toBe('A');
    expect(colName(26)).toBe('AA');
    expect(colName(701)).toBe('ZZ');
  });
});

describe('sheet names', () => {
  it('are valid (no \\ / ? * [ ] :, not empty, no edge apostrophes), at most 31 characters and unique ignoring case', () => {
    const out = sheetNames(['Summary', 'summary', 'Pareto by area, line and classification', 'Pareto by area, line and classification', 'a/b?c*d[e]f:g', "'quoted'", '', 'History', 'x'.repeat(40), 'x'.repeat(40)]);
    expect(out[0]).toBe('Summary');
    expect(out[1]).toBe('summary (2)');
    expect(out[2]).toHaveLength(31);
    expect(out[3]).toHaveLength(31);
    expect(out[3]).toMatch(/\(2\)$/);
    expect(out[4]).toBe('a b c d e f g');
    expect(out[5]).toBe('quoted');
    expect(out[6]).toBe('Sheet');
    expect(out[7]).not.toBe('History');
    for (const n of out) {
      expect(n).not.toMatch(/[\\/?*[\]:]/);
      expect(n.length).toBeGreaterThan(0);
      expect(n.length).toBeLessThanOrEqual(31);
    }
    expect(new Set(out.map((n) => n.toLowerCase())).size).toBe(out.length);
  });

  it('are written to the workbook valid and unique even when the caller passes bad ones', async () => {
    const b = buildXlsx([{ name: 'A:B', rows: [[1]] }, { name: 'a:b', rows: [[2]] }]);
    const r = await read(b, 'A B');
    expect(r.sheets).toEqual(['A B', 'a b (2)']);
  });
});

describe('csv writer', () => {
  it('starts with a UTF-8 byte order mark, separates with commas and ends every row with CRLF', () => {
    const text = toCsv([['a', 'b'], [1, 2.5]]);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text).toBe('﻿a,b\r\n1,2.5\r\n');
    const bytes = new TextEncoder().encode(text);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('quotes fields with a comma, quote, line break or edge space and doubles the quotes', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('cr\rhere')).toBe('"cr\rhere"');
    expect(csvField(' padded')).toBe('" padded"');
    expect(csvField('مطحنة, café')).toBe('"مطحنة, café"');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(true)).toBe('TRUE');
  });

  it('writes numbers plainly and leaves non-finite ones empty', () => {
    expect(csvText(12)).toBe('12');
    expect(csvText(0.1 + 0.2)).toBe('0.3');
    expect(csvText(-5.25)).toBe('-5.25');
    expect(csvText(Number.NaN)).toBe('');
    expect(csvText(1e-7)).toBe('1e-7');
  });

  it('keeps a spreadsheet from running text as a formula, but leaves plain numbers and a lone dash alone', () => {
    expect(csvText('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(csvText('+1+1')).toBe("'+1+1");
    expect(csvText('@cmd')).toBe("'@cmd");
    expect(csvText('-2+3')).toBe("'-2+3");
    expect(csvText('\tx')).toBe("'\tx");
    expect(csvText('-5')).toBe('-5');
    expect(csvText('-')).toBe('-');
    expect(csvText('normal = text')).toBe('normal = text');
  });
});

describe('export tables', () => {
  const table: ExportTable = {
    id: 'demo', sheet: 'Demo',
    columns: [exportCol('Area'), exportCol('Hours', 'h1'), exportCol('Availability', 'pct'), exportCol('Day', 'date'), exportCol('Stopped', 'datetime'), exportCol('N', 'int')],
    rows: [['CR', 12.34, 94.56, '2026-09-01', '2026-09-01T08:00', 3], ['RM.1', null, null, '', '2026-09-02 09:30:15', 0], ['K.1', 'none recorded', 'n/a', '2026-09-03', '', null]],
    total: ['All', 12.34, 94.56, null, null, 3],
    notes: ['A takeaway.', 'A note.'],
  };

  it('Excel sheet: header, rows, bold total below the filtered range, notes after a blank row; percentages stored as fractions', async () => {
    const sheet = tableToSheet(table);
    expect(sheet.headerRow).toBe(0);
    expect(sheet.filterRows).toBe(3);
    const bytes = buildXlsx([sheet]);
    const r = await read(bytes, 'Demo');
    expect(r.data[0]).toEqual(['Area', 'Hours', 'Availability', 'Day', 'Stopped', 'N']);
    expect(r.data[1]![1]).toBe(12.34);
    expect(r.data[1]![2]).toBeCloseTo(0.9456, 12);
    expect(r.data[1]![3]).toBe(46266);
    expect(r.data[2]).toEqual(['RM.1', null, null, null, serialOfStamp('2026-09-02 09:30:15'), 0].map((x) => x));
    expect(r.data[3]).toEqual(['K.1', 'none recorded', 'n/a', 46268]);
    expect(r.data[4]![0]).toBe('All');
    expect(xfOf(bytes, 1, 'A5')).toContain('fontId="1"');
    expect(r.data[5]).toEqual([]);
    expect(r.data[6]).toEqual(['A takeaway.']);
    expect(files(bytes)['xl/worksheets/sheet1.xml']).toContain('<autoFilter ref="A1:F4"/>');
    expect(formatOf(bytes, 1, 'C2')).toBe('0.0%');
  });

  it('CSV: header with (%) on percentage columns, data rows only (no total, no notes), timestamps with a space', () => {
    const text = tableToCsv(table);
    expect(text).toBe('﻿Area,Hours,Availability (%),Day,Stopped,N\r\nCR,12.34,94.56,2026-09-01,2026-09-01 08:00,3\r\nRM.1,,,,2026-09-02 09:30:15,0\r\nK.1,none recorded,n/a,2026-09-03,,\r\n');
  });
});

describe('file names', () => {
  it('read like ACC-downtime-monthly-management-report_2026-09.xlsx', () => {
    expect(exportFileName({ base: 'Monthly management report', period: periodSlug({ from: '2026-09-01', to: '2026-09-30' }) }, 'xlsx')).toBe('ACC-downtime-monthly-management-report_2026-09.xlsx');
    expect(periodSlug({ from: '2026-07-01', to: '2026-09-30' })).toBe('2026-07-01_to_2026-09-30');
    expect(exportFileName({ base: 'Failure analysis', period: '2026-09', extra: 'Top equipment' }, 'csv')).toBe('ACC-downtime-failure-analysis_2026-09_top-equipment.csv');
    expect(slug('Área ré – Test!')).toBe('area-re-test');
    expect(exportFileName({ base: 'تقرير' }, 'csv')).toBe('ACC-downtime-export.csv');
  });
});
