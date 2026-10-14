// The (i) texts of every chart and table card, in one place so they are easy to read and edit. Each entry says what
// the card shows, the formula(s), the rules that matter for the numbers and, where the card can give its numbers, a
// live example ('Here: …'). Source of truth for the rules: src/calc/README.md (P1 overlaps once, P2 failure events,
// own-stop rule, P6 months not uploaded, P7 per-day comparison).
//
// Placeholders in curly brackets are filled from the numbers the card passes ({b} = availability basis, {af} = the
// availability formula of that basis). An example whose numbers are not all known is left out.
import { t } from '../i18n/t';
import type { InfoSection, KpiInfo } from '../dashboard/kpiInfo';

export interface ChartHelpEntry {
  title: string;
  /** what the card shows, one or two sentences */
  what: string;
  /** plain-text formulas */
  formulas: string[];
  /** the rules that decide the numbers */
  how: string[];
  /** 'Here: …' with the numbers on the card ({placeholders}) */
  example?: string;
}

/** Availability formula per basis (the one chosen in Settings). */
export const AVAILABILITY_FORMULA: Record<'A' | 'B' | 'C', string> = {
  A: 'Availability A = (T − PL − INC − CIR) ÷ T',
  B: 'Availability B = (T − PL − INC − CIR) ÷ (T − PL)',
  C: 'Availability C = (T − PL − CIR − INC) ÷ (T − PL − CIR)',
};

const T_DEF = 'T = scheduled time = 24 h × days in the period × areas, months not uploaded left out';
const OPERATING = 'Operating hours = T − stopped hours (PL + INC + CIR)';
const MTBF_F = 'MTBF = operating hours ÷ failure events';
const MTTR_F = 'MTTR = sum of the failure events’ full durations ÷ number of failure events';
const RATE_F = 'Failures per 1,000 h = failure events ÷ operating hours × 1,000';
const SHARE_F = 'Share = item ÷ complete total × 100; cumulative % = running sum ÷ complete total × 100';

const P1 = 'Overlapping stops in one area are counted once: the shared time goes to planned (PL) first, then incidental, then other (CIR); between stops of the same kind, to the one that started first. An exact duplicate record counts once (P1).';
const P2 = 'A failure is an event whose first row has Freq 1 and Failure YES and is not PL or CIR; the rows that carry it on are the same failure and are not counted again (P2).';
const OWN = 'Own-stop rule: an equipment code counts here only when it belongs to the area that stopped. Codes of other areas, N/A (whole area) and codes not in the master go to separate buckets, so a cause is never counted twice.';
const CLIP = 'Hours are clipped to the selected period: a stop that crosses the start or end counts only its hours inside it.';
const STARTED = 'Events (counts) are counted in the period or month in which they started.';
const AREA_H = 'Hours are area-hours: two areas stopped at the same time count twice.';
const P6 = 'Months with no record at all are “Not uploaded”: they are left out, never shown as 0 h or 100 %.';
const BLOCKED = 'Voided records and records with a blocking data problem (see Validate) are left out.';
const HEAD = 'The cause of an event (code, reason, classification) is its first row.';
const RATIO = 'Ratios are worked out from summed hours and counts, never as an average of area percentages.';

