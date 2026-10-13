import { NavLink } from 'react-router-dom';
import { Icon } from '../icons';
import { useRail } from '../hooks/useRail';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { t } from '../i18n/t';
import { pageLabel, pagesInSection, SECTIONS, sectionLabel } from '../navigation';
import ValidateBadge from '../validate/NavBadge';
import './Sidebar.css';

// Left rail (desktop and tablet), always on the navy side-bar colour with the transparent ACC logo straight on it.
// At 1280 px and wider it is pinned open with labels (232 px) unless the person collapses it; otherwise it is the
// 68 px icon rail, and hover or keyboard focus opens the labels OVER the page (the page does not move).
export default function Sidebar() {
  const pages = useVisiblePages();
  const { wide, pinned, toggle } = useRail();
  const base = import.meta.env.BASE_URL;
  const mode = pinned ? 'pinned' : 'icons';
  return (
    <div className={`sidebar-rail sidebar-rail--${mode}`} data-testid="rail" data-mode={mode}>
      <nav className="sidebar-panel" aria-label={t('Primary')} data-testid="rail-panel">
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
            return (
              <section key={sec.id} className="sidebar-section" aria-labelledby={`sidebar-sec-${sec.id}`} data-section={sec.id}>
                <h2 className="sidebar-section-title" id={`sidebar-sec-${sec.id}`} data-testid={`rail-section-${sec.id}`}>{sectionLabel(sec.id)}</h2>
                <ul className="sidebar-section-list">
                  {items.map((p) => (
                    <li key={p.id}>
                      <NavLink to={p.path} className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')} title={pinned ? undefined : pageLabel(p)} data-testid={`rail-link-${p.id}`}>
                        <span className="sidebar-link-icon"><Icon name={p.icon} size={18} /></span>
                        <span className="sidebar-link-label">{pageLabel(p)}</span>
                        {p.id === 'validate' && <ValidateBadge testid="validate-badge-rail" />}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        {wide && (
          <div className="sidebar-foot">
            <button
              type="button" className="sidebar-link sidebar-toggle" onClick={toggle} aria-pressed={!pinned}
              title={pinned ? t('Collapse menu') : t('Expand menu')} data-testid="rail-toggle"
            >
              <span className="sidebar-link-icon"><Icon name={pinned ? 'chevronsLeft' : 'chevronsRight'} size={18} /></span>
              <span className="sidebar-link-label">{pinned ? t('Collapse menu') : t('Keep menu open')}</span>
            </button>
          </div>
        )}
      </nav>
    </div>
  );
}
