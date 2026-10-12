import { useEffect, useMemo, useState } from 'react';
import { api, describeError } from '../api';
import type { UploadBatch, UploadWarning } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import ShellModal from '../components/ShellModal';
import { t, tn } from '../i18n/t';
import { Icon } from '../icons';
import { downloadText, storedWarningsCsv } from './review';
import { resolutionLabel, warningHelp, warningLabel, warningSymbol, warningTone } from './warningText';
import './upload.css';

/** The warnings recorded with one earlier upload, grouped by type. */
export default function BatchWarnings({ batch, onClose }: { batch: UploadBatch; onClose: () => void }) {
  const { token } = useAuth();
  const [list, setList] = useState<UploadWarning[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    if (!token) return;
    setError(null);
    api.getUploadWarnings(token, batch.batch_id).then(setList, (e) => setError(describeError(e)));
  };
  useEffect(load, [token, batch.batch_id]);
  const groups = useMemo(() => {
    const by = new Map<string, UploadWarning[]>();
    for (const w of list ?? []) by.set(w.type, [...(by.get(w.type) ?? []), w]);
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [list]);
  return (
    <ShellModal
      icon="alert"
      title={t('Warnings for this upload')}
      subtitle={<span>{batch.file_name || '-'} · <span className="mono">{batch.batch_id}</span></span>}
      onClose={onClose}
      width={760}
      testid="batch-warnings"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>{t('Close')}</button>
          <button type="button" className="btn-primary" disabled={!list || list.length === 0} onClick={() => list && downloadText(`warnings-${batch.batch_id}.csv`, storedWarningsCsv(list))} data-testid="batch-download">
            <Icon name="download" size={15} /> {t('Download warnings (CSV)')}
          </button>
        </>
      }
    >
      {error && <div className="callout callout--danger" role="alert"><span>{error}</span><button type="button" className="btn btn-sm" onClick={load}>{t('Try again')}</button></div>}
      {!error && list === null && <p className="adm-note">{t('Loading…')}</p>}
      {list && list.length === 0 && <p className="adm-note" data-testid="batch-no-warnings"><span aria-hidden="true">✓ </span>{t('No warnings were recorded for this upload.')}</p>}
      {groups.map(([type, items]) => (
        <details key={type} className="up-group" open={groups.length === 1} data-testid={`batch-group-${type}`}>
          <summary>
            <span className={`badge badge--${warningTone(type)}`}><span aria-hidden="true">{warningSymbol(type)}</span> {items.length}</span>
            <span className="up-group-title">{warningLabel(type)}</span>
          </summary>
          <p className="adm-note">{warningHelp(type)}</p>
          <ul className="up-list">
            {items.slice().sort((a, b) => (a.source_row ?? 0) - (b.source_row ?? 0)).slice(0, 100).map((w) => (
              <li key={w.warning_id} data-testid="batch-warning">
                <b className="mono">{t('Row {n}', { n: w.source_row ?? '?' })}</b>{' '}
                {w.resolution && <span className="badge">{resolutionLabel(w.resolution)}</span>}{' '}
                <span className="adm-wrap">{w.detail}</span>
              </li>
            ))}
          </ul>
          {items.length > 100 && <p className="adm-muted-sm">{tn(items.length - 100, '{n} more is in the downloadable list.', '{n} more are in the downloadable list.')}</p>}
        </details>
      ))}
    </ShellModal>
  );
}
