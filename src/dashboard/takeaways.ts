// The one-line takeaway under each Analyze page title. Pure: every number comes from a model value handed in,
// nothing is estimated or invented. A missing comparison is said in words, never as a made-up change.
import type { Change, Metric } from '../calc';
import { t } from '../i18n/t';
import type { CompareMode } from './filters';
import { dayLabel, fh, fh2, fint, fpct, fpct0, monthLabel, noChangeText } from './format';
import { statusLine, type TargetStatus } from './targets';

const MINUS = '−';
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** ", +5.6% vs previous period" / ", unchanged vs ..." / ", no data in the previous period" / "" when no comparison was asked for. */
export function changeClause(change: Change | null, compare: CompareMode): string {
  if (compare === 'none') return '';
  const label = compare === 'same_period_last_year' ? t('same period last year') : t('previous period');
  if (!change) return `, ${lower(noChangeText(compare))}`;
  if (!change.available) return `, ${t('no comparison available')}`;
  const amount = change.pct === null ? `${fh(Math.abs(change.abs))} h` : fpct0(Math.abs(change.pct));
  // a change that rounds to zero as written reads 'unchanged', never '+0.0%'
  if (change.direction === 'flat' || amount === (change.pct === null ? `${fh(0)} h` : fpct0(0))) return `, ${t('unchanged vs {label}', { label })}`;
  const sign = change.abs > 0 ? '+' : MINUS;
  return `, ${sign}${amount} ${t('vs {label}', { label })}`;
}

export interface OverviewFacts {
  /** null when the range has no data */
  kpi: { downtimeHours: number; topArea: { available: true; areaId?: string; sharePct?: number } | { available: false } } | null;
  noDataReason?: string | null;
  downtimeChange: Change | null;
  compare: CompareMode;
}

export function overviewTakeaway(f: OverviewFacts): string {
  if (!f.kpi) return f.noDataReason ?? t('No data for this range');
  const head = t('{h} area-hours stopped', { h: fh(f.kpi.downtimeHours) }) + changeClause(f.downtimeChange, f.compare);
  const top = f.kpi.topArea;
  if (top.available && top.areaId) {
    return `${head}; ${t('{a} is the largest contributor by failure hours ({p} of them).', { a: top.areaId, p: fpct0(top.sharePct ?? 0) })}`;
  }
  return `${head}; ${t('no failures were recorded.')}`;
}

export interface ParetoFacts {
  /** failure hours on own equipment */
  totalHours: number;
  /** different equipment codes */
  codeCount: number;
  /** largest first; share against the full total */
  top: { label: string; value: number; sharePct: number }[];
}

export function paretoTakeaway(f: ParetoFacts | null): string {
  if (!f) return t('No data for this range');
  const first = f.top[0];
  if (!first || !(f.totalHours > 0)) return t('No failure hours on own equipment in this range.');
  const label = first.label.trim() ? first.label : t('(blank code)');
  let s = t('{h} failure hours on own equipment across {n} codes; {c} leads with {v} h ({p} of the total)', {
    h: fh(f.totalHours), n: fint(f.codeCount), c: label, v: fh(first.value), p: fpct0(first.sharePct),
  });
  if (f.top.length >= 3 && f.codeCount > 3) {
    s += `, ${t('and the top 3 codes make up {p}', { p: fpct0(f.top.slice(0, 3).reduce((a, b) => a + b.sharePct, 0)) })}`;
  }
  return `${s}.`;
}

export interface RepeatsFacts {
  /** repeated failures: groups with at least two occurrences in the range (listedRepeats) */
  groups: number;
  /** repeat events: the distinct failure events of those groups */
  events: number;
  equipmentCount: number;
  /** the group with the most occurrences */
  top: { equipmentId: string; occurrences: number; totalHours: number; reason: string } | null;
  minEvents: number;
  windowDays: number;
}

export function repeatsTakeaway(f: RepeatsFacts | null): string {
  if (!f) return t('No data for this range');
  if (f.groups === 0 || !f.top) {
    return t('No repeated failures in this range (a group needs at least {n} events with the same code and reason within {d} days).', { n: f.minEvents, d: f.windowDays });
  }
  const reason = f.top.reason.trim();
  return t('{g} repeated failures ({r} repeat events) across {e} equipment codes; {c} repeats most, {n} times and {h} h{reason}.', {
    g: fint(f.groups), r: fint(f.events), e: fint(f.equipmentCount), c: f.top.equipmentId, n: fint(f.top.occurrences), h: fh(f.top.totalHours),
    reason: reason ? ` (${reason})` : '',
  });
}

