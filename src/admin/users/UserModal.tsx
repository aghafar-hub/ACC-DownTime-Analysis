import { useState } from 'react';
import { tsText } from '../../util/dates';
import { api } from '../../api';
import type { AccessLevel, AdminUser, TabId } from '../../api/types';
import { TAB_IDS } from '../../api/types';
import { ChipRow } from '../../components/PhoneParts';
import ShellModal, { FormSection } from '../../components/ShellModal';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { pageById, pageLabel, ROLE_LABELS } from '../../navigation';
import ConfirmDialog from '../ConfirmDialog';
import { useAction } from '../useAction';
import { ROLE_IDS, roleDefault } from './roleDefaults';

const LEVELS: AccessLevel[] = ['Hidden', 'View', 'Edit'];
const LEVEL_SYMBOL: Record<AccessLevel, string> = { Hidden: '⊘', View: '◉', Edit: '✎' };
export const roleName = (id: string): string => t(ROLE_LABELS[id] ?? id);

type Overrides = Partial<Record<TabId, AccessLevel>>;

export default function UserModal({ user, self, activeAdmins, canEdit, onClose, onChanged, onTempPassword, toast }: {
  user: AdminUser; self: boolean; activeAdmins: number; canEdit: boolean; onClose: () => void;
  onChanged: (u: AdminUser) => void; onTempPassword: (who: string, pw: string) => void; toast: (s: string) => void;
}) {
  const details = useAction();
  const reset = useAction();
  const access = useAction();
  const [name, setName] = useState(user.display_name);
  const [role, setRole] = useState(user.role_id);
  const [active, setActive] = useState(user.active);
  const [nameError, setNameError] = useState('');
  const [ov, setOv] = useState<Overrides>({ ...(user.overrides ?? {}) });
  const [confirm, setConfirm] = useState<null | 'deactivate' | 'reset' | 'clear'>(null);

  const lastAdmin = user.role_id === 'ROLE-ADMIN' && user.active && activeAdmins <= 1;
  const lockRole = self || lastAdmin;
  const lockActive = self || lastAdmin;
  const detailsChanged = name.trim() !== user.display_name || role !== user.role_id || active !== user.active;
  const effective = (tab: TabId): AccessLevel => ov[tab] ?? roleDefault(user.role_id, tab);
  const savedOv = user.overrides ?? {};
  const ovChanged = JSON.stringify(TAB_IDS.map((x) => ov[x] ?? '')) !== JSON.stringify(TAB_IDS.map((x) => savedOv[x] ?? ''));
  const ovCount = TAB_IDS.filter((x) => ov[x]).length;

  async function saveDetails() {
    if (!name.trim()) return setNameError(t('Please enter a name.'));
    setNameError('');
    const changes: Parameters<typeof api.updateUser>[2] = {};
    if (name.trim() !== user.display_name) changes.display_name = name.trim();
    if (role !== user.role_id) changes.role_id = role;
    if (active !== user.active) changes.active = active;
    const res = await details.run((tok) => api.updateUser(tok, user.user_id, changes));
    if (res.ok) { onChanged(res.value); toast(t('Saved {name}.', { name: res.value.display_name })); }
  }
  const onSaveDetails = () => (user.active && !active ? setConfirm('deactivate') : void saveDetails());

  async function doReset() {
    setConfirm(null);
    const res = await reset.run((tok) => api.resetPassword(tok, user.user_id));
    if (res.ok) onTempPassword(`${user.display_name} · ${user.email}`, res.value.temp_password);
  }
  async function saveAccess(next: Overrides, text: string) {
    const res = await access.run((tok) => api.setUserTabAccess(tok, user.user_id, next));
    if (res.ok) { onChanged(res.value); setOv({ ...(res.value.overrides ?? {}) }); toast(text); }
  }
  const pick = (tab: TabId, level: AccessLevel) =>
    setOv((cur) => {
      const n = { ...cur };
      if (level === roleDefault(user.role_id, tab)) delete n[tab]; else n[tab] = level;
      return n;
    });

  return (
    <ShellModal
      icon="users" title={user.display_name} subtitle={user.email} onClose={onClose} width={760} testid="user-modal"
      badge={<>{user.active ? <span className="badge badge--success"><span aria-hidden="true">●</span> {t('Active')}</span> : <span className="badge"><span aria-hidden="true">⊘</span> {t('Inactive')}</span>}{self && <span className="badge badge--accent">{t('You')}</span>}</>}
      footer={<button type="button" className="btn" onClick={onClose} data-testid="user-close">{t('Close')}</button>}
    >
      <FormSection icon="edit" title={t('Details')}>
        {details.error && <div className="callout callout--danger" role="alert" data-testid="details-error"><Icon name="alert" size={16} /><span>{details.error}</span></div>}
        <fieldset disabled={!canEdit || details.busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="form-grid">
            <div className={nameError ? 'field field--error' : 'field'}>
              <label htmlFor="u-name">{t('Name')}</label>
              <input id="u-name" className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="u-name" />
              {nameError && <span className="field-error" role="alert" data-testid="error-name">{nameError}</span>}
            </div>
            <div className="field">
              <span className="field-label">{t('Email')}</span>
              <div className="adm-readbox">{user.email}</div>
            </div>
            <div className="field">
              <span className="field-label">{t('Role')}</span>
              <ChipRow label={t('Role')}>
                {ROLE_IDS.map((r) => <button key={r} type="button" className={role === r ? 'chip chip--on' : 'chip'} aria-pressed={role === r} disabled={lockRole} onClick={() => setRole(r)} data-testid={`u-role-${r}`}>{roleName(r)}</button>)}
              </ChipRow>
              {self && <span className="field-hint" data-testid="hint-self-role">{t('You cannot change your own role.')}</span>}
              {!self && lastAdmin && <span className="field-hint" data-testid="hint-last-admin">{t('This is the only active Admin, so the role cannot be changed.')}</span>}
            </div>
            <div className="field">
              <span className="field-label">{t('Account')}</span>
              <ChipRow label={t('Account')}>
                <button type="button" className={active ? 'chip chip--on' : 'chip'} aria-pressed={active} disabled={lockActive} onClick={() => setActive(true)} data-testid="u-active">{t('Active')}</button>
                <button type="button" className={!active ? 'chip chip--on' : 'chip'} aria-pressed={!active} disabled={lockActive} onClick={() => setActive(false)} data-testid="u-inactive">{t('Inactive')}</button>
              </ChipRow>
              {self && <span className="field-hint" data-testid="hint-self-active">{t('You cannot deactivate yourself.')}</span>}
              {!self && lastAdmin && <span className="field-hint">{t('This is the only active Admin, so it cannot be deactivated.')}</span>}
            </div>
          </div>
        </fieldset>
        {canEdit && <div className="chip-row" style={{ marginTop: 12 }}><button type="button" className="btn-primary" onClick={onSaveDetails} disabled={!detailsChanged || details.busy} data-testid="save-user">{details.busy ? t('Saving…') : t('Save details')}</button></div>}
      </FormSection>

      <FormSection icon="shield" title={t('Password')}>
        <p className="adm-note">
          {user.must_change ? <><span aria-hidden="true">▲ </span>{t('This person is using a temporary password and must choose their own at the next sign-in.')}</> : t('Passwords are never shown. A reset gives a new one-time temporary password.')}
          {' '}{user.last_login_at ? t('Last sign-in: {when}.', { when: tsText(user.last_login_at) }) : t('Has not signed in yet.')}
        </p>
        {reset.error && <div className="callout callout--danger" role="alert"><Icon name="alert" size={16} /><span>{reset.error}</span></div>}
        {canEdit && <button type="button" className="btn" onClick={() => setConfirm('reset')} disabled={reset.busy} data-testid="reset-password"><Icon name="sync" size={15} /> {t('Reset password')}</button>}
      </FormSection>

      <FormSection icon="list" title={t('Page access')} hint={t('Role: {r}', { r: roleName(user.role_id) })} right={<span className="badge" data-testid="override-count">{t('{n} exceptions', { n: ovCount })}</span>}>
        <p className="adm-note">{t('Each page follows the role unless you set an exception for this person. Tap the role default again to remove an exception.')}</p>
        {access.error && <div className="callout callout--danger" role="alert" data-testid="access-error"><Icon name="alert" size={16} /><span>{access.error}</span></div>}
        <div className="adm-access" data-testid="access-editor">
          {TAB_IDS.map((tab) => {
            const def = roleDefault(user.role_id, tab);
            const eff = effective(tab);
            const lockUsers = self && tab === 'users';
            return (
              <div className="adm-access-row" key={tab} data-testid={`access-${tab}`}>
                <div className="adm-access-name">
                  <b>{pageLabel(pageById(tab))}</b>
                  <span className="adm-muted-sm" data-testid={`default-${tab}`}>{t('Role default: {level}', { level: t(def) })}</span>
                  {ov[tab] && <span className="badge badge--accent" data-testid={`override-${tab}`}>{t('Exception')}</span>}
                </div>
                <div className="chip-row" role="group" aria-label={t('Access to {page}', { page: pageLabel(pageById(tab)) })}>
                  {LEVELS.map((l) => (
                    <button key={l} type="button" className={eff === l ? 'chip chip--on' : 'chip'} aria-pressed={eff === l} disabled={!canEdit || access.busy || (lockUsers && l !== 'Edit')} onClick={() => pick(tab, l)} data-testid={`access-${tab}-${l}`}>
                      <span aria-hidden="true">{LEVEL_SYMBOL[l]}</span> {t(l)}
                    </button>
                  ))}
                </div>
                {lockUsers && <span className="field-hint" data-testid="hint-self-users">{t('You cannot take away your own access to Users.')}</span>}
              </div>
            );
          })}
        </div>
        {canEdit && (
          <div className="chip-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn-primary" onClick={() => void saveAccess(ov, t('Page access saved.'))} disabled={!ovChanged || access.busy} data-testid="save-access">{access.busy ? t('Saving…') : t('Save access')}</button>
            <button type="button" className="btn" onClick={() => setConfirm('clear')} disabled={(ovCount === 0 && Object.keys(savedOv).length === 0) || access.busy} data-testid="clear-overrides">{t('Clear exceptions')}</button>
          </div>
        )}
      </FormSection>

      {confirm === 'deactivate' && (
        <ConfirmDialog title={t('Deactivate {name}?', { name: user.display_name })} danger confirmLabel={t('Deactivate')} busy={details.busy} onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void saveDetails(); }}>
          {t('They will be signed out and cannot sign in until you make the account active again. Their history stays.')}
        </ConfirmDialog>
      )}
      {confirm === 'reset' && (
        <ConfirmDialog title={t('Reset the password of {name}?', { name: user.display_name })} danger confirmLabel={t('Reset password')} busy={reset.busy} onCancel={() => setConfirm(null)} onConfirm={() => void doReset()}>
          {t('The old password stops working at once. You will see a new temporary password once, to give to the person.')}
        </ConfirmDialog>
      )}
      {confirm === 'clear' && (
        <ConfirmDialog title={t('Clear all exceptions?')} confirmLabel={t('Clear exceptions')} busy={access.busy} onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void saveAccess({}, t('Exceptions cleared. Access follows the role.')); }}>
          {t('{name} will get the standard access of the {role} role on every page.', { name: user.display_name, role: roleName(user.role_id) })}
        </ConfirmDialog>
      )}
    </ShellModal>
  );
}
