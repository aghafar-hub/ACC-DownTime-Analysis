import { describe, expect, it } from 'vitest';
import { createRowFactory, fixtureIndex } from './fixtures';
import { availabilityByArea, compareValues, composeKpis, computeKpis, computeKpisWithComparison, dataRangeOf, emptySums, lastDayOf, type KpiOk } from './kpis';
import { avail, unavail, type Metric } from './metric';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

const settings = DEFAULT_SETTINGS;
const MARCH = { from: '2026-03-01', to: '2026-03-31' };
const FIRST10 = { from: '2026-03-01', to: '2026-03-10' };

const ok = (r: ReturnType<typeof computeKpis>): KpiOk => {
  if (r.status !== 'ok') throw new Error('expected ok: ' + r.reason);
  return r;
};
const val = (m: Metric): number => {
  if (!m.available) throw new Error('unavailable: ' + m.reason);
  return m.value;
};

/** Hand-computed scenario, area K.1, window 1-10 March 2026 (T = 10 d x 24 h = 240 h). */
function scenario() {
  const row = createRowFactory();
  return [
    row({ stop: '2026-03-02 08:00', start: '2026-03-02 10:00', cls: 'MEC', code: '100.A1', reason: 'Bearing failure' }), // INC 2 h, failure
    row({ stop: '2026-03-02 10:00', start: '2026-03-02 10:30', cls: 'ELE', freq: 0 }), // continuation, INC 0.5 h
    row({ stop: '2026-03-05 00:00', start: '2026-03-05 06:00', cls: 'PRO', code: '100.A2' }), // INC 6 h, failure
    row({ stop: '2026-03-07 08:00', start: '2026-03-07 20:00', cls: 'PL', reason: 'Scheduled maintenance' }), // PL 12 h
    row({ stop: '2026-03-08 10:00', start: '2026-03-08 14:00', cls: 'CIR', reason: 'Power cut' }), // CIR 4 h
    row({ stop: '2026-03-10 22:00', start: '2026-03-11 02:00', cls: 'AUT', code: '100.A1' }), // INC 4 h, only 2 h inside the window
    row({ stop: '2026-03-12 09:00', start: '2026-03-12 10:00', cls: 'MEC' }), // outside the window
    row({ stop: '2026-03-03 09:00', start: '2026-03-03 19:00', cls: 'MEC', isVoid: true }), // voided: ignored
  ];
}

describe('computeKpis hand-computed scenario', () => {
  const k = ok(computeKpis({ rows: scenario(), window: FIRST10, dataRange: MARCH, settings }));
  const t = k.total;
  it('splits hours by planned / failure / other, clipping to the window and ignoring voided rows', () => {
    expect(t.scheduledHours).toBe(240);
    expect(t.plannedHours).toBe(12);
    expect(t.failureHours).toBeCloseTo(10.5, 9); // 2 + 0.5 + 6 + 2 (clipped)
    expect(t.otherHours).toBe(4);
    expect(t.downtimeHours).toBeCloseTo(26.5, 9);
    expect(val(t.operatingHours)).toBeCloseTo(213.5, 9); // 240 - 26.5
  });
  it('counts failures from the sheet flag (continuation rows are not failures; stop inside the window)', () => {
    expect(t.failureCount).toBe(3);
    expect(t.failureEventCount).toBe(3);
  });
  it('availability bases A, B and C', () => {
    expect(val(t.availability.A)).toBeCloseTo(213.5 / 240, 9); // (240 - 26.5) / 240
    expect(val(t.availability.B)).toBeCloseTo(213.5 / 228, 9); // (240 - 12 - 14.5) / (240 - 12)
    expect(val(t.availability.C)).toBeCloseTo(213.5 / 224, 9); // (240 - 12 - 4 - 10.5) / (240 - 12 - 4)
    expect(t.availabilityHeadline).toEqual(t.availability.B);
    expect(ok(computeKpis({ rows: scenario(), window: FIRST10, dataRange: MARCH, settings: { ...settings, availabilityBasis: 'C' } })).total.availabilityHeadline)
      .toEqual(t.availability.C);
  });
  it('MTBF, failure rate and MTTR', () => {
    expect(val(t.mtbfHours)).toBeCloseTo(213.5 / 3, 9);
    expect(val(t.failureRatePer1000h)).toBeCloseTo((3 / 213.5) * 1000, 9);
    // cohort: events that STARTED in the window, full length: (2 + 0.5) + 6 + 4 = 12.5 h over 3 events
    expect(val(t.mttrHours)).toBeCloseTo(12.5 / 3, 9);
  });
  it('is not partial when the data covers the window', () => expect(k.partial).toBe(false));
});

