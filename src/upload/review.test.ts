import { beforeAll, describe, expect, it } from 'vitest';
import { buildWorkbook, simpleRows, type SheetRowSpec } from '../../tests/helpers/makeWorkbook';
import type { EventRow, Startup } from '../api/types';
import { ApiError } from '../api/types';
import { createMockApi } from '../api/mockApi';
import type { SyntheticDb } from '../mock/synthetic';
import { parseWorkbook, type ParsedFile } from './parseWorkbook';
import {
  buildPlan, buildReview, checkGroups, csvCell, csvText, decideAll, decisionsComplete, flagSummary, monthKey, monthLabel, reviewCsv,
  storedWarningsCsv, undecidedCount,
} from './review';
import { yearsToLoad } from './loadReview';
import { CHUNK_SIZE, runUpload, UploadStopped } from './uploadRunner';

let db: SyntheticDb;
let startup: Startup;
let stored: EventRow[];

beforeAll(() => {
  db = createMockApi().__db(); // includes the edited and voided rows the mock seeds
  startup = {
    lines: db.lines, areas: db.areas, equipment: db.equipment, equipment_areas: db.equipment_areas, aliases: db.aliases,
    classifications: db.classifications, reasons: db.reasons, settings: db.settings, years: [2026, 2025],
  };
  stored = db.events;
});

const sheetOf = (e: EventRow, over: Partial<SheetRowSpec> = {}): SheetRowSpec => ({
  line: e.line_id, area: e.area_id, code: e.code_raw, stop: e.stop_ts, start: e.start_ts, classification: e.classification,
  reason: e.reason_raw ?? '', description: e.description ?? '', freq: e.freq, criticality: e.criticality, failure: e.is_failure ? 'YES' : 'NO',
  date: e.event_date, ...over,
});

