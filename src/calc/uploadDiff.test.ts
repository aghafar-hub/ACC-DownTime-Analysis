import { describe, expect, it } from 'vitest';
import type { EventRow } from '../api/types';
import { createRowFactory, fixtureIndex, ts, type RowSpec } from './fixtures';
import { compareFields, compareUpload, validateRow, type DiffUploadRow } from './uploadDiff';

const index = fixtureIndex();

/** Uploaded row; the fingerprint is a plain label so tests can reason about identity. */
function up(fp: string, spec: Partial<DiffUploadRow> & { stop: string; start: string }): DiffUploadRow {
  const { stop, start, ...rest } = spec;
  return {
    source_row: 2, event_date: stop.slice(0, 10), line_id: 'L.1', area_id: 'K.1', code_raw: '100.A1', stop_ts: ts(stop), start_ts: ts(start),
    freq: 1, classification: 'MEC', criticality: 'INC', is_failure: true, reason_raw: 'Bearing failure', description: '', fingerprint: fp, ...rest,
  };
}

function stored(fp: string, spec: RowSpec & { reason?: string }): EventRow {
  const make = createRowFactory('ST');
  return { ...make({ reason: 'Bearing failure', description: '', ...spec }), fingerprint: fp };
}

const types = (d: ReturnType<typeof compareUpload>) => d.warnings.map((w) => w.type).sort();
const statuses = (d: ReturnType<typeof compareUpload>) => d.rows.map((r) => r.status);

