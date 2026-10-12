import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { t, tn } from '../i18n/t';
import { Icon } from '../icons';
import { hours } from '../util/format';
import { useValidationOptional } from './ValidationContext';
import './validate.css';

// Kept in memory only: dismissing hides the banner until the page is reloaded, then it comes back.
let dismissed = false;

/**
 * One line shown on the dashboards and the Event Explorer when records are left out of the numbers
 * because they have a blocking problem. Opens the Validate page.
 */
export function ValidationBanner() {
  const v = useValidationOptional();
  const { canView } = useAuth();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(dismissed);
  if (!v || !v.ready || hidden) return null;
  const b = v.list.summary.blocked;
  if (b.count === 0) return null;
  const hrs = hours(b.hours * 3600);
  return (
    <div className="vbanner" role="status" data-testid="validation-banner">
      <span className="vbanner-sym" aria-hidden="true">◆</span>
      <span className="vbanner-text">
        {tn(b.count, '{n} record ({h} h) is left out of these numbers because it needs checking.', '{n} records ({h} h) are left out of these numbers because they need checking.').replace('{h}', hrs)}
      </span>
      {canView('events') && (
        <a
          href="#/validate"
          className="vbanner-link"
          data-testid="validation-banner-open"
          onClick={(e) => { e.preventDefault(); navigate('/validate'); }}
        >
          {t('Open Validate')}
        </a>
      )}
      <button
        type="button"
        className="vbanner-x"
        aria-label={t('Hide this note until the page is reloaded')}
        data-testid="validation-banner-close"
        onClick={() => { dismissed = true; setHidden(true); }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/** For tests and sign-out: bring the banner back. */
export function resetValidationBanner(): void {
  dismissed = false;
}
