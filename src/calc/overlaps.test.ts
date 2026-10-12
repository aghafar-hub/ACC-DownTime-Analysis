import { describe, expect, it } from 'vitest';
import type { EventRow } from '../api/types';
import { findOverlaps } from './overlaps';
import { BLOCKING_FLAGS, isBlocked, splitFlags } from './flags';

const ev = (id: string, area: string, stop: string, start: string, over: Partial<EventRow> = {}): EventRow => ({
  event_id: id, batch_id: 'B', event_date: stop.slice(0, 10), line_id: 'L.1', area_id: area, code_raw: 'X', is_area_level: false,
  stop_ts: stop, start_ts: start, duration_s: 0, freq: 1, classification: 'MEC', criticality: 'INC', is_failure: true,
  fingerprint: id, edited: false, is_void: false, created_at: '', ...over,
});

describe('findOverlaps', () => {
  it('finds two stops of one area that share time', () => {
    const r = findOverlaps([ev('a', 'K.1', '2026-07-01 00:00:00.000', '2026-07-02 00:00:00.000'), ev('b', 'K.1', '2026-07-01 12:00:00.000', '2026-07-01 13:00:00.000')]);
    expect([...r.ids].sort()).toEqual(['a', 'b']);
    expect(r.pairs).toBe(1);
    expect(r.partners.get('a')).toEqual(['b']);
  });
  it('does not flag stops that only touch', () => {
    const r = findOverlaps([ev('a', 'K.1', '2026-07-01 00:00:00.000', '2026-07-01 01:00:00.000'), ev('b', 'K.1', '2026-07-01 01:00:00.000', '2026-07-01 02:00:00.000')]);
    expect(r.ids.size).toBe(0);
  });
  it('ignores a sub-second overlap, different areas, voided and blocked events', () => {
    const r = findOverlaps([
      ev('a', 'K.1', '2026-07-01 00:00:00.000', '2026-07-01 01:00:00.500'),
      ev('b', 'K.1', '2026-07-01 01:00:00.000', '2026-07-01 02:00:00.000'),
      ev('c', 'K.2', '2026-07-01 00:30:00.000', '2026-07-01 00:45:00.000'),
      ev('d', 'K.1', '2026-07-01 00:10:00.000', '2026-07-01 00:20:00.000', { is_void: true }),
      ev('e', 'K.1', '2026-07-01 00:12:00.000', '2026-07-01 00:18:00.000', { flags: 'missing_classification' }),
    ]);
    expect(r.ids.size).toBe(0);
  });
  it('counts three rows that all start at once as three overlapping pairs', () => {
    const r = findOverlaps([
      ev('a', 'AFR new', '2026-07-01 00:00:00.000', '2026-07-02 00:00:00.000'),
      ev('b', 'AFR new', '2026-07-01 00:00:00.000', '2026-07-23 08:03:03.000'),
      ev('c', 'AFR new', '2026-07-01 00:00:00.000', '2026-07-28 14:55:08.000'),
    ]);
    expect(r.pairs).toBe(3);
    expect(r.ids.size).toBe(3);
  });
});

describe('flags', () => {
  it('splits and classifies', () => {
    expect(splitFlags(' unknown_code, blank_reason ,')).toEqual(['unknown_code', 'blank_reason']);
    expect(splitFlags(undefined)).toEqual([]);
    expect(isBlocked({ flags: 'unlisted_reason' })).toBe(false);
    for (const f of BLOCKING_FLAGS) expect(isBlocked({ flags: `x,${f}` })).toBe(true);
  });
});
