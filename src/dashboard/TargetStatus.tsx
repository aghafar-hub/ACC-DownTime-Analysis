// Target status for the dashboards: always a symbol, words and the signed gap, never colour alone.
import { t } from '../i18n/t';
import { gapText, stateWords, statusLine, targetWithUnit, type TargetStatus } from './targets';

/** ✔ on target, ▼ below the target, ▲ above the target. */
export const statusSymbol = (s: Pick<TargetStatus, 'state'>): string => (s.state === 'on' ? '✔' : s.state === 'below' ? '▼' : '▲');

/** Under a KPI value: "✔ Target 95%: on target (+1.2 pts)". */
export function TargetLine({ status, testid }: { status: TargetStatus | null; testid?: string }) {
  if (!status) return null;
  return (
    <span className={`target-line target-line--${status.ok ? 'ok' : 'bad'}`} data-testid={testid} data-state={status.state}>
      <span className="target-sym" aria-hidden="true">{statusSymbol(status)}</span> {statusLine(status)}
    </span>
  );
}

/** In a table cell: "✔ On target" with the target and the gap as the tooltip and as hidden text for screen readers. */
export function TargetCell({ status, testid }: { status: TargetStatus | null | undefined; testid?: string }) {
  if (!status) return <span className="muted" data-testid={testid}>–</span>;
  return (
    <span className={`target-cell target-cell--${status.ok ? 'ok' : 'bad'}`} data-testid={testid} data-state={status.state} title={`${t('Target')} ${targetWithUnit(status)} (${gapText(status)})`}>
      <span className="target-sym" aria-hidden="true">{statusSymbol(status)}</span> {stateWords(status)}
      <span className="sr-only"> ({t('target')} {targetWithUnit(status)}, {gapText(status)})</span>
    </span>
  );
}