describe('zero failures, empty windows, partial months', () => {
  it('zero failures: MTBF unavailable with a reason, never Infinity or 0; the rate is a true 0', () => {
    const row = createRowFactory();
    const rows = [row({ stop: '2026-03-02 08:00', start: '2026-03-02 20:00', cls: 'PL' })];
    const k = ok(computeKpis({ rows, window: FIRST10, dataRange: MARCH, settings }));
    expect(k.total.failureCount).toBe(0);
    expect(k.total.mtbfHours).toMatchObject({ available: false, code: 'no_failures' });
    expect(k.total.mttrHours).toMatchObject({ available: false, code: 'no_failures' });
    expect(val(k.total.failureRatePer1000h)).toBe(0);
    expect(val(k.total.availability.B)).toBe(1); // (240 - 12 - 0) / (240 - 12)
    expect(k.topArea.available).toBe(false);
    expect(JSON.stringify(k)).not.toMatch(/Infinity|NaN/);
  });
  it('a window inside the data range with no events: full availability, T still counted', () => {
    const row = createRowFactory();
    const rows = [row({ stop: '2026-03-02 08:00', start: '2026-03-02 09:00' }), row({ stop: '2026-03-20 08:00', start: '2026-03-20 09:00' })];
    const k = ok(computeKpis({ rows, window: { from: '2026-03-10', to: '2026-03-12' }, settings }));
    expect(k.total.scheduledHours).toBe(72);
    expect(k.total.failureHours).toBe(0);
    expect(val(k.total.availability.A)).toBe(1);
    expect(k.total.mtbfHours.available).toBe(false);
  });
  it('a window outside the data is no_data, not zeros', () => {
    const row = createRowFactory();
    const rows = [row({ stop: '2026-03-02 08:00', start: '2026-03-02 09:00' })];
    const r = computeKpis({ rows, window: { from: '2026-06-01', to: '2026-06-30' }, settings });
    expect(r.status).toBe('no_data');
    expect(computeKpis({ rows: [], window: MARCH, settings }).status).toBe('no_data');
    expect(computeKpis({ rows: rows.map((x) => ({ ...x, is_void: true })), window: MARCH, settings }).status).toBe('no_data');
  });
  it('a month still in progress is partial: T covers only the elapsed days', () => {
    const row = createRowFactory();
    const rows = [row({ stop: '2026-03-05 00:00', start: '2026-03-05 12:00' }), row({ stop: '2026-03-15 00:00', start: '2026-03-15 06:00', failure: false, cls: 'PL' })];
    const k = ok(computeKpis({ rows, window: MARCH, settings }));
    expect(k.partial).toBe(true);
    expect(k.window).toEqual({ from: '2026-03-05', to: '2026-03-15' });
  });
  it('partial month with an explicit data range ending mid-month', () => {
    const row = createRowFactory();
    const rows = [row({ stop: '2026-03-05 00:00', start: '2026-03-05 12:00' })];
    const k = ok(computeKpis({ rows, window: MARCH, dataRange: { from: '2026-03-01', to: '2026-03-15' }, settings }));
    expect(k.partial).toBe(true);
    expect(k.total.scheduledHours).toBe(360); // 15 d x 24 h
    expect(val(k.total.mtbfHours)).toBe(348); // (360 - 12) / 1
  });
  it("'This month' to the last day with data is partial; the same window inside the data is not", () => {
    const row = createRowFactory();
    const rows = [row({ stop: '2026-03-05 00:00', start: '2026-03-05 12:00' }), row({ stop: '2026-03-20 08:00', start: '2026-03-20 09:00' })];
    const data = { from: '2026-03-01', to: '2026-03-20' };
    expect(ok(computeKpis({ rows, window: { from: '2026-03-01', to: '2026-03-20' }, dataRange: data, settings })).partial).toBe(true);
    // the whole month covered: not partial
    expect(ok(computeKpis({ rows, window: MARCH, dataRange: MARCH, settings })).partial).toBe(false);
    // the first ten days while the data goes on: a plain custom range, not a month in progress
    expect(ok(computeKpis({ rows, window: FIRST10, dataRange: data, settings })).partial).toBe(false);
  });
  it('honours scheduled days per week', () => {
    const row = createRowFactory();
    const rows = [row({ stop: '2026-02-03 08:00', start: '2026-02-03 10:00' })];
    const s = parseSettings({ scheduled_hours_per_day: '8', scheduled_days_per_week: '5' });
    const k = ok(computeKpis({ rows, window: { from: '2026-02-01', to: '2026-02-28' }, dataRange: { from: '2026-02-01', to: '2026-02-28' }, settings: s }));
    expect(k.total.scheduledHours).toBe(160);
  });
  it('no scheduled time gives unavailable availability, not 0 or NaN', () => {
    const c = composeKpis('X', 0, emptySums(), settings);
    expect(c.availability.A.available).toBe(false);
    expect(c.operatingHours.available).toBe(false);
    expect(c.failureRatePer1000h.available).toBe(false);
  });
  it('all scheduled time planned: B is unavailable', () => {
    const sums = { ...emptySums(), pl: 240 };
    const c = composeKpis('X', 240, sums, settings);
    expect(c.availability.B.available).toBe(false);
    expect(val(c.availability.A)).toBe(0);
  });
});

