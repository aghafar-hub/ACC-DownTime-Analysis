// The Notifications page (docs/actions-mockups/desktop-notifications.png): the bell's inbox, bigger. Tabs per category
// (Reliability, Availability & planned, Data quality, Actions, System) with counts, area and line filters, the items by day,
// and on a wide screen the chosen item beside the list. Every item has its one primary button, Snooze and Dismiss (alerts
// and updates), and Create action for alerts. The items the app derives (records to check ...) are under Data quality and
// only for people who can fix them, as in the bell. Every signed-in person may open it.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { NotificationCategory } from '../api/types';
import { useCreateAction } from '../actions/ActionsContext';
import { notificationPrefill } from '../actions/prefill';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Tile';
import { useStartup } from '../data/useStartup';
import { useIsMobile } from '../hooks/useIsMobile';
import { codeKey } from '../calc';
import { t, tn } from '../i18n/t';
import { Icon } from '../icons';
import { relativeAge } from '../notifications/age';
import {
  canCreateFrom, CATEGORIES, CATEGORY_ICON, categoryKey, categoryOf, countByCategory, DAY_GROUP_LABEL, groupByDay, itemIcon, itemTone, typeLabel, type CategoryFilter,
} from '../notifications/categories';
import type { FeedItem } from '../notifications/model';
import { useNotifications } from '../notifications/NotificationsContext';
import { tsText } from '../util/dates';
import { useValidationOptional } from '../validate/ValidationContext';
import '../components/ui.css';
import '../actions/actions.css';
import '../notifications/notifications.css';
import '../notifications/inbox.css';

function SnoozeButton({ onSnooze, testid }: { onSnooze: (days: number) => void; testid: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="nx-snooze">
      <button type="button" className="nx-icon" aria-expanded={open} aria-haspopup="true" aria-label={t('Snooze')} title={t('Snooze')} onClick={() => setOpen((o) => !o)} data-testid={testid}>
        <Icon name="clock" size={17} />
      </button>
      {open && (
        <span className="nx-snooze-menu" role="group" aria-label={t('Snooze for')}>
          <button type="button" className="btn btn-sm" onClick={() => { setOpen(false); onSnooze(1); }} data-testid="nx-snooze-1">{t('1 day')}</button>
          <button type="button" className="btn btn-sm" onClick={() => { setOpen(false); onSnooze(7); }} data-testid="nx-snooze-7">{t('1 week')}</button>
        </span>
      )}
    </span>
  );
}