export interface ReliabilityFacts {
  mtbf: Metric;
  mttr: Metric;
  failureEvents: number;
  /** the last two months that have an MTBF, oldest first */
  lastMonths: { month: string; mtbf: number }[];
  /** "K.2" or null for all areas */
  areaId: string | null;
}

export function reliabilityTakeaway(f: ReliabilityFacts | null): string {
  if (!f) return t('No data for this range');
  const where = f.areaId ? ` ${t('for {a}', { a: f.areaId })}` : '';
  const mtbf = f.mtbf.available ? t('MTBF is {v} h', { v: fh(f.mtbf.value) }) : t('MTBF is not defined ({r})', { r: lower(f.mtbf.reason) });
  const mttr = f.mttr.available ? t('mean restoration time {v} h', { v: fh2(f.mttr.value) }) : null;
  let s = `${mtbf}${where}`;
  if (mttr) s += ` ${t('and')} ${mttr}`;
  s += `, ${t('over {n} failure events', { n: fint(f.failureEvents) })}`;
  if (f.lastMonths.length === 2) {
    const [a, b] = f.lastMonths as [{ month: string; mtbf: number }, { month: string; mtbf: number }];
    const word = b.mtbf > a.mtbf ? t('up') : b.mtbf < a.mtbf ? t('down') : t('unchanged');
    s += `; ${t('MTBF in {m} was {v} h, {w} from {p} h in {pm}', { m: monthLabel(b.month), v: fh(b.mtbf), w: word, p: fh(a.mtbf), pm: monthLabel(a.month) })}`;
  }
  return `${s}.`;
}

// ---------------------------------------------------------------- the Reports page
// One sentence per report section and the bullets of the executive summary. Same rule as above: every number comes
// from a fact handed in; nothing is estimated, and a missing figure is said in words.


const signed = (n: number): string => (n > 0 ? '+' : n < 0 ? MINUS : '');
const compareLabel = (compare: CompareMode): string => (compare === 'same_period_last_year' ? t('same period last year') : t('previous period'));

/** ", 0.4 pts higher than the previous period" for an availability change (the Change holds fractions). */
export function pointsClause(change: Change | null, compare: CompareMode): string {
  if (compare === 'none') return '';
  if (!change || !change.available) return '';
  const pts = Math.round(change.abs * 1000) / 10;
  if (pts === 0) return `, ${t('unchanged vs {label}', { label: compareLabel(compare) })}`;
  return `, ${signed(pts)}${Math.abs(pts).toFixed(1)} ${t('pts')} ${t('vs {label}', { label: compareLabel(compare) })}`;
}

export interface SummaryFacts {
  /** area-hours: failure + planned + other */
  downtimeHours: number;
  failureHours: number;
  plannedHours: number;
  otherHours: number;
  failureCount: number;
  failureEventCount: number;
  areaCount: number;
  availability: Metric;
  basis: 'A' | 'B' | 'C';
  mttr: Metric;
  topArea: { available: true; areaId?: string; sharePct?: number } | { available: false };
  topEquipment: { code: string; hours: number } | null;
  repeatGroups: number;
  repeatedFailureCount: number;
  downtimeChange: Change | null;
  availabilityChange: Change | null;
  mttrChange: Change | null;
  compare: CompareMode;
  availabilityStatus: TargetStatus | null;
  mttrStatus: TargetStatus | null;
  belowTarget: { below: string[]; total: number } | null;
}

