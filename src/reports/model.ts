// The report model: every number, table and sentence of a report, built from the loaded events and the master data.
// Pure (no React, no storage, no clock): the same input gives the same report, so the numbers are unit-tested against
// the dashboard models for the same filters. Nothing is calculated here that the dashboards do not calculate: each
// section takes its figures from the dashboard model or the calc function of the matching dashboard element
// (src/dashboard/models.ts), through the same scope (src/dashboard/scope.ts) the dashboards use, with the report's own
// filter state (it never touches the dashboards' shared filters). Voided records and records with a blocking data
// problem are left out exactly as in the dashboards.
import type { ClassificationCode, EventRow, ReportSectionId, Startup } from '../api/types';
import {
  codeKey, longestEvents, rowSeconds, type AreaAvailability, type AreaRank, type Change, type ClassMonthPoint,
  type ComparisonKind, type DateRange, type DayPoint, type Heatmap, type LongEvent, type Metric, type MonthPoint, type ParetoBar, type ParetoResult,
  type QuadrantResult, type RepeatGroup, type TopN,
} from '../calc';
import { CLASS_ORDER } from '../charts/palette';
import { zoomFloor } from '../charts/scale';
import type { CompareMode } from '../dashboard/filters';
import { fh, fh2, fint, fpct, fpct0, monthLabel, MTBF_ALL_LABEL } from '../dashboard/format';
import { kpiInfo } from '../dashboard/kpiInfo';
import {
  areaModel, areaReliabilityModel, classModel, cutPareto, equipmentModel, lineModel, overviewModel, reasonModel, repeatsModel, ROLLING_DAYS, whenFailuresStart,
  type AreaReliabilityModel, type OverviewModel, type RepeatsModel,
} from '../dashboard/models';
import { buildCtx, rowsInRange, type DashCtx } from '../dashboard/scope';
import {
  areaDowntimeTakeaway, availabilityTakeaway, causesTakeaway, classesTakeaway, dailyTakeaway, eventsTakeaway, failureRateTakeaway, longestTakeaway, monthlyTakeaway,
  mtbfMttrTakeaway, paretoSectionTakeaway, qualityTakeaway, quadrantTakeaway, repeatsTakeaway, summaryBullets, whenTakeaway,
} from '../dashboard/takeaways';
import { targetNumber, type TargetStatus, type Targets } from '../dashboard/targets';
import { t } from '../i18n/t';
import { buildScorecard, type MonthQuality } from '../validate/scorecard';
import { buildValidation, type ValidationList } from '../validate/model';
import { flagLabel, isBlocked } from '../calc';
import { comparisonKindFor, resolvePeriod } from './period';
import { SECTION_BY_ID, TEMPLATE_BY_ID, effectiveOptions } from './sections';
import { resolvedOptions, toDashFilters, type ReportSetup } from './setup';

// ---------------------------------------------------------------- input and shared shapes

export interface ReportInput {
  setup: ReportSetup;
  startup: Startup;
  /** every loaded event row of the years the period needs (voided and blocked ones included: the model leaves them out where the dashboards do) */
  rows: EventRow[];
  /** the last day with data: relative periods count back from it */
  asOf: string;
  /** 'YYYY-MM-DD HH:MM' (set by the caller: the model never reads the clock) */
  generatedAt: string;
  generatedBy: string;
  plant: string;
}

/** A table cell: text, a number (formatted by the column kind) or null (shown as a dash). */
export type Cell = string | number | null;
export type ColKind = 'text' | 'hours' | 'hours2' | 'count' | 'pct';
export interface ReportColumn { label: string; kind: ColKind }
export interface ReportTable { columns: ReportColumn[]; rows: Cell[][]; /** last row printed as a total */ total?: Cell[] }

export const col = (label: string, kind: ColKind = 'text'): ReportColumn => ({ label, kind });

/** Text of a cell for the screen and the printout; numbers follow the column kind. */
export function cellText(kind: ColKind, v: Cell): string {
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'string') return v;
  switch (kind) {
    case 'hours': return fh(v);
    case 'hours2': return fh2(v);
    case 'count': return fint(v);
    case 'pct': return fpct0(v);
    default: return String(v);
  }
}

interface Base<I extends ReportSectionId> {
  id: I;
  title: string;
  /** one sentence built from the section's real numbers */
  takeaway: string;
  /** set when there is nothing to show: a clear sentence that replaces the chart and the table */
  empty: string | null;
  /** how the numbers are calculated, in a sentence or two */
  notes: string[];
}

export type KpiId = 'stoppage' | 'failures' | 'availability' | 'mttr' | 'mtbf' | 'repeats';
export interface KpiCard {
  id: KpiId;
  label: string;
  text: string;
  value: number | null;
  unavailable: boolean;
  sub: string;
  change: Change | null;
  /** how the change amount is written */
  changeUnit: 'h' | 'h2' | 'count' | 'pts';
  status: TargetStatus | null;
}

export interface CoverSection extends Base<'cover'> { data: Record<string, never> }
export interface SummarySection extends Base<'summary'> { data: { kpis: KpiCard[]; bullets: string[]; compare: CompareMode; compareLabel: string } }
export interface DailySection extends Base<'daily'> {
  data: { days: DayPoint[]; rollingDays: number; total: number; dataDays: number; peak: { date: string; hours: number } | null; tableKind: 'all' | 'peaks'; table: ReportTable };
}
export interface MonthlySection extends Base<'monthly'> { data: { months: MonthPoint[]; table: ReportTable } }
export interface ClassesSection extends Base<'classes'> {
  data: { months: ClassMonthPoint[]; totals: { code: ClassificationCode; name: string; hours: number; sharePct: number }[]; table: ReportTable };
}
export interface AreaDowntimeSection extends Base<'area_downtime'> {
  data: { rows: { areaId: string; failureHours: number; plannedHours: number; otherHours: number; total: number }[]; table: ReportTable };
}
export interface AvailabilitySection extends Base<'availability'> {
  data: {
    basis: 'A' | 'B' | 'C'; areas: AreaAvailability[]; overall: Metric; floor: number; targets: Targets; below: string[]; belowTarget: { below: string[]; total: number } | null;
    status: TargetStatus | null; table: ReportTable;
  };
}
export interface MtbfMttrSection extends Base<'mtbf_mttr'> {
  data: { mtbf: AreaRank[]; mttr: AreaRank[]; targets: Targets; status: AreaReliabilityModel['status']; table: ReportTable };
}
export interface FailureRateSection extends Base<'failure_rate'> { data: { rows: AreaRank[]; overall: Metric; table: ReportTable } }
export interface CausesData { measure: 'hours' | 'count'; top: number; bars: ParetoBar[]; total: number; entryCount: number; table: ReportTable }
export interface TopEquipmentSection extends Base<'top_equipment'> { data: CausesData }
export interface TopReasonsSection extends Base<'top_reasons'> { data: CausesData }
export interface ParetoPart { key: 'area' | 'line' | 'class'; title: string; result: ParetoResult; table: ReportTable }
export interface ParetoSection extends Base<'pareto'> { data: { measure: 'hours' | 'count'; top: number; parts: ParetoPart[] } }
export interface RepeatsSection extends Base<'repeats'> {
  data: {
    groups: RepeatGroup[]; totalGroups: number; recurrences: number; equipmentCount: number; groupHours: number; window: DateRange | null; minEvents: number; windowDays: number;
    table: ReportTable;
  };
}
export interface LongestSection extends Base<'longest'> { data: { events: LongEvent[]; table: ReportTable } }
export interface QuadrantSection extends Base<'quadrant'> { data: { result: QuadrantResult; table: ReportTable } }
export interface WhenSection extends Base<'when'> { data: { measure: 'count' | 'hours'; heat: Heatmap | null } }
export interface EventsSection extends Base<'events'> {
  data: { records: number; shown: number; all: boolean; capped: boolean; table: ReportTable };
}
export interface QualitySection extends Base<'quality'> {
  data: {
    records: number; voided: number; leftOut: { count: number; hours: number }; kept: { count: number; leftOut: number }; open: number;
    cleanPct: number | null; byFlag: { flag: string; label: string; count: number }[]; months: MonthQuality[]; table: ReportTable;
    /** records the numbers are calculated from (they pass every filter and sit inside the period) */
    counted: number;
  };
}
export interface MethodologySection extends Base<'methodology'> { data: { items: { term: string; paragraphs: string[] }[] } }

