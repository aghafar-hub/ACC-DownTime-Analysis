import { useMemo, useState } from 'react';
import { api } from '../api';
import type { EventRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { SAVE_BLOCKED_EVENT } from '../components/SaveBlockedToast';
import ShellModal, { FormSection } from '../components/ShellModal';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { flagLabel } from '../pages/events/eventLabels';
import { useOnlineStatus } from '../useOnlineStatus';
import { num, shortTs } from '../util/format';
import {
  BULK_CAP, capSelection, keepChoices, keepConsequenceMany, KEEP_NOTE, KEEP_NOTE_MIN, keepSetFor, plainKeepReason, runBulk, undoSetFor,
  type BulkResult, type ValidationRecord,
} from './model';

export const UNDO_NOTE = 'Needs checking again';

/** What the sheet works on: the record, its open problems and what it already has kept. */
export type KeepTarget = Pick<ValidationRecord, 'event' | 'problems' | 'kept'>;

/**
 * "Keep as entered" (mode keep) and "Undo" (mode undo): a small confirmation sheet. The open problems of the record(s) are ticked
 * boxes (untick any you do not want to keep), a note is required, and a plain sentence says what will happen. For several
 * records the same choice and note go to each one, one after the other; a record the server refuses is listed with the reason
 * and the run goes on. Nothing in a record changes.
 */
export default function KeepModal({ mode, targets: given, onClose, onSaved, onFinished }: {
  mode: 'keep' | 'undo';
  targets: KeepTarget[];
  onClose: () => void;
  /** a record was saved */
  onSaved: (row: EventRow) => void;
  /** the run ended */
  onFinished: (result: BulkResult) => void;
}) {
  const { token } = useAuth();
  const online = useOnlineStatus();
  const undo = mode === 'undo';
  // the records as they were when the sheet opened: saved ones leave the list while the run is going on
  const [targets] = useState(given);
  const { ids: runIds, capped } = useMemo(() => capSelection(targets.map((x) => x.event.event_id)), [targets]);
  const run = useMemo(() => targets.filter((x) => runIds.includes(x.event.event_id)), [targets, runIds]);
  const choices = useMemo(() => keepChoices(run.map((x) => ({ problems: undo ? x.kept : x.problems }))), [run, undo]);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(choices.map((c) => c.flag)));
  const [note, setNote] = useState(t(undo ? UNDO_NOTE : KEEP_NOTE));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ at: 0, total: 0 });
  const [result, setResult] = useState<BulkResult | null>(null);
  const many = run.length > 1;

  const toggle = (flag: string) => setTicked((cur) => {
    const next = new Set(cur);
    if (next.has(flag)) next.delete(flag);
    else next.add(flag);
    return next;
  });
  const sentence = undo
    ? t(many ? 'Nothing in these records changes. They are listed under Open again.' : 'Nothing in the record changes. It is listed under Open again.')
    : t(keepConsequenceMany(run, ticked));

  async function apply() {
    if (ticked.size === 0) return setError(t(undo ? 'Tick at least one problem to stop keeping.' : 'Tick at least one problem to keep.'));
    if (note.trim().length < KEEP_NOTE_MIN) return setError(t('Write a short note saying why (at least {n} characters).', { n: KEEP_NOTE_MIN }));
    if (!online) return window.dispatchEvent(new CustomEvent(SAVE_BLOCKED_EVENT, { detail: { message: t('Editing needs a connection.') } }));
    if (!token) return;
    setError(null);
    setBusy(true);
    setProgress({ at: 0, total: run.length });
    const byId = new Map(run.map((x) => [x.event.event_id, x]));
    const res = await runBulk(
      run.map((x) => x.event.event_id),
      async (id) => {
        const tg = byId.get(id)!;
        const set = undo ? undoSetFor(tg, ticked) : keepSetFor(tg, ticked);
        if (set === null) throw new Error(undo ? 'It has none of the kept problems you ticked.' : 'It has none of the problems you ticked.');
        onSaved(await api.acceptEventFlags(token, id, set, note.trim()));
      },
      (i, total) => setProgress({ at: i + 1, total }),
      plainKeepReason,
    );
    setBusy(false);
    setResult(res);
    onFinished(res);
  }

  const label = (id: string): string => {
    const e = byId0(run, id);
    return e ? `${shortTs(e.stop_ts)} · ${e.area_id} · ${e.code_raw || 'N/A'}` : id;
  };
  const guardedClose = () => {
    if (!busy) onClose();
  };
  const title = undo
    ? (many ? t('Undo for {n} records', { n: num(run.length) }) : t('Undo: keep as entered'))
    : (many ? t('Keep {n} records as entered', { n: num(run.length) }) : t('Keep as entered'));
  const one = run[0]?.event;

  return (
    <ShellModal
      icon={undo ? 'history' : 'check'}
      title={title}
      subtitle={
        many || !one
          ? t('The same choice and note are saved on each record, in its edit history.')
          : <span className="mono">{one.area_id} · {one.code_raw || 'N/A'} · {shortTs(one.stop_ts)}</span>
      }
      onClose={guardedClose}
      width={600}
      testid="keep-modal"
      footer={
        result ? (
          <button type="button" className="btn-primary" onClick={onClose} data-testid="keep-close">{t('Close')}</button>
        ) : (
          <>
            <button type="button" className="btn" onClick={guardedClose} disabled={busy} data-testid="keep-cancel">{t('Cancel')}</button>
            <button type="button" className="btn-primary" onClick={apply} disabled={busy} data-testid="keep-apply">
              <Icon name={undo ? 'history' : 'check'} size={15} />{' '}
              {busy ? t('Saving…') : undo ? t('Undo') : many ? t('Keep {n} records as entered', { n: num(run.length) }) : t('Keep as entered')}
            </button>
          </>
        )
      }
    >
      {capped && (
        <div className="callout callout--warning" role="status" data-testid="keep-capped">
          <Icon name="info" size={16} />
          <span>{t('Only the first {cap} of {n} ticked records are changed in one run. Run it again for the rest.', { cap: BULK_CAP, n: num(targets.length) })}</span>
        </div>
      )}
      {error && <div className="callout callout--danger" role="alert" data-testid="keep-error"><Icon name="alert" size={16} /><span>{error}</span></div>}

      {!result && (
        <>
          <FormSection
            icon="alert"
            title={undo ? t('Stop keeping') : t('Problems to keep')}
            hint={undo ? t('Untick any you want to stay kept.') : t('Untick any you do not want to keep.')}
          >
            <div className="v-keep-flags" role="group" aria-label={undo ? t('Problems to stop keeping') : t('Problems to keep')}>
              {choices.map(({ flag, count, blocking }) => (
                <label key={flag} className="v-keep-flag" data-testid={`keep-flag-${flag}`}>
                  <input type="checkbox" checked={ticked.has(flag)} onChange={() => toggle(flag)} disabled={busy} data-testid="keep-flag-box" data-flag={flag} />
                  <span className={blocking ? 'badge badge--danger' : 'badge badge--warning'}>
                    <span aria-hidden="true">{blocking ? '◆' : '▲'}</span> {flagLabel(flag)}
                  </span>
                  {many && <span className="muted">{t('{n} records', { n: num(count) })}</span>}
                </label>
              ))}
            </div>
            <p className="v-keep-sentence" data-testid="keep-sentence">{sentence}</p>
          </FormSection>
          <FormSection icon="edit" title={t('Why?')} hint={t('Required. It is kept in the edit history.')}>
            <div className="field">
              <label htmlFor="keep-note">{t('Note')}</label>
              <textarea id="keep-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} data-testid="keep-note" />
            </div>
          </FormSection>
          {busy && (
            <div role="status" data-testid="keep-progress">
              <p style={{ margin: '0 0 6px' }}>{t('Saving {a} of {b}…', { a: num(progress.at), b: num(progress.total) })}</p>
              <div className="v-progress" aria-hidden="true"><span style={{ width: `${progress.total ? Math.round((progress.at / progress.total) * 100) : 0}%` }} /></div>
            </div>
          )}
        </>
      )}

      {result && (
        <>
          <div className={result.failed.length ? 'callout callout--warning' : 'callout callout--success'} role="status" data-testid="keep-result">
            <Icon name={result.failed.length ? 'alert' : 'check'} size={16} />
            <span>
              <b>{undo ? t('Undone on {a} of {b} records.', { a: num(result.done.length), b: num(result.done.length + result.failed.length) }) : t('Kept {a} of {b} records as entered.', { a: num(result.done.length), b: num(result.done.length + result.failed.length) })}</b>
              {result.failed.length > 0 && <> {t('{n} could not be changed:', { n: num(result.failed.length) })}</>}
            </span>
          </div>
          {result.failed.length > 0 && (
            <ul className="v-refused" data-testid="keep-refused">
              {result.failed.map((f) => (
                <li key={f.id} data-testid="keep-refused-item" data-event-id={f.id}>
                  <b className="mono">{label(f.id)}</b>
                  <div className="muted">{f.reason}</div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </ShellModal>
  );
}

function byId0(run: KeepTarget[], id: string): EventRow | undefined {
  return run.find((x) => x.event.event_id === id)?.event;
}
