import type { EventRow } from '../../api/types';
import { isBlockingFlag } from '../../calc/flags';
import { t } from '../../i18n/t';
import { flagLabel } from './eventLabels';
import { flagList } from '../../util/normalize';

// Status badges: every one carries a symbol and a word, so colour is never the only signal.
// ◆ failure or a problem that leaves the record out of the numbers, ▲ data issue, ↳ continuation, ✎ edited, ⊘ void.
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
        <span key={f} className={isBlockingFlag(f) ? 'badge badge--danger' : 'badge badge--warning'} data-testid="badge-flag"><span aria-hidden="true">{isBlockingFlag(f) ? '◆' : '▲'}</span> {flagLabel(f)}</span>
      ))}
      {flags.length > shown.length && (
        <span className={flags.slice(shown.length).some(isBlockingFlag) ? 'badge badge--danger' : 'badge badge--warning'} data-testid="badge-flag-more"><span aria-hidden="true">{flags.slice(shown.length).some(isBlockingFlag) ? '◆' : '▲'}</span> +{flags.length - shown.length}</span>
      )}
    </>
  );
}
