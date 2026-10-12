import { describe, expect, it } from 'vitest';
import type { Startup } from '../api/types';
import {
  areaPareto, buildFailureEvents, computeKpis, dataRangeOf, equipmentPareto, findRepeatedFailures, longestEvents, monthlySeries, reasonPareto,
  durationHistogram, buildIndex, addDays, parseSettings, comparisonRange, isBlocked,
} from '../calc';
import { buildSyntheticDb } from '../mock/synthetic';
import { defaultFilters, resolveRange } from './filters';
import { areaModel, cutPareto, equipmentModel, overviewModel, reasonModel, reliabilityModel, repeatsModel, sparkSeries, windowDays } from './models';
import { noChangeText } from './format';
import { buildCtx, rowsInRange, yearsNeeded } from './scope';

const db = buildSyntheticDb();
const startup: Startup = {
  lines: db.lines, areas: db.areas, equipment: db.equipment, equipment_areas: db.equipment_areas, aliases: db.aliases,
  classifications: db.classifications, reasons: db.reasons, settings: db.settings, years: [2026, 2025],
};
const rows = db.events;
const settings = parseSettings(db.settings);
const index = buildIndex(db);
const coverage = dataRangeOf(rows.filter((r) => !r.is_void))!;
const f = defaultFilters();
const range = resolveRange(f, coverage.to);
const ctx = buildCtx(rows, startup, f, range);
const areaIds = ctx.base.areaIds;
const chains = buildFailureEvents(rows.filter((r) => areaIds.includes(r.area_id))).chains;
const failures = chains.filter((c) => c.isFailure);

