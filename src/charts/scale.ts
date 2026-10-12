/** Round axis ticks that cover [min, max]. */
export function niceTicks(min: number, max: number, target = 5): { ticks: number[]; min: number; max: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], min: 0, max: 1 };
  if (max === min) {
    if (max === 0) return { ticks: [0, 1], min: 0, max: 1 };
    min = Math.min(min, 0);
    max = max > 0 ? max * 1.1 : 0;
  }
  const raw = (max - min) / Math.max(1, target);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // derive each tick from an integer multiple and trim float noise (0.6000000000000001 -> 0.6)
  const decimals = Math.max(0, 6 - Math.floor(Math.log10(step)));
  const clean = (v: number): number => Number(v.toFixed(Math.min(decimals, 12)));
  const k0 = Math.round(lo / step);
  const k1 = Math.round(hi / step);
  for (let k = k0; k <= k1; k++) ticks.push(clean(k * step));
  return { ticks, min: clean(k0 * step), max: clean(k1 * step) };
}

export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

/** Which of n labels to draw so each has at least `minPx` of room. */
export function labelEvery(n: number, plotWidth: number, minPx: number): number {
  if (n <= 1) return 1;
  return Math.max(1, Math.ceil((n * minPx) / Math.max(plotWidth, 1)));
}

/** 1,200 -> 1.2k for axis ticks. */
export function axisNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 10000) return `${Math.round(v / 1000)}k`;
  if (a >= 1000) return `${(Math.round(v / 100) / 10).toLocaleString('en-GB')}k`;
  return String(Math.round(v * 100) / 100);
}

/**
 * Start of a zoomed percentage axis: one point below the lowest value (rounded down), never below 0 and always
 * below `cap` so the axis has some width. Non-finite input gives 0 (the full axis).
 */
export function zoomFloor(min: number, cap = 100): number {
  if (!Number.isFinite(min)) return 0;
  return Math.max(0, Math.min(Math.floor(min) - 1, cap - 1));
}
