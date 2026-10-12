import { describe, expect, it } from 'vitest';
import { buildFailureEvents } from './events';
import { createRowFactory, fixtureIndex, type RowSpec } from './fixtures';
import { DEFAULT_SETTINGS } from './settings';
import {
  buildHeatmap, dailySeries, durationHistogram, monthlyHoursByClassification, rollingMean, equipmentMonthHeatmap, equipmentReasonHeatmap, longestEvents, monthlySeries, rollingFailureCounts, yearOverYear,
} from './trends';

const settings = DEFAULT_SETTINGS;
const idx = fixtureIndex();

function rowsOf(specs: RowSpec[]) {
  const row = createRowFactory();
  return specs.map(row);
}

describe('monthlySeries', () => {
  // Stop spanning two months: 31 Jan 22:00 -> 1 Feb 03:00 = 5 h (2 h in Jan, 3 h in Feb), counted in January.
  const rows = rowsOf([
    { stop: '2026-01-31 22:00', start: '2026-02-01 00:00' },
    { stop: '2026-02-01 00:00', start: '2026-02-01 03:00', freq: 0 },
    { stop: '2026-01-10 08:00', start: '2026-01-10 09:00', cls: 'PL' }, // planned 1 h
    { stop: '2026-02-10 08:00', start: '2026-02-10 08:30', cls: 'CIR' }, // other 0.5 h
  ]);
  const series = monthlySeries({ rows, range: { from: '2026-01-01', to: '2026-02-28' }, dataRange: { from: '2026-01-01', to: '2026-02-28' }, settings });
  it('splits hours at the month boundary but counts the event where it starts', () => {
    const [jan, feb] = series;
    expect(jan!.failureHours).toBe(2);
    expect(jan!.failureCount).toBe(1);
    expect(jan!.plannedHours).toBe(1);
    expect(feb!.failureHours).toBe(3);
    expect(feb!.failureCount).toBe(0);
    expect(feb!.otherHours).toBe(0.5);
  });
  it('MTBF, MTTR and rate per month; zero failures are unavailable, never infinite', () => {
    const [jan, feb] = series;
    // Jan: T = 31 x 24 = 744; operating = 744 - 2 - 1 = 741; 1 failure
    expect(jan!.mtbfHours).toEqual({ available: true, value: 741 });
    expect(jan!.failureRatePer1000h).toMatchObject({ available: true });
    expect(jan!.failureRatePer1000h.available && jan!.failureRatePer1000h.value).toBeCloseTo((1 / 741) * 1000, 9);
    // MTTR cohort = events that started in January: the whole 5 h event
    expect(jan!.mttrHours).toEqual({ available: true, value: 5 });
    expect(feb!.mtbfHours).toMatchObject({ available: false, code: 'no_failures' });
    expect(feb!.mttrHours).toMatchObject({ available: false, code: 'no_failures' });
  });
  it('flags a month in progress as partial and uses elapsed days only', () => {
    const s = monthlySeries({ rows, range: { from: '2026-01-01', to: '2026-02-28' }, dataRange: { from: '2026-01-01', to: '2026-02-10' }, settings });
    expect(s[0]!.partial).toBe(false);
    expect(s[1]).toMatchObject({ partial: true, window: { from: '2026-02-01', to: '2026-02-10' } });
    expect(s[1]!.kpis!.scheduledHours).toBe(240);
  });
  it('months without data are unavailable, not zero', () => {
    const s = monthlySeries({ rows, range: { from: '2025-11-01', to: '2026-01-31' }, dataRange: { from: '2026-01-01', to: '2026-02-28' }, settings });
    expect(s.map((m) => m.hasData)).toEqual([false, false, true]);
    expect(s[0]!.mtbfHours).toMatchObject({ available: false, code: 'no_data' });
    expect(s[0]!.availability.available).toBe(false);
  });
  it('a range starting mid-month is not partial for that reason', () => {
    const s = monthlySeries({ rows, range: { from: '2026-01-15', to: '2026-02-28' }, dataRange: { from: '2026-01-01', to: '2026-02-28' }, settings });
    expect(s[0]).toMatchObject({ partial: false, requested: { from: '2026-01-15', to: '2026-01-31' } });
    expect(s[0]!.kpis!.scheduledHours).toBe(17 * 24);
  });
});

