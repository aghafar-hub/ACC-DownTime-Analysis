// Per-area targets (backend 1.4.0, docs/wire-protocol.md section 10): the yearly planned-stop allowance split into months,
// its live validation in Settings, the year-to-date allowance against the planned hours used, and the availability
// target of an area (falling back to the plant-wide target). Pure; the PL hours follow P1 like the server's rule
// (overlapping stops counted once per area, planned first).
import { evenMonthlySplit, type AreaTarget, type EventRow } from '../api/types';
import { attributedHours, attributeRows, isAnalysable, lastDayOfMonth, parseDate, MS_DAY, type Attribution } from '../calc';
import { t } from '../i18n/t';

/** The server's tolerance: the 12 months must add up to the allowance within 0.1 h. */
export const SPLIT_TOLERANCE = 0.1;
export const ALLOWANCE_MAX = 8784;

const r2 = (n: number): number => Math.round(n * 100) / 100;
export const splitSum = (split: readonly number[]): number => r2(split.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0));

/** The split is the server's even split of this allowance (within a cent per month). */
export function isEvenSplit(split: readonly number[], allowance: number): boolean {
  const even = evenMonthlySplit(allowance);
  return split.length === 12 && split.every((n, i) => Math.abs(n - even[i]!) < 0.005);
}

export interface TargetDraft {
  /** text as typed: '' = no target */
  target: string;
  allowance: string;
  /** 12 month cells as typed */
  split: string[];
  overhaul: number[];
}

export const draftOf = (row: AreaTarget | undefined): TargetDraft => row
  ? { target: row.availability_target_pct === null ? '' : String(row.availability_target_pct), allowance: String(row.planned_allowance_h_year), split: row.monthly_split.map((n) => String(n)), overhaul: [...row.overhaul_months] }
  : { target: '', allowance: '', split: Array.from({ length: 12 }, () => ''), overhaul: [] };