describe('multiple areas (area-hours) and contributors', () => {
  const row = createRowFactory();
  const rows = [
    row({ area: 'K.1', code: '100.A1', stop: '2026-03-02 08:00', start: '2026-03-02 10:00' }), // K.1 INC 2 h
    row({ area: 'K.1', code: '100.A1', stop: '2026-03-04 08:00', start: '2026-03-04 09:00' }), // K.1 INC 1 h
    row({ area: 'RM.1', code: '200.B1', stop: '2026-03-03 08:00', start: '2026-03-03 11:00' }), // RM.1 INC 3 h
    row({ area: 'RM.1', code: '100.A2', stop: '2026-03-05 08:00', start: '2026-03-05 09:00' }), // 100.A2 belongs to RM.1 too: own
    row({ area: 'RM.1', code: '300.C1', stop: '2026-03-06 08:00', start: '2026-03-06 12:00' }), // 300.C1 belongs to CM.1 only: other area
  ];
  const k = ok(computeKpis({ rows, window: FIRST10, dataRange: MARCH, settings, index: fixtureIndex() }));
  it('sums hours across areas and labels T as area-hours', () => {
    expect(k.areas.map((a) => a.area_id)).toEqual(['K.1', 'RM.1']);
    expect(k.total.scheduledHours).toBe(480);
    expect(k.total.failureHours).toBe(2 + 1 + 3 + 1 + 4);
    expect(k.areas[0]!.failureHours).toBe(3);
    expect(k.areas[1]!.failureHours).toBe(8);
    // total availability from summed hours: (480 - 11) / 480, not the mean of two percentages
    expect(val(k.total.availability.A)).toBeCloseTo(469 / 480, 9);
    expect(val(k.total.mtbfHours)).toBeCloseTo(469 / 5, 9);
  });
  it('top contributing area by failure hours', () => {
    expect(k.topArea).toMatchObject({ available: true, areaId: 'RM.1', value: 8 });
    expect((k.topArea as { sharePct: number }).sharePct).toBeCloseTo((8 / 11) * 100, 9);
  });
  it('top and most frequent equipment follow the own-stop rule', () => {
    // own: 100.A1 3 h (K.1 x2), 200.B1 3 h (RM.1), 100.A2 1 h (RM.1). 300.C1 (4 h) is a cause from another area.
    expect(k.mostFrequentEquipment).toMatchObject({ available: true, code: '100.A1', count: 2 });
    expect(k.topEquipmentByHours).toMatchObject({ available: true, code: '100.A1', value: 3 }); // ties by label: 100.A1 before 200.B1
    expect((k.topEquipmentByHours as { sharePct: number }).sharePct).toBeCloseTo((3 / 7) * 100, 9);
  });
  it('without master data the equipment contributors are unavailable', () => {
    const r = ok(computeKpis({ rows, window: FIRST10, dataRange: MARCH, settings }));
    expect(r.topEquipmentByHours).toMatchObject({ available: false, code: 'no_master' });
  });
  it('restricts to the requested areas', () => {
    const r = ok(computeKpis({ rows, window: FIRST10, dataRange: MARCH, settings, areaIds: ['K.1'] }));
    expect(r.total.scheduledHours).toBe(240);
    expect(r.total.failureHours).toBe(3);
  });
});

