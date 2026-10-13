import { describe, expect, it } from 'vitest';
import { buildFailureEvents, chainHours } from './events';
import { createRowFactory } from './fixtures';
import { rangeToInterval } from './time';

describe('buildFailureEvents', () => {
  it('chains a Freq=0 row to the previous row even when reason and classification differ', () => {
    const row = createRowFactory();
    const a = row({ stop: '2026-03-02 10:00', start: '2026-03-02 10:30', cls: 'MEC', reason: 'Bearing failure' });
    const b = row({ stop: '2026-03-02 10:30', start: '2026-03-02 11:15', freq: 0, cls: 'ELE', reason: 'Motor trip' });
    const r = buildFailureEvents([b, a]); // input order does not matter
    expect(r.chains).toHaveLength(1);
    const c = r.chains[0]!;
    expect(c.rows.map((x) => x.event_id)).toEqual([a.event_id, b.event_id]);
    expect(c.id).toBe(a.event_id);
    expect(c.isFailure).toBe(true);
    expect(c.durationS).toBe(30 * 60 + 45 * 60); // 0.5 h + 0.75 h = 1.25 h
    expect(chainHours(c)).toBe(1.25);
    expect(r.failureEvents).toHaveLength(1);
    expect(r.orphans).toHaveLength(0);
  });

  it('chains across a midnight split (23:59:59.500 restart to 00:00:00 stop is within 1 s)', () => {
    const row = createRowFactory();
    const a = row({ stop: '2026-03-10 22:00:00.000', start: '2026-03-10 23:59:59.500' });
    const b = row({ stop: '2026-03-11 00:00:00.000', start: '2026-03-11 02:00:00.000', freq: 0 });
    const c = buildFailureEvents([a, b]).chains;
    expect(c).toHaveLength(1);
    // 22:00 -> 23:59:59.5 is 7199.5 s, plus 2 h = 7200 s
    expect(c[0]!.durationS).toBeCloseTo(14399.5, 6);
    expect(c[0]!.startDate).toBe('2026-03-10');
  });

  it('does not join a continuation more than one second away: it becomes an orphan', () => {
    const row = createRowFactory();
    const a = row({ stop: '2026-03-10 22:00', start: '2026-03-10 23:00' });
    const b = row({ stop: '2026-03-10 23:00:02', start: '2026-03-10 23:30', freq: 0 });
    const r = buildFailureEvents([a, b]);
    expect(r.chains).toHaveLength(2);
    expect(r.orphans).toHaveLength(1);
    expect(r.orphans[0]!.id).toBe(b.event_id);
    expect(r.failureEvents.map((c) => c.id)).toEqual([a.event_id]);
    expect(buildFailureEvents([a, b], { toleranceMs: 2000 }).chains).toHaveLength(1);
  });

  it('reports an orphan continuation without dropping it', () => {
    const row = createRowFactory();
    const o = row({ stop: '2026-03-01 00:00', start: '2026-03-01 03:00', freq: 0, cls: 'MEC' });
    const r = buildFailureEvents([o]);
    expect(r.chains).toHaveLength(1);
    expect(r.orphans).toHaveLength(1);
    expect(r.failureEvents).toHaveLength(0);
    expect(r.orphans[0]!.orphan).toBe(true);
    expect(r.orphans[0]!.durationS).toBe(3 * 3600);
  });

  it('handles a 24 h stop as one row of 86400 s', () => {
    const row = createRowFactory();
    const a = row({ stop: '2026-03-10 00:00', start: '2026-03-11 00:00' });
    const c = buildFailureEvents([a]).chains[0]!;
    expect(c.durationS).toBe(86400);
    expect(chainHours(c)).toBe(24);
  });

  it('keeps areas apart and handles overlapping events in different areas', () => {
    const row = createRowFactory();
    const k = row({ area: 'K.1', stop: '2026-03-02 10:00', start: '2026-03-02 11:00' });
    const m = row({ area: 'RM.1', stop: '2026-03-02 11:00', start: '2026-03-02 12:00', freq: 0 }); // different area: no predecessor
    const r = buildFailureEvents([k, m]);
    expect(r.chains).toHaveLength(2);
    expect(r.orphans.map((c) => c.area_id)).toEqual(['RM.1']);
  });

  it('chains several continuations and lets only one claim a tail', () => {
    const row = createRowFactory();
    const a = row({ stop: '2026-03-02 10:00', start: '2026-03-02 11:00' });
    const b = row({ stop: '2026-03-02 11:00', start: '2026-03-02 12:00', freq: 0 });
    const c = row({ stop: '2026-03-02 12:00', start: '2026-03-02 13:00', freq: 0 });
    const dup = row({ stop: '2026-03-02 12:00', start: '2026-03-02 13:00', freq: 0 }); // exact duplicate of c (P1: one stop)
    const r = buildFailureEvents([a, b, c, dup]);
    expect(r.chains[0]!.rows).toHaveLength(3);
    expect(r.duplicates).toEqual([dup]);
    expect(r.orphans).toHaveLength(0);
    // a second continuation that is NOT an exact duplicate (other code) still cannot claim the same tail: orphan
    const other = row({ stop: '2026-03-02 12:00', start: '2026-03-02 13:00', freq: 0, code: '100.A2' });
    const r2 = buildFailureEvents([a, b, c, other]);
    expect(r2.chains[0]!.rows).toHaveLength(3);
    expect(r2.orphans).toHaveLength(1);
  });

  it('a non-failure chain (planned) is a chain but not a failure event', () => {
    const row = createRowFactory();
    const p = row({ stop: '2026-03-02 10:00', start: '2026-03-02 14:00', cls: 'PL' });
    const r = buildFailureEvents([p]);
    expect(r.chains).toHaveLength(1);
    expect(r.failureEvents).toHaveLength(0);
  });

  it('excludes voided rows and reports unreadable timestamps', () => {
    const row = createRowFactory();
    const v = row({ stop: '2026-03-02 10:00', start: '2026-03-02 11:00', isVoid: true });
    const bad = { ...row({ stop: '2026-03-02 10:00', start: '2026-03-02 11:00' }), stop_ts: 'garbage' };
    const r = buildFailureEvents([v, bad]);
    expect(r.chains).toHaveLength(0);
    expect(r.unreadable).toEqual([bad]);
    expect(buildFailureEvents([v], { includeVoid: true }).chains).toHaveLength(1);
  });

  it('counts an event in the month where it starts and clips its hours to a window', () => {
    const row = createRowFactory();
    const a = row({ stop: '2026-01-31 22:00', start: '2026-02-01 00:00' });
    const b = row({ stop: '2026-02-01 00:00', start: '2026-02-01 03:00', freq: 0 });
    const c = buildFailureEvents([a, b]).chains[0]!;
    expect(c.startDate).toBe('2026-01-31');
    expect(chainHours(c)).toBe(5);
    expect(chainHours(c, rangeToInterval({ from: '2026-02-01', to: '2026-02-28' }))).toBe(3);
    expect(chainHours(c, rangeToInterval({ from: '2026-01-01', to: '2026-01-31' }))).toBe(2);
  });

  it('treats a restart before the stop as zero duration', () => {
    const row = createRowFactory();
    const a = row({ stop: '2026-03-02 11:00', start: '2026-03-02 10:00' });
    expect(buildFailureEvents([a]).chains[0]!.durationS).toBe(0);
  });
});
