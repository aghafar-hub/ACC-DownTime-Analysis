import { describe, expect, it } from 'vitest';
import type { Startup } from '../api/types';
import {
  areaMonthAvailability, chainHours, dailyHoursByClassification, dailySeries, dataRangeOf, findRepeatedFailures, monthRange, rangeToInterval,
  type ParetoResult,
} from '../calc';
import { buildSyntheticDb } from '../mock/synthetic';
import {
  areaAvailability, areaSplit, availabilityHeat, classHours, compareShort, contextRange, failureIdsStarted, failuresByMonth, heatTone, idsWithHours, idsWithHoursByArea,
  kpiSparks, lastDays, lineSplit, lossModel, paretoHonestText, paretoNeed, periodText, plannedRuns, repeatsTop, scopeText, slotChange, trendModel,
  yearToPeriodRange, type TrendSlot,
} from './dashModels';
import { defaultFilters, resolveRange, type DashFilters } from './filters';
import { equipmentModel, monthly, overviewModel } from './models';
import { buildCtx } from './scope';
import { belowTargetCount, getTargets } from './targets';

const db = buildSyntheticDb();
const startup: Startup = {
  lines: db.lines, areas: db.areas, equipment: db.equipment, equipment_areas: db.equipment_areas, aliases: db.aliases,
  classifications: db.classifications, reasons: db.reasons, settings: db.settings, years: [2026, 2025],
};
const rows = db.events;
const coverage = dataRangeOf(rows.filter((r) => !r.is_void))!;
const ctxFor = (patch: Partial<DashFilters>, settings = startup.settings) => {
  const f = { ...defaultFilters(), ...patch };
  return buildCtx(rows, { ...startup, settings }, f, resolveRange(f, coverage.to));
};
// a whole month before the last one (the data ends inside the latest month)
const lastMonth = coverage.to.slice(0, 7);
const [ly, lm] = lastMonth.split('-').map(Number) as [number, number];
const fullMonth = `${lm <= 2 ? ly - 1 : ly}-${String(lm <= 2 ? lm + 10 : lm - 2).padStart(2, '0')}`;
const monthCtx = ctxFor({ preset: 'month', month: fullMonth });
const defCtx = ctxFor({});
const kpi = (c: typeof defCtx) => {
  if (c.kpis.current.status !== 'ok') throw new Error('no kpi');
  return c.kpis.current;
};

describe('ranges', () => {
  it('the context year runs from January to the end of the data in that year; sparks stop at the period end', () => {
    const r = contextRange(monthCtx)!;
    expect(r.from).toBe(`${fullMonth.slice(0, 4)}-01-01`);
    expect(r.to >= monthCtx.win.effective!.to).toBe(true);
    expect(yearToPeriodRange(monthCtx)).toEqual({ from: r.from, to: monthCtx.win.effective!.to });
  });

  it('a period that starts in the previous year starts the context there; never more than 24 months', () => {
    const c = ctxFor({ preset: 'custom', from: '2025-09-01', to: coverage.to });
    expect(contextRange(c)!.from).toBe('2025-09-01');
    const fake = { win: { range: { from: '2020-01-01', to: '2026-08-31' }, effective: { from: '2020-01-01', to: '2026-08-31' } }, coverage: { from: '2020-01-01', to: '2026-10-12' } } as Parameters<typeof contextRange>[0];
    expect(contextRange(fake)).toEqual({ from: '2024-11-01', to: '2026-10-12' });
  });
});

describe('records behind the cards equal the figures', () => {
  it('total stoppage: the events with hours in the window carry exactly the KPI hours', () => {
    const ids = idsWithHours(monthCtx, monthCtx.win.effective!);
    const want = new Set(ids);
    const w = rangeToInterval(monthCtx.win.effective!);
    const h = monthCtx.scope.chains.filter((c) => want.has(c.id)).reduce((s, c) => s + chainHours(c, w, monthCtx.scope.attribution), 0);
    expect(h).toBeCloseTo(kpi(monthCtx).total.downtimeHours, 6);
    expect(new Set(ids).size).toBe(ids.length);
    const byArea = idsWithHoursByArea(monthCtx, monthCtx.win.effective!);
    expect([...byArea.values()].reduce((s, l) => s + l.length, 0)).toBe(ids.length);
  });

  it('failures: the events that started in the window are the failure count', () => {
    expect(failureIdsStarted(defCtx, defCtx.win.effective!).length).toBe(kpi(defCtx).total.failureCount);
    expect(failureIdsStarted(monthCtx, monthCtx.win.effective!).length).toBe(kpi(monthCtx).total.failureCount);
  });
});

