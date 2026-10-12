import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fixtureIndex, fixtureMasterData } from './fixtures';
import {
  assignOccurrences, buildReasonLookup, codeKey, eventIdFromFingerprint, fingerprint, isAreaLevelCode, matchKey,
  normalizeClassification, resolveCode, resolveReason, rowCode,
} from './normalize';

describe('codeKey / isAreaLevelCode / matchKey', () => {
  it('upper-cases, removes whitespace and collapses dots', () => {
    expect(codeKey(' 131.st 200 ')).toBe('131.ST200');
    expect(codeKey('131..ST200')).toBe('131.ST200');
    expect(codeKey('131...ST\t200')).toBe('131.ST200');
    expect(codeKey('n/a')).toBe('N/A');
  });
  it('recognises area-level codes', () => {
    for (const c of ['N/A', 'n/a', 'NA', ' na ', 'N / A']) expect(isAreaLevelCode(c)).toBe(true);
    expect(isAreaLevelCode('NAV.1')).toBe(false);
    expect(isAreaLevelCode('')).toBe(false);
  });
  it('builds a trimmed single-spaced lower-case match key', () => {
    expect(matchKey('  Bearing   FAILURE ')).toBe('bearing failure');
    expect(matchKey(undefined)).toBe('');
    expect(matchKey('   ')).toBe('');
  });
  it('upper-cases classifications (Aut -> AUT) and rejects unknown ones', () => {
    expect(normalizeClassification(' Aut ')).toBe('AUT');
    expect(normalizeClassification('xyz')).toBeNull();
  });
});

describe('resolveCode', () => {
  const idx = fixtureIndex();
  it('resolves N/A first', () => expect(resolveCode('n/a', idx)).toEqual({ kind: 'area_level' }));
  it('resolves through an alias to the canonical code', () => {
    expect(resolveCode('100.aa1', idx)).toEqual({ kind: 'equipment', equipmentId: '100.A1', viaAlias: true });
  });
  it('resolves a direct code after normalisation', () => {
    expect(resolveCode(' 100..a2 ', idx)).toEqual({ kind: 'equipment', equipmentId: '100.A2', viaAlias: false });
  });
  it('flags unknown codes and keeps the key', () => expect(resolveCode('zz 9', idx)).toEqual({ kind: 'unknown', key: 'ZZ9' }));
  it('treats an alias whose target is missing as unknown', () => {
    expect(resolveCode('ghost', { ...idx, aliasMap: new Map([['GHOST', 'NOPE.1']]) }).kind).toBe('unknown');
  });
  it('rowCode prefers stored flags, then master data', () => {
    expect(rowCode({ code_raw: 'x', is_area_level: true, equipment_id: undefined }).kind).toBe('area_level');
    expect(rowCode({ code_raw: '100.A1', is_area_level: false, equipment_id: '100.A1' })).toMatchObject({ kind: 'equipment' });
    expect(rowCode({ code_raw: '100.A1', is_area_level: false, equipment_id: undefined }, idx)).toMatchObject({ kind: 'equipment' });
    expect(rowCode({ code_raw: '100.A1', is_area_level: false, equipment_id: undefined })).toEqual({ kind: 'unknown', key: '100.A1' });
  });
});

describe('resolveReason', () => {
  const idx = fixtureIndex();
  it('matches on classification and match key', () => {
    const r = resolveReason('MEC', '  bearing   FAILURE', idx.reasons);
    expect(r).toMatchObject({ status: 'listed', reasonId: 'R-MEC-001' });
  });
  it('same text in several classifications resolves to each classification', () => {
    expect(resolveReason('MEC', 'Other', idx.reasons)).toMatchObject({ reasonId: 'R-MEC-003' });
    expect(resolveReason('ELE', 'Other', idx.reasons)).toMatchObject({ reasonId: 'R-ELE-002' });
    expect(resolveReason('aut', 'Other', idx.reasons).status).toBe('unlisted');
  });
  it('blank and unlisted', () => {
    expect(resolveReason('MEC', '   ', idx.reasons).status).toBe('blank');
    expect(resolveReason('MEC', undefined, idx.reasons).status).toBe('blank');
    expect(resolveReason('MEC', 'Never listed', idx.reasons).status).toBe('unlisted');
  });
  it('uses the lowest order_no when several reasons share a key', () => {
    const base = fixtureMasterData().reasons[0]!;
    const lookup = buildReasonLookup([{ ...base, reason_id: 'HIGH', order_no: 9 }, { ...base, reason_id: 'LOW', order_no: 2 }]);
    expect(resolveReason('MEC', base.text_as_listed, lookup)).toMatchObject({ reasonId: 'LOW' });
  });
});

describe('fingerprint', () => {
  it('is the SHA-256 hex of area|codeKey|stop|start|occurrence', async () => {
    const parts = { area_id: 'K.1', code: ' 100..a1 ', stop_ts: '2026-03-01 08:00:00.000', start_ts: '2026-03-01 09:00:00.000', occurrence: 1 };
    const expected = createHash('sha256').update('K.1|100.A1|2026-03-01 08:00:00.000|2026-03-01 09:00:00.000|1').digest('hex');
    const fp = await fingerprint(parts);
    expect(fp).toBe(expected);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(eventIdFromFingerprint(fp)).toBe('EV-' + expected.slice(0, 16));
    expect(await fingerprint({ ...parts, occurrence: 2 })).not.toBe(fp);
  });
});

describe('assignOccurrences', () => {
  const r = (code: string, stop: string) => ({ area_id: 'K.1', code_raw: code, stop_ts: stop, start_ts: stop });
  it('numbers identical keys in file order, normalising the code', () => {
    const rows = [r('100.A1', 'a'), r('100.A1', 'b'), r('100.a1', 'a'), r('200.B1', 'a'), r('100.A1', 'a')];
    expect(assignOccurrences(rows)).toEqual([1, 1, 2, 1, 3]);
  });
});