describe('rollingFailureCounts', () => {
  const chains = buildFailureEvents(rowsOf([
    { stop: '2026-03-01 08:00', start: '2026-03-01 09:00' },
    { stop: '2026-03-02 08:00', start: '2026-03-02 09:00' },
    { stop: '2026-03-02 12:00', start: '2026-03-02 13:00' },
    { stop: '2026-03-05 08:00', start: '2026-03-05 09:00' },
    { stop: '2026-03-04 08:00', start: '2026-03-04 09:00', cls: 'PL' }, // not a failure
  ])).failureEvents;
  it('counts failure events in the trailing window, the day included', () => {
    const r = rollingFailureCounts(chains, { from: '2026-03-01', to: '2026-03-06' }, 3);
    // trailing 3 days: 1 Mar {1}=1; 2 Mar {1,2}=3; 3 Mar {1,2,3}=3; 4 Mar {2,3,4}=2; 5 Mar {3,4,5}=1; 6 Mar {4,5,6}=1
    expect(r.map((p) => p.count)).toEqual([1, 3, 3, 2, 1, 1]);
    expect(r[0]!.date).toBe('2026-03-01');
  });
  it('looks back before the range start', () => {
    const r = rollingFailureCounts(chains, { from: '2026-03-03', to: '2026-03-03' }, 30);
    expect(r).toEqual([{ date: '2026-03-03', count: 3 }]);
  });
});

describe('yearOverYear', () => {
  const rows = rowsOf([
    { stop: '2025-03-02 08:00', start: '2025-03-02 10:00' },
    { stop: '2025-03-20 08:00', start: '2025-03-20 09:00' },
    { stop: '2026-03-05 08:00', start: '2026-03-05 09:00' },
  ]);
  const yoy = yearOverYear({ rows, year: 2026, settings, dataRange: { from: '2025-01-01', to: '2026-03-31' } });
  it('compares each month with the same month a year earlier', () => {
    expect(yoy).toHaveLength(12);
    const mar = yoy[2]!;
    expect(mar.monthNumber).toBe(3);
    expect(mar.current.failureCount).toBe(1);
    expect(mar.previous.failureCount).toBe(2);
    expect(mar.failureCount).toMatchObject({ available: true, abs: -1, pct: -50, assessment: 'good' });
    expect(mar.failureHours).toMatchObject({ available: true, abs: -2, assessment: 'good' }); // 1 h vs 3 h
  });
  it('months after the data ends are unavailable', () => {
    expect(yoy[5]!.failureCount).toEqual({ available: false, reason: 'No data for one of the months' });
  });
});

describe('durationHistogram', () => {
  const mins = [5, 10, 29, 30, 45, 120, 2000];
  const row = createRowFactory();
  const specs = mins.map((m, i) => row({ stop: `2026-03-${String(i + 1).padStart(2, '0')} 00:00`, start: new Date(Date.UTC(2026, 2, i + 1) + m * 60000).toISOString().slice(0, 19).replace('T', ' ') }));
  const chains = buildFailureEvents(specs).failureEvents;
  const h = durationHistogram(chains, settings);
  it('bins event durations (lower edge inclusive)', () => {
    const counts = Object.fromEntries(h.bins.map((b) => [b.label, b.count]));
    // 5 -> 0-10; 10, 29 -> 10-30; 30, 45 -> 30-60; 120 -> 2-4 h; 2000 -> 24 h+
    expect(counts['0 min - 10 min']).toBe(1);
    expect(counts['10 min - 30 min']).toBe(2);
    expect(counts['30 min - 1 h']).toBe(2);
    expect(counts['1 h - 2 h']).toBe(0);
    expect(counts['2 h - 4 h']).toBe(1);
    expect(counts['24 h+']).toBe(1);
    expect(h.eventCount).toBe(7);
  });
  it('bands: short <= 30 min, long >= 120 min', () => {
    const b = Object.fromEntries(h.bands.map((x) => [x.band, x.count]));
    expect(b).toEqual({ short: 4, medium: 1, long: 2 });
    expect(h.bands[0]!.countPct).toBeCloseTo((4 / 7) * 100, 9);
    expect(h.bands.reduce((s, x) => s + x.hoursPct, 0)).toBeCloseTo(100, 9);
  });
  it('empty input gives zero counts, not NaN', () => {
    const e = durationHistogram([], settings);
    expect(e.eventCount).toBe(0);
    expect(e.bands.every((b) => b.countPct === 0 && b.hoursPct === 0)).toBe(true);
  });
});