/** The 3 to 5 findings of the executive summary, in a fixed order; a bullet is left out when its facts do not exist. */
export function summaryBullets(f: SummaryFacts): string[] {
  const out: string[] = [];
  out.push(`${t('{h} area-hours stopped ({f} h failures, {p} h planned, {o} h other)', {
    h: fh(f.downtimeHours), f: fh(f.failureHours), p: fh(f.plannedHours), o: fh(f.otherHours),
  })}${changeClause(f.downtimeChange, f.compare)}.`);
  if (f.availability.available) {
    let s = `${t('Availability (basis {b}) was {v}', { b: f.basis, v: fpct(f.availability.value) })}${pointsClause(f.availabilityChange, f.compare)}.`;
    if (f.availabilityStatus) s += ` ${statusLine(f.availabilityStatus)}.`;
    out.push(s);
  } else {
    out.push(`${t('Availability could not be calculated')}: ${lower(f.availability.reason)}.`);
  }
  if (f.failureCount === 0) {
    out.push(t('No failures were recorded in this period.'));
  } else {
    let s = f.failureCount === f.failureEventCount
      ? t('{n} failures', { n: fint(f.failureCount) })
      : t('{n} failures in {e} failure events', { n: fint(f.failureCount), e: fint(f.failureEventCount) });
    if (f.mttr.available) s += `; ${t('mean restoration time {v} h', { v: fh2(f.mttr.value) })}${f.mttrStatus ? ` (${statusLine(f.mttrStatus).toLowerCase()})` : ''}`;
    out.push(`${s}.`);
  }
  if (f.topArea.available && f.topArea.areaId) {
    let s = t('{a} is the largest contributor by failure hours ({p} of them)', { a: f.topArea.areaId, p: fpct0(f.topArea.sharePct ?? 0) });
    if (f.topEquipment) s += `; ${t('{c} is the top equipment with {v} h', { c: f.topEquipment.code, v: fh(f.topEquipment.hours) })}`;
    out.push(`${s}.`);
  }
  if (f.belowTarget && f.belowTarget.total > 0) {
    out.push(f.belowTarget.below.length === 0
      ? (f.belowTarget.total === 1 ? t('The area is on the availability target.') : t('All {m} areas are on the availability target.', { m: f.belowTarget.total }))
      : t('{n} of {m} areas are below the availability target: {list}.', { n: f.belowTarget.below.length, m: f.belowTarget.total, list: f.belowTarget.below.join(', ') }));
  } else if (f.repeatGroups > 0) {
    out.push(t('{g} repeated failures with {r} repeat events.', { g: fint(f.repeatGroups), r: fint(f.repeatedFailureCount) }));
  }
  return out;
}

export interface DailyFacts {
  /** days with data */
  days: number;
  totalHours: number;
  peak: { date: string; hours: number } | null;
}
export function dailyTakeaway(f: DailyFacts): string {
  if (f.days === 0 || !f.peak) return t('No daily data in this period.');
  return t('{h} area-hours stopped over {n} days (average {a} h a day); the highest day was {d} with {v} h.', {
    h: fh(f.totalHours), n: fint(f.days), a: fh(f.totalHours / f.days), d: dayLabel(f.peak.date), v: fh(f.peak.hours),
  });
}

export interface MonthlyFacts {
  months: number;
  failureHours: number;
  plannedHours: number;
  otherHours: number;
  peak: { month: string; hours: number } | null;
}
export function monthlyTakeaway(f: MonthlyFacts): string {
  if (f.months === 0 || !f.peak) return t('No monthly data in this period.');
  const base = t('Failure {f} h, planned {p} h and CIR {o} h in total', { f: fh(f.failureHours), p: fh(f.plannedHours), o: fh(f.otherHours) });
  return f.months === 1
    ? `${base}.`
    : `${base}; ${t('the highest month was {m} with {v} h stopped', { m: monthLabel(f.peak.month), v: fh(f.peak.hours) })}.`;
}

export interface ClassFacts { total: number; top: { code: string; name: string; hours: number } | null }
export function classesTakeaway(f: ClassFacts): string {
  if (!f.top || !(f.total > 0)) return t('No stopped hours in this period.');
  return t('{c} ({n}) is the largest class: {v} h of {a} h stopped ({p}).', { c: f.top.code, n: f.top.name, v: fh(f.top.hours), a: fh(f.total), p: fpct0((f.top.hours / f.total) * 100) });
}

export interface AreaDowntimeFacts { total: number; top: { areaId: string; hours: number } | null; areaCount: number }
export function areaDowntimeTakeaway(f: AreaDowntimeFacts): string {
  if (!f.top || !(f.total > 0)) return t('No stopped hours in this period.');
  const where = f.areaCount === 1 ? '' : `, ${t('across {n} areas', { n: f.areaCount })}`;
  return `${t('{a} stopped longest: {v} h of the {t} h in total ({p})', { a: f.top.areaId, v: fh(f.top.hours), t: fh(f.total), p: fpct0((f.top.hours / f.total) * 100) })}${where}.`;
}

