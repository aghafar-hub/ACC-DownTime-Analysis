// "Import never drops a row": blocked records stay out of every calculation, the line filter follows the area
// master, the data checks are one rule, and the upload diff decides late months as a whole.
import { describe, expect, it } from 'vitest';
import type { EventRow } from '../api/types';
import { buildFailureEvents } from './events';
import { createRowFactory, fixtureIndex, ts } from './fixtures';
import { applyFilters, blockedSummary, emptyFilter } from './filters';
import { computeKpis, dataRangeOf } from './kpis';
import { equipmentPareto, areaPareto } from './pareto';
import { findRepeatedFailures } from './repeats';
import { DEFAULT_SETTINGS } from './settings';
import { longestEvents, monthlySeries, rollingFailureCounts } from './trends';
import { compareUpload, validateRow, type DiffUploadRow } from './uploadDiff';
import { computeEventFlags } from './validate';

const index = fixtureIndex();
const ctx = { settings: DEFAULT_SETTINGS, index };
const settings = DEFAULT_SETTINGS;

/** Scenario, area K.1, March 2026: two good failures (2 h and 3 h) and one 5 h blocked failure. */
function rows(): { good1: EventRow; good2: EventRow; blocked: EventRow; blocked2: EventRow; all: EventRow[] } {
  const row = createRowFactory('P');
  const good1 = row({ stop: '2026-03-02 08:00', start: '2026-03-02 10:00', reason: 'Bearing failure' });
  const good2 = row({ stop: '2026-03-04 08:00', start: '2026-03-04 11:00', reason: 'Bearing failure' });
  const blocked = { ...row({ stop: '2026-03-06 00:00', start: '2026-03-06 05:00', reason: 'Bearing failure' }), flags: 'missing_classification,blank_reason' };
  const blocked2 = { ...row({ area: 'K.1', stop: '2026-03-08 00:00', start: '2026-03-08 01:00' }), flags: 'end_before_start' };
  return { good1, good2, blocked, blocked2, all: [good1, good2, blocked, blocked2] };
}

describe('blocked records stay out of every calculation', () => {
  const r = rows();
  it('applyFilters drops blocked and void events unless includeInvalid / includeVoid', () => {
    expect(applyFilters(r.all, emptyFilter(), ctx).map((e) => e.event_id)).toEqual([r.good1.event_id, r.good2.event_id]);
    expect(applyFilters(r.all, { ...emptyFilter(), includeInvalid: true }, ctx)).toHaveLength(4);
    const withWarning = { ...r.good1, flags: 'unknown_code,blank_reason' };
    expect(applyFilters([withWarning], emptyFilter(), ctx)).toHaveLength(1); // warnings are analysed as they are
  });
  it('blockedSummary counts records and hours per blocking flag, voided ones ignored', () => {
    const s = blockedSummary([...r.all, { ...r.blocked, is_void: true, event_id: 'V' }]);
    expect(s.total.count).toBe(2);
    expect(s.total.hours).toBe(6); // 5 h + 1 h
    expect(s.byFlag.missing_classification).toEqual({ count: 1, hours: 5 });
    expect(s.byFlag.end_before_start).toEqual({ count: 1, hours: 1 });
    expect(s.byFlag.unknown_area).toEqual({ count: 0, hours: 0 });
    expect(s.byFlag.invalid_classification.count).toBe(0);
  });
  it('buildFailureEvents ignores blocked rows (unless includeInvalid)', () => {
    expect(buildFailureEvents(r.all).chains).toHaveLength(2);
    expect(buildFailureEvents(r.all, { includeInvalid: true }).chains).toHaveLength(4);
  });
  it('KPIs: hours and failures come only from analysable rows', () => {
    const k = computeKpis({ rows: r.all, window: { from: '2026-03-01', to: '2026-03-10' }, settings });
    if (k.status !== 'ok') throw new Error('no data');
    expect(k.total.failureHours).toBe(5); // 2 h + 3 h, not 10 h
    expect(k.total.failureCount).toBe(2);
    expect(dataRangeOf(r.all)).toEqual({ from: '2026-03-02', to: '2026-03-04' });
  });
  it('chains that are passed in directly are guarded too (pareto, repeats, trends)', () => {
    const chains = buildFailureEvents(r.all, { includeInvalid: true }).chains; // all 4, bypassing the build guard
    const range = { from: '2026-03-01', to: '2026-03-31' };
    expect(areaPareto(chains, { measure: 'hours' }).bars.map((b) => b.value)).toEqual([5]);
    expect(equipmentPareto(chains, index, { measure: 'count' }).own.bars.map((b) => b.value)).toEqual([2]);
    expect(longestEvents(chains, 10).map((e) => e.eventId)).toEqual([r.good2.event_id, r.good1.event_id]);
    expect(rollingFailureCounts(chains, range, 30).at(-1)!.count).toBe(2);
    const m = monthlySeries({ rows: r.all, chains, range, settings })[0]!;
    expect(m.failureCount).toBe(2);
    expect(m.failureHours).toBe(5);
    const rep = findRepeatedFailures(chains, { settings: { repeatMinEvents: 2, repeatWindowDays: 30 }, lookup: index });
    expect(rep.groups[0]!.occurrences).toBe(2);
  });
});

