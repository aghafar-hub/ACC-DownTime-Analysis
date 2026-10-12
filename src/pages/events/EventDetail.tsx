import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, describeError } from '../../api';
import type { ClassificationCode, EventChanges, EventEdit, EventRow, Startup } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import ShellModal, { FormSection } from '../../components/ShellModal';
import { FLAG_INFO, isBlockingFlag, isInfoFlag } from '../../calc/flags';
import { SAVE_BLOCKED_EVENT } from '../../components/SaveBlockedToast';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { useOnlineStatus } from '../../useOnlineStatus';
import { duration } from '../../util/format';
import { flagList, isValidDate, parseTs } from '../../util/normalize';
import { shortTs } from '../../util/format';
import type { ValidateAssist } from './assist';
import EventBadges from './EventBadges';
import { buildOwnerLookup, causeChipLabel, causeNote, ownersOfRow } from './crossArea';
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
const initialForm = (r: EventRow, note = ''): Form => ({
  event_date: r.event_date, line_id: r.line_id, area_id: r.area_id, code_raw: r.code_raw, stop_ts: toInput(r.stop_ts), start_ts: toInput(r.start_ts),
  freq: r.freq, classification: r.classification, criticality: r.criticality, is_failure: r.is_failure,
  reason_raw: r.reason_raw ?? '', description: r.description ?? '', note,
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
  const flags = flagList(u).filter((f) => !isInfoFlag(f));
  return [
    t('Duration: {d}', { d: duration(u.duration_s) }),
    u.is_area_level ? t('Equipment: the whole area (N/A)') : u.equipment_id ? t('Equipment: {id}', { id: u.equipment_id }) : t('Equipment: not in the equipment list'),
    reasonText(startup, u) ? t('Reason: {r}', { r: reasonText(startup, u) }) : u.reason_raw ? t('Reason: not in the reason list') : t('Reason: none given'),
    t('Criticality: {c}, failure: {f}', { c: u.criticality, f: u.is_failure ? t('yes') : t('no') }),
    flags.length ? t('Data checks: {list}', { list: flags.map(flagLabel).join(', ') }) : t('Data checks: no issues'),
  ];
}

export default function EventDetail({ row, startup, canEdit, onClose, onChanged, assist }: {
  row: EventRow; startup: Startup | null; canEdit: boolean; onClose: () => void; onChanged: (row: EventRow) => void;
  /** set by the Validate page: problems explained, helps in the edit form, overlapping records */
  assist?: ValidateAssist;
}) {
  const { token, user } = useAuth();
  const online = useOnlineStatus();
  const [mode, setMode] = useState<Mode>(canEdit && assist?.initialMode ? assist.initialMode : 'view');
  const [history, setHistory] = useState<EventEdit[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(() => initialForm(row, canEdit && assist?.initialMode === 'edit' ? assist.defaultNote : ''));
  const [codeQ, setCodeQ] = useState('');
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
  // the stored problems (information flags are not problems), plus the overlap found by comparing records (Validate page)
  const flags = [...flagList(row).filter((f) => !isInfoFlag(f)), ...(assist?.overlaps?.length ? ['overlap_in_area'] : [])];
  const ownerLookup = useMemo(() => buildOwnerLookup(startup?.equipment_areas), [startup]);
  const crossOwners = ownersOfRow(row, ownerLookup);
  const crossArea = flagList(row).some(isInfoFlag);
  const unknownArea = !startup?.areas.some((a) => a.area_id === form.area_id);
  // the equipment finder: codes listed under the stopped area first, then every other active code with its owner area(s)
  const codeChoices = useMemo(() => {
    if (!startup) return { own: [], other: [] };
    const q = codeQ.trim().toLowerCase();
    const areasOf = new Map<string, string[]>();
    for (const ea of startup.equipment_areas) areasOf.set(ea.equipment_id, [...(areasOf.get(ea.equipment_id) ?? []), ea.area_id]);
    const own: { equipment_id: string; description?: string; owners: string[] }[] = [];
    const other: { equipment_id: string; description?: string; owners: string[] }[] = [];
    for (const e of startup.equipment) {
      if (e.status === 'Retired') continue;
      if (q && !`${e.equipment_id} ${e.description ?? ''}`.toLowerCase().includes(q)) continue;
      const owners = (areasOf.get(e.equipment_id) ?? []).slice().sort();
      (owners.includes(form.area_id) ? own : other).push({ equipment_id: e.equipment_id, description: e.description, owners });
    }
    const byId = (a: { equipment_id: string }, b: { equipment_id: string }) => a.equipment_id.localeCompare(b.equipment_id);
    return { own: own.sort(byId), other: other.sort(byId) };
  }, [startup, form.area_id, codeQ]);
  const blockedOffline = !online;

  function startEdit() {
    if (blockedOffline) return window.dispatchEvent(new CustomEvent(SAVE_BLOCKED_EVENT, { detail: { message: t('Editing needs a connection.') } }));
    setForm(initialForm(row, assist?.defaultNote));
    setCodeQ('');
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
      if (assist?.autoClose?.(updated)) {
        onClose();
        return;
      }
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
      if (assist?.autoClose?.(updated)) {
        onClose();
        return;
      }
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
            {crossArea && (
              <div className="callout" role="note" data-testid="cause-note">
                <Icon name="info" size={16} />
                <span>
                  <span className="badge" data-testid="cause-chip"><span aria-hidden="true">●</span> {causeChipLabel(crossOwners)}</span>{' '}
                  {causeNote(row.area_id, crossOwners)}
                </span>
              </div>
            )}
            {flags.length === 0 ? (
              <p className="muted" style={{ margin: 0, marginTop: crossArea ? 8 : 0 }}>{t('No data issues found.')}</p>
            ) : (
              <ul className="history" data-testid="detail-flags">
                {flags.map((f) => {
                  const info = (FLAG_INFO as Record<string, { problem: string; fix: string } | undefined>)[f];
                  const blocking = isBlockingFlag(f);
                  return (
                    <li key={f} data-testid="detail-flag" data-flag={f}>
                      <span className={blocking ? 'badge badge--danger' : 'badge badge--warning'}>
                        <span aria-hidden="true">{blocking ? '◆' : '▲'}</span> {flagLabel(f)}
                      </span>{' '}
                      <span>{info ? t(info.problem) : flagHelp(f)}</span>
                      {info && <div className="muted" data-testid="detail-flag-fix"><b>{t('What to do')}:</b> {t(info.fix)}</div>}
                      {f === 'overlap_in_area' && assist?.overlaps && (
                        <ul className="history" style={{ marginTop: 8 }} data-testid="overlap-partners">
                          {assist.overlaps.map((o) => (
                            <li key={o.event_id} className="v-partner" data-testid="overlap-partner" data-event-id={o.event_id}>
                              <span>
                                <b className="mono">{shortTs(o.stop_ts)} → {shortTs(o.start_ts)}</b> · {o.area_id} · <span className="mono">{o.code_raw || 'N/A'}</span> · {o.classification}
                              </span>
                              {assist.onOpenOther && (
                                <button type="button" className="btn btn-sm" onClick={() => assist.onOpenOther!(o.event_id)} data-testid="open-partner">{t('Open this record')}</button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
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
          {assist && flags.length > 0 && (
            <div className="callout v-edit-problems" data-testid="edit-problems">
              <span>
                <b>{t('To fix')}</b>
                <ul>
                  {flags.map((f) => (
                    <li key={f}>
                      <span className={isBlockingFlag(f) ? 'badge badge--danger' : 'badge badge--warning'}><span aria-hidden="true">{isBlockingFlag(f) ? '◆' : '▲'}</span> {flagLabel(f)}</span>{' '}
                      {(FLAG_INFO as Record<string, { fix: string } | undefined>)[f] ? t((FLAG_INFO as Record<string, { fix: string }>)[f].fix) : ''}
                    </li>
                  ))}
                </ul>
              </span>
            </div>
          )}
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
                  {unknownArea && <option value={form.area_id} disabled>{form.area_id ? t('{id} (not in the list of areas)', { id: form.area_id }) : t('Choose the area')}</option>}
                  {startup.areas.map((a) => <option key={a.area_id} value={a.area_id}>{a.area_id} · {a.name}</option>)}
                </select>
                <span className="field-hint">{t('Line: {line}', { line: form.line_id })}</span>
              </div>
              <div className={errors.code_raw ? 'field field--error' : 'field'}>
                <label htmlFor="f-code">{t('Equipment code')}</label>
                <input id="f-code" className="input mono" value={form.code_raw} onChange={(e) => upd('code_raw', e.target.value)} autoCapitalize="characters" data-testid="f-code" />
                {err('code_raw')}
                <div data-testid="code-finder">
                  <label htmlFor="f-code-find" className="field-hint">{t('Find equipment (listed under {area} first)', { area: form.area_id || t('this area') })}</label>
                  <input id="f-code-find" className="input" type="search" value={codeQ} onChange={(e) => setCodeQ(e.target.value)} placeholder={t('Code or description')} autoComplete="off" data-testid="f-code-find" />
                  <div className="v-picker" role="group" aria-label={t('Equipment')}>
                    <button type="button" className={form.code_raw.trim().toUpperCase() === 'N/A' ? 'chip chip--on' : 'chip'} aria-pressed={form.code_raw.trim().toUpperCase() === 'N/A'} onClick={() => upd('code_raw', 'N/A')} data-testid="code-na">
                      N/A · {t('the whole area stopped')}
                    </button>
                  </div>
                  {codeChoices.own.length > 0 && (
                    <div data-testid="code-group-own">
                      <span className="field-hint v-picker-label">{t('Listed under {area}', { area: form.area_id || t('this area') })}</span>
                      <div className="v-picker" role="group" aria-label={t('Listed under {area}', { area: form.area_id })}>
                        {codeChoices.own.slice(0, 6).map((e) => (
                          <button key={e.equipment_id} type="button" className={form.code_raw.trim() === e.equipment_id ? 'chip chip--on' : 'chip'} aria-pressed={form.code_raw.trim() === e.equipment_id} onClick={() => upd('code_raw', e.equipment_id)} data-testid="code-option">
                            <span className="mono">{e.equipment_id}</span>{e.description ? <span> · {e.description.slice(0, 28)}</span> : null}
                          </button>
                        ))}
                      </div>
                      {codeChoices.own.length > 6 && <span className="field-hint">{t('{n} more match. Type to narrow the list.', { n: codeChoices.own.length - 6 })}</span>}
                    </div>
                  )}
                  {codeChoices.other.length > 0 && (
                    <div data-testid="code-group-other">
                      <span className="field-hint v-picker-label">{t('Other areas')}</span>
                      <div className="v-picker" role="group" aria-label={t('Other areas')}>
                        {codeChoices.other.slice(0, 6).map((e) => (
                          <button key={e.equipment_id} type="button" className={form.code_raw.trim() === e.equipment_id ? 'chip chip--on' : 'chip'} aria-pressed={form.code_raw.trim() === e.equipment_id} onClick={() => upd('code_raw', e.equipment_id)} data-testid="code-option-other">
                            <span className="mono">{e.equipment_id}</span>{e.description ? <span> · {e.description.slice(0, 28)}</span> : null}
                            {e.owners.length > 0 && <span className="badge" data-testid="code-owner"> {e.owners.join(', ')}</span>}
                          </button>
                        ))}
                      </div>
                      {codeChoices.other.length > 6 && <span className="field-hint">{t('{n} more match. Type to narrow the list.', { n: codeChoices.other.length - 6 })}</span>}
                    </div>
                  )}
                  {codeChoices.own.length === 0 && codeChoices.other.length === 0 && <span className="field-hint">{t('No equipment matches{match}.', { match: codeQ.trim() ? t(' that search') : '' })}</span>}
                </div>
              </div>
              <div className="field">
                <label htmlFor="f-class">{t('Classification')}</label>
                <select id="f-class" className="select" value={form.classification} onChange={(e) => upd('classification', e.target.value as ClassificationCode)} data-testid="f-class">
                  {!startup.classifications.some((c) => c.code === form.classification) && <option value={form.classification} disabled>{t('Choose the classification')}</option>}
                  {startup.classifications.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
                </select>
                {assist?.suggestion && form.classification !== assist.suggestion.code && (
                  <button type="button" className="chip" onClick={() => upd('classification', assist.suggestion!.code as ClassificationCode)} data-testid="suggest-class">
                    {t('Use {c}: the most common for this area and code ({n} records)', { c: assist.suggestion.code, n: assist.suggestion.count })}
                  </button>
                )}
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
                {assist && (
                  <select
                    className="select" aria-label={t('Pick a listed reason')} data-testid="f-reason-pick"
                    value={listedReasons.includes(form.reason_raw.trim()) ? form.reason_raw.trim() : ''}
                    onChange={(e) => e.target.value && upd('reason_raw', e.target.value)}
                    disabled={listedReasons.length === 0}
                  >
                    <option value="">{listedReasons.length ? t('Pick a listed reason for {c}', { c: form.classification }) : t('Choose the classification first')}</option>
                    {listedReasons.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
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
