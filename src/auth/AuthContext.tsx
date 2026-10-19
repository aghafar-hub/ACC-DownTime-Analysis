import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ACCESS_DENIED_EVENT, api, SESSION_EXPIRED_EVENT } from '../api';
import type { Access, AccessLevel, ActivityHint, Session, SessionUser, TabId } from '../api/types';
import { ApiError } from '../api/types';
import { forgetDashFilters } from '../dashboard/sharedFilters';
import { clearDataCaches } from '../data/cache';
import { resetDataStores } from '../data/stores';
import { t } from '../i18n/t';
import { store } from '../storagePrefix';

// Session handling. "Keep me signed in" puts the session in localStorage,
// otherwise in sessionStorage. The access levels are re-read from the server
// on load and every 2 minutes, so a change made by an admin shows up without
// a new sign-in. The server decides what is allowed; this only hides.
const SESSION_KEY = 'session';
const REFRESH_MS = 2 * 60 * 1000;

/**
 * The 2-minute access check is also the heartbeat of Settings > Active users (backend 1.6.0): it says which address is
 * open and whether this is a phone or a desktop. Nothing personal; the server keeps the latest per person only.
 */
export function activityHint(): ActivityHint {
  const hint: ActivityHint = {};
  try {
    const path = (window.location.hash.replace(/^#/, '').split(/[?#]/)[0] || '/').slice(0, 80);
    if (/^\/[A-Za-z0-9/_.-]*$/.test(path)) hint.page = path;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches === true;
    const narrow = window.matchMedia?.('(max-width: 767px)').matches === true;
    const small = Math.min(window.screen?.width || 9999, window.screen?.height || 9999) < 600;
    hint.device = narrow || (coarse && small) ? 'phone' : 'desktop';
  } catch {
    /* a hint is optional */
  }
  return hint;
}

interface Stored {
  token: string;
  expires_at: string;
  user: SessionUser;
  must_change: boolean;
  access: Access;
  /** the theme saved with the account (backend 1.5.0); '' when none or from an older server */
  theme?: string;
  /** the server's version (backend 1.10.0); '' from an older server */
  server_version?: string;
}

function readStored(): { stored: Stored; remember: boolean } | null {
  for (const scope of ['local', 'session'] as const) {
    const raw = store.get(SESSION_KEY, scope);
    if (!raw) continue;
    try {
      const s = JSON.parse(raw) as Stored;
      if (s?.token && s.user && s.access && Date.parse(s.expires_at) > Date.now()) return { stored: s, remember: scope === 'local' };
    } catch {
      /* damaged entry: ignore */
    }
    store.remove(SESSION_KEY, scope);
  }
  return null;
}

function writeStored(s: Stored | null, remember: boolean) {
  store.remove(SESSION_KEY, 'local');
  store.remove(SESSION_KEY, 'session');
  if (s) store.set(SESSION_KEY, JSON.stringify(s), remember ? 'local' : 'session');
}

const CACHE_OWNER_KEY = 'cache_owner';

/** Clears the in-memory data and the device cache when they may hold another person's data. */
export async function claimDeviceCache(userId: string): Promise<void> {
  if (store.get(CACHE_OWNER_KEY) === userId) return;
  resetDataStores();
  forgetDashFilters();
  await clearDataCaches();
  store.set(CACHE_OWNER_KEY, userId);
}

export interface AuthState {
  token: string | null;
  user: SessionUser | null;
  access: Access | null;
  mustChange: boolean;
  /** A short sentence for the login page after a session ended. */
  notice: string | null;
  login: (email: string, password: string, keep: boolean) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  logout: (notice?: string) => void;
  levelOf: (tab: TabId) => AccessLevel;
  canView: (tab: TabId) => boolean;
  canEdit: (tab: TabId) => boolean;
  refreshAccess: () => Promise<void>;
  /** The theme saved with the account ('' when none, or the server is older than 1.5.0): it wins over this device's. */
  accountTheme: string;
  /** After the account's theme was saved: remember it with the session (a refresh started earlier cannot undo it). */
  setAccountTheme: (name: string) => void;
  /** The server's version ('' before backend 1.10.0). */
  serverVersion: string;
  /** Backend 1.10.0: ends every session of this person on every device (this one too), then signs out here. */
  signOutEverywhere: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(readStored, []);
  const [stored, setStored] = useState<Stored | null>(initial?.stored ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const remember = useRef<boolean>(initial?.remember ?? true);

  const persist = useCallback((s: Stored | null) => {
    setStored(s);
    writeStored(s, remember.current);
  }, []);

  const logout = useCallback((why?: string) => {
    // a sign-out the person chose is written to the activity log (backend 1.6.0); an ended session is not
    const tok = readStored()?.stored.token;
    if (!why && tok) void api.logout(tok).catch(() => undefined);
    writeStored(null, remember.current);
    setStored(null);
    setNotice(why ?? null);
    resetDataStores();
    forgetDashFilters();
    // the next person sees the 'records left out' notice again (ValidationBanner, once per session)
    store.remove('vbanner_seen', 'session');
    void clearDataCaches();
  }, []);

  const applySession = useCallback((s: Session) => {
    persist({ token: s.token, expires_at: s.expires_at, user: s.user, must_change: s.must_change, access: s.access, theme: s.theme ?? '', server_version: s.server_version ?? '' });
  }, [persist]);

  const login = useCallback(async (email: string, password: string, keep: boolean) => {
    const s = await api.login(email.trim(), password, keep);
    // the device copy belongs to one person: when someone else signs in (the last session ended without a sign-out,
    // for example a closed browser), it is cleared before anything is shown
    await claimDeviceCache(s.user.user_id);
    remember.current = keep;
    setNotice(null);
    applySession(s);
  }, [applySession]);

  const changePassword = useCallback(async (current: string, next: string) => {
    if (!stored) throw new ApiError(t('Please sign in again.'), 'unauthenticated');
    const s = await api.changePassword(stored.token, current, next);
    applySession(s);
  }, [stored, applySession]);

  const storedRef = useRef(stored);
  storedRef.current = stored;
  // bumped by every theme saved from this device: an answer to a refresh that started before it keeps the new theme
  const themeEpoch = useRef(0);
  const setAccountTheme = useCallback((name: string) => {
    themeEpoch.current++;
    const now = storedRef.current;
    if (now && now.theme !== name) persist({ ...now, theme: name });
  }, [persist]);
  const refreshAccess = useCallback(async () => {
    const cur = storedRef.current;
    if (!cur) return;
    const epoch = themeEpoch.current;
    try {
      const r = await api.getMyAccess(cur.token, activityHint());
      const now = storedRef.current;
      if (!now || now.token !== cur.token) return;
      // an older server sends no theme: keep what we have
      const theme = r.theme === undefined || epoch !== themeEpoch.current ? now.theme : r.theme;
      const sv = r.server_version ?? '';
      const same = JSON.stringify([r.user, r.access, r.must_change, theme ?? '', sv]) === JSON.stringify([now.user, now.access, now.must_change, now.theme ?? '', now.server_version ?? '']);
      if (!same) persist({ ...now, user: r.user, access: r.access, must_change: r.must_change, theme, server_version: sv });
    } catch {
      /* offline or a server hiccup: keep what we have; an ended session is reported by the api event */
    }
  }, [persist]);

  // on load, every 2 minutes, when the tab comes back, and after a refusal
  const token = stored?.token;
  useEffect(() => {
    if (!token) return;
    void refreshAccess();
    // the timer skips while the app is in the background (the check runs again when it comes back)
    const id = window.setInterval(() => document.visibilityState !== 'hidden' && void refreshAccess(), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refreshAccess();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(ACCESS_DENIED_EVENT, refreshAccess);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(ACCESS_DENIED_EVENT, refreshAccess);
    };
  }, [token, refreshAccess]);

  // expiry
  const expiresAt = stored?.expires_at;
  useEffect(() => {
    const onEnded = () => logout(t('Your session has ended. Please sign in again.'));
    window.addEventListener(SESSION_EXPIRED_EVENT, onEnded);
    let timer: number | undefined;
    if (expiresAt) {
      const ms = Date.parse(expiresAt) - Date.now();
      // setTimeout cannot wait longer than about 24 days; the 2-minute refresh covers longer sessions
      if (ms <= 0) onEnded();
      else if (ms < 2_000_000_000) timer = window.setTimeout(onEnded, ms);
    }
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, onEnded);
      window.clearTimeout(timer);
    };
  }, [expiresAt, logout]);

  const signOutEverywhere = useCallback(async () => {
    const tok = storedRef.current?.token;
    if (!tok) return;
    await api.signOutEverywhere(tok);
    // the server already wrote it to the activity log: no separate 'signed out' entry
    logout(t('You were signed out on all devices.'));
  }, [logout]);

  const value = useMemo<AuthState>(() => {
    const levelOf = (tab: TabId): AccessLevel => stored?.access[tab] ?? 'Hidden';
    return {
      token: stored?.token ?? null,
      user: stored?.user ?? null,
      access: stored?.access ?? null,
      mustChange: stored?.must_change ?? false,
      notice,
      accountTheme: stored?.theme ?? '',
      serverVersion: stored?.server_version ?? '',
      login, changePassword, logout, refreshAccess, setAccountTheme, signOutEverywhere,
      levelOf,
      canView: (tab) => levelOf(tab) !== 'Hidden',
      canEdit: (tab) => levelOf(tab) === 'Edit',
    };
  }, [stored, notice, login, changePassword, logout, refreshAccess, setAccountTheme, signOutEverywhere]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
