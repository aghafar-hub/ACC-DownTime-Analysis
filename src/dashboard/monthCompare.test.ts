import { describe, expect, it } from 'vitest';
import type { Startup } from '../api/types';
import { computeKpis, buildIndex, dataRangeOf, monthRange, parseSettings, type Metric } from '../calc';
import { buildSyntheticDb } from '../mock/synthetic';
import { defaultFilters } from './filters';
import { defaultMonthPair, isCompleteMonth, monthCompareModel, monthPairText, monthsWithData, parseMonthPair, type CompareId } from './monthCompare';
import { overviewModel } from './models';
import { buildCtx } from './scope';

const db = buildSyntheticDb();
const startup: Startup = {
  lines: db.lines, areas: db.areas, equipment: db.equipment, equipment_areas: db.equipment_areas, aliases: db.aliases,
  classifications: db.classifications, reasons: db.reasons, settings: db.settings, years: [2026, 2025],
};
const rows = db.events;
const months = monthsWithData(rows);
const coverage = dataRangeOf(rows.filter((r) => !r.is_void))!;
const pair = defaultMonthPair(months, coverage)!;
const val = (m: Metric): number | null => (m.available ? m.value : null);

/** What the Overview shows with its range set to one month. */
function dashboardFor(month: string, patch = {}) {
  const f = { ...defaultFilters(), ...patch };
  return overviewModel(buildCtx(rows, startup, f, monthRange(month)));
}

describe('months and the pair in the address', () => {
  it('lists the months with counted records, oldest first, and defaults to the last two COMPLETE months', () => {
    expect(months.length).toBeGreaterThan(2);
    expect([...months].sort()).toEqual(months);
    // the mock data ends inside its last month: that month is skipped by default
    const last = months[months.length - 1]!;
    expect(isCompleteMonth(last, coverage)).toBe(false);
    expect(pair).toEqual({ a: months[months.length - 2], b: months[months.length - 3] });
    expect(isCompleteMonth(pair.a, coverage) && isCompleteMonth(pair.b, coverage)).toBe(true);
    expect(defaultMonthPair([])).toBeNull();
    expect(defaultMonthPair(['2026-03'])).toEqual({ a: '2026-03', b: '2026-03' });
    // without coverage every month counts: the latest and the one before
    expect(defaultMonthPair(months)).toEqual({ a: last, b: months[months.length - 2] });
  });
  it('complete months: Sep and Aug while October is in progress; fallbacks with fewer complete months', () => {
    const ms = ['2026-08', '2026-09', '2026-10'];
    expect(defaultMonthPair(ms, { from: '2026-08-01', to: '2026-10-13' })).toEqual({ a: '2026-09', b: '2026-08' });
    expect(defaultMonthPair(ms, { from: '2026-08-01', to: '2026-10-31' })).toEqual({ a: '2026-10', b: '2026-09' });
    // data starts on 5 Aug: only September is complete -> September against August
    expect(defaultMonthPair(ms, { from: '2026-08-05', to: '2026-10-13' })).toEqual({ a: '2026-09', b: '2026-08' });
    // no complete month at all: the latest and the one before
    expect(defaultMonthPair(['2026-10'], { from: '2026-10-01', to: '2026-10-13' })).toEqual({ a: '2026-10', b: '2026-10' });
    expect(defaultMonthPair(ms, null)).toEqual({ a: '2026-10', b: '2026-09' });
  });
  it('reads mvm=A,B and also cmp=A,B; the comparison mode in cmp is not a pair', () => {
    expect(parseMonthPair(new URLSearchParams('mvm=2026-02,2026-01'))).toEqual({ a: '2026-02', b: '2026-01' });
    expect(parseMonthPair(new URLSearchParams('cmp=2026-02,2026-01'))).toEqual({ a: '2026-02', b: '2026-01' });
    expect(parseMonthPair(new URLSearchParams('cmp=previous_period'))).toBeNull();
    expect(parseMonthPair(new URLSearchParams('mvm=2026-13,2026-01'))).toBeNull();
    expect(parseMonthPair(new URLSearchParams('mvm=2026-02'))).toBeNull();
    expect(monthPairText({ a: '2026-02', b: '2026-01' })).toBe('2026-02,2026-01');
  });
});

