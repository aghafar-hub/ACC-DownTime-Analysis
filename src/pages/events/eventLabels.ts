import { FLAG_INFO } from '../../calc/flags';
import { t } from '../../i18n/t';

export const FLAG_LABELS: Record<string, { label: string; help: string }> = {
  unknown_code: { label: 'Unknown code', help: 'The equipment code is not in the equipment list and no alias matches it.' },
  code_not_in_area: { label: 'Cause in another area', help: 'The equipment code is listed under other areas, not under the area that stopped. Normal; nothing to fix.' },
  unlisted_reason: { label: 'Reason not listed', help: 'The reason text does not match any listed reason for this classification.' },
  blank_reason: { label: 'No reason', help: 'The reason is blank.' },
  end_before_start: { label: 'Restart before stop', help: 'The restart time is earlier than the stop time, so the duration is negative.' },
  duration_mismatch: { label: 'Duration differs', help: 'The duration differs from the total in the source sheet.' },
  orphan_continuation: { label: 'No starting row', help: 'This row continues a stop, but no starting row was found before it.' },
  overlap_in_area: { label: 'Overlaps another stop', help: 'This stop overlaps another stop in the same area.' },
  placeholder_code: { label: 'Placeholder code', help: 'The equipment code is a placeholder, not a real piece of equipment.' },
};

// every flag of the catalogue (calc/flags.ts) gets its label; the older names above stay for records stored before the catalogue
for (const info of Object.values(FLAG_INFO)) FLAG_LABELS[info.flag] = { label: info.label, help: `${info.problem} ${info.fix}` };

export const flagLabel = (f: string): string => t(FLAG_LABELS[f]?.label ?? f.replace(/_/g, ' '));
export const flagHelp = (f: string): string => t(FLAG_LABELS[f]?.help ?? '');

export const FIELD_LABELS: Record<string, string> = {
  event_date: 'Date',
  line_id: 'Line',
  area_id: 'Area',
  code_raw: 'Equipment code',
  stop_ts: 'Stopped at',
  start_ts: 'Restarted at',
  freq: 'New stop or continuation',
  classification: 'Classification',
  criticality: 'Criticality',
  is_failure: 'Failure',
  reason_raw: 'Reason',
  description: 'Description',
  is_void: 'Voided',
  accepted_flags: 'Kept as entered',
};
export const fieldLabel = (f: string): string => t(FIELD_LABELS[f] ?? f);

/** Plain-English form of a stored history value. */
export function historyValue(field: string, v: string | undefined): string {
  if (v === undefined || v === '') return field === 'accepted_flags' ? t('(none)') : t('(empty)');
  if (field === 'freq') return v === '1' ? t('New stop') : t('Continues the stop above');
  if (field === 'is_failure') return v === 'TRUE' ? t('Yes') : t('No');
  if (field === 'is_void') return v === 'TRUE' ? t('Voided') : t('Not voided');
  if (field === 'accepted_flags') return v.split(',').map((f) => flagLabel(f.trim())).join(', ');
  return v;
}