export const CHART_HELP = {
  // ------------------------------------------------------------ Dashboard cards
  'trend': {
    title: 'Stoppage by month or day',
    what: 'Stopped hours per month (or per day), split by type (incidental, planned, other) or by classification.',
    formulas: ['Stopped hours = PL + INC + CIR (each hour owned by one stop)'],
    how: [P1, CLIP, AREA_H, 'A month still in progress is marked partial; ' + P6, BLOCKED],
    example: 'Here: {slot} has {h} h stopped.',
  },
  'class': {
    title: 'Stoppage by classification',
    what: 'How the stopped hours of the period split over the classifications PRO, MEC, ELE, AUT, PL and CIR.',
    formulas: ['Share = hours of the classification ÷ all stopped hours × 100'],
    how: ['Each row counts under its own classification.', P1, CLIP, AREA_H, BLOCKED],
    example: 'Here: {c} {h} h ÷ {t} h = {p}.',
  },
  'losses': {
    title: 'Biggest losses (Pareto)',
    what: 'The top 10 equipment codes, reasons, areas or lines by failure hours or by failure count, with the cumulative share.',
    formulas: [SHARE_F],
    how: [P2, HEAD, OWN + ' (Equipment view)', 'Hours: all rows of the failure, clipped to the period, overlaps owned once (P1). Count: failures that started in the period.', 'Shares are against the complete total, not the top 10.'],
    example: 'Here: {top} {v} ÷ {t} = {p}.',
  },
  'planned': {
    title: 'Planned or incidental, by line',
    what: 'Stopped hours of each production line split into incidental, planned (PL) and other (CIR), as a share of the line total.',
    formulas: ['Share = hours of the type ÷ stopped hours of the line × 100'],
    how: ['Whole lines: the Area and Equipment filters do not apply to this card, so L.1 always means every area of line 1 (period, line and type filters still apply).', 'The line of a stop is the line of its area in the master data.', 'Incidental = every stop that is not PL or CIR (failures and their continuations).', P1, CLIP, AREA_H],
    example: 'Here, all lines: incidental {i} h, planned {p} h, other {o} h = {t} h.',
  },
  'area-down': {
    title: 'Downtime by area',
    what: 'Stopped hours of every area by type, most first. This is all stoppage (total hours), not only failures.',
    formulas: ['Stopped hours of an area = incidental + PL + CIR of that area'],
    how: [P1, CLIP, BLOCKED],
    example: 'Here: {a} {h} h (incidental {i}, planned {p}, other {o}).',
  },
  'area-target': {
    title: 'Availability by area against the target',
    what: 'Availability of every area on the basis chosen in Settings, worst first, with the target line.',
    formulas: ['{af}', T_DEF],
    how: [P1, RATIO, 'An area’s own target (Settings › Actions & targets) wins over the plant-wide target.', P6],
    example: 'Here: {a} {v} against the target {x}.',
  },
  'planned-allowance': {
    title: 'Planned hours against the allowance',
    what: 'Planned stop hours (PL) used this year per area, against the allowance of the same months.',
    formulas: ['Used = PL hours from January to the end of the period', 'Allowance = sum of the monthly allowances of those months'],
    how: ['Allowances are set per area and month in Settings › Actions & targets.', P1, AREA_H],
  },
  'fail-mttr': {
    title: 'Failures and repair time by month',
    what: 'The number of failures per month (bars) and the mean restoration time (MTTR, line) on one month axis.',
    formulas: [MTTR_F],
    how: [P2, STARTED, 'A failure that continues over several rows is one failure with its full length.', P6],
    example: 'Here: {m}: {h} h of failure ÷ {n} failures = {mttr} h.',
  },
  'attention': {
    title: 'MTBF against MTTR by area',
    what: 'One point per area: how often it fails (MTBF, across) against how long a repair takes (MTTR, up). The dashed lines are the medians of the areas.',
    formulas: [MTBF_F, MTTR_F, OPERATING],
    how: [P2, 'Areas with no failure have no MTBF or MTTR and are not plotted.', 'Low MTBF and high MTTR (top left) = fails often and is slow to fix.'],
    example: 'Here: median MTBF {mb} h, median MTTR {mr} h.',
  },
  'repeats': {
    title: 'Repeated failures',
    what: 'The failures that keep coming back: the same equipment code and reason at least {n} times within {d} days.',
    formulas: ['Share = hours of the repeat events ÷ all failure hours × 100'],
    how: [P2, 'Grouped by equipment code and reason (N/A and blank reasons are left out).', 'The same code and reason stopping several areas within 10 minutes counts once; one less than 1 h after the previous one restarted is a burst and still counts (P5).', 'Hours are the events’ own lengths.'],
    example: 'Here: {h} h ÷ {t} h = {p}.',
  },
  'heat': {
    title: 'Availability heat map, area × month',
    what: 'The availability of each area in each month. With a target: green at or above it, amber up to 5 points below, red further below.',
    formulas: ['{af}', T_DEF],
    how: [P1, RATIO, P6, 'A month in progress is partial.'],
  },
  'daily': {
    title: 'Daily stopped hours',
    what: 'Stopped hours per day by type, with the 7-day average of all types.',
    formulas: ['7-day average = stopped hours of the day and the 6 days before ÷ 7'],
    how: ['A stop that crosses midnight is split between the days.', P1, AREA_H, P6],
    example: 'Here: worst day {d} with {h} h.',
  },
  // ------------------------------------------------------------ Dashboard sections
  'dash-areas': {
    title: 'Areas',
    what: 'Every area with its stopped hours, failures, availability against the target, MTBF and MTTR; the top 5 by stopped hours first.',
    formulas: ['{af}', MTBF_F, MTTR_F],
    how: [P1, P2, 'MTBF and MTTR are per area; the all-area figures are on the KPI row.'],
  },
  'mvm-hours': {
    title: 'Month vs month: stoppage hours by area',
    what: 'Stopped hours of each area in month A (solid) and month B (striped).',
    formulas: ['Stopped hours = PL + INC + CIR'],
    how: [P1, 'The date range and the comparison of the scope bar do not apply; the other filters do.', 'When a month has only part of its days with data, hours are shown per day with data (P7) and no change is called better or worse.'],
  },
  'mvm-count': {
    title: 'Month vs month: failure count by area',
    what: 'Failure events of each area in month A (solid) and month B (striped).',
    formulas: ['Failure count = failure events that started in the month'],
    how: [P2, STARTED, 'When a month has only part of its days with data, counts are per day with data (P7).'],
  },
  // ------------------------------------------------------------ Pareto
  'pareto-eq-hours': {
    title: 'Equipment by failure hours',
    what: 'Equipment codes ranked by the hours of the failures they caused, with the cumulative share and the 80 % line.',
    formulas: [SHARE_F],
    how: [P2, HEAD, OWN, 'Hours: all rows of the failure, clipped to the period, overlaps owned once (P1).'],
    example: 'Here: {top} {v} ÷ {t} = {p}.',
  },
  'pareto-eq-count': {
    title: 'Equipment by failure frequency',
    what: 'Equipment codes ranked by the number of failures that started in the period.',
    formulas: [SHARE_F],
    how: [P2, HEAD, OWN, STARTED],
    example: 'Here: {top} {v} ÷ {t} = {p}.',
  },
  'pareto-reason-equipment': {
    title: 'Reasons for one equipment code',
    what: 'Why one equipment code fails: its failures ranked by reason, in hours or count.',
    formulas: [SHARE_F],
    how: [P2, 'Reasons are matched on their text (case and spaces ignored); Split keeps the same text under different classifications apart.', OWN],
    example: 'Here: {top} {v} ÷ {t} = {p}.',
  },
  'bucket-other': {
    title: 'Stopped by other areas',
    what: 'Failures whose equipment code belongs only to another area than the one that stopped.',
    formulas: ['Hours = failure hours of these events in the period'],
    how: [OWN, P1],
  },
  'bucket-area': {
    title: 'Area-level stops (N/A)',
    what: 'Stops with the code N/A: the whole area stopped and no equipment is named. Every classification is counted, not only failures.',
    formulas: ['Hours = time owned by the N/A stops in the period'],
    how: ['The plant writes whole-area stops as CIR with Failure NO, so most of them are not failures.', P1, CLIP],
  },
  'bucket-unknown': {
    title: 'Unknown code',
    what: 'Failures whose equipment code is not in the equipment master.',
    formulas: ['Hours = failure hours of these events in the period'],
    how: [OWN, 'Add the code in Settings › Master data, or correct it in the record, to move it into the Pareto.'],
  },
  'bucket-unassigned': {
    title: 'Code in no area',
    what: 'Failures whose equipment code exists in the master but is not assigned to any area.',
    formulas: ['Hours = failure hours of these events in the period'],
    how: [OWN],
  },
  'pareto-reason-hours': {
    title: 'Reasons by failure hours',
    what: 'Failure reasons ranked by the hours of the failures, with the cumulative share.',
    formulas: [SHARE_F],
    how: [P2, HEAD, 'Reasons are matched on their text (case and spaces ignored).', 'Hours: all rows of the failure, clipped to the period, overlaps owned once (P1).'],
    example: 'Here: {top} {v} ÷ {t} = {p}.',
  },
  'pareto-reason-count': {
    title: 'Reasons by failure frequency',
    what: 'Failure reasons ranked by the number of failures that started in the period.',
    formulas: [SHARE_F],
    how: [P2, HEAD, STARTED],
    example: 'Here: {top} {v} ÷ {t} = {p}.',
  },
  'reason-month': {
    title: 'Reasons by month',
    what: 'The largest 12 failure reasons against the months of the period, in hours or count.',
    formulas: ['Cell = failure hours (or failures started) of the reason in the month'],
    how: [P2, 'Hours of a failure that crosses a month end are split between the two months.', STARTED, P6],
  },
  'pareto-line-hours': {
    title: 'Lines by failure hours',
    what: 'Production lines ranked by the failure hours of their areas.',
    formulas: [SHARE_F],
    how: [P2, 'The line is the line of the stopped area in the master data.', P1, AREA_H],
    example: 'Here: {top} {v} ÷ {t} = {p}.',
  },
  'pareto-line-count': {
    title: 'Lines by failure frequency',
    what: 'Production lines ranked by the number of failures of their areas.',
    formulas: [SHARE_F],
    how: [P2, STARTED],
    example: 'Here: {top} {v} ÷ {t} = {p}.',
  },
  'pareto-area-hours': {
    title: 'Areas by failure hours',
    what: 'Areas ranked by the hours of the failures that stopped them.',
    formulas: [SHARE_F],
    how: [P2, 'Hours: all rows of the failure, clipped to the period, overlaps owned once (P1).', AREA_H],
    example: 'Here: {top} {v} ÷ {t} = {p}.',
  },
  'pareto-area-count': {
    title: 'Areas by failure frequency',
    what: 'Areas ranked by the number of failures that started in the period.',
    formulas: [SHARE_F],
    how: [P2, STARTED],
    example: 'Here: {top} {v} ÷ {t} = {p}.',
  },
  'pareto-class-hours': {
    title: 'Classifications by hours',
    what: 'Hours by the classification of the event (all events, or failures only).',
    formulas: [SHARE_F],
    how: [HEAD, P1, CLIP, AREA_H],
    example: 'Here: {top} {v} ÷ {t} = {p}.',
  },
  'pareto-class-count': {
    title: 'Classifications by frequency',
    what: 'Events by the classification of the event (all events, or failures only).',
    formulas: [SHARE_F],
    how: [HEAD, STARTED],
    example: 'Here: {top} {v} ÷ {t} = {p}.',
  },
  // ------------------------------------------------------------ Repeated failures
  'repeat-table': {
    title: 'Investigation table',
    what: 'Every repeated failure group: the same equipment code and reason at least {n} times within {d} days, with its occurrences, hours and the days between them.',
    formulas: ['Avg h = total hours ÷ occurrences', 'Recurrences = occurrences after the first of each cluster'],
    how: [P2, 'N/A and blank reasons are left out.', 'The same code and reason stopping several areas within 10 minutes counts once; one less than 1 h after the previous one restarted in the same area is a burst and still counts (P5).', 'Events before the period are used to find a cluster; only groups with at least 2 occurrences in the period are listed.'],
    example: 'Here: {c} {r}: {h} h ÷ {o} occurrences = {a} h.',
  },
  'repeat-timeline': {
    title: 'Failure timeline',
    what: 'Each failure of the selected equipment code across the period; taller marks are longer stops.',
    formulas: ['Days between = start of a failure − start of the one before'],
    how: [P2, OWN],
  },
  'repeat-heat-month': {
    title: 'Equipment by month',
    what: 'The 15 equipment codes with most failures against the months of the period.',
    formulas: ['Cell = failure hours (or failures started) of the code in the month'],
    how: [P2, 'N/A (area-level) is left out.', 'Hours of a failure that crosses a month end are split between the months.', P6],
  },
  'repeat-heat-reason': {
    title: 'Equipment by reason',
    what: 'The top equipment codes against their top reasons.',
    formulas: ['Cell = failure hours (or failures) of the code with the reason'],
    how: [P2, 'N/A (area-level) is left out.', CLIP],
  },
  'repeat-scatter': {
    title: 'Frequency against average duration',
    what: 'One point per equipment code: how often it failed against how long a failure lasted on average. Bigger points = more hours.',
    formulas: ['Average hours = failure hours of the code ÷ its failures'],
    how: [P2, OWN, STARTED],
  },
  // ------------------------------------------------------------ Reliability
  'when-heat': {
    title: 'Failure starts by hour and weekday',
    what: 'When failures start: one cell per hour of the day and weekday, over the whole period.',
    formulas: ['Cell = failures (or their hours) that started in that hour and weekday'],
    how: [P2, 'Times are plant-local as recorded.', 'Hours are the whole length of each failure, placed at its start.'],
  },
  'histogram': {
    title: 'Failure duration distribution',
    what: 'Failures grouped by their full length, marked short, medium and long.',
    formulas: ['Duration = restart of the last row − stop of the first row of the failure'],
    how: [P2, 'Short and long limits are set in Settings › Calculations.', STARTED],
    example: 'Here: {n} failures: {s} short, {m} medium, {l} long.',
  },
  'mtbf-month': {
    title: 'Monthly MTBF',
    what: 'Mean time between failures for each month, for all areas (area-hours) or for one area.',
    formulas: [MTBF_F, OPERATING, T_DEF],
    how: [P2, P1, 'A month with no failure has no MTBF (a gap, never infinite).', P6],
    example: 'Here: {m}: {o} h ÷ {n} failures = {v} h.',
  },
  'mttr-month': {
    title: 'Mean restoration time by month',
    what: 'The average length of the failures that started in each month.',
    formulas: [MTTR_F],
    how: [P2, STARTED, 'A failure that continues over several rows is one failure with its full length.', P6],
    example: 'Here: {m}: {h} h ÷ {n} failures = {v} h.',
  },
  'rate-month': {
    title: 'Failures per 1,000 operating hours',
    what: 'The failure rate of each month, adjusted for the time the areas were running.',
    formulas: [RATE_F, OPERATING],
    how: [P2, P1, P6],
    example: 'Here: {m}: {n} failures ÷ {o} h × 1,000 = {v}.',
  },
  'yoy': {
    title: 'Year over year, by month',
    what: 'Each month of this year beside the same month a year earlier.',
    formulas: [MTBF_F, RATE_F],
    how: [P2, P1, 'When last year’s month is covered for less than 90 % its totals are compared per day (P7).', P6],
  },
  'longest': {
    title: 'Longest events',
    what: 'The ten longest failures of the period.',
    formulas: ['Hours = restart of the last row − stop of the first row of the failure'],
    how: [P2, 'A stop that continues over several rows counts once, with all its rows.', 'An event is listed when it started in the period.'],
    example: 'Here: the longest is {h} h.',
  },
  'area-trend': {
    title: 'Availability trend per area',
    what: 'Monthly availability of up to 8 areas (the lowest by default).',
    formulas: ['{af}', T_DEF],
    how: [P1, RATIO, P6, 'A month without data is a gap.'],
  },
  'area-table': {
    title: 'By area',
    what: 'For every area: running and stopped hours, failure hours and failures, availability, MTBF and MTTR, with the target status.',
    formulas: [T_DEF, OPERATING, '{af}', MTBF_F, MTTR_F, 'Failure h = hours of the area’s failure events (all their rows, clipped to the period)'],
    how: [P1, P2, 'Stopped h counts each row under its own classification; Failure h and Failures count under the classification of the failure’s first row.', 'Point at, tap or press Enter on Stopped h, Failure h or Failures for the split by classification; the parts add up to the cell.', 'MTBF is per area; the all-area figure is MTBF · all areas (area-hours), never an average of the areas.'],
    example: 'Here, {a}: {T} h − {s} h = {o} h running; {o} h ÷ {n} failures = {mtbf} h MTBF.',
  },
  'area-mtbf': {
    title: 'MTBF by area',
    what: 'Mean time between failures of each area, lowest first.',
    formulas: [MTBF_F, OPERATING],
    how: [P2, P1, 'Areas without a failure are listed last (no MTBF).'],
    example: 'Here: {a} has the lowest MTBF, {v} h.',
  },
  'area-mttr': {
    title: 'MTTR by area',
    what: 'Mean restoration time of each area’s failures, highest first.',
    formulas: [MTTR_F],
    how: [P2, STARTED, 'Areas without a failure are listed last.'],
    example: 'Here: {a} has the highest MTTR, {v} h.',
  },
  'area-quadrant': {
    title: 'MTBF against MTTR by area',
    what: 'One point per area; the dashed medians split the plot into four quadrants.',
    formulas: [MTBF_F, MTTR_F],
    how: [P2, 'Areas without a failure are not plotted.', 'Low MTBF and high MTTR = the worst quadrant.'],
  },
  'area-month-heat': {
    title: 'Availability by area and month',
    what: 'The availability of each area in each month on a fixed 90–100 % scale; the last column is the whole period.',
    formulas: ['{af}', T_DEF],
    how: [P1, RATIO, P6],
  },
  'area-rate': {
    title: 'Failures per 1,000 operating hours by area',
    what: 'The failure rate of each area adjusted for its running time; the dashed line is all areas together.',
    formulas: [RATE_F, 'All areas = all failures ÷ all operating hours × 1,000 (not an average of the bars)'],
    how: [P2, P1],
    example: 'Here: {a} has the highest rate, {v}.',
  },
  // ------------------------------------------------------------ Event records
  'events-timeline': {
    title: 'Stops by area',
    what: 'Every stop of the day or week as a bar on the time axis, one lane per area.',
    formulas: ['Hours = the part of the stop inside the window'],
    how: ['A stop that continues past the window edge is cut there and marked.', 'Records that cannot be drawn (no valid times) are listed on Validate.'],
  },
  // ------------------------------------------------------------ Actions
  'as-status': {
    title: 'Where the open actions are',
    what: 'Open actions by status.',
    formulas: ['Share = actions with the status ÷ open actions × 100'],
    how: ['Open = every status except Closed and Cancelled.', 'Closed in the last 90 days are counted below the chart; cancelled actions are hidden.'],
  },
  'as-area': {
    title: 'Open actions by area',
    what: 'Open actions per area, split by status. Click an area to filter the board.',
    formulas: ['Bar = open actions of the area'],
    how: ['Actions for a whole line or the plant are under “Plant / line”.', 'The six areas with most open actions are drawn; the rest are listed below.'],
  },
  'as-effect': {
    title: 'Effectiveness',
    what: 'How many of the actions closed in the last 90 days fixed the problem.',
    formulas: ['Effective % = effective ÷ (effective + not effective) × 100'],
    how: ['An action is not effective when the failure returned after it was closed; watching = closed but not judged yet.'],
  },
  'as-owners': {
    title: 'Open actions by contractor',
    what: 'Open actions per contractor, with how many of them are overdue.',
    formulas: ['Overdue = open and the due date has passed'],
    how: ['“Nobody yet” = no contractor set.'],
  },
  'as-ovc': {
    title: 'Opened vs closed',
    what: 'Actions opened and closed in each of the last 6 months.',
    formulas: ['Opened = created in the month; closed = closed in the month'],
    how: ['Cancelled actions are not counted as closed.'],
  },
  'as-age': {
    title: 'Open actions by age',
    what: 'Open actions by the number of days since they were opened.',
    formulas: ['Age = today − the day the action was opened'],
    how: ['Only open actions are counted.'],
  },
} satisfies Record<string, ChartHelpEntry>;

