// Reconciles a monthly downtime workbook with the totals in its own "Analysis" sheet.
//
//   npx vite-node tools/golden-check.ts -- path/to/workbook.xlsx
//
// The workbook is read locally and never leaves the machine. It runs the same parser the
// upload page uses, adds up hours and stops per classification, and compares them with the
// Analysis sheet's cells F3:L4 (PRO MEC ELE AUT PL CIR). The Analysis sheet's INC / NO_INC /
// Failure counts are not compared on purpose: its formulas also count the empty pre-filled rows
// of the table, so those counts come out too high.
import { readFileSync } from 'node:fs';
import { parseWorkbook } from '../src/upload/parseWorkbook';
import { readXlsxSheet } from '../src/upload/xlsxReader';

const path = process.argv.slice(2).find((a) => a.endsWith('.xlsx'));
if (!path) {
  console.log('Usage: npx vite-node tools/golden-check.ts -- path/to/workbook.xlsx');
  process.exit(2);
}
const bytes = readFileSync(path);
const file = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const parsed = await parseWorkbook(file);
if (!parsed.ok) {
  console.log('The upload parser refused this file:', parsed.message);
  process.exit(1);
}

const seconds = (a: string, b: string): number => {
  const ms = (s: string): number => Date.parse(s.replace(' ', 'T') + 'Z');
  return (ms(b) - ms(a)) / 1000;
};
const mine: Record<string, { h: number; n: number }> = {};
for (const r of parsed.rows) {
  const m = (mine[r.classification] ||= { h: 0, n: 0 });
  m.h += seconds(r.stop_ts, r.start_ts) / 3600;
  m.n += 1;
}

const analysis = await readXlsxSheet(file, 'Analysis');
console.log(`Read ${parsed.rows.length} rows (${parsed.dateFrom} to ${parsed.dateTo}); ${parsed.rejected.length} rejected; ${parsed.blankRows} empty formula rows skipped.`);
if (!analysis.ok) {
  console.log('No "Analysis" sheet to compare with. Totals from the Downtime sheet:');
  for (const [k, v] of Object.entries(mine)) console.log(`  ${k.padEnd(4)} ${v.h.toFixed(2).padStart(9)} h  ${String(v.n).padStart(5)} stops`);
  process.exit(0);
}
const cell = (col: string, row: number): number => {
  const c = col.charCodeAt(0) - 65;
  const v = analysis.data[row - 1]?.[c];
  return typeof v === 'number' ? v : NaN;
};
let ok = true;
for (const [col, k] of [['F', 'PRO'], ['G', 'MEC'], ['H', 'ELE'], ['J', 'AUT'], ['K', 'PL'], ['L', 'CIR']] as const) {
  const eh = cell(col, 3);
  const en = cell(col, 4);
  const m = mine[k] ?? { h: 0, n: 0 };
  const same = Math.abs(m.h - eh) < 0.05 && m.n === en;
  ok &&= same;
  console.log(`${same ? 'OK  ' : 'DIFF'} ${k.padEnd(4)} app ${m.h.toFixed(2).padStart(9)} h ${String(m.n).padStart(5)} stops | Analysis sheet ${eh.toFixed(2).padStart(9)} h ${String(en).padStart(5)} stops`);
}
console.log(ok ? 'All classification totals match the Analysis sheet.' : 'Some totals differ: check the DIFF lines.');
process.exit(ok ? 0 : 1);
