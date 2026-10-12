import { describe, expect, it } from 'vitest';
import {
  BLOCKING_FLAGS, FLAG_INFO, hasProblemFlags, infoFlagsOf, INFO_FLAGS, isBlocked, isBlockingFlag, isInfoFlag, problemFlagsOf, splitFlags, WARNING_FLAGS,
} from './flags';
import { blockedSummary } from './filters';
import { isAnalysable } from './events';

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
