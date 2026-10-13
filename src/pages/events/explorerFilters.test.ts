import { describe, expect, it } from 'vitest';
import { buildSyntheticDb } from '../../mock/synthetic';
import type { Startup } from '../../api/types';
import {
  activeCount, applyFilters, describeExplorerFilters, EMPTY, hasExplorerParams, parseExplorerFilters, serializeExplorerFilters, type Filters,
} from './explorerFilters';

const db = buildSyntheticDb();
const startup: Startup = {
  lines: db.lines, areas: db.areas, equipment: db.equipment, equipment_areas: db.equipment_areas, aliases: db.aliases,
  classifications: db.classifications, reasons: db.reasons, settings: db.settings, years: [2026],
};

describe('Event Explorer filters as a query (saved views)', () => {
  const f: Filters = { q: ' belt ', line: 'L.1', area: 'CR', classes: ['MEC', 'ELE'], crit: 'INC', failureOnly: true, from: '2026-08-01', to: '2026-08-31', show: 'issues', sort: 'dur_desc' };

  it('round-trips every filter', () => {
    const q = serializeExplorerFilters(f).toString();
    expect(parseExplorerFilters(new URLSearchParams(q))).toEqual({ ...f, q: 'belt' });
  });

  it('writes nothing for the defaults and reads an empty query as the defaults', () => {
    expect(serializeExplorerFilters(EMPTY).toString()).toBe('');
    expect(parseExplorerFilters(new URLSearchParams(''))).toEqual(EMPTY);
    expect(hasExplorerParams(new URLSearchParams('view=timeline'))).toBe(false);
    expect(hasExplorerParams(new URLSearchParams('q=a'))).toBe(true);
  });

  it('drops values that are not valid instead of trusting them', () => {
    const p = parseExplorerFilters(new URLSearchParams('cls=MEC&cls=ZZZ&cls=MEC&crit=BAD&from=yesterday&to=2026-13-40x&show=weird&sort=weird&fail=0'));
    expect(p).toEqual({ ...EMPTY, classes: ['MEC'] });
  });

  it('counts and describes the active filters', () => {
    expect(activeCount(f)).toBe(8);
    expect(activeCount(EMPTY)).toBe(0);
    expect(describeExplorerFilters(EMPTY, startup)).toBe('No filters');
    const text = describeExplorerFilters({ ...EMPTY, area: 'CR', failureOnly: true, q: 'belt' }, startup);
    expect(text).toContain('Area CR');
    expect(text).toContain('Failures only');
    expect(text).toContain('Search "belt"');
  });

  it('applyFilters picks and orders the rows (newest first by default)', () => {
    const rows = db.events.filter((e) => e.event_date.startsWith('2026'));
    const out = applyFilters(rows, { ...EMPTY, failureOnly: true }, startup, '');
    expect(out.every((e) => e.is_failure && !e.is_void)).toBe(true);
    for (let i = 1; i < out.length; i++) expect(out[i - 1]!.stop_ts >= out[i]!.stop_ts).toBe(true);
  });
});
