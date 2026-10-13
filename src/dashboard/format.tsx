// Number and metric formatting for the dashboards. Unavailable values keep their reason; zero failures read
// "none recorded"; nothing here turns a missing value into 0.
import type { ReactNode } from 'react';
import type { Change, Metric } from '../calc';
import { t } from '../i18n/t';
import { nf } from '../util/format';
import type { CompareMode } from './filters';

const nf1 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Hours with one decimal: 1,234.5 */
export const fh = (h: number): string => nf1.format(h);
export const fh2 = (h: number): string => nf2.format(h);
export const fint = (n: number): string => nf.format(n);
/** 0..1 -> "97.4%" */
export const fpct = (frac: number): string => `${nf1.format(frac * 100)}%`;
export const fpct0 = (pct: number): string => `${nf1.format(pct)}%`;

export interface MetricText { text: string; reason?: string; unavailable: boolean }

/** Text for a Metric: its value, "None recorded" for no failures, otherwise "Unavailable" with the reason. */
export function metricText(m: Metric, fmt: (n: number) => string, unit = ''): MetricText {
  if (m.available) return { text: `${fmt(m.value)}${unit}`, unavailable: false };
  if (m.code === 'no_failures') return { text: t('None recorded'), reason: m.reason, unavailable: false };
  return { text: t('Unavailable'), reason: m.reason, unavailable: true };
}

/** "2026-03" -> "Mar 26" */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(m) - 1] ?? m} ${String(y).slice(2)}`;
}

/** "2026-03-05" -> "5 Mar 2026" */
export function dayLabel(d: string): string {
  const [y, m, day] = d.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(day)} ${names[Number(m) - 1] ?? m} ${y}`;
}

/** "2026-03-05" -> "5 Mar" */
export function dayShort(d: string): string {
  const [, m, day] = d.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(day)} ${names[Number(m) - 1] ?? m}`;
}

/** Tooltip note of a partial month: the days it shows ("Partial month: 15 Jan 2026 to 31 Jan 2026" or "...: data to 10 Feb 2026"). */
export function partialNote(m: { month: string; partial: boolean; window: { from: string; to: string } | null }): string | undefined {
  if (!m.partial || !m.window) return undefined;
  return m.window.from.endsWith('-01')
    ? t('Partial month: data to {d}', { d: dayLabel(m.window.to) })
    : t('Partial month: {a} to {b}', { a: dayLabel(m.window.from), b: dayLabel(m.window.to) });
}

/** Footnote under a monthly chart that has partial months. */
export const PARTIAL_FOOT = 'Months with * show only part of the month (the range or the data starts or ends inside it); they are outlined with a dashed line.';

export function rangeLabel(r: { from: string; to: string }): string {
  return r.from === r.to ? dayLabel(r.from) : `${dayLabel(r.from)} – ${dayLabel(r.to)}`;
}

/** The change line under a KPI: arrow + sign + words, coloured by good / bad; never colour alone. */
export function noChangeText(compare: CompareMode): string {
  if (compare === 'none') return t('No comparison selected');
  return compare === 'same_period_last_year' ? t('No data last year') : t('No data in the previous period');
}

/** `compare` is the comparison the user chose; a missing change then means the other period has no data. */
export function ChangeLine({ change, fmt, unit = '', label, testid, compare = 'none' }: { change: Change | null; fmt: (n: number) => string; unit?: string; label: string; testid?: string; compare?: CompareMode }): ReactNode {
  if (!change) return <span className="kpi-change kpi-change--none" data-testid={testid}>{noChangeText(compare)}</span>;
  if (!change.available) return <span className="kpi-change kpi-change--none" data-testid={testid}>{t('No comparison: {reason}', { reason: change.reason })}</span>;
  const c = asShown(change, fmt);
  const sign = c.abs > 0 ? '+' : c.abs < 0 ? '−' : '';
  const arrow = c.direction === 'up' ? '▲' : c.direction === 'down' ? '▼' : '■';
  const pct = c.pct === null || c.direction === 'flat' ? '' : ` (${c.pct > 0 ? '+' : c.pct < 0 ? '−' : ''}${nf1.format(Math.abs(c.pct))}%)`;
  const word = c.assessment === 'good' ? t('better') : c.assessment === 'bad' ? t('worse') : c.direction === 'flat' ? t('no change') : '';
  return (
    <span className={`kpi-change kpi-change--${c.assessment}`} data-testid={testid}>
      <span aria-hidden="true">{arrow}</span> {sign}{fmt(Math.abs(c.abs))}{unit}{pct}{word ? ` · ${word}` : ''} <span className="kpi-change-label">{label}</span>
    </span>
  );
}

/**
 * The change as the reader sees it: a difference that rounds to zero in the shown format ("0.0 pts", "0.0 h") is
 * no change, neutral, never 'better' or 'worse'.
 */
export function asShown<C extends Change>(change: C, fmt: (n: number) => string): C {
  if (!change.available || change.direction === 'flat') return change;
  if (fmt(Math.abs(change.abs)) !== fmt(0)) return change;
  return { ...change, abs: 0, pct: change.pct === null ? null : 0, direction: 'flat', assessment: 'neutral' };
}
