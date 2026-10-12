// Normalisation rules shared by the mock backend and the screens
// (docs/wire-protocol.md section 4). The real server applies the same rules.
import type { Area, Equipment, EquipmentAlias, EquipmentArea, EventRow, Reason } from '../api/types';
import { sha256Hex } from './sha256';

/** Upper-case, remove all whitespace, collapse runs of '.' into one '.'. */
export function codeKey(code: string | undefined | null): string {
  return String(code ?? '').toUpperCase().replace(/\s+/g, '').replace(/\.{2,}/g, '.');
}

/** Trim, collapse whitespace to single spaces, lower-case. */
export function matchKey(text: string | undefined | null): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isAreaLevelCode(code: string | undefined | null): boolean {
  const k = codeKey(code);
  return k === 'N/A' || k === 'NA';
}

const TS_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses 'YYYY-MM-DD HH:MM:SS.mmm' as plant-local time; no time-zone conversion. */
export function parseTs(ts: string): number | null {
  const m = TS_RE.exec(String(ts ?? '').trim());
  if (!m) return null;
  const ms = m[7] ? Number(m[7].padEnd(3, '0')) : 0;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
  const d = new Date(t);
  // reject impossible dates such as 2026-02-31
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  if (+m[4] > 23 || +m[5] > 59 || +m[6] > 59) return null;
  return t;
}

export function isValidDate(d: string): boolean {
  if (!DATE_RE.test(String(d ?? ''))) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

/** start - stop in seconds (rounded to milliseconds), or null when unreadable. */
export function durationSeconds(stopTs: string, startTs: string): number | null {
  const a = parseTs(stopTs);
  const b = parseTs(startTs);
  if (a === null || b === null) return null;
  return Math.round(b - a) / 1000;
}

export function fingerprintOf(areaId: string, code: string, stopTs: string, startTs: string, occurrence = 1): string {
  return sha256Hex(`${areaId}|${codeKey(code)}|${stopTs}|${startTs}|${occurrence}`);
}
export function eventIdOf(fingerprint: string): string {
  return 'EV-' + fingerprint.slice(0, 16);
}

/** Flags the server recomputes every time a row is written or edited. */
export const RECOMPUTED_FLAGS = ['unknown_code', 'code_not_in_area', 'unlisted_reason', 'blank_reason', 'end_before_start', 'placeholder_code'] as const;
export const PLACEHOLDER_CODES = ['AFR', 'AFR2'];

export interface MasterLookup {
  equipment: Map<string, Equipment>;
  equipmentAreas: Map<string, Set<string>>;
  aliases: Map<string, string>;
  reasons: Reason[];
  areas: Map<string, Area>;
}

export function buildLookup(m: {
  equipment: Equipment[]; equipment_areas: EquipmentArea[]; aliases: EquipmentAlias[]; reasons: Reason[]; areas: Area[];
}): MasterLookup {
  const equipmentAreas = new Map<string, Set<string>>();
  for (const ea of m.equipment_areas) {
    if (!equipmentAreas.has(ea.equipment_id)) equipmentAreas.set(ea.equipment_id, new Set());
    equipmentAreas.get(ea.equipment_id)!.add(ea.area_id);
  }
  return {
    equipment: new Map(m.equipment.map((e) => [e.equipment_id, e])),
    equipmentAreas,
    aliases: new Map(m.aliases.map((a) => [codeKey(a.alias), a.equipment_id])),
    reasons: [...m.reasons].sort((a, b) => a.order_no - b.order_no),
    areas: new Map(m.areas.map((a) => [a.area_id, a])),
  };
}

export interface Resolved {
  equipment_id?: string;
  is_area_level: boolean;
  reason_id?: string;
  flags: string[];
}

/** Resolves the equipment, reason and data-quality flags of a row. */
export function resolveRow(
  look: MasterLookup,
  row: { area_id: string; code_raw: string; classification: string; reason_raw?: string; stop_ts: string; start_ts: string },
): Resolved {
  const flags: string[] = [];
  const key = codeKey(row.code_raw);
  const areaLevel = isAreaLevelCode(row.code_raw);
  let equipmentId: string | undefined;
  if (!areaLevel) {
    const viaAlias = look.aliases.get(key);
    const candidate = viaAlias ?? key;
    if (look.equipment.has(candidate)) equipmentId = candidate;
    if (!equipmentId) flags.push('unknown_code');
    else if (!look.equipmentAreas.get(equipmentId)?.has(row.area_id)) flags.push('code_not_in_area');
    if (PLACEHOLDER_CODES.includes(key)) flags.push('placeholder_code');
  }
  let reasonId: string | undefined;
  const rk = matchKey(row.reason_raw);
  if (!rk) flags.push('blank_reason');
  else {
    const hit = look.reasons.find((r) => r.classification === row.classification && r.match_key === rk);
    if (hit) reasonId = hit.reason_id;
    else flags.push('unlisted_reason');
  }
  const d = durationSeconds(row.stop_ts, row.start_ts);
  if (d !== null && d < 0) flags.push('end_before_start');
  return { equipment_id: equipmentId, is_area_level: areaLevel, reason_id: reasonId, flags };
}

/** Merges recomputed flags into the existing ones, keeping upload-time flags. */
export function mergeFlags(existing: string | undefined, recomputed: string[]): string {
  const kept = String(existing ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f && !(RECOMPUTED_FLAGS as readonly string[]).includes(f));
  return [...new Set([...recomputed, ...kept])].join(',');
}

export function flagList(row: Pick<EventRow, 'flags'>): string[] {
  return String(row.flags ?? '').split(',').map((f) => f.trim()).filter(Boolean);
}
