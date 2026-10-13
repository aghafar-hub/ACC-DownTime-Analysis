import { useCallback, useEffect, useState } from 'react';
import { dateText, tsText } from '../../util/dates';
import { api, describeError } from '../../api';
import type { AdminUser } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import AccessBadge from '../../components/AccessBadge';
import { Tile } from '../../components/Tile';
import { useIsMobile } from '../../hooks/useIsMobile';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { num, whenText } from '../../util/format';
import { useToast } from '../useToast';
import CreateUserModal from '../users/CreateUserModal';
import TempPasswordDialog from '../users/TempPasswordDialog';
import UserModal, { roleName } from '../users/UserModal';
import '../../components/ui.css';
import '../admin.css';

function Badges({ u }: { u: AdminUser }) {
  return (
    <>
      {u.active ? <span className="badge badge--success"><span aria-hidden="true">●</span> {t('Active')}</span> : <span className="badge"><span aria-hidden="true">⊘</span> {t('Inactive')}</span>}
      {u.must_change && <span className="badge badge--warning" data-testid="badge-temp"><span aria-hidden="true">▲</span> {t('Temporary password')}</span>}
      {u.overrides && Object.keys(u.overrides).length > 0 && <span className="badge badge--accent" data-testid="badge-exceptions"><span aria-hidden="true">✎</span> {t('{n} exceptions', { n: Object.keys(u.overrides).length })}</span>}
    </>
  );
}

/** Settings > Users and access: the accounts, roles, one-time passwords and per-page access exceptions. */
export default function UsersAccess() {
  const { token, user: me, canEdit } = useAuth();
  const mobile = useIsMobile();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [toastNode, toast] = useToast();
  const edit = canEdit('users');

  const load = useCallback(() => {
    if (!token) return;
    setError(null);
    api.listUsers(token).then(setUsers, (e) => setError(describeError(e)));
  }, [token]);
  useEffect(load, [load]);

  const replace = (u: AdminUser) => setUsers((cur) => cur?.map((x) => (x.user_id === u.user_id ? u : x)) ?? cur);
  const active = users?.filter((u) => u.active).length ?? 0;
  const pending = users?.filter((u) => u.must_change).length ?? 0;
  const activeAdmins = users?.filter((u) => u.active && u.role_id === 'ROLE-ADMIN').length ?? 0;
  const byRole = users ? Object.entries(users.reduce<Record<string, number>>((m, u) => ({ ...m, [u.role_id]: (m[u.role_id] ?? 0) + 1 }), {})) : [];
  const lastLogin = users?.map((u) => u.last_login_at).filter(Boolean).sort().pop();
  const open = users?.find((u) => u.user_id === openId) ?? null;
  const signedIn = (u: AdminUser) => (u.last_login_at ? tsText(u.last_login_at) : t('never'));

  return (
    <div data-testid="page-users" data-section="users">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <p className="status-line" style={{ margin: 0, flex: '1 1 240px' }} data-testid="users-summary">
          {users ? t('{n} accounts · {active} active · {pending} waiting to choose a password', { n: users.length, active, pending }) : error ?? t('Loading…')}
          {' '}<AccessBadge edit={edit} />
        </p>
        {edit && <button type="button" className="btn-primary" onClick={() => setCreating(true)} data-testid="add-user"><Icon name="plus" size={15} /> {t('Add a person')}</button>}
      </div>
      <div className="tiles">
        <Tile icon="users" label={t('Accounts')} value={users ? num(users.length) : '-'} sub={byRole.map(([r, n]) => `${n} ${roleName(r)}`).join(' · ')} testid="fact-users" />
        <Tile icon="check" label={t('Active')} value={users ? num(active) : '-'} testid="fact-active" />
        <Tile icon="shield" label={t('Using a temporary password')} value={users ? num(pending) : '-'} sub={t('must choose their own')} testid="fact-pending" />
        <Tile icon="clock" label={t('Latest sign-in')} value={lastLogin ? dateText(lastLogin) : '-'} sub={lastLogin ? whenText(lastLogin.replace(' ', 'T')) : undefined} testid="fact-last-login" />
      </div>
      {error && <div className="callout callout--danger" role="alert"><span>{error}</span><button type="button" className="btn btn-sm" onClick={load}>{t('Try again')}</button></div>}
      {users && !mobile && (
        <div className="table-wrap" data-testid="users-table">
          <table className="data-table">
            <thead><tr><th scope="col">{t('Name')}</th><th scope="col">{t('Email')}</th><th scope="col">{t('Role')}</th><th scope="col">{t('Status')}</th><th scope="col">{t('Last sign-in')}</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} data-testid="user-row" data-email={u.email}>
                  <td><button type="button" className="row-link" style={{ fontFamily: 'var(--sans)' }} onClick={() => setOpenId(u.user_id)} aria-label={t('Open {name}', { name: u.display_name })}>{u.display_name}</button>{u.user_id === me?.user_id && <> <span className="badge badge--accent">{t('You')}</span></>}</td>
                  <td className="adm-wrap">{u.email}</td>
                  <td>{roleName(u.role_id)}</td>
                  <td><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}><Badges u={u} /></div></td>
                  <td className="mono nowrap">{signedIn(u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {users && mobile && (
        <div className="adm-cards" data-testid="users-cards">
          {users.map((u) => (
            <button key={u.user_id} type="button" className="adm-card" onClick={() => setOpenId(u.user_id)} data-testid="user-card" data-email={u.email}>
              <div className="adm-card-top"><span className="adm-card-title" style={{ fontFamily: 'var(--sans)' }}>{u.display_name}</span><span className="badge">{roleName(u.role_id)}</span></div>
              <div className="adm-card-line">{u.email}</div>
              <div className="adm-card-line">{t('Last sign-in: {when}', { when: signedIn(u) })}</div>
              <div className="adm-card-badges"><Badges u={u} /></div>
            </button>
          ))}
        </div>
      )}
      {open && (
        <UserModal
          key={open.user_id + JSON.stringify(open.overrides ?? {}) + open.display_name + open.role_id + open.active}
          user={open} self={open.user_id === me?.user_id} activeAdmins={activeAdmins} canEdit={edit}
          onClose={() => setOpenId(null)} onChanged={replace} toast={toast}
          onTempPassword={(who, password) => { load(); setSecret({ who, password }); }}
        />
      )}
      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={(u, password) => { setCreating(false); setUsers((cur) => [...(cur ?? []), u]); setSecret({ who: `${u.display_name} · ${u.email}`, password }); }}
        />
      )}
      {secret && <TempPasswordDialog who={secret.who} password={secret.password} onClose={() => setSecret(null)} />}
      {toastNode}
    </div>
  );
}
