// The report as Excel sheets and CSV tables. Every table comes from the SAME report model the screen and the print use
// (src/reports/model.ts), cell for cell, so a number in a sheet is the number in the report: the model's own tables are
// used as they are, and where a chart plots more than its table lists (every day of a long period, every month of the
// classification chart, the whole hour-by-weekday grid) the plotted data is exported instead. Pure: no clock, no DOM.
import type { ReportSectionId } from '../api/types';
import { CLASS_ORDER } from '../charts/palette';
import { statusLine } from '../dashboard/targets';
import { changeText } from '../reports/format';
import type { ReportModel, ReportTable, SectionModel } from '../reports/model';
import { t } from '../i18n/t';
import { exportFileName, periodSlug } from './files';
import { exportCol, tableToCsv, tableToSheet, type ColFormat, type ExportTable, type ExportValue } from './table';
import { buildXlsx, sheetNames, type XCell, type XSheet } from './xlsx';

const KIND: Record<ReportTable['columns'][number]['kind'], ColFormat> = { text: 'text', hours: 'h1', hours2: 'h2', count: 'int', pct: 'pct' };

/** Sheet names of the sections (short, so they fit 31 characters and read well in a tab). */
export const SHEET_TITLES: Record<ReportSectionId, string> = {
  cover: 'Cover', summary: 'Executive summary', daily: 'Daily stopped hours', monthly: 'Monthly stoppage', classes: 'Downtime by classification',
  area_downtime: 'Downtime by area', availability: 'Availability by area', mtbf_mttr: 'MTBF and MTTR', failure_rate: 'Failure rate',
  top_equipment: 'Top equipment', top_reasons: 'Top reasons', pareto: 'Pareto', repeats: 'Repeated failures', longest: 'Longest events',
  quadrant: 'MTBF vs MTTR', when: 'When failures start', events: 'Events', quality: 'Data quality', methodology: 'Methodology',
};

/** The model's table as an export table; `formats` overrides the format of columns by index (for example a text column that holds dates). */
function fromTable(id: ReportSectionId, tb: ReportTable, formats: Record<number, ColFormat> = {}): ExportTable {
  return {
    id, sheet: t(SHEET_TITLES[id]),
    columns: tb.columns.map((c, i) => exportCol(c.label, formats[i] ?? KIND[c.kind])),
    rows: tb.rows.map((r) => [...r]),
    total: tb.total ? [...tb.total] : undefined,
  };
}

const num = (v: number | null): ExportValue => v;

function withNotes(tb: ExportTable, s: SectionModel): ExportTable {
  const notes: string[] = [];
  if (s.takeaway) notes.push(s.takeaway);
  if (s.empty) notes.push(s.empty);
  notes.push(...s.notes);
  return { ...tb, notes };
}

