import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { t } from '../i18n/t';
import { bannerReason, bannerVisible } from './updateLogic';
import { applyUpdate, hideBannerForNow, startUpdates, useUpdateState } from './updateService';
import './update.css';

/** True while a modal dialog or form popup is open on the page. */
function useFormOpen(active: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!active) return;
    const check = () => setOpen(!!document.querySelector('[role="dialog"][aria-modal="true"]'));
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [active]);
  return active && open;
}

// "A new version is available" strip across the top of every screen: sign-in,
// change-password and the signed-in shell. It sits in the page flow (sticky) and
// publishes its height as --update-banner-h so the top bar, tabs and screens
// move down by exactly that much instead of being covered.
export default function UpdateBanner() {
  const state = useUpdateState();
  const visible = bannerVisible(state);
  const formOpen = useFormOpen(visible);
  const ref = useRef<HTMLDivElement>(null);
  // the new version takes a few seconds to take over the page: say so at once (phase 5: no feedback for 4 s before)
  const [reloading, setReloading] = useState(false);
  const reload = () => {
    if (reloading) return;
    setReloading(true);
    applyUpdate();
    // the page reloads within 4 s; should it ever stay, the button works again
    window.setTimeout(() => setReloading(false), 10_000);
  };

  useEffect(() => {
    startUpdates();
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!visible || !el) {
      root.style.removeProperty('--update-banner-h');
      root.classList.remove('has-update-banner');
      return;
    }
    const sync = () => root.style.setProperty('--update-banner-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    root.classList.add('has-update-banner');
    sync();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync);
    ro?.observe(el);
    window.addEventListener('resize', sync);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', sync);
      root.style.removeProperty('--update-banner-h');
      root.classList.remove('has-update-banner');
    };
  }, [visible]);

  return (
    <div className="update-region" role="status" aria-live="polite">
      {visible && (
        <div ref={ref} className={`update-banner${formOpen ? ' update-banner--form' : ''}`} data-testid="update-banner">
          <Icon name="download" size={20} />
          <p className="update-banner-text">
            <b>{t('A new version is available.')}</b>{' '}
            <span data-testid="update-banner-reason">{t(bannerReason(formOpen))}</span>
          </p>
          <div className="update-banner-actions">
            <button type="button" className="update-banner-reload" data-testid="update-reload" onClick={reload} disabled={reloading} aria-busy={reloading || undefined}>
              {reloading ? <><span className="update-spin" aria-hidden="true" /> {t('Reloading…')}</> : t('Reload now')}
            </button>
            <button type="button" className="update-banner-later" data-testid="update-later" onClick={hideBannerForNow}>
              {t('Later')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
