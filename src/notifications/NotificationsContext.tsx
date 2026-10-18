import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, describeError } from '../api';
import type { Notification, NotificationPrefKey, NotificationPrefs, NotificationState, NotificationStateValue } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { store } from '../storagePrefix';
import { t, tn } from '../i18n/t';
import { useValidationOptional } from '../validate/ValidationContext';
import { formatStamp, parseStamp } from './age';
import { deriveActionItems } from './derive';
import { inactiveAreaIds } from '../data/activeAreas';
import { storedTarget, type LinkEnv } from './links';
import { applyRecent, buildFeed, RECENT_KEEP_MS, restoreState, settleState, snoozeUntilStamp, stateMap, withState, type Feed, type RecentChange } from './merge';
import type { FeedItem } from './model';
import { parsePrefs, type Prefs } from './prefs';

// One shared copy of the notification feed. It loads the person's stored alerts and updates (getNotifications) when they
// sign in, when the window comes back into focus and every 5 minutes, joins them with the action items the app derives
// from its loaded data, and applies the person's own state (snoozed, dismissed, seen) and preferences (alert types, watched
// areas). A failed refresh keeps the last result and says nothing (the Online dot already reports the connection).
const POLL_MS = 5 * 60 * 1000;
const TICK_MS = 60 * 1000;

export type SaveResult = { ok: true } | { ok: false; error: string };

export interface NotificationsState extends Feed {
  /** the first successful load has happened */
  loaded: boolean;
  /** the last refresh failed; what is shown is the last good result */
  stale: boolean;
  prefs: Prefs;
  /** stored alerts and updates as the server sent them (before the person's filters) */
  stored: readonly Notification[];
  /** a sentence for screen readers when new items arrived in a refresh */
  announcement: string;
  /** the last failed change (snooze, dismiss, seen, watch areas), in plain words; null when none */
  actionError: string | null;
  clearActionError: () => void;
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  refresh: () => Promise<void>;
  markSeen: (ids: readonly string[]) => Promise<void>;
  /** acknowledge one item (same as marking it seen) */
  ack: (id: string) => Promise<boolean>;
  snooze: (id: string, days: number) => Promise<boolean>;
  dismiss: (id: string) => Promise<boolean>;
  savePrefs: (patch: Partial<Record<NotificationPrefKey, string>>) => Promise<SaveResult>;
  /** the time the person last looked at "Since your last visit" (server value or this device's, whichever is later) */
  lastSeenAt: string;
  /** the person has looked: moves last-seen to now */
  markVisited: () => Promise<void>;
}

const ctx = createContext<NotificationsState | null>(null);

const localKey = (userId: string): string => `last_seen_${userId}`;
const laterOf = (a: string, b: string): string => ((parseStamp(a) ?? -1) >= (parseStamp(b) ?? -1) ? a : b);

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

