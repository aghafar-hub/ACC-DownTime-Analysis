import { useAuth } from '../auth/AuthContext';
import { dateText } from '../util/dates';
import { PageHeader, Tile } from '../components/Tile';
import AccessBadge from '../components/AccessBadge';
import { t } from '../i18n/t';
import { pageById, pageLabel } from '../navigation';
import { useTheme } from '../theme/ThemeContext';
import { num, whenText } from '../util/format';
import UploadFlow from '../upload/UploadFlow';
import UploadHistory from '../upload/UploadHistory';
import { useUploadHistory } from '../upload/useUploadHistory';
import '../components/ui.css';
import '../admin/admin.css';

export default function Upload() {
  const { canEdit } = useAuth();
  const { T } = useTheme();
  const { batches, error, reload } = useUploadHistory();
  const last = batches?.[0];
  const edit = canEdit('upload');
  return (
    <div className="page" data-testid="page-upload">
      <PageHeader
        title={pageLabel(pageById('upload'))}
        right={<AccessBadge edit={edit} />}
        subtitle={batches ? (last ? t('{n} uploads · last on {date} ({file})', { n: batches.length, date: whenText(last.uploaded_at.replace(' ', 'T')), file: last.file_name || '-' }) : t('No uploads yet')) : error ?? t('Loading…')}
      />
      <div className="tiles">
        <Tile icon="upload" label={t('Uploads on record')} value={batches ? num(batches.length) : '-'} testid="fact-batches" />
        <Tile icon="calendar" label={t('Last upload')} value={last ? dateText(last.uploaded_at) : '-'} sub={last?.file_name} testid="fact-last-upload" />
        <Tile icon="check" label={t('Rows added by the last upload')} value={last ? num(last.rows_added) : '-'} sub={last ? t('{n} already stored', { n: num(last.rows_identical) }) : undefined} testid="fact-last-added" />
        <Tile icon="alert" label={t('Warnings on the last upload')} value={last ? num(last.warning_count) : '-'} tone={last && last.warning_count > 0 ? T.warning : undefined} sub={t('stored and flagged, never dropped')} testid="fact-last-warnings" />
      </div>
      {edit ? (
        <UploadFlow onDone={reload} />
      ) : (
        <div className="callout" role="status" data-testid="view-only-note">
          <span>{t('You can see the upload history. Adding a workbook needs Edit access to this page.')}</span>
        </div>
      )}
      <UploadHistory batches={batches} error={error} onRetry={reload} />
    </div>
  );
}
