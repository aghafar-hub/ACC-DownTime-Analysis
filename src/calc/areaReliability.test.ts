import { describe, expect, it } from 'vitest';
import { buildFailureEvents } from './events';
import { createRowFactory, type RowSpec } from './fixtures';
import { composeKpis, emptySums, type AreaKpis } from './kpis';
import { areaMonthAvailability, median, mtbfMttrQuadrants, rankAreas } from './areaReliability';
import { failureStartHeatmap, reasonMonthHeatmap, WEEKDAYS } from './trends';
import { linePareto, areaPareto } from './pareto';
import { parseSettings } from './settings';

const settings = parseSettings({});

/** An area with `failures` failures, `events` events of `mttrH` hours each and 1000 operating hours. */
function area(id: string, failures: number, mttrH: number): AreaKpis {
  const s = emptySums();
  s.inc = failures * mttrH; s.events = failures; s.eventSeconds = failures * mttrH * 3600;
  const k = composeKpis(id, 1000 + s.inc, s, settings);
  return k;
}

describe('rankAreas', () => {
  const areas = [area('A', 10, 2), area('B', 0, 0), area('C', 2, 8), area('D', 5, 1)];
  it('MTBF ascending: worst (lowest) first, areas without failures last, never as zero', () => {
    const r = rankAreas(areas, (a) => a.mtbfHours, 'asc');
    expect(r.map((x) => x.area_id)).toEqual(['A', 'D', 'C', 'B']);
    expect(r[3]).toMatchObject({ value: null, code: 'no_failures' });
    expect(r[0]!.value).toBeCloseTo(1000 / 10, 9);
  });
  it('MTTR descending: slowest first, no failures last', () => {
    const r = rankAreas(areas, (a) => a.mttrHours, 'desc');
    expect(r.map((x) => x.area_id)).toEqual(['C', 'A', 'D', 'B']);
  });
  it('values equal the area KPIs', () => {
    for (const r of rankAreas(areas, (a) => a.failureRatePer1000h, 'desc')) {
      const k = areas.find((a) => a.area_id === r.area_id)!;
      expect(r.value).toBe(k.failureRatePer1000h.available ? k.failureRatePer1000h.value : null);
    }
  });
});

describe('median and quadrants', () => {
  it('median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('splits at the medians, names the worst quadrant and leaves out areas without failures', () => {
    // MTBF (1000 / failures): A 100, B 200, C 500, D 250 ; MTTR: A 6, B 1, C 8, D 2
    const areas = [area('A', 10, 6), area('B', 5, 1), area('C', 2, 8), area('D', 4, 2), area('E', 0, 0)];
    const q = mtbfMttrQuadrants(areas);
    expect(q.points.map((p) => p.area_id)).toEqual(['A', 'B', 'C', 'D']);
    expect(q.excluded.map((x) => x.area_id)).toEqual(['E']);
    expect(q.medianMtbf).toBeCloseTo(225, 6); // (200 + 250) / 2
    expect(q.medianMttr).toBeCloseTo(4, 6); // (2 + 6) / 2
    const by = Object.fromEntries(q.points.map((p) => [p.area_id, p.quadrant]));
    expect(by).toEqual({ A: 'worst', B: 'frequent_quick', C: 'rare_long', D: 'best' });
    expect(q.worst).toEqual(['A']);
  });
  it('an area on a median line is in no quadrant; one area alone has no median lines', () => {
    const q = mtbfMttrQuadrants([area('A', 10, 2), area('B', 5, 2), area('C', 2, 2)]);
    expect(q.points.every((p) => p.quadrant === 'on_median')).toBe(true);
    expect(q.worst).toEqual([]);
    const one = mtbfMttrQuadrants([area('A', 10, 2), area('E', 0, 0)]);
    expect(one.medianMtbf).toBeNull();
    expect(one.points[0]!.quadrant).toBe('on_median');
  });
});

