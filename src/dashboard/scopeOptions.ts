// What the scope bar offers and how its choices depend on each other: the areas of the chosen lines, the equipment of
// the chosen areas (with the codes that stopped those areas from another area's equipment, "cross-area" causes), the
// type groups (Incidental / Planned / Other) over the classifications, pruning of choices that fell out of scope, and
// the short texts on the chips. Pure: no React, no storage. Nothing here changes how a number is calculated.
import type { Area, ClassificationCode, EventRow, Startup } from '../api/types';
import { buildIndex, rowCode, type DateRange, type MasterIndex } from '../calc';
import { t } from '../i18n/t';
import { monthText, rangeText } from '../util/dates';
import { areasInScope, PRESET_LABELS, type CompareMode, type DashFilters } from './filters';

export interface ScopeOption { value: string; label: string; hint?: string; crossArea?: boolean }

type AreaLike = Pick<Area, 'area_id' | 'line_id' | 'active' | 'in_downtime_sheet' | 'sort_order' | 'name'>;

/** The areas the Area menu lists: active downtime areas of the chosen lines (all lines when none). */
export function areaOptions(areas: readonly AreaLike[], f: Pick<DashFilters, 'lineIds'>): ScopeOption[] {
  return areas
    .filter((a) => a.active && a.in_downtime_sheet && (f.lineIds.length === 0 || f.lineIds.includes(a.line_id)))
    .sort((a, b) => a.sort_order - b.sort_order || (a.area_id < b.area_id ? -1 : 1))
    .map((a) => ({ value: a.area_id, label: a.area_id, hint: a.name }));
}

const indexCache = new WeakMap<Startup, MasterIndex>();
function indexOf(startup: Startup): MasterIndex {
  let ix = indexCache.get(startup);
  if (!ix) {
    ix = buildIndex(startup);
    indexCache.set(startup, ix);
  }
  return ix;
}

/**
 * The equipment the Equipment menu lists for the chosen lines and areas: the active codes that belong to an area in
 * scope, plus every code that stopped an area in scope while it belongs to another area (cross-area cause codes,
 * read from the loaded records). With no line or area chosen: every active code, plus any cause code in the records.
 */
