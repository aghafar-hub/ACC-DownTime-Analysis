import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n/t';
import './CrashScreen.css';

type State = { error: unknown };

/**
 * The last safety net around the whole app: an error no page handled shows a plain screen with Reload and a way back to
 * the Dashboard, never a white page. The error text is under "Details" for a support message.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('The app stopped with an error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return (
      <main className="crash" role="alert" data-testid="crash-screen">
        <div className="crash-box">
          <h1 className="crash-title">{t('Something went wrong')}</h1>
          <p className="crash-p">{t('The app stopped because of an unexpected error. Your saved data is safe. Reload the app to continue.')}</p>
          <div className="crash-actions">
            <button type="button" className="crash-btn crash-btn--primary" onClick={() => window.location.reload()} data-testid="crash-reload">{t('Reload')}</button>
            <button type="button" className="crash-btn" onClick={() => { window.location.hash = '#/'; window.location.reload(); }} data-testid="crash-home">{t('Back to the Dashboard')}</button>
          </div>
          <details className="crash-details">
            <summary>{t('Details')}</summary>
            <pre data-testid="crash-error">{text}</pre>
          </details>
        </div>
      </main>
    );
  }
}