describe('monthCompareModel', () => {
  const m = monthCompareModel(rows, startup, defaultFilters(), pair);
  const row = (id: CompareId) => m.rows.find((r) => r.id === id)!;

  it('has the ten rows in the documented order', () => {
    expect(m.rows.map((r) => r.id)).toEqual(['stoppage', 'failureHours', 'planned', 'other', 'failureCount', 'operating', 'availability', 'mttr', 'mtbf', 'repeated']);
    expect(m.hasA && m.hasB).toBe(true);
  });

  it('each month equals the dashboard KPIs for the same single-month range', () => {
    for (const [side, month] of [['a', pair.a], ['b', pair.b]] as const) {
      const d = dashboardFor(month).kpi!;
      expect(d).toBeTruthy();
      expect(val(row('stoppage')[side])).toBeCloseTo(d.total.downtimeHours, 9);
      expect(val(row('failureHours')[side])).toBeCloseTo(d.total.failureHours, 9);
      expect(val(row('planned')[side])).toBeCloseTo(d.total.plannedHours, 9);
      expect(val(row('other')[side])).toBeCloseTo(d.total.otherHours, 9);
      expect(val(row('failureCount')[side])).toBe(d.total.failureCount);
      expect(row('operating')[side]).toEqual(d.total.operatingHours);
      expect(row('availability')[side]).toEqual(d.total.availabilityHeadline);
      expect(row('mttr')[side]).toEqual(d.total.mttrHours);
      expect(row('mtbf')[side]).toEqual(d.total.mtbfHours);
      expect(val(row('repeated')[side])).toBe(d.repeatedFailureCount);
    }
  });

  it('also equals a direct computeKpis call', () => {
    const cov = dataRangeOf(rows.filter((r) => !r.is_void))!;
    const areaIds = m.areas.map((a) => a.area_id);
    const direct = computeKpis({ rows: rows.filter((r) => areaIds.includes(r.area_id)), window: monthRange(pair.a), dataRange: cov, areaIds, settings: parseSettings(db.settings), index: buildIndex(db) });
    if (direct.status !== 'ok') throw new Error('no data');
    expect(val(row('stoppage').a)).toBeCloseTo(direct.total.downtimeHours, 9);
    expect(val(row('failureCount').a)).toBe(direct.total.failureCount);
  });

  it('the change is A against B with the usual better / worse rules', () => {
    const r = row('stoppage');
    if (!r.change.available) throw new Error('no change');
    expect(r.change.abs).toBeCloseTo(val(r.a)! - val(r.b)!, 9);
    expect(r.change.assessment).toBe(r.change.abs === 0 ? 'neutral' : r.change.abs < 0 ? 'good' : 'bad');
    expect(row('planned').change).toMatchObject({ assessment: 'neutral' });
    const av = row('availability').change;
    if (av.available && av.abs !== 0) expect(av.assessment).toBe(av.abs > 0 ? 'good' : 'bad');
  });

  it('per-area KPIs of each month, in the dashboard area order', () => {
    expect(m.areas.length).toBeGreaterThan(1);
    const total = m.areas.reduce((s, a) => s + (a.a?.downtimeHours ?? 0), 0);
    expect(total).toBeCloseTo(val(row('stoppage').a)!, 6);
  });

  it('respects the line filter and equals the dashboard with that line', () => {
    const line = db.lines[0]!.line_id;
    const lm = monthCompareModel(rows, startup, { ...defaultFilters(), lineIds: [line] }, pair);
    const d = dashboardFor(pair.a, { lineIds: [line] }).kpi!;
    expect(val(lm.rows[0]!.a)).toBeCloseTo(d.total.downtimeHours, 9);
    expect(val(lm.rows[0]!.a)).toBeLessThan(val(row('stoppage').a)!);
    expect(lm.areas.every((a) => db.areas.find((x) => x.area_id === a.area_id)!.line_id === line)).toBe(true);
  });

  it('ignores the date range and the comparison filters', () => {
    const other = monthCompareModel(rows, startup, { ...defaultFilters(), preset: 'last7', compare: 'same_period_last_year' }, pair);
    expect(other.rows).toEqual(m.rows);
  });

  it('a month without data gives unavailable values and no change', () => {
    const e = monthCompareModel(rows, startup, defaultFilters(), { a: pair.a, b: '1999-01' });
    expect(e.hasB).toBe(false);
    expect(e.rows[0]!.b.available).toBe(false);
    expect(e.rows[0]!.change.available).toBe(false);
  });

  it('same month on both sides gives no change', () => {
    const s = monthCompareModel(rows, startup, defaultFilters(), { a: pair.a, b: pair.a });
    for (const r of s.rows) if (r.change.available) expect(r.change.direction).toBe('flat');
  });

  it('a partial month shows hours and counts per day with data and no better / worse verdict', () => {
    const last = months[months.length - 1]!;
    const p = monthCompareModel(rows, startup, defaultFilters(), { a: last, b: pair.a });
    expect(p.partialA).toBe(true);
    expect(p.partialB).toBe(false);
    expect(p.perDay).toBe(true);
    const st = p.rows.find((r) => r.id === 'stoppage')!;
    expect(st.perDay).toBe(true);
    expect(p.daysA).toBeGreaterThan(0);
    expect(p.daysA).toBeLessThan(31);
    expect(val(st.a)).toBeCloseTo(dashboardFor(last).kpi!.total.downtimeHours / p.daysA, 9);
    expect(val(st.b)).toBeCloseTo(val(row('stoppage').a)! / p.daysB, 9);
    for (const r of p.rows) if (r.change.available) expect(r.change.assessment).toBe('neutral');
    // rates (availability, MTTR, MTBF) stay as they are
    expect(p.rows.find((r) => r.id === 'availability')!.perDay).toBe(false);
    expect(m.perDay).toBe(false);
  });
});