describe('the line filter follows the area master, not the sheet line', () => {
  const row = createRowFactory('L');
  const hdLike = row({ area: 'K.1', stop: '2026-03-02 08:00', start: '2026-03-02 09:00', line: 'L.2' }); // K.1 belongs to L.1; the sheet says L.2
  const ok = row({ area: 'K.2', stop: '2026-03-02 10:00', start: '2026-03-02 11:00' });
  it('uses area -> line from the index', () => {
    expect(applyFilters([hdLike, ok], { ...emptyFilter(), lineIds: ['L.1'] }, ctx).map((e) => e.event_id)).toEqual([hdLike.event_id]);
    expect(applyFilters([hdLike, ok], { ...emptyFilter(), lineIds: ['L.2'] }, ctx).map((e) => e.event_id)).toEqual([ok.event_id]);
  });
  it('an area the master does not know belongs to no line', () => {
    const lost = { ...row({ area: 'ZZ', stop: '2026-03-02 08:00', start: '2026-03-02 09:00' }), flags: '' };
    expect(applyFilters([lost], { ...emptyFilter(), lineIds: ['L.1', 'L.2'] }, ctx)).toHaveLength(0);
  });
});

describe('computeEventFlags (the rule the server also applies)', () => {
  const base = { area_id: 'K.1', line_id: 'L.1', code_raw: '100.A1', classification: 'MEC', reason_raw: 'Bearing failure', stop_ts: ts('2026-03-02 08:00'), start_ts: ts('2026-03-02 09:00') };
  const f = (over: Partial<typeof base>) => computeEventFlags({ ...base, ...over }, index);
  it('a clean row has none', () => expect(f({})).toEqual([]));
  it('blank code + classification + reason', () => {
    expect(f({ code_raw: '', classification: '', reason_raw: '' })).toEqual(['missing_classification', 'missing_code', 'blank_reason']);
  });
  it('invalid classification, unknown area, line mismatch, end before start', () => {
    expect(f({ classification: 'XYZ' })).toEqual(['invalid_classification']);
    expect(f({ area_id: 'ZZ' })).toEqual(['unknown_area']);
    expect(f({ line_id: 'L.2' })).toEqual(['line_mismatch']);
    expect(f({ start_ts: ts('2026-03-02 07:00') })).toEqual(['end_before_start']);
  });
  it('codes: unknown, alias, placeholder, not in area, unassigned code (no area list) is fine', () => {
    expect(f({ code_raw: 'ZZ.9' })).toEqual(['unknown_code']);
    expect(f({ code_raw: '100.aa1' })).toEqual([]);
    expect(f({ code_raw: 'AFR' })).toEqual(['unknown_code', 'placeholder']);
    expect(f({ code_raw: '200.B1' })).toEqual(['code_not_in_area']);
    expect(f({ code_raw: '400.D1' })).toEqual([]);
    expect(f({ code_raw: 'n/a' })).toEqual([]);
  });
  it('reasons: unlisted only for a valid classification', () => {
    expect(f({ reason_raw: 'Something new' })).toEqual(['unlisted_reason']);
    expect(f({ reason_raw: '' })).toEqual(['blank_reason']);
    expect(f({ classification: 'mec' })).toEqual([]);
    expect(f({ area_id: 'k.1' })).toEqual([]); // the server matches areas in any letter case
  });
});

