// A small production .xlsx writer (fflate zip + hand-written SpreadsheetML), used for the report and Event Explorer
// downloads. It writes: shared strings, a bold header row with a fill, number formats (0.0 hours, 0.00 hours, 0.0 %
// stored as a fraction, yyyy-mm-dd dates, yyyy-mm-dd hh:mm:ss timestamps stored as Excel serial numbers), a frozen header
// row, an autofilter over the data rows, automatic column widths (capped) and document properties.
// Text is always written as a string cell, never as a formula, so a value such as "=1+1" is just text in an .xlsx.
// Pure and DOM free: works in the browser, vitest and Node. The reader that checks it is src/upload/xlsxReader.ts.
import { strToU8, zipSync } from 'fflate';

export type CellFormat = 'general' | 'text' | 'int' | 'h1' | 'h2' | 'pct' | 'date' | 'datetime';

/** Excel number-format code of each format (pct is stored as a fraction: 0.253 shows as 25.3%). */
export const FORMAT_CODES: Record<CellFormat, string> = {
  general: 'General', text: '@', int: '#,##0', h1: '0.0', h2: '0.00', pct: '0.0%', date: 'yyyy-mm-dd', datetime: 'yyyy-mm-dd hh:mm:ss',
};

export interface StyledCell {
  /** a string, a number, a boolean, or null (empty). date / datetime formats take 'YYYY-MM-DD' / 'YYYY-MM-DD HH:MM[:SS[.mmm]]' text. */
  v: string | number | boolean | null;
  fmt?: CellFormat;
  bold?: boolean;
  /** wrap long text and align to the top */
  wrap?: boolean;
}
export type XCell = string | number | boolean | null | StyledCell;

export interface XSheet {
  name: string;
  rows: XCell[][];
  /** 0-based index of the header row: it is bold with a fill, frozen with everything above it, and carries the autofilter */
  headerRow?: number;
  /** number of data rows under the header covered by the autofilter (default: all rows to the end of `rows`) */
  filterRows?: number;
  /** false: freeze and style the header but add no autofilter (default: true when there is a header row) */
  autoFilter?: boolean;
  /** how many rows from the top set the column widths (default 2,000); notes under a table should not widen its first column */
  measureRows?: number;
  /** column widths in characters; undefined entries are measured from the content */
  widths?: (number | undefined)[];
}

export interface WorkbookOptions {
  title?: string;
  creator?: string;
  /** ISO timestamp for the document properties (default: now) */
  created?: string;
}

export const MAX_COL_WIDTH = 60;
export const MIN_COL_WIDTH = 8;
const MAX_CELL_CHARS = 32767;
export const MAX_SHEET_ROWS = 1_048_576;

// ---------------------------------------------------------------- small helpers

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Characters XML 1.0 cannot hold (controls other than tab, LF, CR) and lone surrogates are dropped; very long text is cut to Excel's cell limit. */
export function cleanText(s: string): string {
  // eslint-disable-next-line no-control-regex
  let out = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
  out = out.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  return out.length > MAX_CELL_CHARS ? out.slice(0, MAX_CELL_CHARS - 1) + '…' : out;
}

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
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

/** Excel serial number of 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM[:SS[.mmm]]' (the plant-local time as typed; no time zone), or null when it is not a date. */
export function serialOfStamp(text: string): number | null {
  const m = STAMP_RE.exec(text.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d, Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), Number((m[7] ?? '0').padEnd(3, '0')));
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  // whole milliseconds as days, rounded so the serial has no float dust
  return Math.round(((ms - SERIAL_ORIGIN_MS) / 86_400_000) * 1e9) / 1e9;
}

/** Display width in characters of a cell (what the column must hold). */
function displayLength(c: StyledCell): number {
  const v = c.v;
  if (v === null) return 0;
  if (typeof v === 'string') {
    if (c.fmt === 'date') return 10;
    if (c.fmt === 'datetime') return 19;
    return c.wrap ? Math.min(v.length, MAX_COL_WIDTH) : Math.max(...v.split(/\r?\n/).map((l) => l.length), 0);
  }
  if (typeof v === 'boolean') return 5;
  switch (c.fmt) {
    case 'int': return Math.round(v).toLocaleString('en-US').length;
    case 'h1': return v.toFixed(1).length;
    case 'h2': return v.toFixed(2).length;
    case 'pct': return (v * 100).toFixed(1).length + 1;
    default: return String(v).length;
  }
}

const norm = (c: XCell): StyledCell => (c !== null && typeof c === 'object' ? c : { v: c });

// ---------------------------------------------------------------- sheet names

const BAD_SHEET_CHARS = /[\\/?*[\]:]/g;

/**
 * Valid, unique sheet names for the wanted ones: no \ / ? * [ ] : , not empty, not starting or ending with an apostrophe,
 * at most 31 characters, unique ignoring case (a duplicate gets " (2)", " (3)" ... inside the 31 characters).
 */
