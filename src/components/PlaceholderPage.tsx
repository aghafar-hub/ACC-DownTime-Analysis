import type { ReactNode } from 'react';
import type { TabId } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { pageById, pageLabel } from '../navigation';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { PageHeader } from './Tile';
import './ui.css';

/**
 * Pattern for pages that are not built yet: the real page header with live
 * numbers, a row of tiles proving the data reaches the page, and a plainly
 * labelled "built in the next step" card.
 */
export default function PlaceholderPage({ tab, subtitle, right, tiles, next, children }: {
  tab: TabId;
  subtitle: ReactNode;
  right?: ReactNode;
  tiles: ReactNode;
  next: { title: string; points: string[] };
  children?: ReactNode;
}) {
  const { levelOf } = useAuth();
  const page = pageById(tab);
  const level = levelOf(tab);
  return (
    <div className="page" data-testid={`page-${tab}`}>
      <PageHeader title={pageLabel(page)} subtitle={subtitle} right={right} />
      <p className="status-line" style={{ marginBottom: 12 }} data-testid="access-level">
        {level === 'Edit' ? t('Your access to this page: can edit.') : t('Your access to this page: view only.')}
      </p>
      <div className="tiles">{tiles}</div>
      {children}
      <section className="card card--next" data-testid="next-step">
        <h2><Icon name="tool" size={16} style={{ verticalAlign: '-2px', marginInlineEnd: 6 }} />{next.title}</h2>
        <p><b>{t('Built in the next step.')}</b> {t('This page will show:')}</p>
        <ul>{next.points.map((p) => <li key={p}>{t(p)}</li>)}</ul>
      </section>
    </div>
  );
}