describe('heatmaps', () => {
  const chains = buildFailureEvents(rowsOf([
    { area: 'K.1', code: '100.A1', reason: 'Belt slip', stop: '2026-01-31 22:00', start: '2026-02-01 02:00' }, // 4 h: 2 Jan + 2 Feb
    { area: 'K.1', code: '100.A1', reason: 'Belt slip', stop: '2026-02-10 08:00', start: '2026-02-10 09:00' }, // 1 h Feb
    { area: 'K.1', code: '100.A2', reason: 'Other', stop: '2026-02-11 08:00', start: '2026-02-11 11:00' }, // 3 h Feb
    { area: 'K.1', code: '100.A2', reason: 'Other', cls: 'PL', stop: '2026-02-12 08:00', start: '2026-02-12 18:00' }, // planned: not in heatmap
  ])).chains;
  it('equipment x month hours (split at month ends)', () => {
    const h = equipmentMonthHeatmap(chains, idx, { from: '2026-01-01', to: '2026-03-31' }, { measure: 'hours' });
    expect(h.cols.map((c) => c.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(h.rows.map((r) => r.key)).toEqual(['100.A1', '100.A2']); // totals 5 h, 3 h
    expect(h.values).toEqual([[2, 3, 0], [0, 3, 0]]);
    expect(h.total).toBe(8);
  });
  it('equipment x month counts (month of start)', () => {
    const h = equipmentMonthHeatmap(chains, idx, { from: '2026-01-01', to: '2026-03-31' }, { measure: 'count' });
    expect(h.values).toEqual([[1, 1, 0], [0, 1, 0]]);
  });
  it('limits rows and reports what was omitted', () => {
    const h = equipmentMonthHeatmap(chains, idx, { from: '2026-01-01', to: '2026-03-31' }, { measure: 'hours', maxRows: 1 });
    expect(h.rows).toHaveLength(1);
    expect(h.omittedRows).toBe(1);
    expect(h.total).toBe(8);
  });
  it('equipment x reason', () => {
    const h = equipmentReasonHeatmap(chains, idx, undefined, { measure: 'hours' });
    expect(h.cols.map((c) => c.label)).toEqual(['Belt slip', 'Other']);
    expect(h.values).toEqual([[5, 0], [0, 3]]);
  });
  it('buildHeatmap ignores non-positive cells', () => {
    const h = buildHeatmap([{ row: 'a', rowLabel: 'a', col: 'x', colLabel: 'x', value: 0 }]);
    expect(h.rows).toEqual([]);
    expect(h.total).toBe(0);
  });
});

describe('longestEvents', () => {
  const rows = rowsOf([
    { stop: '2026-03-01 08:00', start: '2026-03-01 10:00' }, // single row 2 h
    { stop: '2026-03-02 22:00', start: '2026-03-03 00:00' }, // chain: 2 + 1.5 + 1 = 4.5 h across rows
    { stop: '2026-03-03 00:00', start: '2026-03-03 01:30', freq: 0 },
    { stop: '2026-03-03 01:30', start: '2026-03-03 02:30', freq: 0 },
    { stop: '2026-03-04 08:00', start: '2026-03-04 20:00', cls: 'PL' }, // planned 12 h, excluded by default
  ]);
  const chains = buildFailureEvents(rows).chains;
  it('ranks by chained event, not by row', () => {
    const r = longestEvents(chains, 5);
    expect(r.map((e) => e.hours)).toEqual([4.5, 2]);
    expect(r[0]).toMatchObject({ rowCount: 3, startTs: '2026-03-02 22:00:00.000' });
  });
  it('can include non-failure events, limit n and filter by window', () => {
    expect(longestEvents(chains, 1, { failureOnly: false })[0]!.hours).toBe(12);
    expect(longestEvents(chains, 5, { window: { from: '2026-03-03', to: '2026-03-31' } })).toHaveLength(0); // the chain started on 2 Mar
  });
});

describe('dailySeries', () => {
  const rows = rowsOf([
    { stop: '2026-03-01 22:00', start: '2026-03-02 02:00' }, // 4 h failure over midnight: 2 h on the 1st, 2 h on the 2nd
    { stop: '2026-03-03 08:00', start: '2026-03-03 09:00', cls: 'PL' }, // planned 1 h
    { stop: '2026-03-03 10:00', start: '2026-03-03 10:30', cls: 'CIR' }, // other 0.5 h
    { stop: '2026-03-05 08:00', start: '2026-03-05 09:00', area: 'RM.1' }, // other area, 1 h
    { stop: '2026-03-04 08:00', start: '2026-03-04 09:00', isVoid: true }, // voided: ignored
  ]);
  const range = { from: '2026-03-01', to: '2026-03-07' };
  const cov = { from: '2026-03-01', to: '2026-03-07' };
  const days = dailySeries({ rows, range, dataRange: cov, areaIds: ['K.1', 'RM.1'], settings });

  it('has one point per day and days without events are 0, not missing', () => {
    expect(days.map((d) => d.date)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07']);
    expect(days.every((d) => d.hasData)).toBe(true);
    expect(days.map((d) => d.downtimeHours)).toEqual([2, 2, 1.5, 0, 1, 0, 0]);
  });
  it('splits at midnight, counts the failure on the day it starts and splits the hours by kind', () => {
    expect(days[0]!.failureCount).toBe(1);
    expect(days[1]!.failureCount).toBe(0);
    expect(days[2]).toMatchObject({ plannedHours: 1, otherHours: 0.5, failureHours: 0 });
  });
  it('sums to the window KPIs and to the monthly series', () => {
    const total = days.reduce((s, d) => s + d.downtimeHours, 0);
    const m = monthlySeries({ rows, range, dataRange: cov, areaIds: ['K.1', 'RM.1'], settings })[0]!;
    expect(total).toBeCloseTo(m.plannedHours + m.failureHours + m.otherHours, 9);
    expect(days.reduce((s, d) => s + d.failureCount, 0)).toBe(m.failureCount);
  });
  it('rolling mean is the trailing mean over up to 7 days of the range', () => {
    expect(days[0]!.rollingDowntimeHours).toBe(2);
    expect(days[1]!.rollingDowntimeHours).toBe(2);
    expect(days[2]!.rollingDowntimeHours).toBeCloseTo((2 + 2 + 1.5) / 3, 9);
    expect(days[6]!.rollingDowntimeHours).toBeCloseTo((2 + 2 + 1.5 + 0 + 1 + 0 + 0) / 7, 9);
    const short = dailySeries({ rows, range, dataRange: cov, areaIds: ['K.1', 'RM.1'], settings, rollingDays: 2 });
    expect(short[3]!.rollingDowntimeHours).toBeCloseTo(0.75, 9);
  });
  it('days outside the data coverage have no data (not zero hours) and are skipped by the average', () => {
    const d = dailySeries({ rows, range, dataRange: { from: '2026-03-01', to: '2026-03-04' }, areaIds: ['K.1', 'RM.1'], settings });
    expect(d[5]).toMatchObject({ hasData: false, downtimeHours: 0, kpis: null, rollingDowntimeHours: null });
    expect(d[3]!.hasData).toBe(true);
  });
  it('a day KPI uses the day scheduled time times the areas', () => {
    expect(days[0]!.kpis!.scheduledHours).toBe(48);
  });
  it('rollingMean ignores gaps', () => {
    expect(rollingMean([1, null, 3, 5], 3)).toEqual([1, null, 2, 4]);
  });
});

describe('monthlyHoursByClassification', () => {
  const rows = rowsOf([
    { stop: '2026-01-31 22:00', start: '2026-02-01 01:00', cls: 'MEC' }, // 2 h Jan, 1 h Feb
    { stop: '2026-02-10 08:00', start: '2026-02-10 10:00', cls: 'ELE' },
    { stop: '2026-02-11 08:00', start: '2026-02-11 09:00', cls: 'PL' },
    { stop: '2026-02-12 08:00', start: '2026-02-12 08:30', cls: 'CIR' },
    { stop: '2026-02-13 08:00', start: '2026-02-13 08:30', cls: 'PRO', area: 'RM.1' },
    { stop: '2026-02-14 08:00', start: '2026-02-14 08:30', cls: 'AUT', isVoid: true },
  ]);
  const input = { rows, range: { from: '2026-01-01', to: '2026-02-28' }, dataRange: { from: '2026-01-01', to: '2026-02-28' }, areaIds: ['K.1', 'RM.1'], settings };
  const pts = monthlyHoursByClassification(input);
  it('splits hours per classification and month, ignoring voided rows', () => {
    expect(pts[0]!.hours).toMatchObject({ MEC: 2, ELE: 0, PL: 0 });
    expect(pts[1]!.hours).toMatchObject({ MEC: 1, ELE: 2, PL: 1, CIR: 0.5, PRO: 0.5, AUT: 0 });
    expect(pts[1]!.total).toBeCloseTo(5, 9);
  });
  it('sums to the planned + failure + other hours of the monthly series', () => {
    const m = monthlySeries(input);
    pts.forEach((p, i) => expect(p.total).toBeCloseTo(m[i]!.plannedHours + m[i]!.failureHours + m[i]!.otherHours, 9));
  });
  it('honours the area list, the partial flag and months without data', () => {
    const k1 = monthlyHoursByClassification({ ...input, areaIds: ['K.1'] });
    expect(k1[1]!.hours.PRO).toBe(0);
    const part = monthlyHoursByClassification({ ...input, dataRange: { from: '2026-01-15', to: '2026-02-12' } });
    expect(part[0]).toMatchObject({ hasData: true, partial: true });
    expect(part[1]).toMatchObject({ hasData: true, partial: true });
    const none = monthlyHoursByClassification({ ...input, range: { from: '2025-11-01', to: '2026-01-31' }, dataRange: { from: '2026-01-01', to: '2026-02-28' } });
    expect(none.map((p) => p.hasData)).toEqual([false, false, true]);
  });
});
