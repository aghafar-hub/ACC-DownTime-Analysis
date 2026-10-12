import type { EventRow } from '../../api/types';
import { t } from '../../i18n/t';
import { flagLabel } from './eventLabels';
import { flagList } from '../../util/normalize';

// Status badges: every one carries a symbol and a word, so colour is never the only signal.
// ◆ failure, ▲ data issue, ↳ continuation, ✎ edited, ⊘ void.
export default function EventBadges({ row, maxFlags = 2 }: { row: EventRow; maxFlags?: number }) {
  const flags = flagList(row);
  const shown = flags.slice(0, maxFlags);
  return (
    <>
      {row.is_void && <span className="badge" data-testid="badge-void"><span aria-hidden="true">⊘</span> {t('Void')}</span>}
      {row.is_failure && !row.is_void && <span className="badge badge--danger"><span aria-hidden="true">◆</span> {t('Failure')}</span>}
      {row.freq === 0 && <span className="badge badge--info"><span aria-hidden="true">↳</span> {t('Continues')}</span>}
      {row.edited && <span className="badge badge--accent" data-testid="badge-edited"><span aria-hidden="true">✎</span> {t('Edited')}</span>}
      {shown.map((f) => (
        <span key={f} className="badge badge--warning" data-testid="badge-flag"><span aria-hidden="true">▲</span> {flagLabel(f)}</span>
      ))}
      {flags.length > shown.length && (
        <span className="badge badge--warning" data-testid="badge-flag-more"><span aria-hidden="true">▲</span> +{flags.length - shown.length}</span>
      )}
    </>
  );
}
