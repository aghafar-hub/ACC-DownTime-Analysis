import { NavLink, useLocation } from 'react-router-dom';
import { tapHaptic } from '../haptics';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { bottomBarPages, isSettingsPath, pageShort } from '../navigation';
import { MoreCountBadge } from '../validate/NavBadge';
import { ActionsBadge } from '../actions/ActionsContext';
import './BottomNav.css';

/** The overdue actions on the bottom bar's Actions icon (same number as the rail badge). */
function ActionsCount() {
  return <span className="bottom-nav-actions"><ActionsBadge testid="actions-badge-bottom" /></span>;
}

// The phone's bottom bar (only drawn at 860 px and below): four pages (Dashboard, Pareto, Actions, Events;
// the next visible ones stand in for any the person cannot see), then More, which opens the full menu.
export default function BottomNav({ onOpenMore, moreOpen }: { onOpenMore: () => void; moreOpen: boolean }) {
  const pages = useVisiblePages();
  const location = useLocation();
  const slots = bottomBarPages(pages);
  // the gear in the header owns /settings, so no bottom-bar item is lit there
  const onSlot = slots.some((p) => location.pathname.startsWith(p.path)) || isSettingsPath(location.pathname);
  return (
    <nav className="bottom-nav" aria-label={t('Primary')} style={{ gridTemplateColumns: `repeat(${slots.length + 1}, 1fr)` }} data-testid="bottom-nav">
      {slots.map((p) => (
        <NavLink
          key={p.id}
          to={p.path}
          onClick={tapHaptic}
          className={({ isActive }) => (isActive && !moreOpen ? 'bottom-nav-item bottom-nav-item--active tap-scale' : 'bottom-nav-item tap-scale')}
          data-testid={`bottom-${p.id}`}
        >
          <span className="bottom-nav-icon"><Icon name={p.icon} size={22} />{p.id === 'actions' && <ActionsCount />}</span>
          <span>{pageShort(p)}</span>
        </NavLink>
      ))}
      <button
        type="button"
        className={moreOpen || !onSlot ? 'bottom-nav-item bottom-nav-item--active tap-scale' : 'bottom-nav-item tap-scale'}
        aria-haspopup="dialog"
        onClick={() => { tapHaptic(); onOpenMore(); }}
        data-testid="bottom-more"
      >
        <span className="bottom-nav-icon"><Icon name="menu" size={22} /><MoreCountBadge /></span>
        <span>{t('More')}</span>
      </button>
    </nav>
  );
}
