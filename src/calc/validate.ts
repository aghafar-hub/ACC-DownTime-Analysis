// The data checks of a stored event, worked out from the row and the master data.
// This is the SAME rule as the server's (docs/wire-protocol.md section 4a); the mock API, the upload review and
// the Validate page use it, and a contract test runs it against the real backend. Order of the result is fixed.
import type { Area } from '../api/types';
import { areasOf, type MasterIndex } from './masters';
import { codeKey, isAreaLevelCode, matchKey, resolveCode, CLASSIFICATION_CODES } from './normalize';
import { durationSeconds } from './time';

/** Placeholder codes, as the server sees them (code key). */
export const PLACEHOLDER_CODE_KEYS = ['AFR', 'AFR2'];

export interface CheckableRow {
  area_id: string;
  line_id: string;
  code_raw: string;
  classification: string;
  reason_raw?: string | null;
  stop_ts: string;
  start_ts: string;
}

/** The master area for an id written in any letter case (the server matches case-insensitively), or undefined. */
export function findArea(index: Pick<MasterIndex, 'areaById'>, id: string): Area | undefined {
  const t = (id ?? '').trim();
  const exact = index.areaById.get(t);
  if (exact) return exact;
  const low = t.toLowerCase();
  for (const a of index.areaById.values()) if (a.area_id.toLowerCase() === low) return a;
  return undefined;
}

/**
 * Flags of a row, blocking ones first: missing_classification | invalid_classification, unknown_area, end_before_start,
 * missing_code | unknown_code, placeholder, blank_reason | unlisted_reason, code_not_in_area, line_mismatch.
 */
export function computeEventFlags(row: CheckableRow, index: MasterIndex): string[] {
  const flags: string[] = [];
  const cls = (row.classification ?? '').trim().toUpperCase();
  if (!cls) flags.push('missing_classification');
  else if (!(CLASSIFICATION_CODES as string[]).includes(cls)) flags.push('invalid_classification');
  const area = findArea(index, row.area_id);
  if (!area) flags.push('unknown_area');
  const dur = durationSeconds(row.stop_ts, row.start_ts);
  if (dur !== null && dur < 0) flags.push('end_before_start');
  const key = codeKey(row.code_raw ?? '');
  const areaLevel = isAreaLevelCode(row.code_raw ?? '');
  const rc = key && !areaLevel ? resolveCode(row.code_raw, index) : null;
  if (!key) flags.push('missing_code');
  else if (rc && rc.kind === 'unknown') flags.push('unknown_code');
  if (PLACEHOLDER_CODE_KEYS.includes(key)) flags.push('placeholder');
  if (!matchKey(row.reason_raw)) flags.push('blank_reason');
  else if ((CLASSIFICATION_CODES as string[]).includes(cls) && !index.reasons.has(`${cls}|${matchKey(row.reason_raw)}`)) flags.push('unlisted_reason');
  if (area && rc && rc.kind === 'equipment') {
    const areas = areasOf(index, rc.equipmentId);
    if (areas.size > 0 && !areas.has(area.area_id)) flags.push('code_not_in_area');
  }
  if (area && (row.line_id ?? '').trim() !== area.line_id) flags.push('line_mismatch');
  return flags;
}

export interface DerivedFields {
  /** canonical equipment code when the code resolves (alias or direct); undefined for N/A, blank and unknown codes */
  equipment_id?: string;
  /** the code is N/A: the whole area stopped */
  is_area_level: boolean;
  /** listed reason, when the classification is valid and the reason text matches */
  reason_id?: string;
  flags: string[];
}

/** Everything the server derives from a row and the master data: resolved equipment and reason, N/A, and the flags. */
export function deriveEventFields(row: CheckableRow, index: MasterIndex): DerivedFields {
  const key = codeKey(row.code_raw ?? '');
  const isAreaLevel = isAreaLevelCode(row.code_raw ?? '');
  const rc = key && !isAreaLevel ? resolveCode(row.code_raw, index) : null;
  const cls = (row.classification ?? '').trim().toUpperCase();
  const reasonKey = matchKey(row.reason_raw);
  const reason = reasonKey && (CLASSIFICATION_CODES as string[]).includes(cls) ? index.reasons.get(`${cls}|${reasonKey}`) : undefined;
  return {
    equipment_id: rc && rc.kind === 'equipment' ? rc.equipmentId : undefined,
    is_area_level: isAreaLevel,
    reason_id: reason?.reason_id,
    flags: computeEventFlags(row, index),
  };
}
