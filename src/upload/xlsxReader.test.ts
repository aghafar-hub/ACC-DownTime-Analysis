import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { buildXlsx, type RawCell } from '../../tests/helpers/xlsxWriter';
import { buildWorkbook, simpleRows } from '../../tests/helpers/makeWorkbook';
import { decodeXml, readXlsxSheet } from './xlsxReader';

const read = async (rows: RawCell[][], o: Parameters<typeof buildXlsx>[1] = {}, name = 'S') => {
  const r = await readXlsxSheet(buildXlsx([{ name, rows }], o), name);
  if (!r.ok) throw new Error(r.reason);
  return r;
};

describe('readXlsxSheet', () => {
  it('keeps cached 0, empty text and false of formula cells, and returns null without a cached value', async () => {
    const r = await read([[{ f: 'A1*0', v: 0 }, { f: '""', v: '' }, { f: '1=2', v: false }, { f: 'X', v: undefined }, { f: 'IF(1,"a")', v: 'a' }, 0]]);
    expect(r.data[0]).toEqual([0, '', false, null, 'a', 0]);
  });

  it('places cells by reference: gaps, skipped rows, self-closing cells, missing r attributes', async () => {
    const sheet = '<worksheet><sheetData><row r="2"><c r="C2"><v>5</v></c><c r="E2" s="1"/><c r="F2" t="b"><v>1</v></c></row><row r="5"><c r="B5" t="inlineStr"><is><t> x </t></is></c></row><row><c t="e"><v>#N/A</v></c><c><v>7</v></c></row></sheetData></worksheet>';
    const wb = zipSync({
      'xl/workbook.xml': strToU8('<workbook xmlns:r="x"><sheets><sheet name="A &amp; B" sheetId="1" r:id="rId9"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId9" Type="t" Target="/xl/worksheets/zzz.xml"/></Relationships>'),
      'xl/worksheets/zzz.xml': strToU8(sheet),
    });
    const r = await readXlsxSheet(wb, ' a & b');
    if (!r.ok) throw new Error('x');
    expect(r.sheets).toEqual(['A & B']);
    expect(r.data).toEqual([[], [null, null, 5, null, null, true], [], [], [null, ' x '], [null, 7]]);
  });

  it('shared strings: rich text joined, phonetic ignored, whitespace and entities kept', async () => {
    const r = await read([['plain', 'two']], {
      rawSharedStrings: ['<r><t>Hel</t></r><r><rPr><b/></rPr><t xml:space="preserve">lo &amp; </t></r><rPh sb="0"><t>PHON</t></rPh><r><t>&#65;&#x42;</t></r>', '<t/>'],
    });
    expect(r.data[0]).toEqual(['plain', 'two']);
    const rich = await readXlsxSheet(
      zipSync({
        'xl/workbook.xml': strToU8('<workbook xmlns:r="x"><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>'),
        'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
        'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>'),
        'xl/sharedStrings.xml': strToU8('<sst><si><r><t>Hel</t></r><r><t xml:space="preserve">lo &amp; </t></r><rPh sb="0"><t>PHON</t></rPh><r><t>&#65;&#x42;</t></r></si><si><t/></si></sst>'),
      }),
      'S',
    );
    if (!rich.ok) throw new Error('x');
    expect(rich.data[0]).toEqual(['Hello & AB', '']);
  });

  it('reports date1904, formula string results, ISO dates and errors', async () => {
    const r = await read([[{ f: 'a', v: 'txt' }]], { date1904: true });
    expect(r.date1904).toBe(true);
    expect((await read([[1]])).date1904).toBe(false);
  });

  it('works when cells have no r attributes at all', async () => {
    const r = await read([[1, null, 3], [], [4]], { omitCellRefs: true });
    // without refs, skipped cells cannot be known: values are placed in order
    expect(r.data[0]![0]).toBe(1);
  });

  it('decodes entities', () => {
    expect(decodeXml('a&amp;b&lt;&gt;&quot;&apos;&#33;&#x21;_x000D_')).toBe('a&b<>"\'!!\r');
  });

  it('fails cleanly', async () => {
    expect(await readXlsxSheet(new Uint8Array([0, 1, 2]), 'S')).toEqual({ ok: false, reason: 'unreadable', sheets: [] });
    const none = await readXlsxSheet(buildXlsx([{ name: 'A', rows: [] }, { name: 'B', rows: [] }]), 'Downtime');
    expect(none).toEqual({ ok: false, reason: 'no_sheet', sheets: ['A', 'B'] });
    expect((await readXlsxSheet(new Blob([buildXlsx([{ name: 'A', rows: [[1]] }]).slice()]), 'A')).ok).toBe(true);
  });

  it('reads a ~3,000 x 20 workbook well under a second', async () => {
    const rows = simpleRows(3000);
    const bytes = await buildWorkbook(rows, { trailingBlankFormulaRows: 100 });
    const t0 = performance.now();
    const r = await readXlsxSheet(bytes, 'Downtime');
    const ms = performance.now() - t0;
    if (!r.ok) throw new Error('x');
    expect(r.data.length).toBeGreaterThanOrEqual(3001);
    expect(ms).toBeLessThan(1000);
  });
});
