import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, describeError } from '../../api';
import type { ClassificationCode, EventChanges, EventEdit, EventRow, Startup } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import ShellModal, { FormSection } from '../../components/ShellModal';
import { SAVE_BLOCKED_EVENT } from '../../components/SaveBlockedToast';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { useOnlineStatus } from '../../useOnlineStatus';
import { duration } from '../../util/format';
import { flagList, isValidDate, parseTs } from '../../util/normalize';
import EventBadges from './EventBadges';
import { fieldLabel, flagHelp, flagLabel, historyValue } from './eventLabels';

type Mode = 'view' | 'edit' | 'void';

// ---- form helpers
const toInput = (ts: string): string => String(ts).slice(0, 19).replace(' ', 'T');
/** 'YYYY-MM-DD HH:MM:SS' from a stored time or a datetime-local value (which drops zero seconds). */
const secs = (ts: string): string => {
  const s = String(ts).replace('T', ' ').slice(0, 19);
  return s.length === 16 ? `${s}:00` : s;
};
const fromInput = (v: string): string => secs(v);

interface Form {
  event_date: string; line_id: string; area_id: string; code_raw: string; stop_ts: string; start_ts: string;
  freq: 0 | 1; classification: ClassificationCode; criticality: 'INC' | 'NO_INC'; is_failure: boolean;
  reason_raw: string; description: string; note: string;
}
const initialForm = (r: EventRow): Form => ({
  event_date: r.event_date, line_id: r.line_id, area_id: r.area_id, code_raw: r.code_raw, stop_ts: toInput(r.stop_ts), start_ts: toInput(r.start_ts),
  freq: r.freq, classification: r.classification, criticality: r.criticality, is_failure: r.is_failure,
  reason_raw: r.reason_raw ?? '', description: r.description ?? '', note: '',
});

/** Plain-English problems, and the changes to send (only what differs from the stored row). */
function validate(f: Form, r: EventRow): { errors: Record<string, string>; changes: EventChanges } {
  const errors: Record<string, string> = {};
  if (!isValidDate(f.event_date)) errors.event_date = t('Enter the date as year-month-day, for example 2026-03-15.');
  if (!f.code_raw.trim()) errors.code_raw = t('Enter the equipment code, or N/A when the whole area stopped.');
  if (!f.stop_ts || parseTs(fromInput(f.stop_ts)) === null) errors.stop_ts = t('Enter the date and time the area stopped.');
  if (!f.start_ts || parseTs(fromInput(f.start_ts)) === null) errors.start_ts = t('Enter the date and time the area restarted.');
  const changes: Record<string, unknown> = {};
  const set = (k: keyof EventChanges, v: unknown) => { changes[k] = v; };
  if (f.event_date !== r.event_date) set('event_date', f.event_date);
  if (f.area_id !== r.area_id) set('area_id', f.area_id);
  if (f.line_id !== r.line_id) set('line_id', f.line_id);
  if (f.code_raw.trim() !== r.code_raw) set('code_raw', f.code_raw.trim());
  if (secs(f.stop_ts) !== secs(r.stop_ts)) set('stop_ts', fromInput(f.stop_ts));
  if (secs(f.start_ts) !== secs(r.start_ts)) set('start_ts', fromInput(f.start_ts));
  if (f.freq !== r.freq) set('freq', f.freq);
  if (f.classification !== r.classification) set('classification', f.classification);
  if (f.criticality !== r.criticality) set('criticality', f.criticality);
  if (f.is_failure !== r.is_failure) set('is_failure', f.is_failure);
  if (f.reason_raw.trim() !== (r.reason_raw ?? '')) set('reason_raw', f.reason_raw.trim());
  if (f.description.trim() !== (r.description ?? '')) set('description', f.description.trim());
  if (!f.note.trim()) errors.note = t('Write a short note saying why you are changing this event.');
  if (Object.keys(errors).length === 0 && Object.keys(changes).length === 0) errors.form = t('Nothing has been changed yet.');
  return { errors, changes: changes as EventChanges };
}

