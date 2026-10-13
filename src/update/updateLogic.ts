// Pure rules for "is there a new version?": when to look, and what to show.
// No browser calls in here so they can be unit tested (updateLogic.test.ts).

/** Look for a new version at most once a minute, however many triggers fire. */
export const MIN_CHECK_GAP_MS = 60_000;
/** While the app stays open, look every 10 minutes. */
export const CHECK_INTERVAL_MS = 10 * 60_000;

export type CheckReason = 'load' | 'visible' | 'focus' | 'online' | 'interval' | 'manual';

/** True when enough time has passed since the last check. A manual check is never held back by the throttle. */
export function shouldCheck(now: number, lastCheckAt: number | null, reason: CheckReason, minGapMs = MIN_CHECK_GAP_MS): boolean {
  if (reason === 'manual') return true;
  if (lastCheckAt === null) return true;
  // a clock that moved backwards must not block checks forever
  if (now < lastCheckAt) return true;
  return now - lastCheckAt >= minGapMs;
}

export type UpdateStatus = 'idle' | 'checking' | 'ready' | 'uptodate' | 'error' | 'unavailable';

export interface UpdateState {
  /** A new version is downloaded and waiting. */
  ready: boolean;
  /** The person chose "Later": the banner stays hidden until the next check cycle or page load. */
  dismissed: boolean;
  checking: boolean;
  /** Result of the last check: null before any. */
  last: 'found' | 'none' | 'error' | 'unavailable' | null;
}

export const INITIAL_UPDATE_STATE: UpdateState = { ready: false, dismissed: false, checking: false, last: null };

export type UpdateEvent =
  | { type: 'needRefresh' }
  | { type: 'checkStart' }
  | { type: 'checkDone'; result: 'found' | 'none' | 'error' | 'unavailable' }
  | { type: 'later' }
  | { type: 'cycle' };

export function updateReducer(s: UpdateState, e: UpdateEvent): UpdateState {
  switch (e.type) {
    case 'needRefresh':
      return { ...s, ready: true, dismissed: false, checking: false, last: 'found' };
    case 'checkStart':
      return s.checking ? s : { ...s, checking: true };
    case 'checkDone':
      // a version that is already waiting stays waiting, whatever a later check says
      return { ...s, checking: false, last: s.ready ? 'found' : e.result };
    case 'later':
      return s.dismissed ? s : { ...s, dismissed: true };
    case 'cycle':
      // a new check cycle brings the banner back
      return s.dismissed ? { ...s, dismissed: false } : s;
  }
}

export function bannerVisible(s: UpdateState): boolean {
  return s.ready && !s.dismissed;
}

export function statusOf(s: UpdateState): UpdateStatus {
  if (s.ready) return 'ready';
  if (s.checking) return 'checking';
  if (s.last === 'none') return 'uptodate';
  if (s.last === 'error') return 'error';
  if (s.last === 'unavailable') return 'unavailable';
  return 'idle';
}

export function statusText(st: UpdateStatus): string {
  switch (st) {
    case 'ready': return 'New version available';
    case 'checking': return 'Checking…';
    case 'uptodate': return 'Up to date';
    case 'error': return 'Could not check. Try again when you are online.';
    case 'unavailable': return 'Update checks are not available in this browser.';
    case 'idle': return 'Up to date';
  }
}

/** The one-line reason under the headline: a form or popup being open changes it. */
export function bannerReason(formOpen: boolean): string {
  return formOpen ? 'Finish what you are doing, then reload.' : 'Reload to get the latest improvements.';
}
