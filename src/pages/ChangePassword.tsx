import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { describeError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n/t';
import { ArrowIcon, AuthShell, focusOnOpen, PasswordField } from './AuthParts';
import './Auth.css';

const MIN_LENGTH = 10; // the server checks the configured minimum as well

export default function ChangePassword() {
  const { changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < MIN_LENGTH) return setError(t('Use at least {n} characters.', { n: MIN_LENGTH }));
    if (next !== confirm) return setError(t('The two new passwords do not match.'));
    if (next === current) return setError(t('The new password must be different from the temporary one.'));
    setSubmitting(true);
    try {
      await changePassword(current, next);
      navigate('/', { replace: true });
    } catch (err) {
      setError(describeError(err, t('Could not change the password.')));
    } finally {
      setSubmitting(false);
    }
  }

  const errId = error ? 'cp-error' : undefined;

  return (
    <AuthShell>
      <p className="auth-eyebrow">{t('ACC DOWN TIME ANALYSIS')}</p>
      <h1 className="auth-title">{t('Choose your own password')}</h1>
      <p className="auth-subtitle">{t('You signed in with a temporary password. Choose a new one to continue.')}</p>

      <form className="auth-form" onSubmit={handleSubmit} data-testid="change-password-form">
        <PasswordField label={t('Temporary password')} value={current} onChange={setCurrent} autoFocus={focusOnOpen()} autoComplete="current-password" testid="cp-current" describedBy={errId} />
        <PasswordField label={t('New password')} value={next} onChange={setNext} autoComplete="new-password" testid="cp-new" describedBy={errId} />
        <PasswordField label={t('Confirm new password')} value={confirm} onChange={setConfirm} autoComplete="new-password" testid="cp-confirm" describedBy={errId} />
        <div aria-live="assertive" role="alert" className="auth-live">
          {error && <p className="auth-error" id="cp-error" data-testid="cp-error">{error}</p>}
        </div>
        <button type="submit" className="auth-submit tap-scale" disabled={submitting} data-testid="cp-submit">
          {submitting ? t('Saving…') : t('Save password')}
          {!submitting && <ArrowIcon />}
        </button>
        <button type="button" className="auth-secondary" onClick={() => logout()}>{t('Sign out')}</button>
      </form>

      <p className="auth-footer">{t('Arabian Cement Company')}</p>
    </AuthShell>
  );
}
