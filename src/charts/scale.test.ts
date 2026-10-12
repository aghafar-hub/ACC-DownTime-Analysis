import { describe, expect, it } from 'vitest';
import { axisNum, labelEvery, linear, niceTicks } from './scale';

describe('scale helpers', () => {
  it('niceTicks covers the data with round steps', () => {
    const r = niceTicks(0, 87, 5);
    expect(r.min).toBe(0);
    expect(r.max).toBeGreaterThanOrEqual(87);
    expect(r.ticks[1]! - r.ticks[0]!).toBeGreaterThan(0);
    expect(niceTicks(0, 0).ticks).toEqual([0, 1]);
    const flat = niceTicks(5, 5);
    expect(flat.max).toBeGreaterThanOrEqual(5);
  });
  it('linear maps and tolerates a flat domain', () => {
    expect(linear(0, 10, 100, 0)(5)).toBe(50);
    expect(linear(3, 3, 0, 10)(3)).toBe(0);
  });
  it('labelEvery thins labels to fit', () => {
    expect(labelEvery(12, 600, 40)).toBe(1);
    expect(labelEvery(90, 300, 40)).toBeGreaterThan(5);
  });
  it('axisNum shortens thousands', () => {
    expect(axisNum(1200)).toBe('1.2k');
    expect(axisNum(15000)).toBe('15k');
    expect(axisNum(7.5)).toBe('7.5');
  });
});
