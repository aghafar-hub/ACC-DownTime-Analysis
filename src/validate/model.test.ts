import { describe, expect, it } from 'vitest';
import type { EventRow } from '../api/types';
import {
  applyKeptFilter, keepChoices, keepConsequence, keepConsequenceMany, keepSetFor, plainKeepReason, undoSetFor,
  applyValidateFilter, buildClassificationSuggester, buildValidation, capSelection, compareRecords, EMPTY_FILTER, filterCount, filterFromParams, firstFixHint,
  flagCounts, planBulk, plainReason, recheckRecord, runBulk, storedProblems, BULK_CAP, MISMATCH_FLAG, OVERLAP_FLAG,
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

describe('kept as entered', () => {
  const KEPT: EventRow[] = [
    ev('w', 'K.1', '2026-05-01 08:00:00', '2026-05-01 09:00:00', { flags: 'unknown_code', accepted_flags: 'unknown_code', accepted_by: 'U1', accepted_at: '2026-06-01 10:00:00.000' }),
    ev('b', 'K.1', '2026-05-02 08:00:00', '2026-05-02 10:00:00', { flags: 'missing_classification', accepted_flags: 'missing_classification', accepted_at: '2026-06-02 10:00:00.000' }),
    ev('half', 'K.1', '2026-05-03 08:00:00', '2026-05-03 08:30:00', { flags: 'unknown_code,blank_reason', accepted_flags: 'unknown_code', accepted_at: '2026-06-03 10:00:00.000' }),
    ev('mixed', 'K.2', '2026-05-04 08:00:00', '2026-05-04 09:00:00', { flags: 'missing_classification,unknown_code', accepted_flags: 'missing_classification' }),
    ev('open', 'K.2', '2026-05-05 08:00:00', '2026-05-05 08:30:00', { flags: 'blank_reason' }),
    ev('vk', 'K.2', '2026-05-06 08:00:00', '2026-05-06 08:30:00', { flags: 'unknown_code', accepted_flags: 'unknown_code', is_void: true }),
  ];
  const l = buildValidation(KEPT);
  it('records with only kept problems leave the open list; partly kept ones stay with their open problems', () => {
    expect(l.records.map((r) => r.event.event_id).sort()).toEqual(['half', 'mixed', 'open']);
    const half = l.records.find((r) => r.event.event_id === 'half')!;
    expect(half.problems).toEqual(['blank_reason']);
    expect(half.kept).toEqual(['unknown_code']);
    const mixed = l.records.find((r) => r.event.event_id === 'mixed')!;
    expect(mixed.problems).toEqual(['unknown_code']);
    expect(mixed.blocking).toBe(false); // its blocking problem was kept: nothing blocking is left to fix
  });
  it('lists every kept record (not voided), newest acceptance first', () => {
    expect(l.keptRecords.map((k) => k.event.event_id)).toEqual(['half', 'b', 'w', 'mixed']);
    expect(l.keptRecords.find((k) => k.event.event_id === 'b')).toMatchObject({ flags: ['missing_classification'], leftOut: true });
    expect(l.keptRecords.find((k) => k.event.event_id === 'w')).toMatchObject({ leftOut: false });
  });
  it('counts: kept blocking records leave the to-fix numbers and are counted apart in hours', () => {
    expect(l.summary.total).toBe(3);
    expect(l.summary.blocked).toEqual({ count: 0, hours: 0 });
    expect(l.summary.review.count).toBe(3);
    expect(l.summary.kept.count).toBe(4);
    expect(l.summary.kept.leftOut.count).toBe(2); // b and mixed are blocked (stored) with no open blocking problem
    expect(l.summary.kept.leftOut.hours).toBeCloseTo(3, 5); // 2 h + 1 h
    expect(l.summary.byFlag).toEqual({ blank_reason: 2, unknown_code: 1 });
  });
  it('an unkept blocking record still counts as to fix', () => {
    const r = buildValidation([...KEPT, ev('x', 'K.1', '2026-05-07 08:00:00', '2026-05-07 11:00:00', { flags: 'unknown_area' })]);
    expect(r.summary.blocked.count).toBe(1);
    expect(r.summary.blocked.hours).toBeCloseTo(3, 5);
  });
  it('P1: an overlap is information, never open; an earlier acceptance of it still shows under kept', () => {
    const o = buildValidation([
      ev('o1', 'K.3', '2026-04-10 08:00:00', '2026-04-10 10:00:00', { accepted_flags: 'overlap_in_area' }),
      ev('o2', 'K.3', '2026-04-10 09:00:00', '2026-04-10 11:00:00'),
    ]);
    expect(o.records).toEqual([]);
    expect(o.overlapRecords.map((r) => r.event.event_id)).toEqual(['o2', 'o1']);
    expect(o.keptRecords.map((r) => r.event.event_id)).toEqual(['o1']);
    expect(o.summary.overlapping).toBe(2);
    expect(o.summary.total).toBe(0);
  });
  it('P2: failure_flag_mismatch is a derived warning (Failure YES on PL / CIR / Freq 0) that can be kept as entered', () => {
    const m = buildValidation([
      ev('pl', 'K.1', '2026-05-10 08:00:00', '2026-05-10 09:00:00', { classification: 'PL', is_failure: true }),
      ev('cir', 'K.1', '2026-05-11 08:00:00', '2026-05-11 09:00:00', { classification: 'CIR', is_failure: true }),
      ev('cont', 'K.1', '2026-05-12 08:00:00', '2026-05-12 09:00:00', { freq: 0, is_failure: true }),
      ev('ok', 'K.1', '2026-05-13 08:00:00', '2026-05-13 09:00:00'),
      ev('plno', 'K.1', '2026-05-14 08:00:00', '2026-05-14 09:00:00', { classification: 'PL', is_failure: false }),
      ev('kept', 'K.1', '2026-05-15 08:00:00', '2026-05-15 09:00:00', { classification: 'CIR', is_failure: true, accepted_flags: MISMATCH_FLAG, accepted_at: '2026-06-01 10:00:00.000' }),
    ]);
    expect(m.records.map((r) => r.event.event_id).sort()).toEqual(['cir', 'cont', 'pl']);
    expect(m.records.every((r) => r.problems.join() === MISMATCH_FLAG && !r.blocking)).toBe(true);
    expect(m.summary.byFlag).toEqual({ [MISMATCH_FLAG]: 3 });
    expect(m.summary.review.count).toBe(3);
    expect(m.keptRecords.map((k) => k.event.event_id)).toEqual(['kept']);
    expect(flagCounts(m.records)).toEqual([{ flag: MISMATCH_FLAG, count: 3, blocking: false }]);
  });
  it('filters kept records by area, month and search', () => {
    expect(applyKeptFilter(l.keptRecords, { ...EMPTY_FILTER, area: 'K.2' }).map((k) => k.event.event_id)).toEqual(['mixed']);
    expect(applyKeptFilter(l.keptRecords, { ...EMPTY_FILTER, month: '2026-05' })).toHaveLength(4);
    expect(applyKeptFilter(l.keptRecords, { ...EMPTY_FILTER, month: '2026-06' })).toHaveLength(0);
    expect(applyKeptFilter(l.keptRecords, { ...EMPTY_FILTER, q: 'half' }).map((k) => k.event.event_id)).toEqual(['half']);
  });
  it('recheckRecord is null once everything is kept', () => {
    const open = ev('o', 'K.1', '2026-05-09 08:00:00', '2026-05-09 09:00:00', { flags: 'unknown_code' });
    expect(recheckRecord([open], open)).not.toBeNull();
    expect(recheckRecord([open], { ...open, accepted_flags: 'unknown_code' })).toBeNull();
  });
  it('the full new set to send: what is kept already plus the ticked open problems', () => {
    const half = l.records.find((r) => r.event.event_id === 'half')!;
    expect(keepSetFor(half, new Set(['blank_reason']))).toEqual(['unknown_code', 'blank_reason']);
    expect(keepSetFor(half, new Set(['placeholder']))).toBeNull();
    expect(keepSetFor(half, new Set())).toBeNull();
    expect(undoSetFor({ kept: ['unknown_code', 'blank_reason'] }, new Set(['blank_reason']))).toEqual(['unknown_code']);
    expect(undoSetFor({ kept: ['unknown_code'] }, new Set(['unknown_code']))).toEqual([]);
    expect(undoSetFor({ kept: ['unknown_code'] }, new Set(['blank_reason']))).toBeNull();
  });
  it('says the consequence in plain words', () => {
    const open = l.records.find((r) => r.event.event_id === 'open')!;
    expect(keepConsequence(open, new Set(['blank_reason'])).sentence).toBe('Nothing in the record changes. It will stop being listed. It counts normally.');
    const blocking = buildValidation([ev('bb', 'K.1', '2026-05-07 08:00:00', '2026-05-07 09:00:00', { flags: 'missing_classification' })]).records[0];
    expect(keepConsequence(blocking, new Set(['missing_classification'])).sentence).toBe('Nothing in the record changes. It will stop being listed. It is still left out of the numbers.');
    expect(keepConsequence(blocking, new Set()).sentence).toContain('stays listed');
    expect(keepConsequenceMany([open, blocking], new Set(['blank_reason', 'missing_classification']))).toContain('1 of them are still left out of the numbers; 1 count normally.');
    expect(keepConsequenceMany([open], new Set(['blank_reason']))).toBe(keepConsequence(open, new Set(['blank_reason'])).sentence);
  });
  it('offers the open problems of the records with their counts, and explains refusals', () => {
    expect(keepChoices(l.records)).toEqual([{ flag: 'unknown_code', count: 1, blocking: false }, { flag: 'blank_reason', count: 2, blocking: false }]);
    expect(plainKeepReason('Nothing was changed.')).toMatch(/already kept/);
    expect(plainKeepReason('This record does not have the problem "x".')).toMatch(/no longer has this problem/);
    expect(plainKeepReason('This event is void. Restore it before changing it.')).toMatch(/voided/);
  });
});

describe('buildValidation', () => {
  const l = buildValidation(DATA);
  it('lists stored flags, never voided or clean records; overlaps are information (P1), listed apart', () => {
    expect(l.records.map((r) => r.event.event_id).sort()).toEqual(['code', 'nocls', 'rev']);
    expect(l.overlapRecords.map((r) => r.event.event_id).sort()).toEqual(['o1', 'o2']);
    const o1 = l.overlapRecords.find((r) => r.event.event_id === 'o1')!;
    expect(o1.problems).toEqual([]);
    expect(o1.info).toEqual([OVERLAP_FLAG]);
    expect(o1.partners).toEqual(['o2']);
    expect(o1.blocking).toBe(false);
  });
  it('sorts blocking first, then newest stop first', () => {
    expect(l.records.map((r) => r.event.event_id)).toEqual(['rev', 'nocls', 'code']);
  });
  it('counts blocked, review and overlapping (overlapping is information, not in the totals)', () => {
    expect(l.summary.total).toBe(3);
    expect(l.summary.blocked.count).toBe(2);
    expect(l.summary.blocked.hours).toBeCloseTo(2, 5); // 'nocls' is 2 h; the restart-before-stop record counts 0 h
    expect(l.summary.review.count).toBe(1);
    expect(l.summary.overlapping).toBe(2);
    expect(l.summary.byFlag).toEqual({ missing_classification: 1, blank_reason: 1, end_before_start: 1, unknown_code: 1 });
  });
  it('a blocked record does not take part in the overlap search', () => {
    const blockedPartner = ev('b', 'K.3', '2026-04-10 09:30:00', '2026-04-10 09:45:00', { flags: 'unknown_area' });
    const r = buildValidation([...DATA, blockedPartner]);
    expect(r.overlapRecords.find((x) => x.event.event_id === 'o1')!.partners).toEqual(['o2']);
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
    expect(l.summary.total).toBe(3);
    expect(l.summary.review.count).toBe(1);
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
  it('returns null once nothing is left to fix; an overlap alone is nothing to fix (information)', () => {
    const fixed = { ...DATA[1], classification: 'PRO' as const, flags: 'blank_reason' };
    expect(recheckRecord(DATA, fixed)!.problems).toEqual(['blank_reason']);
    expect(recheckRecord(DATA, { ...fixed, flags: undefined })).toBeNull();
    const o2 = DATA.find((e) => e.event_id === 'o2')!;
    expect(recheckRecord(DATA, o2)).toBeNull();
    const withProblem = recheckRecord(DATA, { ...o2, flags: 'unknown_code' })!;
    expect(withProblem.partners).toEqual(['o1']);
    expect(withProblem.info).toEqual([OVERLAP_FLAG]);
    expect(recheckRecord(DATA, { ...o2, is_void: true })).toBeNull();
  });
});

describe('filters', () => {
  const l = buildValidation(DATA);
  it('filters by problem (any of), area, month, blocking and text', () => {
    const ids = (f: Partial<typeof EMPTY_FILTER>) => applyValidateFilter(l.records, { ...EMPTY_FILTER, ...f }).map((r) => r.event.event_id).sort();
    expect(ids({})).toHaveLength(3);
    expect(ids({ flags: ['unknown_code'] })).toEqual(['code']);
    expect(ids({ flags: ['unknown_code', 'blank_reason'] })).toEqual(['code', 'nocls']);
    expect(ids({ flags: [OVERLAP_FLAG] })).toEqual([]);
    expect(ids({ area: 'K.3' })).toEqual(['rev']);
    expect(ids({ month: '2026-03' })).toEqual(['nocls']);
    expect(ids({ blockingOnly: true })).toEqual(['nocls', 'rev']);
    expect(ids({ area: 'K.3', flags: ['end_before_start'], blockingOnly: true })).toEqual(['rev']);
    // the Overlaps view (information) is filtered the same way
    const info = (f: Partial<typeof EMPTY_FILTER>) => applyValidateFilter(l.overlapRecords, { ...EMPTY_FILTER, ...f }).map((r) => r.event.event_id).sort();
    expect(info({ q: 'belt' })).toEqual(['o2']);
    expect(info({ q: ' N/A ' })).toEqual(['o2']);
    expect(info({ area: 'K.3' })).toEqual(['o1', 'o2']);
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

describe('filterFromParams', () => {
  it('reads a link\'s query into a filter, and null when it names none', () => {
    expect(filterFromParams(new URLSearchParams('flag=unknown_code,placeholder&q=AFR2&area=K.1&month=2026-03&blocking=1'))).toEqual({
      flags: ['unknown_code', 'placeholder'], area: 'K.1', month: '2026-03', q: 'AFR2', blockingOnly: true,
    });
    expect(filterFromParams(new URLSearchParams('flag=placeholder'))).toEqual({ ...EMPTY_FILTER, flags: ['placeholder'] });
    expect(filterFromParams(new URLSearchParams('month=bogus'))).toBeNull();
    expect(filterFromParams(new URLSearchParams(''))).toBeNull();
  });
});
