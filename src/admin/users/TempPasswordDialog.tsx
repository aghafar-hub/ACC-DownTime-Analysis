import { useState } from 'react';
import ShellModal from '../../components/ShellModal';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** The one-time temporary password. It lives only in this dialog's props; closing it forgets it. */
export default function TempPasswordDialog({ who, password, onClose }: { who: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  return (
    <ShellModal
      icon="shield" title={t('Temporary password')} subtitle={who} onClose={onClose} width={500} testid="temp-password-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={async () => setCopied((await copyText(password)) ? 'yes' : 'no')} data-testid="copy-password">
            <Icon name="share" size={15} /> {t('Copy')}
          </button>
          <button type="button" className="btn-primary" onClick={onClose} data-testid="password-done">{t('Done')}</button>
        </>
      }
    >
      <div className="callout callout--warning" role="alert" data-testid="password-warning">
        <Icon name="alert" size={16} />
        <span><b>{t('Shown only once.')}</b> {t('Copy it now and give it to the person safely. It cannot be shown again. If it is lost, reset the password to get a new one.')}</span>
      </div>
      <code className="adm-secret" data-testid="temp-password">{password}</code>
      <p className="adm-note" style={{ margin: 0 }}>{t('The person must choose their own password the first time they sign in.')}</p>
      <p role="status" className="adm-muted-sm" data-testid="copy-status" style={{ margin: '8px 0 0' }}>
        {copied === 'yes' ? <><span aria-hidden="true">✓ </span>{t('Copied.')}</> : copied === 'no' ? <><span aria-hidden="true">▲ </span>{t('Could not copy. Select the password above and copy it by hand.')}</> : ''}
      </p>
    </ShellModal>
  );
}
