import { describe, expect, it } from 'vitest';
import type { Startup } from '../api/types';
import {
  areaPareto, buildFailureEvents, computeKpis, dataRangeOf, equipmentPareto, findRepeatedFailures, longestEvents, monthlySeries, reasonPareto,
  durationHistogram, buildIndex, parseSettings, comparisonRange, isBlocked,
} from '../calc';
import { buildSyntheticDb } from '../mock/synthetic';
import { defaultFilters, resolveRange } from './filters';
import { areaModel, cutPareto, equipmentModel, overviewModel, reasonModel, reliabilityModel, repeatsModel } from './models';
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

describe('performance', () => {
  it('filters, chains and every page model for the full mock data stay well under a second', () => {
    const t0 = performance.now();
    const c = buildCtx(rows, startup, { ...defaultFilters(), preset: 'ytd' }, resolveRange({ ...defaultFilters(), preset: 'ytd' }, coverage.to));
    overviewModel(c); equipmentModel(c); repeatsModel(c); reliabilityModel(c);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
