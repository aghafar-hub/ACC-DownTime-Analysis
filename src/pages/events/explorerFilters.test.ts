import { describe, expect, it } from 'vitest';
import { buildSyntheticDb } from '../../mock/synthetic';
import type { Startup } from '../../api/types';
import { defaultFilters } from '../../dashboard/filters';
import {
  activeCount, applyFilters, describeExplorerFilters, EMPTY, hasExplorerParams, parseExplorerFilters, scopeRows, serializeExplorerFilters, totalActive, type Filters,
} from './explorerFilters';

const db = buildSyntheticDb();
const startup: Startup = {
  lines: db.lines, areas: db.areas, equipment: db.equipment, equipment_areas: db.equipment_areas, aliases: db.aliases,
  classifications: db.classifications, reasons: db.reasons, settings: db.settings, years: [2026],
};
const rows2026 = db.events.filter((e) => e.event_date.startsWith('2026'));

describe('Event records: the page\'s own choices as a query (saved views)', () => {
  const f: Filters = { q: ' belt ', show: 'issues', sort: 'dur_desc' };

  it('round-trips every choice', () => {
    const q = serializeExplorerFilters(f).toString();
    expect(parseExplorerFilters(new URLSearchParams(q))).toEqual({ ...f, q: 'belt' });
  });

  it('writes nothing for the defaults and reads an empty query as the defaults', () => {
    expect(serializeExplorerFilters(EMPTY).toString()).toBe('');
    expect(parseExplorerFilters(new URLSearchParams(''))).toEqual(EMPTY);
    expect(hasExplorerParams(new URLSearchParams('view=timeline'))).toBe(false);
    expect(hasExplorerParams(new URLSearchParams('q=a'))).toBe(true);
    // the scope keys belong to the shared filters, not to the page
    expect(hasExplorerParams(new URLSearchParams('line=L.1&area=CR&fail=1'))).toBe(false);
  });

  it('drops values that are not valid instead of trusting them', () => {
    expect(parseExplorerFilters(new URLSearchParams('show=weird&sort=weird'))).toEqual(EMPTY);
  });

  it('counts and describes the active filters, shared and own', () => {
    expect(activeCount(f)).toBe(1);
    expect(activeCount(EMPTY)).toBe(0);
    const shared = { filters: { ...defaultFilters(), areaIds: ['CR'], failureOnly: true }, range: { from: '2026-08-01', to: '2026-08-31' } };
    expect(totalActive(f, shared)).toBe(3);
    expect(describeExplorerFilters(EMPTY, startup)).toBe('No filters');
    const text = describeExplorerFilters({ ...EMPTY, q: 'belt' }, startup, shared);
    expect(text).toContain('Period 2026-08-01 to 2026-08-31'); // files keep ISO dates
    expect(text).toContain('Area CR');
    expect(text).toContain('Failures only');
    expect(text).toContain('Search "belt"');
  });

  it('applyFilters picks and orders the rows (newest first by default)', () => {
    const out = applyFilters(rows2026, { ...EMPTY, show: 'edited' }, startup, '');
    expect(out.every((e) => e.edited)).toBe(true);
    for (let i = 1; i < out.length; i++) expect(out[i - 1]!.stop_ts >= out[i]!.stop_ts).toBe(true);
  });
});

describe('Event records follow the shared scope', () => {
  it('the period keeps the rows whose stop date is inside it, voided and flagged rows included', () => {
    const range = { from: '2026-03-01', to: '2026-03-31' };
    const out = scopeRows(rows2026, { filters: defaultFilters(), range }, startup);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((e) => e.event_date >= range.from && e.event_date <= range.to)).toBe(true);
    expect(out.length).toBe(rows2026.filter((e) => e.event_date >= range.from && e.event_date <= range.to).length);
  });

  it('failures only keeps failure rows that are not voided; area and line narrow by the master', () => {
    const range = { from: '2026-01-01', to: '2026-12-31' };
    const area = db.areas.find((a) => a.active && a.in_downtime_sheet)!;
    const out = scopeRows(rows2026, { filters: { ...defaultFilters(), failureOnly: true, areaIds: [area.area_id] }, range }, startup);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((e) => e.is_failure && !e.is_void && e.area_id === area.area_id)).toBe(true);
    const line = scopeRows(rows2026, { filters: { ...defaultFilters(), lineIds: [area.line_id] }, range }, startup);
    const areasOfLine = new Set(db.areas.filter((a) => a.line_id === area.line_id).map((a) => a.area_id));
    expect(line.every((e) => areasOfLine.has(e.area_id))).toBe(true);
  });

  it('without the period (the timeline) only the narrowing filters apply', () => {
    const out = scopeRows(rows2026, { filters: { ...defaultFilters(), classifications: ['PL'] }, range: { from: '2026-03-01', to: '2026-03-02' } }, startup, false);
    expect(out.length).toBe(rows2026.filter((e) => e.classification === 'PL').length);
  });
});
