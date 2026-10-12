import { describe, expect, it } from 'vitest';
import { avail, compareValues, unavail } from '../calc';
import { changeClause, overviewTakeaway, paretoTakeaway, reliabilityTakeaway, repeatsTakeaway } from './takeaways';

const up = compareValues(avail(1157.5), avail(1096.1), 'lower');
const top = { available: true as const, areaId: 'K.2', sharePct: 13.3 };

describe('overviewTakeaway', () => {
  it('reads hours, the change against the previous period and the largest contributor', () => {
    const s = overviewTakeaway({ kpi: { downtimeHours: 1157.5, topArea: top }, downtimeChange: up, compare: 'previous_period' });
    expect(s).toBe('1,157.5 area-hours stopped, +5.6% vs previous period; K.2 is the largest contributor (13.3% of failure hours).');
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
      .toBe('12.0 area-hours stopped; K.2 is the largest contributor (13.3% of failure hours).');
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
    expect(s).toBe('MTBF is 120.4 h for K.1 and mean restoration time 1.26 h, over 40 failure events; MTBF in Mar 26 was 120.0 h, up from 100.0 h in Feb 26.');
  });
  it('an undefined MTBF keeps its reason and adds no trend', () => {
    const s = reliabilityTakeaway({ mtbf: unavail('no_failures', 'No failures recorded in the window'), mttr: unavail('no_failures', 'x'), failureEvents: 0, areaId: null, lastMonths: [] });
    expect(s).toBe('MTBF is not defined (no failures recorded in the window), over 0 failure events.');
  });
});
