import { useState } from 'react';
import { tsText } from '../util/dates';
import type { UploadBatch } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { num } from '../util/format';
import BatchWarnings from './BatchWarnings';
import './upload.css';

function StatusBadge({ s }: { s: UploadBatch['status'] }) {
  if (s === 'Completed') return <span className="badge badge--success"><span aria-hidden="true">●</span> {t('Completed')}</span>;
  if (s === 'Failed') return <span className="badge badge--danger"><span aria-hidden="true">◆</span> {t('Failed')}</span>;
  return <span className="badge badge--warning"><span aria-hidden="true">▲</span> {t('Not finished')}</span>;
}

const when = (ts: string): string => tsText(ts);

/** Earlier uploads. Opening one shows the warnings recorded with it. */
export default function UploadHistory({ batches, error, onRetry }: { batches: UploadBatch[] | null; error: string | null; onRetry: () => void }) {
  const mobile = useIsMobile();
  const { user } = useAuth();
  const [open, setOpen] = useState<UploadBatch | null>(null);
  const who = (id: string): string => (id === user?.user_id ? t('You') : id);
  return (
    <section className="card" aria-label={t('Upload history')} data-testid="upload-history">
      <h2>{t('Upload history')}</h2>
      {error && <div className="callout callout--danger" role="alert"><span>{error}</span><button type="button" className="btn btn-sm" onClick={onRetry}>{t('Try again')}</button></div>}
      {!error && batches === null && <p className="adm-note">{t('Loading…')}</p>}
      {batches && batches.length === 0 && <p className="adm-note" data-testid="history-empty">{t('No uploads yet.')}</p>}
      {batches && batches.length > 0 && !mobile && (
        <div className="table-wrap">
          <table className="data-table" data-testid="history-table">
            <thead>
              <tr>
                <th scope="col">{t('Uploaded')}</th><th scope="col">{t('By')}</th><th scope="col">{t('File')}</th>
                <th scope="col" className="num">{t('Rows read')}</th><th scope="col" className="num">{t('Added')}</th>
                <th scope="col" className="num">{t('Already stored')}</th><th scope="col" className="num">{t('Skipped')}</th>
                <th scope="col">{t('Warnings')}</th><th scope="col">{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.batch_id} data-testid="history-row" data-batch={b.batch_id}>
                  <td className="nowrap mono">{when(b.uploaded_at)}</td>
                  <td className="nowrap">{who(b.uploaded_by)}</td>
                  <td className="adm-wrap">{b.file_name || '-'}<div className="up-id">{b.batch_id}</div></td>
                  <td className="num">{num(b.rows_read)}</td>
                  <td className="num">{num(b.rows_added)}</td>
                  <td className="num">{num(b.rows_identical)}</td>
                  <td className="num">{num(b.rows_skipped)}</td>
                  <td>
                    <button type="button" className="up-history-link" onClick={() => setOpen(b)} data-testid="history-warnings">
                      {b.warning_count > 0 ? <><span aria-hidden="true">▲ </span>{t('{n} warnings', { n: b.warning_count })}</> : t('View')}
                    </button>
                  </td>
                  <td><StatusBadge s={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {batches && batches.length > 0 && mobile && (
        <div className="adm-cards" data-testid="history-cards">
          {batches.map((b) => (
            <button key={b.batch_id} type="button" className="adm-card" onClick={() => setOpen(b)} data-testid="history-card" data-batch={b.batch_id} aria-label={t('Upload {file} of {when}: open warnings', { file: b.file_name || b.batch_id, when: when(b.uploaded_at) })}>
              <div className="adm-card-top"><span className="adm-card-title">{b.file_name || b.batch_id}</span><StatusBadge s={b.status} /></div>
              <div className="adm-card-line mono">{when(b.uploaded_at)} · {who(b.uploaded_by)}</div>
              <div className="adm-card-line">{t('{read} read · {added} added · {same} already stored · {skipped} skipped', { read: num(b.rows_read), added: num(b.rows_added), same: num(b.rows_identical), skipped: num(b.rows_skipped) })}</div>
              <div className="adm-card-badges">
                {b.warning_count > 0 ? <span className="badge badge--warning"><span aria-hidden="true">▲</span> {t('{n} warnings', { n: b.warning_count })}</span> : <span className="badge badge--success"><span aria-hidden="true">●</span> {t('No warnings')}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
      {open && <BatchWarnings batch={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
