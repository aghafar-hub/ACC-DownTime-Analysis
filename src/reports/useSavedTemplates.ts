import { useCallback, useMemo, useRef } from 'react';
import type { SavedReportTemplate } from '../api/types';
import { useNotificationsOptional } from '../notifications/NotificationsContext';
import { commitList } from '../views/commit';
import type { ListResult } from '../views/savedViews';
import { addTemplate, deleteTemplate, newTemplateId, parseSavedTemplates, renameTemplate, serializeSavedTemplates } from './savedTemplates';
import type { ReportSetup } from './setup';

export type TemplateOutcome = { ok: true; item?: SavedReportTemplate } | { ok: false; error: string };

/**
 * The person's saved templates (preference `saved_reports`) and the changes to them. A change shows at once and is taken back,
 * with a plain message, when the server refuses it (the notifications context rolls the preference back). Changes wait until
 * the preferences have loaded so a list that was not read yet is never overwritten.
 */
export function useSavedTemplates() {
  const n = useNotificationsOptional();
  const raw = n?.prefs.savedReports ?? '';
  const list = useMemo(() => parseSavedTemplates(raw), [raw]);
  const ref = useRef(list);
  ref.current = list;
  const loaded = !!n?.loaded;
  const failed = !loaded && !!n?.stale;
  const savePrefs = n?.savePrefs;

  const commit = useCallback(
    (result: ListResult<SavedReportTemplate>): Promise<TemplateOutcome> => commitList(result, ref, 'saved_reports', serializeSavedTemplates, savePrefs),
    [savePrefs],
  );

  const wait = (): Promise<TemplateOutcome> => Promise.resolve({ ok: false, error: 'Your saved templates are still loading. Try again in a moment.' });
  const save = useCallback((setup: ReportSetup, name: string) => (loaded ? commit(addTemplate(ref.current, setup, name, newTemplateId(ref.current.map((x) => x.id)))) : wait()), [loaded, commit]);
  const rename = useCallback((id: string, name: string) => (loaded ? commit(renameTemplate(ref.current, id, name)) : wait()), [loaded, commit]);
  const remove = useCallback((id: string) => (loaded ? commit(deleteTemplate(ref.current, id)) : wait()), [loaded, commit]);
  return { list, loaded, failed, save, rename, remove };
}
