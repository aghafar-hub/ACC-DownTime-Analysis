import { describe, expect, it } from 'vitest';
import type { EventRow, Startup } from '../api/types';
import { defaultFilters } from '../dashboard/filters';
import { applyFilters, EMPTY, scopeRows } from '../pages/events/explorerFilters';
import { buildSyntheticDb } from '../mock/synthetic';
import { readXlsxSheet } from '../upload/xlsxReader';
import { buildEventsWorkbook, eventsCsv, eventsFileName, eventsTable, EVENTS_EXPORT_CAP } from './eventsExport';
import { serialOfStamp } from './xlsx';

const db = buildSyntheticDb();
const startup: Startup = {
  lines: db.lines, areas: db.areas, equipment: db.equipment, equipment_areas: db.equipment_areas, aliases: db.aliases,
  classifications: db.classifications, reasons: db.reasons, settings: db.settings, years: [2026, 2025],
};
const rows2026 = db.events.filter((e) => e.event_date.startsWith('2026'));

const HEADERS = [
  'Event ID', 'Date', 'Line', 'Area', 'Code', 'Equipment description', 'Stopped at', 'Restarted at', 'Duration h', 'Freq', 'Classification', 'Criticality', 'Failure',
  'Reason', 'Description', 'Open problems', 'Kept as entered', 'Edited', 'Void', 'Source file', 'Source row', 'Batch ID', 'Created at',
];

describe('Event Explorer export', () => {
  it('has every column, in the wanted order', () => {
    const ex = eventsTable(rows2026.slice(0, 3), startup);
    expect(ex.table.columns.map((c) => c.header)).toEqual(HEADERS);
    expect(ex.table.columns.find((c) => c.header === 'Duration h')!.format).toBe('h2');
    expect(ex.table.columns.find((c) => c.header === 'Stopped at')!.format).toBe('datetime');
    expect(ex.table.columns.find((c) => c.header === 'Date')!.format).toBe('date');
  });

  it('exports exactly the filtered rows in the list\'s order', async () => {
    const shared = { filters: { ...defaultFilters(), failureOnly: true, areaIds: [db.areas.find((a) => a.active)!.area_id] }, range: { from: '2026-01-01', to: '2026-12-31' } };
    const filtered = applyFilters(scopeRows(rows2026, shared, startup), { ...EMPTY, sort: 'dur_desc' }, startup, '');
    expect(filtered.length).toBeGreaterThan(3);
    const ex = eventsTable(filtered, startup);
    expect(ex.exported).toBe(filtered.length);
    expect(ex.matching).toBe(filtered.length);
    expect(ex.capped).toBe(false);
    expect(ex.table.rows.map((r) => r[0])).toEqual(filtered.map((e) => e.event_id));
    const wb = buildEventsWorkbook(ex, { filters: 'Failures only', scope: 'Events of 2026', by: 'Tester', on: '2026-10-13 11:05:09' });
    const r = await readXlsxSheet(wb, 'Events');
    if (!r.ok) throw new Error('events');
    expect(r.sheets).toEqual(['Events', 'Export info']);
    expect(r.data[0]).toEqual(HEADERS);
    expect(r.data).toHaveLength(1 + filtered.length);
    filtered.forEach((e, i) => {
      const row = r.data[1 + i]!;
      expect(row[0]).toBe(e.event_id);
      expect(row[3]).toBe(e.area_id);
      expect(row[8]).toBeCloseTo(e.duration_s / 3600, 9);
      expect(row[6]).toBe(serialOfStamp(e.stop_ts));
      expect(row[12]).toBe(e.is_failure ? 'Yes' : 'No'); // 'Failures only' lists whole failure events: a continuation row says No
    });
  });

  it('every field of a row: description of known equipment, open problems and kept-as-entered labels, flags as Yes/No, source and batch', () => {
    const eq = db.equipment[0]!;
    const row: EventRow = {
      ...rows2026[0]!, event_id: 'EV-1', event_date: '2026-09-05', code_raw: eq.equipment_id, equipment_id: eq.equipment_id, area_id: db.areas[0]!.area_id,
      stop_ts: '2026-09-05 08:00:00.000', start_ts: '2026-09-05 09:30:00.000', duration_s: 5400, freq: 0, classification: 'MEC', criticality: 'INC', is_failure: true,
      reason_raw: 'Belt, torn "badly"', description: 'line 1\nline 2', flags: 'blank_reason,unknown_code', accepted_flags: 'unknown_code', edited: true, is_void: false,
      source_file: 'Aug 2026.xlsx', source_row: 17, batch_id: 'B-9', created_at: '2026-09-06 10:00:00.000',
    };
    const ex = eventsTable([row], startup);
    const r = ex.table.rows[0]!;
    expect(r).toEqual([
      'EV-1', '2026-09-05', startup.areas.find((a) => a.area_id === row.area_id)!.line_id, row.area_id, eq.equipment_id, eq.description ?? '',
      '2026-09-05 08:00:00.000', '2026-09-05 09:30:00.000', 1.5, 0, 'MEC', 'INC', 'Yes', 'Belt, torn "badly"', 'line 1\nline 2',
      'No reason', 'Unknown code', 'Yes', 'No', 'Aug 2026.xlsx', 17, 'B-9', '2026-09-06 10:00:00.000',
    ]);
    // unknown_code is kept as entered (column 17), so only blank_reason is still open (column 16)
    const csv = eventsCsv(ex);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"Belt, torn ""badly"""');
    expect(csv).toContain('"line 1\nline 2"');
  });

  it('a voided row says Void = Yes and a missing source stays empty', () => {
    const row: EventRow = { ...rows2026[0]!, is_void: true, source_file: undefined, source_row: undefined };
    const r = eventsTable([row], startup).table.rows[0]!;
    expect(r[18]).toBe('Yes');
    expect(r[19]).toBe('');
    expect(r[20]).toBeNull();
  });

  it('is capped at 50,000 rows, says so, and keeps the first rows of the list', async () => {
    expect(EVENTS_EXPORT_CAP).toBe(50_000);
    const small = eventsTable(rows2026.slice(0, 10), startup, 4);
    expect(small.capped).toBe(true);
    expect(small.exported).toBe(4);
    expect(small.matching).toBe(10);
    expect(small.table.rows.map((r) => r[0])).toEqual(rows2026.slice(0, 4).map((e) => e.event_id));
    const wb = buildEventsWorkbook(small, { filters: 'No filters', scope: 'Events of 2026', by: '', on: '2026-10-13 11:05:09' });
    const info = await readXlsxSheet(wb, 'Export info');
    if (!info.ok) throw new Error('info');
    const flat = info.data.flat();
    expect(flat.some((x) => typeof x === 'string' && x.includes('Only the first 4 rows'))).toBe(true);
    expect(flat).toContain(10);
    expect(flat).toContain('No filters');
    expect(eventsTable(rows2026.slice(0, 4), startup, 4).capped).toBe(false);
  });

  it('works on the loaded events only: a person\'s own rows are all that can go in', () => {
    const mine = rows2026.slice(0, 5);
    expect(eventsTable(mine, startup).table.rows.map((r) => r[0])).toEqual(mine.map((e) => e.event_id));
    expect(eventsTable([], startup).exported).toBe(0);
  });

  it('file names: ACC-downtime-events_2026.xlsx', () => {
    expect(eventsFileName('2026', 'xlsx')).toBe('ACC-downtime-events_2026.xlsx');
    expect(eventsFileName('selection', 'csv')).toBe('ACC-downtime-events_selection.csv');
  });
});