export interface AvailabilityFacts {
  basis: 'A' | 'B' | 'C';
  lowest: { areaId: string; value: number } | null;
  highest: { areaId: string; value: number } | null;
  overall: Metric;
  belowTarget: { below: string[]; total: number } | null;
  target: number | null;
}
export function availabilityTakeaway(f: AvailabilityFacts): string {
  if (!f.lowest || !f.highest) return t('No availability can be calculated for these areas.');
  let s = f.lowest.areaId === f.highest.areaId
    ? t('{a} had an availability (basis {b}) of {v}', { a: f.lowest.areaId, b: f.basis, v: fpct(f.lowest.value) })
    : t('Availability (basis {b}) ranges from {lo} in {la} to {hi} in {ha}', { b: f.basis, lo: fpct(f.lowest.value), la: f.lowest.areaId, hi: fpct(f.highest.value), ha: f.highest.areaId });
  if (f.overall.available) s += `; ${t('all areas together {v}', { v: fpct(f.overall.value) })}`;
  s += '.';
  if (f.belowTarget && f.target !== null) {
    s += ` ${f.belowTarget.below.length === 0 ? t('All {m} areas are on the target of {x}%.', { m: f.belowTarget.total, x: f.target }) : t('{n} of {m} areas are below the target of {x}%.', { n: f.belowTarget.below.length, m: f.belowTarget.total, x: f.target })}`;
  }
  return s;
}

export interface MtbfMttrFacts {
  lowestMtbf: { areaId: string; value: number } | null;
  highestMttr: { areaId: string; value: number } | null;
  withFailures: number;
  areaCount: number;
}
export function mtbfMttrTakeaway(f: MtbfMttrFacts): string {
  if (!f.lowestMtbf && !f.highestMttr) return t('No area has failures in this period, so there is nothing to rank.');
  const parts: string[] = [];
  if (f.lowestMtbf) parts.push(t('{a} has the lowest MTBF ({v} h)', { a: f.lowestMtbf.areaId, v: fh(f.lowestMtbf.value) }));
  if (f.highestMttr) parts.push(t('{a} has the highest MTTR ({v} h)', { a: f.highestMttr.areaId, v: fh2(f.highestMttr.value) }));
  return `${parts.join('; ')}. ${t('{n} of {m} areas have failures.', { n: f.withFailures, m: f.areaCount })}`;
}

export interface FailureRateFacts { top: { areaId: string; value: number } | null; overall: Metric }
export function failureRateTakeaway(f: FailureRateFacts): string {
  if (!f.top) return t('No failure rate can be calculated for these areas.');
  return `${t('{a} has the highest failure rate: {v} failures per 1,000 operating hours', { a: f.top.areaId, v: fh2(f.top.value) })}${f.overall.available ? `; ${t('all areas together {v}', { v: fh2(f.overall.value) })}` : ''}.`;
}

export interface CausesFacts {
  /** "failure hours" or "failures" */
  what: string;
  unit: string;
  total: number;
  entryCount: number;
  top: { label: string; value: number; sharePct: number }[];
  fmt: (n: number) => string;
}
/** Top equipment / reasons: the leader, its share and the share of the top three. */
export function causesTakeaway(f: CausesFacts | null): string {
  if (!f) return t('No data for this period');
  const first = f.top[0];
  if (!first || !(f.total > 0)) return t('No {what} in this period.', { what: f.what });
  const label = first.label.trim() ? first.label : t('(blank)');
  let s = t('{h} {u} in total across {n} items; {c} leads with {v} {u} ({p} of the total)', { h: f.fmt(f.total), u: f.unit, n: fint(f.entryCount), c: label, v: f.fmt(first.value), p: fpct0(first.sharePct) });
  if (f.top.length >= 3 && f.entryCount > 3) s += `, ${t('and the top 3 make up {p}', { p: fpct0(f.top.slice(0, 3).reduce((a, b) => a + b.sharePct, 0)) })}`;
  return `${s}.`;
}

export interface ParetoSectionFacts {
  what: string;
  area: { label: string; sharePct: number } | null;
  line: { label: string; sharePct: number } | null;
  classification: { label: string; sharePct: number } | null;
  /** number of bars that reach 80% in the area Pareto, null when it does not */
  areaTo80: number | null;
}
export function paretoSectionTakeaway(f: ParetoSectionFacts): string {
  const parts: string[] = [];
  if (f.area) parts.push(t('largest area {a} ({p})', { a: f.area.label, p: fpct0(f.area.sharePct) }));
  if (f.line) parts.push(t('largest line {a} ({p})', { a: f.line.label, p: fpct0(f.line.sharePct) }));
  if (f.classification) parts.push(t('largest class {a} ({p})', { a: f.classification.label, p: fpct0(f.classification.sharePct) }));
  if (parts.length === 0) return t('No {what} in this period.', { what: f.what });
  const to80 = f.areaTo80 !== null ? ` ${f.areaTo80 === 1 ? t('One area alone reaches 80%.') : t('{n} areas reach 80%.', { n: f.areaTo80 })}` : '';
  return `${t('Share of {what}', { what: f.what })}: ${parts.join('; ')}.${to80}`;
}