export type SectionModel =
  | CoverSection | SummarySection | DailySection | MonthlySection | ClassesSection | AreaDowntimeSection | AvailabilitySection | MtbfMttrSection
  | FailureRateSection | TopEquipmentSection | TopReasonsSection | ParetoSection | RepeatsSection | LongestSection | QuadrantSection | WhenSection
  | EventsSection | QualitySection | MethodologySection;

export interface FilterLine { label: string; value: string }

export interface ReportModel {
  title: string;
  plant: string;
  generatedAt: string;
  generatedBy: string;
  /** the period asked for */
  range: DateRange;
  /** the period the numbers are calculated for (the range cut to the data) */
  effective: DateRange | null;
  coverage: DateRange | null;
  compare: { on: boolean; kind: ComparisonKind | 'none'; range: DateRange | null; label: string };
  filters: FilterLine[];
  /** 'Line L.1 - Area CR, RM.1 - Equipment 131.ST200' */
  filterSummary: string;
  /** the same words the builder shows: events and area-hours in scope */
  scope: { events: number; areaHours: number };
  /** why nothing can be shown, or null */
  noData: string | null;
  basis: 'A' | 'B' | 'C';
  targets: Targets;
  /** the chosen sections in report order */
  sections: SectionModel[];
}

// ---------------------------------------------------------------- the context (also used by the builder's live line)

export interface ReportContext {
  range: DateRange;
  kind: ComparisonKind;
  ctx: DashCtx;
}

/** The period, the dashboards' filter state and the dashboard scope for a setup. */
export function reportContext(setup: ReportSetup, startup: Startup, rows: EventRow[], asOf: string): ReportContext {
  const range = resolvePeriod(setup.preset, setup.from, setup.to, asOf);
  const kind = comparisonKindFor(setup.preset);
  const ctx = buildCtx(rows, startup, toDashFilters(setup, range, kind), range);
  return { range, kind, ctx };
}

/** "N events, H area-hours in scope" of a context: the rows inside the period that pass every filter, and the stopped area-hours. */
export function scopeCounts(ctx: DashCtx): { events: number; areaHours: number } {
  const k = ctx.kpis.current;
  return { events: rowsInRange(ctx.scope, ctx.win.range).length, areaHours: k.status === 'ok' ? k.total.downtimeHours : 0 };
}

// ---------------------------------------------------------------- small helpers

const metricNum = (m: Metric): number | null => (m.available ? m.value : null);
const BLANK_CODE = (): string => t('(blank code)');
const nameOfClass = (startup: Startup, code: string): string => startup.classifications.find((c) => c.code === code)?.name ?? code;

/** "Line L.1 - Area CR, RM.1 - Equipment 131.ST200 - Class MEC - Criticality INC - Failures only" */
export function describeFilters(setup: ReportSetup): { lines: FilterLine[]; summary: string } {
  const f = setup.filters;
  const lines: FilterLine[] = [];
  if (f.lineIds.length) lines.push({ label: f.lineIds.length > 1 ? t('Lines') : t('Line'), value: f.lineIds.join(', ') });
  if (f.areaIds.length) lines.push({ label: f.areaIds.length > 1 ? t('Areas') : t('Area'), value: f.areaIds.join(', ') });
  if (f.equipmentIds.length) lines.push({ label: t('Equipment'), value: f.equipmentIds.join(', ') });
  if (f.classifications.length) lines.push({ label: t('Classification'), value: f.classifications.join(', ') });
  if (f.criticality.length) lines.push({ label: t('Criticality'), value: f.criticality.join(', ') });
  if (f.failuresOnly) lines.push({ label: t('Records'), value: t('Failures only') });
  const summary = lines.length === 0 ? t('All lines, areas and equipment')
    : lines.map((l) => (l.label === t('Records') ? l.value : `${l.label} ${l.value}`)).join(' - ');
  return { lines, summary };
}

function section<I extends ReportSectionId>(id: I, takeaway: string, emptyText: string | null, notes: string[] = []): Base<I> {
  return { id, title: t(SECTION_BY_ID[id].label), takeaway, empty: emptyText, notes };
}

// ---------------------------------------------------------------- the report

/** Builds the whole report: the meta (cover, filters, period) and one model per chosen section, in report order. */
export function buildReport(input: ReportInput): ReportModel {
  const { setup, startup } = input;
  const { range, kind, ctx } = reportContext(setup, startup, input.rows, input.asOf);
  const settings = ctx.master.settings;
  const effective = ctx.win.effective;
  const cur = ctx.kpis.current;
  const noData = cur.status === 'no_data' ? cur.reason : null;
  const ov = overviewModel(ctx);
  const cmpRange = ctx.win.compareRange;
  const { lines, summary } = describeFilters(setup);
  const reasonNoData = noData ?? t('No data covers the selected period.');
  const opts = resolvedOptions(setup);
  const scope = scopeCounts(ctx);
  // no record passes the filters in the period: every data section says so instead of showing zeros as figures
  const none = noData !== null || !effective ? reasonNoData : scope.events === 0 ? t('No records match the filters in this period.') : null;
  const env: Env = { input, ctx, ov, noData: none, opts };

  const sections: SectionModel[] = [];
  for (const id of setup.sections) sections.push(buildSection(id, env));

  return {
    title: t(TEMPLATE_BY_ID[setup.template].label),
    plant: input.plant, generatedAt: input.generatedAt, generatedBy: input.generatedBy,
    range, effective, coverage: ctx.coverage,
    compare: {
      on: setup.compare, kind: setup.compare ? kind : 'none', range: setup.compare ? cmpRange : null,
      label: !setup.compare ? t('No comparison') : kind === 'same_period_last_year' ? t('Same period last year') : t('Previous period'),
    },
    filters: lines, filterSummary: summary, scope, noData: none,
    basis: settings.availabilityBasis, targets: ov.targets, sections,
  };
}

