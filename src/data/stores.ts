// Small shared stores for start-up data and events per year, with a device
// cache behind them. Pages read them through the hooks in useStartup.ts and
// useEvents.ts; nothing here depends on React.
import { api, describeError } from '../api';
import type { ActionsPayload, AreaTarget, EventRow, Startup } from '../api/types';
import { ApiError } from '../api/types';
import { t } from '../i18n/t';
import { markUnreadableTimes } from '../calc/flags';

/** Next year: a stop dated later is a typo. */
export const latestPlausibleYear = (): number => new Date().getFullYear() + 1;

/**
 * Records as the app holds them: a time typed by hand into the Sheet that cannot be read (or a year far off) carries the
 * blocking flag unreadable_time, so the record is listed on Validate and left out of the numbers, never a freeze.
 */
export const checkTimes = (rows: EventRow[]): EventRow[] => markUnreadableTimes(rows, latestPlausibleYear());
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
  /** bumped by reset() (sign-out): an answer to a request started before it is thrown away, never shown or cached */
  private generation = 0;
  /** bumped by patch() (a saved edit): an answer to a request started before the edit may not hold it yet */
  private version = 0;
  /** a refresh came back older than a saved edit: fetch once more when it ends */
  private again: string | null = null;
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
    const gen = this.generation;
    this.inflight = this.run(token).finally(() => {
      if (gen !== this.generation) return; // reset() already cleared it
      this.inflight = null;
      const tok = this.again;
      this.again = null;
      if (tok) void this.load(tok, true);
    });
    return this.inflight;
  }

  private async run(token: string) {
    const gen = this.generation;
    const version = this.version;
    const current = () => gen === this.generation;
    if (!this.state.data) {
      this.set({ loading: true, error: null, accessDenied: false });
      const cached = await getCached<T>(this.cacheKey);
      if (!current()) return;
      if (cached) this.set({ data: cached.value, fromCache: true, savedAt: cached.savedAt, loading: false, refreshing: true });
    } else {
      this.set({ refreshing: true, error: null, accessDenied: false });
    }
    try {
      const data = await this.fetcher(token);
      if (!current()) return; // signed out meanwhile: never show or cache the previous person's data
      if (version !== this.version) {
        // an edit was saved while this copy was on its way: keep the edit on screen and fetch again
        this.set({ refreshing: false });
        this.again = token;
        return;
      }
      this.fetchedAt = Date.now();
      const savedAt = new Date().toISOString();
      this.set({ data, fromCache: false, savedAt, loading: false, refreshing: false, error: null, accessDenied: false });
      void setCached(this.cacheKey, data);
    } catch (err) {
      if (!current()) return;
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
    this.generation++;
    this.again = null;
    this.state = EMPTY;
    this.fetchedAt = 0;
    this.inflight = null;
    this.listeners.forEach((l) => l());
  }

  /** Replaces one part of the loaded data, for example after an edit, and refreshes the device cache. */
  patch(fn: (data: T) => T) {
    if (!this.state.data) return;
    const data = fn(this.state.data);
    this.version++;
    this.set({ data });
    void setCached(this.cacheKey, data);
  }
}

/** The events of one year: every change (an edit, a void) is checked like the loaded records. */
class EventsResource extends Resource<EventRow[]> {
  override patch(fn: (data: EventRow[]) => EventRow[]) {
    super.patch((d) => checkTimes(fn(d)));
  }
}

export const startupResource = new Resource<Startup>('startup', (token) => api.getStartup(token));

/** Every action with its history, the contractors and the people (backend 1.4.0). Cached on the device, readable offline. */
export const actionsResource = new Resource<ActionsPayload>('actions', (token) => api.listActions(token));
/** The area targets of every year (availability target and planned-stop allowance). */
export const areaTargetsResource = new Resource<AreaTarget[]>('area_targets', (token) => api.getAreaTargets(token));

let eventResources = new Map<number, Resource<EventRow[]>>();
export function eventsResource(year: number): Resource<EventRow[]> {
  let r = eventResources.get(year);
  if (!r) {
    r = new EventsResource(`events:${year}`, (token) => api.getEvents(token, year).then(checkTimes));
    eventResources.set(year, r);
  }
  return r;
}

/** Forgets everything held in memory (sign-out, another person signing in). */
export function resetDataStores() {
  eventResources.forEach((r) => r.reset());
  eventResources = new Map();
  startupResource.reset();
  actionsResource.reset();
  areaTargetsResource.reset();
}
