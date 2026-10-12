import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { pageForPath, pageLabel, ROLE_LABELS } from '../navigation';
import { useOnlineStatus } from '../useOnlineStatus';
import './TopBar.css';

export const OPEN_APPEARANCE_EVENT = 'acc-dt-open-appearance';

// Top bar (56 px): breadcrumb "ACC Downtime > Page", online dot, a search
// shortcut to the Event Explorer, the theme picker, and the avatar menu.
export default function TopBar() {
  const { user, logout, canView } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const online = useOnlineStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const page = pageForPath(location.pathname);
  const pageName = page ? pageLabel(page) : '';

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const name = user?.display_name || user?.email || '';
  const initials = (name.match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase();
  const role = user ? t(ROLE_LABELS[user.role_id] || user.role_id) : '';
  const canSearch = canView('events');
  const goSearch = () => navigate('/events', { state: { focusSearch: Date.now() } });
  const openAppearance = () => {
    setMenuOpen(false);
    window.dispatchEvent(new CustomEvent(OPEN_APPEARANCE_EVENT));
  };

  return (
    <header className="shell-topbar">
      <div className="shell-topbar-crumb" data-testid="breadcrumb">
        {mobile ? (
          <span className="shell-topbar-module">{pageName || t('ACC Downtime')}</span>
        ) : (
          <>
            <span className="shell-topbar-module">{t('ACC Downtime')}</span>
            {pageName && (
              <>
                <span className="shell-topbar-sep" aria-hidden="true">›</span>
                <span className="shell-topbar-page">{pageName}</span>
              </>
            )}
          </>
        )}
      </div>

      {canSearch && !mobile && (
        <button type="button" className="shell-topbar-search" onClick={goSearch} data-testid="global-search">
          <Icon name="search" size={15} />
          <span>{t('Search events, codes, reasons')}</span>
        </button>
      )}

      <div className="shell-topbar-actions">
        <span
          className={online ? 'shell-topbar-online shell-topbar-online--up' : 'shell-topbar-online shell-topbar-online--down'}
          title={online ? t('Online') : t('Offline')}
          data-testid="online-dot"
        >
          <span className="shell-topbar-online-dot" />
          <span>{online ? t('Online') : t('Offline')}</span>
        </span>

        {canSearch && mobile && (
          <button type="button" className="shell-topbar-icon-btn gsearch-phone-btn" aria-label={t('Search events')} onClick={goSearch}>
            <Icon name="search" size={18} />
          </button>
        )}

        <button type="button" className="shell-topbar-icon-btn" aria-label={t('Appearance')} title={t('Appearance')} onClick={openAppearance} data-testid="appearance-btn">
          <Icon name="palette" size={18} />
        </button>

        <div className="shell-topbar-user" ref={menuRef}>
          <button
            type="button"
            className="shell-topbar-user-trigger"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid="user-menu-trigger"
          >
            <span className="shell-topbar-avatar">{initials}</span>
            <span className="shell-topbar-user-info">
              <span className="shell-topbar-user-name" data-testid="user-name">{name}</span>
              {role && <span className="shell-topbar-user-role" data-testid="user-role">{role}</span>}
            </span>
            <Icon name="chevronDown" size={14} />
          </button>
          {menuOpen && (
            <div className="shell-topbar-user-menu" role="menu">
              <button type="button" role="menuitem" className="shell-topbar-user-menu-item" onClick={openAppearance}>
                <Icon name="palette" size={15} /> {t('Appearance')}
              </button>
              <button type="button" role="menuitem" className="shell-topbar-user-menu-item" onClick={() => logout()} data-testid="sign-out">
                <Icon name="logout" size={15} /> {t('Sign out')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
