import { useStartup } from '../data/useStartup';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useOnlineStatus } from '../useOnlineStatus';
import './OfflineBanner.css';

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return new Date().toDateString() === d.toDateString() ? time : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}`;
}

// When the connection drops, say so plainly under the tabs: how old the data on
// screen is, and that uploads and edits need a connection (offline is read-only).
export default function OfflineBanner() {
  const online = useOnlineStatus();
  const { savedAt } = useStartup();
  if (online) return null;
  const when = fmtTime(savedAt);
  return (
    <div className="offline-banner" role="status" data-testid="offline-banner">
      <Icon name="wifiOff" size={16} />
      <span>
        <b>{t('Offline')}</b>
        {when ? ` ${t('Showing data saved on this device at {time}.', { time: when })}` : ` ${t('Showing the data saved on this device.')}`}{' '}
        {t('Uploads and edits need a connection.')}
      </span>
    </div>
  );
}
