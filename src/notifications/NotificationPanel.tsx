import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ChipRow, CountChip } from '../components/PhoneParts';
import { useIsMobile } from '../hooks/useIsMobile';
import { t, tn } from '../i18n/t';
import { Icon } from '../icons';
import { useBackClose } from '../mobile/useBackClose';
import { relativeAge } from './age';
import { groupItems, GROUP_LABEL, KIND_LABEL, type FeedItem, type ItemKind } from './model';
import { useNotifications } from './NotificationsContext';
import { serializeAreas } from './prefs';
import { useValidationOptional } from '../validate/ValidationContext';
import { useCreateAction } from '../actions/ActionsContext';
import { notificationPrefill } from '../actions/prefill';
import { codeKey } from '../calc';
import { NOTIFICATIONS_PATH } from '../navigation';
import { canCreateFrom, categoryOf } from './categories';
import './notifications.css';
import './inbox.css';

const KIND_ICON: Record<ItemKind, string> = { action: 'alert', alert: 'bell', update: 'info' };
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Row({ item, isNew, nowMs, onGo, onSnooze, onDismiss, onCreate }: {
  item: FeedItem; isNew: boolean; nowMs: number; onGo: (i: FeedItem) => void; onSnooze: (i: FeedItem, days: number) => void; onDismiss: (i: FeedItem) => void;
  onCreate?: (i: FeedItem) => void;
}) {
  const [menu, setMenu] = useState(false);
  const age = item.created_at ? relativeAge(item.created_at, nowMs) : '';
  const canDefer = item.kind !== 'action';
  return (
    <li className={`np-row np-row--${item.kind}`} data-testid="notif-row" data-kind={item.kind} data-type={item.type} data-id={item.id}>
      <div className="np-row-top">
        <span className={`np-kind np-kind--${item.kind}`}>
          <Icon name={KIND_ICON[item.kind]} size={14} />
          <span>{t(KIND_LABEL[item.kind])}</span>
        </span>
        {isNew && <span className="np-new" data-testid="notif-new">{t('New')}</span>}
        {item.area_id && <span className="np-chip" data-testid="notif-area">{item.area_id}</span>}
        {age && <span className="np-age" data-testid="notif-age">{age}</span>}
      </div>
      <p className="np-title" data-testid="notif-title">{item.title}</p>
      {item.detail && <p className="np-detail" title={item.detail} data-testid="notif-detail">{item.detail}</p>}
      <div className="np-actions">
        {item.link && (
          <button type="button" className="btn-primary np-go" onClick={() => onGo(item)} data-testid="notif-go">{item.linkLabel}</button>
        )}
        {onCreate && canCreateFrom(item) && (
          <button type="button" className="btn np-btn" onClick={() => onCreate(item)} data-testid="notif-create-action">
            <Icon name="plus" size={14} /> {t('Create action')}
          </button>
        )}
        {canDefer && (
          <>
            <button type="button" className="btn np-btn" aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu((m) => !m)} data-testid="notif-snooze">
              <Icon name="clock" size={14} /> {t('Snooze')}
            </button>
            <button type="button" className="btn np-btn" onClick={() => onDismiss(item)} data-testid="notif-dismiss">
              {t('Dismiss')}
            </button>
          </>
        )}
      </div>
      {menu && (
        <div className="np-snooze" role="group" aria-label={t('Snooze for')} data-testid="notif-snooze-menu">
          <button type="button" className="btn np-btn" onClick={() => { setMenu(false); onSnooze(item, 1); }} data-testid="snooze-1">{t('1 day')}</button>
          <button type="button" className="btn np-btn" onClick={() => { setMenu(false); onSnooze(item, 7); }} data-testid="snooze-7">{t('7 days')}</button>
        </div>
      )}
    </li>
  );
}

/** Watched areas: a summary button that opens the chip row (empty selection = every area). */
function WatchAreas() {
  const n = useNotifications();
  const areas = useValidationOptional()?.st.startup?.areas ?? [];
  const [open, setOpen] = useState(false);
  const watched = n.prefs.watchAreas;
  const summary = watched.length === 0 ? t('All areas') : watched.length <= 3 ? watched.join(', ') : tn(watched.length, '{n} area', '{n} areas');
  const toggle = (id: string) => {
    const next = watched.includes(id) ? watched.filter((a) => a !== id) : [...watched, id];
    void n.savePrefs({ watch_areas: serializeAreas(next) });
  };
  if (areas.length === 0) return null;
  return (
    <section className="np-watch" aria-label={t('Watch areas')} data-testid="notif-watch">
      <button type="button" className="np-watch-toggle" aria-expanded={open} aria-controls="np-watch-chips" onClick={() => setOpen((o) => !o)} data-testid="notif-watch-toggle">
        <span className="np-watch-label">{t('Watch areas')}</span>
        <span className="np-watch-sum" data-testid="notif-watch-summary">{summary}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
      </button>
      {open && (
        <div className="np-watch-chips" id="np-watch-chips">
          <ChipRow label={t('Watch areas')}>
            <CountChip on={watched.length === 0} onClick={() => void n.savePrefs({ watch_areas: '' })} testid="watch-all">{t('All areas')}</CountChip>
            {areas.map((a) => (
              <CountChip key={a.area_id} on={watched.includes(a.area_id)} onClick={() => toggle(a.area_id)} testid={`watch-${a.area_id}`}>{a.area_id}</CountChip>
            ))}
          </ChipRow>
        </div>
      )}
    </section>
  );
}