describe('repeats and orphans in the KPI result', () => {
  it('counts repeated failures (groups), their repeat events (every failure event of the group) and orphans', () => {
    const row = createRowFactory();
    const rows = [
      row({ code: '100.A1', reason: 'Belt slip', stop: '2026-03-02 08:00', start: '2026-03-02 09:00' }),
      row({ code: '100.A1', reason: 'Belt slip', stop: '2026-03-09 08:00', start: '2026-03-09 09:00' }),
      row({ code: '100.A1', reason: 'Belt slip', stop: '2026-03-20 08:00', start: '2026-03-20 09:00' }),
      row({ code: '200.B1', stop: '2026-03-03 00:00', start: '2026-03-03 01:00', freq: 0 }),
    ];
    const k = ok(computeKpis({ rows, window: MARCH, dataRange: MARCH, settings }));
    expect(k.repeatGroups).toBe(1);
    expect(k.repeatedFailureCount).toBe(3);
    expect(k.orphanCount).toBe(1);
  });
});

describe('comparison', () => {
  const row = createRowFactory();
  const rows = [
    // February 1-10 (comparison for 1-10 March): one 5 h failure
    row({ stop: '2026-02-03 08:00', start: '2026-02-03 13:00' }),
    // March 1-10: 4 h + 2 h failures
    row({ stop: '2026-03-02 08:00', start: '2026-03-02 12:00' }),
    row({ stop: '2026-03-06 08:00', start: '2026-03-06 10:00' }),
    row({ stop: '2026-03-28 08:00', start: '2026-03-28 09:00' }),
  ];
  it('compares a partial month with the elapsed-equivalent previous period', () => {
    const c = computeKpisWithComparison({ rows, window: FIRST10, dataRange: { from: '2026-02-01', to: '2026-03-31' }, settings }, 'previous_period');
    expect(c.previousWindow).toEqual({ from: '2026-02-01', to: '2026-02-10' });
    const ch = c.changes!;
    if (!ch.failureHours.available) throw new Error('unavailable');
    expect(ch.failureHours.abs).toBe(1); // 6 h vs 5 h
    expect(ch.failureHours.pct).toBeCloseTo(20, 9);
    expect(ch.failureHours.direction).toBe('up');
    expect(ch.failureHours.assessment).toBe('bad'); // more failure hours is bad
    if (!ch.failureCount.available) throw new Error('unavailable');
    expect(ch.failureCount.abs).toBe(1);
    // MTTR: (4 + 2) / 2 = 3 h vs 5 h: lower is good
    if (!ch.mttrHours.available) throw new Error('unavailable');
    expect(ch.mttrHours.abs).toBe(-2);
    expect(ch.mttrHours.assessment).toBe('good');
    if (!ch.availability.available) throw new Error('unavailable');
    expect(ch.availability.assessment).toBe('bad'); // B: 234/240 vs 235/240
  });
  it('a current partial month is compared with the same elapsed days (derived from the effective window)', () => {
    const c = computeKpisWithComparison({ rows, window: MARCH, dataRange: { from: '2026-02-01', to: '2026-03-10' }, settings }, 'previous_period');
    expect(c.current.status === 'ok' && c.current.window).toEqual({ from: '2026-03-01', to: '2026-03-10' });
    expect(c.previousWindow).toEqual({ from: '2026-02-01', to: '2026-02-10' });
  });
  it('previous period without data gives no changes', () => {
    const c = computeKpisWithComparison({ rows, window: FIRST10, settings }, 'same_period_last_year');
    expect(c.previous.status).toBe('no_data');
    expect(c.changes).toBeNull();
  });
  it('compareValues: zero baseline gives null percent, flat is neutral, unavailable propagates', () => {
    expect(compareValues(avail(3), avail(0), 'lower')).toMatchObject({ available: true, abs: 3, pct: null, assessment: 'bad' });
    expect(compareValues(avail(2), avail(2), 'lower')).toMatchObject({ direction: 'flat', assessment: 'neutral' });
    expect(compareValues(avail(2), avail(1), 'none')).toMatchObject({ assessment: 'neutral' });
    expect(compareValues(avail(0.9), avail(0.8), 'higher')).toMatchObject({ assessment: 'good' });
    expect(compareValues(unavail('no_failures', 'none'), avail(1), 'higher')).toEqual({ available: false, reason: 'none' });
    expect(compareValues(avail(1), unavail('no_data', 'nope'), 'higher')).toEqual({ available: false, reason: 'nope' });
  });
});

