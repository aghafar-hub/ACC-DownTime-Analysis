import { describe, expect, it } from 'vitest';
import { buildOwnerLookup, causeChipLabel, causeNote, ownersOfRow } from './crossArea';

describe('cross-area cause helpers', () => {
  const owners = buildOwnerLookup([
    { equipment_id: '131.RE300', area_id: 'CR' },
    { equipment_id: '131.RE300', area_id: 'FM.1' },
    { equipment_id: '131.RE300', area_id: 'CR' },
    { equipment_id: '100.A1', area_id: 'RM.1' },
  ]);
  it('lists the owner areas, sorted and without repeats', () => {
    expect(owners('131.RE300')).toEqual(['CR', 'FM.1']);
    expect(owners('nope')).toEqual([]);
    expect(owners(undefined)).toEqual([]);
  });
  it('leaves out the stopped area itself', () => {
    expect(ownersOfRow({ equipment_id: '131.RE300', area_id: 'RM.1' }, owners)).toEqual(['CR', 'FM.1']);
    expect(ownersOfRow({ equipment_id: '131.RE300', area_id: 'CR' }, owners)).toEqual(['FM.1']);
    expect(ownersOfRow({ equipment_id: '131.RE300', area_id: 'RM.1' }, undefined)).toEqual([]);
  });
  it('words the chip and the note', () => {
    expect(causeChipLabel(['CR'])).toBe('Cause in CR');
    expect(causeChipLabel(['CR', 'FM.1'])).toBe('Cause in CR, FM.1');
    expect(causeChipLabel([])).toBe('Cause in another area');
    expect(causeNote('RM.1', ['CR'])).toBe("This code is listed under CR, not under RM.1. The stop counts for RM.1 as stopped by another area (not RM.1's own equipment). Nothing to fix.");
  });
});
