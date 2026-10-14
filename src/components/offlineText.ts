// The offline banner's words (OfflineBanner.tsx): 'Offline · data from 14 Oct 2026 07:12', the time the data on
// screen was last synced with the server, in the app's one timestamp format (util/dates.ts whenText).
import { whenText } from '../util/dates';
import { t } from '../i18n/t';

/** ' · data from 14 Oct 2026 07:12' after 'Offline'; ' · data saved on this device' when the time is unknown. */
export function offlineDataText(savedAt: string | null | undefined): string {
  const when = whenText(savedAt ?? null);
  return when && /\d{2}:\d{2}$/.test(when) ? ` · ${t('data from {time}', { time: when })}` : ` · ${t('data saved on this device')}`;
}
