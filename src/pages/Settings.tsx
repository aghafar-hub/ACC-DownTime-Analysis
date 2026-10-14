import { Suspense } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Tile';
import { tapHaptic } from '../haptics';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { SETTINGS_SUBS, settingsSubById, settingsSubLabel, type SettingsSub } from '../navigation';
import { store } from '../storagePrefix';
import { lazyPage } from '../routes/lazyPages';
import { PageSkeleton } from '../routes/PageFallback';
import NoAccess from './NoAccess';
import '../components/ui.css';
import './Settings.css';

const LAST_SUB_KEY = 'settings_sub';

// each subtab is its own chunk (R5): hover or focus on its tab starts the download
const SUBS = {
  appearance: lazyPage(() => import('../admin/settings/Appearance')),
  notifications: lazyPage(() => import('../admin/settings/Notifications')),
  calculations: lazyPage(() => import('../admin/settings/Calculations')),
  actions: lazyPage(() => import('../admin/settings/ActionsTargets')),
  security: lazyPage(() => import('../admin/settings/Security')),
  users: lazyPage(() => import('../admin/settings/UsersAccess')),
};
const subFor = (id: string) => SUBS[id as keyof typeof SUBS] ?? SUBS.appearance;
const preloadSub = (id: string) => void subFor(id).preload().catch(() => undefined);

/** The subtabs this person may open: Appearance always, the rest need View on their tab. */
export function useVisibleSubs(): SettingsSub[] {
  const { canView } = useAuth();
  return SETTINGS_SUBS.filter((s) => s.tab === null || canView(s.tab));
}

function Body({ id }: { id: string }) {
  const Sub = subFor(id).Component;
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Sub />
    </Suspense>
  );
}

/** Settings: a bar of subtabs (Appearance, Calculations, Security, Users and access) under one page header. */
export default function Settings() {
  const { sub } = useParams();
  const visible = useVisibleSubs();
  const current = settingsSubById(sub);

  // /settings and unknown names go to the subtab used last (if still allowed), else Appearance
  if (!current) {
    const remembered = store.get(LAST_SUB_KEY);
    const target = visible.find((s) => s.id === remembered) ?? visible[0];
    return <Navigate to={`/settings/${target.id}`} replace />;
  }
  if (!visible.some((s) => s.id === current.id)) return <NoAccess />;
  store.set(LAST_SUB_KEY, current.id);

  return (
    <div className="page" data-testid="page-settings" data-sub={current.id}>
      <PageHeader title={t('Settings')} subtitle={t(current.blurb)} />
      <nav className="set-tabs" aria-label={t('Settings sections')} data-testid="settings-tabs">
        {visible.map((s) => (
          <NavLink
            key={s.id}
            to={`/settings/${s.id}`}
            onClick={tapHaptic}
            className={({ isActive }) => (isActive ? 'set-tab set-tab--active' : 'set-tab')}
            data-sub={s.id}
            onPointerEnter={() => preloadSub(s.id)}
            onFocus={() => preloadSub(s.id)}
          >
            <Icon name={s.icon} size={15} />
            <span>{settingsSubLabel(s)}</span>
          </NavLink>
        ))}
      </nav>
      <Body id={current.id} />
    </div>
  );
}
