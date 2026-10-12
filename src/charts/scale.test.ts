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
  it('niceTicks has no floating-point noise in its ticks', () => {
    for (const [a, b] of [[0, 0.62], [0, 0.9], [0, 1.7], [0, 0.35], [0.1, 0.7], [0, 3.3]] as const) {
      const r = niceTicks(a, b, 5);
      for (const v of [...r.ticks, r.min, r.max]) expect(String(v).length).toBeLessThanOrEqual(6);
      expect(r.max).toBeGreaterThanOrEqual(b);
    }
    expect(niceTicks(0, 0.62, 5).ticks).toContain(0.6);
    expect(niceTicks(0, 0.62, 5).ticks).not.toContain(0.6000000000000001);
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
