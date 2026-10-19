import { describe, expect, it } from 'vitest';
import { SERVER_1_10, versionAtLeast } from './serverVersion';

describe('versionAtLeast', () => {
  it('compares numerically, part by part; unknown is never enough', () => {
    expect(versionAtLeast('1.10.0', SERVER_1_10)).toBe(true);
    expect(versionAtLeast('1.11.2', SERVER_1_10)).toBe(true);
    expect(versionAtLeast('2.0.0', SERVER_1_10)).toBe(true);
    expect(versionAtLeast('1.9.0', SERVER_1_10)).toBe(false); // not a text comparison ('1.9' > '1.10' as text)
    expect(versionAtLeast('', SERVER_1_10)).toBe(false);
    expect(versionAtLeast(undefined, SERVER_1_10)).toBe(false);
  });
});
