import { describe, expect, it } from 'vitest';
import { buildFailureEvents } from './events';
import { createRowFactory, type RowSpec } from './fixtures';
import { findClusters, findRepeatedFailures } from './repeats';
import { MS_DAY, addDays } from './time';

const settings = { repeatMinEvents: 2, repeatWindowDays: 30 };

function failures(specs: RowSpec[]) {
  const row = createRowFactory();
  return buildFailureEvents(specs.map(row)).failureEvents;
}
const ev = (day: number, extra: Partial<RowSpec> = {}): RowSpec => {
  const d = addDays('2026-01-01', day);
  return { code: '100.A1', reason: 'Belt slip', stop: `${d} 08:00`, start: `${d} 10:00`, ...extra }; // 2 h each
};

describe('findClusters', () => {
  const days = (...d: number[]) => d.map((x) => x * MS_DAY);
  it('returns no cluster when events are too far apart', () => expect(findClusters(days(0, 31, 62), 2, 30)).toEqual([]));
  it('is inclusive of exactly window_days', () => {
    expect(findClusters(days(0, 30), 2, 30)).toEqual([[0, 1]]);
    expect(findClusters([0, 30 * MS_DAY + 1], 2, 30)).toEqual([]);
  });
  it('needs min_events inside one window', () => {
    expect(findClusters(days(0, 20, 40), 3, 30)).toEqual([]);
    expect(findClusters(days(0, 10, 20), 3, 30)).toEqual([[0, 1, 2]]);
  });
  it('merges overlapping windows into one cluster and splits distant bursts', () => {
    expect(findClusters(days(0, 20, 40, 60), 2, 30)).toEqual([[0, 1, 2, 3]]);
    expect(findClusters(days(0, 5, 100, 105), 2, 30)).toEqual([[0, 1], [2, 3]]);
  });
});