interface Env {
  input: ReportInput;
  ctx: DashCtx;
  ov: OverviewModel;
  /** no usable data in the period: every data section says so */
  noData: string | null;
  opts: ReturnType<typeof resolvedOptions>;
}

function buildSection(id: ReportSectionId, env: Env): SectionModel {
  switch (id) {
    case 'cover': return { ...section('cover', '', null), data: {} };
    case 'summary': return summarySection(env);
    case 'daily': return dailySection(env);
    case 'monthly': return monthlySection(env);
    case 'classes': return classesSection(env);
    case 'area_downtime': return areaDowntimeSection(env);
    case 'availability': return availabilitySection(env);
    case 'mtbf_mttr': return mtbfMttrSection(env);
    case 'failure_rate': return failureRateSection(env);
    case 'top_equipment': return topEquipmentSection(env);
    case 'top_reasons': return topReasonsSection(env);
    case 'pareto': return paretoSection(env);
    case 'repeats': return repeatsSection(env);
    case 'longest': return longestSection(env);
    case 'quadrant': return quadrantSection(env);
    case 'when': return whenSection(env);
    case 'events': return eventsSection(env);
    case 'quality': return qualitySection(env);
    case 'methodology': return methodologySection(env);
  }
}


// ---------------------------------------------------------------- summary

function summarySection(env: Env): SummarySection {
  const { ctx, ov } = env;
  const compare = ov.compare;
  const compareLabel = compare === 'none' ? '' : compare === 'same_period_last_year' ? t('vs same period last year') : t('vs previous period');
  const k = ov.kpi;
  if (!k || env.noData) {
    return { ...section('summary', env.noData ?? '', env.noData ?? t('No data for this period.')), data: { kpis: [], bullets: [], compare, compareLabel } };
  }
  const tot = k.total;
  const ch = ov.changes;
  const one = k.areas.length === 1 ? k.areas[0]! : null;
  const down = tot.downtimeHours;
  const kpis: KpiCard[] = [
    { id: 'stoppage', label: t('Total stoppage'), text: `${fh(down)} h`, value: down, unavailable: false, sub: k.areas.length === 1 ? t('area-hours, 1 area') : t('area-hours over {n} areas', { n: k.areas.length }), change: ov.downtimeChange, changeUnit: 'h', status: null },
    {
      id: 'failures', label: t('Failures'), text: tot.failureCount === 0 ? t('None recorded') : fint(tot.failureCount), value: tot.failureCount, unavailable: false,
      sub: t('{n} failure events', { n: fint(tot.failureEventCount) }), change: ch?.failureCount ?? null, changeUnit: 'count', status: null,
    },
    {
      id: 'availability', label: t('Availability (basis {b})', { b: ctx.master.settings.availabilityBasis }), text: tot.availabilityHeadline.available ? fpct(tot.availabilityHeadline.value) : t('Unavailable'),
      value: metricNum(tot.availabilityHeadline), unavailable: !tot.availabilityHeadline.available, sub: tot.availabilityHeadline.available ? t('area-hours, all areas together') : tot.availabilityHeadline.reason,
      change: ch?.availability ?? null, changeUnit: 'pts', status: ov.status.availability,
    },
    {
      id: 'mttr', label: t('Mean restoration time'), text: tot.mttrHours.available ? `${fh2(tot.mttrHours.value)} h` : tot.mttrHours.code === 'no_failures' ? t('None recorded') : t('Unavailable'),
      value: metricNum(tot.mttrHours), unavailable: !tot.mttrHours.available && tot.mttrHours.code !== 'no_failures', sub: t('mean length of a failure event'),
      change: ch?.mttrHours ?? null, changeUnit: 'h2', status: ov.status.mttr,
    },
  ];
  // P4: one MTBF rule and label everywhere (all-area operating area-hours / failure events)
  kpis.push({
    id: 'mtbf', label: t(MTBF_ALL_LABEL), text: tot.mtbfHours.available ? `${fh(tot.mtbfHours.value)} h` : tot.mtbfHours.code === 'no_failures' ? t('None recorded') : t('Unavailable'),
    value: metricNum(tot.mtbfHours), unavailable: !tot.mtbfHours.available && tot.mtbfHours.code !== 'no_failures',
    sub: one ? t('operating hours per failure event, 1 area') : t('operating area-hours per failure event'),
    change: ch?.mtbfHours ?? null, changeUnit: 'h', status: ov.status.mtbf,
  });
  kpis.push({
    id: 'repeats', label: t('Repeated failures'), text: k.repeatedFailureCount === 0 ? t('None recorded') : fint(k.repeatedFailureCount), value: k.repeatedFailureCount, unavailable: false,
    sub: t('{g} groups; occurrences after the first', { g: fint(k.repeatGroups) }), change: ov.repeatedChange, changeUnit: 'count', status: null,
  });
  const top = ov.topEquipment.bars[0];
  const bullets = summaryBullets({
    downtimeHours: down, failureHours: tot.failureHours, plannedHours: tot.plannedHours, otherHours: tot.otherHours,
    failureCount: tot.failureCount, failureEventCount: tot.failureEventCount, areaCount: k.areas.length,
    availability: tot.availabilityHeadline, basis: ctx.master.settings.availabilityBasis, mttr: tot.mttrHours, topArea: k.topArea,
    topEquipment: top ? { code: top.label.trim() ? top.label : BLANK_CODE(), hours: top.value } : null,
    repeatGroups: k.repeatGroups, repeatedFailureCount: k.repeatedFailureCount,
    downtimeChange: ov.downtimeChange, availabilityChange: ch?.availability ?? null, mttrChange: ch?.mttrHours ?? null, compare,
    availabilityStatus: ov.status.availability, mttrStatus: ov.status.mttr, belowTarget: ov.belowTarget,
  });
  return {
    ...section('summary', bullets[0] ?? '', null, [
      t('Hours are area-hours: each area is counted separately and the hours are added up, so two areas stopped at the same time count twice.'),
      ...(compare === 'none' ? [] : [t('Changes compare this period with the {c}; a green or red mark says whether the change is better or worse, and the arrow and words say it too.', { c: compare === 'same_period_last_year' ? t('same period last year') : t('previous period') })]),
    ]),
    data: { kpis, bullets, compare, compareLabel },
  };
}

// ---------------------------------------------------------------- performance

