import { describe, expect, it } from 'vitest';
import {
  bannerReason,
  bannerVisible,
  CHECK_INTERVAL_MS,
  INITIAL_UPDATE_STATE,
  MIN_CHECK_GAP_MS,
  shouldCheck,
  statusOf,
  statusText,
  updateReducer,
  type UpdateEvent,
  type UpdateState,
} from './updateLogic';

const run = (events: UpdateEvent[], from: UpdateState = INITIAL_UPDATE_STATE) => events.reduce(updateReducer, from);

describe('shouldCheck (throttle)', () => {
  it('checks when nothing has been checked yet', () => {
    expect(shouldCheck(1000, null, 'load')).toBe(true);
  });
  it('holds back automatic triggers inside one minute', () => {
    for (const r of ['visible', 'focus', 'online', 'interval'] as const) {
      expect(shouldCheck(10_000 + MIN_CHECK_GAP_MS - 1, 10_000, r)).toBe(false);
      expect(shouldCheck(10_000 + MIN_CHECK_GAP_MS, 10_000, r)).toBe(true);
    }
  });
  it('never holds back the Check for updates button', () => {
    expect(shouldCheck(10_001, 10_000, 'manual')).toBe(true);
  });
  it('survives a clock that moved backwards', () => {
    expect(shouldCheck(5_000, 10_000, 'focus')).toBe(true);
  });
  it('the interval is 10 minutes and longer than the throttle', () => {
    expect(CHECK_INTERVAL_MS).toBe(600_000);
    expect(CHECK_INTERVAL_MS).toBeGreaterThan(MIN_CHECK_GAP_MS);
  });
});

describe('update state', () => {
  it('starts hidden with no result', () => {
    expect(bannerVisible(INITIAL_UPDATE_STATE)).toBe(false);
    expect(statusOf(INITIAL_UPDATE_STATE)).toBe('idle');
  });
  it('shows the banner once a new version is waiting', () => {
    const s = run([{ type: 'needRefresh' }]);
    expect(bannerVisible(s)).toBe(true);
    expect(statusOf(s)).toBe('ready');
    expect(statusText('ready')).toBe('New version available');
  });
  it('Later hides it and the next check cycle brings it back', () => {
    const hidden = run([{ type: 'needRefresh' }, { type: 'later' }]);
    expect(bannerVisible(hidden)).toBe(false);
    expect(statusOf(hidden)).toBe('ready'); // Settings still says so
    expect(bannerVisible(updateReducer(hidden, { type: 'cycle' }))).toBe(true);
  });
  it('a cycle with nothing dismissed changes nothing', () => {
    const s = run([{ type: 'needRefresh' }]);
    expect(updateReducer(s, { type: 'cycle' })).toBe(s);
  });
  it('walks checking, then up to date', () => {
    expect(statusOf(run([{ type: 'checkStart' }]))).toBe('checking');
    const done = run([{ type: 'checkStart' }, { type: 'checkDone', result: 'none' }]);
    expect(statusOf(done)).toBe('uptodate');
    expect(statusText('uptodate')).toBe('Up to date');
    expect(statusText('checking')).toBe('Checking…');
  });
  it('reports a failed or impossible check without claiming up to date', () => {
    expect(statusOf(run([{ type: 'checkStart' }, { type: 'checkDone', result: 'error' }]))).toBe('error');
    expect(statusOf(run([{ type: 'checkStart' }, { type: 'checkDone', result: 'unavailable' }]))).toBe('unavailable');
  });
  it('a waiting version is not overwritten by a later "nothing new" answer', () => {
    const s = run([{ type: 'needRefresh' }, { type: 'checkStart' }, { type: 'checkDone', result: 'none' }]);
    expect(statusOf(s)).toBe('ready');
  });
  it('a found version ends the checking state', () => {
    const s = run([{ type: 'checkStart' }, { type: 'needRefresh' }]);
    expect(s.checking).toBe(false);
    expect(statusOf(s)).toBe('ready');
  });
});

describe('banner wording', () => {
  it('asks to finish the form first when one is open', () => {
    expect(bannerReason(true)).toBe('Finish what you are doing, then reload.');
    expect(bannerReason(false)).toBe('Reload to get the latest improvements.');
  });
});
