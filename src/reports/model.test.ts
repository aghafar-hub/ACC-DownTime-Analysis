import { describe, expect, it } from 'vitest';
import type { EventRow, Startup } from '../api/types';
import { dataRangeOf, isBlocked } from '../calc';
import { areaReliabilityModel, equipmentModel, overviewModel, reasonModel } from '../dashboard/models';
import { buildCtx, rowsInRange } from '../dashboard/scope';
import { defaultFilters } from '../dashboard/filters';
import { buildSyntheticDb } from '../mock/synthetic';
import { buildReport, describeFilters, reportContext, scopeCounts, type ReportModel, type SectionModel } from './model';
import { SECTION_ORDER } from './sections';
import { defaultSetup, type ReportSetup } from './setup';

const db = buildSyntheticDb();
const startup: Startup = {
  lines: db.lines, areas: db.areas, equipment: db.equipment, equipment_areas: db.equipment_areas, aliases: db.aliases,
  classifications: db.classifications, reasons: db.reasons, settings: db.settings, years: [2026, 2025],
};
const asOf = dataRangeOf(db.events.filter((r) => !r.is_void))!.to;
const base = (over: Partial<ReportSetup> = {}): ReportSetup => ({ ...defaultSetup('monthly'), ...over });
const run = (setup: ReportSetup, rows: EventRow[] = db.events, st: Startup = startup): ReportModel =>
  buildReport({ setup, startup: st, rows, asOf, generatedAt: '2026-10-13 11:00', generatedBy: 'Tester', plant: 'Sokhna' });
const get = <T extends SectionModel['id']>(m: ReportModel, id: T): Extract<SectionModel, { id: T }> => m.sections.find((s) => s.id === id) as Extract<SectionModel, { id: T }>;
const withFilters = (f: Partial<ReportSetup['filters']>): ReportSetup => base({ filters: { ...base().filters, ...f } });

