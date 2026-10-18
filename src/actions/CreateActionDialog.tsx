// "Create action" (docs/actions-mockups/desktop-create-action.png): manual, or filled in from a report, a Pareto bar, a
// repeated-failure row, an event record or a notification. The contractor follows the area (Settings › Actions & targets);
// when an open action already has the same equipment and reason, the person chooses between adding the records to it
// (what the server does by default) and creating a second action.
// Backend 1.7.0 (docs/actions-mockups/tasks/06-create-action-template.png): a task template is picked (the one whose draft rule
// matches what the action came from is suggested) and its tasks are listed pre-filled and editable: untick to skip, change the
// title, owner, person, due offset and the stop switch, or add another. "Area contractor" becomes the area's contractor. The
// action's own due date then follows its tasks.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ACTION_PRIORITIES, ACTION_ROOT_CAUSES, type ActionPriority, type ActionRootCause, type ActionScope, type NewAction } from '../api/types';
import ShellModal from '../components/ShellModal';
import { useStartup } from '../data/useStartup';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { codeKey } from '../calc';
import { num } from '../util/format';
import { useActions, type ActionPrefill } from './ActionsContext';
import { contractorName, defaultDue, defaultOwnerFor, mergeTarget, PRIORITY_SYMBOL, ROOT_CAUSE_LABEL, SOURCE_LABEL, todayLocal } from './model';
import { defaultPersonOf, draftsFromTemplate, draftsToTasks, suggestedTemplate, templateLine, type TaskDraft } from './tasks';
import { addDays } from '../calc';
import { dayText } from '../util/dates';

const SCOPES: { id: ActionScope; label: string }[] = [
  { id: 'plant', label: 'Plant' }, { id: 'line', label: 'Line' }, { id: 'area', label: 'Area' }, { id: 'equipment', label: 'Equipment' },
];

