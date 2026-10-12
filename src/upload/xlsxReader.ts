// A small, exact .xlsx reader (no DOM, works in browsers and in Node).
//
// Why our own: the libraries tried either converted Excel serial dates with a floor
// (1 ms low for about a quarter of real stamps) or dropped the cached result of a
// formula that evaluates to 0, '' or false. This reader returns, for every cell,
// exactly the value Excel stored:
//   - a formula cell gives its CACHED result (never the formula text); with no
//     cached result it gives null;
//   - a number is Number(<v text>), so a cached 0 stays 0;
//   - text comes from shared strings (rich-text runs joined, phonetic runs ignored),
//     inline strings or formula string results; XML entities are decoded.
// Only xl/workbook.xml, its .rels, and the one sheet (plus shared strings) are inflated.
import { unzipSync } from 'fflate';

export type XlsxInput = ArrayBuffer | Uint8Array | Blob;
export type XlsxResult =
  | { ok: true; data: unknown[][]; sheets: string[]; date1904: boolean }
  | { ok: false; reason: 'unreadable' | 'no_sheet'; sheets: string[] };

/** Refuse to inflate a single part larger than this (zip-bomb guard). */
const MAX_PART_BYTES = 300 * 1024 * 1024;
const MAX_ROWS = 1_048_576;
const MAX_COLS = 16_384;

const decoder = new TextDecoder('utf-8');
const text = (b: Uint8Array): string => decoder.decode(b);

function codePoint(n: number): string {
  try { return String.fromCodePoint(n); } catch { return ''; }
}

/** XML entities (named and numeric) and Excel's _xHHHH_ escapes. */
export function decodeXml(s: string): string {
  let out = s;
  if (out.includes('&')) {
    out = out.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
      if (e === 'amp') return '&';
      if (e === 'lt') return '<';
      if (e === 'gt') return '>';
      if (e === 'quot') return '"';
      if (e === 'apos') return "'";
      return codePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    });
  }
  if (out.includes('_x')) out = out.replace(/_x([0-9a-fA-F]{4})_/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  return out;
}

const ATTR = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(s))) out[m[1] as string] = decodeXml((m[2] ?? m[3]) as string);
  return out;
}

/** Concatenated <t> text of an <si> / <is> body, ignoring phonetic runs. */
function textOf(body: string): string {
  const clean = body.includes('<rPh') ? body.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '') : body;
  let out = '';
  const re = /<t(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) if (m[1] !== undefined) out += decodeXml(m[1]);
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1] === undefined ? '' : textOf(m[1]));
  return out;
}

/** 'AB12' -> { col: 27, row: 11 } (0-based), or null. */
function refOf(r: string): { col: number; row: number } | null {
  const m = /^([A-Za-z]{1,3})(\d+)$/.exec(r);
  if (!m) return null;
  let col = 0;
  for (const ch of (m[1] as string).toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

function parseSheet(xml: string, shared: () => string[]): unknown[][] {
  const rows: unknown[][] = [];
  let strings: string[] | null = null;
  let nextRow = 0;
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml))) {
    const rAttr = /\br="(\d+)"/.exec(rm[1] as string);
    const rowIdx = rAttr ? Number(rAttr[1]) - 1 : nextRow;
    nextRow = rowIdx + 1;
    const body = rm[2];
    if (body === undefined || rowIdx < 0 || rowIdx >= MAX_ROWS) continue;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let nextCol = 0;
    let cm: RegExpExecArray | null;
    let row: unknown[] | undefined;
    while ((cm = cellRe.exec(body))) {
      const a = cm[1] as string;
      const refM = /\br="([A-Za-z]+\d+)"/.exec(a);
      const ref = refM ? refOf(refM[1] as string) : null;
      const colIdx = ref ? ref.col : nextCol;
      nextCol = colIdx + 1;
      const inner = cm[2];
      if (inner === undefined || colIdx < 0 || colIdx >= MAX_COLS) continue;
      const tM = /\bt="([^"]*)"/.exec(a);
      const t = tM ? (tM[1] as string) : 'n';
      let value: unknown = null;
      if (t === 'inlineStr') {
        const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner);
        value = is ? textOf(is[1] as string) : null;
      } else {
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
        if (v) {
          const raw = v[1] as string;
          if (t === 's') {
            strings ??= shared();
            const s = strings[Number(raw)];
            value = s === undefined ? null : s;
          } else if (t === 'str') value = decodeXml(raw);
          else if (t === 'b') value = raw.trim() === '1' || raw.trim().toLowerCase() === 'true';
          else if (t === 'e') value = null;
          else if (t === 'd') value = decodeXml(raw).trim();
          else {
            const n = raw.trim() === '' ? NaN : Number(raw);
            value = Number.isNaN(n) ? null : n;
          }
        }
      }
      if (value === null) continue; // leave the gap; padded below
      row ??= rows[rowIdx] ??= [];
      while (row.length < colIdx) row.push(null);
      row[colIdx] = value;
    }
  }
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];
  return rows;
}