describe('midnight splits and 24 h stops in the KPIs', () => {
  it('a stop split at midnight into two rows counts both parts, once, with one failure', () => {
    const row = createRowFactory();
    const rows = [
      row({ stop: '2026-03-02 22:00', start: '2026-03-03 00:00' }), // 2 h, failure
      row({ stop: '2026-03-03 00:00', start: '2026-03-03 03:00', freq: 0 }), // 3 h continuation
    ];
    const day2 = ok(computeKpis({ rows, window: { from: '2026-03-02', to: '2026-03-02' }, dataRange: MARCH, settings }));
    const day3 = ok(computeKpis({ rows, window: { from: '2026-03-03', to: '2026-03-03' }, dataRange: MARCH, settings }));
    expect([day2.total.failureHours, day3.total.failureHours]).toEqual([2, 3]);
    expect([day2.total.failureCount, day3.total.failureCount]).toEqual([1, 0]); // counted where it starts
    expect(day2.total.failureEventCount).toBe(1);
    expect(day3.total.failureEventCount).toBe(0);
    expect(val(day2.total.mttrHours)).toBe(5); // full chained duration
    const both = ok(computeKpis({ rows, window: { from: '2026-03-02', to: '2026-03-03' }, dataRange: MARCH, settings }));
    expect(both.total.failureHours).toBe(5);
    expect(both.total.failureCount).toBe(1);
  });
  it('a 24 h stop in a 24 h window leaves no operating time: availability 0 and MTBF unavailable', () => {
    const row = createRowFactory();
    const rows = [row({ stop: '2026-03-02 00:00', start: '2026-03-03 00:00' })];
    const k = ok(computeKpis({ rows, window: { from: '2026-03-02', to: '2026-03-02' }, dataRange: MARCH, settings }));
    expect(k.total.failureHours).toBe(24);
    expect(val(k.total.availability.A)).toBe(0);
    expect(val(k.total.operatingHours)).toBe(0);
    expect(k.total.mtbfHours).toMatchObject({ available: false, code: 'no_exposure' });
    expect(k.total.failureRatePer1000h).toMatchObject({ available: false, code: 'no_exposure' });
  });
  it('overlapping rows that exceed the scheduled time are clamped to 0 availability, never negative', () => {
    const row = createRowFactory();
    const rows = [row({ stop: '2026-03-02 00:00', start: '2026-03-03 00:00' }), row({ stop: '2026-03-02 00:00', start: '2026-03-03 00:00', cls: 'ELE' })];
    const k = ok(computeKpis({ rows, window: { from: '2026-03-02', to: '2026-03-02' }, dataRange: MARCH, settings }));
    expect(val(k.total.availability.A)).toBe(0);
  });
});

describe('availabilityByArea', () => {
  const row = createRowFactory();
  const rows = [
    row({ area: 'K.1', stop: '2026-03-02 08:00', start: '2026-03-02 11:00' }), // 3 h
    row({ area: 'RM.1', stop: '2026-03-03 08:00', start: '2026-03-03 16:00' }), // 8 h
    row({ area: 'RM.1', stop: '2026-03-04 08:00', start: '2026-03-04 20:00', cls: 'PL' }), // 12 h planned: basis B takes it out of T
  ];
  const k = ok(computeKpis({ rows, window: FIRST10, dataRange: MARCH, areaIds: ['K.1', 'RM.1', 'CM.1'], settings }));
  const a = availabilityByArea(k);
  it('lists the areas lowest first on the headline basis with the all-area figure as the reference', () => {
    expect(a.areas.map((x) => x.area_id)).toEqual(['RM.1', 'K.1', 'CM.1']);
    expect(val(a.areas[0]!.availability)).toBeCloseTo((228 - 8) / 228, 9);
    expect(val(a.areas[1]!.availability)).toBeCloseTo(237 / 240, 9);
    expect(a.overall).toEqual(k.total.availabilityHeadline);
    expect(val(a.overall)).toBeCloseTo((720 - 12 - 11) / (720 - 12), 9);
  });
  it('areas without a value come last', () => {
    const none = availabilityByArea({ areas: [{ ...k.areas[0]!, availabilityHeadline: unavail('no_scheduled_time', 'x') }, k.areas[1]!], total: k.total });
    expect(none.areas.map((x) => x.area_id)).toEqual(['RM.1', 'K.1']);
    expect(none.areas[1]!.availability.available).toBe(false);
  });
});

