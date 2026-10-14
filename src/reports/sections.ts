// The Reports page's catalogue: every section a report can hold (grouped, with its one-line description and its
// per-section options) and the three ready-made templates. Pure data: the builder, the URL, the saved templates and
// the report itself all read this one list, so they cannot drift apart. The ids are the wire ids of `saved_reports`
// (src/api/types.ts REPORT_SECTION_IDS, backend Notifications.js REPORT_SECTION_IDS_); a unit test compares the lists.
import { REPORT_SECTION_IDS, type ReportPreset, type ReportSectionId, type ReportSectionOptions, type ReportTemplateId } from '../api/types';

export type SectionGroupId = 'summary' | 'performance' | 'causes' | 'reliability' | 'detail';

export const SECTION_GROUPS: { id: SectionGroupId; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'performance', label: 'Performance' },
  { id: 'causes', label: 'Causes' },
  { id: 'reliability', label: 'Reliability' },
  { id: 'detail', label: 'Detail' },
];

/** Values a section's Top N can take (`'all'` only where listed). */
export type TopChoice = number | 'all';

export interface SectionDef {
  id: ReportSectionId;
  group: SectionGroupId;
  /** name in the checklist, the table of contents and the section heading */
  label: string;
  /** one line under the name in the checklist */
  description: string;
  /** Top N choices (first is the default unless `defaults.top` says otherwise); absent = the section has no Top N */
  top?: TopChoice[];
  /** the section can count in hours or in events */
  measure?: boolean;
  defaults: ReportSectionOptions;
}

const TOP_RANK: TopChoice[] = [5, 10, 20];

export const SECTION_DEFS: SectionDef[] = [
  { id: 'cover', group: 'summary', label: 'Cover page', description: 'Title, plant, period, filters and when the report was made.', defaults: {} },
  { id: 'summary', group: 'summary', label: 'Executive summary', description: 'Headline figures with target status, change against the previous period and the main findings in words.', defaults: {} },
  { id: 'daily', group: 'performance', label: 'Daily stopped hours', description: 'Failure, planned and CIR hours for every day, with a 7-day average.', defaults: {} },
  { id: 'monthly', group: 'performance', label: 'Monthly stoppage by type', description: 'Failure, planned and CIR hours for every month of the period.', defaults: {} },
  { id: 'classes', group: 'performance', label: 'Downtime by classification', description: 'Stopped hours per month and classification (PRO, MEC, ELE, AUT, PL, CIR).', defaults: {} },
  { id: 'area_downtime', group: 'performance', label: 'Downtime by area', description: 'Stopped hours of each area, split into failure, planned and CIR.', defaults: {} },
  { id: 'availability', group: 'performance', label: 'Availability by area', description: 'Availability of each area and of all areas together, against the target if one is set.', defaults: {} },
  { id: 'mtbf_mttr', group: 'performance', label: 'MTBF and MTTR by area', description: 'Mean time between failures and mean restoration time for every area.', defaults: {} },
  { id: 'failure_rate', group: 'performance', label: 'Failure rate by area', description: 'Failures per 1,000 operating hours for every area.', defaults: {} },
  { id: 'top_equipment', group: 'causes', label: 'Top equipment by failure hours', description: 'The equipment codes that cost the most failure hours (or failures).', top: TOP_RANK, measure: true, defaults: { top: 10, measure: 'hours' } },
  { id: 'top_reasons', group: 'causes', label: 'Top reasons', description: 'The reasons behind the most failure hours (or failures).', top: TOP_RANK, measure: true, defaults: { top: 10, measure: 'hours' } },
  { id: 'pareto', group: 'causes', label: 'Pareto by area, line and classification', description: 'Where the failure hours (or failures) concentrate: three Pareto charts with the 80% line.', top: TOP_RANK, measure: true, defaults: { top: 10, measure: 'hours' } },
  { id: 'repeats', group: 'reliability', label: 'Repeated failures', description: 'Equipment that failed again for the same reason, with a small timeline of each.', top: TOP_RANK, defaults: { top: 10 } },
  { id: 'longest', group: 'reliability', label: 'Longest events', description: 'The failure events with the longest stops.', top: TOP_RANK, defaults: { top: 10 } },
  { id: 'quadrant', group: 'reliability', label: 'MTBF vs MTTR quadrant', description: 'Each area placed by how often it fails and how long it takes to recover.', defaults: {} },
  { id: 'when', group: 'reliability', label: 'When failures start', description: 'Failure starts by hour of day and weekday.', measure: true, defaults: { measure: 'count' } },
  { id: 'events', group: 'detail', label: 'Events table', description: 'The records behind the numbers: the longest ones, or all of them.', top: [10, 25, 50, 100, 'all'], defaults: { top: 25 } },
  { id: 'quality', group: 'detail', label: 'Data-quality appendix', description: 'How many records were checked, kept as entered and left out of the numbers.', defaults: {} },
  { id: 'methodology', group: 'detail', label: 'Methodology and definitions', description: 'How each figure in this report is calculated.', defaults: {} },
];

