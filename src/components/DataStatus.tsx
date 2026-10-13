import type { ResState } from '../data/stores';
import { whenShort } from '../util/dates';
import { t } from '../i18n/t';
import { Icon } from '../icons';

const fmt = (iso: string | null): string => whenShort(iso);

/** Loading, error and "saved on this device" notes for a data hook. Renders nothing when all is well. */
export default function DataStatus({ state, onRetry, what }: { state: Pick<ResState<unknown>, 'loading' | 'refreshing' | 'error' | 'fromCache' | 'savedAt' | 'data' | 'accessDenied'>; onRetry: () => void; what: string }) {
  if (state.loading && !state.data) {
    return <div className="callout" role="status" data-testid="loading">{t('Loading {what}…', { what })}</div>;
  }
  if (state.error && !state.data) {
    return (
      <div className="callout callout--danger" role="alert" data-testid="load-error">
        <Icon name="alert" size={16} />
        <span>{state.accessDenied ? t('You do not have access to this.') : state.error}</span>
        {!state.accessDenied && <button type="button" className="btn btn-sm" onClick={onRetry}>{t('Try again')}</button>}
      </div>
    );
  }
  if (state.error && state.data) {
    return (
      <div className="callout callout--warning" role="status" data-testid="stale-note">
        <Icon name="wifiOff" size={16} />
        <span>{state.error}</span>
        <button type="button" className="btn btn-sm" onClick={onRetry}>{t('Try again')}</button>
      </div>
    );
  }
  if (state.fromCache) {
    return (
      <div className="callout" role="status" data-testid="cache-note">
        <Icon name="info" size={16} />
        <span>{t('Showing the copy saved on this device ({time}). Checking for newer data…', { time: fmt(state.savedAt) })}</span>
      </div>
    );
  }
  return null;
}