const numOf = (s: string): number | null => {
  const v = s.trim();
  if (v === '') return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

export interface DraftCheck {
  /** nothing entered: the area has no targets (it is not sent) */
  blank: boolean;
  /** problems by field: target, allowance, split (and month index cells as split0..split11) */
  problems: Record<string, string>;
  allowance: number;
  split: number[];
  sum: number;
  /** sum minus allowance, hours */
  diff: number;
}

/**
 * Checks one area's typed targets as the server does: target 0-100 or blank, allowance 0-8784 h, 12 months of 0 or more
 * adding up to the allowance within 0.1 h, overhaul months 1-12. Blank month cells count as 0.
 */
export function checkDraft(d: TargetDraft): DraftCheck {
  const problems: Record<string, string> = {};
  const target = numOf(d.target);
  const allowance = numOf(d.allowance);
  const cells = d.split.map(numOf);
  const blank = target === null && allowance === null && cells.every((c) => c === null);
  if (target !== null && (Number.isNaN(target) || target < 0 || target > 100)) problems.target = t('Use a number from 0 to 100, or leave it blank.');
  if (!blank && allowance === null) problems.allowance = t('Write the planned-stop hours allowed in the year (0 or more).');
  else if (allowance !== null && (Number.isNaN(allowance) || allowance < 0 || allowance > ALLOWANCE_MAX)) problems.allowance = t('Use a number from 0 to {max} hours.', { max: ALLOWANCE_MAX.toLocaleString('en-GB') });
  cells.forEach((c, i) => {
    if (c !== null && (Number.isNaN(c) || c < 0)) problems[`split${i}`] = t('0 or more');
  });
  const split = cells.map((c) => (c === null || Number.isNaN(c) ? 0 : c));
  const a = allowance !== null && !Number.isNaN(allowance) ? allowance : 0;
  const sum = splitSum(split);
  const diff = r2(sum - a);
  if (!blank && !problems.allowance && Math.abs(diff) > SPLIT_TOLERANCE + 1e-9) {
    problems.split = t('The months add up to {s} h, not the {a} h allowed in the year ({d}).', { s: fmtH(sum), a: fmtH(a), d: `${diff > 0 ? '+' : '−'}${fmtH(Math.abs(diff))} h` });
  }
  if (d.overhaul.some((m) => !Number.isInteger(m) || m < 1 || m > 12)) problems.overhaul = t('Overhaul months are month numbers from 1 to 12.');
  return { blank, problems, allowance: a, split, sum, diff };
}

export const fmtH = (n: number): string => (Math.round(n * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 });

/** 'Even · 20 h/mo' or 'Custom · Aug edited'. */
export function splitSummary(split: readonly number[], allowance: number): string {
  if (!(allowance > 0)) return t('No allowance');
  if (isEvenSplit(split, allowance)) return t('Even · {h} h/mo', { h: fmtH(allowance / 12) });
  const even = evenMonthlySplit(allowance);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const edited = split.map((n, i) => (Math.abs(n - even[i]!) >= 0.005 ? MONTHS[i]! : '')).filter(Boolean);
  return t('Custom · {m} edited', { m: edited.length > 3 ? t('{n} months', { n: edited.length }) : edited.join(', ') });
}

// ---------------------------------------------------------------- year to date

/** The allowance of January up to and including month `throughMonth` (1-12). */
export function ytdAllowance(split: readonly number[], throughMonth: number): number {
  let s = 0;
  for (let i = 0; i < Math.min(12, Math.max(0, throughMonth)); i++) s += split[i] ?? 0;
  return r2(s);
}

/** The PL hours of one area in each month of a year (P1 union, owned PL first), from analysable rows and their attribution. */
export function plannedHoursByMonth(rows: readonly EventRow[], attr: Attribution, area: string, year: number): number[] {
  const out = Array.from({ length: 12 }, () => 0);
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, '0')}`;
    const w = { fromMs: parseDate(`${month}-01`)!, toMs: parseDate(lastDayOfMonth(month))! + MS_DAY };
    let h = 0;
    for (const r of rows) if (r.area_id === area && r.classification === 'PL') h += attributedHours(r, w, attr);
    out[m - 1] = h;
  }
  return out;
}

export interface PlannedMonth { month: number; used: number | null; allowed: number; overhaul: boolean; over: boolean }
export interface PlannedArea {
  area_id: string;
  allowance: number;
  months: PlannedMonth[];
  /** January to `through` */
  ytdUsed: number;
  ytdAllowed: number;
  through: number;
  overMonths: number;
  /** PL rows of the area from 1 January to the data end of the year (the records behind the figure) */
  rowIds: string[];
}

/**
 * Planned hours used against the allowance, per area with targets for the year, January to the month of the last day with
 * data in that year (`dataEnd`; months after it have no figure). Areas outside `areaIds` are left out.
 */
export function plannedYtd(input: { rows: readonly EventRow[]; targets: readonly AreaTarget[]; year: number; dataEnd: string; areaIds?: readonly string[] }): PlannedArea[] {
  const { year } = input;
  const end = input.dataEnd.slice(0, 10);
  if (!end || Number(end.slice(0, 4)) < year) return [];
  const through = Number(end.slice(0, 4)) > year ? 12 : Number(end.slice(5, 7));
  const wanted = input.targets.filter((tg) => tg.year === year && (!input.areaIds || input.areaIds.includes(tg.area_id)));
  if (!wanted.length) return [];
  const areaSet = new Set(wanted.map((w) => w.area_id));
  const rows = input.rows.filter((r) => areaSet.has(r.area_id) && isAnalysable(r));
  const attr = attributeRows(rows);
  const yearEnd = through === 12 ? `${year}-12-31` : end;
  return wanted.map((tg) => {
    const used = plannedHoursByMonth(rows, attr, tg.area_id, year);
    const months: PlannedMonth[] = used.map((u, i) => {
      const m = i + 1;
      const allowed = tg.monthly_split[i] ?? 0;
      const has = m <= through;
      return { month: m, used: has ? u : null, allowed, overhaul: tg.overhaul_months.includes(m), over: has && u > allowed + 1e-9 };
    });
    const rowIds = rows.filter((r) => r.area_id === tg.area_id && r.classification === 'PL' && r.stop_ts.slice(0, 4) === String(year) && r.stop_ts.slice(0, 10) <= yearEnd)
      .sort((a, b) => (a.stop_ts < b.stop_ts ? -1 : a.stop_ts > b.stop_ts ? 1 : 0)).map((r) => r.event_id);
    return {
      area_id: tg.area_id, allowance: tg.planned_allowance_h_year, months,
      ytdUsed: used.slice(0, through).reduce((s, n) => s + n, 0), ytdAllowed: ytdAllowance(tg.monthly_split, through), through,
      overMonths: months.filter((m) => m.over).length, rowIds,
    };
  });
}

// ---------------------------------------------------------------- availability target per area

/** The availability target of each area that has one for the year (percent). */
export function areaTargetMap(targets: readonly AreaTarget[], year: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const tg of targets) if (tg.year === year && tg.availability_target_pct !== null && Number.isFinite(tg.availability_target_pct)) out.set(tg.area_id, tg.availability_target_pct);
  return out;
}

/** The target an area is judged against: its own for the year, else the plant-wide one (null = none). */
export const targetForArea = (perArea: ReadonlyMap<string, number> | null | undefined, global: number | null, area: string): number | null =>
  perArea?.get(area) ?? global;
