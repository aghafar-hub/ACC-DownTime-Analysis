import { describe, expect, it } from 'vitest';
import {
  acceptedFlagsOf, BLOCKING_FLAGS, canonicalFlags, DERIVED_FLAGS, FLAG_INFO, hasOpenProblemFlags, hasProblemFlags, infoFlagsOf, INFO_FLAGS, isBlocked,
  isBlockingFlag, isInfoFlag, isKeptLeftOut, isKnownFlag, isOpenBlocked, KNOWN_FLAGS, openBlockingFlagsOf, openFlagsOf, problemFlagsOf,
  pruneAcceptedFlags, splitFlags, WARNING_FLAGS,
} from './flags';
import { blockedSummary } from './filters';
import { isAnalysable } from './events';

describe('kept as entered (accepted flags)', () => {
  it('knows every flag of the catalogue, once, in display order', () => {
    expect(KNOWN_FLAGS).toEqual([...BLOCKING_FLAGS, ...WARNING_FLAGS, ...INFO_FLAGS, ...DERIVED_FLAGS]);
    expect(new Set(KNOWN_FLAGS).size).toBe(KNOWN_FLAGS.length);
    expect(KNOWN_FLAGS.every(isKnownFlag)).toBe(true);
    expect(isKnownFlag('made_up')).toBe(false);
  });
  it('canonicalFlags trims, drops blanks and repeats, and sorts in catalogue order', () => {
    expect(canonicalFlags(['blank_reason', ' unknown_code', '', 'unknown_code', 'missing_classification'])).toEqual(['missing_classification', 'unknown_code', 'blank_reason']);
    expect(canonicalFlags(['zzz', 'overlap_in_area', 'aaa'])).toEqual(['overlap_in_area', 'aaa', 'zzz']);
  });
  it('acceptedFlagsOf reads the comma separated list, blank and absent give none', () => {
    expect(acceptedFlagsOf({ accepted_flags: 'blank_reason, unknown_code' })).toEqual(['unknown_code', 'blank_reason']);
    expect(acceptedFlagsOf({ accepted_flags: '' })).toEqual([]);
    expect(acceptedFlagsOf({})).toEqual([]);
  });
  it('openFlagsOf = stored problem flags minus accepted; information flags are never open', () => {
    const e = { flags: 'missing_classification,unknown_code,blank_reason,code_not_in_area', accepted_flags: 'unknown_code' };
    expect(openFlagsOf(e)).toEqual(['missing_classification', 'blank_reason']);
    expect(openFlagsOf({ flags: 'unknown_code', accepted_flags: 'unknown_code' })).toEqual([]);
    expect(openFlagsOf({ flags: 'unknown_code' })).toEqual(['unknown_code']);
    expect(openFlagsOf({ flags: 'unknown_code', accepted_flags: 'placeholder' })).toEqual(['unknown_code']); // accepting what is not there changes nothing
    expect(hasOpenProblemFlags({ flags: 'unknown_code', accepted_flags: 'unknown_code' })).toBe(false);
    expect(hasOpenProblemFlags({ flags: 'unknown_code,blank_reason', accepted_flags: 'unknown_code' })).toBe(true);
    expect(hasOpenProblemFlags({ flags: 'code_not_in_area' })).toBe(false);
  });
  it('an accepted warning is fully resolved; an accepted blocking flag stops being open but the record stays blocked', () => {
    const warn = { flags: 'unknown_code', accepted_flags: 'unknown_code', is_void: false };
    expect(hasOpenProblemFlags(warn)).toBe(false);
    expect(isBlocked(warn)).toBe(false);
    expect(isKeptLeftOut(warn)).toBe(false);
    const block = { flags: 'missing_classification', accepted_flags: 'missing_classification', is_void: false };
    expect(openBlockingFlagsOf(block)).toEqual([]);
    expect(isOpenBlocked(block)).toBe(false);
    expect(isBlocked(block)).toBe(true); // calc keeps reading the stored flags
    expect(isAnalysable(block as never)).toBe(false);
    expect(isKeptLeftOut(block)).toBe(true);
    const half = { flags: 'missing_classification,unknown_area', accepted_flags: 'missing_classification' };
    expect(isOpenBlocked(half)).toBe(true);
    expect(isKeptLeftOut(half)).toBe(false);
  });
  it('blocked records stay out of blockedSummary however they are kept', () => {
    const e = { flags: 'missing_classification', accepted_flags: 'missing_classification', is_void: false, stop_ts: '2026-01-01 08:00:00.000', start_ts: '2026-01-01 09:00:00.000' } as never;
    expect(blockedSummary([e]).total).toEqual({ count: 1, hours: 1 });
  });
  it('pruneAcceptedFlags drops accepted flags the record no longer carries and keeps the derived overlap', () => {
    expect(pruneAcceptedFlags('unknown_code,blank_reason', 'blank_reason')).toEqual(['blank_reason']);
    expect(pruneAcceptedFlags('unknown_code', '')).toEqual([]);
    expect(pruneAcceptedFlags('overlap_in_area,unknown_code', 'blank_reason')).toEqual(['overlap_in_area']);
    expect(pruneAcceptedFlags(undefined, 'blank_reason')).toEqual([]);
  });
});

describe('information flags', () => {
  it('code_not_in_area is an information flag, in no other class', () => {
    expect(INFO_FLAGS).toEqual(['code_not_in_area']);
    expect((WARNING_FLAGS as readonly string[]).includes('code_not_in_area')).toBe(false);
    expect((BLOCKING_FLAGS as readonly string[]).includes('code_not_in_area')).toBe(false);
    expect(isInfoFlag('code_not_in_area')).toBe(true);
    expect(isInfoFlag('unknown_code')).toBe(false);
    expect(isBlockingFlag('code_not_in_area')).toBe(false);
    expect(FLAG_INFO.code_not_in_area).toMatchObject({ info: true, blocking: false, label: 'Cause in another area' });
  });
  it('splits the flags of a record into information and problems', () => {
    const e = { flags: 'code_not_in_area, blank_reason' };
    expect(infoFlagsOf(e)).toEqual(['code_not_in_area']);
    expect(problemFlagsOf(e)).toEqual(['blank_reason']);
    expect(hasProblemFlags(e)).toBe(true);
    expect(hasProblemFlags({ flags: 'code_not_in_area' })).toBe(false);
    expect(hasProblemFlags({ flags: '' })).toBe(false);
    expect(hasProblemFlags({})).toBe(false);
    expect(splitFlags('code_not_in_area')).toEqual(['code_not_in_area']); // still stored and readable
  });
  it('never blocks a record and never leaves it out of the numbers', () => {
    const row = { flags: 'code_not_in_area', is_void: false } as never;
    expect(isBlocked(row)).toBe(false);
    expect(isAnalysable(row)).toBe(true);
    expect(blockedSummary([{ ...(row as object), stop_ts: '2026-01-01 08:00:00.000', start_ts: '2026-01-01 09:00:00.000' } as never]).total.count).toBe(0);
  });
});
