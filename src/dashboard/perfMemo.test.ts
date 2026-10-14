import { describe, expect, it } from 'vitest';
import type { Startup } from '../api/types';
import { dataRangeOf, equipmentMonthHeatmap, equipmentReasonHeatmap, reasonMonthHeatmap, rowCode, topHeatmapRows } from '../calc';
import { buildSyntheticDb } from '../mock/synthetic';
import { defaultFilters, resolveRange } from './filters';
import { markNotUploaded, reasonMonthModel, repeatsModel } from './models';
import { buildBase, buildCtx, buildEventScope, buildMaster, clearScopeMemo, Lru } from './scope';

// R5: the heat maps are built once and cut to the top rows, and the scope stages are memoised. Neither may change
// a single number: these tests compare with the direct (limited) builds and with fresh, un-memoised builds.

const db = buildSyntheticDb();
const startup: Startup = {
  lines: db.lines, areas: db.areas, equipment: db.equipment, equipment_areas: db.equipment_areas, aliases: db.aliases,
  classifications: db.classifications, reasons: db.reasons, settings: db.settings, years: [2026, 2025],
};
const rows = db.events;
const coverage = dataRangeOf(rows.filter((r) => !r.is_void))!;
const f = { ...defaultFilters(), preset: 'ytd' as const };
const range = resolveRange(f, coverage.to);

describe('heat maps: one full build, cut to the top rows', () => {
  const ctx = buildCtx(rows, startup, f, range);
  const window = ctx.win.effective!;
  const index = ctx.master.index;
  const attribution = ctx.scope.attribution;
  const coded = ctx.scope.failureChains.filter((c) => rowCode(c.head, index).kind !== 'area_level');

  it('repeatsModel equals the direct builds with the row limits', () => {
    const m = repeatsModel(ctx)!;
    expect(m.heatMonthHours).toEqual(markNotUploaded(equipmentMonthHeatmap(coded, index, window, { measure: 'hours', maxRows: 15, attribution }), ctx.notUploaded));
    expect(m.heatMonthCount).toEqual(markNotUploaded(equipmentMonthHeatmap(coded, index, window, { measure: 'count', maxRows: 15 }), ctx.notUploaded));
    expect(m.heatReasonHours).toEqual(equipmentReasonHeatmap(coded, index, window, { measure: 'hours', maxRows: 12, maxCols: 8, attribution }));
    expect(m.heatReasonCount).toEqual(equipmentReasonHeatmap(coded, index, window, { measure: 'count', maxRows: 12, maxCols: 8 }));
    expect(m.heatAll.monthHours).toEqual(markNotUploaded(equipmentMonthHeatmap(coded, index, window, { measure: 'hours', attribution }), ctx.notUploaded));
    expect(m.heatAll.reasonCount).toEqual(equipmentReasonHeatmap(coded, index, window, { measure: 'count', maxCols: 8 }));
    // the mock data has more rows than the cut, so the cut is really exercised
    expect(m.heatAll.monthHours.rows.length).toBeGreaterThan(15);
    expect(m.heatMonthHours.omittedRows).toBe(m.heatAll.monthHours.rows.length - 15);
  });

  it('reasonMonthModel equals the direct builds with the row limit', () => {
    const rm = reasonMonthModel(ctx)!;
    const chains = ctx.scope.failureChains;
    expect(rm.hours).toEqual(markNotUploaded(reasonMonthHeatmap(chains, window, { measure: 'hours', maxRows: 12, attribution }), ctx.notUploaded));
    expect(rm.count).toEqual(markNotUploaded(reasonMonthHeatmap(chains, window, { measure: 'count', maxRows: 12 }), ctx.notUploaded));
  });

  it('a cut larger than the map keeps every row', () => {
    const full = equipmentReasonHeatmap(coded, index, window, { measure: 'count' });
    expect(topHeatmapRows(full, full.rows.length + 5)).toEqual(full);
    expect(topHeatmapRows(full, full.rows.length)).toEqual(equipmentReasonHeatmap(coded, index, window, { measure: 'count', maxRows: full.rows.length }));
  });
});

describe('scope memo', () => {
  it('returns the same build for the same inputs and a fresh one when an input changes', () => {
    clearScopeMemo();
    const master = buildMaster(startup);
    expect(buildMaster(startup)).toBe(master);
    const b1 = buildBase(rows, startup, f, master);
    expect(buildBase(rows, startup, { lineIds: [], areaIds: [] }, master)).toBe(b1); // only lines and areas reach the base
    const line = startup.lines[0]!.line_id;
    const b2 = buildBase(rows, startup, { ...f, lineIds: [line] }, master);
    expect(b2).not.toBe(b1);
    expect(b2.areaIds.length).toBeLessThan(b1.areaIds.length);
    const s1 = buildEventScope(b1, f, master);
    expect(buildEventScope(b1, { ...f, compare: 'none' as const, preset: 'last30' as const }, master)).toBe(s1);
    const s2 = buildEventScope(b1, { ...f, failureOnly: true }, master);
    expect(s2).not.toBe(s1);
    // other rows (a new upload) never hit the old entry
    const copy = [...rows];
    expect(buildBase(copy, startup, f, master)).not.toBe(b1);
  });

  it('memoised contexts equal fresh ones', () => {
    const variants = [f, { ...f, failureOnly: true }, { ...f, lineIds: [startup.lines[0]!.line_id] }, f];
    for (const v of variants) {
      const memo = buildCtx(rows, startup, v, range);
      clearScopeMemo();
      const fresh = buildCtx([...rows], startup, v, range);
      expect(memo.kpis).toEqual(fresh.kpis);
      expect(memo.scope.failureChains.length).toBe(fresh.scope.failureChains.length);
    }
  });

  it('the LRU drops the least recently used entry', () => {
    const l = new Lru<number>(2);
    l.set('a', 1);
    l.set('b', 2);
    expect(l.get('a')).toBe(1);
    l.set('c', 3);
    expect(l.get('b')).toBeUndefined();
    expect(l.get('a')).toBe(1);
    expect(l.get('c')).toBe(3);
  });
});