describe('classification of uploaded rows', () => {
  const s1 = stored('fp1', { stop: '2026-03-01 08:00', start: '2026-03-01 09:00' });
  const s2 = stored('fp2', { stop: '2026-03-02 08:00', start: '2026-03-02 09:00' });
  const s3 = stored('fp3', { stop: '2026-03-02 14:00', start: '2026-03-02 15:00' });

  it('identical rows are skipped silently', () => {
    const d = compareUpload({ uploaded: [up('fp1', { stop: '2026-03-01 08:00', start: '2026-03-01 09:00' })], stored: [s1], index });
    expect(statuses(d)).toEqual(['identical']);
    expect(d.warnings.filter((w) => w.type !== 'missing_row')).toEqual([]);
    expect(d.summary).toMatchObject({ identical: 1, new: 0, late: 0, changed: 0 });
  });

  it('a new row after the latest stored date is new', () => {
    const d = compareUpload({ uploaded: [up('n1', { stop: '2026-03-03 08:00', start: '2026-03-03 09:00' })], stored: [s1, s2], index });
    expect(statuses(d)).toEqual(['new']);
  });

  it('a new row on an already-stored date is a late row', () => {
    const d = compareUpload({ uploaded: [up('n1', { stop: '2026-03-02 20:00', start: '2026-03-02 21:00', source_row: 9 })], stored: [s1, s2], index });
    expect(statuses(d)).toEqual(['late_row']);
    expect(d.warnings.find((w) => w.type === 'late_row')).toMatchObject({ source_row: 9, severity: 'warning' });
  });

  it('a new row on an earlier date with no stored rows is also late (earlier than the latest stored date)', () => {
    const d = compareUpload({ uploaded: [up('n1', { stop: '2026-02-20 08:00', start: '2026-02-20 09:00' })], stored: [s1, s2], index });
    expect(statuses(d)).toEqual(['late_row']);
  });

  it('with nothing stored every row is new (no late rows)', () => {
    const d = compareUpload({ uploaded: [up('a', { stop: '2026-03-02 08:00', start: '2026-03-02 09:00' }), up('b', { stop: '2026-01-02 08:00', start: '2026-01-02 09:00' })], stored: [], index });
    expect(statuses(d)).toEqual(['new', 'new']);
  });

  it('a voided stored event that is re-uploaded is identical, not new', () => {
    const v = { ...s1, is_void: true };
    const d = compareUpload({ uploaded: [up('fp1', { stop: '2026-03-01 08:00', start: '2026-03-01 09:00' })], stored: [v], index });
    expect(statuses(d)).toEqual(['identical']);
  });

  it('same fingerprint with different non-key fields is a changed row with both values', () => {
    const u = up('fp1', { stop: '2026-03-01 08:00', start: '2026-03-01 09:00', classification: 'ELE', reason_raw: 'Motor trip', source_row: 14 });
    const d = compareUpload({ uploaded: [u], stored: [s1], index });
    expect(statuses(d)).toEqual(['changed_row']);
    expect(d.rows[0]!.changes).toEqual([
      { field: 'classification', stored: 'MEC', uploaded: 'ELE' },
      { field: 'reason_raw', stored: 'Bearing failure', uploaded: 'Motor trip' },
    ]);
    const w = d.warnings.find((x) => x.type === 'changed_row')!;
    expect(w).toMatchObject({ source_row: 14, event_id: s1.event_id });
    expect(w.detail).toContain('stored "MEC", file "ELE"');
    expect(d.summary.changed).toBe(1);
  });

  it('compares each tracked field', () => {
    const base = up('fp1', { stop: '2026-03-01 08:00', start: '2026-03-01 09:00' });
    const patches: [Partial<DiffUploadRow>, string][] = [
      [{ freq: 0 }, 'freq'], [{ criticality: 'NO_INC' }, 'criticality'], [{ is_failure: false }, 'is_failure'], [{ description: 'x' }, 'description'],
      [{ event_date: '2026-03-02' }, 'event_date'], [{ line_id: 'L.2' }, 'line_id'],
    ];
    for (const [p, f] of patches) expect(compareFields(s1, { ...base, ...p }).map((c) => c.field)).toEqual([f]);
    // case and spacing differences are not changes
    expect(compareFields(s1, { ...base, classification: 'mec', reason_raw: '  bearing failure ' }).map((c) => c.field)).toEqual(['reason_raw']);
    expect(compareFields(s1, { ...base, reason_raw: '  Bearing   failure ' })).toEqual([]);
  });

  it('missing rows: stored rows inside the date range of the file but absent from it (informational)', () => {
    const d = compareUpload({
      uploaded: [up('fp1', { stop: '2026-03-01 08:00', start: '2026-03-01 09:00' }), up('n1', { stop: '2026-03-03 08:00', start: '2026-03-03 09:00' })],
      stored: [s1, s2, s3, stored('fpOld', { stop: '2026-02-01 08:00', start: '2026-02-01 09:00' }), { ...stored('fpVoid', { stop: '2026-03-02 10:00', start: '2026-03-02 11:00' }), is_void: true }],
      index,
    });
    const missing = d.warnings.filter((w) => w.type === 'missing_row');
    expect(missing.map((w) => w.event_id).sort()).toEqual([s2.event_id, s3.event_id].sort());
    expect(missing.every((w) => w.severity === 'info')).toBe(true);
    expect(d.summary.missing).toBe(2); // the February row is outside the file's range; the voided one is ignored
  });

  it('counts a summary by warning type', () => {
    const d = compareUpload({ uploaded: [up('n1', { stop: '2026-03-02 20:00', start: '2026-03-02 21:00' })], stored: [s2], index });
    expect(d.summary.warningCounts.late_row).toBe(1);
    expect(d.summary.rowsRead).toBe(1);
  });
});

describe('edited events', () => {
  const edited = { ...stored('fp1', { stop: '2026-03-01 08:00', start: '2026-03-01 09:00', reason: 'Belt slip' }), edited: true };
  const u = up('fp1', { stop: '2026-03-01 08:00', start: '2026-03-01 09:00', reason_raw: 'Bearing failure' });

  it('gives an edited_in_app info warning instead of changed_row', () => {
    const d = compareUpload({ uploaded: [u], stored: [edited], index });
    expect(statuses(d)).toEqual(['identical']);
    expect(types(d)).toEqual(['edited_in_app']);
    expect(d.warnings[0]).toMatchObject({ severity: 'info', event_id: edited.event_id });
  });
  it('when the edited fields are known, a difference in another field is still a changed row', () => {
    const u2 = { ...u, classification: 'ELE' };
    const d = compareUpload({ uploaded: [u2], stored: [edited], index, editedFields: new Map([[edited.event_id, new Set(['reason_raw'])]]) });
    expect(statuses(d)).toEqual(['changed_row']);
    const ok = compareUpload({ uploaded: [u], stored: [edited], index, editedFields: new Map([[edited.event_id, new Set(['reason_raw'])]]) });
    expect(types(ok)).toEqual(['edited_in_app']);
  });
  it('an unedited stored event with the same difference is a changed row', () => {
    const d = compareUpload({ uploaded: [u], stored: [{ ...edited, edited: false }], index });
    expect(statuses(d)).toEqual(['changed_row']);
  });
});

