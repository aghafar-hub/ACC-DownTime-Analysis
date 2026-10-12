import { useEffect, useState } from 'react';
import { ACCESS_DENIED_EVENT } from '../api';
import { t } from '../i18n/t';
import './Toast.css';

export const SAVE_BLOCKED_EVENT = 'acc-dt-save-blocked';

/** Shows why a change was not saved: the server refused it, or the page is view-only or offline. */
export default function SaveBlockedToast() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const show = (text: string) => {
      setMessage(text);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMessage(null), 8000);
    };
    const onBlocked = (e: Event) => show((e as CustomEvent<{ message?: string }>).detail?.message || t("This change wasn't saved."));
    const onDenied = () => show(t('The server did not allow that. Your access may have changed.'));
    window.addEventListener(SAVE_BLOCKED_EVENT, onBlocked);
    window.addEventListener(ACCESS_DENIED_EVENT, onDenied);
    return () => {
      window.removeEventListener(SAVE_BLOCKED_EVENT, onBlocked);
      window.removeEventListener(ACCESS_DENIED_EVENT, onDenied);
      window.clearTimeout(timer);
    };
  }, []);
  if (!message) return null;
  return (
    <div className="save-blocked-toast" role="alert" data-testid="save-blocked-toast">
      <span><strong>{t('Not saved.')}</strong> {message}</span>
      <button type="button" onClick={() => setMessage(null)} aria-label={t('Dismiss')}>×</button>
    </div>
  );
}