describe('KPI sparklines', () => {
  it('one point per month from January to the period, each equal to the monthly series', () => {
    const s = kpiSparks(monthCtx)!;
    expect(s.slots[0]!.key).toBe(`${fullMonth.slice(0, 4)}-01`);
    expect(s.slots[s.slots.length - 1]!.key).toBe(fullMonth);
    const i = s.slots.length - 1;
    expect(s.downtimeHours[i]).toBeCloseTo(kpi(monthCtx).total.downtimeHours, 6);
    expect(s.failureCount[i]).toBe(kpi(monthCtx).total.failureCount);
    const av = kpi(monthCtx).total.availabilityHeadline;
    expect(s.availability[i]).toBeCloseTo(av.available ? av.value : NaN, 9);
    expect(s.slots[i]!.inPeriod).toBe(true);
    expect(s.slots[0]!.inPeriod).toBe(fullMonth.endsWith('-01'));
  });
});

describe('trend by month or day, by type or class', () => {
  it('the month of the period equals the KPI; classes sum to the types in every month', () => {
    const byType = trendModel(monthCtx, 'month', 'type')!;
    const byClass = trendModel(monthCtx, 'month', 'class')!;
    const slot = byType.slots.find((s) => s.key === fullMonth)!;
    expect(slot.status).toBe('full');
    expect(slot.total).toBeCloseTo(kpi(monthCtx).total.downtimeHours, 6);
    expect(slot.values.inc).toBeCloseTo(kpi(monthCtx).total.failureHours, 6);
    byType.slots.forEach((s, i) => expect(byClass.slots[i]!.total).toBeCloseTo(s.total, 6));
    // the latest month is in progress: partial
    expect(byType.slots[byType.slots.length - 1]!.status).toBe(coverage.to.endsWith('-31') || coverage.to.endsWith('-30') ? expect.any(String) : 'partial');
  });

  it('days: classes sum to the types; the period total equals the KPI', () => {
    const t = trendModel(monthCtx, 'day', 'type')!;
    const c = trendModel(monthCtx, 'day', 'class')!;
    expect(t.slots).toHaveLength(c.slots.length);
    t.slots.forEach((s, i) => expect(c.slots[i]!.total).toBeCloseTo(s.total, 6));
    expect(t.slots.reduce((s, x) => s + x.total, 0)).toBeCloseTo(kpi(monthCtx).total.downtimeHours, 6);
  });

  it('dailyHoursByClassification equals dailySeries day by day', () => {
    const range = monthRange(fullMonth);
    const input = { rows: monthCtx.scope.kpiRows, range, dataRange: monthCtx.coverage, areaIds: monthCtx.base.areaIds, attribution: monthCtx.scope.attribution, notUploaded: monthCtx.notUploaded };
    const days = dailySeries({ ...input, chains: monthCtx.scope.chains, settings: monthCtx.master.settings });
    const cls = dailyHoursByClassification(input);
    days.forEach((d, i) => {
      expect(cls[i]!.date).toBe(d.date);
      expect(cls[i]!.total).toBeCloseTo(d.downtimeHours, 6);
      expect(cls[i]!.hours.PL).toBeCloseTo(d.plannedHours, 6);
      expect(cls[i]!.hours.CIR).toBeCloseTo(d.otherHours, 6);
    });
  });

  it('the period by classification sums to the KPI type split', () => {
    const c = classHours(monthCtx)!;
    const k = kpi(monthCtx).total;
    expect(c.total).toBeCloseTo(k.downtimeHours, 6);
    expect(c.hours.PL).toBeCloseTo(k.plannedHours, 6);
    expect(c.hours.CIR).toBeCloseTo(k.otherHours, 6);
    expect(c.hours.PRO! + c.hours.MEC! + c.hours.ELE! + c.hours.AUT!).toBeCloseTo(k.failureHours, 6);
  });

  it('change against the previous slot: per day when a month is partial, none without data', () => {
    const mk = (key: string, status: TrendSlot['status'], total: number, days: number): TrendSlot => ({
      key, status, total, values: { inc: total }, inPeriod: true, window: status === 'full' || status === 'partial' ? { from: `${key}-01`, to: `${key}-${String(days).padStart(2, '0')}` } : null,
    });
    const a = mk('2026-07', 'full', 310, 31);
    expect(slotChange(a, mk('2026-08', 'full', 341, 31), 'total')).toEqual({ abs: 31, pct: 10, perDay: false });
    const p = slotChange(a, mk('2026-08', 'partial', 100, 10), 'inc')!;
    expect(p.perDay).toBe(true);
    expect(p.abs).toBeCloseTo(0, 9);
    expect(slotChange(mk('2026-07', 'notUploaded', 0, 31), mk('2026-08', 'full', 1, 31), 'total')).toBeNull();
    expect(slotChange(undefined, a, 'total')).toBeNull();
  });
});

