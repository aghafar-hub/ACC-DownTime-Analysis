import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from '../../api';
import type { ActiveUser, ActiveUsersPayload } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { Tile } from '../../components/Tile';
import { useIsMobile } from '../../hooks/useIsMobile';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { ROLE_LABELS } from '../../navigation';
import { tsText } from '../../util/dates';
import { num } from '../../util/format';
import { agoText, pageNameOf } from './activityText';
import '../../components/ui.css';
import '../admin.css';
import './activity.css';

const REFRESH_MS = 60_000;

function Status({ u }: { u: ActiveUser }) {
  if (!u.active) return <span className="badge" data-testid="au-status" data-status="off"><span aria-hidden="true">⊘</span> {t('Account switched off')}</span>;
  if (u.online) return <span className="badge badge--success" data-testid="au-status" data-status="online"><span aria-hidden="true">●</span> {t('Online now')}</span>;
  if (u.today) return <span className="badge badge--accent" data-testid="au-status" data-status="today"><span aria-hidden="true">◐</span> {t('Active today')}</span>;
  return <span className="badge" data-testid="au-status" data-status="away"><span aria-hidden="true">○</span> {u.last_seen_at ? t('Not today') : t('Never signed in')}</span>;
}

function Device({ u }: { u: ActiveUser }) {
  if (!u.device) return <span className="muted">-</span>;
  return <span className="au-device" data-testid="au-device">{u.device === 'phone' ? t('Phone') : t('Desktop')}</span>;
}

/**
 * Settings > Active users (Admin only, backend 1.6.0): who is using the app now (a call in the last 5 minutes), who was
 * here today and when each person was last seen, with their role, device and the page they last had open. The browser
 * of every signed-in person checks in every 2 minutes while the app is open (the access check it already made), and the
 * server writes it down at most every few minutes per person. Refreshes itself every minute while it is open.
 */
export default function ActiveUsers() {
  const { token, user: me } = useAuth();
  const mobile = useIsMobile();
  const [data, setData] = useState<ActiveUsersPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedAt = useRef(Date.now());
  const [, setTick] = useState(0);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    api.listActiveUsers(token).then(
      (d) => { fetchedAt.current = Date.now(); setData(d); setError(null); setLoading(false); },
      (e) => { setError(describeError(e)); setLoading(false); },
    );
  }, [token]);

  // every minute while open and visible; at once when the app comes back to the front
  useEffect(() => {
    load();
    const id = window.setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, REFRESH_MS);
    const tick = window.setInterval(() => setTick((n) => n + 1), 20_000); // keeps "2 min ago" moving between loads
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(id); window.clearInterval(tick); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const since = Date.now() - fetchedAt.current;
  const ago = (u: ActiveUser) => (data && u.last_seen_at ? agoText(u.last_seen_at, data.now, since) : '');
  const users = data?.users ?? [];
  const online = data?.online_count ?? 0;
  const roleName = (r: string) => t(ROLE_LABELS[r] ?? r);

  return (
    <div data-testid="settings-active-users">
      <div className="au-head">
        <span className={online ? 'badge badge--success au-count' : 'badge au-count'} data-testid="online-count" data-count={online}>
          <span aria-hidden="true">●</span> {t('{n} online now', { n: num(online) })}
        </span>
        <p className="status-line au-updated" data-testid="au-updated">
          {data ? t('Updated {time} · refreshes every minute', { time: tsText(data.now).slice(-5) }) : error ? '' : t('Loading…')}
        </p>
        <button type="button" className="btn btn-sm" onClick={load} disabled={loading} data-testid="au-refresh">
          <Icon name="sync" size={15} /> {t('Refresh')}
        </button>
      </div>
      <div className="tiles">
        <Tile icon="users" label={t('Online now')} value={data ? num(online) : '-'} sub={t('a call in the last {n} minutes', { n: data?.online_minutes ?? 5 })} testid="fact-online" />
        <Tile icon="clock" label={t('Active today')} value={data ? num(data.today_count) : '-'} sub={t('seen since midnight (plant time)')} testid="fact-today" />
        <Tile icon="shield" label={t('Accounts')} value={data ? num(users.filter((u) => u.active).length) : '-'} sub={t('switched on')} testid="fact-accounts" />
      </div>
      {error && <div className="callout callout--danger" role="alert" data-testid="server-error"><Icon name="alert" size={16} /><span>{error}</span><button type="button" className="btn btn-sm" onClick={load}>{t('Try again')}</button></div>}
      <p className="adm-note">
        {t('The app checks in every 2 minutes while it is open on someone’s screen. “Online now” means a check-in or any other use in the last 5 minutes; the page is the one open at the last check-in.')}
      </p>
      {data && !mobile && (
        <div className="table-wrap" data-testid="au-table">
          <table className="data-table">
            <thead>
              <tr><th scope="col">{t('Name')}</th><th scope="col">{t('Role')}</th><th scope="col">{t('Status')}</th><th scope="col">{t('Last seen')}</th><th scope="col">{t('Device')}</th><th scope="col">{t('Page')}</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} data-testid="au-row" data-user={u.user_id} data-online={u.online ? 'true' : 'false'}>
                  <td>{u.display_name}{u.user_id === me?.user_id && <> <span className="badge badge--accent">{t('You')}</span></>}</td>
                  <td>{roleName(u.role_id)}</td>
                  <td><Status u={u} /></td>
                  <td className="nowrap">
                    {u.last_seen_at ? <><span data-testid="au-ago">{ago(u)}</span><div className="muted au-when">{tsText(u.last_seen_at)}</div></> : <span className="muted">{t('never')}</span>}
                  </td>
                  <td><Device u={u} /></td>
                  <td>{pageNameOf(u.last_page) || <span className="muted">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && mobile && (
        <div className="adm-cards" data-testid="au-cards">
          {users.map((u) => (
            <div key={u.user_id} className="adm-card" data-testid="au-row" data-user={u.user_id} data-online={u.online ? 'true' : 'false'}>
              <div className="adm-card-top">
                <span className="adm-card-title" style={{ fontFamily: 'var(--sans)' }}>{u.display_name}{u.user_id === me?.user_id && <> <span className="badge badge--accent">{t('You')}</span></>}</span>
                <span className="badge">{roleName(u.role_id)}</span>
              </div>
              <div className="adm-card-line">
                {u.last_seen_at ? t('Last seen {ago} · {when}', { ago: ago(u), when: tsText(u.last_seen_at) }) : t('Never signed in')}
              </div>
              {(u.device || u.last_page) && (
                <div className="adm-card-line">{[u.device ? (u.device === 'phone' ? t('Phone') : t('Desktop')) : '', pageNameOf(u.last_page)].filter(Boolean).join(' · ')}</div>
              )}
              <div className="adm-card-badges"><Status u={u} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
