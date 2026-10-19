// An address the app has no page for (an old bookmark, a typo): says so, shows the address tried and leads back
// (phase 5: was a dead end). The shell around it keeps the side bar and the top bar.
import { Link, useLocation } from 'react-router-dom';
import { PageHeader } from '../components/Tile';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { pageLabel } from '../navigation';

export default function NotFound() {
  const location = useLocation();
  const pages = useVisiblePages();
  const first = pages[0];
  const tried = `${location.pathname}${location.search}`;
  return (
    <div className="page" data-testid="not-found">
      <PageHeader title={t('Page not found')} subtitle={t('There is no page at this address. It may be an old bookmark or a typing mistake.')} />
      <section className="card nf-card">
        <p className="nf-code" aria-hidden="true">404</p>
        <p>
          {t('Address tried')}: <code className="nf-path" data-testid="not-found-path">{tried}</code>
        </p>
        <div className="nf-actions">
          {first && (
            <Link className="btn btn-primary" to={first.path} data-testid="not-found-home">
              <Icon name="dashboard" size={16} /> {first.id === 'overview' ? t('Go to the Dashboard') : t('Go to {p}', { p: pageLabel(first) })}
            </Link>
          )}
        </div>
        {pages.length > 1 && (
          <nav aria-label={t('Pages')} className="nf-pages">
            <p className="muted">{t('Or open one of your pages:')}</p>
            <ul>
              {pages.map((p) => <li key={p.id}><Link to={p.path} data-testid="not-found-link">{pageLabel(p)}</Link></li>)}
            </ul>
          </nav>
        )}
      </section>
    </div>
  );
}
