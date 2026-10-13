import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n/t';
import './PageFallback.css';

/**
 * Shown while a page's code is downloading: a light outline of a page (header, a row of tiles, two
 * cards) at a fixed height, so the shell around it does not move and the page swaps in place.
 */
export function PageSkeleton() {
  return (
    <div className="page page-skel" data-testid="page-loading" aria-busy="true" role="status" aria-label={t('Loading…')}>
      <div className="page-skel-head">
        <span className="page-skel-bar page-skel-title" />
        <span className="page-skel-bar page-skel-sub" />
      </div>
      <div className="page-skel-tiles">
        <span className="page-skel-block" />
        <span className="page-skel-block" />
        <span className="page-skel-block" />
        <span className="page-skel-block" />
      </div>
      <div className="page-skel-cards">
        <span className="page-skel-block page-skel-card" />
        <span className="page-skel-block page-skel-card" />
      </div>
    </div>
  );
}

// Only a failed download is handled here; any other error goes on up as before.
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|Loading chunk|module script/i;

type BoundaryState = { error: unknown; key: string };

/** A page whose code could not be downloaded (offline before it was ever cached, or a new version replaced it): say so and offer a retry. */
export class PageLoadBoundary extends Component<{ children: ReactNode; resetKey: string }, BoundaryState> {
  state: BoundaryState = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: BoundaryState) {
    // moving to another page clears the error
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (CHUNK_ERROR.test(String(error))) console.warn('page failed to load', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!CHUNK_ERROR.test(String(error))) throw error;
    return (
      <div className="page page-skel-error" data-testid="page-load-error" role="alert">
        <p>{t('This page could not be loaded. Check the connection and try again.')}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>{t('Reload')}</button>
      </div>
    );
  }
}