describe('findRepeatedFailures', () => {
  it('groups by code and reason, reports occurrences, hours and gaps', () => {
    const r = findRepeatedFailures(failures([ev(0), ev(10), ev(25)]), { settings });
    expect(r.groups).toHaveLength(1);
    const g = r.groups[0]!;
    expect(g).toMatchObject({ equipmentId: '100.A1', reasonKey: 'belt slip', occurrences: 3, recurrenceCount: 2, totalHours: 6, avgHours: 2, maxHours: 2, lastFailureDate: '2026-01-26' });
    expect(g.daysBetween).toEqual([10, 15]);
    expect(g.occurrenceDates).toEqual(['2026-01-01', '2026-01-11', '2026-01-26']);
    expect(r.recurrences.map((x) => [x.startDate, x.daysSincePrevious])).toEqual([['2026-01-11', 10], ['2026-01-26', 15]]);
  });
  it('lists recurrence events separately from the first occurrence', () => {
    const r = findRepeatedFailures(failures([ev(0), ev(5)]), { settings });
    expect(r.groups[0]!.occurrences).toBe(2);
    expect(r.recurrences).toHaveLength(1);
    expect(r.recurrences[0]!.startDate).toBe('2026-01-06');
  });
  it('window_days is inclusive: exactly 30 days apart qualifies, 1 s more does not', () => {
    // both start 08:00 on day 0 and day 30 (exactly 30 x 24 h)
    expect(findRepeatedFailures(failures([ev(0), ev(30)]), { settings }).groups).toHaveLength(1);
    const late = ev(30, { stop: '2026-01-31 08:00:01' });
    expect(findRepeatedFailures(failures([ev(0), late]), { settings }).groups).toHaveLength(0);
  });
  it('does not group different reasons or different codes; matches reasons by match key', () => {
    expect(findRepeatedFailures(failures([ev(0), ev(5, { reason: 'Bearing failure' })]), { settings }).groups).toHaveLength(0);
    expect(findRepeatedFailures(failures([ev(0), ev(5, { code: '200.B1' })]), { settings }).groups).toHaveLength(0);
    expect(findRepeatedFailures(failures([ev(0), ev(5, { reason: '  BELT   slip ' })]), { settings }).groups).toHaveLength(1);
  });
  it('excludes N/A and blank reasons, and ignores non-failure events', () => {
    expect(findRepeatedFailures(failures([ev(0, { code: 'N/A' }), ev(5, { code: 'N/A' })]), { settings }).groups).toHaveLength(0);
    expect(findRepeatedFailures(failures([ev(0, { reason: '' }), ev(5, { reason: '' })]), { settings }).groups).toHaveLength(0);
    expect(findRepeatedFailures(failures([ev(0, { reason: '' }), ev(5, { reason: '' })]), { settings, includeBlankReason: true }).groups).toHaveLength(1);
    const row = createRowFactory();
    const planned = buildFailureEvents([row(ev(0, { cls: 'PL' })), row(ev(5, { cls: 'PL' }))]);
    expect(findRepeatedFailures(planned.chains, { settings }).groups).toHaveLength(0);
  });
  it('honours repeat_min_events', () => {
    const s3 = { repeatMinEvents: 3, repeatWindowDays: 30 };
    expect(findRepeatedFailures(failures([ev(0), ev(5)]), { settings: s3 }).groups).toHaveLength(0);
    expect(findRepeatedFailures(failures([ev(0), ev(5), ev(9)]), { settings: s3 }).groups).toHaveLength(1);
  });
  it('two bursts months apart: the first event of each cluster is not a recurrence', () => {
    const r = findRepeatedFailures(failures([ev(0), ev(5), ev(100), ev(105)]), { settings });
    expect(r.groups[0]!.occurrences).toBe(4);
    expect(r.groups[0]!.recurrenceCount).toBe(2);
    expect(r.recurrences.map((x) => x.startDate)).toEqual(['2026-01-06', '2026-04-16']);
  });
  it('analyses the window but uses history to find clusters, and counts previous-period occurrences', () => {
    const chains = failures([ev(0), ev(5), ev(40), ev(45)]);
    // window = days 36..60 (Feb 6 - Mar 2): the two late events; the cluster of 40 and 45 is complete
    const window = { from: addDays('2026-01-01', 36), to: addDays('2026-01-01', 60) };
    const previousWindow = { from: addDays('2026-01-01', 0), to: addDays('2026-01-01', 35) };
    const r = findRepeatedFailures(chains, { settings, window, previousWindow });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.occurrences).toBe(2);
    expect(r.groups[0]!.previousPeriodOccurrences).toBe(2);
    // a window holding only the first event of a cluster has no recurrence: not reported
    expect(findRepeatedFailures(chains, { settings, window: { from: '2026-01-01', to: '2026-01-02' } }).groups).toHaveLength(0);
    // history before the window still makes a lone in-window event a recurrence
    const lone = findRepeatedFailures(chains, { settings, window: { from: '2026-01-06', to: '2026-01-06' } });
    expect(lone.groups[0]!.occurrences).toBe(1);
    expect(lone.recurrences).toHaveLength(1);
  });
  it('uses full chained event duration for hours', () => {
    const row = createRowFactory();
    const a = row({ ...ev(0) });
    const cont = row({ code: '100.A1', stop: '2026-01-01 10:00', start: '2026-01-01 11:00', freq: 0, cls: 'ELE' });
    const b = row({ ...ev(3) });
    const r = findRepeatedFailures(buildFailureEvents([a, cont, b]).failureEvents, { settings });
    expect(r.groups[0]!.totalHours).toBe(5); // 3 + 2
    expect(r.groups[0]!.maxHours).toBe(3);
  });
  it('sorts groups by occurrences then hours', () => {
    const r = findRepeatedFailures(failures([ev(0), ev(5), ev(0, { code: '200.B1' }), ev(5, { code: '200.B1' }), ev(9, { code: '200.B1' })]), { settings });
    expect(r.groups.map((g) => g.equipmentId)).toEqual(['200.B1', '100.A1']);
  });
});
