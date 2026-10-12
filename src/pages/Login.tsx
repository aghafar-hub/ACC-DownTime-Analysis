import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { describeError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { IS_MOCK } from '../config';
import { t } from '../i18n/t';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../mock/demoAccounts';
import './Auth.css';

export default function Login() {
  const { login, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password, remember);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError(describeError(err, t('Sign-in failed. Please try again.')));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card-wrap">
        <div className="auth-brand">
          <img src={`${import.meta.env.BASE_URL}brand/acc-logo-full.png`} alt={t('ACC Downtime Analysis')} className="auth-logo" />
          <p className="auth-tagline">{t('Downtime Analysis')}</p>
        </div>

        <form className="auth-card" onSubmit={handleSubmit} data-testid="login-form">
          {notice && !error && <p className="auth-notice" role="status" data-testid="login-notice">{notice}</p>}
          <label>
            {t('Email')}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus autoComplete="username" name="email" data-testid="login-email" />
          </label>
          <label>
            {t('Password')}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" name="password" data-testid="login-password" />
          </label>
          <label className="auth-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="login-keep" />
            {t('Keep me signed in')}
          </label>
          {error && <p className="auth-error" role="alert" data-testid="login-error">{error}</p>}
          <button type="submit" className="tap-scale" disabled={submitting} data-testid="login-submit">
            {submitting ? t('Signing in…') : t('Sign in')}
          </button>
        </form>

        {IS_MOCK && (
          <div className="auth-demo" data-testid="demo-accounts">
            <p>{t('Demo mode with made-up data. Tap a role to fill the form.')}</p>
            <div className="auth-demo-row">
              {DEMO_ACCOUNTS.map((a) => (
                <button key={a.email} type="button" onClick={() => { setEmail(a.email); setPassword(DEMO_PASSWORD); }}>
                  {t(a.label)}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="auth-footer">{t('Arabian Cement Company · Sokhna Plant')}</p>
      </div>
    </div>
  );
}
