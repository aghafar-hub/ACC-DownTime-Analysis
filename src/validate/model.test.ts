import { describe, expect, it } from 'vitest';
import type { EventRow } from '../api/types';
import {
  applyValidateFilter, buildClassificationSuggester, buildValidation, capSelection, compareRecords, EMPTY_FILTER, filterCount, firstFixHint,
  flagCounts, planBulk, plainReason, recheckRecord, runBulk, storedProblems, BULK_CAP, OVERLAP_FLAG,
} from './model';

const ev = (id: string, area: string, stop: string, start: string, over: Partial<EventRow> = {}): EventRow => ({
  event_id: id, batch_id: 'B', event_date: stop.slice(0, 10), line_id: 'L.1', area_id: area, code_raw: '100.A1', is_area_level: false,
  stop_ts: `${stop}.000`, start_ts: `${start}.000`, duration_s: 0, freq: 1, classification: 'MEC', criticality: 'INC', is_failure: true,
  fingerprint: id, edited: false, is_void: false, created_at: '', ...over,
});

const DATA: EventRow[] = [
  ev('clean', 'K.1', '2026-03-01 08:00:00', '2026-03-01 09:00:00'),
  ev('nocls', 'K.1', '2026-03-02 08:00:00', '2026-03-02 10:00:00', { classification: '' as EventRow['classification'], flags: 'missing_classification,blank_reason' }),
  ev('code', 'K.2', '2026-04-05 08:00:00', '2026-04-05 08:30:00', { flags: 'unknown_code' }),
  ev('voided', 'K.2', '2026-04-06 08:00:00', '2026-04-06 08:30:00', { flags: 'unknown_code', is_void: true }),
  ev('o1', 'K.3', '2026-04-10 08:00:00', '2026-04-10 10:00:00'),
  ev('o2', 'K.3', '2026-04-10 09:00:00', '2026-04-10 11:00:00', { code_raw: 'N/A', reason_raw: 'Belt slip' }),
  ev('rev', 'K.3', '2026-04-11 08:00:00', '2026-04-11 07:00:00', { flags: 'end_before_start' }),
];

describe('buildValidation', () => {
  const l = buildValidation(DATA);
  it('lists stored flags and the derived overlap, never voided or clean records', () => {
    expect(l.records.map((r) => r.event.event_id).sort()).toEqual(['code', 'nocls', 'o1', 'o2', 'rev']);
    const o1 = l.records.find((r) => r.event.event_id === 'o1')!;
    expect(o1.problems).toEqual([OVERLAP_FLAG]);
    expect(o1.partners).toEqual(['o2']);
    expect(o1.blocking).toBe(false);
  });
  it('sorts blocking first, then newest stop first', () => {
    expect(l.records.map((r) => r.event.event_id)).toEqual(['rev', 'nocls', 'o2', 'o1', 'code']);
  });
  it('counts blocked, review and overlapping', () => {
    expect(l.summary.total).toBe(5);
    expect(l.summary.blocked.count).toBe(2);
    expect(l.summary.blocked.hours).toBeCloseTo(2, 5); // 'nocls' is 2 h; the restart-before-stop record counts 0 h
    expect(l.summary.review.count).toBe(3);
    expect(l.summary.overlapping).toBe(2);
    expect(l.summary.byFlag).toMatchObject({ missing_classification: 1, blank_reason: 1, end_before_start: 1, unknown_code: 1, overlap_in_area: 2 });
  });
  it('a blocked record does not take part in the overlap search', () => {
    const blockedPartner = ev('b', 'K.3', '2026-04-10 09:30:00', '2026-04-10 09:45:00', { flags: 'unknown_area' });
    const r = buildValidation([...DATA, blockedPartner]);
    expect(r.records.find((x) => x.event.event_id === 'o1')!.partners).toEqual(['o2']);
    expect(r.records.find((x) => x.event.event_id === 'b')!.partners).toEqual([]);
  });
  it('orders stored problems blocking first and drops repeats', () => {
    expect(storedProblems({ flags: 'blank_reason, unknown_code,missing_classification,unknown_code' })).toEqual(['missing_classification', 'unknown_code', 'blank_reason']);
    expect(storedProblems({})).toEqual([]);
  });
  it('compareRecords is a total order', () => {
    const [a, b] = l.records;
    expect(compareRecords(a, b)).toBeLessThan(0);
    expect(compareRecords(b, a)).toBeGreaterThan(0);
  });
});