function dailySection(env: Env): DailySection {
  const { ov } = env;
  const days = ov.daily;
  const dataDays = days.filter((d) => d.hasData);
  const total = dataDays.reduce((s, d) => s + d.downtimeHours, 0);
  const peakDay = dataDays.reduce<DayPoint | null>((b, d) => (!b || d.downtimeHours > b.downtimeHours ? d : b), null);
  const peak = peakDay ? { date: peakDay.date, hours: peakDay.downtimeHours } : null;
  const all = days.length <= 31;
  const picked = all ? days : [...dataDays].sort((a, b) => b.downtimeHours - a.downtimeHours || (a.date < b.date ? -1 : 1)).slice(0, 10);
  const table: ReportTable = {
    columns: [col(t('Day')), col(t('Failure h'), 'hours'), col(t('Planned h'), 'hours'), col(t('CIR h'), 'hours'), col(t('Total h'), 'hours'), col(t('{n}-day average h', { n: ROLLING_DAYS }), 'hours')],
    rows: picked.map((d) => (d.hasData ? [d.date, d.failureHours, d.plannedHours, d.otherHours, d.downtimeHours, d.rollingDowntimeHours] : [d.date, d.notUploaded ? t('Not uploaded') : null, null, null, null, null])),
  };
  const emptyText = env.noData ?? (dataDays.length === 0 ? t('No daily data in this period.') : null);
  return {
    ...section('daily', dailyTakeaway({ days: dataDays.length, totalHours: total, peak }), emptyText, [
      t('Failure, planned and CIR hours per day, summed over the areas in scope (area-hours). Days without data show no bar; the line is the {n}-day average of the total.', { n: ROLLING_DAYS }),
      ...(all ? [] : [t('The table lists the 10 days with the most stopped hours; the chart shows every day.')]),
    ]),
    data: { days, rollingDays: ROLLING_DAYS, total, dataDays: dataDays.length, peak, tableKind: all ? 'all' : 'peaks', table },
  };
}

function monthlySection(env: Env): MonthlySection {
  const months = env.ov.monthly;
  const withData = months.filter((m) => m.hasData);
  const sum = (pick: (m: MonthPoint) => number): number => withData.reduce((s, m) => s + pick(m), 0);
  const peak = withData.reduce<{ month: string; hours: number } | null>((b, m) => {
    const h = m.failureHours + m.plannedHours + m.otherHours;
    return !b || h > b.hours ? { month: m.month, hours: h } : b;
  }, null);
  const table: ReportTable = {
    columns: [col(t('Month')), col(t('Failure h'), 'hours'), col(t('Planned h'), 'hours'), col(t('CIR h'), 'hours'), col(t('Total h'), 'hours'), col(t('Failures'), 'count')],
    rows: months.map((m) => [m.partial ? `${monthLabel(m.month)} (${t('partial')})` : monthLabel(m.month),
      ...(m.hasData ? [m.failureHours, m.plannedHours, m.otherHours, m.failureHours + m.plannedHours + m.otherHours, m.failureCount] : m.notUploaded ? [t('Not uploaded'), null, null, null, null] : [null, null, null, null, null])]),
    total: withData.length > 1 ? [t('Total'), sum((m) => m.failureHours), sum((m) => m.plannedHours), sum((m) => m.otherHours), sum((m) => m.failureHours + m.plannedHours + m.otherHours), sum((m) => m.failureCount)] : undefined,
  };
  return {
    ...section('monthly', monthlyTakeaway({
      months: withData.length, failureHours: sum((m) => m.failureHours), plannedHours: sum((m) => m.plannedHours), otherHours: sum((m) => m.otherHours), peak,
    }), env.noData ?? (withData.length === 0 ? t('No monthly data in this period.') : null), [
      t('Failure, planned and CIR hours per month, summed over the areas in scope (area-hours). A month still in progress or only partly covered by data is marked and outlined with a dashed line.'),
      ...(months.some((m) => m.notUploaded) ? [t('Not uploaded (no records at all, left out, never 0 h): {m}.', { m: months.filter((m) => m.notUploaded).map((m) => monthLabel(m.month)).join(', ') })] : []),
    ]),
    data: { months, table },
  };
}

function classesSection(env: Env): ClassesSection {
  const months = env.ov.byClass;
  const totals = CLASS_ORDER.map((code) => ({ code: code as ClassificationCode, name: nameOfClass(env.input.startup, code), hours: months.reduce((s, m) => s + m.hours[code], 0), sharePct: 0 }));
  const all = totals.reduce((s, c) => s + c.hours, 0);
  for (const c of totals) c.sharePct = all > 0 ? (c.hours / all) * 100 : 0;
  const topC = [...totals].sort((a, b) => b.hours - a.hours)[0];
  const table: ReportTable = {
    columns: [col(t('Classification')), col(t('Name')), col(t('Hours'), 'hours'), col(t('Share'), 'pct')],
    rows: totals.map((c) => [c.code, c.name, c.hours, c.sharePct]),
    total: [t('Total'), '', all, all > 0 ? 100 : null],
  };
  return {
    ...section('classes', classesTakeaway({ total: all, top: topC && topC.hours > 0 ? { code: topC.code, name: topC.name, hours: topC.hours } : null }), env.noData ?? (all > 0 ? null : t('No stopped hours in this period.')), [
      t('Stopped hours per month and classification, summed over the areas in scope (area-hours). PL is planned stops and CIR is other circumstantial stops; the other classes are failures.'),
    ]),
    data: { months, totals, table },
  };
}

function areaDowntimeSection(env: Env): AreaDowntimeSection {
  const rows = [...env.ov.perArea].sort((a, b) => b.downtimeHours - a.downtimeHours || (a.area_id < b.area_id ? -1 : 1))
    .map((a) => ({ areaId: a.area_id, failureHours: a.failureHours, plannedHours: a.plannedHours, otherHours: a.otherHours, total: a.downtimeHours }));
  const total = rows.reduce((s, r) => s + r.total, 0);
  const top = rows[0];
  const table: ReportTable = {
    columns: [col(t('Area')), col(t('Failure h'), 'hours'), col(t('Planned h'), 'hours'), col(t('CIR h'), 'hours'), col(t('Total h'), 'hours'), col(t('Share'), 'pct')],
    rows: rows.map((r) => [r.areaId, r.failureHours, r.plannedHours, r.otherHours, r.total, total > 0 ? (r.total / total) * 100 : null]),
    total: rows.length > 1 ? [t('All areas'), rows.reduce((s, r) => s + r.failureHours, 0), rows.reduce((s, r) => s + r.plannedHours, 0), rows.reduce((s, r) => s + r.otherHours, 0), total, total > 0 ? 100 : null] : undefined,
  };
  return {
    ...section('area_downtime', areaDowntimeTakeaway({ total, top: top && top.total > 0 ? { areaId: top.areaId, hours: top.total } : null, areaCount: rows.length }),
      env.noData ?? (total > 0 ? null : t('No stopped hours in this period.')), [t('Stopped hours of each area in the period, largest first (area-hours of that area).')]),
    data: { rows, table },
  };
}

