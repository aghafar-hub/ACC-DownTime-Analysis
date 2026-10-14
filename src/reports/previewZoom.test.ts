import { describe, expect, it } from 'vitest';
import { anchoredScroll, clampZoom, scaleOf, stepZoom } from './previewZoom';

describe('report preview zoom', () => {
  it('Fit uses the fitted scale, a number is the real scale (clamped)', () => {
    expect(scaleOf('fit', 0.45)).toBe(0.45);
    expect(scaleOf(1, 0.45)).toBe(1);
    expect(scaleOf(9, 0.45)).toBe(2);
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
  it('+ and - move to the next stop from what is on screen', () => {
    expect(stepZoom(0.45, 1)).toBe(0.5);
    expect(stepZoom(0.45, -1)).toBe(0.25);
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });
  it('a pinch keeps the point under the fingers', () => {
    expect(anchoredScroll(0, 100, 2)).toBe(100);
    expect(anchoredScroll(50, 100, 0.5)).toBe(0);
  });
});