/** The export table of one section, or null when the section holds no table (cover, methodology go to the Summary / Methodology sheet instead). */
export function sectionTable(s: SectionModel, model: ReportModel): ExportTable | null {
  switch (s.id) {
    case 'cover':
      return null;
    case 'summary': {
      const d = s.data;
      const rows: ExportValue[][] = d.kpis.map((k) => {
        const ch = changeText(k.change, k.changeUnit, d.compare);
        const unit = k.id === 'availability' ? '%' : k.id === 'failures' || k.id === 'repeats' ? t('count') : 'h';
        const value = k.value === null ? null : k.id === 'availability' ? k.value * 100 : k.value;
        return [k.label, k.text, num(value), unit, ch ? [ch.arrow, ch.amount, ch.words ? `· ${ch.words}` : ''].filter(Boolean).join(' ') : '', k.status ? statusLine(k.status) : ''];
      });
      const tb: ExportTable = {
        id: s.id, sheet: t(SHEET_TITLES.summary),
        columns: [exportCol(t('Measure')), exportCol(t('As shown')), exportCol(t('Value'), 'num'), exportCol(t('Unit')), exportCol(d.compareLabel ? t('Change {c}', { c: d.compareLabel }) : t('Change')), exportCol(t('Target status'))],
        rows,
        notes: [...d.bullets, ...s.notes, ...(s.empty ? [s.empty] : [])],
      };
      return tb;
    }
    case 'daily': {
      const d = s.data;
      return withNotes({
        id: s.id, sheet: t(SHEET_TITLES.daily),
        columns: [exportCol(t('Day'), 'date'), exportCol(t('Failure h'), 'h1'), exportCol(t('Planned h'), 'h1'), exportCol(t('Other h'), 'h1'), exportCol(t('Total h'), 'h1'), exportCol(t('{n}-day average h', { n: d.rollingDays }), 'h1')],
        rows: d.days.map((p) => (p.hasData ? [p.date, p.failureHours, p.plannedHours, p.otherHours, p.downtimeHours, p.rollingDowntimeHours] : [p.date, p.notUploaded ? 'Not uploaded' : null, null, null, null, null])),
      }, s);
    }
    case 'monthly': return withNotes(fromTable(s.id, s.data.table), s);
    case 'classes': {
      const d = s.data;
      const cols = CLASS_ORDER as readonly string[];
      const tb: ExportTable = {
        id: s.id, sheet: t(SHEET_TITLES.classes),
        columns: [exportCol(t('Month')), ...cols.map((c) => exportCol(`${c} h`, 'h1')), exportCol(t('Total h'), 'h1')],
        rows: d.months.map((m) => [m.month, ...cols.map((c) => (m.hasData ? m.hours[c as keyof typeof m.hours] : null)), m.hasData ? m.total : m.notUploaded ? 'Not uploaded' : null]),
        total: [t('Total'), ...cols.map((c) => d.totals.find((x) => x.code === c)?.hours ?? 0), d.totals.reduce((a, x) => a + x.hours, 0)],
      };
      return withNotes(tb, s);
    }
    case 'area_downtime': return withNotes(fromTable(s.id, s.data.table), s);
    case 'availability': return withNotes(fromTable(s.id, s.data.table), s);
    case 'mtbf_mttr': return withNotes(fromTable(s.id, s.data.table), s);
    case 'failure_rate': return withNotes(fromTable(s.id, s.data.table), s);
    case 'top_equipment': return withNotes(fromTable(s.id, s.data.table), s);
    case 'top_reasons': return withNotes(fromTable(s.id, s.data.table), s);
    case 'pareto': {
      const d = s.data;
      const first = d.parts[0]?.table.columns;
      const measureCol = first ? first[1]! : { label: d.measure === 'hours' ? t('Failure h') : t('Failures'), kind: d.measure === 'hours' ? 'hours' as const : 'count' as const };
      const tb: ExportTable = {
        id: s.id, sheet: t(SHEET_TITLES.pareto),
        columns: [exportCol(t('Chart')), exportCol(t('Item')), exportCol(measureCol.label, KIND[measureCol.kind]), exportCol(t('Share'), 'pct'), exportCol(t('Cumulative'), 'pct')],
        rows: d.parts.flatMap((p) => p.table.rows.map((r) => [p.title, ...r] as ExportValue[])),
      };
      return withNotes(tb, s);
    }
    case 'repeats': return withNotes(fromTable(s.id, s.data.table), s);
    case 'longest': return withNotes(fromTable(s.id, s.data.table, { 1: 'datetime' }), s);
    case 'quadrant': return withNotes(fromTable(s.id, s.data.table), s);
    case 'when': {
      const heat = s.data.heat;
      const f: ColFormat = s.data.measure === 'hours' ? 'h1' : 'int';
      const tb: ExportTable = heat
        ? {
          id: s.id, sheet: t(SHEET_TITLES.when),
          columns: [exportCol(t('Hour')), ...heat.cols.map((c) => exportCol(c.label, f)), exportCol(t('Total'), f)],
          rows: heat.rows.map((r, ri) => [r.label, ...heat.values[ri]!, r.total]),
          total: [t('Total'), ...heat.cols.map((c) => c.total), heat.total],
        }
        : { id: s.id, sheet: t(SHEET_TITLES.when), columns: [exportCol(t('Hour'))], rows: [] };
      return withNotes(tb, s);
    }
    case 'events': return withNotes(fromTable(s.id, s.data.table, { 0: 'datetime' }), s);
    case 'quality': {
      const d = s.data;
      const tb = fromTable(s.id, d.table);
      const flags = d.byFlag.length ? t('Problems found: {l}', { l: d.byFlag.map((f) => `${f.label} ${f.count}`).join('; ') }) : '';
      return {
        ...tb,
        notes: [s.takeaway, flags, t('Records checked {a}; voided {v}; left out of the numbers {l}; kept as entered {k}; {o} with a problem to check.', {
          a: d.records, v: d.voided, l: d.leftOut.count, k: d.kept.count, o: d.open,
        }), ...s.notes].filter(Boolean),
      };
    }
    case 'methodology': {
      const tb: ExportTable = {
        id: s.id, sheet: t(SHEET_TITLES.methodology),
        columns: [exportCol(t('Term')), exportCol(t('How it is calculated'))],
        rows: s.data.items.flatMap((it) => it.paragraphs.map((p, i) => [i === 0 ? it.term : '', p] as ExportValue[])),
      };
      void model;
      return tb;
    }
  }
}

