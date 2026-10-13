// Event Explorer's export: exactly the rows the list shows (same filters, same order), every column of the stored event.
// It works on the events the page has already loaded for this person, so it can never hold more than they can see.
import type { EventRow, Startup } from '../api/types';
import { acceptedFlagsOf, flagLabel, openFlagsOf } from '../calc';
import { t } from '../i18n/t';
import { exportFileName } from './files';
import { exportCol, tableToCsv, tableToSheet, type ExportTable, type ExportValue } from './table';
import { buildXlsx, type XSheet } from './xlsx';

/** At most this many rows go into one export; the page says so when the list is longer. */
export const EVENTS_EXPORT_CAP = 50_000;

const yn = (b: boolean): string => (b ? t('Yes') : t('No'));

export interface EventsExport {
  table: ExportTable;
  /** rows in the file */
  exported: number;
  /** rows that match the filters (more than `exported` when capped) */
  matching: number;
  capped: boolean;
}

/** The export table of the filtered rows, in the order given. */
export function eventsTable(rows: readonly EventRow[], startup: Startup | null, cap = EVENTS_EXPORT_CAP): EventsExport {
  const description = new Map(startup?.equipment.map((e) => [e.equipment_id.trim().toLowerCase(), e.description ?? '']) ?? []);
  const lineOfArea = new Map(startup?.areas.map((a) => [a.area_id, a.line_id]) ?? []);
  const capped = rows.length > cap;
  const list = capped ? rows.slice(0, cap) : rows;
  const table: ExportTable = {
    id: 'events', sheet: t('Events'),
    columns: [
      exportCol(t('Event ID')), exportCol(t('Date'), 'date'), exportCol(t('Line')), exportCol(t('Area')), exportCol(t('Code')), exportCol(t('Equipment description')),
      exportCol(t('Stopped at'), 'datetime'), exportCol(t('Restarted at'), 'datetime'), exportCol(t('Duration h'), 'h2'), exportCol(t('Freq'), 'int'),
      exportCol(t('Classification')), exportCol(t('Criticality')), exportCol(t('Failure')), exportCol(t('Reason')), exportCol(t('Description')),
      exportCol(t('Open problems')), exportCol(t('Kept as entered')), exportCol(t('Edited')), exportCol(t('Void')),
      exportCol(t('Source file')), exportCol(t('Source row'), 'int'), exportCol(t('Batch ID')), exportCol(t('Created at'), 'datetime'),
    ],
    rows: list.map((e): ExportValue[] => [
      e.event_id, e.event_date, lineOfArea.get(e.area_id) ?? e.line_id, e.area_id, e.code_raw,
      description.get((e.equipment_id ?? e.code_raw ?? '').trim().toLowerCase()) ?? '',
      e.stop_ts, e.start_ts, e.duration_s / 3600, e.freq, e.classification, e.criticality, yn(e.is_failure),
      e.reason_raw ?? '', e.description ?? '', openFlagsOf(e).map(flagLabel).join('; '), acceptedFlagsOf(e).map(flagLabel).join('; '),
      yn(e.edited), yn(e.is_void), e.source_file ?? '', e.source_row ?? null, e.batch_id, e.created_at,
    ]),
  };
  return { table, exported: list.length, matching: rows.length, capped };
}

export interface EventsExportInfo {
  filters: string;
  scope: string;
  by: string;
  on: string;
}

export function eventsFileName(label: string, ext: 'xlsx' | 'csv'): string {
  return exportFileName({ base: 'events', period: label }, ext);
}

/** The Excel file: the Events sheet, then an 'Export info' sheet (what was exported, the filters, the cap). */
export function buildEventsWorkbook(ex: EventsExport, info: EventsExportInfo): Uint8Array {
  const b = (v: string) => ({ v, bold: true });
  const infoSheet: XSheet = {
    name: t('Export info'), headerRow: 0, autoFilter: false, widths: [24, undefined],
    rows: [
      [t('Item'), t('Value')],
      [b(t('Rows exported')), { v: ex.exported, fmt: 'int' }],
      [b(t('Rows matching the filters')), { v: ex.matching, fmt: 'int' }],
      ...(ex.capped ? [[b(t('Note')), t('Only the first {n} rows are in this file. Narrow the filters to export the rest.', { n: ex.exported.toLocaleString('en-US') })]] : []),
      [b(t('Scope')), info.scope],
      [b(t('Filters')), info.filters],
      [b(t('Exported by')), info.by || '-'],
      [b(t('Exported on')), { v: info.on, fmt: 'datetime' }],
    ],
  };
  return buildXlsx([tableToSheet(ex.table), infoSheet], { title: t('Events'), creator: info.by || undefined });
}

export const eventsCsv = (ex: EventsExport): string => tableToCsv(ex.table);
