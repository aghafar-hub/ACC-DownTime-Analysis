import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ACCESS_DENIED_EVENT, api, SESSION_EXPIRED_EVENT } from '../api';
import type { Access, AccessLevel, Session, SessionUser, TabId } from '../api/types';
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

interface Stored {
  token: string;
  expires_at: string;
  user: SessionUser;
  must_change: boolean;
  access: Access;
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
    writeStored(null, remember.current);
    setStored(null);
    setNotice(why ?? null);
    resetDataStores();
    forgetDashFilters();
    void clearDataCaches();
  }, []);

  const applySession = useCallback((s: Session) => {
    persist({ token: s.token, expires_at: s.expires_at, user: s.user, must_change: s.must_change, access: s.access });
  }, [persist]);

  const login = useCallback(async (email: string, password: string, keep: boolean) => {
    const s = await api.login(email.trim(), password, keep);
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
  const refreshAccess = useCallback(async () => {
    const cur = storedRef.current;
    if (!cur) return;
    try {
      const r = await api.getMyAccess(cur.token);
      const now = storedRef.current;
      if (!now || now.token !== cur.token) return;
      const same = JSON.stringify([r.user, r.access, r.must_change]) === JSON.stringify([now.user, now.access, now.must_change]);
      if (!same) persist({ ...now, user: r.user, access: r.access, must_change: r.must_change });
    } catch {
      /* offline or a server hiccup: keep what we have; an ended session is reported by the api event */
    }
  }, [persist]);

  // on load, every 2 minutes, when the tab comes back, and after a refusal
  const token = stored?.token;
  useEffect(() => {
    if (!token) return;
    void refreshAccess();
    const id = window.setInterval(() => void refreshAccess(), REFRESH_MS);
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

  const value = useMemo<AuthState>(() => {
    const levelOf = (tab: TabId): AccessLevel => stored?.access[tab] ?? 'Hidden';
    return {
      token: stored?.token ?? null,
      user: stored?.user ?? null,
      access: stored?.access ?? null,
      mustChange: stored?.must_change ?? false,
      notice,
      login, changePassword, logout, refreshAccess,
      levelOf,
      canView: (tab) => levelOf(tab) !== 'Hidden',
      canEdit: (tab) => levelOf(tab) === 'Edit',
    };
  }, [stored, notice, login, changePassword, logout, refreshAccess]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
