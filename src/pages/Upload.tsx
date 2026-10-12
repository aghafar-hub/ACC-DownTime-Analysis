import { useCallback, useEffect, useState } from 'react';
import { api, describeError } from '../api';
import type { UploadBatch } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import PlaceholderPage from '../components/PlaceholderPage';
import { Tile } from '../components/Tile';
import { t } from '../i18n/t';
import { useTheme } from '../theme/ThemeContext';
import { num, whenText } from '../util/format';

export default function Upload() {
  const { token, canEdit } = useAuth();
  const { T } = useTheme();
  const [batches, setBatches] = useState<UploadBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!token) return;
    setError(null);
    api.getUploadHistory(token).then(setBatches, (e) => setError(describeError(e)));
  }, [token]);
  useEffect(load, [load]);
  const last = batches?.[0];
  return (
    <PlaceholderPage
      tab="upload"
      subtitle={batches ? (last ? t('{n} uploads · last on {date} ({file})', { n: batches.length, date: whenText(last.uploaded_at), file: last.file_name || '-' }) : t('No uploads yet')) : error ?? t('Loading…')}
      tiles={
        <>
          <Tile icon="upload" label={t('Uploads on record')} value={batches ? num(batches.length) : '-'} testid="fact-batches" />
          <Tile icon="calendar" label={t('Last upload')} value={last ? last.uploaded_at.slice(0, 10) : '-'} sub={last?.file_name} testid="fact-last-upload" />
          <Tile icon="check" label={t('Rows added by the last upload')} value={last ? num(last.rows_added) : '-'} sub={last ? t('{n} already stored', { n: num(last.rows_identical) }) : undefined} testid="fact-last-added" />
          <Tile icon="alert" label={t('Warnings on the last upload')} value={last ? num(last.warning_count) : '-'} tone={last && last.warning_count > 0 ? T.warning : undefined} sub={t('stored and flagged, never dropped')} testid="fact-last-warnings" />
        </>
      }
      next={{
        title: t('Add the monthly workbook'),
        points: [
          canEdit('upload') ? 'You will be able to choose the workbook here, review warnings row by row, and confirm' : 'You can see the upload history; adding a workbook needs Edit access',
          'New rows are added, identical rows are skipped, and anything that differs is shown with its sheet row number',
          'A downloadable warning list to fix the workbook itself',
        ],
      }}
    >
      {error && <div className="callout callout--danger" role="alert"><span>{error}</span><button type="button" className="btn btn-sm" onClick={load}>{t('Try again')}</button></div>}
    </PlaceholderPage>
  );
}
