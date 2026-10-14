import { describe, expect, it } from 'vitest';
import type { EventRow, Startup } from '../api/types';
import { dataRangeOf } from '../calc';
import { areaReliabilityModel, areaModel, equipmentModel, overviewModel, reasonModel, repeatsModel } from '../dashboard/models';
import { areaOptions } from '../dashboard/scopeOptions';
import { defaultFilters, resolveRange, type DashFilters } from '../dashboard/filters';
import { buildCtx } from '../dashboard/scope';
import { buildSyntheticDb } from '../mock/synthetic';
import { buildValidation } from '../validate/model';
import { inactiveAreaIds, inactiveAreas, splitInactive, withoutInactive } from './activeAreas';

// Backend 1.5.0: an area switched off. Every page builds from the rows the event hooks hand out (splitInactive) and from
// the start-up data (whose areas carry active = false). These tests prove that this gives exactly the numbers of a plant
// in which the area and its records never existed.

const db = buildSyntheticDb();
const startupOf = (areas = db.areas): Startup => ({
  lines: db.lines, areas, equipment: db.equipment, equipment_areas: db.equipment_areas, aliases: db.aliases,
  classifications: db.classifications, reasons: db.reasons, settings: db.settings, years: [2026, 2025],
});
const OFF = 'AFR';
const all = startupOf();
const switchedOff = startupOf(db.areas.map((a) => (a.area_id === OFF ? { ...a, active: false } : a)));
const neverThere = startupOf(db.areas.filter((a) => a.area_id !== OFF));
const rows: EventRow[] = db.events;
const rowsWithout = rows.filter((r) => r.area_id !== OFF);

/** What useDash builds: the as-of date from the rows the hook hands out, then the context. */
function ctxFor(startup: Startup, list: EventRow[], f: DashFilters = { ...defaultFilters(), preset: 'ytd' }) {
  const asOf = dataRangeOf(list.filter((r) => !r.is_void))!.to;
  return buildCtx(list, startup, f, resolveRange(f, asOf));
}

describe('inactive areas: the split', () => {
  it('lists the areas switched off and leaves their records out', () => {
    expect(inactiveAreaIds(all)).toEqual([]);
    expect(inactiveAreaIds(switchedOff)).toEqual([OFF]);
    expect(inactiveAreas(switchedOff).map((a) => a.area_id)).toEqual([OFF]);
    const split = splitInactive(rows, inactiveAreaIds(switchedOff));
    expect(split.rows).toEqual(rowsWithout);
    expect(split.hidden.length).toBe(rows.length - rowsWithout.length);
    expect(split.hidden.length).toBeGreaterThan(100);
    expect(split.hidden.every((r) => r.area_id === OFF)).toBe(true);
    expect(withoutInactive(rows, switchedOff)).toBe(split.rows);
  });

  it('with no area switched off, the very same array comes back (the memo keys of the pages do not change)', () => {
    expect(splitInactive(rows, inactiveAreaIds(all)).rows).toBe(rows);
    expect(splitInactive(rows, [OFF])).toBe(splitInactive(rows, [OFF]));
  });

  it('the scope bar does not offer the area', () => {
    expect(areaOptions(all.areas, { lineIds: [] }).map((o) => o.value)).toContain(OFF);
    expect(areaOptions(switchedOff.areas, { lineIds: [] }).map((o) => o.value)).not.toContain(OFF);
  });
});

describe('inactive areas: every number equals the plant without that area', () => {
  const off = ctxFor(switchedOff, splitInactive(rows, inactiveAreaIds(switchedOff)).rows);
  const gone = ctxFor(neverThere, rowsWithout);
  const full = ctxFor(all, rows);

  it('the area is really in the full data (the comparison is not empty)', () => {
    expect(full.base.areaIds).toContain(OFF);
    expect(full.kpis.current).not.toEqual(gone.kpis.current);
  });

  it('scheduled time, KPIs and availability (T leaves the area out)', () => {
    expect(off.base.areaIds).not.toContain(OFF);
    expect(off.base.areaIds).toEqual(gone.base.areaIds);
    expect(off.win).toEqual(gone.win);
    expect(off.coverage).toEqual(gone.coverage);
    expect(off.notUploaded).toEqual(gone.notUploaded);
    expect(off.kpis.current).toEqual(gone.kpis.current);
    expect(off.kpis.comparison).toEqual(gone.kpis.comparison);
    expect(overviewModel(off)).toEqual(overviewModel(gone));
  });

  it('Pareto (equipment, reason, area), repeats and reliability', () => {
    expect(equipmentModel(off)).toEqual(equipmentModel(gone));
    expect(reasonModel(off, false)).toEqual(reasonModel(gone, false));
    expect(areaModel(off, 'hours')).toEqual(areaModel(gone, 'hours'));
    expect(areaModel(off, 'hours')!.bars.map((b) => b.key)).not.toContain(OFF);
    expect(repeatsModel(off)).toEqual(repeatsModel(gone));
    expect(areaReliabilityModel(off)).toEqual(areaReliabilityModel(gone));
  });

  it('a line filter and a month vs month style comparison agree too', () => {
    const f: DashFilters = { ...defaultFilters(), preset: 'last90', lineIds: ['L.2'], compare: 'previous_period' };
    const a = ctxFor(switchedOff, splitInactive(rows, [OFF]).rows, f);
    const b = ctxFor(neverThere, rowsWithout, f);
    expect(a.base.areaIds).toEqual(b.base.areaIds);
    expect(a.kpis).toEqual(b.kpis);
  });

  it('Validate counts only the records of active areas', () => {
    const split = splitInactive(rows, [OFF]);
    expect(buildValidation(split.rows).summary).toEqual(buildValidation(rowsWithout).summary);
  });
});