describe('page adapters equal the calculation layer on the mock data', () => {
  it('Overview headline numbers equal computeKpis', () => {
    const m = overviewModel(ctx);
    const direct = computeKpis({ rows: rows.filter((r) => areaIds.includes(r.area_id)), window: range, dataRange: coverage, areaIds, settings, index });
    expect(direct.status).toBe('ok');
    if (direct.status !== 'ok' || !m.kpi) throw new Error('no kpi');
    expect(m.kpi.total.downtimeHours).toBeCloseTo(direct.total.downtimeHours, 9);
    expect(m.kpi.total.failureHours).toBeCloseTo(direct.total.failureHours, 9);
    expect(m.kpi.total.failureCount).toBe(direct.total.failureCount);
    expect(m.kpi.repeatedFailureCount).toBe(direct.repeatedFailureCount);
    expect(m.kpi.total.availabilityHeadline).toEqual(direct.total.availabilityHeadline);
    expect(m.perArea).toHaveLength(areaIds.length);
    // monthly series sums to the same hours as the window total (range covers whole months partially: compare totals)
    const series = monthlySeries({ rows: rows.filter((r) => areaIds.includes(r.area_id)), range, dataRange: coverage, areaIds, settings });
    expect(m.monthly.map((x) => x.failureHours)).toEqual(series.map((x) => x.failureHours));
    expect(m.monthly.reduce((s, x) => s + x.failureHours, 0)).toBeCloseTo(m.kpi.total.failureHours, 6);
    expect(m.changes).not.toBeNull();
    expect(m.kpi.window).toEqual(range);
  });

  it('events in scope equals the rows the Event Explorer would list', () => {
    const inRange = rowsInRange(ctx.scope, range);
    const expected = rows.filter((r) => !r.is_void && !isBlocked(r) && areaIds.includes(r.area_id) && r.stop_ts.slice(0, 10) >= range.from && r.stop_ts.slice(0, 10) <= range.to);
    expect(inRange.length).toBe(expected.length);
  });

  it('Pareto totals equal the calc builders and the own-stop buckets are separate', () => {
    const m = equipmentModel(ctx)!;
    const direct = equipmentPareto(failures, index, { measure: 'hours', window: ctx.win.effective! });
    expect(m.hours.own.total).toBeCloseTo(direct.own.total, 9);
    expect(m.hours.areaLevel.total).toBeCloseTo(direct.areaLevel.total, 9);
    expect(m.count.own.total).toBe(equipmentPareto(failures, index, { measure: 'count', window: ctx.win.effective! }).own.total);
    const a = areaModel(ctx, 'hours')!;
    expect(a.total).toBeCloseTo(areaPareto(failures, { measure: 'hours', window: ctx.win.effective! }).total, 9);
    const r = reasonModel(ctx, false)!;
    expect(r.count.total).toBe(reasonPareto(failures, { measure: 'count', window: ctx.win.effective! }).total);
  });

  it('Top N keeps percentages against the complete total and adds Others', () => {
    const all = equipmentModel(ctx)!.hours.own;
    const top5 = cutPareto(all, 5);
    expect(top5.bars).toHaveLength(6);
    expect(top5.bars[5]!.isOthers).toBe(true);
    expect(top5.total).toBeCloseTo(all.total, 9);
    expect(top5.bars[5]!.cumulativePct).toBeCloseTo(100, 6);
    expect(top5.bars[0]!.sharePct).toBeCloseTo((top5.bars[0]!.value / all.total) * 100, 9);
    expect(cutPareto(all, 'all').bars.some((b) => b.isOthers)).toBe(false);
    const ids = new Set(top5.bars.flatMap((b) => b.eventIds));
    expect(ids.size).toBe(new Set(all.bars.flatMap((b) => b.eventIds)).size);
  });

  it('Repeated failures: groups and recurrences equal findRepeatedFailures', () => {
    const m = repeatsModel(ctx)!;
    const cmp = comparisonRange(ctx.win.effective!, settings.defaultComparison);
    const direct = findRepeatedFailures(failures, { settings, window: ctx.win.effective!, previousWindow: cmp, lookup: index });
    expect(m.result.groups.length).toBe(direct.groups.length);
    expect(m.result.recurrences.length).toBe(direct.recurrences.length);
    expect(m.result.groups.length).toBeGreaterThan(0);
    const sc = m.scatter.reduce((s, p) => s + p.count, 0);
    expect(sc).toBe(equipmentPareto(failures, index, { measure: 'count', window: ctx.win.effective! }).own.total);
  });

  it('Reliability: histogram, longest events and monthly MTBF equal calc', () => {
    const m = reliabilityModel(ctx)!;
    const h = durationHistogram(failures, settings, ctx.win.effective!);
    expect(m.histogram.eventCount).toBe(h.eventCount);
    expect(m.longest[0]!.hours).toBeCloseTo(longestEvents(chains, 1, { failureOnly: true, window: ctx.win.effective! })[0]!.hours, 9);
    expect(m.monthly.length).toBeGreaterThan(0);
    const one = reliabilityModel(ctx, areaIds[0])!;
    expect(one.monthly[0]!.kpis!.area_id).toBe('ALL');
    expect(m.yoy).toHaveLength(12);
  });

  it('event-level filters keep chains whole and narrow the failure scope', () => {
    const f2 = { ...defaultFilters(), classifications: ['MEC' as const] };
    const c2 = buildCtx(rows, startup, f2, range);
    expect(c2.scope.failureChains.length).toBeLessThan(ctx.scope.failureChains.length);
    expect(c2.scope.failureChains.every((c) => c.head.classification === 'MEC')).toBe(true);
    const f3 = { ...defaultFilters(), lineIds: [startup.lines[0]!.line_id] };
    const c3 = buildCtx(rows, startup, f3, range);
    expect(c3.base.areaIds.every((a) => startup.areas.find((x) => x.area_id === a)!.line_id === f3.lineIds[0])).toBe(true);
    expect(c3.base.areaIds.length).toBeLessThan(areaIds.length);
  });

  it('a range spanning years needs every year, plus the comparison and the repeat history', () => {
    const f4 = { ...defaultFilters(), preset: 'custom' as const };
    expect(yearsNeeded({ from: '2025-11-01', to: '2026-02-28' }, f4, settings, [2026, 2025, 2024])).toEqual([2025, 2026]);
    expect(yearsNeeded({ from: '2026-01-10', to: '2026-02-28' }, f4, settings, [2026, 2025])).toEqual([2025, 2026]);
    expect(yearsNeeded({ from: '2026-06-10', to: '2026-07-28' }, { ...f4, compare: 'none' }, settings, [2026, 2025])).toEqual([2026]);
  });
});