export const SECTION_BY_ID: Record<ReportSectionId, SectionDef> = Object.fromEntries(SECTION_DEFS.map((s) => [s.id, s])) as Record<ReportSectionId, SectionDef>;

/** Catalogue order: the order sections appear in a report, whatever order they were ticked in. */
export const SECTION_ORDER: ReportSectionId[] = SECTION_DEFS.map((s) => s.id);

export function sortSections(ids: Iterable<ReportSectionId>): ReportSectionId[] {
  const set = new Set(ids);
  return SECTION_ORDER.filter((id) => set.has(id));
}

export const isSectionId = (s: string): s is ReportSectionId => (REPORT_SECTION_IDS as readonly string[]).includes(s);

export interface TemplateDef {
  id: ReportTemplateId;
  label: string;
  blurb: string;
  sections: ReportSectionId[];
  preset: ReportPreset;
  compare: boolean;
}

const ALL: ReportSectionId[] = [...SECTION_ORDER];

export const TEMPLATE_DEFS: TemplateDef[] = [
  {
    id: 'monthly', label: 'Monthly management report', blurb: 'Everything: figures, causes, reliability and the data behind them.',
    sections: ALL, preset: 'lastmonth', compare: true,
  },
  {
    id: 'area', label: 'Area reliability review', blurb: 'How each area performs: availability, MTBF, MTTR, failure rate and repeats.',
    sections: ['cover', 'summary', 'monthly', 'availability', 'mtbf_mttr', 'failure_rate', 'quadrant', 'repeats', 'when', 'quality', 'methodology'],
    preset: 'last3', compare: true,
  },
  {
    id: 'failure', label: 'Failure analysis', blurb: 'What failed and why: top equipment and reasons, Pareto, repeats and the longest stops.',
    sections: ['cover', 'summary', 'top_equipment', 'top_reasons', 'pareto', 'repeats', 'longest', 'when', 'events', 'quality', 'methodology'],
    preset: 'lastmonth', compare: true,
  },
  {
    id: 'custom', label: 'Custom', blurb: 'Pick the sections yourself.',
    sections: ['cover', 'summary'], preset: 'lastmonth', compare: true,
  },
];

export const TEMPLATE_BY_ID: Record<ReportTemplateId, TemplateDef> = Object.fromEntries(TEMPLATE_DEFS.map((t) => [t.id, t])) as Record<ReportTemplateId, TemplateDef>;

export const PERIOD_PRESETS: { id: ReportPreset; label: string }[] = [
  { id: 'lastmonth', label: 'Last full month' },
  { id: 'thismonth', label: 'This month so far' },
  { id: 'last3', label: 'Last 3 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'custom', label: 'Custom range' },
];

/** The options of a section as they apply: what is chosen, else the section's default, limited to the choices it offers. */
export function effectiveOptions(id: ReportSectionId, chosen: ReportSectionOptions | undefined): ReportSectionOptions {
  const def = SECTION_BY_ID[id];
  const out: ReportSectionOptions = {};
  if (def.top) {
    const want = chosen?.top ?? def.defaults.top;
    out.top = want !== undefined && def.top.includes(want) ? want : (def.defaults.top ?? def.top[0]);
  }
  if (def.measure) out.measure = chosen?.measure === 'hours' || chosen?.measure === 'count' ? chosen.measure : (def.defaults.measure ?? 'hours');
  return out;
}
