// Relative age of a notification ("just now", "5 min ago", "2 h ago", "yesterday", "3 days ago", "4 Oct").
// Timestamps are plant-local 'YYYY-MM-DD HH:MM:SS(.mmm)' and are read in the browser's own zone, like the rest of the app.
import { t } from '../i18n/t';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number, l = 2): string => String(n).padStart(l, '0');

/** 'YYYY-MM-DD[ T]HH:MM[:SS[.mmm]]' (or a date alone) -> ms, or null when it cannot be read. */
export function parseStamp(ts: string | undefined | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/.exec(String(ts ?? '').trim());
  if (!m) return null;
  const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), Number((m[7] ?? '0').padEnd(3, '0'))).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** ms -> 'YYYY-MM-DD HH:MM:SS.mmm' (the stored spelling). */
export function formatStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p2(d.getMilliseconds(), 3)}`;
}

const dayNumber = (ms: number): number => {
  const d = new Date(ms);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
};

export function relativeAge(ts: string | undefined | null, nowMs: number): string {
  const ms = parseStamp(ts);
  if (ms === null) return '';
  const diff = nowMs - ms;
  if (diff < 60_000) return t('just now');
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return t('{n} min ago', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('{n} h ago', { n: hours });
  const days = dayNumber(nowMs) - dayNumber(ms);
  if (days <= 1) return t('yesterday');
  if (days < 7) return t('{n} days ago', { n: days });
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? '' : ` ${d.getFullYear()}`}`;
}
