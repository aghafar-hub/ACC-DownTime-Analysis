import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { EventRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n/t';

// Who kept a record as entered, and why. events.accepted_by is a user id and the note lives in the edit history
// (field accepted_flags), so the Kept-as-entered list looks both up for the rows it shows.

/** A function that turns a user id into a name: your own name, the name from the user list when you may read it, else the id. */
export function useUserNames(): (id: string | undefined) => string {
  const { token, user, canView } = useAuth();
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const canList = canView('users');
  useEffect(() => {
    if (!token || !canList) return;
    let live = true;
    api.listUsers(token).then(
      (list) => { if (live) setNames(new Map(list.map((u) => [u.user_id, u.display_name]))); },
      () => { /* the id is shown instead */ },
    );
    return () => { live = false; };
  }, [token, canList]);
  return useCallback(
    (id) => {
      if (!id) return t('someone');
      if (user && id === user.user_id) return user.display_name || t('you');
      return names.get(id) || id;
    },
    [user, names],
  );
}

/** The note of the latest "kept as entered" history row, keyed by event id and acceptance time (so a new acceptance fetches again). */
const noteCache = new Map<string, string>();
export const noteKey = (e: Pick<EventRow, 'event_id' | 'accepted_at'>): string => `${e.event_id}|${e.accepted_at ?? ''}`;

/** Loads the notes of the given events one after the other (the history of each is read once). Returns a lookup. */
export function useKeepNotes(events: readonly EventRow[]): (e: Pick<EventRow, 'event_id' | 'accepted_at'>) => string | undefined {
  const { token } = useAuth();
  const [, bump] = useState(0);
  const wanted = useMemo(() => events.filter((e) => !noteCache.has(noteKey(e))), [events]);
  const sig = wanted.map(noteKey).join(',');
  useEffect(() => {
    if (!token || wanted.length === 0) return;
    let live = true;
    (async () => {
      for (const e of wanted) {
        if (!live) return;
        try {
          const edits = await api.getEventEdits(token, e.event_id);
          const last = edits.filter((h) => h.field === 'accepted_flags' && (h.new_value ?? '') !== '').at(-1);
          noteCache.set(noteKey(e), last?.note ?? '');
        } catch {
          noteCache.set(noteKey(e), '');
        }
        if (live) bump((n) => n + 1);
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, sig]);
  return useCallback((e) => noteCache.get(noteKey(e)), []);
}

/** For tests: forget the cached notes. */
export function resetKeepNotes(): void {
  noteCache.clear();
}
