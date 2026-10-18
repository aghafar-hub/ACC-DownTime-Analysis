// The owner-approved analytical rules P1-P7 (docs/architecture-and-build-plan.md section 8), each on a small fixture.
import { describe, expect, it } from 'vitest';
import { attributeRows, attributedHours, classPrecedence, duplicateKey } from './attribution';
import { buildFailureEvents, chainHours, exactDuplicates, isFailureHead } from './events';
import { emptyFilter, filterChains } from './filters';
import { createRowFactory, fixtureIndex } from './fixtures';
import { hasFailureFlagMismatch, isInfoFlag } from './flags';
import { compareTotal, computeKpis, computeKpisWithComparison, notUploadedMonths, periodCoverage, totalsScaling, type KpiOk } from './kpis';
import { avail, type Metric } from './metric';
import { areaPareto, classificationPareto, equipmentPareto } from './pareto';
import { findRepeatedFailures, groupOccurrences } from './repeats';
import { DEFAULT_SETTINGS } from './settings';
import { rangeToInterval } from './time';
import { dailySeries, monthlyHoursByClassification, monthlySeries, yearOverYear } from './trends';
import { areaMonthAvailability } from './areaReliability';

const settings = DEFAULT_SETTINGS;
const DAY = { from: '2026-03-02', to: '2026-03-02' };
const ok = (r: ReturnType<typeof computeKpis>): KpiOk => {
  if (r.status !== 'ok') throw new Error(`expected ok: ${r.reason}`);
  return r;
};
const val = (m: Metric): number => {
  if (!m.available) throw new Error(`unavailable: ${m.reason}`);
  return m.value;
};

