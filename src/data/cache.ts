// Device cache (IndexedDB) for start-up data and events per year. It lets the
// app open at once and stay readable offline. Read-only: nothing here is ever
// sent back to the server. Every call is guarded: IndexedDB may be missing or
// blocked, and the app must work without it.
import { openDB, type IDBPDatabase } from 'idb';
import { STORAGE_PREFIX } from '../storagePrefix';

const DB_NAME = `${STORAGE_PREFIX}cache`;
const STORE = 'kv';

export interface Cached<T> {
  value: T;
  savedAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> | null {
  try {
    if (typeof indexedDB === 'undefined') return null;
    dbPromise ??= openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      },
    });
    return dbPromise;
  } catch {
    return null;
  }
}

export async function getCached<T>(key: string): Promise<Cached<T> | null> {
  try {
    const d = await db();
    if (!d) return null;
    const v = (await d.get(STORE, key)) as Cached<T> | undefined;
    return v ?? null;
  } catch {
    return null;
  }
}

export async function setCached<T>(key: string, value: T): Promise<string> {
  const savedAt = new Date().toISOString();
  try {
    const d = await db();
    if (d) await d.put(STORE, { value, savedAt } satisfies Cached<T>, key);
  } catch {
    /* quota or blocked: the app still works online */
  }
  return savedAt;
}

/** Called at sign-out so plant data does not stay on a shared device. */
export async function clearDataCaches(): Promise<void> {
  try {
    const d = await db();
    if (d) await d.clear(STORE);
  } catch {
    /* ignore */
  }
}