interface Payload { items: Notification[]; state: NotificationState[]; prefs: NotificationPrefs }

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { token, user, canView, canEdit } = useAuth();
  const v = useValidationOptional();
  const nowMs = useNow();
  const userId = user?.user_id ?? '';
  const [payload, setPayload] = useState<Payload | null>(null);
  const [stale, setStale] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [localSeen, setLocalSeen] = useState('');

  // the latest values for the async code below
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const nowRef = useRef(nowMs);
  nowRef.current = nowMs;
  const loading = useRef(false);
  const known = useRef<Set<string> | null>(null);
  // changes sent but not answered yet: a refresh that lands meanwhile must not undo them
  const pendingState = useRef(new Map<string, NotificationState>());
  const pendingPrefs = useRef(new Map<string, string>());
  // changes saved from this device in the last minutes, also kept on the device: a refresh that was already on its way
  // (or a reload) cannot bring a dismissed item back
  const recent = useRef(new Map<string, RecentChange>());
  const recentKey = (uid: string) => `notif_recent_${uid}`;
  const remember = useCallback((uid: string, row: NotificationState | null, id: string) => {
    if (row) recent.current.set(id, { row, at: Date.now() });
    else recent.current.delete(id);
    const keep = [...recent.current.values()].filter((c) => Date.now() - c.at <= RECENT_KEEP_MS);
    if (keep.length) store.set(recentKey(uid), JSON.stringify(keep));
    else store.remove(recentKey(uid));
  }, []);
  const prefsQueue = useRef<Promise<unknown>>(Promise.resolve());

  const overlay = useCallback((p: Payload): Payload => {
    let state = applyRecent(p.state, recent.current.values(), Date.now());
    for (const row of pendingState.current.values()) state = settleState(state, row);
    const prefs = { ...p.prefs };
    for (const [k, val] of pendingPrefs.current) prefs[k] = val;
    return { ...p, state, prefs };
  }, []);

  const refresh = useCallback(async () => {
    const tok = tokenRef.current;
    if (!tok || loading.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    loading.current = true;
    try {
      const r = await api.getNotifications(tok);
      if (tokenRef.current !== tok) return;
      setPayload(overlay({ items: r.items ?? [], state: r.state ?? [], prefs: r.prefs ?? {} }));
      setStale(false);
      // new items since the last refresh: told to screen readers
      const ids = new Set((r.items ?? []).map((n) => n.notification_id));
      const before = known.current;
      known.current = ids;
      if (before) {
        const fresh = (r.items ?? []).filter((n) => !before.has(n.notification_id)).length;
        if (fresh > 0) setAnnouncement(tn(fresh, '{n} new notification', '{n} new notifications'));
      }
    } catch {
      if (tokenRef.current === tok) setStale(true);
    } finally {
      loading.current = false;
    }
  }, [overlay]);

  // sign-in, focus, every 5 minutes; nothing while signed out
  useEffect(() => {
    if (!token) {
      setPayload(null);
      known.current = null;
      setStale(false);
      return undefined;
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, refresh]);

  useEffect(() => {
    setLocalSeen(userId ? store.get(localKey(userId)) ?? '' : '');
    // this person's recent changes made on this device (another person's are never applied)
    recent.current = new Map();
    if (!userId) return;
    try {
      const list = JSON.parse(store.get(recentKey(userId)) ?? '[]') as RecentChange[];
      for (const c of list) if (c?.row?.notification_id && Date.now() - c.at <= RECENT_KEEP_MS) recent.current.set(c.row.notification_id, c);
    } catch {
      /* a damaged entry: start empty */
    }
    setPayload((p) => (p ? { ...p, state: applyRecent(p.state, recent.current.values(), Date.now()) } : p));
  }, [userId]);

  // ---------------------------------------------------------------- derived action items
  const access = useMemo(
    () => ({ editEvents: canEdit('events'), editMaster: canEdit('master'), viewEvents: canView('events'), viewMaster: canView('master') }),
    [canEdit, canView],
  );
  const startup = v?.st.startup ?? null;
  const needsReview = useMemo(() => (startup ? startup.equipment.filter((e) => e.needs_review).length : null), [startup]);
  const ready = !!v?.ready;
  const summary = v?.list.summary;
  const rows = v?.rows ?? null;
  const derived = useMemo(
    () => deriveActionItems({
      validation: ready && summary ? { total: summary.total, blocked: summary.blocked.count } : null,
      events: ready ? rows : null,
      needsReview,
      access,
    }),
    [ready, summary, rows, needsReview, access],
  );

  // ---------------------------------------------------------------- the feed
  const years = startup?.years ?? [];
  const yearOfEvent = useMemo(() => {
    const cache = new Map<string, number | undefined>();
    return (id: string): number | undefined => {
      if (cache.has(id)) return cache.get(id);
      const e = rows?.find((r) => r.event_id === id);
      const y = e ? Number(String(e.event_date).slice(0, 4)) : undefined;
      cache.set(id, y);
      return y;
    };
  }, [rows]);
  const env = useMemo<LinkEnv>(() => ({ canView, years, yearOfEvent }), [canView, years, yearOfEvent]);
  const prefs = useMemo(() => parsePrefs(payload?.prefs), [payload?.prefs]);
  // alerts about an area switched off are not shown (backend 1.5.0 leaves them out too; this also covers an area
  // switched off since the last refresh). Overdue actions stay: the action itself is still on the Actions page.
  const offKey = inactiveAreaIds(startup).join('|');
  const storedItems = useMemo(() => {
    const items = payload?.items ?? [];
    if (!offKey) return items;
    const off = new Set(offKey.split('|'));
    return items.filter((n) => !(n.area_id && off.has(n.area_id) && n.type !== 'action_due'));
  }, [payload?.items, offKey]);
  const feed = useMemo(
    () => buildFeed({
      stored: storedItems, state: payload?.state ?? [], prefs, derived, nowMs,
      target: (n) => {
        const tg = storedTarget(n, env);
        return { link: tg.link, linkLabel: tg.label };
      },
    }),
    [payload, storedItems, prefs, derived, nowMs, env],
  );

  // ---------------------------------------------------------------- changes (optimistic, rolled back when refused)
  const fail = useCallback((err: unknown) => setActionError(describeError(err, t('That did not work. Check the connection and try again.'))), []);

  const change = useCallback(async (id: string, state: NotificationStateValue, snoozeUntil?: string): Promise<boolean> => {
    const tok = tokenRef.current;
    const cur = payloadRef.current;
    if (!tok || !cur || !userId) return false;
    const previous = stateMap(cur.state).get(id);
    const optimistic = withState(cur.state, userId, id, state, snoozeUntil, nowRef.current);
    const row = optimistic.find((r) => r.notification_id === id)!;
    pendingState.current.set(id, row);
    remember(userId, row, id); // at once: a reload before the answer keeps it too
    setPayload((p) => (p ? { ...p, state: settleState(p.state, row) } : p));
    try {
      const saved = await api.setNotificationState(tok, id, state, snoozeUntil);
      pendingState.current.delete(id);
      remember(userId, saved, id);
      setPayload((p) => (p ? { ...p, state: settleState(p.state, saved) } : p));
      return true;
    } catch (err) {
      pendingState.current.delete(id);
      remember(userId, null, id);
      setPayload((p) => (p ? { ...p, state: restoreState(p.state, id, previous) } : p));
      fail(err);
      return false;
    }
  }, [userId, fail, remember]);

  const markSeen = useCallback(async (ids: readonly string[]) => {
    // a few at a time: the server takes one notification per call
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) await change(id, 'seen');
    };
    await Promise.all([worker(), worker(), worker()]);
  }, [change]);
  const ack = useCallback((id: string) => change(id, 'seen'), [change]);
  const snooze = useCallback((id: string, days: number) => change(id, 'snoozed', snoozeUntilStamp(days, Date.now())), [change]);
  const dismiss = useCallback((id: string) => change(id, 'dismissed'), [change]);

  const savePrefs = useCallback((patch: Partial<Record<NotificationPrefKey, string>>): Promise<SaveResult> => {
    const run = async (): Promise<SaveResult> => {
      const tok = tokenRef.current;
      if (!tok) return { ok: false, error: t('Please sign in again.') };
      const before = payloadRef.current?.prefs ?? {};
      const entries = Object.entries(patch).filter(([, val]) => val !== undefined) as [string, string][];
      for (const [k, val] of entries) pendingPrefs.current.set(k, val);
      setPayload((p) => (p ? { ...p, prefs: { ...p.prefs, ...Object.fromEntries(entries) } } : p));
      try {
        const saved = await api.saveNotificationPrefs(tok, patch);
        for (const [k] of entries) pendingPrefs.current.delete(k);
        setPayload((p) => (p ? { ...p, prefs: saved } : p));
        return { ok: true };
      } catch (err) {
        for (const [k] of entries) pendingPrefs.current.delete(k);
        setPayload((p) => {
          if (!p) return p;
          const prefsBack = { ...p.prefs };
          for (const [k] of entries) {
            if (k in before) prefsBack[k] = before[k]!;
            else delete prefsBack[k];
          }
          return { ...p, prefs: prefsBack };
        });
        return { ok: false, error: describeError(err, t('That did not save. Check the connection and try again.')) };
      }
    };
    const next = prefsQueue.current.then(run, run);
    prefsQueue.current = next;
    return next;
  }, []);

  // ---------------------------------------------------------------- last visit
  const lastSeenAt = laterOf(prefs.lastSeenAt, localSeen);
  const markVisited = useCallback(async () => {
    const stamp = formatStamp(Date.now());
    if (userId) store.set(localKey(userId), stamp);
    setLocalSeen(stamp);
    // the server keeps it per person across devices; this device's copy is the fallback when that fails
    await savePrefs({ last_seen_at: stamp });
  }, [userId, savePrefs]);

  // first visit ever: nothing to compare with yet, so today is the baseline
  const baselined = useRef(false);
  useEffect(() => {
    if (!payload || baselined.current || !userId) return;
    baselined.current = true;
    if (!lastSeenAt) void markVisited();
  }, [payload, userId, lastSeenAt, markVisited]);
  useEffect(() => {
    baselined.current = false;
  }, [userId]);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const clearActionError = useCallback(() => setActionError(null), []);

  const value = useMemo<NotificationsState>(
    () => ({
      ...feed,
      loaded: payload !== null, stale, prefs, stored: storedItems, announcement, actionError, clearActionError,
      panelOpen, openPanel, closePanel, refresh, markSeen, ack, snooze, dismiss, savePrefs, lastSeenAt, markVisited,
    }),
    [feed, payload, storedItems, stale, prefs, announcement, actionError, clearActionError, panelOpen, openPanel, closePanel, refresh, markSeen, ack, snooze, dismiss, savePrefs, lastSeenAt, markVisited],
  );
  return <ctx.Provider value={value}>{children}</ctx.Provider>;
}

export function useNotifications(): NotificationsState {
  const v = useContext(ctx);
  if (!v) throw new Error('useNotifications needs the NotificationsProvider');
  return v;
}

/** Same, or null outside the shell (tests, pages shown on their own). */
export function useNotificationsOptional(): NotificationsState | null {
  return useContext(ctx);
}

export type { FeedItem };

/** Beside "Notifications" in the rail and the More sheet: items needing action plus new alerts; nothing when there are none. */
export function NotificationsNavBadge({ testid = 'notif-nav-badge' }: { testid?: string }) {
  const n = useContext(ctx);
  if (!n) return null;
  const count = n.actionCount + n.unseenAlerts;
  if (count === 0) return null;
  const label = t('{a} need action, {b} new alerts', { a: n.actionCount, b: n.unseenAlerts });
  return (
    <span className="vbadge vbadge--neutral" role="img" aria-label={label} title={label} data-testid={testid}>
      <span>{count > 99 ? '99+' : count}</span>
    </span>
  );
}
