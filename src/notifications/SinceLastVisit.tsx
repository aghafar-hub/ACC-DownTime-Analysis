import { useId, useMemo, useState } from 'react';
import { tsText } from '../util/dates';
import { buildCodeLookup, parseSettings } from '../calc';
import { useIsMobile } from '../hooks/useIsMobile';
import { t, tn } from '../i18n/t';
import { Icon } from '../icons';
import { hours, num } from '../util/format';
import { useValidationOptional } from '../validate/ValidationContext';
import { useNotificationsOptional } from './NotificationsContext';
import { computeSince, countNewAlerts, EMPTY_SINCE } from './since';
import './notifications.css';

// "Since your last visit": a collapsible card under the Dashboard takeaway. Worked out from the loaded events and the person's
// last-seen time; nothing is drawn when nothing is new. Dismiss moves last-seen to now.
export default function SinceLastVisit() {
  const n = useNotificationsOptional();
  const v = useValidationOptional();
  const mobile = useIsMobile();
  const [openState, setOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const bodyId = useId();
  const startup = v?.st.startup ?? null;
  const lastSeenAt = n?.lastSeenAt ?? '';
  const ready = !!v?.ready;
  const rows = v?.rows;
  const alerts = n?.items;

  const repeat = useMemo(
    () => (startup ? { settings: parseSettings(startup.settings), lookup: buildCodeLookup(startup.aliases, startup.equipment) } : undefined),
    [startup],
  );
  const since = useMemo(() => {
    if (!ready || !rows || !lastSeenAt) return EMPTY_SINCE;
    const newAlerts = countNewAlerts((alerts ?? []).filter((i) => i.kind === 'alert'), lastSeenAt);
    return computeSince({ events: rows, lastSeenAt, repeat, newAlerts });
  }, [ready, rows, lastSeenAt, repeat, alerts]);

  if (!n || !since.any) return null;
  const open = openState ?? !mobile;
  const summary = [
    tn(since.newEvents, '{n} new event', '{n} new events'),
    since.newAlerts > 0 ? tn(since.newAlerts, '{n} new alert', '{n} new alerts') : '',
  ].filter(Boolean).join(' · ');
  const dismiss = async () => {
    setBusy(true);
    try {
      await n.markVisited();
    } finally {
      setBusy(false);
    }
  };
  const stat = (id: string, value: string, label: string) => (
    <li key={id} data-testid={`slv-${id}`}>
      <b>{value}</b>
      <span>{label}</span>
    </li>
  );
  return (
    <section className="slv" aria-label={t('Since your last visit')} data-testid="since-card">
      <button type="button" className="slv-head" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)} data-testid="since-toggle">
        <Icon name="history" size={16} />
        <span>{t('Since your last visit')}</span>
        <span className="slv-sum" data-testid="since-summary">{summary}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
      </button>
      {open && (
        <div className="slv-body" id={bodyId}>
          <ul className="slv-list">
            {stat('events', num(since.newEvents), since.newEvents === 1 ? t('new event') : t('new events'))}
            {stat('failures', num(since.newFailures), since.newFailures === 1 ? t('new failure') : t('new failures'))}
            {stat('hours', hours(since.failureHours * 3600), t('failure hours added'))}
            {since.topArea && stat('area', since.topArea.areaId, t('most new failures ({n})', { n: since.topArea.failures }))}
            {stat('repeats', num(since.newRepeatGroups), since.newRepeatGroups === 1 ? t('new repeated group') : t('new repeated groups'))}
            {stat('alerts', num(since.newAlerts), since.newAlerts === 1 ? t('new alert') : t('new alerts'))}
          </ul>
          <div className="slv-foot">
            <small>{t('Since {when}', { when: tsText(lastSeenAt) })}</small>
            <button type="button" className="btn" onClick={() => void dismiss()} disabled={busy} data-testid="since-dismiss">{t('Dismiss')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
