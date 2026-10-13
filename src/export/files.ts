// File names and the browser download for exports. Names read like 'ACC-downtime-monthly-management-report_2026-09.xlsx'.
import { CSV_MIME } from './csv';
import { XLSX_MIME } from './xlsx';

/** 'Monthly management report' -> 'monthly-management-report' (ASCII letters and digits; accents folded; '' when nothing is left). */
export function slug(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The period part of a file name: '2026-09' for a range inside one month, else '2026-07-01_to_2026-09-30'. */
export function periodSlug(range: { from: string; to: string }): string {
  return range.from.slice(0, 7) === range.to.slice(0, 7) ? range.from.slice(0, 7) : `${range.from}_to_${range.to}`;
}

export function exportFileName(parts: { base: string; period?: string; extra?: string }, ext: 'xlsx' | 'csv'): string {
  const bits = [`ACC-downtime-${slug(parts.base) || 'export'}`];
  if (parts.period) bits.push(parts.period);
  if (parts.extra) bits.push(slug(parts.extra) || 'data');
  return `${bits.join('_')}.${ext}`;
}

export const mimeOf = (ext: 'xlsx' | 'csv'): string => (ext === 'xlsx' ? XLSX_MIME : CSV_MIME);

/** Hands a file to the browser's download. Returns false when the browser refused. */
export function downloadFile(name: string, data: Uint8Array | string, mime: string): boolean {
  try {
    const blob = new Blob([data as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  } catch {
    return false;
  }
}

const pad = (n: number): string => String(n).padStart(2, '0');
/** The local time now as 'YYYY-MM-DD HH:MM:SS' (for 'exported on'). */
export function stampNow(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