describe('losses (Pareto) card', () => {
  it('top 10 of the complete Pareto, its share, the items needed for 80% and the shown events', () => {
    const m = lossModel(defCtx, 'equipment', 'hours')!;
    const all = equipmentModel(defCtx)!.hours.own;
    expect(m.all.total).toBeCloseTo(all.total, 9);
    expect(m.top).toHaveLength(Math.min(10, all.entryCount));
    expect(m.topSharePct).toBeCloseTo(m.top[m.top.length - 1]!.cumulativePct, 9);
    expect(m.need80).toBe(all.referenceIndex! + 1);
    expect(new Set(m.ids)).toEqual(new Set(m.top.flatMap((b) => b.eventIds)));
    for (const dim of ['reason', 'area', 'line'] as const) for (const measure of ['hours', 'count'] as const) expect(lossModel(defCtx, dim, measure)).not.toBeNull();
    // counts: the shown events are exactly the bars' counts
    const c = lossModel(defCtx, 'equipment', 'count')!;
    expect(c.ids.length).toBe(c.top.reduce((s, b) => s + b.value, 0));
  });

  it('honest wording: top N share and the items needed for 80%', () => {
    const bar = (v: number, cum: number) => ({ key: String(v), label: String(v), value: v, sharePct: v, cumulativePct: cum, isOthers: false, eventIds: [], entryCount: 1 });
    const all: Pick<ParetoResult, 'bars' | 'referencePct' | 'entryCount'> = {
      bars: Array.from({ length: 12 }, (_, i) => bar(12 - i, (i + 1) * 8.3)), referencePct: 80, entryCount: 12,
    };
    expect(paretoNeed(all)).toBe(10);
    expect(paretoHonestText(all, 10, 'failure hours')).toBe('Top 10 = 83% of failure hours · 80% needs 10 items');
    expect(paretoHonestText({ ...all, bars: all.bars.slice(0, 3).map((b, i) => ({ ...b, cumulativePct: [60, 85, 100][i]! })), entryCount: 3 }, 10, 'failures')).toBe('All 3 = 100% of failures · 80% needs 2 items');
    expect(paretoHonestText({ bars: [], referencePct: 80, entryCount: 0 }, 10, 'x')).toBe('');
  });
});

describe('planned or incidental, downtime and availability by area', () => {
  it('per line sums to all lines and to the KPI', () => {
    const s = lineSplit(defCtx)!;
    const k = kpi(defCtx).total;
    expect(s.all.total).toBeCloseTo(k.downtimeHours, 9);
    expect(s.lines.reduce((x, l) => x + l.total, 0)).toBeCloseTo(k.downtimeHours, 6);
    expect(s.lines.reduce((x, l) => x + l.pl, 0)).toBeCloseTo(k.plannedHours, 6);
    for (const l of s.lines) expect(l.inc + l.pl + l.cir).toBeCloseTo(l.total, 6);
  });

  it('areas by total hours, largest first, summing to the KPI', () => {
    const a = areaSplit(defCtx);
    expect(a).toHaveLength(defCtx.base.areaIds.length);
    for (let i = 1; i < a.length; i++) expect(a[i - 1]!.total).toBeGreaterThanOrEqual(a[i]!.total);
    expect(a.reduce((s, x) => s + x.total, 0)).toBeCloseTo(kpi(defCtx).total.downtimeHours, 6);
  });

  it('availability against the target: worst first, the same below count as the KPI module; no target, no status', () => {
    const none = areaAvailability(defCtx)!;
    expect(none.target).toBeNull();
    expect(none.rows.every((r) => r.status === null)).toBe(true);
    const settings = [...startup.settings.filter((s) => s.key !== 'availability_target_pct'), { key: 'availability_target_pct', value: '97' }];
    const c = ctxFor({}, settings);
    const m = areaAvailability(c)!;
    expect(m.target).toBe(97);
    const want = belowTargetCount(overviewModel(c).availability!.areas, getTargets(c.master.settings))!;
    expect(m.below).toBe(want.below.length);
    expect(m.judged).toBe(want.total);
    for (let i = 1; i < m.rows.length; i++) expect((m.rows[i - 1]!.pct ?? Infinity) <= (m.rows[i]!.pct ?? Infinity)).toBe(true);
  });
});