export type ChartHelpId = keyof typeof CHART_HELP;

export type HelpVars = Record<string, string | number | null | undefined>;

const fill = (s: string, vars: Record<string, string>): string | null => {
  let missing = false;
  const out = s.replace(/\{(\w+)\}/g, (m, k: string) => {
    if (k in vars) return vars[k]!;
    missing = true;
    return m;
  });
  return missing ? null : out;
};

/** The dialog text of a chart: what it shows, the formulas, how it is calculated and the live example (when known). */
export function chartHelp(id: ChartHelpId, vars: HelpVars = {}): KpiInfo {
  const e: ChartHelpEntry = CHART_HELP[id];
  const v: Record<string, string> = {};
  for (const [k, x] of Object.entries(vars)) if (x !== null && x !== undefined && x !== '') v[k] = String(x);
  const basis = (v.b === 'A' || v.b === 'C' ? v.b : 'B') as 'A' | 'B' | 'C';
  v.af = t(AVAILABILITY_FORMULA[basis]);
  // texts may name {n}/{d} (settings) or {b}: fill what is known, keep the words readable otherwise
  const text = (s: string): string => fill(t(s), v) ?? t(s).replace(/\{(\w+)\}/g, (_m, k: string) => (k === 'n' ? 'N' : k === 'd' ? 'D' : k));
  const sections: InfoSection[] = [
    { kind: 'what', heading: t('What it shows'), items: [text(e.what)] },
    { kind: 'formula', heading: t('Formula'), items: e.formulas.map(text) },
    { kind: 'how', heading: t('How it is calculated'), items: e.how.map(text) },
  ];
  const ex = e.example ? fill(t(e.example), v) : null;
  if (ex) sections.push({ kind: 'example', heading: t('With the numbers shown'), items: [ex] });
  return { id, title: t(e.title), paragraphs: [], sections };
}
