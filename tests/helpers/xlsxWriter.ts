// A minimal raw-XML .xlsx writer for tests (fflate zipSync, no other dependency).
// Unlike the spreadsheet libraries it can write formula cells whose cached result
// is 0, '' or false, exactly as Excel stores them, and date-times as serial numbers
// with millisecond precision. Works in vitest, Playwright's loader and the browser.
import { zipSync, strToU8 } from 'fflate';

/** A plain value, or a formula with its cached result (v undefined = no cached result). */
export type RawCell = null | number | string | boolean | { f: string; v?: number | string | boolean };

export interface RawSheet {
  name: string;
  /** rows of cells; row 0 is sheet row 1 */
  rows: RawCell[][];
}

export interface XlsxOptions {
  /** 'shared' (default) writes strings to sharedStrings.xml, 'inline' as <is> */
  strings?: 'shared' | 'inline';
  date1904?: boolean;
  /** package path of the sheet at this index (default xl/worksheets/sheet{n}.xml) */
  sheetPaths?: Record<number, string>;
  /** write Target as an absolute '/xl/...' path */
  absoluteTargets?: boolean;
  /** write the r="A1" attribute on cells (default true); false relies on order */
  omitCellRefs?: boolean;
  /** raw sharedStrings entries (<si> bodies) to put first, to test rich text etc. */
  rawSharedStrings?: string[];
}

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function colName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const SERIAL_ORIGIN_MS = Date.UTC(1899, 11, 30);
/** Excel serial for a UTC-typed date-time. `ulps` moves the double by that many last bits. */
export function serialOf(ms: number | Date, opts: { date1904?: boolean; ulps?: number } = {}): number {
  const t = ms instanceof Date ? ms.getTime() : ms;
  let n = (t - SERIAL_ORIGIN_MS) / 86_400_000 - (opts.date1904 ? 1462 : 0);
  if (opts.ulps) {
    const f = new Float64Array([n]);
    const b = new BigInt64Array(f.buffer);
    b[0] = (b[0] as bigint) + BigInt(opts.ulps);
    n = f[0] as number;
  }
  return n;
}

export function buildXlsx(sheets: RawSheet[], opts: XlsxOptions = {}): Uint8Array {
  const shared: string[] = [...(opts.rawSharedStrings ?? [])];
  const sharedIndex = new Map<string, number>();
  const sst = (s: string): number => {
    let i = sharedIndex.get(s);
    if (i === undefined) {
      i = shared.length;
      shared.push(`<t xml:space="preserve">${esc(s)}</t>`);
      sharedIndex.set(s, i);
    }
    return i;
  };
  const inline = opts.strings === 'inline';

  const cellXml = (c: RawCell, ref: string): string => {
    const r = opts.omitCellRefs ? '' : ` r="${ref}"`;
    if (c === null) return '';
    if (typeof c === 'number') return `<c${r}><v>${c}</v></c>`;
    if (typeof c === 'boolean') return `<c${r} t="b"><v>${c ? 1 : 0}</v></c>`;
    if (typeof c === 'string') {
      return inline
        ? `<c${r} t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`
        : `<c${r} t="s"><v>${sst(c)}</v></c>`;
    }
    const f = `<f>${esc(c.f)}</f>`;
    if (c.v === undefined) return `<c${r}>${f}</c>`;
    if (typeof c.v === 'number') return `<c${r}>${f}<v>${c.v}</v></c>`;
    if (typeof c.v === 'boolean') return `<c${r} t="b">${f}<v>${c.v ? 1 : 0}</v></c>`;
    return `<c${r} t="str">${f}<v>${esc(c.v)}</v></c>`;
  };

  const files: Record<string, Uint8Array> = {};
  const sheetPath = (i: number): string => opts.sheetPaths?.[i] ?? `xl/worksheets/sheet${i + 1}.xml`;
  sheets.forEach((sh, i) => {
    const rows = sh.rows.map((cells, ri) => {
      const body = cells.map((c, ci) => cellXml(c, `${colName(ci)}${ri + 1}`)).join('');
      return body ? `<row r="${ri + 1}">${body}</row>` : '';
    }).join('');
    files[sheetPath(i)] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`,
    );
  });

  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook ${ns}><workbookPr${opts.date1904 ? ' date1904="1"' : ''}/><sheets>` +
      sheets.map((sh, i) => `<sheet name="${esc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
  );
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const target = (p: string): string => (opts.absoluteTargets ? `/${p}` : p.replace(/^xl\//, ''));
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="${target(sheetPath(i))}"/>`).join('') +
      (shared.length ? `<Relationship Id="rId${sheets.length + 1}" Type="${rel}/sharedStrings" Target="${target('xl/sharedStrings.xml')}"/>` : '') +
      '</Relationships>',
  );
  if (shared.length) {
    files['xl/sharedStrings.xml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
        shared.map((b) => `<si>${b}</si>`).join('') + '</sst>',
    );
  }
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
  );
  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  return zipSync(files, { level: 1 });
}