describe('information flags (cause in another area)', () => {
  const cross = ev('cross', 'RM.1', '2026-05-01 08:00:00', '2026-05-01 10:00:00', { code_raw: '131.RE300', flags: 'code_not_in_area' });
  const both = ev('both', 'RM.1', '2026-05-02 08:00:00', '2026-05-02 09:00:00', { flags: 'code_not_in_area,blank_reason' });
  it('a record whose only flag is information is not a problem: not listed, not counted', () => {
    const l = buildValidation([...DATA, cross]);
    expect(l.records.map((r) => r.event.event_id)).not.toContain('cross');
    expect(l.summary.total).toBe(5);
    expect(l.summary.review.count).toBe(3);
    expect(l.summary.byFlag.code_not_in_area).toBeUndefined();
    expect(storedProblems(cross)).toEqual([]);
    expect(recheckRecord(DATA, cross)).toBeNull();
  });
  it('the information flag is dropped from a record that has a real problem too', () => {
    const l = buildValidation([both]);
    expect(l.records).toHaveLength(1);
    expect(l.records[0]!.problems).toEqual(['blank_reason']);
    expect(flagCounts(l.records).map((f) => f.flag)).toEqual(['blank_reason']);
    expect(l.summary.byFlag).toEqual({ blank_reason: 1 });
  });
});

describe('recheckRecord', () => {
  it('returns null once nothing is left to fix, and keeps an overlap that remains', () => {
    const fixed = { ...DATA[1], classification: 'PRO' as const, flags: 'blank_reason' };
    expect(recheckRecord(DATA, fixed)!.problems).toEqual(['blank_reason']);
    expect(recheckRecord(DATA, { ...fixed, flags: undefined })).toBeNull();
    const o2 = DATA.find((e) => e.event_id === 'o2')!;
    expect(recheckRecord(DATA, o2)!.partners).toEqual(['o1']);
    expect(recheckRecord(DATA, { ...o2, stop_ts: '2026-04-10 10:30:00.000', start_ts: '2026-04-10 11:00:00.000' })).toBeNull();
    expect(recheckRecord(DATA, { ...o2, is_void: true })).toBeNull();
  });
});

describe('filters', () => {
  const l = buildValidation(DATA);
  it('filters by problem (any of), area, month, blocking and text', () => {
    const ids = (f: Partial<typeof EMPTY_FILTER>) => applyValidateFilter(l.records, { ...EMPTY_FILTER, ...f }).map((r) => r.event.event_id).sort();
    expect(ids({})).toHaveLength(5);
    expect(ids({ flags: ['unknown_code'] })).toEqual(['code']);
    expect(ids({ flags: ['unknown_code', 'blank_reason'] })).toEqual(['code', 'nocls']);
    expect(ids({ flags: [OVERLAP_FLAG] })).toEqual(['o1', 'o2']);
    expect(ids({ area: 'K.3' })).toEqual(['o1', 'o2', 'rev']);
    expect(ids({ month: '2026-03' })).toEqual(['nocls']);
    expect(ids({ blockingOnly: true })).toEqual(['nocls', 'rev']);
    expect(ids({ q: 'belt' })).toEqual(['o2']);
    expect(ids({ q: ' N/A ' })).toEqual(['o2']);
    expect(ids({ area: 'K.3', flags: ['end_before_start'], blockingOnly: true })).toEqual(['rev']);
  });
  it('counts active filters', () => {
    expect(filterCount(EMPTY_FILTER)).toBe(0);
    expect(filterCount({ flags: ['a', 'b'], area: 'K.1', month: '', q: ' x ', blockingOnly: true })).toBe(5);
  });
  it('flagCounts lists the flags that occur in catalogue order with symbols decided by the blocking rule', () => {
    expect(flagCounts(l.records)).toEqual([
      { flag: 'missing_classification', count: 1, blocking: true },
      { flag: 'end_before_start', count: 1, blocking: true },
      { flag: 'unknown_code', count: 1, blocking: false },
      { flag: 'blank_reason', count: 1, blocking: false },
      { flag: 'overlap_in_area', count: 2, blocking: false },
    ]);
  });
  it('gives the fix text of the first problem', () => {
    expect(firstFixHint(l.records[0])).toMatch(/Correct the stop or restart time/);
  });
});

