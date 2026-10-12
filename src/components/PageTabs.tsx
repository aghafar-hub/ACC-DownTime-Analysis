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
  // How many chips fit beside "More" with full names: start at 4 and drop one at a
  // time until nothing is cut off. The count starts again whenever the open page,
  // the layout or the screen width changes (derived from `key`, so no effect can undo a drop).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onResize = () => setTick((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const key = `${active?.id ?? ''}|${mobile}|${tick}|${pages.length}`;
  const [fit, setFit] = useState({ key, n: 4 });
  const fitN = fit.key === key ? fit.n : 4;
  useLayoutEffect(() => {
    const s = stripRef.current;
    if (s && s.offsetParent && fitN > 1 && s.scrollWidth > s.clientWidth + 1) setFit({ key, n: fitN - 1 });
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
