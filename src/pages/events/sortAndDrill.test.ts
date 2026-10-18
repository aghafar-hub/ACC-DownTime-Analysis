import { describe, expect, it } from 'vitest';
import type { EventRow } from '../../api/types';
import { firstDir, nextSort, parseExplorerFilters, recordStatus, serializeExplorerFilters, sortRows, type Sort } from './explorerFilters';
import { drillBannerText, drillFigures, drillItem, drillMatch, drillPageName, drillShortText, drillSummaryText } from './drillBanner';
import type { DrillState } from '../../dashboard/drill';

let n = 0;
function row(p: Partial<EventRow>): EventRow {
  n++;
  return {
    event_id: `EV-${n}`, batch_id: 'B', event_date: (p.stop_ts ?? '2026-08-01 00:00:00').slice(0, 10), line_id: 'L.1', area_id: 'RM.1',
    code_raw: '141.VL170', is_area_level: false, stop_ts: '2026-08-01 00:00:00.000', start_ts: '2026-08-01 01:00:00.000', duration_s: 3600, freq: 1,
    classification: 'MEC', criticality: 'INC', is_failure: true, fingerprint: `f${n}`, edited: false, is_void: false, created_at: '2026-08-02', ...p,
  } as EventRow;
}

describe('Event records: sorting by a column heading', () => {
  const a = row({ event_id: 'A', area_id: 'CR', code_raw: 'B.2', reason_raw: 'belt', classification: 'PRO', stop_ts: '2026-08-03 10:00:00.000', duration_s: 600, freq: 1 });
  const b = row({ event_id: 'B', area_id: 'RM.1', code_raw: 'A.1', reason_raw: '', classification: 'ELE', stop_ts: '2026-08-01 10:00:00.000', duration_s: 7200, freq: 0, edited: true });
  const c = row({ event_id: 'C', area_id: 'K.1', code_raw: 'C.3', reason_raw: 'Alarm', classification: 'PL', stop_ts: '2026-08-02 10:00:00.000', duration_s: 3600, freq: 1, flags: 'blank_reason' });
  const d = row({ event_id: 'D', area_id: 'K.1', code_raw: '', reason_raw: 'zinc', classification: 'MEC', stop_ts: '2026-08-04 10:00:00.000', duration_s: 60, freq: 1, is_void: true });
  const all = [a, b, c, d];
  const ids = (s: Sort) => sortRows(all, s).map((e) => e.event_id);

  it('orders every column both ways', () => {
    expect(ids('stop_desc')).toEqual(['D', 'A', 'C', 'B']);
    expect(ids('stop_asc')).toEqual(['B', 'C', 'A', 'D']);
    expect(ids('dur_desc')).toEqual(['B', 'C', 'A', 'D']);
    expect(ids('dur_asc')).toEqual(['D', 'A', 'C', 'B']);
    expect(ids('area_asc')).toEqual(['A', 'D', 'C', 'B']); // CR, K.1 (newest first on a tie), K.1, RM.1
    expect(ids('freq_asc')[0]).toBe('B');
    expect(ids('class_asc')).toEqual(['B', 'D', 'C', 'A']); // ELE, MEC, PL, PRO
  });

  it('puts blank text last in both directions', () => {
    expect(ids('code_asc')).toEqual(['B', 'A', 'C', 'D']);
    expect(ids('code_desc')).toEqual(['C', 'A', 'B', 'D']);
    expect(ids('reason_asc')).toEqual(['C', 'A', 'D', 'B']); // case-insensitive: Alarm, belt, zinc, then the blank one
    expect(ids('reason_desc').at(-1)).toBe('B');
  });

  it('sorts by status: OK, edited, to check, left out, void', () => {
    expect(all.map(recordStatus)).toEqual(['ok', 'edited', 'check', 'void']);
    expect(ids('status_asc')).toEqual(['A', 'B', 'C', 'D']);
    expect(ids('status_desc')).toEqual(['D', 'C', 'B', 'A']);
  });

  it('does not change the list it was given', () => {
    const before = all.map((e) => e.event_id);
    sortRows(all, 'dur_desc');
    expect(all.map((e) => e.event_id)).toEqual(before);
  });

  it('a heading click turns the same column round and starts another in its natural order', () => {
    expect(nextSort('stop_desc', 'stop')).toBe('stop_asc');
    expect(nextSort('stop_asc', 'stop')).toBe('stop_desc');
    expect(nextSort('stop_desc', 'area')).toBe('area_asc');
    expect(nextSort('area_asc', 'dur')).toBe('dur_desc');
    expect(firstDir('status')).toBe('desc');
    expect(firstDir('reason')).toBe('asc');
  });

  it('keeps any column order in the address and refuses made-up ones', () => {
    const f = { q: '', show: 'all' as const, sort: 'reason_asc' as Sort };
    expect(serializeExplorerFilters(f).toString()).toBe('sort=reason_asc');
    expect(parseExplorerFilters(new URLSearchParams('sort=reason_asc')).sort).toBe('reason_asc');
    expect(parseExplorerFilters(new URLSearchParams('sort=dur_desc')).sort).toBe('dur_desc');
    for (const bad of ['color_asc', 'stop_up', 'stop', '_asc', 'stop_asc_x']) expect(parseExplorerFilters(new URLSearchParams(`sort=${bad}`)).sort).toBe('stop_desc');
  });
});

