// Report preview zoom (R4): 'Fit' scales the A4 pages to the screen width, a number is a fixed scale (1 = real size,
// the pages then scroll sideways inside the preview only). Pure helpers; the controls and the pinch are in
// PreviewZoom.tsx. The page itself never zooms (the app blocks the browser's pinch zoom, see mobile/viewport.ts).

export type Zoom = 'fit' | number;

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;
/** the stops of the - and + buttons */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
}

/** The scale the pages are drawn at: Fit never enlarges past real size. */
export function scaleOf(zoom: Zoom, fit: number): number {
  return zoom === 'fit' ? fit : clampZoom(zoom);
}

/** The next stop up (+1) or down (-1) from the scale on screen. */
export function stepZoom(scale: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > scale + 0.001) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < scale - 0.001) ?? ZOOM_MIN;
}

/**
 * After a pinch around a point: the new scroll offset that keeps the point under the fingers.
 * `offset` is the scroll position, `at` the point's distance from the preview's edge, `ratio` new scale / old scale.
 */
export function anchoredScroll(offset: number, at: number, ratio: number): number {
  return Math.max(0, (offset + at) * ratio - at);
}

/** Smallest text a phone reader should get on screen (inspection: the phone preview opened at 45 %, text about 6 px). */
export const READABLE_PX = 12;

/**
 * The scale a narrow screen opens at: Fit when the paper's body text is already readable at Fit, otherwise the
 * smallest zoom stop at which it is (the pages then scroll sideways inside the preview). `bodyPx`: the paper's usual
 * text size at real size; `fit`: the Fit scale.
 */
export function readableZoom(bodyPx: number, fit: number, minPx = READABLE_PX): Zoom {
  if (!(bodyPx > 0) || bodyPx * fit >= minPx) return 'fit';
  return ZOOM_STEPS.find((s) => bodyPx * s >= minPx - 0.01) ?? ZOOM_MAX;
}

/** The middle value of the text sizes found on the paper (px), or 0 without any. */
export function medianPx(sizes: number[]): number {
  const v = sizes.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}