describe('validation warnings', () => {
  const base = { stop: '2026-03-03 08:00', start: '2026-03-03 09:00' };
  const run = (u: DiffUploadRow, others: DiffUploadRow[] = [], st: EventRow[] = []) =>
    compareUpload({ uploaded: [u, ...others], stored: st, index }).rows[0]!.warnings.map((w) => w.type).sort();

  it('a clean row has no warnings', () => expect(run(up('a', base))).toEqual([]));
  it('unknown_code', () => expect(run(up('a', { ...base, code_raw: 'ZZ.9' }))).toEqual(['unknown_code']));
  it('code_not_in_area', () => expect(run(up('a', { ...base, code_raw: '200.B1' }))).toEqual(['code_not_in_area']));
  it('code_not_in_area is information: severity info, row still stored with the flag, no decision needed', () => {
    const d = compareUpload({ uploaded: [up('a', { ...base, code_raw: '200.B1' })], stored: [], index });
    expect(d.warnings.map((w) => [w.type, w.severity])).toEqual([['code_not_in_area', 'info']]);
    expect(d.warnings[0]!.detail).toMatch(/listed under RM\.1, not under K\.1/);
    expect(d.rows[0]!.flags).toEqual(['code_not_in_area']);
    expect(d.rows[0]!.status).toBe('new');
    expect(d.lateMonths).toEqual([]);
  });
  it('codes of several areas are fine in each of them', () => {
    expect(run(up('a', { ...base, code_raw: '100.A2', area_id: 'RM.1' }))).toEqual([]);
    expect(run(up('a', { ...base, code_raw: '100.A2' }))).toEqual([]);
  });
  it('N/A is valid and raises nothing', () => expect(run(up('a', { ...base, code_raw: 'N/A' }))).toEqual([]));
  it('placeholder_code: no dot and not N/A (also unknown when not in the master)', () => {
    expect(run(up('a', { ...base, code_raw: 'AFR2' }))).toEqual(['placeholder_code', 'unknown_code']);
  });
  it('resolves aliases before judging the code', () => expect(run(up('a', { ...base, code_raw: '100.aa1' }))).toEqual([]));
  it('unlisted_reason and blank_reason', () => {
    expect(run(up('a', { ...base, reason_raw: 'Something new' }))).toEqual(['unlisted_reason']);
    expect(run(up('a', { ...base, reason_raw: '   ' }))).toEqual(['blank_reason']);
    expect(run(up('a', { ...base, reason_raw: undefined }))).toEqual(['blank_reason']);
  });
  it('a reason listed under another classification is unlisted for this one', () => {
    expect(run(up('a', { ...base, classification: 'ELE', reason_raw: 'Belt slip' }))).toEqual(['unlisted_reason']);
    expect(run(up('a', { ...base, classification: 'ELE', reason_raw: 'Other' }))).toEqual([]);
  });
  it('end_before_start', () => expect(run(up('a', { stop: '2026-03-03 09:00', start: '2026-03-03 08:00' }))).toEqual(['end_before_start']));
  it('duration_mismatch only when the sheet duration is given and differs by more than 1 s', () => {
    expect(run(up('a', { ...base, sheet_duration_s: 3000 }))).toEqual(['duration_mismatch']);
    expect(run(up('a', { ...base, sheet_duration_s: 3600.5 }))).toEqual([]);
    expect(run(up('a', base))).toEqual([]);
  });
  it('orphan_continuation: Freq = 0 with no predecessor', () => {
    expect(run(up('a', { ...base, freq: 0, is_failure: false }))).toEqual(['orphan_continuation']);
  });
  it('no orphan when the predecessor is in the file or in the stored data', () => {
    const cont = up('c', { stop: '2026-03-03 09:00', start: '2026-03-03 10:00', freq: 0, is_failure: false });
    const pred = up('p', base);
    const d = compareUpload({ uploaded: [pred, cont], stored: [], index });
    expect(d.warnings.filter((w) => w.type === 'orphan_continuation')).toEqual([]);
    const sp = stored('sp', { stop: '2026-03-03 08:00', start: '2026-03-03 09:00' });
    const d2 = compareUpload({ uploaded: [cont], stored: [sp], index });
    expect(d2.warnings.filter((w) => w.type === 'orphan_continuation')).toEqual([]);
    // a predecessor in another area does not count
    const other = stored('so', { area: 'RM.1', code: '200.B1', stop: '2026-03-03 08:00', start: '2026-03-03 09:00' });
    expect(compareUpload({ uploaded: [cont], stored: [other], index }).warnings.some((w) => w.type === 'orphan_continuation')).toBe(true);
  });
  it('overlap_in_area against another uploaded row or a stored row, in the same area only', () => {
    const o1 = up('o1', { stop: '2026-03-03 08:30', start: '2026-03-03 09:30' });
    const d = compareUpload({ uploaded: [up('a', base), o1], stored: [], index });
    expect(d.rows.map((r) => r.warnings.map((w) => w.type))).toEqual([['overlap_in_area'], ['overlap_in_area']]);
    const sp = stored('sp', { stop: '2026-03-03 08:30', start: '2026-03-03 09:30' });
    expect(run(up('a', base), [], [sp])).toEqual(['overlap_in_area']);
    const sOther = stored('so', { area: 'RM.1', code: '200.B1', stop: '2026-03-03 08:30', start: '2026-03-03 09:30' });
    expect(run(up('a', base), [], [sOther])).toEqual([]);
  });
  it('touching rows (a midnight split or back-to-back stops) are not overlaps', () => {
    const b = up('b', { stop: '2026-03-03 09:00', start: '2026-03-03 10:00', freq: 0, is_failure: false });
    const d = compareUpload({ uploaded: [up('a', base), b], stored: [], index });
    expect(d.warnings.filter((w) => w.type === 'overlap_in_area')).toEqual([]);
  });
  it('identical rows are not re-validated (they were checked when first uploaded)', () => {
    const s = stored('fp1', { stop: '2026-03-01 08:00', start: '2026-03-01 09:00', code: 'ZZ.9', eq: null });
    const d = compareUpload({ uploaded: [up('fp1', { stop: '2026-03-01 08:00', start: '2026-03-01 09:00', code_raw: 'ZZ.9' })], stored: [s], index });
    expect(d.warnings).toEqual([]);
  });
  it('validateRow can be used alone', () => {
    expect(validateRow(up('a', { ...base, code_raw: 'ZZ.9' }), index).map((w) => w.type)).toEqual(['unknown_code']);
  });
});

describe('normalisation', () => {
  it('upper-cases the classification (Aut -> AUT) and reports it', () => {
    const d = compareUpload({ uploaded: [up('a', { stop: '2026-03-03 08:00', start: '2026-03-03 09:00', classification: 'Aut', reason_raw: 'Bearing failure', source_row: 7 })], stored: [], index });
    expect(d.normalizedRows[0]!.classification).toBe('AUT');
    expect(d.normalisations).toEqual([{ source_row: 7, field: 'classification', from: 'Aut', to: 'AUT' }]);
  });
  it('a case-only difference against the stored value is not a change', () => {
    const s = stored('fp1', { stop: '2026-03-01 08:00', start: '2026-03-01 09:00' });
    const d = compareUpload({ uploaded: [up('fp1', { stop: '2026-03-01 08:00', start: '2026-03-01 09:00', classification: 'mec' })], stored: [s], index });
    expect(statuses(d)).toEqual(['identical']);
  });
});
