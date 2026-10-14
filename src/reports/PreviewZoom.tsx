// The report preview's zoom (R4): Fit / 100% and - / + buttons, and a two-finger pinch that works only inside the
// preview (the rest of the app never zooms). See previewZoom.ts for the rules.
import { useEffect, useRef, type RefObject } from 'react';
import { t } from '../i18n/t';
import { anchoredScroll, clampZoom, stepZoom, ZOOM_MAX, ZOOM_MIN, type Zoom } from './previewZoom';

export function ZoomBar({ zoom, scale, onZoom }: { zoom: Zoom; scale: number; onZoom: (z: Zoom) => void }) {
  const pct = Math.round(scale * 100);
  return (
    <div className="rpt-zoom rpt-noprint" role="group" aria-label={t('Page size')} data-testid="rpt-zoom">
      <div className="rpt-zoom-seg">
        <button type="button" aria-pressed={zoom === 'fit'} onClick={() => onZoom('fit')} data-testid="rpt-zoom-fit">{t('Fit')}</button>
        <button type="button" aria-pressed={zoom !== 'fit' && Math.abs(scale - 1) < 0.001} onClick={() => onZoom(1)} data-testid="rpt-zoom-100">100%</button>
      </div>
      <button type="button" className="rpt-zoom-step" onClick={() => onZoom(stepZoom(scale, -1))} disabled={scale <= ZOOM_MIN + 0.001} aria-label={t('Smaller')} data-testid="rpt-zoom-out">−</button>
      <span className="rpt-zoom-level" aria-live="polite" data-testid="rpt-zoom-level">{pct}%</span>
      <button type="button" className="rpt-zoom-step" onClick={() => onZoom(stepZoom(scale, 1))} disabled={scale >= ZOOM_MAX - 0.001} aria-label={t('Larger')} data-testid="rpt-zoom-in">+</button>
    </div>
  );
}

const dist = (a: Touch, b: Touch): number => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

/**
 * Two fingers on the preview: the pages follow the pinch live (a CSS scale on the sheets, no re-render), and the new
 * scale is applied when a finger lifts, keeping the point between the fingers in place. One finger scrolls as usual.
 */
export function usePinchZoom(boxRef: RefObject<HTMLDivElement | null>, sheetsRef: RefObject<HTMLDivElement | null>, scale: number, onZoom: (z: number) => void) {
  const live = useRef({ scale, onZoom });
  live.current = { scale, onZoom };
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    let start: { d: number; scale: number; x: number; y: number } | null = null;
    let ratio = 1;
    const sheets = () => sheetsRef.current;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      const r = box.getBoundingClientRect();
      start = { d: Math.max(1, dist(a, b)), scale: live.current.scale, x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top };
      ratio = 1;
      const s = sheets();
      if (s) s.style.transformOrigin = `${start.x + box.scrollLeft}px ${start.y}px`;
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      ratio = clampZoom(start.scale * (dist(e.touches[0]!, e.touches[1]!) / start.d)) / start.scale;
      const s = sheets();
      if (s) s.style.transform = `scale(${ratio})`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || e.touches.length >= 2) return;
      const s = sheets();
      if (s) {
        s.style.transform = '';
        s.style.transformOrigin = '';
      }
      const from = start;
      start = null;
      if (Math.abs(ratio - 1) < 0.02) return;
      const next = clampZoom(from.scale * ratio);
      const left = anchoredScroll(box.scrollLeft, from.x, next / from.scale);
      live.current.onZoom(next);
      requestAnimationFrame(() => { box.scrollLeft = left; });
    };
    box.addEventListener('touchstart', onStart, { passive: true });
    box.addEventListener('touchmove', onMove, { passive: false });
    box.addEventListener('touchend', onEnd);
    box.addEventListener('touchcancel', onEnd);
    return () => {
      box.removeEventListener('touchstart', onStart);
      box.removeEventListener('touchmove', onMove);
      box.removeEventListener('touchend', onEnd);
      box.removeEventListener('touchcancel', onEnd);
    };
  }, [boxRef, sheetsRef]);
}