/** Sections that give a CSV (they hold a table of numbers): everything except the cover and the methodology text. */
export function csvSections(model: ReportModel): { id: ReportSectionId; title: string; rows: number }[] {
  const out: { id: ReportSectionId; title: string; rows: number }[] = [];
  for (const s of model.sections) {
    if (s.id === 'cover' || s.id === 'methodology') continue;
    const tb = sectionTable(s, model);
    if (tb) out.push({ id: s.id, title: s.title, rows: tb.rows.length });
  }
  return out;
}

// ---------------------------------------------------------------- the Summary sheet and the workbook

/** The first sheet: title, period, comparison, filters, who and when, data coverage and the list of sheets. */
export function summarySheet(model: ReportModel, sheets: { title: string; sheet: string }[]): XSheet {
  const b = (v: string): XCell => ({ v, bold: true });
  const eff = model.effective;
  const rows: XCell[][] = [
    [t('Item'), t('Value')],
    [b(t('Report')), model.title],
    [b(t('Plant')), model.plant],
    [b(t('Period')), `${model.range.from} ${t('to')} ${model.range.to}`],
  ];
  if (eff && (eff.from !== model.range.from || eff.to !== model.range.to)) rows.push([b(t('Calculated for')), `${eff.from} ${t('to')} ${eff.to} (${t('where data exists')})`]);
  rows.push([b(t('Comparison')), model.compare.on && model.compare.range ? `${model.compare.label}: ${model.compare.range.from} ${t('to')} ${model.compare.range.to}` : model.compare.label]);
  rows.push([b(t('Filters')), model.filterSummary]);
  rows.push([b(t('Generated by')), model.generatedBy || '-']);
  rows.push([b(t('Generated on')), { v: model.generatedAt, fmt: 'datetime' }]);
  rows.push([b(t('Data coverage')), model.coverage ? `${model.coverage.from} ${t('to')} ${model.coverage.to}` : t('No data')]);
  rows.push([b(t('Events in scope')), { v: model.scope.events, fmt: 'int' }]);
  rows.push([b(t('Area-hours in scope')), { v: model.scope.areaHours, fmt: 'h1' }]);
  rows.push([b(t('Availability basis')), model.basis]);
  if (model.noData) rows.push([b(t('Note')), model.noData]);
  rows.push([]);
  rows.push([b(t('Sections')), b(t('Sheet'))]);
  for (const s of sheets) rows.push([s.title, s.sheet]);
  return { name: t('Summary'), rows, headerRow: 0, autoFilter: false, widths: [26, undefined] };
}

export interface ReportWorkbook {
  bytes: Uint8Array;
  fileName: string;
  /** the sheet names in file order (Summary first) */
  sheets: string[];
}

export function reportFileName(model: ReportModel, ext: 'xlsx' | 'csv', sectionTitle?: string): string {
  return exportFileName({ base: model.title, period: periodSlug(model.range), extra: sectionTitle }, ext);
}

/** The Excel workbook of a report: Summary, then one sheet per chosen section that has data to tabulate. */
export function buildReportWorkbook(model: ReportModel): ReportWorkbook {
  const tables: { title: string; table: ExportTable }[] = [];
  for (const s of model.sections) {
    const tb = sectionTable(s, model);
    if (tb) tables.push({ title: s.title, table: tb });
  }
  const names = sheetNames([t('Summary'), ...tables.map((x) => x.table.sheet)]);
  const list = tables.map((x, i) => ({ title: x.title, sheet: names[i + 1]! }));
  const sheets: XSheet[] = [{ ...summarySheet(model, list), name: names[0]! }];
  tables.forEach((x, i) => sheets.push({ ...tableToSheet(x.table), name: names[i + 1]! }));
  const created = model.generatedAt.length >= 16 ? `${model.generatedAt.slice(0, 10)}T${model.generatedAt.slice(11, 16)}:00Z` : undefined;
  return {
    bytes: buildXlsx(sheets, { title: `${model.title} ${periodSlug(model.range)}`, creator: model.generatedBy || undefined, created }),
    fileName: reportFileName(model, 'xlsx'),
    sheets: names,
  };
}

/** The CSV text of one section's table (data rows only, no total row, no notes). */
export function buildSectionCsv(model: ReportModel, id: ReportSectionId): { text: string; fileName: string } | null {
  const s = model.sections.find((x) => x.id === id);
  if (!s) return null;
  const tb = sectionTable(s, model);
  if (!tb) return null;
  return { text: tableToCsv(tb), fileName: reportFileName(model, 'csv', SHEET_TITLES[id]) };
}