describe('failures and repair time by month', () => {
  it('each month equals the monthly series; the months of the year sum to the failure events started in them', () => {
    const f = failuresByMonth(monthCtx)!;
    const last = f.months[f.months.length - 1]!;
    expect(last.key).toBe(fullMonth);
    expect(last.failures).toBe(kpi(monthCtx).total.failureCount);
    const mt = kpi(monthCtx).total.mttrHours;
    expect(last.mttr).toBeCloseTo(mt.available ? mt.value : NaN, 9);
    const sum = f.months.reduce((s, m) => s + (m.failures ?? 0), 0);
    expect(failureIdsStarted(monthCtx, f.range).length).toBe(sum);
  });
});

describe('repeated failures', () => {
  it('the listed groups are those of the Repeated failures page; ids are their events', () => {
    const r = repeatsTop(defCtx)!;
    const direct = findRepeatedFailures(defCtx.scope.failureChains, {
      settings: defCtx.master.settings, window: defCtx.win.effective!, previousWindow: defCtx.win.compareRange ?? undefined, lookup: defCtx.master.index,
    });
    expect(r.listed).toBe(direct.groups.filter((g) => g.occurrences >= 2).length);
    expect(r.groups.length).toBe(Math.min(5, r.listed));
    for (let i = 1; i < r.groups.length; i++) expect(r.groups[i - 1]!.occurrences).toBeGreaterThanOrEqual(r.groups[i]!.occurrences);
    expect(r.events).toBe(r.ids.length);
    expect(r.hours).toBeLessThanOrEqual(r.failureHours + 1e-9);
  });
});

describe('availability heat map', () => {
  it('cells equal areaMonthAvailability; target tones at the 5-point boundary; no target, no tone', () => {
    const h = availabilityHeat(monthCtx)!;
    const direct = areaMonthAvailability({
      rows: monthCtx.scope.kpiRows, chains: monthCtx.scope.chains, range: h.range, dataRange: monthCtx.coverage, areaIds: monthCtx.base.areaIds,
      settings: monthCtx.master.settings, attribution: monthCtx.scope.attribution, notUploaded: monthCtx.notUploaded,
    });
    for (const row of h.rows) {
      const d = direct.areas.find((a) => a.area_id === row.area_id)!;
      row.cells.forEach((c, i) => {
        const m = d.values[i]!;
        if (m.available) expect(c.pct! / 100).toBeCloseTo(m.value, 12); else expect(c.pct).toBeNull();
      });
    }
    expect(h.sortMonth).toBe(fullMonth);
    const k = h.months.findIndex((m) => m.key === fullMonth);
    for (let i = 1; i < h.rows.length; i++) expect((h.rows[i - 1]!.cells[k]!.pct ?? Infinity) <= (h.rows[i]!.cells[k]!.pct ?? Infinity)).toBe(true);
    expect(h.rows.every((r) => r.cells.every((c) => c.tone === null))).toBe(true);
    const t = { availabilityPct: 85 };
    expect(heatTone(0.85, t)).toBe('ok');
    expect(heatTone(0.8499, t)).toBe('ok'); // shown as 85.0%
    expect(heatTone(0.84, t)).toBe('near');
    expect(heatTone(0.80, t)).toBe('near');
    expect(heatTone(0.7999, t)).toBe('near'); // 80.0 shown
    expect(heatTone(0.794, t)).toBe('below');
    expect(heatTone(null, t)).toBeNull();
    expect(heatTone(0.5, { availabilityPct: null })).toBeNull();
  });

  it('RF and UF: the same area-month cells from the monthly KPIs; RF is toned against the RF target (95 % default), UF never', () => {
    const rf = availabilityHeat(monthCtx, 'reliability')!;
    const uf = availabilityHeat(monthCtx, 'utilization')!;
    expect(rf.metric).toBe('reliability');
    expect(rf.target).toBe(95);
    expect(uf.target).toBeNull();
    const k = rf.months.findIndex((m) => m.key === fullMonth);
    const cur = monthCtx.kpis.current;
    if (cur.status !== 'ok') throw new Error('no data');
    // with a one-month range each cell of the sorted month equals that area's KPI
    for (const a of cur.areas) {
      const r = rf.rows.find((x) => x.area_id === a.area_id)!.cells[k]!;
      const u = uf.rows.find((x) => x.area_id === a.area_id)!.cells[k]!;
      if (a.reliabilityFactor.available) {
        expect(r.pct! / 100).toBeCloseTo(a.reliabilityFactor.value, 12);
        expect(r.tone).toBe(heatTone(a.reliabilityFactor.value, { availabilityPct: null, reliabilityPct: 95 }, 'reliability'));
      } else expect(r.pct).toBeNull();
      if (a.utilizationFactor.available) expect(u.pct! / 100).toBeCloseTo(a.utilizationFactor.value, 12);
      expect(u.tone).toBeNull();
    }
    expect(heatTone(0.95, { availabilityPct: null, reliabilityPct: 95 }, 'reliability')).toBe('ok');
    expect(heatTone(0.89, { availabilityPct: null, reliabilityPct: 95 }, 'reliability')).toBe('below');
    expect(heatTone(0.2, { availabilityPct: 90, reliabilityPct: 95 }, 'utilization')).toBeNull();
  });
});