describe('classification suggestion', () => {
  const rows = [
    ev('1', 'K.1', '2026-03-01 08:00:00', '2026-03-01 09:00:00', { classification: 'MEC', code_raw: '100.a1' }),
    ev('2', 'K.1', '2026-03-02 08:00:00', '2026-03-02 09:00:00', { classification: 'MEC' }),
    ev('3', 'K.1', '2026-03-03 08:00:00', '2026-03-03 09:00:00', { classification: 'ELE' }),
    ev('4', 'K.2', '2026-03-03 08:00:00', '2026-03-03 09:00:00', { classification: 'AUT' }),
    ev('5', 'K.1', '2026-03-04 08:00:00', '2026-03-04 09:00:00', { classification: 'PRO', is_void: true }),
    ev('6', 'K.1', '2026-03-05 08:00:00', '2026-03-05 09:00:00', { classification: 'PRO', flags: 'unknown_area' }),
  ];
  const s = buildClassificationSuggester(rows);
  it('proposes the most common classification for the same area and code', () => {
    expect(s('K.1', '100.A1')).toEqual({ code: 'MEC', count: 2 });
    expect(s('K.2', '100.A1')).toEqual({ code: 'AUT', count: 1 });
  });
  it('has nothing for an unknown pair or an empty code, and ignores voided and blocked records', () => {
    expect(s('K.9', '100.A1')).toBeNull();
    expect(s('K.1', '')).toBeNull();
    expect(s('K.1', '200.B2')).toBeNull();
  });
});

describe('bulk planner', () => {
  it('needs a field and a note, and leaves empty fields alone', () => {
    expect(planBulk({}, 'x')).toEqual({ ok: false, error: 'Choose at least one thing to set.' });
    expect(planBulk({ classification: 'pro' }, '  ')).toMatchObject({ ok: false });
    const p = planBulk({ classification: 'pro', area_id: ' ', code_raw: 'N/A', reason_raw: '', line_id: 'L.2' }, 'Checked');
    expect(p).toEqual({ ok: true, changes: { classification: 'PRO', line_id: 'L.2', code_raw: 'N/A' }, fields: ['classification', 'line_id', 'code_raw'] });
  });
  it('caps a run at 200 records', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `e${i}`);
    const c = capSelection(ids);
    expect(c.ids).toHaveLength(BULK_CAP);
    expect(c.capped).toBe(true);
    expect(capSelection(ids.slice(0, 5))).toEqual({ ids: ids.slice(0, 5), capped: false });
  });
  it('translates server messages', () => {
    expect(plainReason('Nothing was changed.')).toMatch(/already has these values/);
    expect(plainReason('Area "X" is not in the list of areas.')).toBe('Area "X" is not in the list of areas.');
    expect(plainReason('')).toMatch(/refused/);
  });
  it('runs every record, reports progress and never stops at the first failure', async () => {
    const seen: string[] = [];
    const progress: number[] = [];
    const res = await runBulk(
      ['a', 'b', 'c', 'd'],
      async (id) => {
        seen.push(id);
        if (id === 'b') throw new Error('Nothing was changed.');
        if (id === 'c') throw new Error('Classification must be one of PRO, MEC.');
      },
      (i) => progress.push(i),
    );
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
    expect(progress).toEqual([0, 1, 2, 3]);
    expect(res.done).toEqual(['a', 'd']);
    expect(res.failed).toEqual([
      { id: 'b', reason: expect.stringMatching(/already has these values/) },
      { id: 'c', reason: 'Classification must be one of PRO, MEC.' },
    ]);
  });
});
