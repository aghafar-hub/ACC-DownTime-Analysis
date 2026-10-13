import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { describeError } from '../api';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n/t';
import { ArrowIcon, AuthShell, EmailField, PasswordField } from './AuthParts';
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
  const [forgotOpen, setForgotOpen] = useState(false);

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

  const errId = error ? 'login-error' : undefined;

  return (
    <AuthShell>
      <p className="auth-eyebrow">{t('ACC DOWN TIME ANALYSIS')}</p>
      <h1 className="auth-title">{t('Welcome back')}</h1>
      <p className="auth-subtitle">{t('Sign in to your workspace')}</p>

      <form className="auth-form" onSubmit={handleSubmit} data-testid="login-form">
        {notice && !error && <p className="auth-notice" role="status" data-testid="login-notice">{notice}</p>}
        <EmailField
          label={t('Email address')} value={email} onChange={setEmail} autoFocus name="email" autoComplete="username"
          placeholder={t('you@company.com')} testid="login-email" describedBy={errId} invalid={!!error}
        />
        <PasswordField
          label={t('Password')} value={password} onChange={setPassword} name="password" autoComplete="current-password"
          testid="login-password" describedBy={errId} invalid={!!error}
        />
        <div className="auth-row">
          <label className="auth-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="login-keep" />
            {t('Remember this device')}
          </label>
          <button
            type="button" className="auth-link" aria-expanded={forgotOpen} aria-controls="forgot-help"
            onClick={() => setForgotOpen((o) => !o)} data-testid="login-forgot"
          >
            {t('Forgot password?')}
          </button>
        </div>
        {forgotOpen && (
          <p className="auth-help" id="forgot-help" role="note" data-testid="login-forgot-help">
            {t('Ask your administrator to reset your password. They can issue a temporary one from Settings > Users.')}
          </p>
        )}
        {/* always present so a screen reader hears the message when it appears */}
        <div aria-live="assertive" role="alert" id="login-error-live" className="auth-live">
          {error && <p className="auth-error" id="login-error" data-testid="login-error">{error}</p>}
        </div>
        <button type="submit" className="auth-submit tap-scale" disabled={submitting} data-testid="login-submit">
          {submitting ? t('Signing in…') : t('Sign in')}
          {!submitting && <ArrowIcon />}
        </button>
      </form>

      <p className="auth-access">{t('Need access? Contact your administrator')}</p>

      <p className="auth-footer">{t('Arabian Cement Company')}</p>
    </AuthShell>
  );
}
