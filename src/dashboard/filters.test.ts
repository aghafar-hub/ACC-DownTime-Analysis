import { describe, expect, it } from 'vitest';
import { activeCount, areasInScope, conflictingFilters, defaultFilters, hasFilterParams, parseFilters, resolveRange, serializeFilters } from './filters';

describe('dashboard filters in the URL', () => {
  it('a default view has an empty query and round-trips', () => {
    expect(serializeFilters(defaultFilters()).toString()).toBe('');
    const f = { ...defaultFilters(), lineIds: ['L1'], areaIds: ['K.1', 'CM.2'], equipmentIds: ['141.VL170'], classifications: ['MEC' as const], failureOnly: true, reasonKeys: ['bearing failure'], durationBand: 'long' as const, compare: 'none' as const, preset: 'month' as const, month: '2026-03' };
    const back = parseFilters(serializeFilters(f));
    expect(back).toEqual(f);
    expect(hasFilterParams(serializeFilters(f))).toBe(true);
    expect(hasFilterParams(new URLSearchParams())).toBe(false);
  });
  it('ignores junk values', () => {
    const f = parseFilters(new URLSearchParams('r=nonsense&y=abc&m=2026&cls=XX&cls=PL&band=huge&cmp=x&from=bad'));
    expect(f.preset).toBe('last90');
    expect(f.year).toBeNull();
    expect(f.month).toBeNull();
    expect(f.classifications).toEqual(['PL']);
    expect(f.durationBand).toBeNull();
    expect(f.compare).toBeNull();
    expect(f.from).toBe('');
  });
  it('resolves every preset to one range counted back from the last data day', () => {
    const asOf = '2026-10-11';
    const r = (p: string, extra = {}) => resolveRange({ ...defaultFilters(), preset: p as never, ...extra }, asOf);
    expect(r('last7')).toEqual({ from: '2026-10-05', to: asOf });
    expect(r('last30')).toEqual({ from: '2026-09-12', to: asOf });
    expect(r('last90')).toEqual({ from: '2026-07-14', to: asOf });
    expect(r('ytd')).toEqual({ from: '2026-01-01', to: asOf });
    expect(r('thismonth')).toEqual({ from: '2026-10-01', to: asOf });
    expect(r('prevmonth')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(r('year', { year: 2025 })).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(r('year', { year: 2026 })).toEqual({ from: '2026-01-01', to: asOf });
    expect(r('month', { month: '2026-03' })).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(r('custom', { from: '2026-05-10', to: '2026-05-01' })).toEqual({ from: '2026-05-01', to: '2026-05-10' });
  });
  it('selecting a line narrows the areas; counts the narrowing filters', () => {
    const areas = [
      { area_id: 'A', line_id: 'L1', active: true, in_downtime_sheet: true, sort_order: 2 },
      { area_id: 'B', line_id: 'L2', active: true, in_downtime_sheet: true, sort_order: 1 },
      { area_id: 'C', line_id: 'L1', active: true, in_downtime_sheet: false, sort_order: 3 },
    ];
    expect(areasInScope(areas, defaultFilters())).toEqual(['B', 'A']);
    expect(areasInScope(areas, { ...defaultFilters(), lineIds: ['L1'] })).toEqual(['A']);
    expect(areasInScope(areas, { ...defaultFilters(), areaIds: ['B'] })).toEqual(['B']);
    expect(activeCount({ ...defaultFilters(), lineIds: ['L1'], failureOnly: true })).toBe(2);
  });
});

describe('conflictingFilters', () => {
  it('names chips that exclude each other and stays quiet otherwise', () => {
    const base = defaultFilters();
    expect(conflictingFilters(base)).toBeNull();
    expect(conflictingFilters({ ...base, failureOnly: true, classifications: ['PL'] })).toMatch(/exclude each other/);
    expect(conflictingFilters({ ...base, failureOnly: true, classifications: ['PL', 'CIR'] })).toMatch(/PL or CIR/);
    expect(conflictingFilters({ ...base, failureOnly: true, classifications: ['PL', 'MEC'] })).toBeNull();
    expect(conflictingFilters({ ...base, failureOnly: true, criticality: ['NO_INC'] })).toMatch(/NO_INC/);
    expect(conflictingFilters({ ...base, classifications: ['CIR'], criticality: ['INC'] })).toMatch(/exclude each other/);
    expect(conflictingFilters({ ...base, classifications: ['CIR'], criticality: ['INC', 'NO_INC'] })).toBeNull();
  });
});
