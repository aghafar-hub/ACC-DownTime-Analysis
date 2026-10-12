import { describe, expect, it } from 'vitest';
import type { EventRow } from '../api/types';
import { createRowFactory } from '../calc/fixtures';
import { computeSince, countNewAlerts, EMPTY_SINCE, isNewEvent } from './since';

const mk = createRowFactory('E');
const row = (stop: string, start: string, created: string, over: Partial<EventRow> & { area?: string; reason?: string; code?: string } = {}): EventRow => {
  const { area, reason, code, ...rest } = over;
  return { ...mk({ stop, start, area, reason, code }), created_at: created, ...rest };
};
const LAST = '2026-03-10 08:00:00.000';
const REPEAT = { settings: { repeatMinEvents: 2, repeatWindowDays: 30 } };

describe('isNewEvent', () => {
  it('compares created_at as a time, and falls back to the event date when created_at is missing', () => {
    const last = new Date(2026, 2, 10, 8, 0, 0).getTime();
    expect(isNewEvent({ created_at: '2026-03-10 08:00:01.000', event_date: '2026-01-01' }, last, '2026-03-10')).toBe(true);
    expect(isNewEvent({ created_at: '2026-03-10 08:00:00.000', event_date: '2026-03-12' }, last, '2026-03-10')).toBe(false);
    expect(isNewEvent({ created_at: '', event_date: '2026-03-11' }, last, '2026-03-10')).toBe(true);
    expect(isNewEvent({ created_at: '', event_date: '2026-03-10' }, last, '2026-03-10')).toBe(false);
  });
});

describe('computeSince', () => {
  const events = [
    row('2026-03-01 08:00', '2026-03-01 09:00', '2026-03-02 00:00:00.000', { area: 'K.1', reason: 'Belt slip' }),
    row('2026-03-11 08:00', '2026-03-11 10:00', '2026-03-11 12:00:00.000', { area: 'K.1', reason: 'Belt slip' }),
    row('2026-03-12 08:00', '2026-03-12 09:00', '2026-03-12 12:00:00.000', { area: 'K.1', reason: 'Bearing failure', code: '200.B1' }),
    row('2026-03-12 10:00', '2026-03-12 11:30', '2026-03-12 12:00:00.000', { area: 'RM.1', reason: 'Other', code: '300.C1' }),
    row('2026-03-12 12:00', '2026-03-12 13:00', '2026-03-12 12:00:00.000', { area: 'RM.1', cls: undefined, failure: false } as never),
  ];
  // the last row is planned work (not a failure); build it explicitly
  events[4] = { ...events[4]!, is_failure: false, classification: 'PL', criticality: 'NO_INC' };

  it('counts new events, new failures, their hours, the area with most new failures and new repeated groups', () => {
    const s = computeSince({ events, lastSeenAt: LAST, repeat: REPEAT, newAlerts: 2 });
    expect(s.newEvents).toBe(4);
    expect(s.newFailures).toBe(3);
    expect(s.failureHours).toBeCloseTo(2 + 1 + 1.5, 6);
    expect(s.topArea).toEqual({ areaId: 'K.1', failures: 2 });
    expect(s.newRepeatGroups).toBe(1); // the 03-01 and 03-11 belt slips became a group only now
    expect(s.newAlerts).toBe(2);
    expect(s.any).toBe(true);
  });
  it('leaves out voided and blocked records from failures, and voided ones from events', () => {
    const more = [
      ...events,
      row('2026-03-13 08:00', '2026-03-13 09:00', '2026-03-13 12:00:00.000', { isVoid: true } as never),
      { ...row('2026-03-13 10:00', '2026-03-13 11:00', '2026-03-13 12:00:00.000'), flags: 'missing_classification' },
    ];
    more[5] = { ...more[5]!, is_void: true };
    const s = computeSince({ events: more, lastSeenAt: LAST, repeat: REPEAT });
    expect(s.newEvents).toBe(5); // 4 + the blocked one; the voided one is gone
    expect(s.newFailures).toBe(3); // the blocked one is not a counted failure
  });
  it('says nothing without a baseline or when nothing is new', () => {
    expect(computeSince({ events, lastSeenAt: '' })).toBe(EMPTY_SINCE);
    const none = computeSince({ events, lastSeenAt: '2026-04-01 00:00:00.000', repeat: REPEAT });
    expect(none.any).toBe(false);
    expect(none).toMatchObject({ newEvents: 0, newFailures: 0, topArea: null, newRepeatGroups: 0 });
  });
  it('new alerts alone are enough to show the card', () => {
    expect(computeSince({ events: [], lastSeenAt: LAST, newAlerts: 1 }).any).toBe(true);
  });
  it('does not call an old repeated group new', () => {
    const old = [
      row('2026-02-01 08:00', '2026-02-01 09:00', '2026-02-02 00:00:00.000', { reason: 'Belt slip' }),
      row('2026-02-10 08:00', '2026-02-10 09:00', '2026-02-11 00:00:00.000', { reason: 'Belt slip' }),
      row('2026-03-11 08:00', '2026-03-11 09:00', '2026-03-11 12:00:00.000', { reason: 'Other', code: '300.C1' }),
    ];
    expect(computeSince({ events: old, lastSeenAt: LAST, repeat: REPEAT }).newRepeatGroups).toBe(0);
  });
});

describe('countNewAlerts', () => {
  it('counts alerts created after the last visit', () => {
    const alerts = [{ created_at: '2026-03-09 10:00:00.000' }, { created_at: '2026-03-10 09:00:00.000' }, { created_at: '2026-03-11 09:00:00.000' }];
    expect(countNewAlerts(alerts, LAST)).toBe(2);
    expect(countNewAlerts(alerts, '')).toBe(0);
  });
});
