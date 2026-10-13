// A table box whose column headings stay in view while the PAGE scrolls (Event Explorer, Repeats, Master data,
// Validate). The box scrolls sideways for wide tables, which makes it a scroll container, so CSS `position: sticky`
// would only stick inside the box (that never scrolls up or down) and the headings scrolled away with the page.
// Here the heading cells are moved down by the part of the box that has gone under the top bar, never past the box.
import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** The bottom edge of the bars that stay on top of the page (top bar, update banner, phone page tabs). */
function stuckTop(): number {
  let top = 0;
  for (const el of document.querySelectorAll<HTMLElement>('.shell-topbar, .module-tabs, .update-banner')) {
    const pos = getComputedStyle(el).position;
    if (pos !== 'sticky' && pos !== 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.top <= 1 + top) top = Math.max(top, r.bottom);
  }
  return top;
}

export function useStickyHead(ref: React.RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const wrap = ref.current;
    if (!wrap) return undefined;
    let raf = 0;
    let last = -1;
    const update = () => {
      raf = 0;
      const head = wrap.querySelector('thead');
      if (!head) return;
      const box = wrap.getBoundingClientRect();
      const off = Math.round(Math.max(0, Math.min(stuckTop() - box.top, box.height - head.offsetHeight - 2)));
      if (off === last) return;
      last = off;
      for (const th of head.querySelectorAll<HTMLElement>('th')) th.style.transform = off > 0 ? `translateY(${off}px)` : '';
      wrap.classList.toggle('is-stuck', off > 0);
    };
    const later = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('resize', later);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { last = -1; later(); });
    ro?.observe(wrap);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', later);
      window.removeEventListener('resize', later);
      ro?.disconnect();
    };
  }, [ref]);
}

export default function StickyTableWrap({ className = '', testid, children }: { className?: string; testid?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useStickyHead(ref);
  return <div ref={ref} className={`table-wrap table-wrap--sticky ${className}`.trim()} data-testid={testid}>{children}</div>;
}
