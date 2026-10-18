import { describe, expect, it } from 'vitest';
import type { Startup } from '../api/types';
import { areaPareto, computeKpisWithComparison, dataRangeOf } from '../calc';
import { buildSyntheticDb } from '../mock/synthetic';
import { CHART_HELP, chartHelp, type ChartHelpId } from '../help/chartHelp';
import { areaBreakdowns, FAILURE_CLASSES, roundParts, sharePcts, STOP_CLASSES } from './areaBreakdown';
import { defaultFilters, resolveRange } from './filters';
import { kpiInfo } from './kpiInfo';
import { overviewModel, runningHours } from './models';
import { kpiSparks } from './dashModels';
import { buildCtx } from './scope';

const db = buildSyntheticDb();
const startup: Startup = {
  lines: db.lines, areas: db.areas, equipment: db.equipment, equipment_areas: db.equipment_areas, aliases: db.aliases,
  classifications: db.classifications, reasons: db.reasons, settings: db.settings, years: [2026, 2025],
};
const rows = db.events;
const coverage = dataRangeOf(rows.filter((r) => !r.is_void))!;
const f = defaultFilters();
const range = resolveRange(f, coverage.to);
const ctx = buildCtx(rows, startup, f, range);

describe('By area: the split by classification adds up to the cells', () => {
  const kpi = ctx.kpis.current;
  if (kpi.status !== 'ok') throw new Error('no kpi');
  const bd = areaBreakdowns({ rows: ctx.scope.kpiRows, failureChains: ctx.scope.failureChains, window: kpi.window, attribution: ctx.scope.attribution, areaIds: kpi.areas.map((a) => a.area_id) });
  const pareto = areaPareto(ctx.scope.failureChains, { measure: 'hours', window: ctx.win.effective!, attribution: ctx.scope.attribution });

  it('Stopped h equals the KPI stopped hours of the area, split over PRO / MEC / ELE / AUT / PL / CIR', () => {
    let any = false;
    for (const a of kpi.areas) {
      const b = bd.get(a.area_id)!;
      expect(b.stoppedHours.parts.map((p) => p.key).slice(0, 6)).toEqual([...STOP_CLASSES]);
      expect(b.stoppedHours.total).toBeCloseTo(a.downtimeHours, 6);
      expect(b.stoppedHours.parts.reduce((s, p) => s + p.value, 0)).toBeCloseTo(b.stoppedHours.total, 9);
      // planned and other are exactly the KPI's PL and CIR hours
      expect(b.stoppedHours.parts.find((p) => p.key === 'PL')!.value).toBeCloseTo(a.plannedHours, 6);
      expect(b.stoppedHours.parts.find((p) => p.key === 'CIR')!.value).toBeCloseTo(a.otherHours, 6);
      if (a.downtimeHours > 0) any = true;
    }
    expect(any).toBe(true);
  });

  it('Failure h equals the Areas Pareto (P1 attribution) and Failures the KPI failure count', () => {
    for (const a of kpi.areas) {
      const b = bd.get(a.area_id)!;
      expect(b.failureHours.parts.map((p) => p.key)).toEqual([...FAILURE_CLASSES]);
      const bar = pareto.bars.find((x) => x.key === a.area_id);
      expect(b.failureHours.total).toBeCloseTo(bar?.value ?? 0, 6);
      expect(b.failures.total).toBe(a.failureCount);
      expect(b.failures.parts.every((p) => Number.isInteger(p.value))).toBe(true);
    }
    expect(kpi.areas.reduce((s, a) => s + bd.get(a.area_id)!.failureHours.total, 0)).toBeCloseTo(pareto.total, 6);
  });

  it('the shown (rounded) parts add up to the shown cell, shares to 100.0 %', () => {
    for (const a of kpi.areas) {
      const b = bd.get(a.area_id)!;
      for (const sp of [b.stoppedHours, b.failureHours]) {
        const shown = roundParts(sp.parts.map((p) => p.value), 1);
        expect(Math.round(shown.reduce((s, v) => s + v, 0) * 10)).toBe(Math.round(sp.total * 10));
        if (sp.total > 0) expect(Math.round(sharePcts(sp.parts.map((p) => p.value)).reduce((s, v) => s + v, 0) * 10)).toBe(1000);
      }
    }
  });
});

describe('roundParts / sharePcts', () => {
  it('rounds so the parts add up to the rounded total (largest remainder)', () => {
    expect(roundParts([0.04, 0.04, 0.04], 1)).toEqual([0.1, 0, 0]);
    expect(roundParts([1.25, 2.25, 3.5], 1).reduce((s, v) => s + v, 0)).toBeCloseTo(7, 9);
    expect(roundParts([1, 2, 3], 0)).toEqual([1, 2, 3]);
    expect(roundParts([], 1)).toEqual([]);
    expect(sharePcts([1, 1, 1])).toEqual([33.4, 33.3, 33.3]);
    expect(sharePcts([0, 0])).toEqual([0, 0]);
  });
});

