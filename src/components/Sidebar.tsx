import { NavLink } from 'react-router-dom';
import { Icon } from '../icons';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { t } from '../i18n/t';
import { pageLabel } from '../navigation';
import './Sidebar.css';

// Left rail (desktop and tablet): 68 px with the leaf mark, 248 px with the
// full logo and labels on hover or focus. Always the dark sidebar colour,
// in every theme. The logo appears only here and on the login screen.
export default function Sidebar() {
  const pages = useVisiblePages();
  const base = import.meta.env.BASE_URL;
  return (
    <div className="sidebar-rail">
      <nav className="sidebar-nav-root" aria-label={t('Primary')}>
        <div className="sidebar-logo">
          <img src={`${base}brand/acc-leaf-mark.png`} alt="" className="sidebar-logo-mark" />
          <img src={`${base}brand/acc-logo-full.png`} alt={t('ACC Downtime Analysis')} className="sidebar-logo-full" />
        </div>
        <ul className="sidebar-nav">
          {pages.map((p, i) => (
            <li key={p.id} className={i > 0 && pages[i - 1].group !== p.group ? 'sidebar-group-start' : undefined}>
              <NavLink to={p.path} className={({ isActive }) => (isActive ? 'sidebar-link sidebar-link--active' : 'sidebar-link')} title={pageLabel(p)}>
                <span className="sidebar-link-icon"><Icon name={p.icon} size={18} /></span>
                <span className="sidebar-link-label">{pageLabel(p)}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
