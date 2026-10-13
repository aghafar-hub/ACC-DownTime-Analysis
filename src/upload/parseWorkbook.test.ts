import { afterAll, describe, expect, it } from 'vitest';
import { buildXlsx, serialOf } from '../../tests/helpers/xlsxWriter';
import { buildWorkbook, simpleRows, type SheetRowSpec } from '../../tests/helpers/makeWorkbook';
import { criticalityConflict, extractRows, parseWorkbook, parseSheetArrays, readDate, readTimestamp, type ParsedFile, type RefusedFile } from './parseWorkbook';

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const ok = (r: Awaited<ReturnType<typeof parseWorkbook>>): ParsedFile => {
  if (!r.ok) throw new Error(`expected a good file but got: ${r.message}`);
  return r;
};
const refused = (r: Awaited<ReturnType<typeof parseWorkbook>>): RefusedFile => {
  if (r.ok) throw new Error('expected the file to be refused');
  return r;
};

describe('parseWorkbook: cached formula values', () => {
  it('reads values exactly as typed, skips trailing formula-only rows, keeps sheet row numbers', async () => {
    const rows: SheetRowSpec[] = [
      { line: 'L.1', area: 'K.1', code: '131.BC100', stop: '2026-03-15 13:45:10.000', start: '2026-03-15 14:15:40.000', classification: 'MEC', reason: 'Belt torn', description: 'Found on round', freq: 1, failure: 'YES' },
      { line: 'L.1', area: 'K.1', code: '131.BC100', stop: '2026-03-15 14:15:40.000', start: '2026-03-15 15:00:00.000', classification: 'CIR', reason: 'Spare part delay', freq: 0, failure: 'NO', criticality: 'NO_INC' },
      { line: 'L.2', area: 'RM.2', code: 'N/A', stop: '2026-03-16 00:00:00.000', start: '2026-03-16 00:10:00.000', classification: 'PL', criticality: 'NO_INC', failure: 'NO', reason: ' Planned shutdown' },
    ];
    const bytes = await buildWorkbook(rows, { trailingBlankFormulaRows: 200, otherSheets: ['Notes'] });
    const r = ok(await parseWorkbook(bytes));
    expect(r.rowsRead).toBe(3);
    expect(r.blankRows).toBe(200);
    expect(r.rows).toHaveLength(3);
    const [a, b, c] = r.rows;
    expect(a).toMatchObject({
      source_row: 2, event_date: '2026-03-15', freq: 1, line_id: 'L.1', area_id: 'K.1', code_raw: '131.BC100',
      stop_ts: '2026-03-15 13:45:10.000', start_ts: '2026-03-15 14:15:40.000', classification: 'MEC', criticality: 'INC',
      is_failure: true, reason_raw: 'Belt torn', description: 'Found on round',
    });
    expect(a!.sheet_duration_s).toBe(1830);
    expect(b).toMatchObject({ source_row: 3, freq: 0, is_failure: false, criticality: 'NO_INC', classification: 'CIR' });
    expect(c).toMatchObject({ source_row: 4, code_raw: 'N/A', reason_raw: 'Planned shutdown', description: undefined });
    expect(new Set(r.rows.map((x) => x.fingerprint)).size).toBe(3);
    expect(r.rows.every((x) => /^[0-9a-f]{64}$/.test(x.fingerprint))).toBe(true);
    expect(r.dateFrom).toBe('2026-03-15');
    expect(r.dateTo).toBe('2026-03-16');
  });

  it('never returns formula text', async () => {
    const bytes = await buildWorkbook(simpleRows(3), { trailingBlankFormulaRows: 5 });
    const r = ok(await parseWorkbook(bytes));
    const everything = JSON.stringify(r);
    expect(everything).not.toMatch(/IF\(|INT\(|HOUR\(/);
  });

  it('matches headings ignoring case and spaces, and finds the heading row below blank rows', async () => {
    const bytes = await buildWorkbook(simpleRows(2), {
      renameHeaders: { Freq: '  freq ', 'EQUIPMENT CODE': 'equipment   code', 'STOPPAGE CLASIFICATION': 'Stoppage Classification', DATE: 'date' },
      blankRowsAbove: 3,
    });
    const r = ok(await parseWorkbook(bytes));
    expect(r.rows.map((x) => x.source_row)).toEqual([5, 6]);
  });

  it('gives duplicate rows different occurrences, so different fingerprints', async () => {
    const one = simpleRows(1)[0]!;
    const r = ok(await parseWorkbook(await buildWorkbook([one, { ...one }, { ...one, code: ' 131.bc100 ' }])));
    expect(new Set(r.rows.map((x) => x.fingerprint)).size).toBe(3);
  });

  it('reads times written as text', async () => {
    const r = ok(await parseWorkbook(await buildWorkbook(simpleRows(2), { timesAsText: true })));
    expect(r.rows[0]!.stop_ts).toBe('2026-11-01 08:10:05.000');
  });

  it('upper-cases the classification and reports it', async () => {
    const r = ok(await parseWorkbook(await buildWorkbook(simpleRows(2, '2026-11-01', { classification: 'Aut' }))));
    expect(r.rows.every((x) => x.classification === 'AUT')).toBe(true);
    expect(r.caseFixes).toEqual([{ source_row: 2, from: 'Aut', to: 'AUT' }, { source_row: 3, from: 'Aut', to: 'AUT' }]);
  });

  it('keeps every row: blank code, classification, area and line are stored as blanks, other classification text upper-cased', async () => {
    const rows = simpleRows(5);
    const bytes = await buildWorkbook(rows, {
      overrides: [
        [0, 'EQUIPMENT CODE', null], [0, 'STOPPAGE CLASIFICATION', null], [0, 'REASON', null],
        [1, 'EQUIPMENT', null], [1, 'Line', null],
        [2, 'STOPPAGE CLASIFICATION', 'xyz'],
        [3, 'STOPPAGE CLASIFICATION', ' mec '],
      ],
    });
    const r = ok(await parseWorkbook(bytes));
    expect(r.rowsRead).toBe(5);
    expect(r.rows.map((x) => x.source_row)).toEqual([2, 3, 4, 5, 6]);
    expect(r.rows[0]).toMatchObject({ code_raw: '', classification: '' });
    expect(r.rows[0]!.reason_raw).toBeUndefined();
    expect(r.rows[1]).toMatchObject({ area_id: '', line_id: '' });
    expect(r.rows[2]!.classification).toBe('XYZ');
    expect(r.rows[3]!.classification).toBe('MEC');
    expect(r.caseFixes).toEqual([{ source_row: 5, from: 'mec', to: 'MEC' }]);
    expect(new Set(r.rows.map((x) => x.fingerprint)).size).toBe(5);
    expect('rejected' in r).toBe(false);
  });

  describe('CRITICALITY written differently', () => {
    const INC = ['INC', 'incident', 'Incidents', 'Incidental', 'Incidential', ' INCIDENTIALS ', 'inc'];
    const NO_INC = ['NO_INC', 'no inc', 'NOINC', 'non-inc', 'NONINC', 'not inc', 'NO_INCIDENT', 'No Incidental', 'no-incidential', 'Non Incidental', 'NON_INCIDENTIAL'];
    it.each(INC)('reads %j as INC', async (v) => {
      const r = ok(await parseWorkbook(await buildWorkbook(simpleRows(1), { overrides: [[0, 'CRITICALITY', v]] })));
      expect(r.rows[0]!.criticality).toBe('INC');
    });
    it.each(NO_INC)('reads %j as NO_INC', async (v) => {
      const r = ok(await parseWorkbook(await buildWorkbook(simpleRows(1), { overrides: [[0, 'CRITICALITY', v]] })));
      expect(r.rows[0]!.criticality).toBe('NO_INC');
    });
    it.each(['HIGH', 'INCI', 'NO', 'INC INC'])('still refuses %j with the row number', async (v) => {
      const r = refused(await parseWorkbook(await buildWorkbook(simpleRows(2), { overrides: [[1, 'CRITICALITY', v]] })));
      expect(r.problems.find((x) => x.code === 'bad_value')!.rows).toEqual([3]);
      expect(r.message).toMatch(/CRITICALITY must be INC or NO_INC, but row 3/);
    });
    it('records only rows that are not exactly INC / NO_INC (case and surrounding spaces ignored), keeps every row and the stored value', async () => {
      const rows = simpleRows(5, '2026-11-01', { classification: 'MEC' });
      const r = ok(await parseWorkbook(await buildWorkbook(rows, {
        overrides: [[0, 'CRITICALITY', 'Incidential'], [1, 'CRITICALITY', ' inc '], [2, 'CRITICALITY', 'No inc'], [3, 'CRITICALITY', 'no_inc'], [4, 'CRITICALITY', 'Non-Incidental']],
      })));
      expect(r.rows).toHaveLength(5);
      expect(r.rows.map((x) => x.criticality)).toEqual(['INC', 'INC', 'NO_INC', 'NO_INC', 'NO_INC']);
      expect(r.valueFixes).toEqual([
        { source_row: 2, column: 'CRITICALITY', from: 'Incidential', to: 'INC' },
        { source_row: 4, column: 'CRITICALITY', from: 'No inc', to: 'NO_INC' },
        { source_row: 6, column: 'CRITICALITY', from: 'Non-Incidental', to: 'NO_INC' },
      ]);
      expect(r.caseFixes).toEqual([]);
    });
    it('has no valueFixes for a normal sheet', async () => {
      expect(ok(await parseWorkbook(await buildWorkbook(simpleRows(2)))).valueFixes).toEqual([]);
    });
    it('marks a read value that disagrees with the sheet rule', () => {
      expect(criticalityConflict('MEC', 'INC')).toBe(false);
      expect(criticalityConflict('CIR', 'INC')).toBe(true);
      expect(criticalityConflict('cir', 'NO_INC')).toBe(false);
      expect(criticalityConflict('PL', 'INC')).toBe(true);
      expect(criticalityConflict('MEC', 'NO_INC')).toBe(true);
      expect(criticalityConflict('PL', 'NO_INC')).toBe(false);
    });
  });

  it('refuses the whole file, listing the rows, only for values that cannot be stored', async () => {
    const bytes = await buildWorkbook(simpleRows(5), {
      overrides: [[0, 'Failure', 'MAYBE'], [1, 'CRITICALITY', 'HIGH'], [2, 'Freq', 7]],
    });
    const r = refused(await parseWorkbook(bytes));
    const p = r.problems.find((x) => x.code === 'bad_value')!;
    expect(p.rows).toEqual([2, 3, 4]);
    expect(p.message).toMatch(/Fix them in Excel and choose the file again/);
    expect(p.message).toMatch(/YES or NO/);
  });
});

describe('parseWorkbook: time zones and daylight saving', () => {
  // rows around the clock changes of Cairo (2026-04-24 00:00 -> 01:00, 2026-10-30 24:00 -> 23:00),
  // Los Angeles (2026-03-08 02:00 -> 03:00, 2026-11-01 02:00 -> 01:00) and plain whole seconds all year
  const tricky = [
    '2026-03-08 01:59:59.000', '2026-03-08 02:00:00.000', '2026-03-08 02:30:00.000', '2026-03-08 03:00:00.000',
    '2026-04-24 00:00:00.000', '2026-04-24 00:30:15.000', '2026-04-24 01:00:00.000', '2026-04-23 23:59:59.000',
    '2026-10-29 23:30:00.000', '2026-10-30 00:15:00.000', '2026-10-30 23:59:59.000',
    '2026-11-01 00:59:59.000', '2026-11-01 01:00:00.000', '2026-11-01 01:30:00.000', '2026-11-01 02:00:00.000',
    '2026-12-31 23:59:59.000', '2026-01-01 00:00:00.000',
  ];
  const specs: SheetRowSpec[] = tricky.map((s, i) => {
    const stopMs = Date.parse(`${s.replace(' ', 'T')}Z`);
    const start = new Date(stopMs + (600 + i * 7) * 1000).toISOString().replace('T', ' ').replace('Z', '');
    return { line: 'L.1', area: 'K.1', code: `131.BC${100 + i}`, stop: s, start, classification: 'MEC', reason: 'Belt torn' };
  });
  // a spread of other times: every 13 min 7 s through 2026, to catch floating-point flooring
  const spread: SheetRowSpec[] = [];
  for (let ms = Date.parse('2026-01-01T00:00:00Z'), i = 0; i < 400; ms += (13 * 60 + 7) * 1000 * 37, i++) {
    const stop = new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
    const start = new Date(ms + 3_661_000).toISOString().replace('T', ' ').replace('Z', '');
    spread.push({ line: 'L.2', area: 'RM.2', code: `221.FN${i}`, stop, start, classification: 'ELE', reason: 'Cable fault' });
  }
  const all = [...specs, ...spread];

  for (const tz of ['UTC', 'Africa/Cairo', 'America/Los_Angeles', 'Pacific/Auckland']) {
    it(`gives the exact typed numbers with the browser in ${tz}`, async () => {
      process.env.TZ = tz;
      if (tz !== 'UTC') {
        // the zone must really be in force, or this test proves nothing
        const winter = new Date('2026-01-15T12:00:00Z').getTimezoneOffset();
        expect(winter).not.toBe(0);
      }
      const bytes = await buildWorkbook(all);
      const r = ok(await parseWorkbook(bytes));
      expect(r.rows).toHaveLength(all.length);
      r.rows.forEach((row, i) => {
        expect(row.stop_ts, `row ${row.source_row} stop`).toBe(all[i]!.stop);
        expect(row.start_ts, `row ${row.source_row} start`).toBe(all[i]!.start);
        expect(row.event_date).toBe(all[i]!.stop.slice(0, 10));
      });
    });
  }

  it('reads a Date made in any zone with its UTC parts', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(readTimestamp(new Date(Date.UTC(2026, 2, 8, 2, 30, 0, 0)))).toBe('2026-03-08 02:30:00.000');
    expect(readTimestamp(new Date(Date.UTC(2026, 10, 1, 1, 30, 0, 0)))).toBe('2026-11-01 01:30:00.000');
    expect(readTimestamp(new Date(Date.UTC(2026, 2, 8, 2, 29, 59, 999)))).toBe('2026-03-08 02:29:59.999');
    expect(readDate(new Date(Date.UTC(2026, 2, 8, 0, 0, 0, 0)))).toBe('2026-03-08');
    process.env.TZ = 'Africa/Cairo';
    expect(readTimestamp(new Date(Date.UTC(2026, 3, 24, 0, 30, 0, 0)))).toBe('2026-04-24 00:30:00.000');
  });

  it('reads plain serial numbers and ISO text', () => {
    expect(readTimestamp(46_000.5)).toBe('2025-12-09 12:00:00.000');
    expect(readTimestamp('2026-03-15 13:45:10')).toBe('2026-03-15 13:45:10.000');
    expect(readTimestamp('2026-03-15T13:45:10.5')).toBe('2026-03-15 13:45:10.500');
    expect(readTimestamp('2026-02-31 10:00:00')).toBeNull();
    expect(readTimestamp('13:45')).toBeNull();
    expect(readTimestamp('abc')).toBeNull();
    expect(readDate('2026-03-15')).toBe('2026-03-15');
    expect(readDate(46_000.9)).toBe('2025-12-09');
  });
});

describe('parseWorkbook: files that are refused', () => {
  it('a workbook without the Downtime sheet', async () => {
    const r = refused(await parseWorkbook(await buildWorkbook(simpleRows(2), { sheetName: 'Sheet1', otherSheets: ['Notes'] })));
    expect(r.problems[0]!.code).toBe('no_sheet');
    expect(r.message).toMatch(/no sheet called "Downtime"/);
    expect(r.message).toMatch(/Notes, Sheet1/);
  });

  it('a sheet called downtime in other letters is accepted', async () => {
    const r = ok(await parseWorkbook(await buildWorkbook(simpleRows(2), { sheetName: 'downtime' })));
    expect(r.rows).toHaveLength(2);
  });

  it('a missing column', async () => {
    const r = refused(await parseWorkbook(await buildWorkbook(simpleRows(2), { dropHeaders: ['Failure', 'Freq'] })));
    expect(r.problems[0]!.code).toBe('missing_columns');
    expect(r.message).toMatch(/Freq, Failure/);
  });

  it('formulas saved without their results', async () => {
    const r = refused(await parseWorkbook(await buildWorkbook(simpleRows(3), { noCachedValues: true })));
    expect(r.problems[0]!.code).toBe('empty_cached');
    expect(r.message).toMatch(/Open the file in Excel, save it/);
    expect(r.message).toMatch(/Freq/);
    expect(r.message).toMatch(/row 2, 3, 4/);
  });

  it('an empty Freq result on a row that has data', async () => {
    const rows = simpleRows(3);
    rows[1]!.freq = null;
    const r = refused(await parseWorkbook(await buildWorkbook(rows)));
    expect(r.problems[0]!.code).toBe('empty_cached');
    expect(r.problems[0]!.rows).toEqual([3]);
  });

  it('empty CRITICALITY or Failure results', async () => {
    const rows = simpleRows(2);
    rows[0]!.criticality = null;
    rows[1]!.failure = null;
    const r = refused(await parseWorkbook(await buildWorkbook(rows)));
    expect(r.problems[0]!.code).toBe('empty_cached');
    expect(r.problems[0]!.rows).toEqual([2, 3]);
    expect(r.message).toMatch(/CRITICALITY, Failure/);
  });

  it('a time that cannot be read lists the first rows', async () => {
    const bytes = await buildWorkbook(simpleRows(9), {
      overrides: [[0, 'Stop Time', 'tomorrow'], [1, 'Start Time', 'n/a'], [2, 'Stop Time', 'x'], [3, 'Stop Time', 'x'], [4, 'Stop Time', 'x'], [5, 'Stop Time', 'x'], [6, 'Stop Time', 'x'], [7, 'Stop Time', 'x']],
    });
    const r = refused(await parseWorkbook(bytes));
    const p = r.problems.find((x) => x.code === 'bad_time')!;
    expect(p.rows).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(p.message).toMatch(/row 2, 3, 4, 5, 6, 7 and 2 more/);
  });

  it('a date that cannot be read', async () => {
    const r = refused(await parseWorkbook(await buildWorkbook(simpleRows(3), { overrides: [[1, 'DATE', 'soon']] })));
    expect(r.problems.some((p) => p.code === 'bad_date' && p.rows?.[0] === 3)).toBe(true);
  });

  it('a sheet with headings but no rows', async () => {
    const r = refused(await parseWorkbook(await buildWorkbook([], { trailingBlankFormulaRows: 20 })));
    expect(r.problems[0]!.code).toBe('no_rows');
  });

  it('a file that is not a workbook', async () => {
    const r = refused(await parseWorkbook(new TextEncoder().encode('a,b,c\n1,2,3\n')));
    expect(r.problems[0]!.code).toBe('unreadable');
    expect(r.message).toMatch(/\.xlsx/);
  });

  it('headings that are not the right ones', () => {
    const r = extractRows([['a', 'b', 'c'], [1, 2, 3]]);
    expect(r.problems[0]!.code).toBe('no_headings');
  });
});

describe('parseSheetArrays', () => {
  it('works on plain arrays', async () => {
    const head = ['DATE', 'Freq', 'Line', 'EQUIPMENT', 'EQUIPMENT CODE', 'Stop Time', 'Start Time', 'STOPPAGE CLASIFICATION', 'CRITICALITY', 'REASON', 'Failure'];
    const r = await parseSheetArrays([
      head,
      [new Date(Date.UTC(2026, 0, 5)), 1, 'L.1', 'K.1', '131.BC100', new Date(Date.UTC(2026, 0, 5, 1, 2, 3)), new Date(Date.UTC(2026, 0, 5, 2, 0, 0)), 'mec', 'INC', 'x', 'YES'],
      [null, '', null, null, null, null, null, null, '', null, ''],
    ]);
    const f = ok(r);
    expect(f.rows).toHaveLength(1);
    expect(f.blankRows).toBe(1);
    expect(f.rows[0]!.classification).toBe('MEC');
  });
});

describe('parseWorkbook: exact cached values and milliseconds', () => {
  it('reads Freq = 0 (a cached zero) as 0, never as missing', async () => {
    const rows = simpleRows(10).map((x, i) => ({ ...x, freq: (i % 3 === 0 ? 0 : 1) as 0 | 1 }));
    const r = ok(await parseWorkbook(await buildWorkbook(rows, { trailingBlankFormulaRows: 20 })));
    expect(r.rows.map((x) => x.freq)).toEqual(rows.map((x) => x.freq));
    expect(r.rows.filter((x) => x.freq === 0).length).toBe(4);
  });

  it('reads millisecond digits exactly', async () => {
    const stops = ['2026-08-05 08:10:11.110', '2026-08-05 09:10:08.157', '2026-08-05 10:10:00.203', '2026-08-05 11:10:59.999', '2026-08-05 12:10:00.001', '2026-08-05 23:59:59.999'];
    const rows: SheetRowSpec[] = stops.map((stop, i) => ({
      line: 'L.1', area: 'K.1', code: `C${i}`, stop, start: stop.replace(/ (\d\d):(\d\d):/, (_m, h: string) => ` ${h}:30:`), classification: 'MEC',
    }));
    const r = ok(await parseWorkbook(await buildWorkbook(rows)));
    expect(r.rows.map((x) => x.stop_ts)).toEqual(rows.map((x) => x.stop));
    expect(r.rows.map((x) => x.start_ts)).toEqual(rows.map((x) => x.start));
  });

  it('the same event stored with serials differing in the last bits gives the same timestamps and fingerprint', async () => {
    const rows = simpleRows(30).map((x, i) => ({ ...x, stop: x.stop.replace('.000', `.${String(100 + i * 29).padStart(3, '0')}`), start: x.start.replace('.000', `.${String(157 + i * 11).padStart(3, '0')}`) }));
    const base = ok(await parseWorkbook(await buildWorkbook(rows)));
    for (const ulps of [-3, -1, 1, 2, 4]) {
      const r = ok(await parseWorkbook(await buildWorkbook(rows, { serialUlps: ulps })));
      expect(r.rows.map((x) => x.stop_ts)).toEqual(base.rows.map((x) => x.stop_ts));
      expect(r.rows.map((x) => x.start_ts)).toEqual(base.rows.map((x) => x.start_ts));
      expect(r.rows.map((x) => x.fingerprint)).toEqual(base.rows.map((x) => x.fingerprint));
    }
  });

  it('rounds real-looking serials to the nearest millisecond (just below and just above)', () => {
    expect(readTimestamp(46239.070267476854)).toBe('2026-08-05 01:41:11.110');
    // generated from typed stamps; every one must come back exactly, including nudged doubles
    let checked = 0;
    for (let k = 0; k < 2000; k++) {
      const ms = Date.UTC(2026, 0, 1) + k * 3_456_789 + (k * 37) % 1000;
      const typed = new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
      for (const ulps of [-2, -1, 0, 1, 2]) {
        expect(readTimestamp(serialOf(ms, { ulps }))).toBe(typed);
        checked++;
      }
    }
    expect(checked).toBe(10_000);
    // a value whose product lands just under a millisecond boundary and one just over
    const half = 0.45 / 86_400_000;
    expect(readTimestamp(46235 + 0.25 - half)).toBe('2026-08-01 06:00:00.000');
    expect(readTimestamp(46235 + 0.25 + half)).toBe('2026-08-01 06:00:00.000');
    expect(readTimestamp(46235 + 0.25 + 0.55 / 86_400_000)).toBe('2026-08-01 06:00:00.001');
  });

  it('handles shared strings with entities and leading spaces', async () => {
    const rows = simpleRows(2, '2026-11-01', { reason: '  Belt & roller <A> "x"', description: ' it\'s \u00e9\u0627' });
    for (const strings of ['shared', 'inline'] as const) {
      const r = ok(await parseWorkbook(await buildWorkbook(rows, { strings })));
      expect(r.rows[0]!.reason_raw).toBe('Belt & roller <A> "x"'); // trimmed by the parser
      expect(r.rows[0]!.description).toBe("it's \u00e9\u0627");
    }
  });

  it('finds the Downtime sheet when it is not first and not named sheet1.xml', async () => {
    const r = ok(await parseWorkbook(await buildWorkbook(simpleRows(3), { otherSheets: ['Notes', 'Lists'], oddSheetPaths: true })));
    expect(r.rows).toHaveLength(3);
    const r2 = ok(await parseWorkbook(await buildWorkbook(simpleRows(3), { otherSheets: ['Notes'], otherSheetsAfter: true })));
    expect(r2.rows).toHaveLength(3);
  });

  it('reads the 1904 date system, adding 1462 days only to DATE, Stop Time and Start Time', async () => {
    const rows = simpleRows(3).map((x, i) => ({ ...x, freq: (i === 1 ? 0 : 1) as 0 | 1, stop: x.stop.replace('.000', '.157') }));
    const r = ok(await parseWorkbook(await buildWorkbook(rows, { date1904: true })));
    expect(r.rows.map((x) => x.stop_ts)).toEqual(rows.map((x) => x.stop));
    expect(r.rows.map((x) => x.start_ts)).toEqual(rows.map((x) => x.start));
    expect(r.rows.map((x) => x.event_date)).toEqual(rows.map((x) => x.stop.slice(0, 10)));
    expect(r.rows.map((x) => x.freq)).toEqual([1, 0, 1]);
    expect(r.rows[0]!.sheet_duration_s).toBeGreaterThan(0);
    expect(readTimestamp(44773.5, true)).toBe(readTimestamp(46235.5));
  });

  it('refuses a zip that is not an xlsx, and a workbook with other sheets only', async () => {
    const zip = buildXlsx([{ name: 'Downtime', rows: [] }]);
    // an ordinary zip without workbook.xml
    const { zipSync, strToU8 } = await import('fflate');
    const plain = zipSync({ 'a.txt': strToU8('hello') });
    expect(refused(await parseWorkbook(plain)).problems[0]!.code).toBe('unreadable');
    expect(refused(await parseWorkbook(new Uint8Array([1, 2, 3, 4]))).problems[0]!.code).toBe('unreadable');
    expect(zip.length).toBeGreaterThan(0);
    const r = refused(await parseWorkbook(await buildWorkbook(simpleRows(1), { sheetName: 'Data', otherSheets: ['Notes'] })));
    expect(r.problems[0]!.code).toBe('no_sheet');
    expect(r.message).toMatch(/Notes, Data/);
  });
});
