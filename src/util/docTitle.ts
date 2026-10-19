// The browser tab's title for an address (phase 5): '<page name> · ACC Downtime' with the side-bar names, so open tabs,
// the history list and bookmarks tell the pages apart. Pure; DocumentTitle sets it on every navigation.
import { t } from '../i18n/t';
import { isNotificationsPath, pageForPath, pageLabel, SETTINGS_SUBS } from '../navigation';

export const APP_TITLE = 'ACC Downtime';

/** The page name for a router pathname ('/dashboard', '/settings/users', '/nowhere'). */
export function pageNameForPath(pathname: string): string {
  if (pathname === '/login') return t('Sign in');
  if (pathname === '/change-password') return t('Change password');
  if (isNotificationsPath(pathname)) return t('Notifications');
  if (pathname === '/settings' || pathname.startsWith('/settings/')) {
    const sub = SETTINGS_SUBS.find((s) => s.id === pathname.split('/')[2]);
    return sub ? `${t('Settings')} › ${t(sub.label)}` : t('Settings');
  }
  if (pathname === '/actions/tasks') return `${t('Actions')} › ${t('Tasks')}`;
  if (pathname === '/actions/shutdown') return `${t('Actions')} › ${t('Shutdown list')}`;
  const page = pageForPath(pathname);
  if (page) return pageLabel(page);
  // '/' sends on to the first page; until then the tab keeps the app's name alone
  if (pathname === '/' || pathname === '') return '';
  return t('Page not found');
}

/** 'Causes · ACC Downtime'; the app's name alone where there is no page name. */
export function documentTitle(pathname: string): string {
  const name = pageNameForPath(pathname);
  return name ? `${name} · ${APP_TITLE}` : APP_TITLE;
}