describe('uploadDiff: no row is rejected, late months, overlaps', () => {
  const up = (fp: string, stop: string, start: string, over: Partial<DiffUploadRow> = {}): DiffUploadRow => ({
    source_row: 2, event_date: stop.slice(0, 10), line_id: 'L.1', area_id: 'K.1', code_raw: '100.A1', stop_ts: ts(stop), start_ts: ts(start),
    freq: 1, classification: 'MEC', criticality: 'INC', is_failure: true, reason_raw: 'Bearing failure', description: '', fingerprint: fp, ...over,
  });
  const make = createRowFactory('S');
  const stored = (fp: string, stop: string, start: string): EventRow => ({ ...make({ stop, start, reason: 'Bearing failure' }), fingerprint: fp });

  it('problem rows become new rows with flags and warnings', () => {
    const d = compareUpload({
      uploaded: [
        up('a', '2026-03-03 08:00', '2026-03-03 09:00', { code_raw: '', classification: '', reason_raw: '', source_row: 2 }),
        up('b', '2026-03-03 10:00', '2026-03-03 11:00', { area_id: 'ZZ', line_id: 'L.2', source_row: 3 }),
        up('c', '2026-03-03 12:00', '2026-03-03 13:00', { area_id: 'RM.1', line_id: 'L.2', code_raw: '200.B1', source_row: 4 }),
      ],
      stored: [], index,
    });
    expect(d.rows.map((r) => r.status)).toEqual(['new', 'new', 'new']);
    expect(d.rows.map((r) => r.flags)).toEqual([
      ['missing_classification', 'missing_code', 'blank_reason'], ['unknown_area'], ['line_mismatch'],
    ]);
    expect(d.rows[0]!.warnings.map((w) => w.type).sort()).toEqual(['blank_reason', 'missing_classification', 'missing_code']);
    expect(d.rows[1]!.warnings.map((w) => w.type)).toEqual(['unknown_area']);
    expect(d.rows[2]!.warnings.map((w) => w.type)).toEqual(['line_mismatch']);
    expect(validateRow(up('x', '2026-03-03 08:00', '2026-03-03 09:00', { classification: 'XYZ' }), index).map((w) => w.type)).toEqual(['invalid_classification']);
  });

  describe('late months', () => {
    // stored: August (latest 2026-08-20) and a few days of May
    const st = [stored('s1', '2026-08-20 08:00', '2026-08-20 09:00'), stored('s2', '2026-05-04 08:00', '2026-05-04 09:00')];
    const june1 = up('j1', '2026-06-02 08:00', '2026-06-02 10:00', { source_row: 10 }); // 2 h
    const june2 = up('j2', '2026-06-15 08:00', '2026-06-15 08:30', { source_row: 11 }); // 0.5 h
    const july1 = up('y1', '2026-07-01 00:00', '2026-07-01 03:00', { source_row: 12 }); // 3 h
    const may = up('m1', '2026-05-20 08:00', '2026-05-20 09:00', { source_row: 13 }); // May has stored events: per-row late
    const sept = up('n1', '2026-09-01 08:00', '2026-09-01 09:00', { source_row: 14 }); // after the latest stored date: new
    const d = compareUpload({ uploaded: [june1, june2, july1, may, sept], stored: st, index });

    it('a not-stored row in a month with no stored events is a late-month row; with stored events it is a late row', () => {
      expect(d.rows.map((r) => [r.status, r.lateScope])).toEqual([
        ['late_row', 'month'], ['late_row', 'month'], ['late_row', 'month'], ['late_row', 'row'], ['new', undefined],
      ]);
      expect(d.summary).toMatchObject({ late: 4, lateMonthRows: 3, lateMonths: 2, new: 1 });
    });
    it('lateMonths lists month, rows and hours, oldest first; one late_month warning per month', () => {
      expect(d.lateMonths).toEqual([{ month: '2026-06', rows: 2, hours: 2.5 }, { month: '2026-07', rows: 1, hours: 3 }]);
      expect(d.warnings.filter((w) => w.type === 'late_month')).toHaveLength(2);
      expect(d.warnings.filter((w) => w.type === 'late_row').map((w) => w.source_row)).toEqual([13]);
    });
    it('a month that only has voided events counts as a late month; with nothing stored there are no late rows', () => {
      const v = compareUpload({ uploaded: [june1], stored: [{ ...stored('s3', '2026-06-30 08:00', '2026-06-30 09:00'), is_void: true }, st[0]!], index });
      expect(v.rows[0]).toMatchObject({ status: 'late_row', lateScope: 'month' });
      expect(compareUpload({ uploaded: [june1], stored: [], index }).rows[0]!.status).toBe('new');
    });
  });

  it('overlap_in_area: a pile-up of three rows is reported once per affected row, not once per pair', () => {
    const pile = [
      up('p1', '2026-03-03 08:00', '2026-03-03 12:00', { source_row: 2 }),
      up('p2', '2026-03-03 09:00', '2026-03-03 13:00', { source_row: 3 }),
      up('p3', '2026-03-03 10:00', '2026-03-03 14:00', { source_row: 4 }),
      up('q1', '2026-03-03 15:00', '2026-03-03 16:00', { source_row: 5 }),
    ];
    const d = compareUpload({ uploaded: pile, stored: [], index });
    const over = d.warnings.filter((w) => w.type === 'overlap_in_area');
    expect(over.map((w) => w.source_row)).toEqual([2, 3, 4]);
    expect(d.summary.warningCounts.overlap_in_area).toBe(3);
  });
  it('overlap tolerance is 1 second, and rows with a blocking problem are not compared', () => {
    const touch = compareUpload({ uploaded: [up('a', '2026-03-03 08:00', '2026-03-03 09:00'), up('b', '2026-03-03 08:59:59', '2026-03-03 10:00')], stored: [], index });
    expect(touch.warnings.some((w) => w.type === 'overlap_in_area')).toBe(false);
    const blocked = compareUpload({ uploaded: [up('a', '2026-03-03 08:00', '2026-03-03 09:00'), up('b', '2026-03-03 08:30', '2026-03-03 09:30', { classification: '' })], stored: [], index });
    expect(blocked.warnings.some((w) => w.type === 'overlap_in_area')).toBe(false);
  });
});
