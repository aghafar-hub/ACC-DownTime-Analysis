import { describe, expect, it } from 'vitest';
import type { Startup } from '../api/types';
import {
  areaPareto, buildFailureEvents, computeKpis, dataRangeOf, equipmentPareto, findRepeatedFailures, longestEvents, monthlySeries, reasonPareto,
  durationHistogram, buildIndex, addDays, parseSettings, comparisonRange, isBlocked,
} from '../calc';
import { buildSyntheticDb } from '../mock/synthetic';
import { defaultFilters, resolveRange } from './filters';
import { areaModel, areaReliabilityModel, classModel, cutPareto, equipmentModel, lineModel, overviewModel, reasonModel, reasonMonthModel, whenFailuresStart, isoWeekStart, reliabilityModel, repeatsModel, sparkSeries, windowDays } from './models';
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
  it('sparklines use daily points up to 28 days, weekly points up to 120 days and monthly points beyond', () => {
    const d = sparkSeries(m.daily, m.monthly, 28);
    expect(d.mode).toBe('daily');
    expect(d.downtimeHours).toHaveLength(m.daily.length);
    const w = sparkSeries(m.daily, m.monthly, 90);
    expect(w.mode).toBe('weekly');
    expect(w.labels.length).toBeLessThan(m.daily.length);
    expect(w.labels.every((l) => isoWeekStart(l) === l)).toBe(true);
    expect(w.downtimeHours.reduce<number>((s, v) => s + (v ?? 0), 0)).toBeCloseTo(k.total.downtimeHours, 6);
    expect(w.failureCount.reduce<number>((s, v) => s + (v ?? 0), 0)).toBe(k.total.failureCount);
    expect(w.availability.every((v) => v === null || (v >= 0 && v <= 1))).toBe(true);
    expect(sparkSeries(m.daily, m.monthly, 29).mode).toBe('weekly');
    expect(sparkSeries(m.daily, m.monthly, 120).mode).toBe('weekly');
    const mo = sparkSeries(m.daily, m.monthly, 365);
    expect(mo.mode).toBe('monthly');
    expect(mo.downtimeHours).toHaveLength(m.monthly.length);
  });
  it('isoWeekStart returns the Monday of the week', () => {
    expect(isoWeekStart('2026-03-02')).toBe('2026-03-02');
    expect(isoWeekStart('2026-03-08')).toBe('2026-03-02');
    expect(isoWeekStart('2026-03-09')).toBe('2026-03-09');
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

describe('Phase 4 models equal the existing figures', () => {
  const kpi = ctx.kpis.current;
  if (kpi.status !== 'ok') throw new Error('no kpi');
  const win = ctx.win.effective!;
  const am = areaReliabilityModel(ctx)!;

  it('Pareto by line and by classification add up to the Pareto total', () => {
    for (const measure of ['hours', 'count'] as const) {
      const areaTotal = areaModel(ctx, measure)!.total;
      const line = lineModel(ctx, measure)!;
      expect(line.total).toBeCloseTo(areaTotal, 9);
      expect(line.bars.reduce((s, b) => s + b.value, 0)).toBeCloseTo(areaTotal, 9);
      expect(classModel(ctx, measure, true)!.total).toBeCloseTo(areaTotal, 9);
    }
    // the line of a bar is the master-data line of its areas, with the line's name as label
    const line = lineModel(ctx, 'count')!;
    expect(line.bars.every((b) => ctx.master.lineNames.get(b.key) === b.label)).toBe(true);
    // all events: classes add up to every chained event that started in the window
    expect(classModel(ctx, 'count', false)!.total).toBe(ctx.scope.chains.filter((c) => c.startDate >= win.from && c.startDate <= win.to).length);
  });

  it('Reasons by month: totals equal the failure events and the failure hours of the Pareto', () => {
    const rm = reasonMonthModel(ctx)!;
    expect(rm.countAll.total).toBe(kpi.total.failureEventCount);
    expect(rm.hoursAll.total).toBeCloseTo(areaModel(ctx, 'hours')!.total, 6);
    expect(rm.hoursAll.total).toBeCloseTo(reasonModel(ctx, false)!.hours.total, 6);
    expect(rm.hours.rows.length).toBeLessThanOrEqual(12);
    expect(rm.hours.total).toBeCloseTo(rm.hoursAll.total, 9); // the cut keeps the total of every cell
    expect(rm.countAll.values.flat().reduce((s, v) => s + v, 0)).toBe(rm.countAll.total);
  });

  it('per-area MTBF, MTTR, failure rate and availability equal the By area table (the per-area KPIs)', () => {
    expect(am.mtbf).toHaveLength(kpi.areas.length);
    for (const a of kpi.areas) {
      const pick = (ranks: typeof am.mtbf) => ranks.find((r) => r.area_id === a.area_id)!;
      expect(pick(am.mtbf).value).toBe(a.mtbfHours.available ? a.mtbfHours.value : null);
      expect(pick(am.mttr).value).toBe(a.mttrHours.available ? a.mttrHours.value : null);
      expect(pick(am.rate.rows).value).toBe(a.failureRatePer1000h.available ? a.failureRatePer1000h.value : null);
      expect(am.overallAvailability.get(a.area_id)).toEqual(a.availabilityHeadline);
    }
    // MTBF is never averaged: the all-area rate is the aggregate KPI, not the mean of the bars
    expect(am.rate.overall).toEqual(kpi.total.failureRatePer1000h);
    const vals = am.mtbf.flatMap((r) => (r.value === null ? [] : [r.value]));
    expect(vals).toEqual([...vals].sort((x, y) => x - y));
    expect(am.mtbf.findIndex((r) => r.value === null)).toBeGreaterThanOrEqual(vals.length === am.mtbf.length ? -1 : vals.length);
    const q = am.quadrant;
    expect(q.points.length + q.excluded.length).toBe(kpi.areas.length);
  });

  it('availability by area and month: a one-month range equals computeKpis of that month per area', () => {
    const month = ctx.win.range.to.slice(0, 7);
    const mr = { from: `${month}-01`, to: ctx.win.range.to };
    const mctx = buildCtx(rows, startup, { ...defaultFilters(), preset: 'custom' as const, from: mr.from, to: mr.to, compare: 'none' }, mr);
    const mk = mctx.kpis.current;
    if (mk.status !== 'ok') throw new Error('no kpi');
    const m1 = areaReliabilityModel(mctx)!.monthAvailability;
    expect(m1.months).toHaveLength(1);
    for (const a of mk.areas) {
      expect(m1.areas.find((x) => x.area_id === a.area_id)!.values[0]).toEqual(a.availabilityHeadline);
    }
    // the full-range matrix has one row per area and one cell per month
    expect(am.monthAvailability.areas).toHaveLength(ctx.base.areaIds.length);
    expect(am.monthAvailability.areas.every((a) => a.values.length === am.monthAvailability.months.length)).toBe(true);
  });

  it('failure starts: counts sum to the failure events, hours to the MTTR cohort, 24 rows x 7 weekdays', () => {
    const c = whenFailuresStart(ctx, 'count')!;
    expect(c.rows).toHaveLength(24);
    expect(c.cols).toHaveLength(7);
    expect(c.total).toBe(kpi.total.failureEventCount);
    expect(c.values.flat().reduce((s, v) => s + v, 0)).toBe(kpi.total.failureEventCount);
    expect(c.cols.reduce((s, x) => s + x.total, 0)).toBe(kpi.total.failureEventCount);
    const h = whenFailuresStart(ctx, 'hours')!;
    const mttr = kpi.total.mttrHours;
    expect(mttr.available).toBe(true);
    if (mttr.available) expect(h.total / kpi.total.failureEventCount).toBeCloseTo(mttr.value, 6);
  });

  it('repeat groups carry their occurrence dates inside the window', () => {
    const m = repeatsModel(ctx)!;
    for (const g of m.result.groups) {
      expect(g.occurrenceDates).toHaveLength(g.occurrences);
      expect(g.occurrenceDates[g.occurrenceDates.length - 1]).toBe(g.lastFailureDate);
      expect(g.occurrenceDates.every((d) => d >= m.window.from && d <= m.window.to)).toBe(true);
    }
  });

  it('shared filters narrow the new models too', () => {
    const f2 = { ...defaultFilters(), lineIds: [startup.lines[0]!.line_id] };
    const c2 = buildCtx(rows, startup, f2, range);
    expect(lineModel(c2, 'count')!.bars.map((b) => b.key)).toEqual([startup.lines[0]!.line_id]);
    expect(areaReliabilityModel(c2)!.mtbf).toHaveLength(c2.base.areaIds.length);
  });
});

describe('performance', () => {
  it('filters, chains and every page model for the full mock data stay well under a second', () => {
    const t0 = performance.now();
    const c = buildCtx(rows, startup, { ...defaultFilters(), preset: 'ytd' }, resolveRange({ ...defaultFilters(), preset: 'ytd' }, coverage.to));
    overviewModel(c); equipmentModel(c); repeatsModel(c); reliabilityModel(c); areaReliabilityModel(c); reasonMonthModel(c); whenFailuresStart(c, 'count');
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('targets in the page adapters', () => {
  const withTargets = (extra: { key: string; value: string }[]) => buildCtx(rows, { ...startup, settings: [...db.settings.filter((s) => !extra.some((e) => e.key === s.key)), ...extra] }, f, range);

  it('are off (no status anywhere) while the settings are blank', () => {
    const m = overviewModel(ctx);
    expect(m.targets).toEqual({ availabilityPct: null, mtbfH: null, mttrH: null });
    expect(m.status).toEqual({ availability: null, mtbf: null, mttr: null });
    expect(m.belowTarget).toBeNull();
    const a = areaReliabilityModel(ctx)!;
    expect([...a.status.values()].every((s) => s.availability === null && s.mtbf === null && s.mttr === null)).toBe(true);
  });

  it('give the hero KPIs, the below-target count and every area a status when set', () => {
    const c = withTargets([{ key: 'availability_target_pct', value: '95' }, { key: 'target_mtbf_h', value: '100' }, { key: 'target_mttr_h', value: '2' }]);
    const m = overviewModel(c);
    const tot = m.kpi!.total;
    expect(m.targets).toEqual({ availabilityPct: 95, mtbfH: 100, mttrH: 2 });
    if (tot.availabilityHeadline.available) expect(m.status.availability?.ok).toBe(Math.round(tot.availabilityHeadline.value * 1000) / 10 >= 95);
    if (tot.mttrHours.available) expect(m.status.mttr?.ok).toBe(Math.round(tot.mttrHours.value * 100) / 100 <= 2);
    // the MTBF status is for a single area only (as the MTBF tile)
    expect(m.perArea.length).toBeGreaterThan(1);
    expect(m.status.mtbf).toBeNull();
    const judged = m.availability!.areas.filter((a) => a.availability.available);
    expect(m.belowTarget!.total).toBe(judged.length);
    expect(m.belowTarget!.below).toEqual(judged.filter((a) => Math.round((a.availability as { value: number }).value * 1000) / 10 < 95).map((a) => a.area_id));
    const a = areaReliabilityModel(c)!;
    for (const k of c.kpis.current.status === 'ok' ? c.kpis.current.areas : []) {
      const s = a.status.get(k.area_id)!;
      expect(!!s.availability).toBe(k.availabilityHeadline.available);
      expect(!!s.mtbf).toBe(k.mtbfHours.available);
      expect(!!s.mttr).toBe(k.mttrHours.available);
    }
  });

  it('with one area in scope the MTBF gets a status too', () => {
    const one = db.areas[0]!.area_id;
    const c = buildCtx(rows, { ...startup, settings: [...db.settings, { key: 'target_mtbf_h', value: '50' }] }, { ...f, areaIds: [one] }, range);
    const m = overviewModel(c);
    expect(m.perArea).toHaveLength(1);
    const k = m.perArea[0]!.mtbfHours;
    expect(m.status.mtbf === null).toBe(!k.available);
    if (k.available) expect(m.status.mtbf!.target).toBe(50);
  });
});

describe('R0: drill ids, repeats heat maps', () => {
  it('every Pareto bar and scatter point opens exactly the events it counts', () => {
    const m = equipmentModel(ctx)!;
    for (const b of m.count.own.bars) expect(b.eventIds).toHaveLength(b.value);
    const w = ctx.win.effective!;
    const byId = new Map(failures.map((c) => [c.id, c]));
    for (const b of m.hours.own.bars) {
      // each id carries hours inside the window; together they make the bar
      const sum = b.eventIds.reduce((s, id) => s + (byId.get(id) ? equipmentPareto([byId.get(id)!], index, { measure: 'hours', window: w }).own.total : 0), 0);
      expect(sum).toBeCloseTo(b.value, 6);
    }
    const r = repeatsModel(ctx)!;
    for (const p of r.scatter) expect(p.eventIds).toHaveLength(p.count);
    const o = overviewModel(ctx);
    expect(o.topEquipment.bars.every((b) => b.eventIds.length > 0)).toBe(true);
  });
  it('the repeats heat maps leave out N/A, as the page says', () => {
    const r = repeatsModel(ctx)!;
    for (const h of [r.heatMonthHours, r.heatMonthCount, r.heatReasonHours, r.heatReasonCount, r.heatAll.monthHours, r.heatAll.reasonCount]) {
      expect(h.rows.map((x) => x.key)).not.toContain('N/A');
    }
  });
});
