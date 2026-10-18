// The catalogue of data problems a stored event can carry (events.flags, comma separated).
// Import never drops a row: a row with a problem is stored with its flags and appears on the
// Validate page, where an authorised user fixes it.
//
//  - BLOCKING problems make the record impossible to analyse correctly (no classification,
//    an area the master does not know, a stop that ends before it starts). Such records are
//    stored and shown, but left out of every calculation until they are fixed.
//  - WARNING problems are analysed as they are, and shown on the Validate page for review.
//  - INFORMATION flags are stored (the backend still writes them) but are NOT problems: nothing to fix, never
//    listed on Validate, never counted in the badge, the banner or the "data issues" filters. They only
//    explain a record (e.g. code_not_in_area: the cause sits in another area, which is a normal case).
import type { EventRow } from '../api/types';
import { parseTs } from './time';

export const BLOCKING_FLAGS = ['missing_classification', 'invalid_classification', 'unknown_area', 'end_before_start'] as const;
export const WARNING_FLAGS = [
  'missing_code', 'unknown_code', 'placeholder', 'unlisted_reason', 'blank_reason', 'line_mismatch',
] as const;
/** Stored like the others, but explain a record instead of reporting a problem. */
export const INFO_FLAGS = ['code_not_in_area'] as const;
/**
 * Worked out by the browser, never stored:
 *  - overlap_in_area (overlaps.ts): INFORMATION. Overlapping stops of one area are counted once (attribution.ts), so
 *    there is nothing to fix; Validate shows them apart, as information.
 *  - failure_flag_mismatch: WARNING. Failure = YES on a PL or CIR row, or on a continuation (Freq = 0) row. Such a row
 *    is never a failure event (events.ts isFailureHead); a person may keep it as entered.
 *  - unreadable_time: BLOCKING. The stop or restart time cannot be read as a date and time (for example typed by hand
 *    into the Sheet as 1/2/2026 08:00, or with a year far off). Marked when the records are loaded (markUnreadableTimes)
 *    so such a record is listed on Validate and left out of every number, never a freeze or a crash.
 */
export const DERIVED_FLAGS = ['overlap_in_area', 'failure_flag_mismatch', 'unreadable_time'] as const;
/** Derived flags that keep the record out of the numbers. */
export const DERIVED_BLOCKING_FLAGS = ['unreadable_time'] as const;
/** Derived flags that are information only (nothing to fix). */
export const DERIVED_INFO_FLAGS = ['overlap_in_area'] as const;

/** P2: Failure says YES on a planned/CIR (PL, CIR) or continuation (Freq = 0) row. */
export function hasFailureFlagMismatch(e: Pick<EventRow, 'is_failure' | 'classification' | 'freq'>): boolean {
  return e.is_failure === true && (e.classification === 'PL' || e.classification === 'CIR' || e.freq === 0);
}

export type BlockingFlag = (typeof BLOCKING_FLAGS)[number];
export type WarningFlag = (typeof WARNING_FLAGS)[number];
export type InfoFlag = (typeof INFO_FLAGS)[number];
export type DerivedFlag = (typeof DERIVED_FLAGS)[number];
export type EventFlag = BlockingFlag | WarningFlag | InfoFlag | DerivedFlag;

export interface FlagInfo {
  flag: EventFlag;
  blocking: boolean;
  /** information only: nothing to fix, not a problem */
  info?: boolean;
  /** short label for chips */
  label: string;
  /** what is wrong, in plain words */
  problem: string;
  /** what to do about it */
  fix: string;
}

