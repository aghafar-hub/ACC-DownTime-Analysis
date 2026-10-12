import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { tapHaptic } from '../haptics';
import { useIsMobile } from '../hooks/useIsMobile';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { pageForPath, pageShort, pageTab } from '../navigation';
import { OPEN_MORE_EVENT } from '../mobile/MoreSheet';
import './PageTabs.css';

// The pages as tabs under the top bar (design system D2).
// Desktop: one row of tabs, 3 px accent underline on the open page.
// Phone: a strip of page chips that always fits (no sideways swipe) plus
// "More", which opens the More sheet with every page.
export default function PageTabs() {
  const pages = useVisiblePages();
  const mobile = useIsMobile();
  const location = useLocation();
  const stripRef = useRef<HTMLElement>(null);
  const active = pageForPath(location.pathname);
  // how many chips fit beside "More" with full names; starts at 4 and drops until nothing is cut off
  const [fitN, setFitN] = useState(4);
  useEffect(() => {
    const reset = () => setFitN(4);
    reset();
    window.addEventListener('resize', reset);
    return () => window.removeEventListener('resize', reset);
  }, [active?.id, mobile]);
  useLayoutEffect(() => {
    const s = stripRef.current;
    if (s && s.offsetParent && fitN > 1 && s.scrollWidth > s.clientWidth + 1) setFitN(fitN - 1);
  });

  if (pages.length === 0) return null;

  if (!mobile) {
    return (
      <div className="module-tabs" data-testid="page-tabs">
        <nav className="module-tabs-row" aria-label={t('Pages')}>
          {pages.map((p) => (
            <NavLink key={p.id} to={p.path} className={({ isActive }) => (isActive ? 'module-tab module-tab--active' : 'module-tab')} data-page={p.id}>
              {pageTab(p)}
            </NavLink>
          ))}
        </nav>
      </div>
    );
  }

  let shown = pages.slice(0, fitN);
  if (active && !shown.some((p) => p.id === active.id) && pages.some((p) => p.id === active.id)) shown = [...shown.slice(0, fitN - 1), active];
  const moreOn = !!active && !shown.some((p) => p.id === active.id);
  return (
    <div className="module-tabs" data-testid="page-tabs">
      <div className="module-tabs-phone">
        <nav className="mt-strip mt-strip--fit" ref={stripRef} aria-label={t('Pages')} data-testid="page-strip">
          {shown.map((p) => (
            <NavLink key={p.id} to={p.path} onClick={tapHaptic} className={({ isActive }) => (isActive ? 'mt-chip mt-chip--on' : 'mt-chip')} data-phone-page={p.id}>
              {pageShort(p)}
            </NavLink>
          ))}
          {pages.length > shown.length && (
            <button
              type="button"
              className={moreOn ? 'mt-chip mt-chip--more mt-chip--on' : 'mt-chip mt-chip--more'}
              data-testid="strip-more"
              onClick={() => { tapHaptic(); window.dispatchEvent(new CustomEvent(OPEN_MORE_EVENT)); }}
            >
              {t('More')} <Icon name="chevronDown" size={13} />
            </button>
          )}
        </nav>
      </div>
    </div>
  );
}