export default function Notifications() {
  const n = useNotifications();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const { canView } = useAuth();
  const { startup } = useStartup();
  const v = useValidationOptional();
  const createAction = useCreateAction();
  const [sp, setSp] = useSearchParams();
  const cat: CategoryFilter = (CATEGORIES as readonly string[]).includes(sp.get('cat') ?? '') ? (sp.get('cat') as NotificationCategory) : 'all';
  const area = sp.get('area') ?? '';
  const line = sp.get('line') ?? '';
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const nowMs = Date.now();

  const set = (k: string, val: string) => setSp((cur) => {
    const next = new URLSearchParams(cur);
    if (val) next.set(k, val); else next.delete(k);
    return next;
  }, { replace: true });

  const scoped = useMemo(() => n.items.filter((i) => (!area || i.area_id === area) && (!line || i.line_id === line)), [n.items, area, line]);
  const counts = useMemo(() => countByCategory(scoped), [scoped]);
  const items = useMemo(() => (cat === 'all' ? scoped : scoped.filter((i) => categoryOf(i) === cat)), [scoped, cat]);
  const groups = useMemo(() => groupByDay(items, nowMs), [items, nowMs]);
  const fresh = scoped.filter((i) => i.unseen).length;
  const chosen = items.find((i) => i.id === selected) ?? items[0] ?? null;
  const areas = useMemo(() => (startup?.areas ?? []).filter((a) => a.active !== false).sort((a, b) => a.sort_order - b.sort_order), [startup]);
  const lines = useMemo(() => (startup?.lines ?? []).slice().sort((a, b) => a.sort_order - b.sort_order), [startup]);
  const known = useMemo(() => new Set((startup?.equipment ?? []).map((e) => codeKey(e.equipment_id))), [startup]);

  const go = (i: FeedItem) => {
    if (!i.link) return;
    if (i.unseen) void n.ack(i.id);
    navigate(i.link.to, i.link.state ? { state: i.link.state } : undefined);
  };
  const create = (i: FeedItem) => {
    if (!createAction) return;
    createAction(notificationPrefill(i, categoryOf(i), {
      findEvent: (id) => v?.rows.find((r) => r.event_id === id),
      isEquipment: (code) => known.size === 0 || known.has(codeKey(code)),
    }));
  };
  const snooze = async (i: FeedItem, days: number) => {
    if (await n.snooze(i.id, days)) setMessage(days === 1 ? t('Snoozed for 1 day.') : t('Snoozed for {n} days.', { n: days }));
  };
  const dismiss = async (i: FeedItem) => {
    if (await n.dismiss(i.id)) setMessage(t('Dismissed.'));
  };

  const row = (i: FeedItem) => {
    const c = categoryOf(i);
    const age = i.created_at ? relativeAge(i.created_at, nowMs) : '';
    const on = !mobile && chosen?.id === i.id;
    return (
      <li key={i.id} className={`nx-row${on ? ' nx-row--on' : ''}${i.unseen ? ' nx-row--unseen' : ''}`} data-testid="nx-row" data-id={i.id} data-kind={i.kind} data-category={c}>
        <span className={`nx-ico nx-ico--${categoryKey(c)}${itemTone(i)}`} aria-hidden="true"><Icon name={itemIcon(i)} size={18} /></span>
        <div className="nx-main">
          <p className="nx-meta">
            <span>{t(c)} · {typeLabel(i.type)}</span>
            {i.kind === 'action' && <span className="nx-kind nx-kind--action"><Icon name="alert" size={12} />{t('Needs action')}</span>}
            {age && <span>· {age}</span>}
            {i.unseen && <span className="nx-new" data-testid="nx-new">{t('New')}</span>}
          </p>
          <button type="button" className="nx-title" onClick={() => setSelected(i.id)} aria-pressed={on} data-testid="nx-title">{i.title}</button>
          {i.detail && mobile && <p className="nx-detail">{i.detail}</p>}
          <div className="nx-actions">
            <span className="nx-chip" data-testid="nx-area">{i.area_id ? [i.area_id, i.line_id].filter(Boolean).join(' · ') : i.line_id || t('All areas')}</span>
            {i.link && <button type="button" className="btn nx-go" onClick={() => go(i)} data-testid="nx-go">{i.linkLabel} <Icon name="chevronRight" size={14} /></button>}
            {createAction && canCreateFrom(i) && (
              <button type="button" className="btn-primary nx-create" onClick={() => create(i)} data-testid="nx-create"><Icon name="plus" size={14} /> {t('Create action')}</button>
            )}
          </div>
        </div>
        {i.kind !== 'action' && (
          <div className="nx-side">
            <SnoozeButton onSnooze={(d) => void snooze(i, d)} testid="nx-snooze" />
            <button type="button" className="nx-icon" aria-label={t('Dismiss')} title={t('Dismiss')} onClick={() => void dismiss(i)} data-testid="nx-dismiss"><Icon name="close" size={17} /></button>
          </div>
        )}
      </li>
    );
  };

  const tabs = (
    <nav className={mobile ? 'chip-row nx-chips' : 'nx-tabs'} aria-label={t('Categories')} data-testid="nx-tabs">
      <button type="button" className={mobile ? `chip${cat === 'all' ? ' chip--on' : ''}` : `nx-tab${cat === 'all' ? ' nx-tab--on' : ''}`} aria-pressed={cat === 'all'} onClick={() => set('cat', '')} data-testid="nx-tab-all">
        <Icon name="bell" size={15} /> {t('All')} <b>{scoped.length}</b>
      </button>
      {CATEGORIES.map((c) => (
        <button key={c} type="button" className={mobile ? `chip${cat === c ? ' chip--on' : ''}` : `nx-tab${cat === c ? ' nx-tab--on' : ''}`} aria-pressed={cat === c} onClick={() => set('cat', c)} data-testid={`nx-tab-${categoryKey(c)}`}>
          <Icon name={CATEGORY_ICON[c]} size={15} /> {t(c)} <b data-testid="nx-tab-count">{counts[c].total}</b>
          {!mobile && counts[c].fresh > 0 && <span className="nx-tab-new">{t('{n} new', { n: counts[c].fresh })}</span>}
        </button>
      ))}
    </nav>
  );

  const detail = chosen && !mobile ? (
    <aside className="card nx-detail-card" aria-label={t('Notification')} data-testid="nx-detail">
      <p className="nx-meta"><span className={`nx-ico nx-ico--sm nx-ico--${categoryKey(categoryOf(chosen))}`} aria-hidden="true"><Icon name={CATEGORY_ICON[categoryOf(chosen)]} size={15} /></span>{t(categoryOf(chosen))} · {typeLabel(chosen.type)}{chosen.unseen && <span className="nx-new">{t('New')}</span>}{chosen.created_at && <span className="nx-when">{tsText(chosen.created_at)}</span>}</p>
      <h2 className="nx-detail-title">{chosen.title}</h2>
      <p className="nx-actions"><span className="nx-chip">{chosen.area_id ? [chosen.area_id, chosen.line_id].filter(Boolean).join(' · ') : t('All areas')}</span></p>
      {chosen.detail && <p className="nx-detail-text" data-testid="nx-detail-text">{chosen.detail}</p>}
      <div className="nx-detail-btns">
        {chosen.link && <button type="button" className="btn-primary" onClick={() => go(chosen)} data-testid="nx-detail-go">{chosen.linkLabel} <Icon name="chevronRight" size={14} /></button>}
        {createAction && canCreateFrom(chosen) && <button type="button" className="btn" onClick={() => create(chosen)} data-testid="nx-detail-create"><Icon name="plus" size={14} /> {t('Create action')}</button>}
        {chosen.kind !== 'action' && (
          <>
            <button type="button" className="btn" onClick={() => void snooze(chosen, 7)} data-testid="nx-detail-snooze"><Icon name="clock" size={14} /> {t('Snooze 1 week')}</button>
            <button type="button" className="btn" onClick={() => void dismiss(chosen)} data-testid="nx-detail-dismiss"><Icon name="close" size={14} /> {t('Dismiss')}</button>
          </>
        )}
      </div>
      <p className="nx-rule"><Icon name="info" size={14} />
        <span>{chosen.kind === 'action' ? t('Worked out from the loaded data; it goes away by itself when the records are fixed.') : t('Raised by the server checks after each upload and once a day.')}</span>
        {canView('settings') && <Link to={chosen.type === 'planned_overrun' || chosen.type === 'action_due' ? '/settings/actions' : '/settings/notifications'} className="nx-link">{t('Edit rule')}</Link>}
      </p>
    </aside>
  ) : null;

  return (
    <div className="page nx-page" data-testid="page-notifications">
      <PageHeader
        title={t('Notifications')}
        subtitle={<span data-testid="nx-subtitle">{t('{n} new', { n: fresh })} · {t('{n} open', { n: scoped.length })}{n.actionCount > 0 ? ` · ${tn(n.actionCount, '{n} item needs action', '{n} items need action')}` : ''}</span>}
        right={(
          <>
            <button type="button" className="btn btn-sm" onClick={() => void n.markSeen(n.unseenIds)} disabled={n.unseenIds.length === 0} data-testid="nx-mark-all"><Icon name="check" size={14} /> {t('Mark all read')}</button>
            <Link to={canView('settings') ? '/settings/actions' : '/settings/notifications'} className="btn btn-sm" data-testid="nx-rules"><Icon name="settings" size={14} /> {canView('settings') ? t('Rules & targets') : t('My settings')}</Link>
          </>
        )}
      />
      {tabs}
      <div className="nx-filters">
        <label className={area ? 'af-pill af-pill--on' : 'af-pill'}>
          <span className="af-pill-label">{t('Area')}:</span>
          <select value={area} onChange={(e) => set('area', e.target.value)} aria-label={t('Area')} data-testid="nx-area-filter">
            <option value="">{t('All')}</option>
            {areas.map((a) => <option key={a.area_id} value={a.area_id}>{a.area_id}</option>)}
          </select>
          <Icon name="chevronDown" size={14} />
        </label>
        <label className={line ? 'af-pill af-pill--on' : 'af-pill'}>
          <span className="af-pill-label">{t('Line')}:</span>
          <select value={line} onChange={(e) => set('line', e.target.value)} aria-label={t('Line')} data-testid="nx-line-filter">
            <option value="">{t('All')}</option>
            {lines.map((l) => <option key={l.line_id} value={l.line_id}>{l.line_id}</option>)}
          </select>
          <Icon name="chevronDown" size={14} />
        </label>
        {!mobile && <span className="nx-note"><Icon name="info" size={14} /> {n.prefs.watchAreas.length ? t('Only the areas you follow ({a}) are shown; snoozed and dismissed items are hidden.', { a: n.prefs.watchAreas.join(', ') }) : t('Snoozed and dismissed items are hidden.')}</span>}
      </div>
      <p className="np-sr" role="status" aria-live="polite" data-testid="nx-status">{message}</p>
      {n.actionError && <div className="callout callout--danger" role="alert" data-testid="nx-error"><Icon name="alert" size={16} /><span>{n.actionError}</span><button type="button" className="btn btn-sm" onClick={n.clearActionError}>{t('Dismiss')}</button></div>}
      {n.stale && <p className="callout callout--warning" role="status" data-testid="nx-stale"><Icon name="wifiOff" size={16} /><span>{t('Could not refresh just now. Showing the last list.')}</span></p>}
      <div className={detail ? 'nx-split' : 'nx-split nx-split--one'}>
        <section className="card nx-list-card" aria-label={t('Notifications')}>
          {groups.length === 0 ? (
            <div className="np-empty nx-empty" data-testid="nx-empty">
              <Icon name="check" size={22} />
              <p>{n.loaded ? t('Nothing here. You are all caught up.') : t('Loading…')}</p>
            </div>
          ) : groups.map((g) => (
            <div key={g.group} className="nx-group" data-testid={`nx-group-${g.group}`}>
              <h2 className="nx-group-head"><span>{t(DAY_GROUP_LABEL[g.group])}</span>{g.items.some((i) => i.unseen) && <span>{t('{n} new', { n: g.items.filter((i) => i.unseen).length })}</span>}</h2>
              <ul className="nx-list">{g.items.map(row)}</ul>
            </div>
          ))}
        </section>
        {detail}
      </div>
    </div>
  );
}