describe('P1: overlapping stops in one area count once', () => {
  it('area downtime is the union; shared time goes to PL, then INC, then CIR', () => {
    const row = createRowFactory('U');
    const rows = [
      row({ stop: '2026-03-02 08:00', start: '2026-03-02 10:00', cls: 'MEC' }), // INC 08-10
      row({ stop: '2026-03-02 09:00', start: '2026-03-02 11:00', cls: 'PL' }), // PL 09-11 wins 09-10
      row({ stop: '2026-03-02 12:00', start: '2026-03-02 16:00', cls: 'CIR' }), // CIR 12-16
      row({ stop: '2026-03-02 13:00', start: '2026-03-02 14:00', cls: 'ELE' }), // INC wins 13-14 over CIR
    ];
    const t = ok(computeKpis({ rows, window: DAY, settings })).total;
    expect(t.downtimeHours).toBeCloseTo(7, 9); // 08-11 and 12-16, not 2 + 2 + 4 + 1 = 9
    expect(t.plannedHours).toBeCloseTo(2, 9);
    expect(t.failureHours).toBeCloseTo(2, 9); // 08-09 and 13-14
    expect(t.otherHours).toBeCloseTo(3, 9); // 12-13 and 14-16
    expect(val(t.operatingHours)).toBeCloseTo(24 - 7, 9);
    expect(val(t.availability.A)).toBeCloseTo(17 / 24, 9);
    expect(val(t.availability.B)).toBeCloseTo((24 - 2 - 5) / 22, 9);
    expect(val(t.availability.C)).toBeCloseTo((24 - 2 - 3 - 2) / 19, 9);
    // MTBF uses the union too: 2 failure events (MEC and ELE heads)
    expect(t.failureCount).toBe(2);
    expect(val(t.mtbfHours)).toBeCloseTo(17 / 2, 9);
  });

  it('same class: the row that started first owns the shared time; other areas are independent (area-hours)', () => {
    const row = createRowFactory('S');
    const a = row({ stop: '2026-03-02 08:00', start: '2026-03-02 10:00', code: '100.A1' });
    const b = row({ stop: '2026-03-02 09:00', start: '2026-03-02 11:00', code: '100.A2' });
    const other = row({ area: 'RM.1', stop: '2026-03-02 08:00', start: '2026-03-02 10:00', code: '200.B1' });
    const attr = attributeRows([a, b, other]);
    expect(attributedHours(a, null, attr)).toBeCloseTo(2, 9);
    expect(attributedHours(b, null, attr)).toBeCloseTo(1, 9);
    expect(attributedHours(other, null, attr)).toBeCloseTo(2, 9);
    expect(classPrecedence('PL')).toBeLessThan(classPrecedence('AUT'));
    expect(classPrecedence('AUT')).toBeLessThan(classPrecedence('CIR'));
    // a subset of areas keeps the same attribution
    expect(attributedHours(b, null, attributeRows([a, b]))).toBeCloseTo(1, 9);
  });

  it('Pareto attribution: Pareto totals equal the KPI hours of the same scope', () => {
    const row = createRowFactory('P');
    const rows = [
      row({ stop: '2026-03-02 08:00', start: '2026-03-02 10:00', code: '100.A1', reason: 'Bearing failure' }),
      row({ stop: '2026-03-02 09:00', start: '2026-03-02 12:00', code: '100.A2', reason: 'Belt slip' }),
      row({ stop: '2026-03-02 11:30', start: '2026-03-02 13:00', code: 'N/A', cls: 'PL' }),
    ];
    const chains = buildFailureEvents(rows).chains;
    const attr = attributeRows(rows);
    const k = ok(computeKpis({ rows, window: DAY, settings, attribution: attr }));
    const all = classificationPareto(chains, { measure: 'hours', window: DAY, attribution: attr });
    expect(all.total).toBeCloseTo(k.total.downtimeHours, 9); // 08-13 = 5 h
    expect(k.total.downtimeHours).toBeCloseTo(5, 9);
    const eq = equipmentPareto(chains, fixtureIndex(), { measure: 'hours', window: DAY, attribution: attr });
    const eqTotal = eq.own.total + eq.otherAreas.total + eq.unassigned.total + eq.areaLevel.total + eq.unknown.total;
    expect(eqTotal).toBeCloseTo(k.total.failureHours, 9); // 08-11:30 = 3.5 h; PL owns 11:30-12
    expect(eq.own.bars.find((b) => b.key === '100.A1')!.value).toBeCloseTo(2, 9); // started first
    expect(eq.own.bars.find((b) => b.key === '100.A2')!.value).toBeCloseTo(1.5, 9);
    // the default attribution (over the chains passed in) gives the same when every chain is passed
    expect(classificationPareto(chains, { measure: 'hours', window: DAY }).total).toBeCloseTo(5, 9);
  });

  it('monthly, daily and class series use the same attribution as computeKpis', () => {
    const row = createRowFactory('M');
    const rows = [
      row({ stop: '2026-03-31 20:00', start: '2026-04-01 04:00', cls: 'MEC' }),
      row({ stop: '2026-03-31 22:00', start: '2026-04-01 02:00', cls: 'PL' }),
    ];
    const range = { from: '2026-03-01', to: '2026-04-30' };
    const m = monthlySeries({ rows, range, settings });
    expect(m[0]!.plannedHours + m[0]!.failureHours).toBeCloseTo(4, 9); // 20-24 in March: PL 22-24, MEC 20-22
    expect(m[0]!.plannedHours).toBeCloseTo(2, 9);
    expect(m[1]!.plannedHours).toBeCloseTo(2, 9);
    expect(m[1]!.failureHours).toBeCloseTo(2, 9);
    const cls = monthlyHoursByClassification({ rows, range });
    expect(cls[0]!.total).toBeCloseTo(4, 9);
    expect(cls[1]!.hours.MEC).toBeCloseTo(2, 9);
    const days = dailySeries({ rows, range: { from: '2026-03-31', to: '2026-04-01' }, settings });
    expect(days.map((d) => d.downtimeHours)).toEqual([4, 4]);
    const k = ok(computeKpis({ rows, window: range, settings }));
    expect(k.total.downtimeHours).toBeCloseTo(8, 9);
  });

  it('exact duplicates (same area, code, stop, restart and class) count once: hours and failures', () => {
    const row = createRowFactory('D');
    const a = row({ stop: '2026-03-02 08:00', start: '2026-03-02 10:00' });
    const dup = row({ stop: '2026-03-02 08:00', start: '2026-03-02 10:00' });
    const otherCls = row({ stop: '2026-03-02 08:00', start: '2026-03-02 10:00', cls: 'ELE' }); // not a duplicate (class differs)
    expect(duplicateKey(a)).toBe(duplicateKey(dup));
    expect(exactDuplicates([a, dup])).toEqual([dup]);
    const k = ok(computeKpis({ rows: [a, dup], window: DAY, settings })).total;
    expect(k.downtimeHours).toBeCloseTo(2, 9);
    expect(k.failureCount).toBe(1);
    const k2 = ok(computeKpis({ rows: [a, dup, otherCls], window: DAY, settings })).total;
    expect(k2.downtimeHours).toBeCloseTo(2, 9);
    expect(k2.failureCount).toBe(2); // two different stops at the same time: two events, hours once
  });
});

