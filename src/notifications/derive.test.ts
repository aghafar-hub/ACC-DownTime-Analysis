import { describe, expect, it } from 'vitest';
import type { EventRow } from '../api/types';
import { INFO_FLAGS } from '../calc/flags';
import { buildValidation } from '../validate/model';
import { deriveActionItems, groupProblemCodes, type DeriveAccess } from './derive';

let seq = 0;
// each row gets its own hour so no two rows overlap (an overlap is itself a Validate problem)
const ev = (id: string, over: Partial<EventRow> = {}): EventRow => ({
  event_id: id, batch_id: 'B', event_date: '2026-03-01', line_id: 'L.1', area_id: 'K.1', code_raw: '100.A1', is_area_level: false,
  stop_ts: `2026-03-01 ${String(seq++).padStart(2, '0')}:00:00.000`, start_ts: `2026-03-01 ${String(seq - 1).padStart(2, '0')}:30:00.000`, duration_s: 1800, freq: 1, classification: 'MEC', criticality: 'INC',
  is_failure: true, fingerprint: id, edited: false, is_void: false, created_at: '2026-03-02 00:00:00.000', ...over,
});
const EDIT_ALL: DeriveAccess = { editEvents: true, editMaster: true, viewEvents: true, viewMaster: true };
const EDIT_EVENTS: DeriveAccess = { editEvents: true, editMaster: false, viewEvents: true, viewMaster: true };
const VIEW_ONLY: DeriveAccess = { editEvents: false, editMaster: false, viewEvents: true, viewMaster: true };

const rows: EventRow[] = [
  ev('a1', { code_raw: 'AFR2', flags: 'unknown_code,placeholder' }),
  ev('a2', { code_raw: 'afr2', flags: 'unknown_code' }),
  ev('a3', { code_raw: 'AFR 2', flags: 'placeholder' }),
  ev('b1', { code_raw: '999.ZZ', flags: 'unknown_code' }),
  ev('v1', { code_raw: '999.ZZ', flags: 'unknown_code', is_void: true }),
  ev('c1', { code_raw: '', flags: 'missing_code' }),
  ev('i1', { code_raw: '200.B1', flags: INFO_FLAGS[0] }),
  ev('blk', { code_raw: '300.C1', flags: 'missing_classification' }),
];

describe('groupProblemCodes', () => {
  it('groups unknown and placeholder rows per code (spelling-insensitive), skips voided, blank codes and information flags', () => {
    const g = groupProblemCodes(rows);
    expect(g).toEqual([
      { code: 'AFR2', count: 3, placeholder: true },
      { code: '999.ZZ', count: 1, placeholder: false },
    ]);
  });
});

describe('kept as entered in the action items', () => {
  it('flags kept as entered do not group a code and do not count as records to validate', () => {
    const kept: EventRow[] = [
      ev('k1', { code_raw: 'AFR2', flags: 'unknown_code,placeholder', accepted_flags: 'unknown_code,placeholder' }),
      ev('k2', { code_raw: '999.ZZ', flags: 'unknown_code', accepted_flags: 'unknown_code' }),
      ev('k3', { code_raw: '999.YY', flags: 'unknown_code,blank_reason', accepted_flags: 'unknown_code' }),
      ev('k4', { code_raw: '', flags: 'missing_classification', accepted_flags: 'missing_classification' }),
    ];
    expect(groupProblemCodes(kept)).toEqual([]);
    const list = buildValidation(kept);
    expect(list.summary.total).toBe(1); // only k3, for its blank reason
    expect(list.summary.blocked.count).toBe(0);
    const items = deriveActionItems({ validation: { total: list.summary.total, blocked: list.summary.blocked.count }, events: kept, needsReview: 0, access: EDIT_EVENTS });
    expect(items.map((i) => i.title)).toEqual(['1 record needs checking']);
    const none = buildValidation(kept.slice(0, 2));
    expect(deriveActionItems({ validation: { total: none.summary.total, blocked: 0 }, events: kept.slice(0, 2), needsReview: 0, access: EDIT_ALL })).toEqual([]);
  });
});

