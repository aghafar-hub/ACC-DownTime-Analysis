import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

// Route-level code splitting (R5). Every signed-in page is its own chunk, so the
// sign-in screen and the shell load without the dashboards, the calc-heavy pages
// or the admin screens. `preload` starts the download early (hover or focus on a
// navigation item, idle time on the sign-in screen) and is safe to call often:
// the import runs once, and a failed download is retried on the next call.

export interface LazyPage<P extends object = object> {
  Component: LazyExoticComponent<ComponentType<P>>;
  preload: () => Promise<unknown>;
}

export function lazyPage<P extends object = object>(load: () => Promise<{ default: ComponentType<P> }>): LazyPage<P> {
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const preload = () => {
    pending ??= load().catch((err: unknown) => {
      pending = null;
      throw err;
    });
    return pending;
  };
  return { Component: lazy(preload), preload };
}

export const DashboardPage = lazyPage(() => import('../pages/Dashboard'));
export const ParetoPage = lazyPage(() => import('../pages/Pareto'));
export const RepeatsPage = lazyPage(() => import('../pages/Repeats'));
export const ReliabilityPage = lazyPage(() => import('../pages/Reliability'));
export const ReportsPage = lazyPage(() => import('../pages/Reports'));
export const EventExplorerPage = lazyPage(() => import('../pages/EventExplorer'));
export const ValidatePage = lazyPage(() => import('../pages/Validate'));
export const UploadPage = lazyPage(() => import('../pages/Upload'));
export const MasterPage = lazyPage(() => import('../pages/Master'));
export const SettingsPage = lazyPage(() => import('../pages/Settings'));
export const ActionsPage = lazyPage(() => import('../pages/Actions'));
export const NotificationsPage = lazyPage(() => import('../pages/Notifications'));

// Address prefix -> chunk. '/overview' is the old Dashboard address.
const BY_PATH: [string, LazyPage][] = [
  ['/dashboard', DashboardPage],
  ['/overview', DashboardPage],
  ['/pareto', ParetoPage],
  ['/repeats', RepeatsPage],
  ['/reliability', ReliabilityPage],
  ['/reports', ReportsPage],
  ['/actions', ActionsPage],
  ['/notifications', NotificationsPage],
  ['/events', EventExplorerPage],
  ['/validate', ValidatePage],
  ['/upload', UploadPage],
  ['/master', MasterPage],
  ['/settings', SettingsPage],
  ['/users', SettingsPage],
];

/** Starts loading the page behind an app address ('/pareto', '#/events?x=1', '/settings/users'). Unknown addresses are ignored. */
export function preloadPath(path: string | null | undefined): void {
  if (!path) return;
  const clean = path.replace(/^.*#/, '').split(/[?#]/)[0];
  const hit = BY_PATH.find(([p]) => clean === p || clean.startsWith(`${p}/`));
  if (hit) void hit[1].preload().catch(() => undefined);
}

/** Runs `fn` when the browser is idle (requestIdleCallback, or a short timeout where it is missing). Returns a cancel function. */
export function whenIdle(fn: () => void, timeout = 2000): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 200);
  return () => window.clearTimeout(id);
}
