import { describe, expect, it } from 'vitest';
import { createRowFactory, fixtureIndex } from './fixtures';
import { activeFilterCount, applyFilters, durationBandOf, emptyFilter, type Filter } from './filters';
import { DEFAULT_SETTINGS } from './settings';

const ctx = { settings: DEFAULT_SETTINGS, index: fixtureIndex() };

function data() {
  const row = createRowFactory();
  return {
    a: row({ area: 'K.1', code: '100.A1', stop: '2026-03-02 10:00', start: '2026-03-02 10:20', cls: 'MEC', reason: 'Bearing failure' }), // 20 min short
    b: row({ area: 'K.1', code: '100.A2', stop: '2026-03-03 10:00', start: '2026-03-03 11:00', cls: 'ELE', reason: 'Motor trip' }), // 60 min medium
    c: row({ area: 'RM.1', code: '200.B1', stop: '2026-03-04 10:00', start: '2026-03-04 13:00', cls: 'PL', reason: 'Scheduled maintenance' }), // 180 long
    d: row({ area: 'K.2', code: 'N/A', stop: '2026-03-05 23:00', start: '2026-03-06 01:00', cls: 'CIR', reason: 'Power cut', failure: false }),
    v: row({ area: 'K.1', code: '100.A1', stop: '2026-03-02 12:00', start: '2026-03-02 13:00', isVoid: true }),
  };
}
const f = (patch: Partial<Filter>): Filter => ({ ...emptyFilter(), ...patch });
const ids = (rows: { event_id: string }[]) => rows.map((r) => r.event_id);

describe('applyFilters', () => {
  const d = data();
  const all = Object.values(d);
  it('always excludes voided events unless includeVoid', () => {
    expect(ids(applyFilters(all, emptyFilter(), ctx))).toEqual(ids([d.a, d.b, d.c, d.d]));
    expect(applyFilters(all, f({ includeVoid: true }), ctx)).toHaveLength(5);
  });
  it('filters by line, area, classification, criticality, failure flag', () => {
    expect(ids(applyFilters(all, f({ lineIds: ['L.2'] }), ctx))).toEqual([d.d.event_id]);
    expect(ids(applyFilters(all, f({ areaIds: ['RM.1'] }), ctx))).toEqual([d.c.event_id]);
    expect(ids(applyFilters(all, f({ classifications: ['MEC', 'ELE'] }), ctx))).toEqual(ids([d.a, d.b]));
    expect(ids(applyFilters(all, f({ criticality: ['NO_INC'] }), ctx))).toEqual(ids([d.c, d.d]));
    expect(ids(applyFilters(all, f({ failureOnly: true }), ctx))).toEqual(ids([d.a, d.b]));
  });
  it('filters by equipment id (case/space-insensitive), type and equipment criticality', () => {
    expect(ids(applyFilters(all, f({ equipmentIds: [' 100.a1 '] }), ctx))).toEqual([d.a.event_id]);
    expect(ids(applyFilters(all, f({ equipmentTypes: ['Fan'] }), ctx))).toEqual(ids([d.a, d.c])); // 100.A1 and 200.B1 are fans
    expect(ids(applyFilters(all, f({ equipmentCriticality: ['High'] }), ctx))).toEqual([d.a.event_id]);
    expect(applyFilters(all, f({ equipmentIds: ['N/A'] }), ctx)).toHaveLength(0); // N/A is not an equipment code
  });
  it('filters by reason match key', () => {
    expect(ids(applyFilters(all, f({ reasonKeys: ['BEARING  failure'] }), ctx))).toEqual([d.a.event_id]);
  });
  it('filters by date range and keeps a row crossing the edge', () => {
    expect(ids(applyFilters(all, f({ dateRange: { from: '2026-03-03', to: '2026-03-04' } }), ctx))).toEqual(ids([d.b, d.c]));
    // d runs 5 Mar 23:00 -> 6 Mar 01:00: it overlaps 6 Mar although it started on 5 Mar
    expect(ids(applyFilters(all, f({ dateRange: { from: '2026-03-06', to: '2026-03-06' } }), ctx))).toEqual([d.d.event_id]);
    expect(applyFilters(all, f({ dateRange: { from: '2026-03-07', to: '2026-03-09' } }), ctx)).toHaveLength(0);
  });
  it('filters by duration band from the settings thresholds', () => {
    expect(ids(applyFilters(all, f({ durationBand: 'short' }), ctx))).toEqual([d.a.event_id]);
    expect(ids(applyFilters(all, f({ durationBand: 'medium' }), ctx))).toEqual([d.b.event_id]);
    expect(ids(applyFilters(all, f({ durationBand: 'long' }), ctx))).toEqual(ids([d.c, d.d]));
  });
  it('band edges: up to 30 min is short, 120 min and above is long', () => {
    expect(durationBandOf(30 * 60, DEFAULT_SETTINGS)).toBe('short');
    expect(durationBandOf(30 * 60 + 1, DEFAULT_SETTINGS)).toBe('medium');
    expect(durationBandOf(120 * 60, DEFAULT_SETTINGS)).toBe('long');
    expect(durationBandOf(119 * 60, DEFAULT_SETTINGS)).toBe('medium');
  });
  it('combines filters with AND and counts active filters', () => {
    const flt = f({ areaIds: ['K.1'], classifications: ['ELE'], failureOnly: true });
    expect(ids(applyFilters(all, flt, ctx))).toEqual([d.b.event_id]);
    expect(activeFilterCount(flt)).toBe(3);
    expect(activeFilterCount(emptyFilter())).toBe(0);
  });
});
