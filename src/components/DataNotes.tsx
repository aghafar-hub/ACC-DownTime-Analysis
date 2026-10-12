import type { EventsHook } from '../data/useEvents';
import type { StartupHook } from '../data/useStartup';
import { t } from '../i18n/t';
import DataStatus from './DataStatus';

/** Loading, error and offline notes for the master data and the events of the chosen year. */
export default function DataNotes({ st, ev }: { st: StartupHook; ev?: EventsHook }) {
  if (st.error || (st.loading && !st.data)) return <DataStatus state={st} onRetry={st.reload} what={t('master data')} />;
  if (ev) return <DataStatus state={ev} onRetry={ev.reload} what={t('events')} />;
  return <DataStatus state={st} onRetry={st.reload} what={t('master data')} />;
}
