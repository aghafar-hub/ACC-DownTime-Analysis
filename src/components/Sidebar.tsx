import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Icon } from '../icons';
import { useRail } from '../hooks/useRail';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { t } from '../i18n/t';
import { pageForPath, pageLabel, pagesInSection, SECTIONS, sectionLabel } from '../navigation';
import { ActionsBadge } from '../actions/ActionsContext';
import ValidateBadge from '../validate/NavBadge';
import './Sidebar.css';

// Left rail (desktop and tablet), always on the navy side-bar colour with the transparent ACC logo straight on it.
// It is the 68 px icon rail at every width; hover or keyboard focus opens the labels OVER the page (the page does not
// move) and it collapses again by itself.
export default function Sidebar() {
  const pages = useVisiblePages();
  const { pinned } = useRail();
  const activePage = pageForPath(useLocation().pathname);
  const base = import.meta.env.BASE_URL;
  const mode = pinned ? 'pinned' : 'icons';
  // choosing a page closes the open rail at once, even with the pointer still on it; it opens again after the pointer
  // has left and comes back
  const [rest, setRest] = useState(false);
  return (
    <div className={`sidebar-rail sidebar-rail--${mode}${rest ? ' sidebar-rail--rest' : ''}`} data-testid="rail" data-mode={mode}>
      <nav
        className="sidebar-panel" aria-label={t('Primary')} data-testid="rail-panel"
        onClick={(e) => { if ((e.target as HTMLElement).closest('a') && e.detail > 0) setRest(true); }}
        onMouseLeave={() => setRest(false)}
      >
        <div className="sidebar-logo">
          <img src={`${base}brand/acc-leaf-mark.png`} alt="" className="sidebar-logo-mark" />
          <span className="sidebar-logo-crop">
            <img src={`${base}brand/acc-logo-full.png`} alt={t('Arabian Cement Company')} className="sidebar-logo-full" />
          </span>
          <span className="sidebar-logo-sub">{t('Downtime Analysis')}</span>
        </div>
        <div className="sidebar-nav">
          {SECTIONS.map((sec) => {
            const items = pagesInSection(pages, sec.id);
            if (items.length === 0) return null;
            // Data (Event Explorer, Validate, Upload) is ONE rail item; its pages are the tabs under the top bar
            const one = sec.id === 'data';
            const first = items[0]!;
            const inData = activePage?.group === 'data';
            return (
              <section key={sec.id} className="sidebar-section" aria-labelledby={`sidebar-sec-${sec.id}`} data-section={sec.id}>
                <h2 className="sidebar-section-title" id={`sidebar-sec-${sec.id}`} data-testid={`rail-section-${sec.id}`}>{sectionLabel(sec.id)}</h2>
                <ul className="sidebar-section-list">
                  {one ? (
                    <li>
                      <NavLink
                        to={first.path} className={inData ? 'sidebar-link sidebar-link--active' : 'sidebar-link'} aria-current={inData ? 'page' : undefined}
                        title={pinned ? undefined : sectionLabel('data')} data-testid="rail-link-data"
                      >
                        <span className="sidebar-link-icon"><Icon name="list" size={18} /></span>
                        <span className="sidebar-link-label">{t('Events & data')}</span>
                        {items.some((p) => p.id === 'validate') && <ValidateBadge testid="validate-badge-rail" />}
                      </NavLink>
                    </li>
                  ) : items.map((p) => (
                    <li key={p.id}>
                      <NavLink to={p.path} className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')} title={pinned ? undefined : pageLabel(p)} data-testid={`rail-link-${p.id}`}>
                        <span className="sidebar-link-icon"><Icon name={p.icon} size={18} /></span>
                        <span className="sidebar-link-label">{pageLabel(p)}</span>
                        {p.id === 'actions' && <ActionsBadge testid="actions-badge-rail" />}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
