import type { TabId } from './api/types';
import { t } from './i18n/t';

// The app's pages. Each page id is also its tab id in the access model, so
// "which pages does this person see" is decided by the levels the server
// returns (Hidden pages never appear).
export interface PageDef {
  id: TabId;
  path: string;
  /** Full name: page header, breadcrumb, left rail. */
  label: string;
  /** Name on the desktop page tabs. */
  tab: string;
  /** Short name for the phone chips and bottom bar. */
  short: string;
  icon: string;
  group: 'dashboard' | 'admin';
}

export const PAGES: PageDef[] = [
  { id: 'overview', path: '/overview', label: 'Overview', tab: 'Overview', short: 'Overview', icon: 'dashboard', group: 'dashboard' },
  { id: 'pareto', path: '/pareto', label: 'Pareto & Contributors', tab: 'Pareto', short: 'Pareto', icon: 'limits', group: 'dashboard' },
  { id: 'repeats', path: '/repeats', label: 'Repeated Failures', tab: 'Repeated Failures', short: 'Repeats', icon: 'repeat', group: 'dashboard' },
  { id: 'reliability', path: '/reliability', label: 'Reliability Trends', tab: 'Reliability', short: 'Reliability', icon: 'trend', group: 'dashboard' },
  { id: 'events', path: '/events', label: 'Event Explorer', tab: 'Event Explorer', short: 'Events', icon: 'list', group: 'dashboard' },
  { id: 'upload', path: '/upload', label: 'Upload', tab: 'Upload', short: 'Upload', icon: 'upload', group: 'admin' },
  { id: 'master', path: '/master', label: 'Master Data', tab: 'Master Data', short: 'Master data', icon: 'database', group: 'admin' },
  { id: 'settings', path: '/settings', label: 'Settings', tab: 'Settings', short: 'Settings', icon: 'settings', group: 'admin' },
  { id: 'users', path: '/users', label: 'Users', tab: 'Users', short: 'Users', icon: 'users', group: 'admin' },
];

export const pageById = (id: TabId): PageDef => PAGES.find((p) => p.id === id)!;
export const pageForPath = (pathname: string): PageDef | undefined => PAGES.find((p) => pathname === p.path || pathname.startsWith(`${p.path}/`));
export const pageLabel = (p: PageDef): string => t(p.label);
export const pageTab = (p: PageDef): string => t(p.tab);
export const pageShort = (p: PageDef): string => t(p.short);

/** The first three of these that the person may see go on the phone bottom bar (Upload before Pareto for those who upload). */
export const BOTTOM_BAR_ORDER: TabId[] = ['overview', 'events', 'upload', 'pareto', 'repeats'];

export const ROLE_LABELS: Record<string, string> = {
  'ROLE-ADMIN': 'Admin',
  'ROLE-MGR': 'Manager',
  'ROLE-ENG': 'Engineer',
  'ROLE-VIEW': 'Viewer',
};