export const FLAG_INFO: Record<EventFlag, FlagInfo> = {
  unreadable_time: {
    flag: 'unreadable_time', blocking: true, label: 'Unreadable time',
    problem: 'The stop or restart time cannot be read as a date and time (YYYY-MM-DD HH:MM:SS), or its year is not plausible.',
    fix: 'Correct the stop and restart time. Until then the record is left out of the numbers.',
  },
  missing_classification: {
    flag: 'missing_classification', blocking: true, label: 'No classification',
    problem: 'The classification (PRO, MEC, ELE, AUT, PL or CIR) is empty.',
    fix: 'Choose the classification. Until then the record is left out of the numbers.',
  },
  invalid_classification: {
    flag: 'invalid_classification', blocking: true, label: 'Unknown classification',
    problem: 'The classification is not one of PRO, MEC, ELE, AUT, PL or CIR.',
    fix: 'Choose the right classification. Until then the record is left out of the numbers.',
  },
  unknown_area: {
    flag: 'unknown_area', blocking: true, label: 'Unknown area',
    problem: 'The area (EQUIPMENT column) is not in the list of areas.',
    fix: 'Choose the right area, or add the area in Master Data. Until then the record is left out of the numbers.',
  },
  end_before_start: {
    flag: 'end_before_start', blocking: true, label: 'Restart before stop',
    problem: 'The restart time is earlier than the stop time.',
    fix: 'Correct the stop or restart time. Until then the record is left out of the numbers.',
  },
  missing_code: {
    flag: 'missing_code', blocking: false, label: 'No equipment code',
    problem: 'The equipment code is empty.',
    fix: 'Choose the equipment, or write N/A when the whole area stopped.',
  },
  unknown_code: {
    flag: 'unknown_code', blocking: false, label: 'Unknown code',
    problem: 'The equipment code is not in Master Data.',
    fix: 'Correct the code, or add it (or an alias) in Master Data and re-check the records.',
  },
  placeholder: {
    flag: 'placeholder', blocking: false, label: 'Placeholder code',
    problem: 'The code is a placeholder (such as AFR or AFR 2), not a real equipment code.',
    fix: 'Choose the real equipment code, or N/A when the whole area stopped.',
  },
  unlisted_reason: {
    flag: 'unlisted_reason', blocking: false, label: 'Reason not listed',
    problem: 'The reason is not in the list for this classification.',
    fix: 'Choose a listed reason, or add the reason in Master Data and re-check the records.',
  },
  blank_reason: {
    flag: 'blank_reason', blocking: false, label: 'No reason',
    problem: 'The reason is empty.',
    fix: 'Choose the reason.',
  },
  code_not_in_area: {
    flag: 'code_not_in_area', blocking: false, info: true, label: 'Cause in another area',
    problem: 'The equipment code is listed in Master Data under other areas, not under the area that stopped. This is normal: one area stops because of equipment that belongs to another area.',
    fix: 'Nothing to fix. The stop counts as stopped by another area.',
  },
  line_mismatch: {
    flag: 'line_mismatch', blocking: false, label: 'Line does not match area',
    problem: 'The line in the sheet differs from the line of the area.',
    fix: 'Correct the line (the area decides which line a record belongs to).',
  },
  overlap_in_area: {
    flag: 'overlap_in_area', blocking: false, info: true, label: 'Overlaps another stop',
    problem: 'Another record in the same area covers part of the same time. The shared time is counted once: planned (PL) before incidental before CIR; between records of the same kind, the one that started first.',
    fix: 'Nothing to fix. Correct the times only if one of the records is a mistake.',
  },
  failure_flag_mismatch: {
    flag: 'failure_flag_mismatch', blocking: false, label: 'Failure flag mismatch',
    problem: 'Failure says YES on a planned/CIR or continuation row. Only the first row (Freq = 1) of an incidental stop can be a failure, so this row is not counted as one.',
    fix: 'Set Failure to NO, or correct the classification or Freq. Keep it as entered if it is right; it still does not count as a failure.',
  },
};

const BLOCKING = new Set<string>([...BLOCKING_FLAGS, ...DERIVED_BLOCKING_FLAGS]);
const INFO = new Set<string>([...INFO_FLAGS, ...DERIVED_INFO_FLAGS]);

/** True for a flag that only explains a record (nothing to fix): code_not_in_area and the derived overlap_in_area. */
export const isInfoFlag = (flag: string): boolean => INFO.has(flag);

/** The flags of an event as a list (an empty list when there are none). */
export function splitFlags(flags: string | undefined | null): string[] {
  return String(flags ?? '').split(',').map((f) => f.trim()).filter(Boolean);
}

export const isBlockingFlag = (flag: string): boolean => BLOCKING.has(flag);

/** True when the record has a problem that keeps it out of the calculations until fixed. */
export function isBlocked(e: Pick<EventRow, 'flags'>): boolean {
  return splitFlags(e.flags).some(isBlockingFlag);
}

export const blockingFlagsOf = (e: Pick<EventRow, 'flags'>): string[] => splitFlags(e.flags).filter(isBlockingFlag);

/** Plain-English label for any flag, also for flags this version does not know. */
export const flagLabel = (flag: string): string => (FLAG_INFO as Record<string, FlagInfo | undefined>)[flag]?.label ?? flag;

/** The flags of a record that are information only (e.g. code_not_in_area). */
export const infoFlagsOf = (e: Pick<EventRow, 'flags'>): string[] => splitFlags(e.flags).filter(isInfoFlag);

/** The flags of a record that are real problems to fix or review: everything stored except information flags. */
export const problemFlagsOf = (e: Pick<EventRow, 'flags'>): string[] => splitFlags(e.flags).filter((f) => !isInfoFlag(f));

/** True when the record carries at least one real problem (information flags do not count). */
export const hasProblemFlags = (e: Pick<EventRow, 'flags'>): boolean => problemFlagsOf(e).length > 0;

