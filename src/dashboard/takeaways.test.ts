import { describe, expect, it } from 'vitest';
import { avail, compareValues, unavail } from '../calc';
import { changeClause, overviewTakeaway, paretoTakeaway, reliabilityTakeaway, repeatsTakeaway } from './takeaways';

const up = compareValues(avail(1157.5), avail(1096.1), 'lower');
const top = { available: true as const, areaId: 'K.2', sharePct: 13.3 };

describe('overviewTakeaway', () => {
  it('reads hours, the change against the previous period and the largest contributor', () => {
    const s = overviewTakeaway({ kpi: { downtimeHours: 1157.5, topArea: top }, downtimeChange: up, compare: 'previous_period' });
    expect(s).toBe('1,157.5 area-hours stopped, +5.6% vs previous period; K.2 is the largest contributor by failure hours (13.3% of them).');
  });
  it('uses a minus sign for a decrease and names the comparison of last year', () => {
    const down = compareValues(avail(90), avail(100), 'lower');
    expect(changeClause(down, 'same_period_last_year')).toBe(', −10.0% vs same period last year');
  });
  it('says so when the other period has no data, and says nothing when no comparison is chosen', () => {
    expect(changeClause(null, 'previous_period')).toBe(', no data in the previous period');
    expect(changeClause(null, 'same_period_last_year')).toBe(', no data last year');
    expect(changeClause(null, 'none')).toBe('');
    expect(changeClause({ available: false, reason: 'x' }, 'previous_period')).toBe(', no comparison available');
    expect(overviewTakeaway({ kpi: { downtimeHours: 12, topArea: top }, downtimeChange: null, compare: 'none' }))
      .toBe('12.0 area-hours stopped; K.2 is the largest contributor by failure hours (13.3% of them).');
  });
  it('a previous value of 0 gives hours instead of a percentage; equal values read unchanged', () => {
    expect(changeClause(compareValues(avail(5), avail(0), 'lower'), 'previous_period')).toBe(', +5.0 h vs previous period');
    expect(changeClause(compareValues(avail(5), avail(5), 'lower'), 'previous_period')).toBe(', unchanged vs previous period');
  });
  it('no failures: no invented contributor; no data: the reason', () => {
    expect(overviewTakeaway({ kpi: { downtimeHours: 3, topArea: { available: false } }, downtimeChange: null, compare: 'none' })).toBe('3.0 area-hours stopped; no failures were recorded.');
    expect(overviewTakeaway({ kpi: null, noDataReason: 'No data covers the selected period', downtimeChange: null, compare: 'none' })).toBe('No data covers the selected period');
  });
});

describe('paretoTakeaway', () => {
  it('names the top code and the share of the top three', () => {
    const s = paretoTakeaway({ totalHours: 200, codeCount: 12, top: [{ label: '100.A1', value: 50, sharePct: 25 }, { label: '200.B1', value: 30, sharePct: 15 }, { label: '300.C1', value: 20, sharePct: 10 }] });
    expect(s).toBe('200.0 failure hours on own equipment across 12 codes; 100.A1 leads with 50.0 h (25.0% of the total), and the top 3 codes make up 50.0%.');
  });
  it('handles one code, a blank code label and no hours', () => {
    expect(paretoTakeaway({ totalHours: 4, codeCount: 1, top: [{ label: ' ', value: 4, sharePct: 100 }] })).toContain('(blank code) leads with 4.0 h (100.0% of the total).');
    expect(paretoTakeaway({ totalHours: 0, codeCount: 0, top: [] })).toBe('No failure hours on own equipment in this range.');
    expect(paretoTakeaway(null)).toBe('No data for this range');
  });
});

describe('repeatsTakeaway', () => {
  it('names the group with the most occurrences', () => {
    expect(repeatsTakeaway({ groups: 4, recurrences: 9, equipmentCount: 3, top: { equipmentId: '100.A1', occurrences: 5, totalHours: 7.25, reason: 'Belt slip' }, minEvents: 3, windowDays: 30 }))
      .toBe('4 repeated-failure groups (9 recurrence events) across 3 equipment codes; 100.A1 repeats most, 5 times and 7.3 h (Belt slip).');
  });
  it('explains the rule when there are none', () => {
    expect(repeatsTakeaway({ groups: 0, recurrences: 0, equipmentCount: 0, top: null, minEvents: 3, windowDays: 30 })).toContain('at least 3 events');
  });
});