describe('Overview chart models match the headline numbers', () => {
  const m = overviewModel(ctx);
  const k = m.kpi!;
  it('daily hours add up to the total stoppage hours and the days cover the effective window', () => {
    expect(m.daily.length).toBe(windowDays(ctx));
    expect(m.daily[0]!.date).toBe(ctx.win.effective!.from);
    expect(m.daily.reduce((s, d) => s + d.downtimeHours, 0)).toBeCloseTo(k.total.downtimeHours, 6);
    expect(m.daily.reduce((s, d) => s + d.failureCount, 0)).toBe(k.total.failureCount);
    expect(m.daily.every((d) => d.rollingDowntimeHours !== null)).toBe(true);
  });
  it('hours by classification add up to the total and to the monthly stack', () => {
    expect(m.byClass.reduce((s, x) => s + x.total, 0)).toBeCloseTo(k.total.downtimeHours, 6);
    m.byClass.forEach((c, i) => expect(c.total).toBeCloseTo(m.monthly[i]!.failureHours + m.monthly[i]!.plannedHours + m.monthly[i]!.otherHours, 6));
  });
  it('top equipment is the own-stop Pareto by hours with shares against the full total', () => {
    const direct = equipmentPareto(failures, index, { measure: 'hours', window: ctx.win.effective! }).own;
    expect(m.topEquipment.total).toBeCloseTo(direct.total, 9);
    expect(m.topEquipment.bars.length).toBeLessThanOrEqual(10);
    expect(m.topEquipment.bars.map((b) => b.key)).toEqual(direct.bars.slice(0, m.topEquipment.bars.length).map((b) => b.key));
    expect(m.topEquipment.bars[0]!.sharePct).toBeCloseTo((m.topEquipment.bars[0]!.value / direct.total) * 100, 9);
  });
  it('availability per area is sorted, uses the headline basis and carries the all-area figure', () => {
    const a = m.availability!;
    expect(a.areas).toHaveLength(m.perArea.length);
    const vals = a.areas.flatMap((x) => (x.availability.available ? [x.availability.value] : []));
    expect(vals).toEqual([...vals].sort((x, y) => x - y));
    expect(a.overall).toEqual(k.total.availabilityHeadline);
  });
  it('sparklines use daily points up to 120 days and monthly points beyond', () => {
    const d = sparkSeries(m.daily, m.monthly, 90);
    expect(d.mode).toBe('daily');
    expect(d.downtimeHours).toHaveLength(m.daily.length);
    expect(d.downtimeHours.reduce<number>((s, v) => s + (v ?? 0), 0)).toBeCloseTo(k.total.downtimeHours, 6);
    const mo = sparkSeries(m.daily, m.monthly, 365);
    expect(mo.mode).toBe('monthly');
    expect(mo.downtimeHours).toHaveLength(m.monthly.length);
  });
});

describe('change line when the other period has no data', () => {
  const first = { ...defaultFilters(), preset: 'custom' as const, from: coverage.from, to: addDays(coverage.from, 20) };
  const r1 = resolveRange(first, coverage.to);
  it('a chosen comparison with no data in the other period is not reported as "no comparison selected"', () => {
    const prev = overviewModel(buildCtx(rows, startup, { ...first, compare: 'previous_period' }, r1));
    expect(prev.compare).toBe('previous_period');
    expect(prev.changes).toBeNull();
    expect(prev.downtimeChange).toBeNull();
    expect(noChangeText(prev.compare)).toBe('No data in the previous period');
    const ly = overviewModel(buildCtx(rows, startup, { ...first, compare: 'same_period_last_year' }, r1));
    expect(noChangeText(ly.compare)).toBe('No data last year');
  });
  it('"No comparison selected" only when the user chose no comparison', () => {
    const none = overviewModel(buildCtx(rows, startup, { ...first, compare: 'none' }, r1));
    expect(none.compare).toBe('none');
    expect(none.changes).toBeNull();
    expect(noChangeText(none.compare)).toBe('No comparison selected');
  });
});

describe('performance', () => {
  it('filters, chains and every page model for the full mock data stay well under a second', () => {
    const t0 = performance.now();
    const c = buildCtx(rows, startup, { ...defaultFilters(), preset: 'ytd' }, resolveRange({ ...defaultFilters(), preset: 'ytd' }, coverage.to));
    overviewModel(c); equipmentModel(c); repeatsModel(c); reliabilityModel(c);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