describe('P2: failures are failure events, not rows', () => {
  const row = createRowFactory('F');
  const rows = [
    row({ stop: '2026-03-02 08:00', start: '2026-03-02 09:00' }), // failure event head
    row({ stop: '2026-03-02 09:00', start: '2026-03-02 10:00', freq: 0, failure: true }), // continuation says YES: same event
    row({ stop: '2026-03-02 11:00', start: '2026-03-02 12:00', cls: 'PL', failure: true }), // PL with YES: not a failure
    row({ stop: '2026-03-02 13:00', start: '2026-03-02 14:00', cls: 'CIR', failure: true }), // CIR with YES: not a failure
    row({ stop: '2026-03-02 15:00', start: '2026-03-02 16:00', failure: false }), // incidental, Failure NO
    row({ stop: '2026-03-02 17:00', start: '2026-03-02 18:00', freq: 0, failure: true }), // orphan continuation: not a failure
  ];
  it('counts chains whose head is Freq 1, Failure YES and not PL / CIR', () => {
    const b = buildFailureEvents(rows);
    expect(b.failureEvents.map((c) => c.id)).toEqual([rows[0]!.event_id]);
    expect(rows.map(isFailureHead)).toEqual([true, false, false, false, false, false]);
    const t = ok(computeKpis({ rows, window: DAY, settings })).total;
    expect(t.failureCount).toBe(1); // the old row count was 5
    expect(t.failureEventCount).toBe(1);
    expect(val(t.mtbfHours)).toBeCloseTo(val(t.operatingHours) / 1, 9);
    expect(val(t.failureRatePer1000h)).toBeCloseTo(1000 / val(t.operatingHours), 9);
  });
  it('marks Failure YES on PL / CIR / Freq 0 rows with the derived warning failure_flag_mismatch', () => {
    expect(rows.map(hasFailureFlagMismatch)).toEqual([false, true, true, true, false, true]);
    expect(isInfoFlag('failure_flag_mismatch')).toBe(false);
    expect(isInfoFlag('overlap_in_area')).toBe(true);
  });
  it('repeats count failure events: a PL row with Failure YES never makes a group', () => {
    const r = createRowFactory('R');
    const rr = [
      r({ stop: '2026-03-02 08:00', start: '2026-03-02 09:00', reason: 'Belt slip' }),
      r({ stop: '2026-03-05 08:00', start: '2026-03-05 09:00', reason: 'Belt slip', cls: 'PL', failure: true }),
    ];
    expect(findRepeatedFailures(buildFailureEvents(rr).chains, { settings }).groups).toEqual([]);
  });
});

