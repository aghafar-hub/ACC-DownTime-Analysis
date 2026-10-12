/** Normalisation rules, identical to docs/wire-protocol.md section 4 (client and server). */
import type { ClassificationCode, Equipment, EquipmentAlias, EventRow, Reason } from '../api/types';

export const CLASSIFICATION_CODES: ClassificationCode[] = ['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'];

/** Upper-case, remove all whitespace, collapse runs of '.' into one. */
export function codeKey(code: string): string {
  return code.toUpperCase().replace(/\s+/g, '').replace(/\.{2,}/g, '.');
}

/** N/A (or NA) means the whole area stopped. */
export function isAreaLevelCode(code: string): boolean {
  const k = codeKey(code);
  return k === 'N/A' || k === 'NA';
}

/** Trim, collapse whitespace to single spaces, lower-case. */
export function matchKey(text: string | undefined | null): string {
  return (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Upper-case a classification; null when it is not one of the six codes. */
export function normalizeClassification(text: string): ClassificationCode | null {
  const up = text.trim().toUpperCase();
  return (CLASSIFICATION_CODES as string[]).includes(up) ? (up as ClassificationCode) : null;
}

// ---- code resolution ----

export interface CodeLookup {
  /** codeKey(alias) -> canonical equipment_id */
  aliasMap: Map<string, string>;
  /** codeKey(equipment_id) -> canonical equipment_id */
  equipmentByKey: Map<string, Equipment>;
}

export function buildCodeLookup(aliases: EquipmentAlias[], equipment: Equipment[]): CodeLookup {
  const aliasMap = new Map<string, string>();
  for (const a of aliases) aliasMap.set(codeKey(a.alias), a.equipment_id);
  const equipmentByKey = new Map<string, Equipment>();
  for (const e of equipment) equipmentByKey.set(codeKey(e.equipment_id), e);
  return { aliasMap, equipmentByKey };
}

export type ResolvedCode =
  | { kind: 'area_level' }
  | { kind: 'equipment'; equipmentId: string; viaAlias: boolean }
  | { kind: 'unknown'; key: string };

/** N/A first, then aliases, then the equipment table. Unknown codes keep their code key. */
export function resolveCode(code: string, lookup: CodeLookup): ResolvedCode {
  const key = codeKey(code);
  if (key === 'N/A' || key === 'NA') return { kind: 'area_level' };
  const aliased = lookup.aliasMap.get(key);
  if (aliased !== undefined) {
    const target = lookup.equipmentByKey.get(codeKey(aliased));
    if (target) return { kind: 'equipment', equipmentId: target.equipment_id, viaAlias: true };
  }
  const direct = lookup.equipmentByKey.get(key);
  if (direct) return { kind: 'equipment', equipmentId: direct.equipment_id, viaAlias: false };
  return { kind: 'unknown', key };
}

/** Resolution of a stored event row: stored flags first, then the master data when supplied. */
export function rowCode(row: Pick<EventRow, 'code_raw' | 'is_area_level' | 'equipment_id'>, lookup?: CodeLookup): ResolvedCode {
  if (row.is_area_level || isAreaLevelCode(row.code_raw)) return { kind: 'area_level' };
  if (row.equipment_id) return { kind: 'equipment', equipmentId: row.equipment_id, viaAlias: false };
  return lookup ? resolveCode(row.code_raw, lookup) : { kind: 'unknown', key: codeKey(row.code_raw) };
}

/** A stable text key for a resolved code. */
export function resolvedKey(rc: ResolvedCode): string {
  return rc.kind === 'area_level' ? 'N/A' : rc.kind === 'equipment' ? rc.equipmentId : rc.key;
}

// ---- reasons ----

/** `${CLASS}|${matchKey}` -> reason with the lowest order_no. */
export type ReasonLookup = Map<string, Reason>;

export function reasonLookupKey(classification: string, text: string): string {
  return `${classification.trim().toUpperCase()}|${matchKey(text)}`;
}

export function buildReasonLookup(reasons: Reason[]): ReasonLookup {
  const m: ReasonLookup = new Map();
  for (const r of reasons) {
    const k = reasonLookupKey(r.classification, r.match_key || r.text_as_listed);
    const cur = m.get(k);
    if (!cur || r.order_no < cur.order_no) m.set(k, r);
  }
  return m;
}

export type ResolvedReason =
  | { status: 'blank' }
  | { status: 'listed'; reasonId: string; reason: Reason }
  | { status: 'unlisted' };

/** Same classification and match key; blank text is its own status. */
export function resolveReason(classification: string, text: string | undefined | null, reasons: ReasonLookup): ResolvedReason {
  if (matchKey(text) === '') return { status: 'blank' };
  const r = reasons.get(reasonLookupKey(classification, text ?? ''));
  return r ? { status: 'listed', reasonId: r.reason_id, reason: r } : { status: 'unlisted' };
}

// ---- fingerprints ----

export interface FingerprintParts {
  area_id: string;
  code: string;
  stop_ts: string;
  start_ts: string;
  occurrence: number;
}

/** Lower-case hex SHA-256 of `${area_id}|${codeKey}|${stop_ts}|${start_ts}|${occurrence}` (WebCrypto). */
export async function fingerprint(p: FingerprintParts): Promise<string> {
  const text = `${p.area_id}|${codeKey(p.code)}|${p.stop_ts}|${p.start_ts}|${p.occurrence}`;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function eventIdFromFingerprint(fp: string): string {
  return 'EV-' + fp.slice(0, 16);
}

export type KeyedRow = { area_id: string; code_raw: string; stop_ts: string; start_ts: string };

/** Occurrence number (1, 2, ...) of each row among rows with the same key, in file order. */
export function assignOccurrences(rows: KeyedRow[]): number[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = `${r.area_id}|${codeKey(r.code_raw)}|${r.stop_ts}|${r.start_ts}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n;
  });
}
