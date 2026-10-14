import { useStartup } from '../data/useStartup';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useOnlineStatus } from '../useOnlineStatus';
import { offlineDataText } from './offlineText';
import './OfflineBanner.css';

// When the connection drops, say so plainly under the tabs: 'Offline · data from 14 Oct 2026 07:12' (when the data
// on screen was last synced), and that uploads and edits need a connection (offline is read-only).
export default function OfflineBanner() {
  const online = useOnlineStatus();
  const { savedAt } = useStartup();
  if (online) return null;
  return (
    <div className="offline-banner" role="status" data-testid="offline-banner">
      <Icon name="wifiOff" size={16} />
      <span>
        <b>{t('Offline')}</b>
        <span data-testid="offline-banner-when">{offlineDataText(savedAt)}</span>.{' '}
        {t('Uploads and edits need a connection.')}
      </span>
    </div>
  );
}
