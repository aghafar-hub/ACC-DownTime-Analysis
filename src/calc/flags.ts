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

export const BLOCKING_FLAGS = ['missing_classification', 'invalid_classification', 'unknown_area', 'end_before_start'] as const;
export const WARNING_FLAGS = [
  'missing_code', 'unknown_code', 'placeholder', 'unlisted_reason', 'blank_reason', 'line_mismatch',
] as const;
/** Stored like the others, but explain a record instead of reporting a problem. */
export const INFO_FLAGS = ['code_not_in_area'] as const;
/** Found by comparing events with each other (never stored): see overlaps.ts */
export const DERIVED_FLAGS = ['overlap_in_area'] as const;

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
    flag: 'overlap_in_area', blocking: false, label: 'Overlaps another stop',
    problem: 'Another record in the same area covers part of the same time, so hours are counted twice.',
    fix: 'Check the two records; correct the times of one, or void a duplicate.',
  },
};

const BLOCKING = new Set<string>(BLOCKING_FLAGS);
const INFO = new Set<string>(INFO_FLAGS);

/** True for a flag that only explains a record (nothing to fix). */
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
