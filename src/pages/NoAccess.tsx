import { Link } from 'react-router-dom';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { t } from '../i18n/t';
import { PageHeader } from '../components/Tile';
import '../components/ui.css';

/** A deep link to a page this person may not open. Plain words, one way out. */
export default function NoAccess() {
  const pages = useVisiblePages();
  return (
    <div className="page" data-testid="no-access">
      <PageHeader title={t('You do not have access')} subtitle={t('Your account cannot open this page.')} />
      <div className="card">
        <p>{t('If you need this page, ask an administrator to change your access.')}</p>
        {pages[0] && (
          <p style={{ marginTop: 12 }}>
            <Link className="btn-primary" to={pages[0].path} style={{ textDecoration: 'none' }}>{t('Go to {page}', { page: t(pages[0].label) })}</Link>
          </p>
        )}
      </div>
    </div>
  );
}
