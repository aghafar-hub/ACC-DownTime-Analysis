// "Change status" (docs/actions-mockups/mobile-action-status.png): every status with whether this person may choose it.
// Closing and cancelling need a note of at least 3 characters and are only offered to people who can close; a closed or
// cancelled action reopens only to Open. A phone gets a bottom sheet, a desktop a small dialog.
import { useId, useState } from 'react';
import { isTerminalStatus, type Action, type ActionStatus } from '../api/types';
import { BottomSheet } from '../components/PhoneParts';
import ShellModal from '../components/ShellModal';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { dayText } from '../util/dates';
import { useActions } from './ActionsContext';
import { needsNote, noteProblem, statusOptions } from './model';
import { StatusDot } from './parts';

export default function StatusDialog({ action, canClose, initial, since, onClose, onDone }: {
  action: Action; canClose: boolean; initial?: ActionStatus | null; since?: string; onClose: () => void; onDone: (text: string) => void;
}) {
  const acts = useActions();
  const mobile = useIsMobile();
  const uid = useId().replace(/:/g, '');
  const options = statusOptions(action, canClose);
  const next = options.find((o) => o.next)?.status ?? null;
  const [to, setTo] = useState<ActionStatus | null>(initial ?? next ?? options.find((o) => o.allowed)?.status ?? null);
  const [note, setNote] = useState(isTerminalStatus(action.status) ? '' : '');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = to ? noteProblem(to, note) : null;
  const blocked = acts.blockedReason;

  async function go() {
    setShown(true);
    setError(null);
    if (!to || problem) return;
    setBusy(true);
    const terminal = isTerminalStatus(to);
    const res = await acts.update(action.action_id, terminal ? { status: to, closure_note: note.trim() } : { status: to });
    if (res.ok && !terminal && note.trim()) await acts.comment(action.action_id, note.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDone(t('Moved to {s}.', { s: t(to) }));
  }

  const label = !to ? t('Choose a status') : to === 'Cancelled' ? t('Cancel the action') : isTerminalStatus(action.status) && to === 'Open' ? t('Reopen') : t('Move to {s}', { s: t(to) });
  const body = (
    <div className="st-dialog" data-testid="status-dialog">
      <p className="st-now">{t('Now: {s}', { s: t(action.status) })}{since ? ` · ${t('since {d}', { d: dayText(since) })}` : ''}</p>
      <div className="st-list" role="radiogroup" aria-label={t('New status')}>
        {options.map((o) => (
          <label key={o.status} className={`st-opt${to === o.status ? ' st-opt--on' : ''}${!o.allowed ? ' st-opt--off' : ''}${o.status === 'Cancelled' ? ' st-opt--cancel' : ''}`} data-testid={`status-opt-${o.status.replace(/\s+/g, '-')}`} data-allowed={o.allowed}>
            <input type="radio" name={`${uid}-st`} value={o.status} checked={to === o.status} disabled={!o.allowed} onChange={() => setTo(o.status)} />
            <StatusDot status={o.status} />
            <span className="st-name">{o.status === 'Cancelled' ? t('Cancel action') : t(o.status)}</span>
            <span className="st-note">
              {o.next && !o.current ? <b className="st-next">{t('Next')}</b> : null}
              {isTerminalStatus(o.status) && !o.current && <Icon name={o.allowed ? 'shield' : 'ban'} size={13} />}
              {o.note}
            </span>
          </label>
        ))}
      </div>
      <div className={shown && problem ? 'field field--error' : 'field'}>
        <label htmlFor={`${uid}-note`}>{to && needsNote(to) ? (to === 'Closed' ? t('Closing note (required)') : t('Why it is cancelled (required)')) : t('Add a note (optional, saved as a comment)')}</label>
        <textarea id={`${uid}-note`} className="textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} data-testid="status-note" />
        {shown && problem && <span className="field-error" role="alert" data-testid="status-note-error">{problem}</span>}
      </div>
      {!canClose && <p className="field-hint" data-testid="status-closer-note"><Icon name="shield" size={13} /> {t('Only people on the "Who can close actions" list (Settings › Actions & targets) can close, cancel or reopen an action.')}</p>}
      {blocked && <div className="callout callout--warning" role="status"><Icon name="wifiOff" size={16} /><span>{blocked}</span></div>}
      {error && <div className="callout callout--danger" role="alert" data-testid="status-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
    </div>
  );
  const footer = (
    <>
      <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid="status-back">{t('Back')}</button>
      <button type="button" className={to === 'Cancelled' ? 'btn-danger' : 'btn-primary'} onClick={() => void go()} disabled={busy || !to || !!blocked} data-testid="status-apply">
        {busy ? t('Saving…') : label}
      </button>
    </>
  );
  if (mobile) return <BottomSheet title={t('Change status')} onClose={onClose} footer={<div className="st-foot">{footer}</div>} testid="status-sheet">{body}</BottomSheet>;
  return <ShellModal icon="sync" title={t('Change status')} subtitle={`${action.action_id} · ${action.title}`} onClose={onClose} footer={footer} width={560} testid="status-modal">{body}</ShellModal>;
}
