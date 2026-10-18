import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { t, tn } from '../i18n/t';
import { Icon } from '../icons';
import { store } from '../storagePrefix';
import { hours } from '../util/format';
import { useValidationOptional } from './ValidationContext';
import './validate.css';

// Once per session (browser tab): the first page that has records left out shows the notice for a few seconds; after
// that (another page, a reload, the close button) only the small "◆ N left out" in the data line stays (DataStatusStrip).
const SEEN_KEY = 'vbanner_seen';
const seen = (): boolean => store.get(SEEN_KEY, 'session') === '1';
const AUTO_HIDE_MS = 8000;

/**
 * A floating notice, shown on the dashboards and the Events page when records are left out of the numbers because they
 * have a blocking problem. It floats over the page (fixed), so it never pushes the page down. Opens the Validate page.
 */
export function ValidationBanner() {
  const v = useValidationOptional();
  const { canView } = useAuth();
  const navigate = useNavigate();
  // decided once when the page opens: a page opened after the notice was shown never shows it again
  const [show, setShow] = useState(() => !seen());
  const boxRef = useRef<HTMLDivElement>(null);
  const b = v && v.ready ? v.list.summary.blocked : null;
  const visible = show && !!b && b.count > 0;
  useEffect(() => {
    if (!visible) return;
    store.set(SEEN_KEY, '1', 'session');
    // it floats over the page: it goes by itself after a few seconds (the data line keeps the count), unless the
    // pointer or the keyboard is on it
    const id = window.setTimeout(() => setShow((s) => (boxRef.current?.matches(':hover, :focus-within') ? s : false)), AUTO_HIDE_MS);
    return () => window.clearTimeout(id);
  }, [visible]);
  if (!visible || !b) return null;
  const hrs = hours(b.hours * 3600);
  return (
    <div className="vbanner" role="status" data-testid="validation-banner" ref={boxRef}>
      <span className="vbanner-text">
        <span className="vbanner-sym" aria-hidden="true">◆</span>{' '}
        {tn(b.count, '{n} record ({h} h) is left out of these numbers because it needs checking.', '{n} records ({h} h) are left out of these numbers because they need checking.').replace('{h}', hrs)}
      </span>
      {canView('events') && (
        <a
          href="#/validate"
          className="vbanner-link"
          data-testid="validation-banner-open"
          onClick={(e) => { e.preventDefault(); setShow(false); navigate('/validate'); }}
        >
          {t('Open Validate')}
        </a>
      )}
      <button
        type="button"
        className="vbanner-x"
        aria-label={t('Close this note; the data line keeps the count')}
        data-testid="validation-banner-close"
        onClick={() => setShow(false)}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

/** Sign-out: the next person sees the notice again. */
export function resetValidationBanner(): void {
  store.remove(SEEN_KEY, 'session');
}
