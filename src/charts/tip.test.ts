import { describe, expect, it } from 'vitest';
import { clampTipShift } from './ChartKit';

const view = { left: 0, top: 54, right: 390, bottom: 786 }; // under a 54 px top bar, above a 58 px bottom bar

describe('clampTipShift', () => {
  it('leaves a tooltip that fits where it is', () => {
    expect(clampTipShift({ left: 20, top: 200, right: 220, bottom: 320 }, view)).toEqual({ dx: 0, dy: 0 });
  });
  it('lifts a tooltip that would go under the bottom bar', () => {
    expect(clampTipShift({ left: 20, top: 700, right: 220, bottom: 820 }, view)).toEqual({ dx: 0, dy: -42 });
  });
  it('pulls it back inside the left and right edges', () => {
    expect(clampTipShift({ left: 300, top: 200, right: 450, bottom: 300 }, view)).toEqual({ dx: -68, dy: 0 });
    expect(clampTipShift({ left: -30, top: 200, right: 120, bottom: 300 }, view)).toEqual({ dx: 38, dy: 0 });
  });
  it('keeps the top readable when it is taller than the room', () => {
    expect(clampTipShift({ left: 20, top: 100, right: 220, bottom: 1000 }, view)).toEqual({ dx: 0, dy: -38 });
  });
});