describe('report equals the dashboards for the same filters', () => {
  const m = run(base());
  const { ctx } = reportContext(base(), startup, db.events, asOf);
  const dash = buildCtx(db.events, startup, { ...defaultFilters(), preset: 'custom', from: m.range.from, to: m.range.to, compare: 'previous_period' }, m.range);

  it('builds every section of the monthly template in catalogue order', () => {
    expect(m.sections.map((s) => s.id)).toEqual(SECTION_ORDER);
    expect(m.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(m.compare).toMatchObject({ on: true, kind: 'previous_period', range: { from: '2026-08-01', to: '2026-08-31' } });
  });
  it('KPI strip, scope line, areas, availability, MTBF and rate are the dashboards\' numbers', () => {
    const ov = overviewModel(dash);
    const k = ov.kpi!;
    const s = get(m, 'summary');
    const card = (id: string) => s.data.kpis.find((x) => x.id === id)!;
    expect(card('stoppage').value).toBeCloseTo(k.total.downtimeHours, 9);
    expect(card('failures').value).toBe(k.total.failureCount);
    expect(card('availability').value).toBe(k.total.availabilityHeadline.available ? k.total.availabilityHeadline.value : null);
    expect(card('mttr').value).toBe(k.total.mttrHours.available ? k.total.mttrHours.value : null);
    expect(card('stoppage').change).toEqual(ov.downtimeChange);
    expect(m.scope.events).toBe(rowsInRange(dash.scope, dash.win.range).length);
    expect(m.scope.areaHours).toBeCloseTo(k.total.downtimeHours, 9);
    expect(scopeCounts(ctx)).toEqual(m.scope);
    const av = get(m, 'availability').data;
    expect(av.areas).toEqual(ov.availability!.areas);
    const rel = areaReliabilityModel(dash)!;
    expect(get(m, 'mtbf_mttr').data.mtbf).toEqual(rel.mtbf);
    expect(get(m, 'failure_rate').data.rows).toEqual(rel.rate.rows);
    expect(get(m, 'quadrant').data.result).toEqual(rel.quadrant);
    expect(get(m, 'area_downtime').data.rows.reduce((a, r) => a + r.total, 0)).toBeCloseTo(k.total.downtimeHours, 6);
    expect(get(m, 'daily').data.days).toEqual(ov.daily);
    expect(get(m, 'monthly').data.months).toEqual(ov.monthly);
  });
  it('causes: top equipment and reasons are the Pareto bars of the dashboards', () => {
    const eq = equipmentModel(dash)!;
    expect(get(m, 'top_equipment').data.bars.map((b) => [b.key, b.value])).toEqual(eq.hours.own.bars.filter((b) => !b.isOthers).slice(0, 10).map((b) => [b.key, b.value]));
    expect(get(m, 'top_equipment').data.total).toBe(eq.hours.own.total);
    const rs = reasonModel(dash, false)!;
    expect(get(m, 'top_reasons').data.bars.map((b) => b.key)).toEqual(rs.hours.bars.filter((b) => !b.isOthers).slice(0, 10).map((b) => b.key));
  });
  it('options: Top N and Hours / Count', () => {
    const o = run(base({ sections: ['top_equipment', 'longest', 'events', 'when'], options: { top_equipment: { top: 5, measure: 'count' }, longest: { top: 20 }, events: { top: 10 }, when: { measure: 'hours' } } }));
    const eq = equipmentModel(dash)!;
    expect(get(o, 'top_equipment').data.bars.map((b) => b.key)).toEqual(eq.count.own.bars.filter((b) => !b.isOthers).slice(0, 5).map((b) => b.key));
    expect(get(o, 'longest').data.events.length).toBeLessThanOrEqual(20);
    expect(get(o, 'longest').data.events.length).toBeGreaterThan(10);
    expect(get(o, 'events').data.table.rows).toHaveLength(10);
    expect(get(o, 'when').data.measure).toBe('hours');
  });
  it('only the chosen sections are built', () => {
    const o = run(base({ sections: ['summary', 'daily'] }));
    expect(o.sections.map((s) => s.id)).toEqual(['summary', 'daily']);
  });
});

describe('filters', () => {
  const full = run(base({ sections: ['summary', 'area_downtime', 'events'] }));
  const hours = (m: ReportModel) => get(m, 'summary').data.kpis.find((k) => k.id === 'stoppage')!.value!;
  it('line, area, equipment, classification, criticality and failures-only each narrow the numbers', () => {
    const line = run(withFilters({ lineIds: ['L.1'] }));
    expect(line.scope.events).toBeLessThan(full.scope.events);
    expect(get(line, 'area_downtime').data.rows.every((r) => startup.areas.find((a) => a.area_id === r.areaId)!.line_id === 'L.1')).toBe(true);
    const area = run(withFilters({ areaIds: ['K.1'] }));
    expect(get(area, 'area_downtime').data.rows.map((r) => r.areaId)).toEqual(['K.1']);
    expect(hours(area)).toBeLessThan(hours(full));
    const code = get(run(base({ sections: ['top_equipment'] })), 'top_equipment').data.bars[0]!.key;
    const eq = run(withFilters({ equipmentIds: [code] }));
    expect(eq.scope.events).toBeGreaterThan(0);
    expect(eq.scope.events).toBeLessThan(full.scope.events);
    const cls = run(withFilters({ classifications: ['PL'] }));
    expect(get(cls, 'events').data.table.rows.every((r) => r[3] === 'PL')).toBe(true);
    const inc = run(withFilters({ criticality: ['NO_INC'] }));
    expect(inc.scope.events).toBeLessThan(full.scope.events);
    const fail = run(withFilters({ failuresOnly: true }));
    expect(get(fail, 'events').data.table.rows.every((r) => r[6] === 'Yes')).toBe(true);
    expect(fail.scope.events).toBeLessThan(full.scope.events);
  });
  it('numbers equal the dashboards for the same filters (area + classification)', () => {
    const m = run(withFilters({ areaIds: ['K.1'], classifications: ['MEC'] }));
    const dash = buildCtx(db.events, startup, { ...defaultFilters(), preset: 'custom', from: m.range.from, to: m.range.to, compare: 'previous_period', areaIds: ['K.1'], classifications: ['MEC'] }, m.range);
    expect(hours(m)).toBeCloseTo(overviewModel(dash).kpi!.total.downtimeHours, 9);
  });
  it('describes the filters in words', () => {
    expect(describeFilters(withFilters({ lineIds: ['L.1'], areaIds: ['CR', 'RM.1'], equipmentIds: ['131.ST200'] })).summary).toBe('Line L.1 - Areas CR, RM.1 - Equipment 131.ST200');
    expect(describeFilters(base()).summary).toBe('All lines, areas and equipment');
    expect(describeFilters(withFilters({ failuresOnly: true })).summary).toBe('Failures only');
  });
});

describe('comparison, empty data, excluded records', () => {
  it('without comparison there is no previous period and no change', () => {
    const m = run(base({ compare: false, sections: ['summary'] }));
    expect(m.compare).toMatchObject({ on: false, kind: 'none', range: null });
    
    expect(get(m, 'summary').data.compare).toBe('none');
  });
  it('year to date compares with the same dates last year', () => {
    const m = run(base({ preset: 'ytd', sections: ['summary'] }));
    expect(m.compare.kind).toBe('same_period_last_year');
    expect(m.compare.range!.from).toBe('2025-01-01');
  });
  it('a period without data says so in every data section instead of an empty chart', () => {
    const m = run(base({ preset: 'custom', from: '2030-01-01', to: '2030-01-31' }));
    expect(m.noData).toBeTruthy();
    for (const id of ['summary', 'daily', 'monthly', 'availability', 'top_equipment', 'repeats', 'quadrant', 'when', 'events'] as const) {
      expect(get(m, id).empty, id).toBeTruthy();
    }
  });
  it('a filter that matches nothing gives clear sentences, never zeros as figures', () => {
    const m = run(withFilters({ equipmentIds: ['NO.SUCH.CODE'] }));
    expect(m.scope.events).toBe(0);
    expect(get(m, 'events').empty).toMatch(/No records/);
    expect(get(m, 'top_equipment').empty).toBeTruthy();
    expect(get(m, 'longest').empty).toBeTruthy();
  });
  it('voided records and records with a blocking problem are left out, as in the dashboards', () => {
    const rows: EventRow[] = db.events.map((r) => ({ ...r }));
    const inMonth = rows.filter((r) => r.stop_ts.startsWith('2026-09') && !r.is_void && !isBlocked(r));
    const before = run(base({ sections: ['summary', 'quality'] }), rows);
    const [a, b] = inMonth;
    a!.is_void = true;
    b!.flags = 'missing_classification';
    const after = run(base({ sections: ['summary', 'quality'] }), rows);
    expect(after.scope.events).toBe(before.scope.events - 2);
    const q0 = get(before, 'quality').data;
    const q1 = get(after, 'quality').data;
    expect(q1.voided).toBe(q0.voided + 1);
    expect(q1.leftOut.count).toBe(q0.leftOut.count + 1);
    expect(q1.records).toBe(q0.records - 1); // the voided one is not checked; the blocked one is checked and left out
  });
  it('the quality appendix always states the counts', () => {
    const q = get(run(base({ sections: ['quality'] })), 'quality');
    expect(q.takeaway).toMatch(/records were checked/);
    expect(q.data.counted).toBe(run(base()).scope.events);
  });
});