export default function CreateActionDialog({ prefill, onClose }: { prefill?: ActionPrefill; onClose: () => void }) {
  const acts = useActions();
  const mobile = useIsMobile();
  const { startup } = useStartup();
  const uid = useId().replace(/:/g, '');
  const today = todayLocal();
  const contractors = acts.payload?.contractors ?? [];
  const people = acts.payload?.people ?? [];
  const areas = useMemo(() => (startup?.areas ?? []).filter((a) => a.active !== false).slice().sort((a, b) => a.sort_order - b.sort_order), [startup]);
  const lines = useMemo(() => (startup?.lines ?? []).slice().sort((a, b) => a.sort_order - b.sort_order), [startup]);
  const equipment = useMemo(() => (startup?.equipment ?? []).filter((e) => e.status !== 'Retired'), [startup]);

  // the equipment code as in master data, and its area
  const eqOf = (code: string) => {
    const key = codeKey(code);
    return key ? equipment.find((e) => codeKey(e.equipment_id) === key) ?? null : null;
  };
  const areaOfEq = (code: string, prefer?: string): string => {
    const rows = (startup?.equipment_areas ?? []).filter((r) => codeKey(r.equipment_id) === codeKey(code));
    return rows.find((r) => r.area_id === prefer)?.area_id ?? rows[0]?.area_id ?? '';
  };
  const lineOfArea = (area: string): string => areas.find((a) => a.area_id === area)?.line_id ?? '';

  const initialScope: ActionScope = prefill?.scope_kind ?? (prefill?.equipment_id ? 'equipment' : prefill?.area_id ? 'area' : prefill?.line_id ? 'line' : 'equipment');
  const [scope, setScope] = useState<ActionScope>(initialScope);
  const [eq, setEq] = useState(prefill?.equipment_id ?? '');
  const [area, setArea] = useState(prefill?.area_id ?? '');
  const [line, setLine] = useState(prefill?.line_id ?? '');
  const [reason, setReason] = useState(prefill?.reason_key ?? '');
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [detail, setDetail] = useState(prefill?.detail ?? '');
  const [root, setRoot] = useState<ActionRootCause>('');
  const [required, setRequired] = useState('');
  const [priority, setPriority] = useState<ActionPriority>('Medium');
  const [needsStop, setNeedsStop] = useState(false);
  const [due, setDue] = useState(() => defaultDue('Medium', today));
  const [dueTouched, setDueTouched] = useState(false);
  // contractor and person: follow the area until the person picks one
  const [owner, setOwner] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [keepNew, setKeepNew] = useState(false);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // something was typed or changed: Escape, the close button, the shade and Back ask before throwing it away
  const [dirty, setDirty] = useState(false);
  const opened = useRef(true);
  useEffect(() => {
    if (opened.current) { opened.current = false; return; }
    setDirty(true);
  }, [scope, eq, area, line, reason, title, detail, root, required, priority, needsStop, owner, assignee]);
  const [asking, setAsking] = useState(false);
  const requestClose = () => {
    if (busy) return;
    if (!dirty) onClose();
    else setAsking((a) => !a); // a second Escape while asking means: keep editing
  };
  // backend 1.7.0: the task template and the tasks to create
  const templates = useMemo(() => (acts.payload?.templates ?? []).filter((x) => x.active).sort((a, b) => a.sort_order - b.sort_order), [acts.payload]);
  const suggested = suggestedTemplate(templates, prefill?.suggest ?? prefill?.source);
  const [tplId, setTplId] = useState<string | null>(null);
  const [rows, setRows] = useState<TaskDraft[] | null>(null);

  // what the scope resolves to
  const eqRow = scope === 'equipment' ? eqOf(eq) : null;
  const effArea = scope === 'equipment' ? (eqRow ? areaOfEq(eqRow.equipment_id, area) : area) : scope === 'area' ? area : '';
  const effLine = scope === 'plant' ? '' : scope === 'line' ? line : lineOfArea(effArea) || (scope === 'equipment' ? line : '');
  const auto = defaultOwnerFor(contractors, effArea);
  const ownerId = owner ?? auto.owner;
  const ownerAuto = owner === null && auto.auto;
  const assigneeId = assignee ?? (owner === null ? auto.assignee : contractors.find((c) => c.contractor_id === owner)?.default_assignee ?? '');
  const autoTitle = [scope === 'equipment' ? eqRow?.equipment_id ?? eq.trim() : scope === 'area' ? effArea : scope === 'line' ? effLine : t('Plant'), reason.trim()].filter(Boolean).join(' · ');
  const finalTitle = title.trim() || autoTitle;
  const eventIds = prefill?.eventIds ?? [];
  const tplChosen = tplId ?? suggested?.template_id ?? '';
  const tpl = templates.find((x) => x.template_id === tplChosen) ?? null;
  // the rows follow the template and the area until the person edits one
  const taskRows = useMemo(() => rows ?? draftsFromTemplate(tpl, effArea, contractors), [rows, tpl, effArea, contractors]);
  const ticked = taskRows.filter((r) => r.on && r.title.trim()).length;
  const editRow = (key: string, patch: Partial<TaskDraft>) => setRows(taskRows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const pickTemplate = (id: string) => {
    setTplId(id);
    setRows(null);
  };
  const addRow = () => {
    const owner = defaultOwnerFor(contractors, effArea).owner;
    setRows([...taskRows, { key: `new-${Date.now()}`, on: true, title: '', owner, assignee: defaultPersonOf(owner, contractors), offset: 7, needs_stop: false, est_stop_h: null, step: '' }]);
  };
  const newTasks = draftsToTasks(taskRows, today);

  const input: NewAction = {
    title: finalTitle, scope_kind: scope, detail: detail.trim(), priority, source: prefill?.source ?? 'manual', source_ref: prefill?.source_ref ?? '',
    ...(scope === 'equipment' ? { equipment_id: eqRow?.equipment_id ?? eq.trim(), area_id: effArea } : {}),
    ...(scope === 'area' ? { area_id: effArea } : {}),
    ...(scope === 'line' ? { line_id: effLine } : {}),
    ...(scope === 'equipment' || scope === 'area' ? { reason_key: reason.trim() } : {}),
    owner: ownerId, assignee: assigneeId, due_date: newTasks.length ? '' : due, needs_stop: newTasks.length ? false : needsStop, root_cause: root, required_action: required.trim(),
    evidence: eventIds.slice(0, 200).map((id) => ({ event_id: id })),
    ...(newTasks.length ? { tasks: newTasks, ...(tpl ? { template_id: tpl.template_id } : {}) } : {}),
  };
  const target = keepNew ? null : mergeTarget(acts.actions, input);

  const problems: Record<string, string> = {};
  if (scope === 'equipment' && !eq.trim()) problems.eq = t('Choose the equipment.');
  else if (scope === 'equipment' && !eqRow) problems.eq = t('This code is not in Master Data.');
  if (scope === 'area' && !effArea) problems.area = t('Choose the area.');
  if (scope === 'line' && !effLine) problems.line = t('Choose the line.');
  if (!finalTitle) problems.title = t('Write the problem in one line.');
  if (taskRows.some((r) => r.on && !r.title.trim())) problems.tasks = t('Every ticked task needs a title (or untick it).');

  async function save(status: 'Draft' | 'Open', merge: boolean) {
    setShown(true);
    setError(null);
    if (Object.keys(problems).length) return;
    setBusy(true);
    const res = await acts.create({ ...input, status }, merge);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    acts.announce(res.value);
    onClose();
  }

  const blocked = acts.blockedReason;
  const err = (k: string) => shown && problems[k] && <span className="field-error" role="alert" data-testid={`ca-error-${k}`}>{problems[k]}</span>;
  const drill = eventIds.length && startup ? { drill: { label: prefill?.trail?.slice(-1)[0] ?? t('Create action'), eventIds, rowIds: eventIds, years: startup.years, source: t('Create action') } } : undefined;
  const footer = asking ? (
    <div className="ca-discard" role="alertdialog" aria-label={t('Discard this action?')} data-testid="ca-discard">
      <span className="ca-discard-text"><Icon name="alert" size={15} /> {t('Close without saving? What you typed will be lost.')}</span>
      <button type="button" className="btn" onClick={() => setAsking(false)} data-testid="ca-discard-keep" autoFocus>{t('Keep editing')}</button>
      <button type="button" className="btn-danger" onClick={onClose} data-testid="ca-discard-yes">{t('Discard')}</button>
    </div>
  ) : (
    <>
      <span className="sm-foot-note ca-foot-note"><Icon name="info" size={14} /> {t('Templates are edited in Settings › Actions & targets › Task templates.')}</span>
      <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid="ca-cancel">{t('Cancel')}</button>
      <button type="button" className="btn" onClick={() => void save('Draft', !keepNew)} disabled={busy || !!blocked} data-testid="ca-draft">{t('Save as draft')}</button>
      <button type="button" className="btn-primary" onClick={() => void save('Open', !keepNew)} disabled={busy || !!blocked} data-testid="ca-open">
        <Icon name="plus" size={15} /> {busy ? t('Saving…') : ticked ? (mobile ? t('Create · {n} tasks', { n: ticked }) : ticked === 1 ? t('Create action with 1 task') : t('Create action with {n} tasks', { n: ticked })) : t('Create and open')}
      </button>
    </>
  );

  return (
    <ShellModal
      icon="compliance" title={t('Create action')} width={980} testid="create-action" onClose={requestClose} footer={footer}
      subtitle={prefill && prefill.source !== 'manual' ? t('Filled in from what you picked. Check it, then save as draft or open it.') : t('Describe the problem, then save it as a draft or open it.')}
    >
      {prefill?.trail && prefill.trail.length > 0 && (
        <p className="ca-from" data-testid="ca-from">
          <b>{t('FROM')}</b>
          {prefill.trail.map((x, i) => <span key={i}>{i > 0 && <Icon name="chevronRight" size={13} />}{x}</span>)}
        </p>
      )}
      {blocked && <div className="callout callout--warning" role="status" data-testid="ca-offline"><Icon name="wifiOff" size={16} /><span>{blocked}</span></div>}
      {error && <div className="callout callout--danger" role="alert" data-testid="ca-error"><Icon name="alert" size={16} /><span>{error}</span></div>}

      <div className="ca-grid">
        <div className="field ca-span">
          <span className="field-label" id={`${uid}-scope`}>{t('Scope')}</span>
          <div className="ca-scope-row">
            <div className="dseg act-seg" role="group" aria-labelledby={`${uid}-scope`} data-testid="ca-scope">
              {SCOPES.map((s) => (
                <button key={s.id} type="button" className="dseg-btn" aria-pressed={scope === s.id} onClick={() => setScope(s.id)} data-testid={`ca-scope-${s.id}`}>{t(s.label)}</button>
              ))}
            </div>
            <span className="field-hint">{scope === 'equipment' ? t('Area and line come from Master Data.') : scope === 'area' ? t('The line follows the area.') : scope === 'plant' ? t('The whole plant: no area or line.') : ''}</span>
          </div>
        </div>

        {scope === 'equipment' && (
          <>
            <div className={shown && problems.eq ? 'field field--error ca-w2' : 'field ca-w2'}>
              <label htmlFor={`${uid}-eq`}>{t('Equipment')}</label>
              <input id={`${uid}-eq`} className="input mono" list={`${uid}-eqs`} value={eq} onChange={(e) => setEq(e.target.value)} placeholder={t('Code, e.g. 262.MT120')} autoComplete="off" data-testid="ca-equipment" />
              <datalist id={`${uid}-eqs`}>{equipment.slice(0, 3000).map((e) => <option key={e.equipment_id} value={e.equipment_id}>{e.description}</option>)}</datalist>
              {eqRow?.description && <span className="field-hint" data-testid="ca-eq-desc">{eqRow.description}</span>}
              {err('eq')}
            </div>
            <div className="field ca-w-area">
              <span className="field-label">{t('Area')}</span>
              <span className="ca-locked" data-testid="ca-area-locked"><span>{effArea || '–'}{effArea && areas.find((a) => a.area_id === effArea)?.name ? ` · ${areas.find((a) => a.area_id === effArea)!.name}` : ''}</span><Icon name="shield" size={14} /></span>
            </div>
            <div className="field">
              <span className="field-label">{t('Line')}</span>
              <span className="ca-locked"><span>{effLine || '–'}</span><Icon name="shield" size={14} /></span>
            </div>
          </>
        )}
        {scope === 'area' && (
          <>
            <div className={shown && problems.area ? 'field field--error ca-w2' : 'field ca-w2'}>
              <label htmlFor={`${uid}-area`}>{t('Area')}</label>
              <select id={`${uid}-area`} className="select" value={area} onChange={(e) => setArea(e.target.value)} data-testid="ca-area">
                <option value="">{t('Choose…')}</option>
                {areas.map((a) => <option key={a.area_id} value={a.area_id}>{a.area_id} · {a.name}</option>)}
              </select>
              {err('area')}
            </div>
            <div className="field">
              <span className="field-label">{t('Line')}</span>
              <span className="ca-locked"><span>{effLine || '–'}</span><Icon name="shield" size={14} /></span>
            </div>
          </>
        )}
        {scope === 'line' && (
          <div className={shown && problems.line ? 'field field--error ca-w2' : 'field ca-w2'}>
            <label htmlFor={`${uid}-line`}>{t('Line')}</label>
            <select id={`${uid}-line`} className="select" value={line} onChange={(e) => setLine(e.target.value)} data-testid="ca-line">
              <option value="">{t('Choose…')}</option>
              {lines.map((l) => <option key={l.line_id} value={l.line_id}>{l.line_id} · {l.name}</option>)}
            </select>
            {err('line')}
          </div>
        )}
        {(scope === 'equipment' || scope === 'area') && (
          <div className="field ca-w2">
            <label htmlFor={`${uid}-reason`}>{t('Reason')} <span className="muted">· {t('optional; the same equipment and reason is one action')}</span></label>
            <input id={`${uid}-reason`} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. Motor trip on overcurrent')} data-testid="ca-reason" />
          </div>
        )}

        <div className="field ca-w2">
          <span className="field-label">{t('Source')}</span>
          <span className="ca-locked ca-source" data-testid="ca-source"><span className="act-tag">{t(SOURCE_LABEL[prefill?.source ?? 'manual'])}</span><span>{prefill?.source_ref && prefill.source !== 'notification' && prefill.source !== 'event' ? prefill.source_ref : ''}</span></span>
        </div>
        <div className="field ca-w2">
          <span className="field-label">{t('Evidence')}</span>
          <span className="ca-locked ca-evidence" data-testid="ca-evidence">
            <Icon name="link" size={14} />
            <span><b>{eventIds.length === 1 ? t('1 linked record') : t('{n} linked records', { n: num(eventIds.length) })}</b>{prefill?.hours !== undefined ? ` · ${prefill.hours.toFixed(1)} h` : ''}</span>
            {drill && <Link to="/events" state={drill} className="ca-view" onClick={onClose} data-testid="ca-evidence-view">{t('View')}</Link>}
          </span>
        </div>

        {target && (
          <div className="callout ca-span ca-merge" role="status" data-testid="ca-merge">
            <Icon name="info" size={16} />
            <span>
              <b>{t('An open action already exists for {x}:', { x: target.equipment_id || target.area_id || t('this cause') })}</b>{' '}
              {target.action_id} · {t(target.status)} · {t(SOURCE_LABEL[target.source])}{target.owner ? ` (${contractorName(contractors, target.owner)})` : ` (${t('no contractor')})`}.{' '}
              {eventIds.length ? t('Add these {n} records to it instead of creating a second action?', { n: eventIds.length }) : t('Add this to it instead of creating a second action?')}
              <span className="ca-merge-btns">
                <button type="button" className="btn-primary act-blue" onClick={() => void save('Open', true)} disabled={busy || !!blocked} data-testid="ca-merge-add">{t('Add evidence to {id}', { id: target.action_id })}</button>
                <button type="button" className="btn" onClick={() => setKeepNew(true)} data-testid="ca-merge-new">{t('Keep creating a new action')}</button>
              </span>
            </span>
          </div>
        )}

        <div className={shown && problems.title ? 'field field--error ca-span' : 'field ca-span'}>
          <label htmlFor={`${uid}-title`}>{t('Problem statement')} <span className="muted">· {t('written automatically, you can edit')}</span></label>
          <input id={`${uid}-title`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle || t('What is wrong, in one line')} maxLength={200} data-testid="ca-title" />
          {err('title')}
        </div>
        <div className="field ca-span">
          <label htmlFor={`${uid}-detail`}>{t('Details')} <span className="muted">· {t('optional')}</span></label>
          <textarea id={`${uid}-detail`} className="textarea" rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={2000} data-testid="ca-detail" />
        </div>

        <div className="field ca-span ca-tasks" data-testid="ca-tasks">
          <span className="field-label" id={`${uid}-tpl`}>{t('Task template')}</span>
          <div className="ca-tpls" role="radiogroup" aria-labelledby={`${uid}-tpl`} data-testid="ca-templates">
            {templates.map((x) => (
              <button key={x.template_id} type="button" role="radio" aria-checked={tplChosen === x.template_id} className={tplChosen === x.template_id ? 'ca-tpl ca-tpl--on' : 'ca-tpl'}
                onClick={() => pickTemplate(x.template_id)} data-testid={`ca-tpl-${x.template_id}`}>
                {suggested?.template_id === x.template_id && <span className="ca-tpl-badge" data-testid="ca-tpl-suggested">{t('suggested')}</span>}
                <b>{x.name}</b><small>{templateLine(x)}</small>
              </button>
            ))}
            <button type="button" role="radio" aria-checked={tplChosen === ''} className={tplChosen === '' ? 'ca-tpl ca-tpl--on' : 'ca-tpl'} onClick={() => pickTemplate('')} data-testid="ca-tpl-none">
              <b><Icon name="plus" size={14} /> {t('No template')}</b><small>{t('start with no tasks')}</small>
            </button>
          </div>
          <div className="ca-task-head"><b>{t('Tasks to create')}</b> <span className="act-tag" data-testid="ca-ticked">{t('{n} of {m} ticked', { n: ticked, m: taskRows.length })}</span>
            <span className="muted ca-task-hint">{tpl ? t('pre-filled from the template · edit anything, untick to skip') : t('add the work as tasks, or leave it empty')}</span></div>
          {taskRows.length > 0 && (
            <ul className="ca-task-list" data-testid="ca-task-list">
              {taskRows.map((r, i) => (
                <li key={r.key} className={r.on ? 'ca-task' : 'ca-task ca-task--off'} data-testid="ca-task">
                  <label className="ca-task-tick"><input type="checkbox" checked={r.on} onChange={(e) => editRow(r.key, { on: e.target.checked })} aria-label={t('Create task {n}', { n: i + 1 })} data-testid="ca-task-on" /></label>
                  <input className="input ca-task-title" value={r.title} onChange={(e) => editRow(r.key, { title: e.target.value })} aria-label={t('Title of task {n}', { n: i + 1 })} maxLength={200} placeholder={t('What has to be done')} data-testid="ca-task-title" />
                  <span className="ca-task-owner">
                    <select className="select" value={r.owner} onChange={(e) => editRow(r.key, { owner: e.target.value, assignee: defaultPersonOf(e.target.value, contractors) || r.assignee })} aria-label={t('Owner of task {n}', { n: i + 1 })} data-testid="ca-task-owner">
                      <option value="">{t('Nobody yet')}</option>
                      {contractors.filter((c) => c.active || c.contractor_id === r.owner).map((c) => <option key={c.contractor_id} value={c.contractor_id}>{c.name}</option>)}
                    </select>
                    <select className="select" value={r.assignee} onChange={(e) => editRow(r.key, { assignee: e.target.value })} aria-label={t('Person of task {n}', { n: i + 1 })} data-testid="ca-task-person">
                      <option value="">{t('No person')}</option>
                      {r.assignee && !people.some((p) => p.user_id === r.assignee) && <option value={r.assignee}>{r.assignee}</option>}
                      {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}
                    </select>
                  </span>
                  <span className="ca-task-due">
                    <span className="ca-task-plus">+<input className="input" inputMode="numeric" value={String(r.offset)} onChange={(e) => editRow(r.key, { offset: Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))) })} aria-label={t('Days until task {n} is due', { n: i + 1 })} data-testid="ca-task-offset" /> d</span>
                    <small className="muted">{dayText(addDays(today, r.offset))}</small>
                  </span>
                  <label className="act-switch ca-task-stop">
                    <input type="checkbox" checked={r.needs_stop} onChange={(e) => editRow(r.key, { needs_stop: e.target.checked, est_stop_h: e.target.checked ? r.est_stop_h : null })} data-testid="ca-task-stop" />
                    <span className="act-switch-ui" aria-hidden="true" /><span>{r.needs_stop ? t('Stop') : t('No')}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {scope === 'equipment' && tpl && (
            <p className="ca-check" data-testid="ca-check"><Icon name="shield" size={14} /><span><b>{t('Check after 60 days')}</b> — {t('not a task: it is the action\'s effectiveness check, which starts when the action is closed.')}</span></p>
          )}
          <button type="button" className="af-link ca-add-task" onClick={addRow} data-testid="ca-task-add"><Icon name="plus" size={14} /> {t('Add another task')}</button>
          {shown && problems.tasks && <span className="field-error" role="alert" data-testid="ca-error-tasks">{problems.tasks}</span>}
          {ticked > 0 && <span className="field-hint">{effArea && tpl?.steps.some((x) => x.default_owner === 'area_contractor')
            ? t('"Area contractor" in the template becomes {c} here ({a}). Due dates count from today, {d}.', { c: contractorName(contractors, defaultOwnerFor(contractors, effArea).owner) || t('nobody'), a: effArea, d: dayText(today) })
            : t('Due dates count from today, {d}.', { d: dayText(today) })}</span>}
        </div>
        <div className="field ca-span">
          <span className="field-label" id={`${uid}-root`}>{t('Root-cause category')} <span className="muted">· {t('optional now')}</span></span>
          <div className="act-chips" role="group" aria-labelledby={`${uid}-root`} data-testid="ca-root">
            {[...ACTION_ROOT_CAUSES.filter((r) => r), ''].map((r) => (
              <button key={r || 'none'} type="button" className={root === r ? 'act-choice act-choice--on' : 'act-choice'} aria-pressed={root === r} onClick={() => setRoot(r as ActionRootCause)} data-testid={`ca-root-${r || 'none'}`}>
                {root === r && <Icon name="check" size={14} />}{r && <b>{r}</b>} {t(ROOT_CAUSE_LABEL[r]!)}
              </button>
            ))}
          </div>
        </div>
        <div className="field ca-span">
          <label htmlFor={`${uid}-req`}>{t('Required action')}</label>
          <textarea id={`${uid}-req`} className="textarea" rows={3} value={required} onChange={(e) => setRequired(e.target.value)} placeholder={t('What should be done, by whom… e.g. check the drive current limit and the motor brushes')} maxLength={2000} data-testid="ca-required" />
        </div>

        <div className="field ca-w3">
          <label htmlFor={`${uid}-owner`}>{t('Contractor / team')} {ownerAuto && <span className="act-tag act-tag--auto" data-testid="ca-owner-auto"><Icon name="sync" size={12} />{t('auto')}</span>}</label>
          <select id={`${uid}-owner`} className="select" value={ownerId} onChange={(e) => setOwner(e.target.value)} data-testid="ca-owner">
            <option value="">{t('Nobody yet')}</option>
            {contractors.filter((c) => c.active || c.contractor_id === ownerId).map((c) => <option key={c.contractor_id} value={c.contractor_id}>{c.name}{c.kind === 'internal' ? ` · ${t('internal')}` : ''}</option>)}
          </select>
          <span className="field-hint">{auto.auto && effArea ? t('{a} is a {c} area (Settings).', { a: effArea, c: contractorName(contractors, auto.owner) }) : t('No contractor is set for this area.')}</span>
        </div>
        <div className="field ca-w3">
          <label htmlFor={`${uid}-who`}>{t('Owner')}</label>
          <select id={`${uid}-who`} className="select" value={assigneeId} onChange={(e) => setAssignee(e.target.value)} data-testid="ca-assignee">
            <option value="">{t('Nobody yet')}</option>
            {assigneeId && !people.some((p) => p.user_id === assigneeId) && <option value={assigneeId}>{assigneeId}</option>}
            {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}
          </select>
          <span className="field-hint">{t('The person who follows it up.')}</span>
        </div>
        {ticked === 0 && <div className="field ca-w3">
          <label htmlFor={`${uid}-due`}>{t('Due date')}</label>
          <input id={`${uid}-due`} type="date" className="input" value={due} onChange={(e) => { setDue(e.target.value); setDueTouched(true); }} data-testid="ca-due" />
          <span className="field-hint">{t('Default for {p}: {n} days', { p: t(priority), n: priority === 'High' ? 14 : priority === 'Medium' ? 30 : 60 })}</span>
        </div>}
        {ticked > 0 && <div className="field ca-w3"><span className="field-label">{t('Due date')}</span><span className="ca-locked" data-testid="ca-due-derived"><span>{t('Follows the tasks: {d}', { d: dayText(newTasks.map((x) => x.due_date ?? '').sort().pop() ?? '') })}</span></span></div>}

        <div className="field ca-w2">
          <span className="field-label" id={`${uid}-pri`}>{t('Priority')}</span>
          <div className="dseg act-seg" role="group" aria-labelledby={`${uid}-pri`} data-testid="ca-priority">
            {ACTION_PRIORITIES.map((p) => (
              <button key={p} type="button" className="dseg-btn" aria-pressed={priority === p} data-testid={`ca-priority-${p}`}
                onClick={() => { setPriority(p); if (!dueTouched) setDue(defaultDue(p, today)); }}>
                <span className={`act-pri act-pri--${p.toLowerCase()}`} aria-hidden="true">{PRIORITY_SYMBOL[p]}</span> {t(p)}
              </button>
            ))}
          </div>
        </div>
        {ticked === 0 && <div className="field ca-w2">
          <span className="field-label">{t('Needs stoppage')}</span>
          <label className="act-switch">
            <input type="checkbox" checked={needsStop} onChange={(e) => setNeedsStop(e.target.checked)} data-testid="ca-needs-stop" />
            <span className="act-switch-ui" aria-hidden="true" />
            <span>{needsStop ? t('Yes — the work needs {x} stopped', { x: effArea || t('the area') }) : t('No')}</span>
          </label>
        </div>}

      </div>
    </ShellModal>
  );
}