describe('P3: event-level filters keep whole events; KPI and Pareto agree', () => {
  const row = createRowFactory('E');
  const rows = [
    row({ stop: '2026-03-02 08:00', start: '2026-03-02 09:00', cls: 'MEC', code: '100.A1' }), // failure head
    row({ stop: '2026-03-02 09:00', start: '2026-03-02 11:30', cls: 'PL', freq: 0, failure: false }), // its continuation (PL)
    row({ stop: '2026-03-02 13:00', start: '2026-03-02 13:10', cls: 'ELE', code: '100.A2' }), // short failure
    row({ stop: '2026-03-02 15:00', start: '2026-03-02 16:00', cls: 'PL', code: 'N/A' }), // planned event
  ];
  const ctx = { settings, index: fixtureIndex() };
  const chains = buildFailureEvents(rows).chains;
  const kpiOf = (kept: typeof chains) => {
    const kpiRows = kept.flatMap((c) => c.rows);
    const attribution = attributeRows(kpiRows);
    return { k: ok(computeKpis({ rows: kpiRows, chains: kept, window: DAY, dataRange: DAY, settings, attribution })), attribution };
  };
  it('Failures only keeps the failure events WITH their continuation rows', () => {
    const kept = filterChains(chains, { ...emptyFilter(), failureOnly: true }, ctx);
    expect(kept.map((c) => c.id)).toEqual([rows[0]!.event_id, rows[2]!.event_id]);
    const { k, attribution } = kpiOf(kept);
    expect(k.total.downtimeHours).toBeCloseTo(1 + 2.5 + 10 / 60, 9);
    expect(k.total.plannedHours).toBeCloseTo(2.5, 9); // the PL continuation of a kept event counts
    const area = areaPareto(kept, { measure: 'hours', window: DAY, attribution });
    expect(area.total).toBeCloseTo(k.total.downtimeHours, 9);
  });
  it('duration band uses the WHOLE event: 1 h + 2.5 h is long, the 10 min stop is short', () => {
    expect(filterChains(chains, { ...emptyFilter(), durationBand: 'long' }, ctx).map((c) => c.id)).toEqual([rows[0]!.event_id]);
    expect(filterChains(chains, { ...emptyFilter(), durationBand: 'short' }, ctx).map((c) => c.id)).toEqual([rows[2]!.event_id]);
    expect(filterChains(chains, { ...emptyFilter(), durationBand: 'medium' }, ctx).map((c) => c.id)).toEqual([rows[3]!.event_id]);
  });
  it('classification and criticality select events by the head row; KPI == classification Pareto for the scope', () => {
    const pl = filterChains(chains, { ...emptyFilter(), classifications: ['PL'] }, ctx);
    expect(pl.map((c) => c.id)).toEqual([rows[3]!.event_id]); // the PL continuation does not make its event a PL event
    const inc = filterChains(chains, { ...emptyFilter(), criticality: ['INC'] }, ctx);
    expect(inc.map((c) => c.id)).toEqual([rows[0]!.event_id, rows[2]!.event_id]);
    const { k, attribution } = kpiOf(inc);
    expect(classificationPareto(inc, { measure: 'hours', window: DAY, attribution }).total).toBeCloseTo(k.total.downtimeHours, 9);
  });
});

describe('P4: one MTBF rule: all-area operating area-hours / failure events', () => {
  it('the aggregate equals the summed operating area-hours over all failure events, never an average of areas', () => {
    const row = createRowFactory('B');
    const rows = [
      row({ stop: '2026-03-02 08:00', start: '2026-03-02 10:00' }),
      row({ stop: '2026-03-02 12:00', start: '2026-03-02 13:00' }),
      row({ area: 'RM.1', stop: '2026-03-02 08:00', start: '2026-03-02 14:00', code: '200.B1' }),
    ];
    const k = ok(computeKpis({ rows, window: DAY, settings }));
    const op = k.areas.reduce((s, a) => s + val(a.operatingHours), 0);
    expect(val(k.total.mtbfHours)).toBeCloseTo(op / 3, 9);
    expect(val(k.total.mtbfHours)).not.toBeCloseTo((val(k.areas[0]!.mtbfHours) + val(k.areas[1]!.mtbfHours)) / 2, 3);
    const m = monthlySeries({ rows, range: { from: '2026-03-01', to: '2026-03-31' }, settings });
    expect(m[0]!.failureCount).toBe(3);
  });
});