describe('Running hours (KPI row)', () => {
  it('equals scheduled time minus the stopped hours (operating hours of computeKpis), with the change against the comparison', () => {
    const m = overviewModel(ctx);
    const run = m.running!;
    const kpi = m.kpi!;
    expect(run.value.available).toBe(true);
    if (!run.value.available) return;
    expect(run.value.value).toBeCloseTo(kpi.total.scheduledHours - kpi.total.downtimeHours, 6);
    expect(run.scheduledHours).toBe(kpi.total.scheduledHours);
    expect(run.stoppedHours).toBe(kpi.total.downtimeHours);
    expect(run.areas).toBe(ctx.base.areaIds.length);
    // T = hours per day x days x areas
    expect(run.scheduledHours / (run.days * run.areas)).toBeCloseTo(ctx.master.settings.scheduledHoursPerDay ?? 24, 6);
    const cmp = computeKpisWithComparison({ rows: ctx.scope.kpiRows, chains: ctx.scope.chains, window: ctx.win.range, dataRange: ctx.coverage, areaIds: ctx.base.areaIds, settings: ctx.master.settings, attribution: ctx.scope.attribution, notUploaded: ctx.notUploaded }, ctx.master.settings.defaultComparison);
    expect(run.change).toEqual(cmp.changes?.operatingHours ?? m.changes?.operatingHours ?? null);
    if (run.change && run.change.available && !run.change.perDay && run.change.direction !== 'flat') {
      // higher running hours = better
      expect(run.change.assessment).toBe(run.change.direction === 'up' ? 'good' : 'bad');
    }
  });

  it('runningHours is a plain view of the KPI result', () => {
    const k = ctx.kpis.current;
    if (k.status !== 'ok') throw new Error('no kpi');
    const r = runningHours(k, null);
    expect(r.change).toBeNull();
    expect(r.value).toEqual(k.total.operatingHours);
    expect(r.notUploaded).toEqual(k.notUploaded);
  });

  it('the sparkline has one value per month with data, equal to the monthly operating hours', () => {
    const s = kpiSparks(ctx)!;
    expect(s.operatingHours).toHaveLength(s.slots.length);
    s.slots.forEach((slot, i) => {
      if (slot.status === 'notUploaded' || slot.status === 'noData') expect(s.operatingHours[i]).toBeNull();
    });
    expect(s.operatingHours.some((v) => v !== null && v > 0)).toBe(true);
  });

  it('the (i) says it is derived, not measured, with the live numbers', () => {
    const info = kpiInfo('running-hours', 'B', undefined, { perDay: '24.0', scheduled: '1,000.0', stopped: '100.0', running: '900.0', days: 5, areas: 2, notUploaded: ['Mar 2026'] });
    const text = info.paragraphs.join(' ');
    expect(text).toContain('NOT measured');
    expect(text).toContain('Here: 24.0 h × 5 days × 2 areas = 1,000.0 h scheduled − 100.0 h stopped = 900.0 h running.');
    expect(text).toContain('Mar 2026');
  });
});

describe('chart help texts', () => {
  it('every entry has what, a formula and how; examples fill only with all numbers', () => {
    for (const id of Object.keys(CHART_HELP) as ChartHelpId[]) {
      const h = chartHelp(id, { b: 'B' });
      expect(h.title.length).toBeGreaterThan(2);
      const kinds = h.sections!.map((s) => s.kind);
      expect(kinds.slice(0, 3)).toEqual(['what', 'formula', 'how']);
      for (const s of h.sections!) for (const x of s.items) expect(x).not.toMatch(/\{\w+\}/);
    }
    expect(chartHelp('mttr-month', { m: 'Aug 2026', h: '3,704.5', n: '582', v: '6.36' }).sections!.at(-1)!.items[0]).toBe('Here: Aug 2026: 3,704.5 h ÷ 582 failures = 6.36 h.');
    expect(chartHelp('mttr-month', { m: 'Aug 2026' }).sections!.some((s) => s.kind === 'example')).toBe(false);
  });

  it('availability formulas follow the basis', () => {
    expect(chartHelp('heat', { b: 'B' }).sections![1]!.items[0]).toBe('Availability B = (T − PL − INC − CIR) ÷ (T − PL)');
    expect(chartHelp('heat', { b: 'C' }).sections![1]!.items[0]).toBe('Availability C = (T − PL − CIR − INC) ÷ (T − PL − CIR)');
  });
});

describe('KPI (i): a formula on every card and the worked example with the card numbers', () => {
  const live = { T: '1,000.0', pl: '50.0', inc: '30.0', cir: '20.0', down: '100.0', run: '900.0', failures: '10', eventHours: '28.0', mtbf: '90.0', mttr: '2.80', rf: '96.8', uf: '90.0', perDay: '24.0', days: 5, areas: 2 };
  it('has both sections for each card', () => {
    for (const id of ['total-hours', 'failure-count', 'reliability', 'mtbf', 'mttr', 'utilization'] as const) {
      const info = kpiInfo(id, 'B', undefined, undefined, live);
      expect(info.sections?.map((s) => s.heading), id).toEqual(['Formula', 'With the numbers on this card']);
    }
    const all = (id: Parameters<typeof kpiInfo>[0]) => kpiInfo(id, 'B', undefined, undefined, live).sections!.flatMap((s) => s.items).join(' | ');
    expect(all('total-hours')).toContain('30.0 + 50.0 + 20.0 = 100.0 h');
    expect(all('reliability')).toContain('RF = 900.0 ÷ (900.0 + 30.0) = 96.8%');
    expect(all('mtbf')).toContain('MTBF = 900.0 ÷ 10 = 90.0 h');
    expect(all('mttr')).toContain('MTTR = 28.0 h ÷ 10 = 2.80 h');
    expect(all('utilization')).toContain('UF = 900.0 ÷ 1,000.0 = 90.0%');
  });
  it('shows only the formula without numbers, and no example for MTBF and MTTR without failures', () => {
    expect(kpiInfo('mtbf', 'B').sections?.map((s) => s.heading)).toEqual(['Formula']);
    expect(kpiInfo('mttr', 'B', undefined, undefined, { ...live, failures: '0' }).sections?.map((s) => s.heading)).toEqual(['Formula']);
  });
});