function unzipParts(bytes: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  return unzipSync(bytes, { filter: (f) => wanted(f.name) && f.originalSize <= MAX_PART_BYTES });
}

async function toBytes(file: XlsxInput): Promise<Uint8Array> {
  if (file instanceof Uint8Array) return file;
  if (file instanceof ArrayBuffer) return new Uint8Array(file);
  return new Uint8Array(await file.arrayBuffer());
}

function resolveTarget(target: string): string {
  const parts: string[] = [];
  const full = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  for (const p of full.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.' && p !== '') parts.push(p);
  }
  return parts.join('/');
}

/** Reads one sheet of an .xlsx as a dense array of rows (row 1 = index 0). */
export async function readXlsxSheet(file: XlsxInput, sheetName: string): Promise<XlsxResult> {
  let sheets: string[] = [];
  try {
    const bytes = await toBytes(file);
    const head = unzipParts(bytes, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels');
    const wbBytes = head['xl/workbook.xml'];
    if (!wbBytes) return { ok: false, reason: 'unreadable', sheets };
    const wbXml = text(wbBytes);
    const list: { name: string; rid: string }[] = [];
    const sheetRe = /<sheet\b([^>]*?)\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = sheetRe.exec(wbXml))) {
      const a = attrs(m[1] as string);
      const ridKey = Object.keys(a).find((k) => k === 'id' || k.endsWith(':id'));
      if (a.name !== undefined) list.push({ name: a.name, rid: ridKey ? (a[ridKey] as string) : '' });
    }
    sheets = list.map((s) => s.name);
    const date1904 = /<workbookPr\b[^>]*\bdate1904\s*=\s*["'](?:1|true)["']/i.test(wbXml);

    const want = sheetName.trim().toLowerCase();
    const hit = list.find((s) => s.name === sheetName) ?? list.find((s) => s.name.trim().toLowerCase() === want);
    if (!hit) return { ok: false, reason: 'no_sheet', sheets };

    const relsBytes = head['xl/_rels/workbook.xml.rels'];
    if (!relsBytes) return { ok: false, reason: 'unreadable', sheets };
    let target: string | undefined;
    const relRe = /<Relationship\b([^>]*?)\/?>/g;
    while ((m = relRe.exec(text(relsBytes)))) {
      const a = attrs(m[1] as string);
      if (a.Id === hit.rid && a.Target) { target = resolveTarget(a.Target); break; }
    }
    if (!target) return { ok: false, reason: 'unreadable', sheets };

    const t = target;
    const parts = unzipParts(bytes, (n) => n === t || n === 'xl/sharedStrings.xml');
    const sheetBytes = parts[t];
    if (!sheetBytes) return { ok: false, reason: 'unreadable', sheets };
    const sst = parts['xl/sharedStrings.xml'];
    const data = parseSheet(text(sheetBytes), () => (sst ? parseSharedStrings(text(sst)) : []));
    return { ok: true, data, sheets, date1904 };
  } catch {
    return { ok: false, reason: 'unreadable', sheets };
  }
}