describe('daily helpers, scope text', () => {
  it('last n days and runs of mostly planned days', () => {
    expect(lastDays([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(lastDays([1], 14)).toEqual([1]);
    const d = (date: string, pl: number, total: number) => ({ date, hasData: true, plannedHours: pl, downtimeHours: total });
    const days = [d('2026-08-10', 1, 10), d('2026-08-11', 2, 9), d('2026-08-12', 90, 100), d('2026-08-13', 80, 95), d('2026-08-14', 70, 98), d('2026-08-15', 1, 10), d('2026-08-16', 50, 60)];
    expect(plannedRuns(days)).toEqual([{ from: '2026-08-12', to: '2026-08-14' }]);
  });

  it('period and scope wording', () => {
    expect(periodText({ from: '2026-08-01', to: '2026-08-31' })).toBe('Aug 2026');
    expect(periodText({ from: '2026-01-01', to: '2026-10-12' })).toBe('Jan – Oct 2026');
    expect(periodText({ from: '2026-10-01', to: '2026-10-12' })).toBe('1–12 Oct 2026');
    expect(periodText({ from: '2026-07-14', to: '2026-10-11' })).toBe('14 Jul – 11 Oct 2026');
    const f = defaultFilters();
    expect(scopeText({ from: '2026-08-01', to: '2026-08-31' }, f)).toBe('Aug 2026 · All lines · All areas · All types');
    expect(scopeText({ from: '2026-08-01', to: '2026-08-31' }, { ...f, lineIds: ['L.1'] }, 'failures')).toBe('Aug 2026 · L.1 · All areas · Incidental');
    expect(scopeText({ from: '2026-08-01', to: '2026-08-31' }, { ...f, areaIds: ['K.1', 'K.2'] }, 'none')).toBe('Aug 2026 · All lines · 2 areas');
  });

  it('a one-month comparison reads "vs Jul"', () => {
    expect(compareShort({ win: { compareRange: { from: '2026-07-01', to: '2026-07-31' }, compare: 'previous_period' } } as Parameters<typeof compareShort>[0])).toBe('vs Jul');
    expect(compareShort({ win: { compareRange: { from: '2026-07-05', to: '2026-07-31' }, compare: 'previous_period' } } as Parameters<typeof compareShort>[0])).toBe('vs previous period');
    expect(compareShort({ win: { compareRange: null, compare: 'none' } } as unknown as Parameters<typeof compareShort>[0])).toBe('');
  });

  it('the monthly adapter and the trend share their numbers', () => {
    const t = trendModel(defCtx, 'month', 'type')!;
    const m = monthly(defCtx);
    for (const x of m) {
      const s = t.slots.find((y) => y.key === x.month);
      if (s && x.hasData && !x.partial) expect(s.values.inc).toBeCloseTo(x.failureHours, 6);
    }
  });
});
