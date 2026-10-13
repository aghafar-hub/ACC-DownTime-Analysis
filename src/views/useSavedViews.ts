import { useCallback, useMemo, useRef } from 'react';
import { useNotificationsOptional } from '../notifications/NotificationsContext';
import { commitList } from './commit';
import { addView, deleteView, newId, parseSavedViews, renameView, serializeSavedViews, type ListResult, type SavedView, type ViewPage } from './savedViews';

export type SaveOutcome<T> = { ok: true; item?: T } | { ok: false; error: string };

/**
 * The person's saved views (preference `saved_views`) and the changes to them. A change shows at once and is taken back
 * with a plain message when the server refuses it (the notifications context does the rolling back). Changes wait until
 * the preferences have loaded, so a list that was not read yet is never overwritten.
 */
export function useSavedViews() {
  const n = useNotificationsOptional();
  const raw = n?.prefs.savedViews ?? '';
  const list = useMemo(() => parseSavedViews(raw), [raw]);
  const ref = useRef(list);
  ref.current = list;
  const loaded = !!n?.loaded;
  /** the preferences could not be loaded (offline, server down): the list is unknown, so saving is off */
  const failed = !loaded && !!n?.stale;
  const savePrefs = n?.savePrefs;

  const commit = useCallback(
    (result: ListResult<SavedView>): Promise<SaveOutcome<SavedView>> => commitList(result, ref, 'saved_views', serializeSavedViews, savePrefs),
    [savePrefs],
  );

  const notReady = (): SaveOutcome<SavedView> => ({ ok: false, error: 'Your saved views are still loading. Try again in a moment.' });
  const save = useCallback((input: { name: string; page: ViewPage; query: string }) => (loaded
    ? commit(addView(ref.current, input, newId('v', ref.current.map((v) => v.id))))
    : Promise.resolve(notReady())), [loaded, commit]);
  const rename = useCallback((id: string, name: string) => (loaded ? commit(renameView(ref.current, id, name)) : Promise.resolve(notReady())), [loaded, commit]);
  const remove = useCallback((id: string) => (loaded ? commit(deleteView(ref.current, id)) : Promise.resolve(notReady())), [loaded, commit]);
  return { list, loaded, failed, save, rename, remove };
}
