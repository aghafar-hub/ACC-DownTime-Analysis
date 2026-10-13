import { Icon } from '../icons';
import { t } from '../i18n/t';
import { APP_BUILD, APP_BUILD_DATE } from './buildInfo';
import { statusOf, statusText } from './updateLogic';
import { applyUpdate, checkForUpdates, useUpdateState } from './updateService';
import './update.css';

/** Settings > Appearance: which build this is, whether a newer one is waiting, and a button to look. */
export default function AppVersionCard() {
  const state = useUpdateState();
  const status = statusOf(state);
  return (
    <section className="install-card app-version" data-testid="app-version">
      <h3>{t('App version')}</h3>
      <p>
        {t('Build')} <span className="app-version-build" data-testid="app-build">{APP_BUILD}</span>
        {APP_BUILD_DATE ? <> · <span data-testid="app-build-date">{APP_BUILD_DATE}</span></> : null}
      </p>
      <p className={`app-version-status app-version-status--${status}`} role="status" aria-live="polite" data-testid="update-status">
        {t(statusText(status))}
      </p>
      <div className="app-version-actions">
        <button type="button" className="install-btn app-version-btn" data-testid="check-updates" disabled={state.checking} onClick={() => void checkForUpdates('manual')}>
          <Icon name="sync" size={16} /> {state.checking ? t('Checking…') : t('Check for updates')}
        </button>
        {state.ready && (
          <button type="button" className="install-btn app-version-btn" data-testid="settings-reload" onClick={applyUpdate}>
            <Icon name="download" size={16} /> {t('Reload now')}
          </button>
        )}
      </div>
    </section>
  );
}
