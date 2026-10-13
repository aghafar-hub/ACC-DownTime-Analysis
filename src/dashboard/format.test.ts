import { describe, expect, it } from 'vitest';
import { avail, compareValues } from '../calc';
import { changeText } from '../reports/format';
import { asShown, fh, partialNote } from './format';
import { changeClause } from './takeaways';

describe('a change that rounds to zero is neutral', () => {
  // availability 0.97400 -> 0.97401: +0.001 pts, written as 0.0 pts
  const tiny = compareValues(avail(0.97401), avail(0.974), 'higher');
  const pts = (n: number): string => (n * 100).toFixed(1);
  it('asShown turns it into no change, never better or worse', () => {
    expect(tiny).toMatchObject({ available: true, assessment: 'good', direction: 'up' });
    expect(asShown(tiny, pts)).toMatchObject({ abs: 0, direction: 'flat', assessment: 'neutral' });
    // a real change stays as it is
    const real = compareValues(avail(0.98), avail(0.974), 'higher');
    expect(asShown(real, pts)).toBe(real);
  });
  it('the report and the takeaway say no change / unchanged', () => {
    expect(changeText(tiny, 'pts', 'previous_period')).toMatchObject({ words: 'no change', tone: 'neutral', arrow: '■' });
    const hours = compareValues(avail(100.02), avail(100), 'lower');
    expect(fh(Math.abs(hours.available ? hours.abs : 1))).toBe('0.0');
    expect(changeText(hours, 'h', 'previous_period')).toMatchObject({ words: 'no change', tone: 'neutral' });
    expect(changeClause(compareValues(avail(1000.1), avail(1000), 'lower'), 'previous_period')).toBe(', unchanged vs previous period');
  });
});

describe('partialNote', () => {
  it('says where a partial month starts or ends', () => {
    expect(partialNote({ month: '2026-02', partial: true, window: { from: '2026-02-01', to: '2026-02-10' } })).toBe('Partial month: data to 10 Feb 2026');
    expect(partialNote({ month: '2026-01', partial: true, window: { from: '2026-01-15', to: '2026-01-31' } })).toBe('Partial month: 15 Jan 2026 to 31 Jan 2026');
    expect(partialNote({ month: '2026-01', partial: false, window: { from: '2026-01-01', to: '2026-01-31' } })).toBeUndefined();
  });
});
