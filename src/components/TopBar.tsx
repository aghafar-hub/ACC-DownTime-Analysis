import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ConfirmDialog from '../admin/ConfirmDialog';
import { useAuth } from '../auth/AuthContext';
import { SERVER_1_10, versionAtLeast } from '../auth/serverVersion';
import BellButton from '../notifications/BellButton';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { isNotificationsPath, isSettingsPath, pageForPath, pageLabel, ROLE_LABELS, sectionLabel, settingsSubFromPath, settingsSubLabel } from '../navigation';
import { pageNameForPath } from '../util/docTitle';
import { useOnlineStatus } from '../useOnlineStatus';
import './TopBar.css';

// Top bar (60 px): the breadcrumb "Section > Page" over the page title (phone: app icon and page name), online dot, a search
// shortcut to the Event Explorer, the Settings button (gear, every page, every
// role), the notification bell and the avatar menu.
export default function TopBar() {
  const { user, logout, canView, serverVersion, signOutEverywhere } = useAuth();
  // backend 1.10.0: 'sign out of all devices'
  const [askAll, setAskAll] = useState(false);
  const [allBusy, setAllBusy] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  const canSignOutAll = versionAtLeast(serverVersion, SERVER_1_10);
  const location = useLocation();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const online = useOnlineStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const page = pageForPath(location.pathname);
  const onSettings = isSettingsPath(location.pathname);
  const sub = onSettings ? settingsSubFromPath(location.pathname) : undefined;
  const onInbox = isNotificationsPath(location.pathname);
  // an address with no page (old bookmark, typo) is named as such, not as the app
  const pageName = onSettings ? t('Settings') : onInbox ? t('Notifications') : page ? pageLabel(page) : location.pathname !== '/' ? pageNameForPath(location.pathname) : '';
  const subName = sub ? settingsSubLabel(sub) : '';

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
  // Ctrl K (Cmd K on a Mac) opens the search, like the hint in the box says
  const searchRef = useRef(goSearch);
  searchRef.current = goSearch;
  useEffect(() => {
    if (!canSearch) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canSearch]);
  return (
    <header className="shell-topbar">
      {mobile ? (
        <div className="shell-topbar-crumb" data-testid="breadcrumb">
          <img src={`${import.meta.env.BASE_URL}icons/pwa-192.png`} alt="" className="shell-topbar-appicon" />
          <span className="shell-topbar-module" data-testid="topbar-title">{pageName || t('ACC Downtime')}</span>
        </div>
      ) : (
        <div className="shell-topbar-titles">
          <div className="shell-topbar-crumb" data-testid="breadcrumb">
            {onInbox && (
              <>
                <span className="shell-topbar-page" data-testid="breadcrumb-section">{sectionLabel('act')}</span>
                <span className="shell-topbar-sep" aria-hidden="true">›</span>
              </>
            )}
            {page && !onSettings && sectionLabel(page.group) !== pageName && (
              <>
                <span className="shell-topbar-page" data-testid="breadcrumb-section">{sectionLabel(page.group)}</span>
                <span className="shell-topbar-sep" aria-hidden="true">›</span>
              </>
            )}
            {pageName ? <span className="shell-topbar-page">{pageName}</span> : <span className="shell-topbar-page">{t('ACC Downtime')}</span>}
            {subName && (
              <>
                <span className="shell-topbar-sep" aria-hidden="true">›</span>
                <span className="shell-topbar-page" data-testid="breadcrumb-sub">{subName}</span>
              </>
            )}
          </div>
          <div className="shell-topbar-title" data-testid="topbar-title">{subName || pageName || t('ACC Downtime')}</div>
        </div>
      )}

      {canSearch && !mobile && (
        <button type="button" className="shell-topbar-search" onClick={goSearch} data-testid="global-search">
          <Icon name="search" size={15} />
          <span>{t('Search events, codes, reasons')}</span>
          <kbd className="shell-topbar-kbd" aria-hidden="true">Ctrl K</kbd>
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

        <Link
          to="/settings"
          className={onSettings ? 'shell-topbar-settings shell-topbar-settings--active' : 'shell-topbar-settings'}
          aria-label={t('Settings')}
          aria-current={onSettings ? 'page' : undefined}
          title={t('Settings')}
          data-testid="settings-btn"
        >
          <Icon name="settings" size={18} />
          <span className="shell-topbar-settings-label">{t('Settings')}</span>
        </Link>

        <BellButton />

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
              <button type="button" role="menuitem" className="shell-topbar-user-menu-item" onClick={() => logout()} data-testid="sign-out">
                <Icon name="logout" size={15} /> {t('Sign out')}
              </button>
              {canSignOutAll && (
                <button type="button" role="menuitem" className="shell-topbar-user-menu-item" onClick={() => { setMenuOpen(false); setAllError(null); setAskAll(true); }} data-testid="sign-out-all">
                  <Icon name="logout" size={15} /> {t('Sign out of all devices')}
                </button>
              )}
            </div>
          )}
        </div>
        {askAll && (
          <ConfirmDialog
            title={t('Sign out of all devices?')} danger confirmLabel={t('Sign out everywhere')} busy={allBusy} testid="sign-out-all-dialog"
            onCancel={() => setAskAll(false)}
            onConfirm={() => {
              setAllBusy(true);
              signOutEverywhere().catch((e: unknown) => { setAllBusy(false); setAllError(e instanceof Error ? e.message : String(e)); });
            }}
          >
            {t('Every place you are signed in ends now: phones, tablets, other computers and this one. Use it when a device was lost or shared. You sign in again with your password.')}
            {allError && <p className="at-bad-text" role="alert" data-testid="sign-out-all-error">{allError}</p>}
          </ConfirmDialog>
        )}
      </div>
    </header>
  );
}