/** stored events that are unique in their file position (occurrence 1) and clean, from the middle of the data */
function sample(n: number, from = 3000): EventRow[] {
  const seen = new Map<string, number>();
  for (const e of stored) {
    const k = `${e.area_id}|${e.code_raw}|${e.stop_ts}|${e.start_ts}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return stored.slice(from).filter((e) => seen.get(`${e.area_id}|${e.code_raw}|${e.stop_ts}|${e.start_ts}`) === 1 && !e.edited && !e.is_void).slice(0, n);
}

async function parse(rows: SheetRowSpec[]): Promise<ParsedFile> {
  const r = await parseWorkbook(await buildWorkbook(rows));
  if (!r.ok) throw new Error(r.message);
  return r;
}

describe('review of an upload', () => {
  it('a file that holds only stored rows is all identical, whatever the spacing of codes and reasons', async () => {
    const some = sample(40);
    const parsed = await parse(some.map((e) => sheetOf(e)));
    const review = buildReview(parsed, startup, stored);
    expect(review.counts.rowsRead).toBe(40);
    expect(review.counts.identical).toBe(40);
    expect(review.counts.new).toBe(0);
    expect(review.counts.late).toBe(0);
    expect(review.counts.changed).toBe(0);
    const plan = buildPlan(review, {});
    expect(plan.willAdd).toBe(0);
  });

  it('new rows after the latest stored date are new, not late', async () => {
    const parsed = await parse(simpleRows(5, '2026-11-02'));
    const review = buildReview(parsed, startup, stored);
    expect(review.counts).toMatchObject({ new: 5, late: 0, identical: 0 });
    expect(decisionsComplete(review, {})).toBe(true);
    expect(buildPlan(review, {}).willAdd).toBe(5);
  });

  it('late rows need a decision before a plan can be made, and the decision decides what is sent', async () => {
    const rows = [...simpleRows(2, '2026-10-05', { description: 'late one' }), ...simpleRows(2, '2026-11-02', { code: '131.BC110' })];
    const parsed = await parse(rows);
    const review = buildReview(parsed, startup, stored);
    expect(review.counts).toMatchObject({ late: 2, new: 2 });
    expect(undecidedCount(review, {})).toBe(2);
    expect(() => buildPlan(review, {})).toThrow(/decision/);

    const [a, b] = review.late;
    const plan = buildPlan(review, { [a!.fingerprint]: 'add', [b!.fingerprint]: 'skip' });
    expect(plan.willAdd).toBe(3);
    expect(plan.skippedLate).toBe(1);
    expect(plan.rows).toHaveLength(3);
    expect(plan.rows.map((r) => r.fingerprint)).not.toContain(b!.fingerprint);
    expect(plan.summary).toEqual({ rows_read: 4, rows_skipped: 1 });
    const lateWarnings = plan.warnings.filter((w) => w.type === 'late_row');
    expect(lateWarnings.map((w) => w.resolution).sort()).toEqual(['added', 'skipped']);
    expect(lateWarnings.find((w) => w.resolution === 'added')!.event_id).toMatch(/^EV-[0-9a-f]{16}$/);
    // no sheet-only helper fields are sent
    expect(JSON.stringify(plan.rows)).not.toContain('sheet_duration_s');

    const addAll = buildPlan(review, decideAll(review, 'add'));
    expect(addAll.willAdd).toBe(4);
    const skipAll = buildPlan(review, decideAll(review, 'skip'));
    expect(skipAll.willAdd).toBe(2);
    expect(skipAll.rows).toHaveLength(2);
  });

  it('a stored row with different values is reported with both values and kept as stored', async () => {
    const [e] = sample(1);
    const parsed = await parse([sheetOf(e!, { reason: 'Something else', description: 'Edited in the workbook' })]);
    const review = buildReview(parsed, startup, stored);
    expect(review.counts).toMatchObject({ changed: 1, new: 0, identical: 0 });
    const ch = review.changed[0]!;
    expect(ch.storedEventId).toBe(e!.event_id);
    expect(ch.changes.map((c) => c.field).sort()).toEqual(['description', 'reason_raw']);
    const plan = buildPlan(review, {});
    expect(plan.willAdd).toBe(0);
    expect(plan.warnings.find((w) => w.type === 'changed_row')!.resolution).toBe('kept_stored');
  });

  it('a row corrected in the app is information, not a difference', async () => {
    const edited = stored.find((e) => e.edited && !e.is_void)!;
    const parsed = await parse([sheetOf(edited, { description: 'what the workbook still says' })]);
    const review = buildReview(parsed, startup, stored);
    expect(review.counts.changed).toBe(0);
    expect(review.counts.edited).toBe(1);
    expect(review.counts.identical).toBe(1);
    // when the edit history says only another field was edited, the difference is a real one
    const map = new Map([[edited.event_id, new Set(['start_ts'])]]);
    const again = buildReview(parsed, startup, stored, map);
    expect(again.counts.changed).toBe(1);
  });

  it('keeps every row: an unknown area, the wrong line and a blank classification are stored with flags', async () => {
    const rows = [
      ...simpleRows(2, '2026-11-02'),
      { ...simpleRows(1, '2026-11-04')[0]!, area: 'ZZ.9' },
      { ...simpleRows(1, '2026-11-05')[0]!, line: 'L.2' },
      { ...simpleRows(1, '2026-11-06')[0]!, classification: null as never },
    ];
    const parsed = await parse(rows);
    const review = buildReview(parsed, startup, stored);
    expect(review.counts.rowsRead).toBe(5);
    expect(review.counts.new).toBe(5);
    expect('rejects' in review).toBe(false);
    const plan = buildPlan(review, {});
    expect(plan.rows).toHaveLength(5);
    expect(plan.willAdd).toBe(5);
    expect(plan.summary).toEqual({ rows_read: 5, rows_skipped: 0 });
    const f = flagSummary(review, {});
    expect(f.flags.map((x) => [x.flag, x.count, x.blocking])).toEqual([
      ['missing_classification', 1, true], ['unknown_area', 1, true], ['line_mismatch', 1, false],
    ]);
    expect(f.blockedRows).toBe(2);
    expect(f.warningRows).toBe(1);
    expect(plan.flagged.total).toBe(3);
  });

  it('late months: one decision per month, per-row decisions only for months that already have stored rows', async () => {
    const june = simpleRows(3, '2026-03-04'); // no events are stored in March 2026? see below
    const parsed = await parse(june);
    const review = buildReview(parsed, startup, stored);
    const monthsStored = new Set(stored.filter((e) => !e.is_void).map((e) => e.event_date.slice(0, 7)));
    expect(monthsStored.has('2026-03')).toBe(true);
    expect(review.lateMonths).toEqual([]);
    expect(review.counts.late).toBe(3);

    // a month older than the first stored month is a late month
    const old = await parse(simpleRows(4, '2025-01-10'));
    const r2 = buildReview(old, startup, stored);
    expect(r2.counts).toMatchObject({ late: 0, lateMonths: 1, lateMonthRows: 4, new: 0 });
    expect(r2.lateMonths[0]).toMatchObject({ month: '2025-01', rows: 4 });
    expect(undecidedCount(r2, {})).toBe(1);
    expect(() => buildPlan(r2, {})).toThrow(/decision/);
    const add = buildPlan(r2, { [monthKey('2025-01')]: 'add' });
    expect(add.willAdd).toBe(4);
    expect(add.rows).toHaveLength(4);
    expect(add.warnings.find((w) => w.type === 'late_month')).toMatchObject({ resolution: 'added' });
    const skip = buildPlan(r2, { [monthKey('2025-01')]: 'skip' });
    expect(skip.willAdd).toBe(0);
    expect(skip.rows).toHaveLength(0);
    expect(skip.skippedLate).toBe(4);
    expect(skip.summary).toEqual({ rows_read: 4, rows_skipped: 4 });
    expect(skip.warnings.find((w) => w.type === 'late_month')).toMatchObject({ resolution: 'skipped' });
    expect(buildPlan(r2, decideAll(r2, 'add')).willAdd).toBe(4);
    expect(monthLabel('2025-01')).toBe('January 2025');
  });

  it('flags data problems on rows that will be added and drops them for skipped late rows', async () => {
    const rows = [
      { ...simpleRows(1, '2026-11-02')[0]!, code: '999.ZZ900', reason: '' },
      { ...simpleRows(1, '2026-10-06')[0]!, code: '999.ZZ901', reason: 'Unheard of' },
    ];
    const review = buildReview(await parse(rows), startup, stored);
    const types = checkGroups(review, {}).map((g) => g.type);
    expect(types).toEqual(expect.arrayContaining(['unknown_code', 'blank_reason', 'unlisted_reason']));
    const skipped = checkGroups(review, decideAll(review, 'skip'));
    expect(skipped.find((g) => g.type === 'unlisted_reason')).toBeUndefined();
    expect(skipped.find((g) => g.type === 'unknown_code')!.items).toHaveLength(1);
    const plan = buildPlan(review, decideAll(review, 'add'));
    const accepted = plan.warnings.filter((w) => w.resolution === 'accepted');
    expect(accepted.length).toBeGreaterThanOrEqual(3);
    expect(accepted.every((w) => /^EV-/.test(w.event_id ?? ''))).toBe(true);
  });

  it('a second look at the same file after it was uploaded finds nothing new', async () => {
    const parsed = await parse(simpleRows(6, '2026-11-02'));
    const first = buildReview(parsed, startup, stored);
    const added = first.diff.normalizedRows.map((r) => ({ ...stored[0]!, fingerprint: r.fingerprint, event_id: `EV-${r.fingerprint.slice(0, 16)}`, event_date: r.event_date, area_id: r.area_id, code_raw: r.code_raw, stop_ts: r.stop_ts, start_ts: r.start_ts, freq: r.freq, classification: r.classification as EventRow['classification'], criticality: r.criticality, is_failure: r.is_failure, reason_raw: r.reason_raw, description: r.description, line_id: r.line_id, edited: false, is_void: false }));
    const second = buildReview(parsed, startup, [...stored, ...added]);
    expect(second.counts).toMatchObject({ new: 0, late: 0, identical: 6, changed: 0 });
  });
});

describe('years to load', () => {
  it('goes from the first year of the file to the latest stored year', () => {
    expect(yearsToLoad({ dateFrom: '2025-12-20', dateTo: '2026-01-05' }, [2026, 2025])).toEqual([2025, 2026]);
    expect(yearsToLoad({ dateFrom: '2024-03-01', dateTo: '2024-03-31' }, [2026, 2025, 2024])).toEqual([2024, 2025, 2026]);
    expect(yearsToLoad({ dateFrom: '2027-01-01', dateTo: '2027-01-31' }, [2026])).toEqual([2027]);
    expect(yearsToLoad({ dateFrom: '', dateTo: '' }, [2026])).toEqual([]);
  });
});

describe('the downloadable list', () => {
  it('quotes cells and defuses formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(42)).toBe('42');
    expect(csvCell(undefined)).toBe('');
    expect(csvText([['a', 'b'], [1, '2']])).toBe('a,b\r\n1,2\r\n');
  });

  it('lists every warning with its sheet row and what happens to it', async () => {
    const rows = [
      ...simpleRows(1, '2026-10-05', { description: '=cmd()' }),
      { ...simpleRows(1, '2026-11-02')[0]!, code: '999.ZZ900' },
      { ...simpleRows(1, '2026-11-04')[0]!, area: 'ZZ.9' },
    ];
    const review = buildReview(await parse(rows), startup, stored);
    const csv = reviewCsv(review, decideAll(review, 'skip'));
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Sheet row,Kind,Type,What we found,What happens');
    expect(csv).toMatch(/^2,Warning,Late entries,.*,Skipped/m);
    expect(csv).toMatch(/^3,Warning,Equipment code not in the master list/m);
    expect(csv).toMatch(/^4,Warning,Area not in the master list,.*Added and flagged/m);
    const stored2 = storedWarningsCsv([{ warning_id: 'W1', batch_id: 'B', type: 'blank_reason', source_row: 9, detail: '=1+1', resolution: 'accepted', event_id: 'EV-1' }]);
    expect(stored2).toContain("'=1+1");
    expect(stored2).toContain('Added and flagged');
  });
});

describe('sending in chunks', () => {
  const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ source_row: i + 2 }) as never);
  const job = (n: number) => ({ fileName: 'f.xlsx', fileHash: 'h', rows: rowsOf(n), summary: { rows_read: n, rows_skipped: 1 }, warnings: [] });

  function fakeApi(opts: { failChunk?: { index: number; times: number }; rejectRow?: number } = {}) {
    const calls: string[] = [];
    const sizes: number[] = [];
    let failures = 0;
    let finishSummary: unknown;
    return {
      calls, sizes, finishSummary: () => finishSummary,
      api: {
        async uploadStart() { calls.push('start'); return { batch_id: 'B-1' }; },
        async uploadChunk(_t: string, _b: string, rows: { source_row: number }[]) {
          const index = sizes.length;
          if (opts.failChunk && index === opts.failChunk.index && failures < opts.failChunk.times) {
            failures++;
            calls.push('chunk-fail');
            throw new ApiError('Cannot reach the server.', 'network');
          }
          calls.push('chunk');
          sizes.push(rows.length);
          const rejected = rows.filter((r) => r.source_row === opts.rejectRow).map((r) => ({ source_row: r.source_row, reason: 'bad' }));
          return { added: rows.length - rejected.length, identical: 0, rejected };
        },
        async uploadFinish(_t: string, _b: string, summary: unknown) {
          calls.push('finish');
          finishSummary = summary;
          return { batch_id: 'B-1', uploaded_by: 'u', uploaded_at: '', rows_read: 0, rows_added: 0, rows_identical: 0, rows_skipped: 0, warning_count: 0, status: 'Completed' as const };
        },
      },
    };
  }

  it('sends chunks of about 300 rows, then finishes', async () => {
    const f = fakeApi();
    const seen: number[] = [];
    const out = await runUpload(f.api, 'tok', job(650), { retryDelaysMs: [0, 0], sleep: async () => {}, onProgress: (p) => seen.push(p.rowsSent) });
    expect(CHUNK_SIZE).toBe(300);
    expect(f.sizes).toEqual([300, 300, 50]);
    expect(f.calls).toEqual(['start', 'chunk', 'chunk', 'chunk', 'finish']);
    expect(out.progress.added).toBe(650);
    expect(seen.at(-1)).toBe(650);
  });

  it('tries a dropped chunk again and the upload carries on', async () => {
    const f = fakeApi({ failChunk: { index: 1, times: 2 } });
    await runUpload(f.api, 'tok', job(650), { retryDelaysMs: [0, 0, 0], sleep: async () => {} });
    expect(f.calls.filter((c) => c === 'chunk-fail')).toHaveLength(2);
    expect(f.sizes).toEqual([300, 300, 50]);
  });

  it('stops after the retries, and can be resumed without sending the first chunks again', async () => {
    const f = fakeApi({ failChunk: { index: 1, times: 99 } });
    let stopped: UploadStopped | undefined;
    try {
      await runUpload(f.api, 'tok', job(650), { retryDelaysMs: [0, 0], sleep: async () => {} });
    } catch (e) {
      stopped = e as UploadStopped;
    }
    expect(stopped).toBeInstanceOf(UploadStopped);
    expect(stopped!.message).toMatch(/Cannot reach/);
    expect(stopped!.progress).toMatchObject({ batchId: 'B-1', chunksDone: 1, rowsSent: 300 });
    const g = fakeApi();
    const out = await runUpload(g.api, 'tok', job(650), { resume: stopped!.progress, sleep: async () => {} });
    expect(g.calls).toEqual(['chunk', 'chunk', 'finish']); // no second start, no repeat of chunk 1
    expect(out.progress.rowsSent).toBe(650);
  });

  it('does not retry a refusal, and counts server rejects as skipped', async () => {
    const bad = {
      async uploadStart() { throw new ApiError('You do not have access to this.', 'forbidden', true); },
      async uploadChunk() { return { added: 0, identical: 0, rejected: [] }; },
      async uploadFinish() { throw new Error('unreachable'); },
    };
    let n = 0;
    await expect(runUpload({ ...bad, uploadStart: async () => { n++; throw new ApiError('no', 'forbidden', true); } } as never, 't', job(5), { sleep: async () => {} })).rejects.toBeInstanceOf(UploadStopped);
    expect(n).toBe(1);

    const f = fakeApi({ rejectRow: 4 });
    const out = await runUpload(f.api, 'tok', job(10), { sleep: async () => {} });
    expect(out.progress.rejected).toHaveLength(1);
    expect(f.finishSummary()).toEqual({ rows_read: 10, rows_skipped: 2 });
  });

  it('records a batch even when there is nothing to send', async () => {
    const f = fakeApi();
    await runUpload(f.api, 'tok', job(0), { sleep: async () => {} });
    expect(f.calls).toEqual(['start', 'finish']);
  });
});