function availabilitySection(env: Env): AvailabilitySection {
  const { ov, ctx } = env;
  const av = ov.availability;
  const basis = ctx.master.settings.availabilityBasis;
  const areas = av?.areas ?? [];
  const overall = av?.overall ?? { available: false as const, code: 'no_data', reason: '' };
  const targets = ov.targets;
  const belowIds = new Set(ov.belowTarget?.below ?? []);
  const values = areas.flatMap((a) => (a.availability.available ? [{ id: a.area_id, v: a.availability.value * 100 }] : []));
  const floor = zoomFloor(Math.min(...values.map((x) => x.v), ...(overall.available ? [overall.value * 100] : []), ...(targets.availabilityPct !== null ? [targets.availabilityPct] : [])));
  const lowest = values[0] ? { areaId: values[0].id, value: values[0].v / 100 } : null;
  const highest = values.length ? { areaId: values[values.length - 1]!.id, value: values[values.length - 1]!.v / 100 } : null;
  const withTarget = targets.availabilityPct !== null;
  const table: ReportTable = {
    columns: [col(t('Area')), col(t('Availability'), 'pct'), ...(withTarget ? [col(t('Status'))] : [])],
    rows: areas.map((a) => [a.area_id, a.availability.available ? a.availability.value * 100 : null, ...(withTarget ? [!a.availability.available ? '–' : belowIds.has(a.area_id) ? t('Below target') : t('On target')] : [])]),
    total: av ? [t('All areas together'), overall.available ? overall.value * 100 : null, ...(withTarget ? [ov.status.availability ? (ov.status.availability.ok ? t('On target') : t('Below target')) : '–'] : [])] : undefined,
  };
  return {
    ...section('availability', availabilityTakeaway({ basis, lowest, highest, overall, belowTarget: ov.belowTarget, target: targets.availabilityPct }),
      env.noData ?? (areas.length === 0 || values.length === 0 ? t('No availability can be calculated for these areas.') : null), [
        t('Availability on basis {b}, worked out from summed area-hours for each area and for all areas together; never an average of percentages.', { b: basis }),
        ...(withTarget ? [t('Target {x}% from Settings: striped bars are below the target.', { x: targetNumber(targets.availabilityPct!) })] : []),
      ]),
    data: { basis, areas, overall, floor, targets, below: [...belowIds], belowTarget: ov.belowTarget, status: ov.status.availability, table },
  };
}

function reliabilityOf(env: Env): AreaReliabilityModel | null {
  return areaReliabilityModel(env.ctx);
}

function mtbfMttrSection(env: Env): MtbfMttrSection {
  const m = reliabilityOf(env);
  const targets = m?.targets ?? env.ov.targets;
  const mtbf = m?.mtbf ?? [];
  const mttr = m?.mttr ?? [];
  const ranked = (r: AreaRank[]): AreaRank[] => r.filter((x) => x.value !== null);
  const stateOf = (id: string, k: 'mtbf' | 'mttr'): string => {
    const s = m?.status.get(id)?.[k];
    return s ? (s.ok ? t('On target') : s.state === 'above' ? t('Above target') : t('Below target')) : '–';
  };
  const withMtbfTarget = targets.mtbfH !== null;
  const withMttrTarget = targets.mttrH !== null;
  const table: ReportTable = {
    columns: [col(t('Area')), col(t('MTBF h'), 'hours'), ...(withMtbfTarget ? [col(t('MTBF status'))] : []), col(t('MTTR h'), 'hours2'), ...(withMttrTarget ? [col(t('MTTR status'))] : [])],
    rows: (m ? m.mtbf : []).map((r) => {
      const q = mttr.find((x) => x.area_id === r.area_id);
      const none = (x: AreaRank | undefined): string | null => (x && x.value === null ? (x.code === 'no_failures' ? t('none recorded') : t('unavailable')) : null);
      return [r.area_id, r.value ?? none(r), ...(withMtbfTarget ? [stateOf(r.area_id, 'mtbf')] : []), q?.value ?? none(q), ...(withMttrTarget ? [stateOf(r.area_id, 'mttr')] : [])];
    }),
  };
  const lo = ranked(mtbf)[0];
  const hi = ranked(mttr)[0];
  return {
    ...section('mtbf_mttr', mtbfMttrTakeaway({
      lowestMtbf: lo ? { areaId: lo.area_id, value: lo.value! } : null, highestMttr: hi ? { areaId: hi.area_id, value: hi.value! } : null, withFailures: ranked(mtbf).length, areaCount: mtbf.length,
    }), env.noData ?? (!m || ranked(mtbf).length === 0 ? t('No area has failures in this period, so there is nothing to rank.') : null), [
      t('MTBF = operating hours divided by failure events; MTTR = mean length of the failure events that started in the period. Both are worked out per area; the all-area figure (MTBF · all areas (area-hours)) divides the summed operating area-hours by all failure events, never an average of the areas.'),
      t('Areas with no failures have no MTBF and no MTTR and are listed last.'),
    ]),
    data: { mtbf, mttr, targets, status: m?.status ?? new Map(), table },
  };
}

function failureRateSection(env: Env): FailureRateSection {
  const m = reliabilityOf(env);
  const rows = m?.rate.rows ?? [];
  const overall = m?.rate.overall ?? { available: false as const, code: 'no_data', reason: '' };
  const top = rows.find((r) => r.value !== null);
  const table: ReportTable = {
    columns: [col(t('Area')), col(t('Failures per 1,000 h'), 'hours2')],
    rows: rows.map((r) => [r.area_id, r.value ?? (r.code === 'no_failures' ? t('none recorded') : t('unavailable'))]),
    total: overall.available ? [t('All areas together'), overall.value] : undefined,
  };
  return {
    ...section('failure_rate', failureRateTakeaway({ top: top ? { areaId: top.area_id, value: top.value! } : null, overall }),
      env.noData ?? (!top ? t('No failure rate can be calculated for these areas.') : null), [
        t('Failures per 1,000 operating hours: failures divided by operating hours, times 1,000. The line is all areas together (total failures over total operating hours).'),
      ]),
    data: { rows, overall, table },
  };
}

// ---------------------------------------------------------------- causes

function topN(env: Env, id: 'top_equipment' | 'top_reasons' | 'pareto'): { top: number; measure: 'hours' | 'count' } {
  const o = effectiveOptions(id, env.opts[id]);
  return { top: typeof o.top === 'number' ? o.top : 10, measure: o.measure ?? 'hours' };
}

function causesTable(bars: ParetoBar[], head: string, measure: 'hours' | 'count', describe?: (b: ParetoBar) => string): ReportTable {
  return {
    columns: [col('#', 'count'), col(head), ...(describe ? [col(t('Description'))] : []), col(measure === 'hours' ? t('Failure h') : t('Failures'), measure === 'hours' ? 'hours' : 'count'), col(t('Share'), 'pct')],
    rows: bars.map((b, i) => [i + 1, b.label.trim() ? b.label : BLANK_CODE(), ...(describe ? [describe(b)] : []), b.value, b.sharePct]),
  };
}