describe('P5: repeated failures across areas and bursts', () => {
  const r = createRowFactory('X');
  const at = (area: string, stop: string, start: string) => r({ area, stop, start, code: '100.A2', reason: 'Belt slip' });
  it('the same code and reason in different areas within 10 minutes is one occurrence', () => {
    const rows = [
      at('K.1', '2026-03-02 08:00', '2026-03-02 08:30'),
      at('RM.1', '2026-03-02 08:09', '2026-03-02 08:40'), // 9 min later, other area: same occurrence
      at('CM.1', '2026-03-02 08:11', '2026-03-02 08:20'), // 11 min after the first: a new occurrence
    ];
    const chains = buildFailureEvents(rows).chains.sort((a, b) => a.startMs - b.startMs);
    const occ = groupOccurrences(chains);
    expect(occ.map((o) => o.areaIds)).toEqual([['K.1', 'RM.1'], ['CM.1']]);
    const res = findRepeatedFailures(chains, { settings });
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]).toMatchObject({ occurrences: 2, recurrenceCount: 1, mergedOccurrences: 1, burstCount: 0, areaIds: ['CM.1', 'K.1', 'RM.1'] });
    expect(res.groups[0]!.eventIds).toHaveLength(3);
    expect(res.groups[0]!.totalHours).toBeCloseTo(0.5 + 31 / 60 + 9 / 60, 9);
    expect(res.recurrences[0]).toMatchObject({ areaId: 'CM.1', burst: false });
  });
  it('two areas within 10 minutes alone are one occurrence: no repeated group', () => {
    const rows = [at('K.1', '2026-03-02 08:00', '2026-03-02 08:30'), at('RM.1', '2026-03-02 08:05', '2026-03-02 08:20')];
    expect(findRepeatedFailures(buildFailureEvents(rows).chains, { settings }).groups).toEqual([]);
  });
  it('the same area within 10 minutes is never merged; less than 1 h after the restart is a burst that still counts', () => {
    const rows = [
      at('K.1', '2026-03-02 08:00', '2026-03-02 08:30'),
      at('K.1', '2026-03-02 08:35', '2026-03-02 08:40'), // 5 min after the restart: burst
      at('K.1', '2026-03-02 10:00', '2026-03-02 10:10'), // 80 min after: not a burst
      at('RM.1', '2026-03-02 10:20', '2026-03-02 10:30'), // other area, 20 min after: new occurrence, first in RM.1
    ];
    const res = findRepeatedFailures(buildFailureEvents(rows).chains, { settings });
    expect(res.groups[0]).toMatchObject({ occurrences: 4, burstCount: 1, recurrenceCount: 3 });
    expect(res.recurrences.map((x) => x.burst)).toEqual([true, false, false]);
  });
  it('previousPeriodOccurrences merges across areas the same way, so it compares like with like', () => {
    const rows = [
      at('K.1', '2026-02-02 08:00', '2026-02-02 08:30'), at('RM.1', '2026-02-02 08:04', '2026-02-02 08:30'), // previous: 1 occurrence
      at('K.1', '2026-03-02 08:00', '2026-03-02 08:30'), at('K.1', '2026-03-05 08:00', '2026-03-05 08:30'),
    ];
    const res = findRepeatedFailures(buildFailureEvents(rows).chains, {
      settings, window: { from: '2026-03-01', to: '2026-03-31' }, previousWindow: { from: '2026-02-01', to: '2026-02-28' },
    });
    expect(res.groups[0]).toMatchObject({ occurrences: 2, previousPeriodOccurrences: 1 });
  });
});

