// The one date format of the app (exports excluded: files keep ISO dates).
//   month      'Aug 2026'
//   day        '26 Aug'            (dayText; with the year: '26 Aug 2026', dateText)
//   timestamp  '26 Aug 2026 14:05'
//   range      '1 Jan – 31 Aug 2026', '1–12 Oct 2026', '12 Aug 2025 – 11 Oct 2026'
// Inputs are the plant-time strings the data uses ('YYYY-MM', 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM:SS.mmm'); they are read
// as written, never through the browser's time zone. whenText formats a real instant (an ISO time with a zone) in the
// viewer's local time. Pure.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const monthName = (m: string | number): string => MONTHS[Number(m) - 1] ?? String(m);

/** '2026-08' (or '2026-08-26') -> 'Aug 2026' */
export function monthText(key: string): string {
  const [y, m] = String(key ?? '').split('-');
  if (!y || !m) return String(key ?? '');
  return `${monthName(m)} ${y}`;
}

/** '2026-08' -> 'Aug' (axis labels when every month is in one year; the year is said once elsewhere) */
export function monthShort(key: string): string {
  const m = String(key ?? '').split('-')[1];
  return m ? monthName(m) : String(key ?? '');
}

/** '2026-08-26' -> '26 Aug' */
export function dayText(d: string): string {
  const [, m, day] = String(d ?? '').slice(0, 10).split('-');
  if (!m || !day) return String(d ?? '');
  return `${Number(day)} ${monthName(m)}`;
}

/** '2026-08-26' -> '26 Aug 2026' */
export function dateText(d: string): string {
  const s = String(d ?? '').slice(0, 10);
  const y = s.slice(0, 4);
  const day = dayText(s);
  return day === s ? s : `${day} ${y}`;
}

/** '14:05' from 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DDTHH:MM...' */
export function timeText(ts: string): string {
  const m = /[ T](\d{2}):(\d{2})/.exec(String(ts ?? ''));
  return m ? `${m[1]}:${m[2]}` : '';
}

/** '2026-08-26 14:05:00.000' -> '26 Aug 2026 14:05' (a date alone stays a date) */
export function tsText(ts: string): string {
  const s = String(ts ?? '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const time = timeText(s);
  return time ? `${dateText(s)} ${time}` : dateText(s);
}

/** '2026-08-26 14:05' -> '26 Aug 14:05' (lists inside one known year) */
export function tsShort(ts: string): string {
  const s = String(ts ?? '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const time = timeText(s);
  return time ? `${dayText(s)} ${time}` : dayText(s);
}

/** A date range in as few words as it needs: '26 Aug 2026', '1–12 Oct 2026', '1 Jan – 31 Aug 2026', '12 Aug 2025 – 11 Oct 2026'. */
export function rangeText(r: { from: string; to: string }): string {
  const a = String(r.from).slice(0, 10);
  const b = String(r.to).slice(0, 10);
  if (a === b) return dateText(a);
  if (a.slice(0, 4) !== b.slice(0, 4)) return `${dateText(a)} – ${dateText(b)}`;
  if (a.slice(0, 7) === b.slice(0, 7)) return `${Number(a.slice(8, 10))}–${dateText(b)}`;
  return `${dayText(a)} – ${dateText(b)}`;
}

/** A real instant (ISO with a zone, or a Date) in the viewer's local time: '26 Aug 2026 14:05'. '' when not a date. */
export function whenText(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return typeof iso === 'string' ? iso : '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The same without the year when it is this year: '26 Aug 14:05'. */
export function whenShort(iso: string | Date | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const full = whenText(d);
  return d.getFullYear() === now.getFullYear() ? full.replace(` ${d.getFullYear()} `, ' ') : full;
}