describe('data range end (dataRangeOf)', () => {
  it('a restart at exactly 00:00:00.000 does not add the next day to the coverage', () => {
    const row = createRowFactory();
    const rows = [
      row({ stop: '2026-06-01 08:00', start: '2026-06-01 09:00' }),
      row({ stop: '2026-07-31 22:00', start: '2026-08-01 00:00' }), // ends at midnight: the data stops on 31 July
    ];
    expect(dataRangeOf(rows)).toEqual({ from: '2026-06-01', to: '2026-07-31' });
    expect(lastDayOf(rows[1]!)).toBe('2026-07-31');
    // one millisecond later, 1 August is really covered
    const later = [...rows, row({ stop: '2026-07-31 23:00', start: '2026-08-01 00:00:00.001' })];
    expect(dataRangeOf(later)!.to).toBe('2026-08-01');
  });
  it('year end: a restart at 1 Jan 00:00 keeps the coverage in December', () => {
    const row = createRowFactory();
    const rows = [row({ stop: '2026-12-31 20:00', start: '2027-01-01 00:00' })];
    expect(dataRangeOf(rows)).toEqual({ from: '2026-12-31', to: '2026-12-31' });
  });
  it('a zero-length stop at midnight still counts its own day', () => {
    const row = createRowFactory();
    expect(dataRangeOf([row({ stop: '2026-05-10 00:00', start: '2026-05-10 00:00' })])).toEqual({ from: '2026-05-10', to: '2026-05-10' });
  });
  it("'This month' after a June-July load is July, not an empty 1 August", () => {
    const row = createRowFactory();
    const rows = [row({ stop: '2026-06-03 08:00', start: '2026-06-03 10:00' }), row({ stop: '2026-07-31 20:00', start: '2026-08-01 00:00' })];
    const range = dataRangeOf(rows)!;
    const k = ok(computeKpis({ rows, window: { from: '2026-07-01', to: range.to }, settings }));
    expect(k.window).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    expect(k.partial).toBe(false);
    expect(k.total.failureHours).toBe(4);
  });
});

describe('reliability and utilization factors', () => {
  it('RF = running ÷ (running + INC) and UF = running ÷ scheduled, from the summed hours', () => {
    const k = composeKpis('X', 744, { pl: 40, inc: 30, cir: 4, events: 6, eventSeconds: 30 * 3600 }, { availabilityBasis: 'B' });
    const run = 744 - 40 - 30 - 4;
    expect(k.reliabilityFactor).toEqual(avail(run / (run + 30)));
    expect(k.utilizationFactor).toEqual(avail(run / 744));
    // RF = MTBF / (MTBF + INC hours per failure): the same identity the RF lines on the MTBF-MTTR chart rely on
    const m = (k.mtbfHours as { value: number }).value;
    expect((k.reliabilityFactor as { value: number }).value).toBeCloseTo(m / (m + 30 / 6), 12);
  });
  it('is not defined without running time; no INC gives an RF of 100 %', () => {
    expect(composeKpis('X', 0, emptySums(), { availabilityBasis: 'B' }).reliabilityFactor.available).toBe(false);
    expect(composeKpis('X', 24, { pl: 24, inc: 0, cir: 0, events: 0, eventSeconds: 0 }, { availabilityBasis: 'B' }).reliabilityFactor.available).toBe(false);
    expect(composeKpis('X', 24, emptySums(), { availabilityBasis: 'B' }).reliabilityFactor).toEqual(avail(1));
  });
});