export function sheetNames(wanted: string[]): string[] {
  const used = new Set<string>();
  return wanted.map((raw) => {
    let base = raw.replace(BAD_SHEET_CHARS, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim();
    if (!base) base = 'Sheet';
    if (base.toLowerCase() === 'history') base = 'History 1';
    base = base.slice(0, 31).trim();
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = base.slice(0, 31 - suffix.length).trim() + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

// ---------------------------------------------------------------- styles

interface StyleKey { fmt: CellFormat; bold: boolean; wrap: boolean; header: boolean }

class Styles {
  private readonly keys: StyleKey[] = [];
  private readonly index = new Map<string, number>();
  private readonly fmtIds = new Map<CellFormat, number>();

  constructor() {
    this.id({ fmt: 'general', bold: false, wrap: false, header: false }); // xf 0 is the default style
  }

  id(k: StyleKey): number {
    const key = `${k.fmt}|${k.bold ? 1 : 0}|${k.wrap ? 1 : 0}|${k.header ? 1 : 0}`;
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.keys.length;
      this.keys.push(k);
      this.index.set(key, i);
    }
    return i;
  }

  private numFmtId(f: CellFormat): number {
    if (f === 'general') return 0;
    if (f === 'int') return 3; // built in: #,##0
    if (f === 'text') return 49; // built in: @
    let id = this.fmtIds.get(f);
    if (id === undefined) {
      id = 164 + this.fmtIds.size;
      this.fmtIds.set(f, id);
    }
    return id;
  }

  xml(): string {
    const xfs = this.keys.map((k) => {
      const nf = this.numFmtId(k.fmt);
      const align = k.wrap || k.header
        ? `<alignment vertical="${k.header ? 'center' : 'top'}"${k.wrap ? ' wrapText="1"' : ''}/>` : '';
      const attrs = `numFmtId="${nf}" fontId="${k.bold || k.header ? 1 : 0}" fillId="${k.header ? 2 : 0}" borderId="${k.header ? 1 : 0}" xfId="0"` +
        `${nf ? ' applyNumberFormat="1"' : ''}${k.bold || k.header ? ' applyFont="1"' : ''}${k.header ? ' applyFill="1" applyBorder="1"' : ''}${align ? ' applyAlignment="1"' : ''}`;
      return align ? `<xf ${attrs}>${align}</xf>` : `<xf ${attrs}/>`;
    });
    const custom = [...this.fmtIds].map(([f, id]) => `<numFmt numFmtId="${id}" formatCode="${xmlEscape(FORMAT_CODES[f])}"/>`);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      (custom.length ? `<numFmts count="${custom.length}">${custom.join('')}</numFmts>` : '') +
      '<fonts count="2"><font><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F2"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FF8EA0B8"/></bottom><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }
}

// ---------------------------------------------------------------- the workbook

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Builds the .xlsx file. At most 255 sheets; at most MAX_SHEET_ROWS rows per sheet (more are cut). */
export function buildXlsx(sheets: XSheet[], opts: WorkbookOptions = {}): Uint8Array {
  if (sheets.length === 0) throw new Error('A workbook needs at least one sheet.');
  const names = sheetNames(sheets.map((s) => s.name));
  const styles = new Styles();
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const sst = (s: string): number => {
    let i = sharedIndex.get(s);
    if (i === undefined) {
      i = shared.length;
      shared.push(s);
      sharedIndex.set(s, i);
    }
    return i;
  };
  let stringRefs = 0;

  const files: Record<string, Uint8Array> = {};
  const filterNames: string[] = [];

  sheets.forEach((sheet, si) => {
    const rows = sheet.rows.length > MAX_SHEET_ROWS ? sheet.rows.slice(0, MAX_SHEET_ROWS) : sheet.rows;
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const header = sheet.headerRow;
    const widths: number[] = [];
    for (let c = 0; c < cols; c++) widths.push(sheet.widths?.[c] ?? 0);
    const measured = (c: number): boolean => sheet.widths?.[c] === undefined;
    // measure at most the first 2,000 rows: enough to size a column, cheap for a 50,000-row export
    const measureRows = Math.min(rows.length, 2000, sheet.measureRows ?? 2000);

    const out: string[] = [];
    rows.forEach((row, ri) => {
      const isHeader = header !== undefined && ri === header;
      const cells: string[] = [];
      row.forEach((raw, ci) => {
        const c = norm(raw);
        if (c.v === null || c.v === undefined) {
          if (isHeader) cells.push(`<c r="${colName(ci)}${ri + 1}" s="${styles.id({ fmt: 'general', bold: true, wrap: false, header: true })}"/>`);
          return;
        }
        let fmt: CellFormat = c.fmt ?? 'general';
        let value = c.v;
        if (typeof value === 'string' && (fmt === 'date' || fmt === 'datetime')) {
          const serial = serialOfStamp(value);
          if (serial === null) fmt = 'general';
          else value = serial;
        }
        if (typeof value === 'number' && !Number.isFinite(value)) {
          if (isHeader) cells.push(`<c r="${colName(ci)}${ri + 1}" s="${styles.id({ fmt: 'general', bold: true, wrap: false, header: true })}"/>`);
          return;
        }
        if (typeof value === 'string' && fmt !== 'general' && fmt !== 'text') fmt = 'general';
        if (typeof value === 'number' && fmt === 'text') fmt = 'general';
        const s = styles.id({ fmt: typeof value === 'string' ? 'general' : fmt, bold: !!c.bold, wrap: !!c.wrap, header: isHeader });
        const ref = `${colName(ci)}${ri + 1}`;
        const sAttr = s ? ` s="${s}"` : '';
        if (typeof value === 'number') cells.push(`<c r="${ref}"${sAttr}><v>${value}</v></c>`);
        else if (typeof value === 'boolean') cells.push(`<c r="${ref}"${sAttr} t="b"><v>${value ? 1 : 0}</v></c>`);
        else {
          stringRefs++;
          cells.push(`<c r="${ref}"${sAttr} t="s"><v>${sst(cleanText(value))}</v></c>`);
        }
        if (ri < measureRows && measured(ci)) widths[ci] = Math.max(widths[ci] ?? 0, displayLength({ ...c, fmt }) + (isHeader ? 3 : 0));
      });
      if (cells.length) out.push(`<row r="${ri + 1}"${isHeader ? ' ht="20" customHeight="1"' : ''}>${cells.join('')}</row>`);
    });

    const lastRow = Math.max(rows.length, 1);
    const colsXml = cols
      ? `<cols>${widths.map((w, c) => {
        const width = sheet.widths?.[c] !== undefined ? w : Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, w + 2));
        return `<col min="${c + 1}" max="${c + 1}" width="${Math.round(width * 100) / 100}" customWidth="1"/>`;
      }).join('')}</cols>` : '';
    let view = '<sheetViews><sheetView workbookViewId="0"' + (si === 0 ? ' tabSelected="1"' : '') + '>';
    if (header !== undefined) {
      view += `<pane ySplit="${header + 1}" topLeftCell="A${header + 2}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${header + 2}" sqref="A${header + 2}"/>`;
    }
    view += '</sheetView></sheetViews>';
    let filter = '';
    if (header !== undefined && cols > 0 && sheet.autoFilter !== false) {
      const lastData = sheet.filterRows !== undefined ? Math.min(rows.length, header + 1 + sheet.filterRows) : rows.length;
      const ref = `A${header + 1}:${colName(cols - 1)}${Math.max(header + 1, lastData)}`;
      filter = `<autoFilter ref="${ref}"/>`;
      const q = names[si]!.replace(/'/g, "''");
      filterNames.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${si}" hidden="1">'${xmlEscape(q)}'!$A$${header + 1}:$${colName(cols - 1)}$${Math.max(header + 1, lastData)}</definedName>`);
    }
    files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(
      `${HEAD}<worksheet xmlns="${NS}" xmlns:r="${REL}"><dimension ref="A1:${colName(Math.max(cols, 1) - 1)}${lastRow}"/>${view}` +
      `<sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${out.join('')}</sheetData>${filter}</worksheet>`,
    );
  });

  const sstXml = `${HEAD}<sst xmlns="${NS}" count="${stringRefs}" uniqueCount="${shared.length}">` +
    shared.map((s) => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`).join('') + '</sst>';
  files['xl/sharedStrings.xml'] = strToU8(sstXml);
  files['xl/styles.xml'] = strToU8(styles.xml());
  files['xl/workbook.xml'] = strToU8(
    `${HEAD}<workbook xmlns="${NS}" xmlns:r="${REL}"><workbookPr/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews><sheets>` +
    names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets>' +
    (filterNames.length ? `<definedNames>${filterNames.join('')}</definedNames>` : '') + '<calcPr calcId="191029"/></workbook>',
  );
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${sheets.length + 2}" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  );
  const created = (opts.created ?? new Date().toISOString()).replace(/\.\d+Z$/, 'Z');
  files['docProps/core.xml'] = strToU8(
    `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
    `xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(cleanText(opts.title ?? ''))}</dc:title>` +
    `<dc:creator>${xmlEscape(cleanText(opts.creator ?? 'ACC Downtime Analysis'))}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>`,
  );
  files['docProps/app.xml'] = strToU8(
    `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ACC Downtime Analysis</Application></Properties>`,
  );
  files['[Content_Types].xml'] = strToU8(
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
  );
  files['_rels/.rels'] = strToU8(
    `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
  return zipSync(files, { level: 1 });
}
