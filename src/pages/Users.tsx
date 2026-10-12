import { useCallback, useEffect, useState } from 'react';
import { api, describeError } from '../api';
import type { AdminUser } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import PlaceholderPage from '../components/PlaceholderPage';
import { Tile } from '../components/Tile';
import { t } from '../i18n/t';
import { ROLE_LABELS } from '../navigation';
import { num, whenText } from '../util/format';

export default function Users() {
  const { token } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!token) return;
    setError(null);
    api.listUsers(token).then(setUsers, (e) => setError(describeError(e)));
  }, [token]);
  useEffect(load, [load]);
  const active = users?.filter((u) => u.active).length ?? 0;
  const pending = users?.filter((u) => u.must_change).length ?? 0;
  const byRole = users ? Object.entries(users.reduce<Record<string, number>>((m, u) => ({ ...m, [u.role_id]: (m[u.role_id] ?? 0) + 1 }), {})) : [];
  const lastLogin = users?.map((u) => u.last_login_at).filter(Boolean).sort().pop();
  return (
    <PlaceholderPage
      tab="users"
      subtitle={users ? t('{n} accounts · {active} active · {pending} waiting to choose a password', { n: users.length, active, pending }) : error ?? t('Loading…')}
      tiles={
        <>
          <Tile icon="users" label={t('Accounts')} value={users ? num(users.length) : '-'} sub={byRole.map(([r, n]) => `${n} ${t(ROLE_LABELS[r] || r)}`).join(' · ')} testid="fact-users" />
          <Tile icon="check" label={t('Active')} value={users ? num(active) : '-'} testid="fact-active" />
          <Tile icon="shield" label={t('Using a temporary password')} value={users ? num(pending) : '-'} sub={t('must choose their own')} testid="fact-pending" />
          <Tile icon="clock" label={t('Latest sign-in')} value={lastLogin ? lastLogin.slice(0, 10) : '-'} sub={lastLogin ? whenText(lastLogin.replace(' ', 'T')) : undefined} testid="fact-last-login" />
        </>
      }
      next={{
        title: t('Accounts and access'),
        points: [
          'Create accounts (a one-time temporary password is shown once), deactivate, reset a password, and change a role',
          'Per-tab access (Hidden, View, Edit) for each role, with exceptions for single people',
          'The server enforces every level; hidden pages never receive their data',
        ],
      }}
    >
      {error && <div className="callout callout--danger" role="alert"><span>{error}</span><button type="button" className="btn btn-sm" onClick={load}>{t('Try again')}</button></div>}
    </PlaceholderPage>
  );
}
