import { useState } from 'react';
import { api } from '../../api';
import type { AdminUser } from '../../api/types';
import ShellModal, { FormSection } from '../../components/ShellModal';
import { ChipRow } from '../../components/PhoneParts';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { useAction } from '../useAction';
import { ROLE_IDS } from './roleDefaults';
import { roleName } from './UserModal';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (u: AdminUser, tempPassword: string) => void }) {
  const { run, busy, error } = useAction();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('ROLE-VIEW');
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function save() {
    const e: Record<string, string> = {};
    if (!EMAIL.test(email.trim())) e.email = t('Please enter a valid email address.');
    if (!name.trim()) e.name = t('Please enter a name.');
    setErrors(e);
    if (Object.keys(e).length) return;
    const res = await run((tok) => api.createUser(tok, { email: email.trim(), display_name: name.trim(), role_id: role }));
    if (res.ok) onCreated(res.value.user, res.value.temp_password);
  }
  const err = (k: string) => errors[k] && <span className="field-error" role="alert" data-testid={`error-${k}`}>{errors[k]}</span>;
  return (
    <ShellModal icon="users" title={t('Add a person')} subtitle={t('They get a one-time temporary password')} onClose={onClose} width={560} testid="create-user-modal"
      footer={<><button type="button" className="btn" onClick={onClose} disabled={busy}>{t('Cancel')}</button><button type="button" className="btn-primary" onClick={() => void save()} disabled={busy} data-testid="create-user-save">{busy ? t('Creating…') : t('Create account')}</button></>}>
      {error && <div className="callout callout--danger" role="alert" data-testid="server-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
      <FormSection icon="users" title={t('Account')}>
        <div className="form-grid">
          <div className={errors.email ? 'field field--error span-2' : 'field span-2'}>
            <label htmlFor="cu-email">{t('Email')}</label>
            <input id="cu-email" className="input" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="cu-email" />
            {err('email')}
          </div>
          <div className={errors.name ? 'field field--error span-2' : 'field span-2'}>
            <label htmlFor="cu-name">{t('Name')}</label>
            <input id="cu-name" className="input" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} data-testid="cu-name" />
            {err('name')}
          </div>
          <div className="field span-2">
            <span className="field-label">{t('Role')}</span>
            <ChipRow label={t('Role')}>
              {ROLE_IDS.map((r) => <button key={r} type="button" className={role === r ? 'chip chip--on' : 'chip'} aria-pressed={role === r} onClick={() => setRole(r)} data-testid={`cu-role-${r}`}>{roleName(r)}</button>)}
            </ChipRow>
          </div>
        </div>
      </FormSection>
    </ShellModal>
  );
}
