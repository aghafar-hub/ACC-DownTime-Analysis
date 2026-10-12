import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// Coming back to a page puts you where you were: the scroll position is
// remembered per page (route + module page) for this visit, and a new page
// starts at the top. The module pages keep their own filters and tabs.
const saved = new Map<string, number>();

export default function ScrollKeeper() {
  const location = useLocation();
  const key = `${location.pathname}${location.search}`;
  const keyRef = useRef(key);

  useEffect(() => {
    // A tap that changes page can make the page shorter, and the browser
    // then trims the scroll before the new page is known here — so the
    // position is taken at the tap, and scroll events right after it are
    // ignored.
    let frozenUntil = 0;
    const onTap = () => {
      saved.set(keyRef.current, window.scrollY);
      frozenUntil = Date.now() + 700;
    };
    const onScroll = () => {
      if (Date.now() < frozenUntil) return;
      saved.set(keyRef.current, window.scrollY);
    };
    document.addEventListener('pointerdown', onTap, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onTap, true);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    const y = saved.get(key) || 0;
    if (y === 0) {
      window.scrollTo(0, 0);
      return;
    }
    // The page may still be drawing (charts, lists): wait until it is tall
    // enough, then scroll once and stop. Any tap, key or wheel cancels.
    let stop = false;
    const cancel = () => (stop = true);
    const opts = { passive: true, capture: true } as AddEventListenerOptions;
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, cancel, opts));
    const started = Date.now();
    const tick = () => {
      if (stop || keyRef.current !== key) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max >= y - 2) {
        window.scrollTo(0, y);
        return;
      }
      if (Date.now() - started < 2000) setTimeout(tick, 100);
      else window.scrollTo(0, max);
    };
    requestAnimationFrame(() => requestAnimationFrame(tick));
    return () => {
      stop = true;
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.removeEventListener(ev, cancel, opts));
    };
  }, [key]);

  return null;
}
