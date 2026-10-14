// 'Your file is ready · Share': shown when a share sheet was refused because the tap that asked for the file had
// expired while the file was being made (deliverFile.ts). Its Share button is the fresh tap the browser needs.
import { useSyncExternalStore } from 'react';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { clearPending, pendingFile, sharePending, subscribePending } from './deliverFile';
import './share.css';

export default function SharePrompt() {
  const file = useSyncExternalStore(subscribePending, pendingFile, () => null);
  if (!file) return null;
  return (
    <div className="share-prompt" role="status" aria-live="polite" data-testid="share-prompt">
      <Icon name="share" size={18} />
      <span className="share-prompt-text"><b>{t('Your file is ready.')}</b> <span>{file.name}</span></span>
      <button type="button" className="share-prompt-go" onClick={() => void sharePending()} data-testid="share-prompt-go">{t('Share')}</button>
      <button type="button" className="share-prompt-close" onClick={clearPending} aria-label={t('Close')} data-testid="share-prompt-close">
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
