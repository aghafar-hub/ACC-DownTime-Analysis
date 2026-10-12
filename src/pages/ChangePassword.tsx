import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { describeError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n/t';
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

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit} data-testid="change-password-form">
        <h1>{t('Choose your own password')}</h1>
        <p className="auth-hint">{t('You signed in with a temporary password. Choose a new one to continue.')}</p>
        <label>
          {t('Temporary password')}
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus autoComplete="current-password" data-testid="cp-current" />
        </label>
        <label>
          {t('New password')}
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" data-testid="cp-new" />
        </label>
        <label>
          {t('Confirm new password')}
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" data-testid="cp-confirm" />
        </label>
        {error && <p className="auth-error" role="alert" data-testid="cp-error">{error}</p>}
        <button type="submit" disabled={submitting} data-testid="cp-submit">{submitting ? t('Saving…') : t('Save password')}</button>
        <button type="button" className="auth-secondary" onClick={() => logout()}>{t('Sign out')}</button>
      </form>
    </div>
  );
}
