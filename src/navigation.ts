import type { TabId } from './api/types';
import { t } from './i18n/t';

// The app's pages. Each page id is also its tab id in the access model, so
// "which pages does this person see" is decided by the levels the server
// returns (Hidden pages never appear).
/** A page of the app. Every id is a tab id, except Validate: it is part of the events tab (View to see, Edit to fix). */
export type PageId = TabId | 'validate';

export interface PageDef {
  id: PageId;
  /** The tab whose View or Edit level decides who sees the page and who may change things on it. */
  access: TabId;
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
  { id: 'overview', access: 'overview', path: '/overview', label: 'Overview', tab: 'Overview', short: 'Overview', icon: 'dashboard', group: 'dashboard' },
  { id: 'pareto', access: 'pareto', path: '/pareto', label: 'Pareto & Contributors', tab: 'Pareto', short: 'Pareto', icon: 'limits', group: 'dashboard' },
  { id: 'repeats', access: 'repeats', path: '/repeats', label: 'Repeated Failures', tab: 'Repeated Failures', short: 'Repeats', icon: 'repeat', group: 'dashboard' },
  { id: 'reliability', access: 'reliability', path: '/reliability', label: 'Reliability Trends', tab: 'Reliability', short: 'Reliability', icon: 'trend', group: 'dashboard' },
  { id: 'events', access: 'events', path: '/events', label: 'Event Explorer', tab: 'Event Explorer', short: 'Events', icon: 'list', group: 'dashboard' },
  { id: 'validate', access: 'events', path: '/validate', label: 'Validate', tab: 'Validate', short: 'Validate', icon: 'compliance', group: 'dashboard' },
  { id: 'upload', access: 'upload', path: '/upload', label: 'Upload', tab: 'Upload', short: 'Upload', icon: 'upload', group: 'admin' },
  { id: 'master', access: 'master', path: '/master', label: 'Master Data', tab: 'Master Data', short: 'Master data', icon: 'database', group: 'admin' },
];

// Settings and Users are not in the main navigation: they are reached from the
// gear in the top bar. Their tab ids still control who sees which Settings subtab.
const GEAR_TABS: PageDef[] = [
  { id: 'settings', access: 'settings', path: '/settings', label: 'Settings', tab: 'Settings', short: 'Settings', icon: 'settings', group: 'admin' },
  { id: 'users', access: 'users', path: '/settings/users', label: 'Users', tab: 'Users', short: 'Users', icon: 'users', group: 'admin' },
];

export const pageById = (id: PageId): PageDef => PAGES.find((p) => p.id === id) ?? GEAR_TABS.find((p) => p.id === id)!;
export const pageForPath = (pathname: string): PageDef | undefined => PAGES.find((p) => pathname === p.path || pathname.startsWith(`${p.path}/`));
export const pageLabel = (p: PageDef): string => t(p.label);
export const pageTab = (p: PageDef): string => t(p.tab);
export const pageShort = (p: PageDef): string => t(p.short);

/** The first three of these that the person may see go on the phone bottom bar (Upload before Pareto for those who upload). */
export const BOTTOM_BAR_ORDER: PageId[] = ['overview', 'events', 'upload', 'pareto', 'repeats'];

export const ROLE_LABELS: Record<string, string> = {
  'ROLE-ADMIN': 'Admin',
  'ROLE-MGR': 'Manager',
  'ROLE-ENG': 'Engineer',
  'ROLE-VIEW': 'Viewer',
};

// The Settings page's subtabs. To add one (for example Validate), add a line here, a
// component in src/admin/settings/ and a case in src/pages/Settings.tsx.
export interface SettingsSub {
  id: string;
  label: string;
  /** Needs View on this tab; null means everyone sees it. */
  tab: TabId | null;
  icon: string;
  blurb: string;
}

export const SETTINGS_SUBS: SettingsSub[] = [
  { id: 'appearance', label: 'Appearance', tab: null, icon: 'palette', blurb: 'Theme and install. Kept on this device.' },
  { id: 'calculations', label: 'Calculations', tab: 'settings', icon: 'trend', blurb: 'How availability, repeated failures and durations are worked out.' },
  { id: 'security', label: 'Security', tab: 'settings', icon: 'shield', blurb: 'Sign-in limits, sessions and passwords.' },
  { id: 'users', label: 'Users and access', tab: 'users', icon: 'users', blurb: 'Who can sign in and which pages they can open.' },
];

export const settingsSubById = (id: string | undefined): SettingsSub | undefined => SETTINGS_SUBS.find((s) => s.id === id);
export const settingsSubLabel = (s: SettingsSub): string => t(s.label);
/** The subtab named by a path such as /settings/security (undefined for /settings). */
export const settingsSubFromPath = (pathname: string): SettingsSub | undefined => settingsSubById(/^\/settings\/([^/]+)/.exec(pathname)?.[1]);
export const isSettingsPath = (pathname: string): boolean => pathname === '/settings' || pathname.startsWith('/settings/');
