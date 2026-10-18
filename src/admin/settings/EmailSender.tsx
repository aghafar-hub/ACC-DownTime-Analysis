// Settings > Notifications, for administrators (backend 1.9.0): the system email the app sends from, the steps to make it a
// Gmail "Send mail as" address of the account that runs the app, and "Send a test email" (Admin role only).
import { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Icon } from '../../icons';
import { t } from '../../i18n/t';
import { useAction } from '../useAction';
import SettingsForm from '../SettingsForm';
import type { Setting } from '../../api/types';

export default function EmailSender({ settings, onSaved }: { settings: Setting[]; onSaved: (text: string) => void }) {
  const admin = useAuth().user?.role_id === 'ROLE-ADMIN';
  const { run, busy, error } = useAction();
  const [result, setResult] = useState<string | null>(null);
  async function test() {
    setResult(null);
    const res = await run((tok) => api.sendTestEmail(tok));
    if (res.ok) setResult(t('Sent to {to} from {from}.', { to: res.value.to, from: res.value.from }));
  }
  return (
    <div data-testid="email-sender">
      <SettingsForm settings={settings} canEdit groupIds={['email']} onSaved={onSaved} />
      <section className="card" aria-label={t('How to set up the system email')} data-testid="email-steps">
        <h3 className="np-admin-h" style={{ marginTop: 0 }}>{t('How to set up the system email')}</h3>
        <ol className="adm-steps">
          <li>{t('Sign in to Gmail with the Google account that runs the app (the one that deployed the Apps Script).')}</li>
          <li>{t('Open Settings (gear) › See all settings › Accounts › "Send mail as" › Add another email address.')}</li>
          <li>{t('Enter the system email and its name, leave "Treat as an alias" ticked, and confirm with the code Google sends to that address.')}</li>
          <li>{t('In the Apps Script editor, under Services, add the Gmail API (it is listed in the project file), then deploy the new version and allow the new permissions.')}</li>
          <li>{t('Write the address above, save, and press "Send a test email".')}</li>
        </ol>
        {admin && (
          <div className="np-save np-save--start">
            <button type="button" className="btn" onClick={() => void test()} disabled={busy} data-testid="send-test-email">
              <Icon name="mail" size={14} /> {busy ? t('Sending…') : t('Send a test email')}
            </button>
            {result && <span role="status" className="np-result" data-testid="send-test-result"><span aria-hidden="true">✓ </span>{result}</span>}
          </div>
        )}
        {error && <div className="callout callout--danger" role="alert" data-testid="send-test-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
      </section>
    </div>
  );
}
