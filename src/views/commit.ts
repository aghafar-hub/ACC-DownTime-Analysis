// Saving a changed list into a preference, the way both saved lists (views and report templates) do it: the new list is
// the current one at once (the app shows it without waiting), and when the server refuses it the previous list comes back
// together with the server's plain message. The preference store itself (NotificationsContext.savePrefs) rolls its own copy back.
import type { ListResult } from './savedViews';

export type SaveFn = (patch: Record<string, string>) => Promise<{ ok: true } | { ok: false; error: string }>;
export type CommitOutcome<T> = { ok: true; item?: T } | { ok: false; error: string };

export async function commitList<T>(
  result: ListResult<T>, current: { current: T[] }, key: string, serialize: (list: readonly T[]) => string, save: SaveFn | undefined,
): Promise<CommitOutcome<T>> {
  if (!result.ok) return result;
  if (!save) return { ok: false, error: 'Your changes cannot be saved right now.' };
  const before = current.current;
  current.current = result.list;
  const saved = await save({ [key]: serialize(result.list) });
  if (!saved.ok) {
    current.current = before;
    return { ok: false, error: saved.error };
  }
  return { ok: true, item: result.item };
}
