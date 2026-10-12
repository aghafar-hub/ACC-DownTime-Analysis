import { t, tn } from '../i18n/t';
import { num } from '../util/format';
import { useValidationOptional } from './ValidationContext';
import './validate.css';

/** Count of records needing checking beside the Validate entry. Danger colour when any is left out of the numbers. */
export default function ValidateBadge({ testid = 'validate-badge' }: { testid?: string }) {
  const v = useValidationOptional();
  if (!v || !v.ready) return null;
  const { total, blocked } = v.list.summary;
  if (total === 0) return null;
  const blocking = blocked.count > 0;
  const label = blocking
    ? t('{n} need checking, {b} left out of the numbers', { n: num(total), b: num(blocked.count) })
    : tn(total, '{n} record to review', '{n} records to review');
  return (
    <span className={blocking ? 'vbadge vbadge--danger' : 'vbadge vbadge--warning'} role="img" aria-label={label} title={label} data-testid={testid}>
      <span className="vbadge-sym" aria-hidden="true">{blocking ? '◆' : '▲'}</span>
      <span>{total > 999 ? '999+' : num(total)}</span>
    </span>
  );
}