describe('reliabilityTakeaway', () => {
  it('reads MTBF, mean restoration time and the last two months', () => {
    const s = reliabilityTakeaway({ mtbf: avail(120.4), mttr: avail(1.256), failureEvents: 40, areaId: 'K.1', lastMonths: [{ month: '2026-02', mtbf: 100 }, { month: '2026-03', mtbf: 120 }] });
    expect(s).toBe('MTBF is 120.4 h for K.1 and mean restoration time 1.26 h, over 40 failure events; MTBF in Mar 2026 was 120.0 h, up from 100.0 h in Feb 2026.');
  });
  it('an undefined MTBF keeps its reason and adds no trend', () => {
    const s = reliabilityTakeaway({ mtbf: unavail('no_failures', 'No failures recorded in the window'), mttr: unavail('no_failures', 'x'), failureEvents: 0, areaId: null, lastMonths: [] });
    expect(s).toBe('MTBF is not defined (no failures recorded in the window), over 0 failure events.');
  });
});

import { areaDowntimeTakeaway, causesTakeaway, dailyTakeaway, eventsTakeaway, pointsClause, qualityTakeaway, summaryBullets, whenTakeaway } from './takeaways';

describe('report takeaways (real numbers only)', () => {
  const facts = {
    downtimeHours: 428.3, failureHours: 168, plannedHours: 187.2, otherHours: 73.1, failureCount: 233, failureEventCount: 233, areaCount: 15,
    availability: avail(0.977), basis: 'B' as const, mttr: avail(0.87), topArea: { available: true as const, areaId: 'K.2', sharePct: 13.1 },
    topEquipment: { code: '141.VL170', hours: 12.6 }, repeatGroups: 10, repeatedFailureCount: 10,
    downtimeChange: compareValues(avail(428.3), avail(374.5), 'lower'), availabilityChange: compareValues(avail(0.977), avail(0.978), 'higher'), mttrChange: null,
    compare: 'previous_period' as const, availabilityStatus: null, mttrStatus: null, belowTarget: null,
  };
  it('summary bullets: stoppage with change, availability in points, failures, contributor, repeats', () => {
    const b = summaryBullets(facts);
    expect(b[0]).toBe('428.3 area-hours stopped (168.0 h failures, 187.2 h planned, 73.1 h other), +14.4% vs previous period.');
    expect(b[1]).toBe('Availability (basis B) was 97.7%, −0.1 pts vs previous period.');
    expect(b[2]).toBe('233 failures; mean restoration time 0.87 h.');
    expect(b[3]).toBe('K.2 is the largest contributor by failure hours (13.1% of them); 141.VL170 is the top equipment with 12.6 h.');
    expect(b[4]).toBe('10 repeated-failure groups with 10 recurrence events.');
  });
  it('says what is missing instead of inventing it', () => {
    const b = summaryBullets({ ...facts, failureCount: 0, failureEventCount: 0, mttr: unavail('no_failures', 'x'), topArea: { available: false }, topEquipment: null, repeatGroups: 0, availability: unavail('no_scheduled_time', 'No scheduled time'), compare: 'none' });
    expect(b).toEqual(['428.3 area-hours stopped (168.0 h failures, 187.2 h planned, 73.1 h other).', 'Availability could not be calculated: no scheduled time.', 'No failures were recorded in this period.']);
    expect(pointsClause(null, 'previous_period')).toBe('');
  });
  it('section sentences', () => {
    expect(dailyTakeaway({ days: 0, totalHours: 0, peak: null })).toBe('No daily data in this period.');
    expect(dailyTakeaway({ days: 30, totalHours: 300, peak: { date: '2026-09-05', hours: 28.9 } })).toBe('300.0 area-hours stopped over 30 days (average 10.0 h a day); the highest day was 5 Sep 2026 with 28.9 h.');
    expect(areaDowntimeTakeaway({ total: 100, top: { areaId: 'K.1', hours: 25 }, areaCount: 4 })).toBe('K.1 stopped longest: 25.0 h of the 100.0 h in total (25.0%), across 4 areas.');
    expect(causesTakeaway(null)).toBe('No data for this period');
    expect(whenTakeaway({ measure: 'count', total: 0, peakHour: null, peakDay: null, peakSlot: null })).toBe('No failure events started in this period.');
    expect(eventsTakeaway({ records: 0, shown: 0, all: false, shownHours: 0, totalHours: 0 })).toBe('No records match the filters in this period.');
    expect(qualityTakeaway({ records: 10, leftOut: { count: 1, hours: 2 }, kept: 3, open: 4, voided: 5 })).toBe('10 records were checked: 1 left out of the numbers (2.0 h), 3 kept as entered, 4 with problems still open. 5 voided records are ignored everywhere.');
  });
});