// ---------------------------------------------------------------- kept as entered (accepted flags)
//
// A person with Edit access can say "keep this record exactly as entered" for flagged records (Validate page). The record
// does not change; `events.accepted_flags` lists the flags that were acknowledged (who, when and why are stored too).
//  - An accepted WARNING flag is fully resolved: the record is normal everywhere (it was counted before and still is).
//  - An accepted BLOCKING flag stops being something to fix (it leaves the Validate list, the badge, the banner and the
//    notifications) but the record still cannot be calculated, so it STAYS out of the numbers: isBlocked() keeps reading the
//    STORED flags on purpose.

/** Every flag name of the catalogue, in display order (blocking, warning, information, derived). */
export const KNOWN_FLAGS: readonly string[] = [...BLOCKING_FLAGS, ...WARNING_FLAGS, ...INFO_FLAGS, ...DERIVED_FLAGS];
export const isKnownFlag = (flag: string): boolean => KNOWN_FLAGS.includes(flag);

/** A list of flag names without repeats or blanks, in catalogue order (names this version does not know come last). */
export function canonicalFlags(list: Iterable<string>): string[] {
  const rank = (f: string): number => {
    const i = KNOWN_FLAGS.indexOf(f);
    return i < 0 ? KNOWN_FLAGS.length : i;
  };
  return [...new Set([...list].map((f) => f.trim()).filter(Boolean))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** The flags the record is kept with (events.accepted_flags), in catalogue order. */
export function acceptedFlagsOf(e: Pick<EventRow, 'accepted_flags'>): string[] {
  return canonicalFlags(splitFlags(e.accepted_flags));
}

/** The stored problem flags that nobody has kept as entered. Information flags are never problems. The derived overlap is not stored, see validate/model.ts. */
export function openFlagsOf(e: Pick<EventRow, 'flags' | 'accepted_flags'>): string[] {
  const kept = new Set(acceptedFlagsOf(e));
  return problemFlagsOf(e).filter((f) => !kept.has(f));
}

/** True when the record has a stored problem that is still to be dealt with. */
export const hasOpenProblemFlags = (e: Pick<EventRow, 'flags' | 'accepted_flags'>): boolean => openFlagsOf(e).length > 0;

/** The blocking problems still to be fixed (blocking flags kept as entered are not in here). */
export const openBlockingFlagsOf = (e: Pick<EventRow, 'flags' | 'accepted_flags'>): string[] => openFlagsOf(e).filter(isBlockingFlag);

/** Blocked by a problem nobody has accepted: still to be fixed. */
export const isOpenBlocked = (e: Pick<EventRow, 'flags' | 'accepted_flags'>): boolean => openBlockingFlagsOf(e).length > 0;

/** Blocked, and every blocking problem was kept as entered: nothing to fix, but still left out of the numbers. */
export const isKeptLeftOut = (e: Pick<EventRow, 'flags' | 'accepted_flags'>): boolean => isBlocked(e) && !isOpenBlocked(e);

/** What is left of the accepted flags after the stored flags changed: accepted ones the record no longer carries are dropped (the derived overlap stays until undone). */
export function pruneAcceptedFlags(accepted: string | undefined | null, storedFlags: string | undefined | null): string[] {
  const have = new Set(splitFlags(storedFlags));
  return canonicalFlags(splitFlags(accepted)).filter((f) => (DERIVED_FLAGS as readonly string[]).includes(f) || have.has(f));
}

/** A stop or restart time the app can work with: a readable date and time with a year from 2000 to `maxYear` (2100). */
export function readableTime(text: string | null | undefined, maxYear = 2100): boolean {
  if (!text) return false;
  const ms = parseTs(text);
  if (ms === null) return false;
  const y = Number(text.slice(0, 4));
  return y >= 2000 && y <= maxYear;
}

/**
 * Adds the derived blocking flag unreadable_time to a record whose stop or restart time cannot be read (the Sheet can
 * be edited by hand, after the upload checks). `maxYear`: the latest plausible year (the caller passes next year, so a
 * typo such as 2062 is caught). The same object when nothing is wrong.
 */
export function markUnreadableTime<T extends Pick<EventRow, 'stop_ts' | 'start_ts' | 'flags'>>(e: T, maxYear = 2100): T {
  const bad = !readableTime(e.stop_ts, maxYear) || !readableTime(e.start_ts, maxYear);
  const has = splitFlags(e.flags).includes('unreadable_time');
  if (bad === has) return e;
  const rest = splitFlags(e.flags).filter((f) => f !== 'unreadable_time');
  return { ...e, flags: (bad ? [...rest, 'unreadable_time'] : rest).join(',') };
}

/** markUnreadableTime over a list; the same list when no record changes. */
export function markUnreadableTimes<T extends Pick<EventRow, 'stop_ts' | 'start_ts' | 'flags'>>(rows: T[], maxYear = 2100): T[] {
  let changed = false;
  const out = rows.map((e) => {
    const m = markUnreadableTime(e, maxYear);
    if (m !== e) changed = true;
    return m;
  });
  return changed ? out : rows;
}