function topEquipmentSection(env: Env): TopEquipmentSection {
  const { top, measure } = topN(env, 'top_equipment');
  const eq = equipmentModel(env.ctx);
  const own = eq ? (measure === 'hours' ? eq.hours.own : eq.count.own) : null;
  const bars = own ? own.bars.filter((b) => !b.isOthers).slice(0, top) : [];
  const desc = (b: ParetoBar): string => env.ctx.master.index.equipmentByKey.get(codeKey(b.key))?.description?.trim() || '';
  const fmt = measure === 'hours' ? fh : fint;
  return {
    ...section('top_equipment', causesTakeaway(own ? {
      what: measure === 'hours' ? t('failure hours on own equipment') : t('failures on own equipment'), unit: measure === 'hours' ? 'h' : t('failures'), total: own.total, entryCount: own.entryCount,
      top: own.bars.filter((b) => !b.isOthers).slice(0, 3).map((b) => ({ label: b.label, value: b.value, sharePct: b.sharePct })), fmt,
    } : null), env.noData ?? (bars.length === 0 ? t('No failures on own equipment in this period.') : null), [
      t('Own-stop rule: only equipment codes that belong to the stopped area are counted, so a cause is never counted twice. Shares are against the complete total of {n}, not the bars shown.', { n: own ? `${fmt(own.total)} ${measure === 'hours' ? 'h' : t('failures')}` : '-' }),
    ]),
    data: { measure, top, bars, total: own?.total ?? 0, entryCount: own?.entryCount ?? 0, table: causesTable(bars, t('Equipment'), measure, desc) },
  };
}

function topReasonsSection(env: Env): TopReasonsSection {
  const { top, measure } = topN(env, 'top_reasons');
  const rm = reasonModel(env.ctx, false);
  const all = rm ? (measure === 'hours' ? rm.hours : rm.count) : null;
  const bars = all ? all.bars.filter((b) => !b.isOthers).slice(0, top) : [];
  const fmt = measure === 'hours' ? fh : fint;
  return {
    ...section('top_reasons', causesTakeaway(all ? {
      what: measure === 'hours' ? t('failure hours') : t('failures'), unit: measure === 'hours' ? 'h' : t('failures'), total: all.total, entryCount: all.entryCount,
      top: all.bars.filter((b) => !b.isOthers).slice(0, 3).map((b) => ({ label: b.label, value: b.value, sharePct: b.sharePct })), fmt,
    } : null), env.noData ?? (bars.length === 0 ? t('No failure reasons in this period.') : null), [
      t('Failure events grouped by the reason written on the first row of the event; the same reason typed differently is merged. Shares are against the complete total.'),
    ]),
    data: { measure, top, bars, total: all?.total ?? 0, entryCount: all?.entryCount ?? 0, table: causesTable(bars, t('Reason'), measure) },
  };
}

function paretoSection(env: Env): ParetoSection {
  const { ctx } = env;
  const { top, measure } = topN(env, 'pareto');
  const cut = (all: ParetoResult | null): ParetoResult | null => (all ? cutPareto(all, top as TopN) : null);
  const area = cut(areaModel(ctx, measure));
  const line = cut(lineModel(ctx, measure));
  const cls = cut(classModel(ctx, measure, true));
  const parts: ParetoPart[] = [];
  const add = (key: ParetoPart['key'], title: string, head: string, r: ParetoResult | null) => {
    if (!r || r.bars.length === 0) return;
    parts.push({
      key, title, result: r,
      table: {
        columns: [col(head), col(measure === 'hours' ? t('Failure h') : t('Failures'), measure === 'hours' ? 'hours' : 'count'), col(t('Share'), 'pct'), col(t('Cumulative'), 'pct')],
        rows: r.bars.map((b) => [b.isOthers ? `${b.label} (${b.entryCount})` : b.label, b.value, b.sharePct, b.cumulativePct]),
      },
    });
  };
  const what = measure === 'hours' ? t('failure hours') : t('failures');
  add('area', measure === 'hours' ? t('Areas by failure hours') : t('Areas by failures'), t('Area'), area);
  add('line', measure === 'hours' ? t('Lines by failure hours') : t('Lines by failures'), t('Line'), line);
  add('class', measure === 'hours' ? t('Classifications by failure hours') : t('Classifications by failures'), t('Classification'), cls);
  const lead = (r: ParetoResult | null): { label: string; sharePct: number } | null => (r && r.bars[0] && !r.bars[0].isOthers ? { label: r.bars[0].label, sharePct: r.bars[0].sharePct } : null);
  return {
    ...section('pareto', paretoSectionTakeaway({ what, area: lead(area), line: lead(line), classification: lead(cls), areaTo80: area?.referenceIndex != null ? area.referenceIndex + 1 : null }),
      env.noData ?? (parts.length === 0 ? t('No failures in this period.') : null), [
        t('Bars descend from the largest; the line is the cumulative share and the dashed line marks 80%. "Others" merges the remaining items. Percentages are against the complete total, not the bars shown. Failure events only (planned and CIR stops are not causes).'),
      ]),
    data: { measure, top, parts },
  };
}

// ---------------------------------------------------------------- reliability

function repeatsSection(env: Env): RepeatsSection {
  const { ctx } = env;
  const o = effectiveOptions('repeats', env.opts.repeats);
  const top = typeof o.top === 'number' ? o.top : 10;
  const model: RepeatsModel | null = repeatsModel(ctx);
  const settings = ctx.master.settings;
  const groupsAll = model ? [...model.result.groups].sort((a, b) => b.occurrences - a.occurrences || b.totalHours - a.totalHours || (a.key < b.key ? -1 : 1)) : [];
  const groups = groupsAll.slice(0, top);
  const equipmentCount = new Set(groupsAll.map((g) => g.equipmentId)).size;
  const groupHours = groupsAll.reduce((s, g) => s + g.totalHours, 0);
  const topGroup = groupsAll[0] ?? null;
  const table: ReportTable = {
    columns: [col('#', 'count'), col(t('Equipment')), col(t('Area(s)')), col(t('Reason')), col(t('Timeline')), col(t('Times'), 'count'), col(t('Total h'), 'hours'), col(t('Avg h'), 'hours2'), col(t('Last failure')), col(t('Previous period'), 'count')],
    rows: groups.map((g, i) => [i + 1, g.equipmentId, g.areaIds.join(', '), g.reasonLabel, g.occurrenceDates.join(', '), g.occurrences, g.totalHours, g.avgHours, g.lastFailureDate, g.previousPeriodOccurrences]),
  };
  const facts = model ? {
    groups: groupsAll.length, recurrences: model.result.recurrences.length, equipmentCount,
    top: topGroup && { equipmentId: topGroup.equipmentId, occurrences: topGroup.occurrences, totalHours: topGroup.totalHours, reason: topGroup.reasonLabel },
    minEvents: settings.repeatMinEvents, windowDays: settings.repeatWindowDays,
  } : null;
  return {
    ...section('repeats', repeatsTakeaway(facts), env.noData ?? (groupsAll.length === 0 ? t('No repeated failures in this period (a group needs at least {n} events with the same code and reason within {d} days).', { n: settings.repeatMinEvents, d: settings.repeatWindowDays }) : null), [
      t('A repeated failure is {n} or more failure events of the same equipment and the same reason within {d} days. Blank and N/A reasons are not compared. "Times" counts the events in the period; the small timeline marks each one.', { n: settings.repeatMinEvents, d: settings.repeatWindowDays }),
      ...(groupsAll.length > groups.length ? [t('The {k} groups with the most occurrences are shown, of {n} in total.', { k: groups.length, n: groupsAll.length })] : []),
    ]),
    data: {
      groups, totalGroups: groupsAll.length, recurrences: model?.result.recurrences.length ?? 0, equipmentCount, groupHours, window: model?.window ?? null,
      minEvents: settings.repeatMinEvents, windowDays: settings.repeatWindowDays, table,
    },
  };
}