// The notification panel: a popover under the bell on a desktop, a full-screen sheet on a phone (Back closes it).
// Groups: Action needed, Alerts, Updates (empty groups are left out). Esc closes, Tab stays inside, focus returns to the bell.
export default function NotificationPanel({ anchorRef }: { anchorRef: RefObject<HTMLButtonElement | null> }) {
  const n = useNotifications();
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [message, setMessage] = useState('');
  const { closePanel, markSeen, unseenIds } = n;

  useBackClose(mobile, closePanel);

  // desktop: sit under the bell, right edges aligned
  useLayoutEffect(() => {
    if (mobile) return undefined;
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (r) setPos({ top: Math.round(r.bottom + 8), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [mobile, anchorRef]);

  // opening the panel marks what is in it as seen (the amber dot clears); the rows keep a "New" tag meanwhile
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set(unseenIds));
  const tried = useRef(new Set<string>());
  useEffect(() => {
    const todo = unseenIds.filter((id) => !tried.current.has(id));
    if (todo.length === 0) return;
    todo.forEach((id) => tried.current.add(id));
    setNewIds((cur) => new Set([...cur, ...todo]));
    void markSeen(todo);
  }, [unseenIds, markSeen]);

  // focus in, Esc, Tab trap, click outside (desktop), focus back to the bell
  useEffect(() => {
    const anchor = anchorRef.current;
    const box = boxRef.current;
    box?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePanel();
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      const list = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === box)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !box.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (mobile) return;
      const target = e.target as Node;
      if (box && !box.contains(target) && !anchor?.contains(target)) closePanel();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
      anchor?.focus({ preventScroll: true });
    };
  }, [anchorRef, closePanel, mobile]);

  const groups = useMemo(() => groupItems(n.items), [n.items]);
  const createAction = useCreateAction();
  const v = useValidationOptional();
  const known = useMemo(() => new Set((v?.st.startup?.equipment ?? []).map((e) => codeKey(e.equipment_id))), [v?.st.startup]);
  const onCreate = useCallback((item: FeedItem) => {
    if (!createAction) return;
    closePanel();
    createAction(notificationPrefill(item, categoryOf(item), {
      findEvent: (id) => v?.rows.find((r) => r.event_id === id),
      isEquipment: (code) => known.size === 0 || known.has(codeKey(code)),
    }));
  }, [createAction, closePanel, v, known]);
  const seeAll = useCallback(() => {
    closePanel();
    navigate(NOTIFICATIONS_PATH);
  }, [closePanel, navigate]);
  const nowMs = Date.now();
  const go = useCallback((item: FeedItem) => {
    if (!item.link) return;
    closePanel();
    navigate(item.link.to, item.link.state ? { state: item.link.state } : undefined);
  }, [closePanel, navigate]);
  const snooze = useCallback(async (item: FeedItem, days: number) => {
    const ok = await n.snooze(item.id, days);
    if (ok) setMessage(days === 1 ? t('Snoozed for 1 day.') : t('Snoozed for {n} days.', { n: days }));
  }, [n]);
  const dismiss = useCallback(async (item: FeedItem) => {
    const ok = await n.dismiss(item.id);
    if (ok) setMessage(t('Dismissed.'));
  }, [n]);

  const body = (
    <div
      ref={boxRef}
      className={mobile ? 'np np--sheet' : 'np np--pop'}
      style={!mobile && pos ? { top: pos.top, right: pos.right } : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="np-title"
      tabIndex={-1}
      data-testid="notif-panel"
    >
      <header className="np-head">
        <h2 id="np-title">{t('Notifications')}</h2>
        <button type="button" className="np-close" onClick={closePanel} aria-label={t('Close')} data-testid="notif-close">
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="np-body">
        <WatchAreas />
        <div className="np-sr" role="status" aria-live="polite" data-testid="notif-status">{message}</div>
        {n.actionError && (
          <div className="callout callout--danger np-error" role="alert" data-testid="notif-error">
            <Icon name="alert" size={16} />
            <span>{n.actionError}</span>
            <button type="button" className="btn np-btn" onClick={n.clearActionError}>{t('Dismiss')}</button>
          </div>
        )}
        {n.stale && <p className="np-note" data-testid="notif-stale">{t('Could not refresh just now. Showing the last list.')}</p>}
        {groups.length === 0 ? (
          <div className="np-empty" data-testid="notif-empty">
            <Icon name="check" size={22} />
            <p>{n.loaded || n.items.length > 0 ? t('You are all caught up') : t('Loading…')}</p>
            {n.loaded && n.prefs.watchAreas.length > 0 && <small>{t('Only the areas you watch are shown.')}</small>}
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.kind} className="np-group" aria-labelledby={`np-h-${g.kind}`} data-testid={`notif-group-${g.kind}`}>
              <h3 id={`np-h-${g.kind}`} className="np-group-title">
                {t(GROUP_LABEL[g.kind])} <span className="np-count" data-testid={`notif-count-${g.kind}`}>{g.items.length}</span>
              </h3>
              <ul className="np-list">
                {g.items.map((item) => (
                  <Row key={item.id} item={item} isNew={newIds.has(item.id)} nowMs={nowMs} onGo={go} onSnooze={snooze} onDismiss={dismiss} onCreate={createAction ? onCreate : undefined} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <div className="np-all">
        <button type="button" className="btn" onClick={seeAll} data-testid="notif-see-all"><Icon name="list" size={15} /> {t('See all notifications')}</button>
      </div>
    </div>
  );

  return createPortal(
    body,
    document.body,
  );
}