describe('Event records: the drill context banner', () => {
  const drill: DrillState = {
    label: 'the Pareto bar 141.VL170', eventIds: ['H1', 'H2'], years: [2026], source: 'Pareto',
    range: { from: '2026-08-01', to: '2026-08-31' }, back: { pathname: '/pareto', search: '?p=month' }, bar: { hours: 3.5 },
  };
  // H1: 2 h inside August; its continuation C1 starts 31 Aug 23:00 and runs 2 h into September (1 h inside the period);
  // H2 started on 31 Jul 23:30 and ran 1 h (30 min inside the period); V is voided and never counts
  const rows = [
    row({ event_id: 'H1', stop_ts: '2026-08-10 08:00:00.000', start_ts: '2026-08-10 10:00:00.000', duration_s: 7200 }),
    row({ event_id: 'C1', freq: 0, stop_ts: '2026-08-31 23:00:00.000', start_ts: '2026-09-01 01:00:00.000', duration_s: 7200 }),
    row({ event_id: 'H2', stop_ts: '2026-07-31 23:30:00.000', start_ts: '2026-08-01 00:30:00.000', duration_s: 3600 }),
    row({ event_id: 'V', is_void: true, stop_ts: '2026-08-12 08:00:00.000', start_ts: '2026-08-12 18:00:00.000', duration_s: 36000 }),
  ];

  it('clips the hours to the period like the bar and counts events, not rows', () => {
    const f = drillFigures(rows, drill);
    expect(f).toEqual({ count: 2, unit: 'events', rows: 4, hours: 3.5 });
    // without a period nothing is clipped
    expect(drillFigures(rows, { ...drill, range: undefined }).hours).toBe(5);
  });

  it('says where the list came from in one line', () => {
    const f = drillFigures(rows, drill);
    expect(drillPageName(drill)).toBe('Causes');
    expect(drillItem(drill.label)).toBe('141.VL170');
    expect(drillItem('the event EV-9')).toBe('Event EV-9');
    expect(drillSummaryText(drill, f)).toBe('141.VL170 · 1–31 Aug 2026 · 2 events (4 rows), 3.5 h');
    expect(drillBannerText(drill, f)).toBe('From: Causes › 141.VL170 · 1–31 Aug 2026 · 2 events (4 rows), 3.5 h');
    expect(drillShortText(drill, f)).toBe('141.VL170 · 1–31 Aug 2026 · 2 events');
  });

  it('names the page by its tab, and falls back to the source word for older links', () => {
    expect(drillPageName({ back: { pathname: '/dashboard', search: '' }, source: 'Dashboard' })).toBe('Dashboard');
    expect(drillPageName({ back: { pathname: '/repeats', search: '' }, source: 'Repeats' })).toBe('Repeated failures');
    expect(drillPageName({ source: 'Notification' })).toBe('Notification');
  });

  it('checks the records against the bar to the shown decimal', () => {
    const f = drillFigures(rows, drill);
    expect(drillMatch(f, drill)).toBe('match');
    expect(drillMatch(f, { bar: { hours: 3.54 } })).toBe('match');
    expect(drillMatch(f, { bar: { hours: 3.0 } })).toBe('differs');
    expect(drillMatch(f, {})).toBeNull();
  });

  it('counts records for a drill by row ids', () => {
    const f = drillFigures(rows.slice(0, 1), { rowIds: ['H1'], range: drill.range });
    expect(f).toEqual({ count: 1, unit: 'records', rows: 1, hours: 2 });
    expect(drillSummaryText({ label: 'the Dashboard filters', range: drill.range }, f)).toBe('Dashboard filters · 1–31 Aug 2026 · 1 record, 2 h');
  });
});
