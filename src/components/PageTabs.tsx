import { NavLink, useLocation } from 'react-router-dom';
import { tapHaptic } from '../haptics';
import { useIsMobile } from '../hooks/useIsMobile';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { t } from '../i18n/t';
import { pageForPath, pagesInSection, pageShort, pageTab, sectionLabel } from '../navigation';
import ValidateBadge from '../validate/NavBadge';
import './PageTabs.css';

// Contextual sub-navigation: only the visible sibling pages of the open page's
// section (Analyze, Data or Setup), so it never repeats the left rail. A section
// with one visible page (Setup) gets no row at all, and neither does Settings.
// Desktop: one row of tabs, 3 px accent underline on the open page.
// Phone: the same siblings as chips (at most four, so they always fit).
export default function PageTabs() {
  const pages = useVisiblePages();
  const mobile = useIsMobile();
  const location = useLocation();
  const active = pageForPath(location.pathname);
  if (!active) return null;
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
