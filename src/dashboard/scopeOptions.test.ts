import { describe, expect, it } from 'vitest';
import type { EventRow, Startup } from '../api/types';
import { buildSyntheticDb } from '../mock/synthetic';
import { defaultFilters, parseFilters } from './filters';
import {
  areaOptions, chosenGroups, compareText, coverageSegments, coverageText, equipmentOptions, periodText, pruneScope, toggleGroup, typeGroups, typeSummary,
} from './scopeOptions';

const db = buildSyntheticDb();
const startup: Startup = {
  lines: db.lines, areas: db.areas, equipment: db.equipment, equipment_areas: db.equipment_areas, aliases: db.aliases,
  classifications: db.classifications, reasons: db.reasons, settings: db.settings, years: [2026, 2025],
};
const live = db.areas.filter((a) => a.active && a.in_downtime_sheet);
const lineA = live[0]!.line_id;
const lineB = live.find((a) => a.line_id !== lineA)!.line_id;
const areaOf = (line: string) => live.find((a) => a.line_id === line)!.area_id;
const ownCode = (area: string) => db.equipment_areas.find((ea) => ea.area_id === area && db.equipment.some((e) => e.equipment_id === ea.equipment_id && e.status === 'Active'))!.equipment_id;

describe('scope options and their dependencies', () => {
  it('a line narrows the areas', () => {
    const all = areaOptions(db.areas, { lineIds: [] }).map((o) => o.value);
    const one = areaOptions(db.areas, { lineIds: [lineA] }).map((o) => o.value);
    expect(one.length).toBeGreaterThan(0);
    expect(one.length).toBeLessThan(all.length);
    expect(one.every((a) => db.areas.find((x) => x.area_id === a)!.line_id === lineA)).toBe(true);
  });

  it('the equipment list is the codes of the chosen areas plus cross-area cause codes from the records', () => {
    const area = areaOf(lineA);
    const opts = equipmentOptions(startup, [], { lineIds: [], areaIds: [area] });
    expect(opts.map((o) => o.value)).toContain(ownCode(area));
    // a stop of this area caused by another area's equipment brings that code in, marked as cross-area
    const foreign = ownCode(areaOf(lineB));
    const row = { ...db.events.find((e) => e.area_id === area && !e.is_void)!, equipment_id: foreign, code_raw: foreign, is_area_level: false } as EventRow;
    const withCross = equipmentOptions(startup, [row], { lineIds: [], areaIds: [area] });
    const cross = withCross.find((o) => o.value === foreign);
    expect(cross?.crossArea).toBe(true);
    expect(cross?.hint).toContain('cross-area');
  });

  it('changing the line prunes the areas and equipment that fell out of scope', () => {
    const areaA = areaOf(lineA);
    const codeA = ownCode(areaA);
    const start = { ...defaultFilters(), areaIds: [areaA], equipmentIds: [codeA] };
    const pruned = pruneScope({ ...start, lineIds: [lineB] }, startup, []);
    expect(pruned.areaIds).toEqual([]);
    expect(pruned.equipmentIds).toEqual([]);
    // staying on the same line keeps both
    const kept = pruneScope({ ...start, lineIds: [lineA] }, startup, []);
    expect(kept.areaIds).toEqual([areaA]);
    expect(kept.equipmentIds).toEqual([codeA]);
  });

  it('type groups map Incidental / Planned / Other onto the classifications', () => {
    const g = typeGroups(db.classifications);
    expect(g.planned).toEqual(['PL']);
    expect(g.other).toEqual(['CIR']);
    expect(g.incidental).toEqual(expect.arrayContaining(['PRO', 'MEC', 'ELE', 'AUT']));
    const inc = toggleGroup([], 'incidental', g);
    expect(chosenGroups(inc, g)).toEqual(['incidental']);
    expect(typeSummary({ ...defaultFilters(), classifications: inc }, g)).toBe('Incidental');
    expect(typeSummary({ ...defaultFilters(), classifications: [...inc, 'PL'] }, g)).toBe('Incidental + Planned');
    expect(typeSummary({ ...defaultFilters(), classifications: ['MEC'], failureOnly: true }, g)).toBe('MEC +1');
    expect(typeSummary(defaultFilters(), g)).toBe('All');
    expect(toggleGroup(inc, 'incidental', g)).toEqual([]);
  });

  it('chip texts: the period and the comparison in the one date format', () => {
    expect(periodText({ ...defaultFilters(), preset: 'month', month: '2026-08' }, { from: '2026-08-01', to: '2026-08-31' })).toBe('Aug 2026');
    expect(periodText({ ...defaultFilters(), preset: 'custom' }, { from: '2026-07-14', to: '2026-10-11' })).toBe('14 Jul – 11 Oct 2026');
    expect(periodText(defaultFilters(), { from: '2026-07-14', to: '2026-10-11' })).toBe('Last 90 days');
    expect(compareText('previous_period', { from: '2026-07-01', to: '2026-07-31' })).toBe('Jul 2026');
    expect(compareText('none', null)).toBe('None');
    expect(compareText('previous_period', { from: '2026-04-15', to: '2026-07-13' })).toBe('Previous 90 days');
    expect(compareText('same_period_last_year', { from: '2025-07-14', to: '2025-10-11' })).toBe('Same period 2025');
  });

  it('an old Event Explorer address with from / to is a custom range', () => {
    const f = parseFilters(new URLSearchParams('from=2026-08-01&to=2026-08-31&area=CR'));
    expect(f).toMatchObject({ preset: 'custom', from: '2026-08-01', to: '2026-08-31', areaIds: ['CR'] });
  });
});

describe('data coverage', () => {
  it('cuts the months not uploaded out of the coverage', () => {
    const segs = coverageSegments({ from: '2026-01-01', to: '2026-10-12' }, ['2026-09']);
    expect(segs).toEqual([{ from: '2026-01-01', to: '2026-08-31' }, { from: '2026-10-01', to: '2026-10-12' }]);
    expect(coverageText(segs)).toBe('1 Jan – 31 Aug 2026 and 1–12 Oct 2026');
    expect(coverageSegments({ from: '2026-01-01', to: '2026-03-31' }, [])).toEqual([{ from: '2026-01-01', to: '2026-03-31' }]);
    expect(coverageSegments(null, ['2026-02'])).toEqual([]);
  });
});