describe('P6: months with no records at all are Not uploaded', () => {
  const row = createRowFactory('N');
  const rows = [
    row({ stop: '2026-01-10 08:00', start: '2026-01-10 10:00' }),
    // February: nothing at all (not uploaded)
    row({ stop: '2026-03-10 08:00', start: '2026-03-10 10:00', area: 'RM.1', code: '200.B1' }),
    row({ stop: '2026-04-30 22:00', start: '2026-05-01 00:00:00', area: 'RM.1', code: '200.B1' }), // a restart at midnight does not upload May
    row({ stop: '2026-06-10 08:00', start: '2026-06-10 09:00' }),
  ];
  const range = { from: '2026-01-01', to: '2026-06-30' };
  it('finds the months inside the coverage without a record (voided rows do not count, a midnight restart does not reach the next month)', () => {
    expect(notUploadedMonths(rows)).toEqual(['2026-02', '2026-05']);
    expect(notUploadedMonths([...rows, row({ stop: '2026-02-03 08:00', start: '2026-02-03 09:00', isVoid: true })])).toEqual(['2026-02', '2026-05']);
    expect(notUploadedMonths([...rows, row({ stop: '2026-01-31 23:00', start: '2026-02-01 01:00' })])).toEqual(['2026-05']);
  });
  it('monthly series: hasData false and Not uploaded, never 0 h or 100 %', () => {
    const m = monthlySeries({ rows, range, settings });
    const feb = m.find((p) => p.month === '2026-02')!;
    expect(feb).toMatchObject({ hasData: false, notUploaded: true });
    expect(feb.availability).toMatchObject({ available: false, code: 'not_uploaded' });
    expect(m.find((p) => p.month === '2026-03')).toMatchObject({ hasData: true, notUploaded: false });
    const cls = monthlyHoursByClassification({ rows, range });
    expect(cls.find((p) => p.month === '2026-05')).toMatchObject({ hasData: false, notUploaded: true });
    const days = dailySeries({ rows, range: { from: '2026-02-27', to: '2026-03-01' }, settings });
    expect(days.map((d) => [d.hasData, d.notUploaded])).toEqual([[false, true], [false, true], [true, false]]);
  });
  it('KPIs leave the months out of T; a window that is only a not-uploaded month has no data', () => {
    const k = ok(computeKpis({ rows, window: range, settings })); // data 10 Jan to 10 Jun: 152 days
    expect(k.notUploaded).toEqual(['2026-02', '2026-05']);
    expect(k.coveredDays).toBe(152 - 28 - 31);
    expect(k.total.scheduledHours).toBe((152 - 28 - 31) * 24 * 2);
    expect(computeKpis({ rows, window: { from: '2026-02-01', to: '2026-02-28' }, settings })).toMatchObject({ status: 'no_data' });
    // the plant-wide list is passed in by the dashboards; a filtered scope with an explicit data range does not re-derive it
    const one = rows.filter((r) => r.area_id === 'K.1');
    expect(ok(computeKpis({ rows: one, window: range, dataRange: range, settings, notUploaded: ['2026-02', '2026-05'] })).total.scheduledHours).toBe((181 - 59) * 24);
  });
  it('area x month availability marks the months; year over year says Not uploaded', () => {
    const a = areaMonthAvailability({ rows, range, settings, areaIds: ['K.1', 'RM.1'], notUploaded: ['2026-02', '2026-05'], dataRange: { from: '2026-01-10', to: '2026-06-10' } });
    expect(a.months.filter((x) => x.notUploaded).map((x) => x.month)).toEqual(['2026-02', '2026-05']);
    expect(a.areas[0]!.values[1]).toMatchObject({ available: false, code: 'not_uploaded' });
    const y = yearOverYear({ rows, year: 2026, settings });
    expect(y[1]!.current.notUploaded).toBe(true);
    expect(y[1]!.failureHours).toMatchObject({ available: false });
  });
});