function longestSection(env: Env): LongestSection {
  const { ctx } = env;
  const o = effectiveOptions('longest', env.opts.longest);
  const n = typeof o.top === 'number' ? o.top : 10;
  const window = ctx.win.effective;
  const events = window ? longestEvents(ctx.scope.chains, n, { failureOnly: true, window }) : [];
  const table: ReportTable = {
    columns: [col('#', 'count'), col(t('Started')), col(t('Area')), col(t('Code')), col(t('Reason')), col(t('Hours'), 'hours2'), col(t('Rows'), 'count')],
    rows: events.map((e, i) => [i + 1, e.startTs.slice(0, 16), e.area_id, e.code || BLANK_CODE(), e.reason || t('(blank)'), e.hours, e.rowCount]),
  };
  const first = events[0];
  return {
    ...section('longest', longestTakeaway({
      events: events.length, totalHours: events.reduce((s, e) => s + e.hours, 0),
      top: first ? { code: first.code, areaId: first.area_id, date: first.startTs.slice(0, 10), hours: first.hours, reason: first.reason } : null,
    }), env.noData ?? (events.length === 0 ? t('No failure events in this period.') : null), [
      t('Ranked by the length of the whole event: a stop that carries on in the next row counts once, with all its rows.'),
    ]),
    data: { events, table },
  };
}

function quadrantSection(env: Env): QuadrantSection {
  const m = reliabilityOf(env);
  const q: QuadrantResult = m?.quadrant ?? { points: [], excluded: [], medianMtbf: null, medianMttr: null, worst: [] };
  const words = (x: string): string => {
    switch (x) {
      case 'worst': return t('Low MTBF, high MTTR (worst)');
      case 'frequent_quick': return t('Low MTBF, low MTTR');
      case 'rare_long': return t('High MTBF, high MTTR');
      case 'best': return t('High MTBF, low MTTR (best)');
      default: return t('On a median line');
    }
  };
  const table: ReportTable = {
    columns: [col(t('Area')), col(t('MTBF h'), 'hours'), col(t('MTTR h'), 'hours2'), col(t('Failure events'), 'count'), col(t('Quadrant'))],
    rows: q.points.map((p) => [p.area_id, p.mtbf, p.mttr, p.failureEvents, words(p.quadrant)]),
  };
  return {
    ...section('quadrant', quadrantTakeaway({ plotted: q.points.length, worst: q.worst, medianMtbf: q.medianMtbf, medianMttr: q.medianMttr }),
      env.noData ?? (q.points.length === 0 ? t('No area has both an MTBF and an MTTR in this period.') : null), [
        t('One point per area. The dashed lines are the medians of the areas shown; the area in the lower-right of the plot (low MTBF, high MTTR) is the worst. The axes start near the smallest value, not at zero.'),
        ...(q.excluded.length ? [t('Not plotted (no failures, so MTBF and MTTR are not defined): {a}.', { a: q.excluded.map((x) => x.area_id).join(', ') })] : []),
      ]),
    data: { result: q, table },
  };
}

function whenSection(env: Env): WhenSection {
  const o = effectiveOptions('when', env.opts.when);
  const measure = o.measure === 'hours' ? 'hours' : 'count';
  const heat = whenFailuresStart(env.ctx, measure);
  let facts: Parameters<typeof whenTakeaway>[0] = { measure, total: 0, peakHour: null, peakDay: null, peakSlot: null };
  if (heat && heat.total > 0) {
    let best = { r: 0, c: 0, v: -1 };
    heat.values.forEach((row, r) => row.forEach((v, c) => { if (v > best.v) best = { r, c, v }; }));
    const ph = heat.rows.reduce((b, r) => (r.total > b.total ? r : b), heat.rows[0]!);
    const pd = heat.cols.reduce((b, c) => (c.total > b.total ? c : b), heat.cols[0]!);
    facts = {
      measure, total: heat.total, peakHour: { label: ph.label, value: ph.total }, peakDay: { label: pd.label, value: pd.total },
      peakSlot: { day: heat.cols[best.c]!.label, hour: heat.rows[best.r]!.label, value: best.v },
    };
  }
  return {
    ...section('when', whenTakeaway(facts), env.noData ?? (!heat || heat.total <= 0 ? t('No failure events started in this period.') : null), [
      measure === 'count'
        ? t('Failure events by the plant-local hour and weekday their first row stopped; an event is counted once. Times are as recorded, with no time zone conversion.')
        : t('Hours of each failure event, placed at the plant-local hour and weekday it started. Times are as recorded, with no time zone conversion.'),
    ]),
    data: { measure, heat },
  };
}

// ---------------------------------------------------------------- detail

export const EVENTS_ROW_CAP = 2000;

function eventsSection(env: Env): EventsSection {
  const { ctx } = env;
  const o = effectiveOptions('events', env.opts.events);
  const rows = rowsInRange(ctx.scope, ctx.win.range);
  const hoursOf = (r: EventRow): number => rowSeconds(r) / 3600;
  const all = o.top === 'all';
  const sorted = all
    ? [...rows].sort((a, b) => (a.stop_ts < b.stop_ts ? -1 : a.stop_ts > b.stop_ts ? 1 : a.event_id < b.event_id ? -1 : 1))
    : [...rows].sort((a, b) => hoursOf(b) - hoursOf(a) || (a.stop_ts < b.stop_ts ? -1 : 1) || (a.event_id < b.event_id ? -1 : 1));
  const limit = all ? EVENTS_ROW_CAP : typeof o.top === 'number' ? o.top : 25;
  const shownRows = sorted.slice(0, limit);
  const totalHours = rows.reduce((s, r) => s + hoursOf(r), 0);
  const table: ReportTable = {
    columns: [col(t('Stopped')), col(t('Area')), col(t('Code')), col(t('Class')), col(t('Reason')), col(t('Hours'), 'hours2'), col(t('Failure'))],
    rows: shownRows.map((r) => [r.stop_ts.slice(0, 16), r.area_id, r.code_raw || BLANK_CODE(), r.classification, (r.reason_raw ?? '').trim() || t('(blank)'), hoursOf(r), r.is_failure ? t('Yes') : t('No')]),
  };
  const capped = all && rows.length > EVENTS_ROW_CAP;
  return {
    ...section('events', eventsTakeaway({ records: rows.length, shown: shownRows.length, all, shownHours: shownRows.reduce((s, r) => s + hoursOf(r), 0), totalHours }),
      env.noData ?? (rows.length === 0 ? t('No records match the filters in this period.') : null), [
        t('Records (rows of the downtime sheet) inside the period that pass every filter; voided records and records with a blocking data problem are not listed. Hours are the length of each record.'),
        ...(all ? [t('Listed in time order.')] : [t('Listed longest first.')]),
        ...(capped ? [t('Only the first {k} of {n} records are listed.', { k: fint(EVENTS_ROW_CAP), n: fint(rows.length) })] : []),
      ]),
    data: { records: rows.length, shown: shownRows.length, all, capped, table },
  };
}