export interface LongestFacts { events: number; top: { code: string; areaId: string; date: string; hours: number; reason: string } | null; totalHours: number }
export function longestTakeaway(f: LongestFacts): string {
  if (!f.top) return t('No failure events in this period.');
  const reason = f.top.reason.trim();
  const head = t('The longest event was {c} in {a} on {d}: {h} h{r}.', { c: f.top.code || t('(blank)'), a: f.top.areaId, d: dayLabel(f.top.date), h: fh2(f.top.hours), r: reason ? ` (${reason})` : '' });
  return f.events === 1 ? head : `${head} ${t('The {n} longest events add up to {t} h.', { n: fint(f.events), t: fh(f.totalHours) })}`;
}

export interface QuadrantFacts { plotted: number; worst: string[]; medianMtbf: number | null; medianMttr: number | null }
export function quadrantTakeaway(f: QuadrantFacts): string {
  if (f.plotted === 0) return t('No area has both an MTBF and an MTTR in this period.');
  if (f.medianMtbf === null || f.medianMttr === null) return t('{n} areas plotted; at least two areas are needed for the median lines.', { n: f.plotted });
  const medians = t('Median MTBF {a} h, median MTTR {b} h.', { a: fh(f.medianMtbf), b: fh2(f.medianMttr) });
  return `${t('{n} areas plotted.', { n: f.plotted })} ${medians} ${f.worst.length ? t('Worst quadrant (low MTBF, high MTTR): {a}.', { a: f.worst.join(', ') }) : t('No area is in the worst quadrant (low MTBF, high MTTR).')}`;
}

export interface WhenFacts {
  measure: 'count' | 'hours';
  total: number;
  peakHour: { label: string; value: number } | null;
  peakDay: { label: string; value: number } | null;
  peakSlot: { day: string; hour: string; value: number } | null;
}
export function whenTakeaway(f: WhenFacts): string {
  if (!(f.total > 0) || !f.peakHour || !f.peakDay || !f.peakSlot) return t('No failure events started in this period.');
  const fmt = f.measure === 'count' ? fint : fh;
  const u = f.measure === 'count' ? t('failure events') : 'h';
  return t('{t} {u} started in the period. Busiest hour {h} ({hv}), busiest day {d} ({dv}); the single busiest slot is {d2} at {h2} ({v}).', {
    t: fmt(f.total), u, h: f.peakHour.label, hv: fmt(f.peakHour.value), d: t(f.peakDay.label), dv: fmt(f.peakDay.value), d2: t(f.peakSlot.day), h2: f.peakSlot.hour, v: fmt(f.peakSlot.value),
  });
}

export interface EventsFacts { records: number; shown: number; all: boolean; shownHours: number; totalHours: number }
export function eventsTakeaway(f: EventsFacts): string {
  if (f.records === 0) return t('No records match the filters in this period.');
  if (f.all || f.shown >= f.records) return t('All {n} records of the period, {h} h in total.', { n: fint(f.records), h: fh(f.totalHours) });
  return t('The {k} longest of {n} records, {h} h of the {t} h in total.', { k: fint(f.shown), n: fint(f.records), h: fh(f.shownHours), t: fh(f.totalHours) });
}

export interface QualityFacts { records: number; leftOut: { count: number; hours: number }; kept: number; open: number; voided: number }
export function qualityTakeaway(f: QualityFacts): string {
  if (f.records === 0 && f.voided === 0) return t('No records were checked in this period.');
  const s = t('{n} records were checked: {l} left out of the numbers ({h} h), {k} kept as entered, {o} with problems still open.', {
    n: fint(f.records), l: fint(f.leftOut.count), h: fh(f.leftOut.hours), k: fint(f.kept), o: fint(f.open),
  });
  return f.voided > 0 ? `${s} ${t('{n} voided records are ignored everywhere.', { n: fint(f.voided) })}` : s;
}