function reasonText(startup: Startup | null, r: EventRow): string {
  const hit = startup?.reasons.find((x) => x.reason_id === r.reason_id);
  return hit ? hit.text_as_listed.trim() : '';
}

function resultSummary(startup: Startup | null, u: EventRow): string[] {
  const flags = flagList(u);
  return [
    t('Duration: {d}', { d: duration(u.duration_s) }),
    u.is_area_level ? t('Equipment: the whole area (N/A)') : u.equipment_id ? t('Equipment: {id}', { id: u.equipment_id }) : t('Equipment: not in the equipment list'),
    reasonText(startup, u) ? t('Reason: {r}', { r: reasonText(startup, u) }) : u.reason_raw ? t('Reason: not in the reason list') : t('Reason: none given'),
    t('Criticality: {c}, failure: {f}', { c: u.criticality, f: u.is_failure ? t('yes') : t('no') }),
    flags.length ? t('Data checks: {list}', { list: flags.map(flagLabel).join(', ') }) : t('Data checks: no issues'),
  ];
}

export default function EventDetail({ row, startup, canEdit, onClose, onChanged }: {
  row: EventRow; startup: Startup | null; canEdit: boolean; onClose: () => void; onChanged: (row: EventRow) => void;
}) {
  const { token, user } = useAuth();
  const online = useOnlineStatus();
  const [mode, setMode] = useState<Mode>('view');
  const [history, setHistory] = useState<EventEdit[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(() => initialForm(row));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ title: string; lines: string[] } | null>(null);

  const loadHistory = useCallback(() => {
    if (!token) return;
    setHistoryError(null);
    api.getEventEdits(token, row.event_id).then(setHistory, (e) => setHistoryError(describeError(e)));
  }, [token, row.event_id]);
  useEffect(loadHistory, [loadHistory]);

  const areaName = (id: string) => startup?.areas.find((a) => a.area_id === id)?.name ?? id;
  const className = (c: string) => startup?.classifications.find((x) => x.code === c)?.name ?? c;
  const equipment = startup?.equipment.find((e) => e.equipment_id === row.equipment_id);
  const equipmentAreas = useMemo(
    () => (row.equipment_id ? (startup?.equipment_areas.filter((e) => e.equipment_id === row.equipment_id).map((e) => e.area_id) ?? []) : []),
    [startup, row.equipment_id],
  );
  const listedReasons = useMemo(
    () => (startup?.reasons.filter((r) => r.classification === form.classification && r.active).map((r) => r.text_as_listed.trim()) ?? []),
    [startup, form.classification],
  );
  const flags = flagList(row);
  const blockedOffline = !online;

  function startEdit() {
    if (blockedOffline) return window.dispatchEvent(new CustomEvent(SAVE_BLOCKED_EVENT, { detail: { message: t('Editing needs a connection.') } }));
    setForm(initialForm(row));
    setErrors({});
    setServerError(null);
    setResult(null);
    setMode('edit');
  }
  function startVoid() {
    if (blockedOffline) return window.dispatchEvent(new CustomEvent(SAVE_BLOCKED_EVENT, { detail: { message: t('Editing needs a connection.') } }));
    setForm((f) => ({ ...f, note: '' }));
    setErrors({});
    setServerError(null);
    setResult(null);
    setMode('void');
  }

  async function saveEdit() {
    const { errors: errs, changes } = validate(form, row);
    setErrors(errs);
    setServerError(null);
    if (Object.keys(errs).length || !token) return;
    setSaving(true);
    try {
      const updated = await api.editEvent(token, row.event_id, changes, form.note.trim());
      onChanged(updated);
      setResult({ title: t('Saved. The values below were recalculated.'), lines: resultSummary(startup, updated) });
      setMode('view');
      loadHistory();
    } catch (err) {
      setServerError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveVoid() {
    if (!form.note.trim()) return setErrors({ note: t('Write a short note saying why.') });
    setErrors({});
    setServerError(null);
    if (!token) return;
    setSaving(true);
    try {
      const updated = await api.voidEvent(token, row.event_id, !row.is_void, form.note.trim());
      onChanged(updated);
      setResult({ title: updated.is_void ? t('This event is now voided. Charts and totals leave it out.') : t('This event is restored and counts again.'), lines: [] });
      setMode('view');
      loadHistory();
    } catch (err) {
      setServerError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  const upd = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const err = (k: string) => errors[k] && <span className="field-error" role="alert" data-testid={`error-${k}`}>{errors[k]}</span>;
  const startBeforeStop = parseTs(fromInput(form.start_ts)) !== null && parseTs(fromInput(form.stop_ts)) !== null && parseTs(fromInput(form.start_ts))! < parseTs(fromInput(form.stop_ts))!;

  const footer =
    mode === 'view' ? (
      <>
        <button type="button" className="btn" onClick={onClose}>{t('Close')}</button>
        {canEdit && (
          <>
            {row.is_void ? (
              <button type="button" className="btn-primary" onClick={startVoid} data-testid="restore-event">
                <Icon name="history" size={15} /> {t('Restore')}
              </button>
            ) : (
              <>
                <button type="button" className="btn-danger" onClick={startVoid} data-testid="void-event">
                  <Icon name="ban" size={15} /> {t('Void')}
                </button>
                <button type="button" className="btn-primary" onClick={startEdit} data-testid="edit-event">
                  <Icon name="edit" size={15} /> {t('Edit')}
                </button>
              </>
            )}
          </>
        )}
      </>
    ) : mode === 'edit' ? (
      <>
        <button type="button" className="btn" onClick={() => setMode('view')} disabled={saving}>{t('Cancel')}</button>
        <button type="button" className="btn-primary" onClick={saveEdit} disabled={saving} data-testid="save-edit">{saving ? t('Saving…') : t('Save changes')}</button>
      </>
    ) : (
      <>
        <button type="button" className="btn" onClick={() => setMode('view')} disabled={saving}>{t('Cancel')}</button>
        <button type="button" className={row.is_void ? 'btn-primary' : 'btn-danger'} onClick={saveVoid} disabled={saving} data-testid="confirm-void">
          {saving ? t('Saving…') : row.is_void ? t('Restore this event') : t('Void this event')}
        </button>
      </>
    );

  return (
    <ShellModal
      icon="list"
      title={`${row.area_id} · ${row.code_raw || 'N/A'}`}
      subtitle={<span><span className="mono">{row.event_id}</span> · {row.event_date}</span>}
      badge={<span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}><EventBadges row={row} maxFlags={0} /></span>}
      onClose={onClose}
      footer={footer}
      width={820}
      testid="event-detail"
    >
      {result && (
        <div className="callout callout--success" role="status" data-testid="edit-result">
          <Icon name="check" size={16} />
          <span>
            <b>{result.title}</b>
            {result.lines.length > 0 && <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>{result.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
          </span>
        </div>
      )}
      {!online && canEdit && <div className="callout callout--warning" role="status"><Icon name="wifiOff" size={16} /><span>{t('You are offline. You can read this event; editing needs a connection.')}</span></div>}

      {mode === 'view' && (
        <>
          <FormSection icon="clock" title={t('When')}>
            <dl className="kv">
              <dt>{t('Date')}</dt><dd className="mono">{row.event_date}</dd>
              <dt>{t('Stopped at')}</dt><dd className="mono">{row.stop_ts}</dd>
              <dt>{t('Restarted at')}</dt><dd className="mono">{row.start_ts}</dd>
              <dt>{t('Duration')}</dt><dd className="mono" data-testid="detail-duration">{duration(row.duration_s)} <span className="muted">({row.duration_s} s)</span></dd>
              <dt>{t('New stop or continuation')}</dt><dd>{row.freq === 1 ? t('New stop') : t('Continues the stop above')}</dd>
            </dl>
          </FormSection>

          <FormSection icon="tool" title={t('What stopped')}>
            <dl className="kv">
              <dt>{t('Area')}</dt><dd>{row.area_id} · {areaName(row.area_id)} <span className="muted">({row.line_id})</span></dd>
              <dt>{t('Equipment code')}</dt>
              <dd>
                <span className="mono">{row.code_raw || '-'}</span>
                {row.is_area_level && <span className="muted"> · {t('the whole area stopped')}</span>}
                {row.equipment_id && row.equipment_id !== row.code_raw && <span className="muted"> → <span className="mono">{row.equipment_id}</span></span>}
              </dd>
              {equipment && (<><dt>{t('Equipment')}</dt><dd>{equipment.description || t('(no description yet)')}{equipmentAreas.length > 0 && <span className="muted"> · {t('listed under {areas}', { areas: equipmentAreas.join(', ') })}</span>}</dd></>)}
              <dt>{t('Classification')}</dt><dd><span className="badge badge--class">{row.classification}</span> {className(row.classification)}</dd>
              <dt>{t('Criticality')}</dt><dd>{row.criticality === 'INC' ? t('INC (incident)') : t('NO_INC')}</dd>
              <dt>{t('Failure')}</dt><dd>{row.is_failure ? t('Yes') : t('No')}</dd>
              <dt>{t('Reason as written')}</dt><dd>{row.reason_raw ? `"${row.reason_raw}"` : t('(blank)')}</dd>
              <dt>{t('Reason in the list')}</dt><dd>{reasonText(startup, row) ? <>{reasonText(startup, row)} <span className="muted mono">{row.reason_id}</span></> : t('not matched')}</dd>
              <dt>{t('Description')}</dt><dd>{row.description || t('(none)')}</dd>
            </dl>
          </FormSection>

          <FormSection icon="alert" title={t('Data checks')}>
            {flags.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>{t('No data issues found.')}</p>
            ) : (
              <ul className="history" data-testid="detail-flags">
                {flags.map((f) => (
                  <li key={f}><span className="badge badge--warning"><span aria-hidden="true">▲</span> {flagLabel(f)}</span> <span>{flagHelp(f)}</span></li>
                ))}
              </ul>
            )}
          </FormSection>

          <FormSection icon="history" title={t('Edit history')} hint={t('Original values are kept')}>
            {historyError && <div className="callout callout--danger" role="alert"><span>{historyError}</span><button type="button" className="btn btn-sm" onClick={loadHistory}>{t('Try again')}</button></div>}
            {!historyError && history === null && <p className="muted" style={{ margin: 0 }}>{t('Loading…')}</p>}
            {history && history.length === 0 && <p className="muted" style={{ margin: 0 }} data-testid="no-history">{t('This event has not been edited.')}</p>}
            {history && history.length > 0 && (
              <ul className="history" data-testid="history-list">
                {history.map((h) => (
                  <li key={h.edit_id} data-testid="history-item">
                    <div className="history-when">{h.edited_at.slice(0, 16)} · {h.edited_by === user?.user_id ? t('You') : h.edited_by}</div>
                    <div><b>{fieldLabel(h.field)}:</b> {historyValue(h.field, h.old_value)} → {historyValue(h.field, h.new_value)}</div>
                    {h.note && <div className="muted">{t('Note: {note}', { note: h.note })}</div>}
                  </li>
                ))}
              </ul>
            )}
          </FormSection>

          <FormSection icon="database" title={t('Source')}>
            <dl className="kv">
              <dt>{t('File')}</dt><dd>{row.source_file || '-'}{row.source_row ? <span className="muted"> · {t('row {n}', { n: row.source_row })}</span> : null}</dd>
              <dt>{t('Upload')}</dt><dd className="mono">{row.batch_id}</dd>
              <dt>{t('Fingerprint')}</dt><dd className="mono">{row.fingerprint.slice(0, 24)}…</dd>
              <dt>{t('Added to the app')}</dt><dd className="mono">{row.created_at}</dd>
            </dl>
          </FormSection>
        </>
      )}

      {mode === 'edit' && startup && (
        <>
          {serverError && <div className="callout callout--danger" role="alert" data-testid="server-error"><Icon name="alert" size={16} /><span>{serverError}</span></div>}
          {errors.form && <div className="callout callout--warning" role="alert" data-testid="error-form"><Icon name="info" size={16} /><span>{errors.form}</span></div>}
          <FormSection icon="clock" title={t('When')}>
            <div className="form-grid">
              <div className={errors.event_date ? 'field field--error' : 'field'}>
                <label htmlFor="f-date">{t('Date')}</label>
                <input id="f-date" className="input mono" type="date" value={form.event_date} onChange={(e) => upd('event_date', e.target.value)} data-testid="f-date" />
                {err('event_date')}
              </div>
              <div className="field">
                <label htmlFor="f-freq-1">{t('New stop or continuation')}</label>
                <div className="chip-row" role="group" aria-label={t('New stop or continuation')}>
                  <button id="f-freq-1" type="button" className={form.freq === 1 ? 'chip chip--on' : 'chip'} aria-pressed={form.freq === 1} onClick={() => upd('freq', 1)}>{t('New stop')}</button>
                  <button type="button" className={form.freq === 0 ? 'chip chip--on' : 'chip'} aria-pressed={form.freq === 0} onClick={() => upd('freq', 0)}>{t('Continues the stop above')}</button>
                </div>
              </div>
              <div className={errors.stop_ts ? 'field field--error' : 'field'}>
                <label htmlFor="f-stop">{t('Stopped at')}</label>
                <input id="f-stop" className="input mono" type="datetime-local" step={1} value={form.stop_ts} onChange={(e) => upd('stop_ts', e.target.value)} data-testid="f-stop" />
                {err('stop_ts')}
              </div>
              <div className={errors.start_ts ? 'field field--error' : 'field'}>
                <label htmlFor="f-start">{t('Restarted at')}</label>
                <input id="f-start" className="input mono" type="datetime-local" step={1} value={form.start_ts} onChange={(e) => upd('start_ts', e.target.value)} data-testid="f-start" />
                {err('start_ts')}
                {startBeforeStop && !errors.start_ts && <span className="field-hint">{t('The restart is earlier than the stop. It will be saved and flagged "Restart before stop".')}</span>}
              </div>
            </div>
          </FormSection>

          <FormSection icon="tool" title={t('What stopped')}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="f-area">{t('Area')}</label>
                <select
                  id="f-area" className="select" value={form.area_id} data-testid="f-area"
                  onChange={(e) => {
                    const a = startup.areas.find((x) => x.area_id === e.target.value);
                    setForm((f) => ({ ...f, area_id: e.target.value, line_id: a?.line_id ?? f.line_id }));
                  }}
                >
                  {startup.areas.map((a) => <option key={a.area_id} value={a.area_id}>{a.area_id} · {a.name}</option>)}
                </select>
                <span className="field-hint">{t('Line: {line}', { line: form.line_id })}</span>
              </div>
              <div className={errors.code_raw ? 'field field--error' : 'field'}>
                <label htmlFor="f-code">{t('Equipment code')}</label>
                <input id="f-code" className="input mono" value={form.code_raw} onChange={(e) => upd('code_raw', e.target.value)} autoCapitalize="characters" data-testid="f-code" />
                {err('code_raw')}
              </div>
              <div className="field">
                <label htmlFor="f-class">{t('Classification')}</label>
                <select id="f-class" className="select" value={form.classification} onChange={(e) => upd('classification', e.target.value as ClassificationCode)} data-testid="f-class">
                  {startup.classifications.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                </select>
                {form.classification !== row.classification && form.criticality === row.criticality && form.is_failure === row.is_failure && (
                  <span className="field-hint">{t('Criticality and failure are set again from the classification when you save, unless you change them here.')}</span>
                )}
              </div>
              <div className="field">
                <span className="field-label">{t('Criticality')}</span>
                <div className="chip-row" role="group" aria-label={t('Criticality')}>
                  <button type="button" className={form.criticality === 'INC' ? 'chip chip--on' : 'chip'} aria-pressed={form.criticality === 'INC'} onClick={() => upd('criticality', 'INC')}>INC</button>
                  <button type="button" className={form.criticality === 'NO_INC' ? 'chip chip--on' : 'chip'} aria-pressed={form.criticality === 'NO_INC'} onClick={() => upd('criticality', 'NO_INC')}>NO_INC</button>
                </div>
              </div>
              <div className="field">
                <span className="field-label">{t('Failure')}</span>
                <div className="chip-row" role="group" aria-label={t('Failure')}>
                  <button type="button" className={form.is_failure ? 'chip chip--on' : 'chip'} aria-pressed={form.is_failure} onClick={() => upd('is_failure', true)}>{t('Yes')}</button>
                  <button type="button" className={!form.is_failure ? 'chip chip--on' : 'chip'} aria-pressed={!form.is_failure} onClick={() => upd('is_failure', false)}>{t('No')}</button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="f-reason">{t('Reason')}</label>
                <input id="f-reason" className="input" list="f-reason-list" value={form.reason_raw} onChange={(e) => upd('reason_raw', e.target.value)} data-testid="f-reason" />
                <datalist id="f-reason-list">{listedReasons.map((r) => <option key={r} value={r} />)}</datalist>
                {form.reason_raw.trim() && !listedReasons.some((r) => r.toLowerCase().replace(/\s+/g, ' ') === form.reason_raw.trim().toLowerCase().replace(/\s+/g, ' ')) && (
                  <span className="field-hint">{t('This reason is not in the list for {c}. It will be saved and flagged.', { c: form.classification })}</span>
                )}
              </div>
              <div className="field span-2">
                <label htmlFor="f-desc">{t('Description')}</label>
                <textarea id="f-desc" className="textarea" value={form.description} onChange={(e) => upd('description', e.target.value)} data-testid="f-desc" />
              </div>
            </div>
          </FormSection>

          <FormSection icon="edit" title={t('Why are you changing this?')} hint={t('Required. It is kept in the edit history.')}>
            <div className={errors.note ? 'field field--error' : 'field'}>
              <label htmlFor="f-note">{t('Note')}</label>
              <textarea id="f-note" className="textarea" value={form.note} onChange={(e) => upd('note', e.target.value)} data-testid="f-note" />
              {err('note')}
            </div>
          </FormSection>
        </>
      )}

      {mode === 'void' && (
        <>
          {serverError && <div className="callout callout--danger" role="alert" data-testid="server-error"><Icon name="alert" size={16} /><span>{serverError}</span></div>}
          <FormSection icon={row.is_void ? 'history' : 'ban'} title={row.is_void ? t('Restore this event') : t('Void this event')}>
            <p className="muted" style={{ margin: '0 0 12px' }}>
              {row.is_void
                ? t('The event will count again in every chart and total.')
                : t('A voided event stays in the list and in its history, but every chart and total leaves it out.')}
            </p>
            <div className={errors.note ? 'field field--error' : 'field'}>
              <label htmlFor="f-void-note">{t('Note')}</label>
              <textarea id="f-void-note" className="textarea" value={form.note} onChange={(e) => upd('note', e.target.value)} data-testid="f-note" />
              {err('note')}
            </div>
          </FormSection>
        </>
      )}
    </ShellModal>
  );
}