describe('area x month availability', () => {
  const row = createRowFactory();
  const rows = [
    { area: 'K.1', stop: '2026-01-10 08:00', start: '2026-01-10 12:00' },
    { area: 'K.1', stop: '2026-02-03 08:00', start: '2026-02-03 10:00' },
    { area: 'RM.1', stop: '2026-02-04 08:00', start: '2026-02-04 11:00' },
  ].map((s) => row(s));
  const chains = buildFailureEvents(rows).chains;
  const range = { from: '2026-01-01', to: '2026-03-31' };
  it('one cell per area and month; a month without data (after the last row) is a gap, not 100 %', () => {
    const a = areaMonthAvailability({ rows, chains, range, dataRange: { from: '2026-01-01', to: '2026-02-28' }, areaIds: ['K.1', 'RM.1'], settings });
    expect(a.months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    const k1 = a.areas[0]!.values;
    expect(k1[0]).toMatchObject({ available: true });
    expect(k1[0]!.available && k1[0]!.value).toBeCloseTo(1 - 4 / (31 * 24), 9);
    expect(k1[2]!.available).toBe(false);
    expect(a.areas[1]!.values[0]!.available && a.areas[1]!.values[0]!.value).toBeCloseTo(1, 9); // RM.1 had no stop in January
  });
});

describe('heat maps and Pareto by line', () => {
  const row = createRowFactory();
  const specs: RowSpec[] = [
    { area: 'K.1', reason: 'Belt slip', stop: '2026-01-05 06:30', start: '2026-01-05 08:30' }, // Mon, 2 h
    { area: 'K.1', reason: 'belt  SLIP', stop: '2026-01-12 06:10', start: '2026-01-12 07:10' }, // Mon, 1 h
    { area: 'K.2', reason: 'Bearing', stop: '2026-01-31 23:00', start: '2026-02-01 02:00' }, // Sat 23:00, 3 h across months
    { area: 'K.2', reason: 'Bearing', stop: '2026-02-08 00:00', start: '2026-02-08 00:30' }, // Sun 00:00
    { area: 'K.1', reason: 'Planned', cls: 'PL', stop: '2026-02-09 08:00', start: '2026-02-09 09:00' },
    { area: 'K.1', reason: 'Void', isVoid: true, stop: '2026-02-10 08:00', start: '2026-02-10 09:00' },
  ];
  const rows = specs.map((s) => row(s));
  const chains = buildFailureEvents(rows).chains;
  const failures = chains.filter((c) => c.isFailure);
  const window = { from: '2026-01-01', to: '2026-02-28' };

  it('reasons by month: one reason row per match key, hours split at the month end, totals equal the failure totals', () => {
    const h = reasonMonthHeatmap(failures, window, { measure: 'hours' });
    const c = reasonMonthHeatmap(failures, window, { measure: 'count' });
    expect(h.rows.map((r) => r.label)).toEqual(['Bearing', 'Belt slip']);
    expect(c.total).toBe(4);
    expect(h.total).toBeCloseTo(2 + 1 + 3 + 0.5, 9);
    expect(h.cols.map((x) => x.key)).toEqual(['2026-01', '2026-02']);
    const bearing = h.values[0]!;
    expect(bearing[0]).toBeCloseTo(1, 9); // 23:00 to 24:00 in January
    expect(bearing[1]).toBeCloseTo(2.5, 9);
    expect(reasonMonthHeatmap(failures, window, { measure: 'hours', maxRows: 1 }).omittedRows).toBe(1);
  });

  it('hour x weekday: 24 hour rows, Monday to Sunday columns, counts sum to the failure events, hours to their durations', () => {
    const c = failureStartHeatmap(failures, window, { measure: 'count' });
    expect(c.rows).toHaveLength(24);
    expect(c.cols.map((x) => x.label)).toEqual([...WEEKDAYS]);
    expect(c.total).toBe(failures.length);
    expect(c.values[6]![0]).toBe(2); // 06:xx on Monday
    expect(c.values[23]![5]).toBe(1); // 23:xx on Saturday
    expect(c.values[0]![6]).toBe(1); // 00:xx on Sunday
    expect(c.rows[6]!.total).toBe(2);
    const h = failureStartHeatmap(failures, window, { measure: 'hours' });
    expect(h.total).toBeCloseTo(failures.reduce((s, x) => s + x.durationS / 3600, 0), 9);
    expect(h.values[23]![5]).toBeCloseTo(3, 9);
    // events that start outside the window are not counted
    expect(failureStartHeatmap(failures, { from: '2026-02-01', to: '2026-02-28' }, { measure: 'count' }).total).toBe(1);
  });

  it('Pareto by line: the line of the area in the master data; totals equal the area Pareto', () => {
    const lineOf = (a: string) => (a.endsWith('.2') ? 'L.2' : 'L.1');
    for (const measure of ['hours', 'count'] as const) {
      const l = linePareto(failures, { measure, window, lineOf, lineLabel: (x) => `Line ${x}` });
      expect(l.total).toBeCloseTo(areaPareto(failures, { measure, window }).total, 9);
      expect(l.bars.map((b) => b.label)).toContain('Line L.2');
    }
    expect(linePareto(failures, { measure: 'count', window, lineOf }).bars.map((b) => [b.key, b.value])).toEqual([['L.1', 2], ['L.2', 2]]);
  });
});
