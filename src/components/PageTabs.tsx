import { NavLink, useLocation } from 'react-router-dom';
import { tapHaptic } from '../haptics';
import { useIsMobile } from '../hooks/useIsMobile';
import { useRail } from '../hooks/useRail';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { t } from '../i18n/t';
import { pageForPath, pagesInSection, pageShort, pageTab, sectionLabel } from '../navigation';
import ValidateBadge from '../validate/NavBadge';
import './PageTabs.css';

// Contextual sub-navigation: only the visible sibling pages of the open page's
// section (Analyze, Data or Setup), so it never repeats the left rail. A section
// with one visible page (Setup) gets no row at all, and neither does Settings.
// Desktop (icon rail only; the pinned labelled rail lists the pages itself): one row of tabs, 3 px accent underline on the open page.
// Phone: the same siblings as chips (at most four, so they always fit).
export default function PageTabs() {
  const pages = useVisiblePages();
  const mobile = useIsMobile();
  const { pinned } = useRail();
  const location = useLocation();
  // '/' is about to become the first page: draw its tabs already, so the page does not jump when it opens
  const active = location.pathname === '/' ? pages[0] : pageForPath(location.pathname);
  if (!active) return null;
  // the pinned, labelled rail already lists every page: no second row of tabs (the icon rail keeps them)
  if (!mobile && pinned) return null;
  const siblings = pagesInSection(pages, active.group);
  if (siblings.length < 2 || !siblings.some((p) => p.id === active.id)) return null;
  const label = t('{section} pages', { section: sectionLabel(active.group) });

  if (!mobile) {
    return (
      <div className="module-tabs" data-testid="page-tabs" data-section={active.group}>
        <nav className="module-tabs-row" aria-label={t('Pages')}>
          {siblings.map((p) => (
            <NavLink key={p.id} to={p.path} className={({ isActive }) => (isActive ? 'module-tab module-tab--active' : 'module-tab')} data-page={p.id}>
              {pageTab(p)}
              {p.id === 'validate' && <ValidateBadge testid="validate-badge-tab" />}
            </NavLink>
          ))}
        </nav>
      </div>
    );
  }

  return (
    <div className="module-tabs" data-testid="page-tabs" data-section={active.group}>
      <div className="module-tabs-phone">
        <nav className="mt-strip mt-strip--fit" aria-label={label} data-testid="page-strip">
          {siblings.map((p) => (
            <NavLink key={p.id} to={p.path} onClick={tapHaptic} className={({ isActive }) => (isActive ? 'mt-chip mt-chip--on' : 'mt-chip')} data-phone-page={p.id}>
              {pageShort(p)}
              {p.id === 'validate' && <ValidateBadge testid="validate-badge-chip" />}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