describe('deriveActionItems', () => {
  const list = buildValidation(rows);
  const validation = { total: list.summary.total, blocked: list.summary.blocked.count };

  it('the Validate item carries the same counts as the Validate page and links there', () => {
    const items = deriveActionItems({ validation, events: rows, needsReview: 0, access: EDIT_EVENTS });
    const v = items.find((i) => i.type === 'validate')!;
    expect(validation.total).toBe(6); // 3 + 1 unknown + missing_code + blocking; the information flag is not a problem
    expect(v.title).toBe('6 records need checking, 1 left out of the numbers');
    expect(v.link).toEqual({ to: '/validate' });
    expect(v.kind).toBe('action');
  });
  it('information-only flags (code_not_in_area) are never counted or listed', () => {
    const only = [ev('x', { flags: 'code_not_in_area' })];
    const l = buildValidation(only);
    expect(deriveActionItems({ validation: { total: l.summary.total, blocked: 0 }, events: only, needsReview: 0, access: EDIT_ALL })).toEqual([]);
  });
  it('says "left out" only when something is', () => {
    const items = deriveActionItems({ validation: { total: 1, blocked: 0 }, events: [], needsReview: null, access: EDIT_ALL });
    expect(items[0]!.title).toBe('1 record needs checking');
    const two = deriveActionItems({ validation: { total: 4, blocked: 0 }, events: [], needsReview: null, access: EDIT_ALL });
    expect(two[0]!.title).toBe('4 records need checking');
  });
  it('one item per problem code: counts, placeholder wording, link to Validate filtered by that problem (events editor)', () => {
    const items = deriveActionItems({ validation, events: rows, needsReview: 0, access: EDIT_EVENTS }).filter((i) => i.type === 'unknown_code');
    expect(items.map((i) => i.title)).toEqual(['3 rows: placeholder code AFR2', '1 row: unknown code 999.ZZ']);
    expect(items[0]!.link).toEqual({ to: '/validate?flag=placeholder&q=AFR2' });
    expect(items[1]!.link).toEqual({ to: '/validate?flag=unknown_code&q=999.ZZ' });
  });
  it('goes to Master Data when the person can edit master', () => {
    const items = deriveActionItems({ validation, events: rows, needsReview: 0, access: EDIT_ALL }).filter((i) => i.type === 'unknown_code');
    expect(items.every((i) => i.link?.to === '/master')).toBe(true);
  });
  it('a master editor without events access still gets the unknown-code items (to Master Data), but not the Validate item', () => {
    const access: DeriveAccess = { editEvents: false, editMaster: true, viewEvents: false, viewMaster: true };
    const items = deriveActionItems({ validation, events: rows, needsReview: 2, access });
    expect(items.map((i) => i.type)).toEqual(['unknown_code', 'unknown_code', 'needs_review']);
  });
  it('folds the codes beyond the cap into one item', () => {
    const many = Array.from({ length: 8 }, (_, i) => ev(`m${i}`, { code_raw: `X${i}`, flags: 'unknown_code' }));
    const items = deriveActionItems({ validation: { total: 8, blocked: 0 }, events: many, needsReview: 0, access: EDIT_EVENTS, maxCodeItems: 3 }).filter((i) => i.type === 'unknown_code');
    expect(items).toHaveLength(4);
    expect(items[3]!.title).toBe('5 more rows: 5 other unknown or placeholder codes');
    expect(items[3]!.link?.to).toBe('/validate?flag=unknown_code%2Cplaceholder');
  });
  it('equipment needing review links to Master Data with the review filter', () => {
    const items = deriveActionItems({ validation: null, events: null, needsReview: 28, access: EDIT_ALL });
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('28 equipment codes need review');
    expect(items[0]!.link).toEqual({ to: '/master?review=1' });
    expect(deriveActionItems({ validation: null, events: null, needsReview: 1, access: EDIT_ALL })[0]!.title).toBe('1 equipment code needs review');
  });
  it('people who only view get no action items', () => {
    expect(deriveActionItems({ validation, events: rows, needsReview: 28, access: VIEW_ONLY })).toEqual([]);
  });
  it('nothing is derived until the data is loaded', () => {
    expect(deriveActionItems({ validation: null, events: null, needsReview: null, access: EDIT_ALL })).toEqual([]);
  });
  it('gives each item a stable id and no created_at (live conditions)', () => {
    const items = deriveActionItems({ validation, events: rows, needsReview: 3, access: EDIT_ALL });
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.every((i) => i.created_at === '' && !i.unseen)).toBe(true);
  });
});
