// Plain-English names and explanations for every upload warning type.
import type { WarningResolution, WarningType } from '../api/types';
import { t } from '../i18n/t';

export type Tone = 'warning' | 'info' | 'danger';

interface Text { label: string; help: string; tone: Tone; symbol: string }

const TEXT: Record<WarningType, Text> = {
  late_row: {
    label: 'Late entries',
    help: 'New rows on a date that already has stored rows, or before the latest stored date. Choose Add or Skip for each one.',
    tone: 'warning', symbol: '▲',
  },
  changed_row: {
    label: 'Rows that differ from the stored row',
    help: 'The same stop is already stored, but the file has different values. The stored values are kept. To change a stored event, correct it in Event Explorer.',
    tone: 'warning', symbol: '▲',
  },
  missing_row: {
    label: 'Stored rows missing from the file',
    help: 'These events are stored for dates inside the file but are not in it. Nothing is deleted.',
    tone: 'info', symbol: '●',
  },
  edited_in_app: {
    label: 'Corrected in the app',
    help: 'Someone corrected these events in the app, so they differ from the file. The corrected values are kept.',
    tone: 'info', symbol: '●',
  },
  unknown_code: {
    label: 'Equipment code not in the master list',
    help: 'The row is added and flagged. Add the code (or an alias for a typo) in Master Data.',
    tone: 'warning', symbol: '▲',
  },
  code_not_in_area: {
    label: 'Code not listed under this area',
    help: 'The code exists but is not in this area\'s equipment list. The row is added and flagged.',
    tone: 'warning', symbol: '▲',
  },
  unlisted_reason: {
    label: 'Reason not in the list',
    help: 'The reason text is not listed for this classification. The row is added and flagged.',
    tone: 'warning', symbol: '▲',
  },
  blank_reason: {
    label: 'Reason left blank',
    help: 'No reason is written. The row is added and flagged.',
    tone: 'warning', symbol: '▲',
  },
  end_before_start: {
    label: 'Restart is before the stop',
    help: 'The restart time is earlier than the stop time, so the duration is negative. The row is added and flagged; fix it in Event Explorer.',
    tone: 'warning', symbol: '▲',
  },
  duration_mismatch: {
    label: 'Duration differs from the sheet total',
    help: 'The duration worked out from the two times is not the same as the sheet\'s own total. The row is added and flagged.',
    tone: 'warning', symbol: '▲',
  },
  orphan_continuation: {
    label: 'Continuation with no stop before it',
    help: 'Freq is 0 but no earlier row ends at this stop time. The stop may have started in a month that was not uploaded.',
    tone: 'warning', symbol: '▲',
  },
  overlap_in_area: {
    label: 'Overlaps another stop in the same area',
    help: 'Two stops in one area run at the same time. Both are added and flagged.',
    tone: 'warning', symbol: '▲',
  },
  placeholder_code: {
    label: 'Placeholder equipment code',
    help: 'The code has no dot, so it looks like a placeholder rather than a real equipment code.',
    tone: 'warning', symbol: '▲',
  },
};

export const warningLabel = (type: WarningType | string): string => t(TEXT[type as WarningType]?.label ?? String(type));
export const warningHelp = (type: WarningType | string): string => t(TEXT[type as WarningType]?.help ?? '');
export const warningTone = (type: WarningType | string): Tone => TEXT[type as WarningType]?.tone ?? 'info';
export const warningSymbol = (type: WarningType | string): string => TEXT[type as WarningType]?.symbol ?? '●';

/** Checks that apply to rows that will be added (shown as "data checks"). */
export const CHECK_TYPES: WarningType[] = [
  'unknown_code', 'code_not_in_area', 'unlisted_reason', 'blank_reason', 'end_before_start',
  'duration_mismatch', 'orphan_continuation', 'overlap_in_area', 'placeholder_code',
];

export function resolutionLabel(r: WarningResolution | undefined): string {
  switch (r) {
    case 'added': return t('Added');
    case 'skipped': return t('Skipped');
    case 'kept_stored': return t('Stored value kept');
    case 'accepted': return t('Added and flagged');
    default: return '';
  }
}

const FIELD_LABELS: Record<string, string> = {
  freq: 'Freq', classification: 'Classification', criticality: 'Criticality', is_failure: 'Failure',
  reason_raw: 'Reason', description: 'Description', event_date: 'Date', line_id: 'Line',
};
export const fieldName = (f: string): string => t(FIELD_LABELS[f] ?? f);
