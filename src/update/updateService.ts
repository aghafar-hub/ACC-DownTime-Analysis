import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { IS_MOCK } from '../config';
import {
  CHECK_INTERVAL_MS,
  INITIAL_UPDATE_STATE,
  shouldCheck,
  updateReducer,
  type CheckReason,
  type UpdateEvent,
  type UpdateState,
} from './updateLogic';

// One place that knows about the service worker. A new version is downloaded
// in the background (registerType 'prompt'); nothing reloads by itself, so a
// half-filled form is never lost. The banner (UpdateBanner.tsx) and Settings >
// Appearance read this state and call applyUpdate() / checkForUpdates().

export type CheckResult = 'found' | 'none' | 'error' | 'unavailable';

let state: UpdateState = INITIAL_UPDATE_STATE;
const listeners = new Set<() => void>();
function dispatch(e: UpdateEvent) {
  const next = updateReducer(state, e);
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
}

let started = false; // module-level guard: one registerSW for the whole page
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | undefined;
let lastCheckAt: number | null = null;
let inFlight: Promise<CheckResult> | null = null;

/** Wait (up to 20 s) for a worker that is installing to finish. */
function waitInstalled(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', onChange);
      resolve(ok);
    };
    const onChange = () => {
      if (worker.state === 'installed' || worker.state === 'activated') done(true);
      else if (worker.state === 'redundant') done(false);
    };
    const timer = setTimeout(() => done(false), 20_000);
    worker.addEventListener('statechange', onChange);
    onChange();
  });
}

async function realCheck(): Promise<CheckResult> {
  if (!registration) return navigator.onLine === false ? 'error' : 'unavailable';
  try {
    await registration.update();
    if (registration.waiting) return 'found';
    if (registration.installing) return (await waitInstalled(registration.installing)) ? 'found' : 'none';
    return 'none';
  } catch {
    return 'error'; // offline or the server is unreachable: stay quiet
  }
}

/**
 * Look for a new version. Automatic triggers are throttled to one a minute;
 * the Settings button (reason 'manual') always runs. Never throws.
 */
export function checkForUpdates(reason: CheckReason = 'manual'): Promise<CheckResult> {
  if (inFlight) return inFlight;
  const now = Date.now();
  if (!shouldCheck(now, lastCheckAt, reason)) return Promise.resolve(state.ready ? 'found' : 'none');
  lastCheckAt = now;
  dispatch({ type: 'cycle' });
  dispatch({ type: 'checkStart' });
  const testCheck = IS_MOCK ? window.__accTestUpdate?.onCheck : undefined;
  inFlight = (testCheck ? testCheck().catch((): CheckResult => 'error') : realCheck()).then((result) => {
    inFlight = null;
    dispatch({ type: 'checkDone', result });
    if (result === 'found') dispatch({ type: 'needRefresh' });
    return result;
  });
  return inFlight;
}

/** Apply the waiting version and reload. */
export function applyUpdate(): void {
  const testApply = IS_MOCK ? window.__accTestUpdate?.onApply : undefined;
  if (testApply) {
    testApply();
    return;
  }
  void updateSW?.(true)?.catch(() => {});
  // safety net: if the worker handover is slow or missing, reload anyway
  setTimeout(() => window.location.reload(), 4000);
}

export function hideBannerForNow(): void {
  dispatch({ type: 'later' });
}

/** Start once, from the app root: registers the worker and the triggers that look for a new version. */
export function startUpdates(): void {
  if (started) return;
  started = true;

  updateSW = registerSW({
    onNeedRefresh: () => dispatch({ type: 'needRefresh' }),
    onRegisteredSW(_url, reg) {
      registration = reg;
      void checkForUpdates('load');
    },
  });

  const onVisible = () => {
    if (document.visibilityState === 'visible') void checkForUpdates('visible');
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', () => void checkForUpdates('focus'));
  window.addEventListener('online', () => void checkForUpdates('online'));
  setInterval(() => void checkForUpdates('interval'), CHECK_INTERVAL_MS);

  if (IS_MOCK) installTestHook();
}

// Test-only hook. It exists only in the demo build (no VITE_API_URL): Playwright
// cannot run a real service worker, so the page flips the same state that
// onNeedRefresh does. A real build never defines it (checked in the deploy).
function installTestHook() {
  const hook = (() => dispatch({ type: 'needRefresh' })) as NonNullable<Window['__accTestUpdate']>;
  window.__accTestUpdate = hook;
  window.addEventListener('acc:update-ready', () => hook());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
