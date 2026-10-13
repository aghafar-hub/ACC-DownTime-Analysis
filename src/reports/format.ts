// Wording of a change against the other period, for the report: an arrow, a signed amount and words, so the meaning
// never rests on colour alone. Pure.
import type { Change } from '../calc';
import type { CompareMode } from '../dashboard/filters';
import { fh, fh2, fint, noChangeText } from '../dashboard/format';
import { t } from '../i18n/t';
import type { KpiCard } from './model';

const MINUS = '−';
const nf1 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export interface ChangeText {
  arrow: string;
  /** "+54.2 h (+14.4%)" */
  amount: string;
  /** "worse", "better", "no change" or "" */
  words: string;
  tone: 'good' | 'bad' | 'neutral' | 'none';
}

const NONE = (text: string): ChangeText => ({ arrow: '', amount: text, words: '', tone: 'none' });

/** The change line of a KPI card. `change` null with a comparison on means the other period has no data. */
export function changeText(change: Change | null, unit: KpiCard['changeUnit'], compare: CompareMode): ChangeText | null {
  if (compare === 'none') return null;
  if (!change) return NONE(noChangeText(compare));
  if (!change.available) return NONE(t('No comparison: {reason}', { reason: change.reason }));
  const sign = change.abs > 0 ? '+' : change.abs < 0 ? MINUS : '';
  const a = Math.abs(change.abs);
  const amount = unit === 'pts' ? `${nf1.format(a * 100)} ${t('pts')}` : unit === 'count' ? fint(a) : unit === 'h2' ? `${fh2(a)} h` : `${fh(a)} h`;
  const pct = change.pct === null || unit === 'pts' ? '' : ` (${change.pct > 0 ? '+' : change.pct < 0 ? MINUS : ''}${nf1.format(Math.abs(change.pct))}%)`;
  const words = change.assessment === 'good' ? t('better') : change.assessment === 'bad' ? t('worse') : change.direction === 'flat' ? t('no change') : '';
  return {
    arrow: change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '■',
    amount: change.direction === 'flat' ? amount : `${sign}${amount}${pct}`,
    words, tone: change.assessment,
  };
}
