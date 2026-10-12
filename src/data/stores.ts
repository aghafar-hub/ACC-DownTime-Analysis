// Small shared stores for start-up data and events per year, with a device
// cache behind them. Pages read them through the hooks in useStartup.ts and
// useEvents.ts; nothing here depends on React.
import { api, describeError } from '../api';
import type { EventRow, Startup } from '../api/types';
import { ApiError } from '../api/types';
import { t } from '../i18n/t';
import { getCached, setCached } from './cache';

export interface ResState<T> {
  data: T | null;
  /** First load with nothing to show yet. */
  loading: boolean;
  /** Showing data while a newer copy is fetched. */
  refreshing: boolean;
  error: string | null;
  accessDenied: boolean;
  /** The data on screen came from this device, not from the server. */
  fromCache: boolean;
  savedAt: string | null;
}

const EMPTY: ResState<never> = { data: null, loading: false, refreshing: false, error: null, accessDenied: false, fromCache: false, savedAt: null };
const FRESH_MS = 5 * 60 * 1000;

export class Resource<T> {
  private state: ResState<T> = EMPTY;
  private listeners = new Set<() => void>();
  private inflight: Promise<void> | null = null;
  private fetchedAt = 0;
  constructor(private cacheKey: string, private fetcher: (token: string) => Promise<T>) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.state;
  private set(patch: Partial<ResState<T>>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Loads from the device cache first (if nothing is shown yet), then from the server. */
  load(token: string, force = false): Promise<void> {
    if (this.inflight) return this.inflight;
    if (!force && this.state.data && !this.state.fromCache && Date.now() - this.fetchedAt < FRESH_MS) return Promise.resolve();
    this.inflight = this.run(token).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(token: string) {
    if (!this.state.data) {
      this.set({ loading: true, error: null, accessDenied: false });
      const cached = await getCached<T>(this.cacheKey);
      if (cached) this.set({ data: cached.value, fromCache: true, savedAt: cached.savedAt, loading: false, refreshing: true });
    } else {
      this.set({ refreshing: true, error: null, accessDenied: false });
    }
    try {
      const data = await this.fetcher(token);
      this.fetchedAt = Date.now();
      const savedAt = new Date().toISOString();
      this.set({ data, fromCache: false, savedAt, loading: false, refreshing: false, error: null, accessDenied: false });
      void setCached(this.cacheKey, data);
    } catch (err) {
      const denied = err instanceof ApiError && err.accessDenied;
      const offline = err instanceof ApiError && err.code === 'network';
      this.set({
        loading: false,
        refreshing: false,
        accessDenied: denied,
        data: denied ? null : this.state.data,
        error: offline && this.state.data ? t('You are offline or the server cannot be reached. Showing the copy saved on this device.') : describeError(err),
      });
    }
  }

  reset() {
    this.state = EMPTY;
    this.fetchedAt = 0;
    this.inflight = null;
    this.listeners.forEach((l) => l());
  }

  /** Replaces one part of the loaded data, for example after an edit, and refreshes the device cache. */
  patch(fn: (data: T) => T) {
    if (!this.state.data) return;
    const data = fn(this.state.data);
    this.set({ data });
    void setCached(this.cacheKey, data);
  }
}

export const startupResource = new Resource<Startup>('startup', (token) => api.getStartup(token));

let eventResources = new Map<number, Resource<EventRow[]>>();
export function eventsResource(year: number): Resource<EventRow[]> {
  let r = eventResources.get(year);
  if (!r) {
    r = new Resource<EventRow[]>(`events:${year}`, (token) => api.getEvents(token, year));
    eventResources.set(year, r);
  }
  return r;
}

/** Forgets everything held in memory (sign-out, another person signing in). */
export function resetDataStores() {
  eventResources.forEach((r) => r.reset());
  eventResources = new Map();
  startupResource.reset();
}