describe('P7: comparisons with a partly covered comparison period', () => {
  const row = createRowFactory('C');
  // data starts on 20 February: the previous month of March is covered for 9 of 28 days
  const rows = [
    row({ stop: '2026-02-20 08:00', start: '2026-02-20 17:00' }),
    row({ stop: '2026-03-05 08:00', start: '2026-03-05 10:00' }),
    row({ stop: '2026-03-31 08:00', start: '2026-03-31 10:00' }),
  ];
  it('coverage, scaling and the note', () => {
    expect(periodCoverage({ from: '2026-02-01', to: '2026-02-28' }, { from: '2026-02-20', to: '2026-03-31' })).toEqual({ coveredDays: 9, totalDays: 28, fraction: 9 / 28 });
    expect(periodCoverage({ from: '2026-02-01', to: '2026-02-28' }, { from: '2026-02-01', to: '2026-03-31' }, ['2026-02']).coveredDays).toBe(0);
    const s = totalsScaling(31, periodCoverage({ from: '2026-02-01', to: '2026-02-28' }, { from: '2026-02-20', to: '2026-03-31' }));
    expect(s).toMatchObject({ perDay: true, currentDays: 31, previousDays: 9, previousTotalDays: 28, note: 'per day (previous period only partly covered: 9 of 28 days)' });
    expect(totalsScaling(31, { coveredDays: 26, totalDays: 28, fraction: 26 / 28 }).perDay).toBe(false); // 93 %: totals as usual
  });
  it('totals become per-day rates without a verdict; ratios stay as they are', () => {
    const c = computeKpisWithComparison({ rows, window: { from: '2026-03-01', to: '2026-03-31' }, settings }, 'previous_period');
    expect(c.previousCoverage).toMatchObject({ coveredDays: 9, totalDays: 28 });
    expect(c.scaling?.perDay).toBe(true);
    const fh = c.changes!.failureHours;
    if (!fh.available) throw new Error('expected a change');
    expect(fh).toMatchObject({ perDay: true, assessment: 'neutral', note: 'per day (previous period only partly covered: 9 of 28 days)' });
    expect(fh.current).toBeCloseTo(4 / 31, 9);
    expect(fh.previous).toBeCloseTo(9 / 9, 9);
    const fc = c.changes!.failureCount;
    expect(fc.available && fc.perDay).toBe(true);
    const av = c.changes!.availability;
    expect(av.available && av.perDay).toBeFalsy();
    expect(av.available && av.assessment).toBe('good');
  });
  it('a fully covered comparison period compares totals with a verdict', () => {
    const full = [...rows, row({ stop: '2026-02-01 08:00', start: '2026-02-01 09:00' })];
    const c = computeKpisWithComparison({ rows: full, window: { from: '2026-03-01', to: '2026-03-31' }, settings }, 'previous_period');
    expect(c.scaling?.perDay).toBe(false);
    const fh = c.changes!.failureHours;
    expect(fh.available && fh.perDay).toBeFalsy();
    expect(fh.available && fh.assessment).toBe('good'); // 4 h against 10 h
  });
  it('a month not uploaded inside the CURRENT period also compares per day (no false "better")', () => {
    // previous period (29 Nov - 28 Feb) fully covered; the current one (Mar - May) has April not uploaded
    const r2 = [
      row({ stop: '2025-11-29 08:00', start: '2025-11-29 18:00' }), row({ stop: '2025-12-10 08:00', start: '2025-12-10 18:00' }),
      row({ stop: '2026-01-10 08:00', start: '2026-01-10 18:00' }), row({ stop: '2026-02-10 08:00', start: '2026-02-10 18:00' }),
      row({ stop: '2026-03-10 08:00', start: '2026-03-10 18:00' }), row({ stop: '2026-05-10 08:00', start: '2026-05-10 18:00' }),
      row({ stop: '2026-05-31 08:00', start: '2026-05-31 09:00' }),
    ];
    const c = computeKpisWithComparison({ rows: r2, window: { from: '2026-03-01', to: '2026-05-31' }, settings }, 'previous_period');
    expect(c.previousCoverage?.fraction).toBe(1);
    expect(c.scaling).toMatchObject({ perDay: true, note: 'per day (this period only partly covered: 62 of 92 days)' });
    const fh = c.changes!.failureHours;
    expect(fh).toMatchObject({ perDay: true, assessment: 'neutral' });
    expect(totalsScaling(62, { coveredDays: 92, totalDays: 92, fraction: 1 }, 'previous period', { coveredDays: 85, totalDays: 92, fraction: 85 / 92 }).perDay).toBe(false); // 92 %
  });
  it('compareTotal without a scaling is compareValues', () => {
    expect(compareTotal(avail(2), avail(4), 'lower', null)).toMatchObject({ assessment: 'good', abs: -2 });
  });
  it('chain hours with an attribution are clipped to the window', () => {
    const c = buildFailureEvents(rows).chains[0]!;
    expect(chainHours(c, rangeToInterval({ from: '2026-02-20', to: '2026-02-20' }), attributeRows(rows))).toBeCloseTo(9, 9);
  });
});
