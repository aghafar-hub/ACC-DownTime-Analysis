import { useMemo, useState } from 'react';
import { api } from '../api';
import type { EventRow, Startup } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { SAVE_BLOCKED_EVENT } from '../components/SaveBlockedToast';
import ShellModal, { FormSection } from '../components/ShellModal';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useOnlineStatus } from '../useOnlineStatus';
import { num, shortTs } from '../util/format';
import { BULK_CAP, capSelection, planBulk, runBulk, type BulkResult } from './model';

export const BULK_NOTE = 'Checked on the Validate page';

/**
 * "Set for N records": one change applied to every ticked record, one after the other. A record the server
 * refuses is listed with the reason; the run always goes on to the next one.
 */
export default function BulkModal({ ids, byId, startup, onClose, onSaved, onFinished }: {
  ids: string[];
  byId: (id: string) => EventRow | undefined;
  startup: Startup | null;
  onClose: () => void;
  /** a record was saved */
  onSaved: (row: EventRow) => void;
  /** the run ended: which records were saved and which were refused */
  onFinished: (result: BulkResult) => void;
}) {
  const { token } = useAuth();
  const online = useOnlineStatus();
  const { ids: run, capped } = useMemo(() => capSelection(ids), [ids]);
  const [fields, setFields] = useState({ classification: '', area_id: '', line_id: '', code_raw: '', reason_raw: '' });
  const [note, setNote] = useState(t(BULK_NOTE));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ at: 0, total: 0 });
  const [result, setResult] = useState<BulkResult | null>(null);
  const set = (k: keyof typeof fields, v: string) => setFields((f) => ({ ...f, [k]: v }));

  const reasons = useMemo(() => {
    const cls = fields.classification;
    return [...new Set((startup?.reasons ?? []).filter((r) => r.active && (!cls || r.classification === cls)).map((r) => r.text_as_listed.trim()))].sort();
  }, [startup, fields.classification]);

  async function apply() {
    const plan = planBulk(fields, note);
    if (!plan.ok) return setError(t(plan.error));
    if (!online) return window.dispatchEvent(new CustomEvent(SAVE_BLOCKED_EVENT, { detail: { message: t('Editing needs a connection.') } }));
    if (!token) return;
    setError(null);
    setBusy(true);
    setProgress({ at: 0, total: run.length });
    const res = await runBulk(
      run,
      async (id) => onSaved(await api.editEvent(token, id, plan.changes, note.trim())),
      (i, total) => setProgress({ at: i + 1, total }),
    );
    setBusy(false);
    setResult(res);
    onFinished(res);
  }

  const label = (id: string): string => {
    const e = byId(id);
    return e ? `${shortTs(e.stop_ts)} · ${e.area_id} · ${e.code_raw || 'N/A'}` : id;
  };
  const guardedClose = () => {
    if (!busy) onClose();
  };

  return (
    <ShellModal
      icon="edit"
      title={t('Set for {n} records', { n: num(run.length) })}
      subtitle={t('The same change is saved on each record, with your note, in its edit history.')}
      onClose={guardedClose}
      width={680}
      testid="bulk-modal"
      footer={
        result ? (
          <button type="button" className="btn-primary" onClick={onClose} data-testid="bulk-close">{t('Close')}</button>
        ) : (
          <>
            <button type="button" className="btn" onClick={guardedClose} disabled={busy}>{t('Cancel')}</button>
            <button type="button" className="btn-primary" onClick={apply} disabled={busy} data-testid="bulk-apply">
              {busy ? t('Saving…') : t('Apply to {n} records', { n: num(run.length) })}
            </button>
          </>
        )
      }
    >
      {capped && (
        <div className="callout callout--warning" role="status" data-testid="bulk-capped">
          <Icon name="info" size={16} />
          <span>{t('Only the first {cap} of {n} ticked records are changed in one run. Run it again for the rest.', { cap: BULK_CAP, n: num(ids.length) })}</span>
        </div>
      )}
      {error && <div className="callout callout--danger" role="alert" data-testid="bulk-error"><Icon name="alert" size={16} /><span>{error}</span></div>}

      {!result && (
        <>
          <FormSection icon="tool" title={t('What to set')} hint={t('Leave a box empty to keep what each record has.')}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="b-class">{t('Classification')}</label>
                <select id="b-class" className="select" value={fields.classification} onChange={(e) => set('classification', e.target.value)} disabled={busy} data-testid="b-class">
                  <option value="">{t('Keep as it is')}</option>
                  {(startup?.classifications ?? []).map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="b-area">{t('Area')}</label>
                <select id="b-area" className="select" value={fields.area_id} onChange={(e) => set('area_id', e.target.value)} disabled={busy} data-testid="b-area">
                  <option value="">{t('Keep as it is')}</option>
                  {(startup?.areas ?? []).map((a) => <option key={a.area_id} value={a.area_id}>{a.area_id} · {a.name}</option>)}
                </select>
                <span className="field-hint">{t('The line follows the area unless you choose a line too.')}</span>
              </div>
              <div className="field">
                <label htmlFor="b-line">{t('Line')}</label>
                <select id="b-line" className="select" value={fields.line_id} onChange={(e) => set('line_id', e.target.value)} disabled={busy} data-testid="b-line">
                  <option value="">{t('Keep as it is')}</option>
                  {(startup?.lines ?? []).map((l) => <option key={l.line_id} value={l.line_id}>{l.line_id} · {l.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="b-code">{t('Equipment code')}</label>
                <input id="b-code" className="input mono" value={fields.code_raw} onChange={(e) => set('code_raw', e.target.value)} placeholder={t('Keep as it is')} autoCapitalize="characters" disabled={busy} data-testid="b-code" />
                <span className="field-hint">
                  {t('Write N/A when the whole area stopped.')}{' '}
                  <button type="button" className="chip" onClick={() => set('code_raw', 'N/A')} disabled={busy} data-testid="b-code-na">N/A</button>
                </span>
              </div>
              <div className="field span-2">
                <label htmlFor="b-reason">{t('Reason')}</label>
                <input id="b-reason" className="input" list="b-reason-list" value={fields.reason_raw} onChange={(e) => set('reason_raw', e.target.value)} placeholder={t('Keep as it is')} disabled={busy} data-testid="b-reason" />
                <datalist id="b-reason-list">{reasons.map((r) => <option key={r} value={r} />)}</datalist>
              </div>
            </div>
          </FormSection>
          <FormSection icon="edit" title={t('Why are you changing these?')} hint={t('Required. It is kept in each edit history.')}>
            <div className="field">
              <label htmlFor="b-note">{t('Note')}</label>
              <textarea id="b-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} data-testid="b-note" />
            </div>
          </FormSection>
          {busy && (
            <div role="status" data-testid="bulk-progress">
              <p style={{ margin: '0 0 6px' }}>{t('Saving {a} of {b}…', { a: num(progress.at), b: num(progress.total) })}</p>
              <div className="v-progress" aria-hidden="true"><span style={{ width: `${progress.total ? Math.round((progress.at / progress.total) * 100) : 0}%` }} /></div>
            </div>
          )}
        </>
      )}

      {result && (
        <>
          <div className={result.failed.length ? 'callout callout--warning' : 'callout callout--success'} role="status" data-testid="bulk-result">
            <Icon name={result.failed.length ? 'alert' : 'check'} size={16} />
            <span>
              <b>{t('Saved {a} of {b} records.', { a: num(result.done.length), b: num(result.done.length + result.failed.length) })}</b>
              {result.failed.length > 0 && <> {t('{n} could not be changed:', { n: num(result.failed.length) })}</>}
            </span>
          </div>
          {result.failed.length > 0 && (
            <ul className="v-refused" data-testid="bulk-refused">
              {result.failed.map((f) => (
                <li key={f.id} data-testid="bulk-refused-item" data-event-id={f.id}>
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
