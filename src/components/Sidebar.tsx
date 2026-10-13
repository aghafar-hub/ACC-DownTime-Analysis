import { NavLink } from 'react-router-dom';
import { Icon } from '../icons';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { t } from '../i18n/t';
import { pageLabel, pagesInSection, SECTIONS, sectionLabel } from '../navigation';
import ValidateBadge from '../validate/NavBadge';
import './Sidebar.css';

// Left rail (desktop and tablet): 68 px with the leaf mark, 248 px with the
// full logo and labels on hover or focus. Always the dark sidebar colour,
// in every theme. The app icon is the collapsed mark; the company logo shows when the rail opens and on the login screen.
export default function Sidebar() {
  const pages = useVisiblePages();
  const base = import.meta.env.BASE_URL;
  return (
    <div className="sidebar-rail">
      <nav className="sidebar-nav-root" aria-label={t('Primary')}>
        <div className="sidebar-logo">
          <img src={`${base}icons/pwa-192.png`} alt="" className="sidebar-logo-mark" />
          <img src={`${base}brand/acc-logo-full.png`} alt={t('ACC Downtime Analysis')} className="sidebar-logo-full" />
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
                      <NavLink to={p.path} className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')} title={pageLabel(p)}>
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
      </nav>
    </div>
  );
}
