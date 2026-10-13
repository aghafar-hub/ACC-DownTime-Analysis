import { tsText } from './dates';

export const nf = new Intl.NumberFormat('en-GB');

/** 3,482 style numbers. */
export const num = (n: number): string => nf.format(n);

/** Hours with one decimal: 1,234.5 */
export const hours = (seconds: number): string => nf.format(Math.round((seconds / 3600) * 10) / 10);

/** "45 s", "12 min", "2 h 05 min"; negative values keep their sign. */
export function duration(seconds: number): string {
  const neg = seconds < 0;
  const s = Math.abs(Math.round(seconds));
  let out: string;
  if (s < 60) out = `${s} s`;
  else if (s < 3600) out = `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
  else out = `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
  return neg ? `-${out}` : out;
}

/** 'YYYY-MM-DD HH:MM:SS.mmm' -> '26 Aug 2026 14:05' (the app's one timestamp format, see dates.ts) */
export const shortTs = (ts: string): string => tsText(ts);

/** A real instant in local time: '26 Aug 2026 14:05'. */
export { whenText } from './dates';