function qualitySection(env: Env): QualitySection {
  const { ctx, input } = env;
  const range = ctx.win.range;
  const noLineArea = ctx.base.areaIds.length === 0 || (input.setup.filters.lineIds.length === 0 && input.setup.filters.areaIds.length === 0);
  const areaSet = new Set(ctx.base.areaIds);
  const scoped = input.rows.filter((r) => noLineArea || areaSet.has(r.area_id));
  const inPeriod = (r: Pick<EventRow, 'stop_ts'>): boolean => {
    const d = r.stop_ts.slice(0, 10);
    return d >= range.from && d <= range.to;
  };
  const list: ValidationList = buildValidation(scoped);
  const records = list.records.filter((r) => inPeriod(r.event));
  const keptRecords = list.keptRecords.filter((k) => inPeriod(k.event));
  const periodRows = scoped.filter(inPeriod);
  const sc = buildScorecard(periodRows, { ...list, records, keptRecords });
  const live = periodRows.filter((r) => !r.is_void);
  const voided = periodRows.length - live.length;
  const leftOutRows = live.filter(isBlocked);
  const leftOut = { count: leftOutRows.length, hours: leftOutRows.reduce((s, r) => s + rowSeconds(r) / 3600, 0) };
  const byFlag: Record<string, number> = {};
  for (const r of records) for (const f of r.problems) byFlag[f] = (byFlag[f] ?? 0) + 1;
  const flags = Object.entries(byFlag).map(([flag, count]) => ({ flag, label: flagLabel(flag), count })).sort((a, b) => b.count - a.count || (a.flag < b.flag ? -1 : 1));
  const months = [...sc.months].sort((a, b) => a.month.localeCompare(b.month));
  const table: ReportTable = {
    columns: [col(t('Month')), col(t('Records'), 'count'), col(t('To check'), 'count'), col(t('Left out'), 'count'), col(t('Left out h'), 'hours'), col(t('Kept as entered'), 'count'), col(t('Clean'), 'pct')],
    rows: months.map((q) => [monthLabel(q.month), q.records, q.openProblems, q.leftOut.count, q.leftOut.hours, q.keptAsEntered, q.cleanPct]),
    total: months.length > 1 ? [t('All months'), sc.total.records, sc.total.openProblems, sc.total.leftOut.count, sc.total.leftOut.hours, sc.total.keptAsEntered, sc.total.cleanPct] : undefined,
  };
  const counted = rowsInRange(ctx.scope, range).length;
  const leftOutKept = keptRecords.filter((k) => k.leftOut).length;
  return {
    ...section('quality', qualityTakeaway({ records: live.length, leftOut, kept: keptRecords.length, open: records.length, voided }), null, [
      t('Records checked are all stored records that stopped inside the period in the chosen lines and areas, before the other filters. Records with a blocking problem (no classification, an unknown area, a restart before the stop ...) are left out of every number until they are fixed. Problems kept as entered are accepted by a person: they count as normal, unless the problem is blocking, in which case the record stays out of the numbers.'),
      t('{n} records pass every filter and are the ones the numbers of this report are calculated from.', { n: fint(counted) }),
    ]),
    data: { records: live.length, voided, leftOut, kept: { count: keptRecords.length, leftOut: leftOutKept }, open: records.length, cleanPct: sc.total.cleanPct, byFlag: flags, months, table, counted },
  };
}

function methodologySection(env: Env): MethodologySection {
  const { ctx } = env;
  const s = ctx.master.settings;
  const targets = env.ov.targets;
  const basis = s.availabilityBasis;
  const info = (id: 'total-hours' | 'failure-count' | 'availability' | 'mttr') => kpiInfo(id, basis, targets);
  const items: MethodologySection['data']['items'] = [
    { term: t('Area-hours'), paragraphs: info('total-hours').paragraphs },
    { term: t('Availability (basis {b})', { b: basis }), paragraphs: info('availability').paragraphs },
    { term: t('Failures and failure events'), paragraphs: info('failure-count').paragraphs },
    { term: t('Mean restoration time (MTTR)'), paragraphs: info('mttr').paragraphs },
    {
      term: t('MTBF and failure rate'),
      paragraphs: [
        t('MTBF is the operating hours divided by the failure events (a failure event starts with a row that has Freq 1 and Failure YES and is not PL or CIR); the failure rate is failure events per 1,000 operating hours. Per area they use the area\'s hours; MTBF · all areas (area-hours) uses the summed operating area-hours of all areas and all failure events. When there are no failures they are not defined, and the report says so instead of showing a zero.'),
        t('Stops of one area that overlap in time are counted once: the shared time goes to planned (PL) first, then incidental, then CIR; between stops of the same kind, to the one that started first. Exact duplicate records count once.'),
        t('Months inside the data with no record at all are shown as Not uploaded and left out of the scheduled time, never as 0 h or 100%. When less than 90% of the comparison period has data, totals are compared per day and not called better or worse.'),
      ],
    },
    {
      term: t('Scheduled time'),
      paragraphs: [t('Scheduled time is {h} hours a day on {d} days a week for every area in scope, counted over the days of the period that the data covers.', { h: s.scheduledHoursPerDay, d: s.scheduledDaysPerWeek })],
    },
    {
      term: t('Repeated failures'),
      paragraphs: [t('Failure events of the same equipment and the same reason, at least {n} of them within {d} days, are a repeated failure. Blank and N/A reasons are not compared.', { n: s.repeatMinEvents, d: s.repeatWindowDays })],
    },
    {
      term: t('Own-stop rule'),
      paragraphs: [t('The equipment rankings count a failure against the equipment code only when the code belongs to the stopped area. Causes in another area, area-level stops, unknown codes and codes in no area are not counted twice.')],
    },
    {
      term: t('Records left out'),
      paragraphs: [t('Voided records and records with a blocking data problem are left out of every number. The data-quality appendix says how many.')],
    },
    {
      term: t('Targets'),
      paragraphs: [
        targets.availabilityPct === null && targets.mtbfH === null && targets.mttrH === null
          ? t('No targets are set in Settings, so no figure is marked on or off target.')
          : [
            targets.availabilityPct !== null ? t('availability {x}% (at least)', { x: targetNumber(targets.availabilityPct) }) : '',
            targets.mtbfH !== null ? t('MTBF {x} h (at least)', { x: targetNumber(targets.mtbfH) }) : '',
            targets.mttrH !== null ? t('MTTR {x} h (at most)', { x: targetNumber(targets.mttrH) }) : '',
          ].filter(Boolean).join('; ') + '. ' + t('A figure is judged as it is printed.'),
      ],
    },
    {
      term: t('Comparison'),
      paragraphs: [t('The comparison period is the same number of whole months just before the period (or, for a period that is not whole months, the same number of days just before it); year to date is compared with the same dates last year. Changes are green when better and red when worse, always with an arrow and words.')],
    },
  ];
  return { ...section('methodology', t('How each figure in this report is calculated.'), null), data: { items } };
}

