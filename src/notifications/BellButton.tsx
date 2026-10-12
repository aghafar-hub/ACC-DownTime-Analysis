import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { t, tn } from '../i18n/t';
import { Icon } from '../icons';
import { badgeText } from './merge';
import { useNotifications } from './NotificationsContext';
import NotificationPanel from './NotificationPanel';
import './notifications.css';

/** The words behind the bell: how many items need action and whether there are new alerts. */
export function bellLabel(actionCount: number, unseenAlerts: number): string {
  const parts: string[] = [];
  if (actionCount > 0) parts.push(tn(actionCount, '{n} item needs action', '{n} items need action'));
  if (unseenAlerts > 0) parts.push(tn(unseenAlerts, '{n} new alert', '{n} new alerts'));
  return parts.length ? `${t('Notifications')}: ${parts.join(', ')}` : t('Notifications');
}

// The bell in the top bar, next to Settings. Red number = open action items (99+ at most); an amber dot = new alerts
// the person has not opened. Nothing is drawn when there is nothing. A hidden live region announces new items.
export default function BellButton() {
  const n = useNotifications();
  const ref = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const { closePanel } = n;
  useEffect(() => closePanel(), [location.pathname, closePanel]);
  const label = bellLabel(n.actionCount, n.unseenAlerts);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={n.panelOpen ? 'notif-bell notif-bell--open' : 'notif-bell'}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={n.panelOpen}
        onClick={() => (n.panelOpen ? n.closePanel() : n.openPanel())}
        data-testid="bell-btn"
        data-action-count={n.actionCount}
        data-alert-count={n.unseenAlerts}
      >
        <Icon name="bell" size={18} />
        {n.actionCount > 0 && (
          <span className="notif-badge" data-testid="bell-badge" aria-hidden="true">{badgeText(n.actionCount)}</span>
        )}
        {n.unseenAlerts > 0 && <span className="notif-dot" data-testid="bell-dot" aria-hidden="true" />}
      </button>
      <span className="np-sr" role="status" aria-live="polite" data-testid="bell-live">{n.announcement}</span>
      {n.panelOpen && <NotificationPanel anchorRef={ref} />}
    </>
  );
}
