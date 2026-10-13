import { t, tn } from '../i18n/t';
import { badgeText } from '../notifications/merge';
import { useNotificationsOptional } from '../notifications/NotificationsContext';
import { num } from '../util/format';
import { useValidationOptional } from './ValidationContext';
import './validate.css';

/** Count of records needing checking beside the Validate entry. Danger colour when any is left out of the numbers. */
export default function ValidateBadge({ testid = 'validate-badge' }: { testid?: string }) {
  const v = useValidationOptional();
  // the latest year counts first; while older years load the number is marked as not final yet
  if (!v || !v.earlyReady) return null;
  const { total, blocked } = v.early.summary;
  if (total === 0) return null;
  const blocking = blocked.count > 0;
  const base = blocking
    ? t('{n} need checking, {b} left out of the numbers', { n: num(total), b: num(blocked.count) })
    : tn(total, '{n} record to review', '{n} records to review');
  const label = v.checkingOlder ? `${base} · ${t('checking older years…')}` : base;
  return (
    <span
      className={blocking ? 'vbadge vbadge--danger' : 'vbadge vbadge--warning'} role="img" aria-label={label} title={label}
      data-testid={testid} data-partial={v.checkingOlder || undefined}
    >
      <span className="vbadge-sym" aria-hidden="true">{blocking ? '◆' : '▲'}</span>
      <span>{total > 999 ? '999+' : num(total)}{v.checkingOlder ? '…' : ''}</span>
    </span>
  );
}

/** The open action items (the bell's number) as a small danger-coloured badge for the bottom bar's More slot. Nothing when there are none. */
export function MoreCountBadge({ testid = 'more-badge' }: { testid?: string }) {
  const n = useNotificationsOptional();
  if (!n || n.actionCount === 0) return null;
  const label = tn(n.actionCount, '{n} item needs action', '{n} items need action');
  return (
    <span className="bottom-nav-badge" role="img" aria-label={label} data-testid={testid}>
      {badgeText(n.actionCount)}
    </span>
  );
}
