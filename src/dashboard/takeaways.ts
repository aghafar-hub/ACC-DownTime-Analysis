// The one-line takeaway under each Analyze page title. Pure: every number comes from a model value handed in,
// nothing is estimated or invented. A missing comparison is said in words, never as a made-up change.
import type { Change, Metric } from '../calc';
import { t } from '../i18n/t';
import type { CompareMode } from './filters';
import { fh, fh2, fint, fpct0, monthLabel, noChangeText } from './format';

const MINUS = '−';
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** ", +5.6% vs previous period" / ", unchanged vs ..." / ", no data in the previous period" / "" when no comparison was asked for. */
export function changeClause(change: Change | null, compare: CompareMode): string {
  if (compare === 'none') return '';
  const label = compare === 'same_period_last_year' ? t('same period last year') : t('previous period');
  if (!change) return `, ${lower(noChangeText(compare))}`;
  if (!change.available) return `, ${t('no comparison available')}`;
  if (change.direction === 'flat') return `, ${t('unchanged vs {label}', { label })}`;
  const sign = change.abs > 0 ? '+' : MINUS;
  const amount = change.pct === null ? `${fh(Math.abs(change.abs))} h` : fpct0(Math.abs(change.pct));
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
    return `${head}; ${t('{a} is the largest contributor ({p} of failure hours).', { a: top.areaId, p: fpct0(top.sharePct ?? 0) })}`;
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
  groups: number;
  recurrences: number;
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
  return t('{g} repeated-failure groups ({r} recurrence events) across {e} equipment codes; {c} repeats most, {n} times and {h} h{reason}.', {
    g: fint(f.groups), r: fint(f.recurrences), e: fint(f.equipmentCount), c: f.top.equipmentId, n: fint(f.top.occurrences), h: fh(f.top.totalHours),
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