export function equipmentOptions(startup: Startup, rows: readonly EventRow[], f: Pick<DashFilters, 'lineIds' | 'areaIds'>): ScopeOption[] {
  const allowed = new Set(areasInScope(startup.areas, f as DashFilters));
  const narrowed = f.lineIds.length > 0 || f.areaIds.length > 0;
  const own = new Set(startup.equipment_areas.filter((ea) => allowed.has(ea.area_id)).map((ea) => ea.equipment_id));
  const byId = new Map(startup.equipment.map((e) => [e.equipment_id, e]));
  const homeOf = new Map<string, string[]>();
  for (const ea of startup.equipment_areas) homeOf.set(ea.equipment_id, [...(homeOf.get(ea.equipment_id) ?? []), ea.area_id]);
  const out = new Map<string, ScopeOption>();
  for (const e of startup.equipment) {
    if (e.status !== 'Active') continue;
    if (narrowed && !own.has(e.equipment_id)) continue;
    const home = homeOf.get(e.equipment_id) ?? [];
    out.set(e.equipment_id, { value: e.equipment_id, label: e.equipment_id, hint: [e.description, home.join(', ')].filter(Boolean).join(' · ') });
  }
  if (rows.length) {
    const ix = indexOf(startup);
    for (const r of rows) {
      if (r.is_void || !allowed.has(r.area_id)) continue;
      const rc = rowCode(r, ix);
      if (rc.kind !== 'equipment' || out.has(rc.equipmentId)) continue;
      const eq = byId.get(rc.equipmentId);
      const home = homeOf.get(rc.equipmentId) ?? [];
      const cross = narrowed && !home.some((a) => allowed.has(a));
      out.set(rc.equipmentId, {
        value: rc.equipmentId, label: rc.equipmentId, crossArea: cross,
        hint: [eq?.description, home.length ? home.join(', ') : '', cross ? t('stops {a} (cross-area)', { a: r.area_id }) : ''].filter(Boolean).join(' · '),
      });
    }
  }
  return [...out.values()].sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

/**
 * The filters after a line or area change: areas outside the chosen lines and equipment that no longer belongs to (or
 * stopped) an area in scope are taken out, so the bar never keeps a hidden choice that matches nothing.
 */
export function pruneScope(next: DashFilters, startup: Startup | null, rows: readonly EventRow[]): DashFilters {
  if (!startup) return next;
  const areaIds = next.lineIds.length
    ? next.areaIds.filter((a) => startup.areas.some((x) => x.area_id === a && next.lineIds.includes(x.line_id)))
    : next.areaIds;
  const scoped = { ...next, areaIds };
  if (!scoped.equipmentIds.length) return scoped;
  const allowed = new Set(equipmentOptions(startup, rows, scoped).map((o) => o.value));
  const equipmentIds = scoped.equipmentIds.filter((e) => allowed.has(e));
  return equipmentIds.length === scoped.equipmentIds.length ? scoped : { ...scoped, equipmentIds };
}

// ---------------------------------------------------------------- type groups

export type TypeGroup = 'incidental' | 'planned' | 'other';
export const TYPE_GROUPS: TypeGroup[] = ['incidental', 'planned', 'other'];
export const TYPE_GROUP_LABEL: Record<TypeGroup, string> = { incidental: 'Incidental', planned: 'Planned', other: 'Other' };
export const TYPE_GROUP_CODE: Record<TypeGroup, string> = { incidental: 'INC', planned: 'PL', other: 'CIR' };
export const TYPE_GROUP_BLURB: Record<TypeGroup, string> = {
  incidental: 'Unplanned stops: breakdowns, trips, blockages',
  planned: 'Scheduled maintenance, inspections, shutdowns',
  other: 'Outside causes: power, market, raw material',
};

/** The classifications of each type: Incidental = the incident classes (PRO, MEC, ELE, AUT), Planned = PL, Other = CIR. */
export function typeGroups(classes: readonly { code: ClassificationCode; is_incident?: boolean }[]): Record<TypeGroup, ClassificationCode[]> {
  const codes = classes.length ? classes.map((c) => c.code) : (['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'] as ClassificationCode[]);
  return {
    incidental: codes.filter((c) => c !== 'PL' && c !== 'CIR'),
    planned: codes.filter((c) => c === 'PL'),
    other: codes.filter((c) => c === 'CIR'),
  };
}

/** Which type groups are fully chosen by the classification filter. */
export function chosenGroups(cls: readonly ClassificationCode[], groups: Record<TypeGroup, ClassificationCode[]>): TypeGroup[] {
  return TYPE_GROUPS.filter((g) => groups[g].length > 0 && groups[g].every((c) => cls.includes(c)));
}

/** Toggle one type group in the classification filter. */
export function toggleGroup(cls: readonly ClassificationCode[], group: TypeGroup, groups: Record<TypeGroup, ClassificationCode[]>): ClassificationCode[] {
  const on = groups[group].every((c) => cls.includes(c));
  return on ? cls.filter((c) => !groups[group].includes(c)) : [...new Set([...cls, ...groups[group]])];
}

/** Narrowing filters behind the Type chip other than the classifications (criticality, failures, duration, reason, equipment type). */
export function typeExtras(f: DashFilters): number {
  return (f.criticality.length ? 1 : 0) + (f.failureOnly ? 1 : 0) + (f.durationBand ? 1 : 0) + (f.reasonKeys.length ? 1 : 0) + (f.equipmentTypes.length ? 1 : 0);
}

/** The Type chip's value: 'All', 'Incidental', 'Planned + Other', 'MEC, ELE', 'Failures only' ... with '+N' for the extra filters. */
export function typeSummary(f: DashFilters, groups: Record<TypeGroup, ClassificationCode[]>): string {
  let base = '';
  if (f.classifications.length) {
    const full = chosenGroups(f.classifications, groups);
    const covered = new Set(full.flatMap((g) => groups[g]));
    const rest = f.classifications.filter((c) => !covered.has(c));
    base = [...full.map((g) => t(TYPE_GROUP_LABEL[g])), ...rest].join(full.length && !rest.length ? ' + ' : ', ');
  }
  const extras = typeExtras(f);
  if (!base) {
    if (extras === 0) return t('All');
    if (extras === 1 && f.failureOnly) return t('Failures only');
    return t('{n} filters', { n: extras });
  }
  return extras ? `${base} +${extras}` : base;
}

// ---------------------------------------------------------------- chip texts

/** The Period chip: 'Aug 2026' for a month, '2026' for a year, '14 Jul – 11 Oct 2026' for a custom range, else the preset. */
export function periodText(f: DashFilters, range: DateRange | null): string {
  switch (f.preset) {
    case 'month':
    case 'prevmonth':
    case 'thismonth':
      return range ? monthText(range.from) : t(PRESET_LABELS[f.preset]);
    case 'year':
      return range ? range.from.slice(0, 4) : t(PRESET_LABELS.year);
    case 'custom':
      return range ? rangeText(range) : t(PRESET_LABELS.custom);
    default:
      return t(PRESET_LABELS[f.preset]);
  }
}

/** True when a range is exactly one calendar month. */
function isWholeMonth(r: DateRange): boolean {
  if (!r.from.endsWith('-01') || r.from.slice(0, 7) !== r.to.slice(0, 7)) return false;
  const [y, m] = r.to.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate() === Number(r.to.slice(8, 10));
}

/** The Compare chip: 'Jul 2026' when the comparison is one month, else 'Previous 90 days' or 'Same period 2025' (the dates are in its panel). */
export function compareText(mode: CompareMode, compareRange: DateRange | null): string {
  if (mode === 'none') return t('None');
  if (compareRange && isWholeMonth(compareRange)) return monthText(compareRange.from);
  if (mode === 'same_period_last_year') return compareRange ? t('Same period {y}', { y: compareRange.to.slice(0, 4) }) : t('Same period last year');
  if (compareRange) {
    const n = Math.round((Date.parse(compareRange.to) - Date.parse(compareRange.from)) / 86_400_000) + 1;
    return t('Previous {n} days', { n });
  }
  return t('Previous period');
}

// ---------------------------------------------------------------- data status

/** The covered stretches of the data: the coverage with the not-uploaded months cut out ('1 Jan – 31 Aug 2026 and 1–12 Oct 2026'). */
export function coverageSegments(coverage: DateRange | null, notUploaded: readonly string[]): DateRange[] {
  if (!coverage) return [];
  const gaps = [...new Set(notUploaded)].sort();
  const out: DateRange[] = [];
  let from = coverage.from;
  for (const m of gaps) {
    const start = `${m}-01`;
    const [y, mm] = m.split('-').map(Number);
    const end = new Date(Date.UTC(y!, mm!, 0)).toISOString().slice(0, 10);
    if (end < from || start > coverage.to) continue;
    if (start > from) out.push({ from, to: prevDay(start) });
    from = nextDay(end);
  }
  if (from <= coverage.to) out.push({ from, to: coverage.to });
  return out;
}

const shift = (d: string, days: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const prevDay = (d: string): string => shift(d, -1);
const nextDay = (d: string): string => shift(d, 1);

/** '1 Jan – 31 Aug 2026 and 1–12 Oct 2026' */
export function coverageText(segments: readonly DateRange[]): string {
  if (!segments.length) return '';
  const parts = segments.map(rangeText);
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} ${t('and')} ${parts[parts.length - 1]}`;
}

