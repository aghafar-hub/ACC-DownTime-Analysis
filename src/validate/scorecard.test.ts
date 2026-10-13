import { describe, expect, it } from 'vitest';
import type { EventRow } from '../api/types';
import { buildValidation } from './model';
import { buildScorecard, showQualityCard } from './scorecard';

const ev = (id: string, area: string, stop: string, start: string, over: Partial<EventRow> = {}): EventRow => ({
  event_id: id, batch_id: 'B', event_date: stop.slice(0, 10), line_id: 'L.1', area_id: area, code_raw: '100.A1', is_area_level: false,
  stop_ts: `${stop}.000`, start_ts: `${start}.000`, duration_s: 0, freq: 1, classification: 'MEC', criticality: 'INC', is_failure: true,
  fingerprint: id, edited: false, is_void: false, created_at: '', ...over,
});

const DATA: EventRow[] = [
  // March: 3 records, 1 with an open blocking problem (2 h left out)
  ev('m1', 'K.1', '2026-03-01 08:00:00', '2026-03-01 09:00:00'),
  ev('m2', 'K.1', '2026-03-02 08:00:00', '2026-03-02 10:00:00', { classification: '' as EventRow['classification'], flags: 'missing_classification' }),
  ev('m3', 'K.2', '2026-03-03 08:00:00', '2026-03-03 09:00:00'),
  // April: 4 records. warning kept as entered (clean), blocking kept as entered (clean but still left out, 3 h), warning open, one voided (ignored)
  ev('a1', 'K.1', '2026-04-01 08:00:00', '2026-04-01 09:00:00', { flags: 'unknown_code', accepted_flags: 'unknown_code' }),
  ev('a2', 'K.1', '2026-04-02 08:00:00', '2026-04-02 11:00:00', { flags: 'unknown_area', accepted_flags: 'unknown_area' }),
  ev('a3', 'K.2', '2026-04-03 08:00:00', '2026-04-03 08:30:00', { flags: 'blank_reason' }),
  ev('a4', 'K.2', '2026-04-04 08:00:00', '2026-04-04 08:30:00', { flags: 'unknown_code', is_void: true }),
  ev('a5', 'K.2', '2026-04-05 08:00:00', '2026-04-05 09:00:00'),
  // May: a record with one kept and one open problem; information flags are not problems
  ev('y1', 'K.3', '2026-05-01 08:00:00', '2026-05-01 09:00:00', { flags: 'unknown_code,blank_reason', accepted_flags: 'unknown_code' }),
  ev('y2', 'K.3', '2026-05-02 08:00:00', '2026-05-02 09:00:00', { flags: 'code_not_in_area' }),
];

describe('buildScorecard', () => {
  const sc = buildScorecard(DATA);
  const m = (month: string) => sc.months.find((x) => x.month === month)!;

  it('has one row per month with records, newest first; voided records are ignored', () => {
    expect(sc.months.map((x) => x.month)).toEqual(['2026-05', '2026-04', '2026-03']);
    expect(m('2026-04').records).toBe(4);
  });

  it('counts records, open problems and the share of clean records', () => {
    expect(m('2026-03')).toMatchObject({ records: 3, openProblems: 1, keptAsEntered: 0 });
    expect(m('2026-03').cleanPct).toBeCloseTo((2 / 3) * 100, 9);
    // kept-as-entered records are clean; only the open warning counts as a problem
    expect(m('2026-04')).toMatchObject({ records: 4, openProblems: 1, keptAsEntered: 2 });
    expect(m('2026-04').cleanPct).toBe(75);
    // a record with one kept and one open problem is not clean; an information flag is not a problem
    expect(m('2026-05')).toMatchObject({ records: 2, openProblems: 1, keptAsEntered: 1, cleanPct: 50 });
  });

  it('left out of the numbers: count and hours, whether or not the blocking problem was kept as entered', () => {
    expect(m('2026-03').leftOut).toEqual({ count: 1, hours: 2 });
    expect(m('2026-04').leftOut).toEqual({ count: 1, hours: 3 });
    expect(m('2026-05').leftOut).toEqual({ count: 0, hours: 0 });
  });

  it('agrees with the Validate list and sums to the total', () => {
    const list = buildValidation(DATA);
    expect(sc.total.openProblems).toBe(list.summary.total);
    expect(sc.total.keptAsEntered).toBe(list.summary.kept.count);
    expect(sc.total.leftOut.count).toBe(list.summary.blocked.count + list.summary.kept.leftOut.count);
    expect(sc.total.leftOut.hours).toBeCloseTo(list.summary.blocked.hours + list.summary.kept.leftOut.hours, 9);
    expect(sc.total.records).toBe(9);
    expect(sc.total.cleanPct).toBeCloseTo((6 / 9) * 100, 9);
    expect(buildScorecard(DATA, list)).toEqual(sc);
  });

  it('counts an overlap (found by comparing records) as an open problem', () => {
    const o = buildScorecard([
      ev('o1', 'K.3', '2026-06-10 08:00:00', '2026-06-10 10:00:00'),
      ev('o2', 'K.3', '2026-06-10 09:00:00', '2026-06-10 11:00:00'),
      ev('o3', 'K.3', '2026-06-12 09:00:00', '2026-06-12 11:00:00'),
    ]);
    expect(o.months[0]).toMatchObject({ records: 3, openProblems: 2 });
  });

  it('no records: empty scorecard with no percentage', () => {
    const e = buildScorecard([ev('v', 'K.1', '2026-03-01 08:00:00', '2026-03-01 09:00:00', { is_void: true })]);
    expect(e.months).toEqual([]);
    expect(e.total.cleanPct).toBeNull();
  });
});

describe('showQualityCard', () => {
  const sc = buildScorecard(DATA);
  it('needs the right to open Validate and something open to check', () => {
    expect(showQualityCard(true, sc, 3)).toBe(true);
    expect(showQualityCard(false, sc, 3)).toBe(false);
    expect(showQualityCard(true, sc, 0)).toBe(false);
    expect(showQualityCard(true, buildScorecard([]), 3)).toBe(false);
  });
});
