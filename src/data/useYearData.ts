import { useMemo } from 'react';
import { useEvents } from './useEvents';
import { useStartup, useYear } from './useStartup';

/** Master data plus the events of the selected year, with a few plain counts. */
export function useYearData() {
  const st = useStartup();
  const [year] = useYear();
  const ev = useEvents(year);
  const facts = useMemo(() => {
    const rows = ev.events;
    let last = '';
    let added = '';
    let failures = 0;
    let voided = 0;
    let edited = 0;
    let flagged = 0;
    let seconds = 0;
    for (const e of rows) {
      if (e.event_date > last) last = e.event_date;
      if (e.created_at > added) added = e.created_at;
      if (e.is_void) {
        voided++;
        continue;
      }
      if (e.is_failure) failures++;
      if (e.edited) edited++;
      if (e.flags) flagged++;
      if (e.duration_s > 0) seconds += e.duration_s;
    }
    return { count: rows.length, last, added: added.slice(0, 10), failures, voided, edited, flagged, seconds };
  }, [ev.events]);
  return { st, startup: st.startup, year, ev, facts };
}
