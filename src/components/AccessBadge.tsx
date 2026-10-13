import { t } from '../i18n/t';

/**
 * A small 'View only' badge for a person who may read a page but not change it (the controls are greyed or missing,
 * and the badge says why). Edit access needs no note, so nothing is drawn then.
 */
export default function AccessBadge({ edit }: { edit: boolean }) {
  if (edit) return null;
  return (
    <span className="badge" data-testid="access-level" title={t('You can read this page; changing it needs Edit access.')}>
      {t('View only')}
    </span>
  );
}
