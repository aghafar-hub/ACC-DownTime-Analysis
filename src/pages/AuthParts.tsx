import { useId, useState, type ReactNode } from 'react';
import { useTheme } from '../theme/ThemeContext';
import { t } from '../i18n/t';
import heroUrl from '../assets/login-hero.webp';

// Shared pieces of the two sign-in screens (Login, ChangePassword): the split
// layout with the navy brand panel, and the labelled fields.

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" {...stroke}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7.5 8 6 8-6" />
    </svg>
  );
}
export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" {...stroke}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  );
}
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" {...stroke}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m4 4 16 16" />}
    </svg>
  );
}
export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" {...stroke}>
      <path d="M4.5 12h15m-5.5-5.5 5.5 5.5-5.5 5.5" />
    </svg>
  );
}

/** Split layout: navy brand panel (always navy, in every theme) beside the form panel (follows the theme). */
export function AuthShell({ children }: { children: ReactNode }) {
  const { dark } = useTheme();
  const base = import.meta.env.BASE_URL;
  return (
    <div className={dark ? 'auth-page auth-page--dark' : 'auth-page'}>
      <aside className="auth-hero">
        <img src={`${base}brand/acc-logo-full.png`} alt={t('Arabian Cement Company')} className="auth-hero-logo" width={602} height={316} decoding="async" />
        <p className="auth-hero-phone-caption">{t('Down Time Analysis')}</p>
        <div className="auth-hero-copy">
          <p className="auth-hero-title">{t('Understand every stop.')}</p>
          <p className="auth-hero-sub">{t('Turn downtime data into reliable decisions.')}</p>
        </div>
        <img src={heroUrl} alt="" className="auth-hero-art" width={1206} height={832} loading="lazy" decoding="async" fetchPriority="low" />
        <p className="auth-hero-caption">{t('ACC DOWN TIME ANALYSIS')}</p>
      </aside>
      <main className="auth-panel" id="main">
        <div className="auth-sheet">{children}</div>
      </main>
    </div>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testid: string;
  autoComplete: string;
  name?: string;
  autoFocus?: boolean;
  required?: boolean;
  placeholder?: string;
  describedBy?: string;
  invalid?: boolean;
};

export function EmailField({ label, value, onChange, testid, autoComplete, name, autoFocus, placeholder, describedBy, invalid }: FieldProps) {
  const id = useId();
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-control">
        <span className="auth-control-icon"><MailIcon /></span>
        <input
          id={id} type="email" value={value} onChange={(e) => onChange(e.target.value)} required autoFocus={autoFocus}
          autoComplete={autoComplete} name={name} placeholder={placeholder} data-testid={testid}
          aria-describedby={describedBy} aria-invalid={invalid || undefined} spellCheck={false} autoCapitalize="none"
        />
      </div>
    </div>
  );
}

export function PasswordField({ label, value, onChange, testid, autoComplete, name, autoFocus, describedBy, invalid, placeholder }: FieldProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-control">
        <span className="auth-control-icon"><LockIcon /></span>
        <input
          id={id} type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} required autoFocus={autoFocus}
          autoComplete={autoComplete} name={name} placeholder={placeholder} data-testid={testid}
          aria-describedby={describedBy} aria-invalid={invalid || undefined} spellCheck={false} autoCapitalize="none"
        />
        <button
          type="button" className="auth-eye" onClick={() => setShown((s) => !s)} aria-pressed={shown}
          aria-label={shown ? t('Hide password') : t('Show password')} data-testid={`${testid}-toggle`}
        >
          <EyeIcon off={shown} />
        </button>
      </div>
    </div>
  );
}
