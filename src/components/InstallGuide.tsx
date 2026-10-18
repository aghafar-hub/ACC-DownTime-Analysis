import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { t } from '../i18n/t';
import { useInstall } from '../installPrompt';
import { store } from '../storagePrefix';
import './InstallGuide.css';

const DISMISS_KEY = 'install_dismissed';

function IosSteps() {
  return (
    <ol className="install-steps">
      <li>{t('Tap Share at the bottom of Safari, then choose Add to Home Screen.')}</li>
      <li>{t('Tap Add.')}</li>
      <li>{t('Open ACC Downtime from its icon. It runs full screen and keeps working offline.')}</li>
    </ol>
  );
}

// Phone only, until dismissed for good (×): one thin line docked on the bottom bar, the full width of the screen.
// While it shows, its height is kept in --install-banner-h so the page and every floating button (the "+ New" of
// Actions, toasts, sticky action bars) sit above it and it never covers anything.
export function InstallBanner() {
  const { installed, canPrompt, ios, install } = useInstall();
  const [dismissed, setDismissed] = useState(() => store.get(DISMISS_KEY) === '1');
  const [showSteps, setShowSteps] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const shown = !(installed || dismissed || (!canPrompt && !ios));
  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!shown || !el) return;
    const set = () => root.style.setProperty('--install-banner-h', `${el.offsetHeight || 0}px`);
    set();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    ro?.observe(el);
    window.addEventListener('resize', set);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', set);
      root.style.removeProperty('--install-banner-h');
    };
  }, [shown, showSteps]);
  if (!shown) return null;
  const dismiss = () => {
    setDismissed(true);
    store.set(DISMISS_KEY, '1');
  };
  return (
    <div ref={ref} className={showSteps ? 'install-banner install-banner--open' : 'install-banner'} role="region" aria-label={t('Install the app')} data-testid="install-banner">
      <div className="install-banner-line">
        <img src={`${import.meta.env.BASE_URL}icons/pwa-192.png`} alt="" width={24} height={24} />
        <span className="install-banner-text" title={t('Opens from your home screen, full screen, and keeps working offline.')}>{t('Install the app')}</span>
        {canPrompt ? (
          <button type="button" className="install-btn" onClick={() => install().then((ok) => ok && dismiss())} data-testid="install-go">{t('Install')}</button>
        ) : (
          !showSteps && <button type="button" className="install-btn" onClick={() => setShowSteps(true)} data-testid="install-go">{t('How')}</button>
        )}
        <button type="button" className="install-x" onClick={dismiss} aria-label={t('Do not show again')} title={t('Do not show again')} data-testid="install-dismiss">
          <Icon name="close" size={18} />
        </button>
      </div>
      {showSteps && <IosSteps />}
    </div>
  );
}

// Always available (Appearance): for anyone who said "Not now".
export function InstallCard() {
  const { installed, canPrompt, ios, install } = useInstall();
  return (
    <section className="install-card" data-testid="install-card">
      <h3>{t('Install on this phone or computer')}</h3>
      {installed ? (
        <p>{t('This device already runs the installed app.')}</p>
      ) : canPrompt ? (
        <>
          <p>{t('Adds ACC Downtime to your home screen or Start menu. It opens full screen and keeps working offline.')}</p>
          <button type="button" className="install-btn" onClick={() => install()}>
            <Icon name="download" size={16} /> {t('Install the app')}
          </button>
        </>
      ) : ios ? (
        <IosSteps />
      ) : (
        <p>{t('In Chrome or Edge, open the browser menu and choose Install ACC Downtime Analysis (or Add to Home screen on Android). On iPhone, open this site in Safari and use Share, then Add to Home Screen.')}</p>
      )}
    </section>
  );
}
