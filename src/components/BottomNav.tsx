import { NavLink, useLocation } from 'react-router-dom';
import { tapHaptic } from '../haptics';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { BOTTOM_BAR_ORDER, isSettingsPath, pageShort } from '../navigation';
import './BottomNav.css';

// The phone's bottom bar (only drawn at 860 px and below): up to three of
// Overview, Events, Upload (or Pareto), then More, which opens the full menu.
export default function BottomNav({ onOpenMore, moreOpen }: { onOpenMore: () => void; moreOpen: boolean }) {
  const pages = useVisiblePages();
  const location = useLocation();
  const slots = BOTTOM_BAR_ORDER.map((id) => pages.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p).slice(0, 3);
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
          <span className="bottom-nav-icon"><Icon name={p.icon} size={22} /></span>
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
        <span className="bottom-nav-icon"><Icon name="menu" size={22} /></span>
        <span>{t('More')}</span>
      </button>
    </nav>
  );
}
