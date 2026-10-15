// Add or edit one task (docs/actions-mockups/tasks/04-add-edit-task.png): the title, who owns it (a contractor or a team; a new
// task starts with the area's contractor), the person who follows it up (gets the overdue alert), the due date with quick
// picks, whether the work needs the area stopped (then it is on the Shutdown list) with the estimated stop hours, and notes.
// The status is changed from the task row, not here. Tasks are never deleted: Not needed instead.
import { useId, useMemo, useState } from 'react';
import { contractorForArea, type Action, type ActionTask, type ActionOwnerKind, type TaskChanges } from '../api/types';
import ShellModal from '../components/ShellModal';
import { addDays } from '../calc';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useActions } from './ActionsContext';
import { contractorName, daysFrom } from './model';
import { TaskStatusChip } from './parts';
import { defaultPersonOf } from './tasks';

const QUICK_DAYS = [3, 7, 14, 30];

export default function TaskDialog({ action, task, today, onClose, onDone }: {
  action: Action; task?: ActionTask; today: string; onClose: () => void; onDone: (text: string) => void;
}) {
  const acts = useActions();
  const uid = useId().replace(/:/g, '');
  const contractors = useMemo(() => acts.payload?.contractors ?? [], [acts.payload]);
  const people = acts.payload?.people ?? [];
  const areaC = action.area_id ? contractorForArea(contractors, action.area_id) : null;
  const firstOwner = task ? task.owner : areaC?.contractor_id ?? '';
  const [kind, setKind] = useState<ActionOwnerKind>(task ? task.owner_kind : areaC ? 'contractor' : 'internal');
  const [title, setTitle] = useState(task?.title ?? '');
  const [owner, setOwner] = useState(firstOwner);
  const [assignee, setAssignee] = useState(task ? task.assignee : defaultPersonOf(firstOwner, contractors));
  const [due, setDue] = useState(task?.due_date ?? addDays(today, 7));
  const [stop, setStop] = useState(task?.needs_stop ?? false);
  const [hours, setHours] = useState(task?.est_stop_h !== null && task?.est_stop_h !== undefined ? String(task.est_stop_h) : '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = contractors.filter((c) => (c.active || c.contractor_id === owner) && c.kind === kind);
  const hoursNum = hours.trim() === '' ? null : Number(hours.replace(',', '.'));

  const problems: Record<string, string> = {};
  if (!title.trim()) problems.title = t('Write what has to be done.');
  if (!due) problems.due = t('Choose the due date.');
  if (stop && hoursNum !== null && !(hoursNum >= 0 && hoursNum <= 1000)) problems.hours = t('Hours must be 0 to 1,000.');

  const pickKind = (k: ActionOwnerKind) => {
    setKind(k);
    const first = k === 'contractor' ? areaC?.contractor_id ?? contractors.find((c) => c.active && c.kind === k)?.contractor_id ?? '' : '';
    if (contractors.find((c) => c.contractor_id === owner)?.kind !== k) {
      setOwner(first);
      setAssignee(defaultPersonOf(first, contractors) || assignee);
    }
  };
  const pickOwner = (id: string) => {
    setOwner(id);
    const p = defaultPersonOf(id, contractors);
    if (p && (!assignee || assignee === defaultPersonOf(owner, contractors))) setAssignee(p);
  };

  async function save() {
    setShown(true);
    setError(null);
    if (Object.keys(problems).length) return;
    setBusy(true);
    const fields = { title: title.trim(), owner, assignee, due_date: due, needs_stop: stop, est_stop_h: stop ? hoursNum : null, notes: notes.trim() };
    let res;
    if (task) {
      const changes: TaskChanges = {};
      (Object.keys(fields) as (keyof typeof fields)[]).forEach((k) => {
        if (fields[k] !== (task[k] ?? (k === 'est_stop_h' ? null : ''))) (changes as Record<string, unknown>)[k] = fields[k];
      });
      if (!Object.keys(changes).length) {
        setBusy(false);
        onClose();
        return;
      }
      res = await acts.updateTask(task.task_id, changes);
    } else {
      res = await acts.addTask(action.action_id, fields);
    }
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDone(task ? t('Task {n} saved.', { n: task.seq }) : t('Task {n} added.', { n: res.value.task?.seq ?? '' }));
  }

  const left = due ? daysFrom(today, due) : null;
  const err = (k: string) => shown && problems[k] && <span className="field-error" role="alert" data-testid={`task-error-${k}`}>{problems[k]}</span>;
  const footer = (
    <>
      <span className="sm-foot-note"><Icon name="info" size={14} /> {t('Tasks are never deleted — set Not needed instead.')}</span>
      <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid="task-cancel">{t('Cancel')}</button>
      <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy || !!acts.blockedReason} data-testid="task-save">
        <Icon name={task ? 'check' : 'plus'} size={15} /> {busy ? t('Saving…') : task ? t('Save task') : t('Add task')}
      </button>
    </>
  );
  return (
    <ShellModal icon="list" title={task ? t('Edit task {n}', { n: task.seq }) : t('Add task')} width={760} onClose={onClose} footer={footer} testid="task-dialog"
      subtitle={<><span className="mono ad-id-sm">{action.action_id}</span> · {action.title}{action.area_id ? ` · ${action.area_id}` : ''}{action.line_id ? ` · ${action.line_id}` : ''}</>}>
      {acts.blockedReason && <div className="callout callout--warning" role="status"><Icon name="wifiOff" size={16} /><span>{acts.blockedReason}</span></div>}
      {error && <div className="callout callout--danger" role="alert" data-testid="task-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
      <div className="tk-form">
        <div className={shown && problems.title ? 'field field--error tk-span' : 'field tk-span'}>
          <label htmlFor={`${uid}-title`}>{t('Task')} <span className="req">*</span></label>
          <input id={`${uid}-title`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t('What has to be done, e.g. Replace the chain links')} data-testid="task-title" />
          {err('title')}
        </div>
        <div className="field">
          <span className="field-label" id={`${uid}-kind`}>{t('Owner is')}</span>
          <div className="dseg act-seg" role="group" aria-labelledby={`${uid}-kind`} data-testid="task-kind">
            <button type="button" className="dseg-btn" aria-pressed={kind === 'contractor'} onClick={() => pickKind('contractor')} data-testid="task-kind-contractor">{t('Contractor')}</button>
            <button type="button" className="dseg-btn" aria-pressed={kind === 'internal'} onClick={() => pickKind('internal')} data-testid="task-kind-internal">{t('Team')}</button>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-owner`}>{t('Owner')}</label>
          <select id={`${uid}-owner`} className="select" value={owner} onChange={(e) => pickOwner(e.target.value)} data-testid="task-owner">
            <option value="">{t('Nobody yet')}</option>
            {choices.map((c) => <option key={c.contractor_id} value={c.contractor_id}>{c.name}</option>)}
          </select>
          <span className="field-hint">{areaC && action.area_id ? t('From the area: {a} → {c}', { a: action.area_id, c: contractorName(contractors, areaC.contractor_id) }) : t('No contractor is set for this area.')}</span>
        </div>
        <div className="field">
          <label htmlFor={`${uid}-who`}>{t('Person')}</label>
          <select id={`${uid}-who`} className="select" value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="task-assignee">
            <option value="">{t('Nobody yet')}</option>
            {assignee && !people.some((p) => p.user_id === assignee) && <option value={assignee}>{assignee}</option>}
            {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}
          </select>
          <span className="field-hint">{t('Follows it up; gets the overdue alert.')}</span>
        </div>
        <div className={shown && problems.due ? 'field field--error' : 'field'}>
          <label htmlFor={`${uid}-due`}>{t('Due date')} <span className="req">*</span></label>
          <input id={`${uid}-due`} type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} data-testid="task-due-input" />
          <span className="tk-quick" role="group" aria-label={t('Quick due dates')}>
            {QUICK_DAYS.map((n) => <button key={n} type="button" className="chip" onClick={() => setDue(addDays(today, n))} data-testid={`task-due-${n}`}>+{n} d</button>)}
          </span>
          <span className="field-hint" data-testid="task-due-left">{left === null ? '' : left < 0 ? t('{n} days overdue', { n: -left }) : left === 0 ? t('Due today') : t('{n} days left', { n: left })}</span>
          {err('due')}
        </div>
        <div className="field">
          <span className="field-label">{t('Status')}</span>
          <span className="tk-status-ro">{task ? <TaskStatusChip status={task.status} /> : <TaskStatusChip status="Open" />}<small className="muted">{task ? t('change it from the task row') : t('a new task starts Open')}</small></span>
        </div>
        <div className={stop ? 'tk-stopbox tk-stopbox--on tk-span' : 'tk-stopbox tk-span'}>
          <div>
            <label className="act-switch">
              <input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} data-testid="task-needs-stop" />
              <span className="act-switch-ui" aria-hidden="true" /><b>{t('Needs stoppage')}</b>
            </label>
            <p className="field-hint">{action.area_id
              ? t('The work can only be done with {a} stopped. The task is listed in the Shutdown list under {a} until it is Done.', { a: action.area_id })
              : t('The work can only be done with the plant or line stopped. The task is listed in the Shutdown list until it is Done.')}</p>
          </div>
          {stop && (
            <div className={shown && problems.hours ? 'field field--error tk-hours' : 'field tk-hours'}>
              <label htmlFor={`${uid}-h`}>{t('Est. stop hours')}</label>
              <span className="tk-hours-in"><input id={`${uid}-h`} className="input" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} data-testid="task-hours" placeholder="–" /><span aria-hidden="true">h</span></span>
              <span className="field-hint">{t('optional')}</span>
              {err('hours')}
            </div>
          )}
        </div>
        <div className="field tk-span">
          <label htmlFor={`${uid}-notes`}>{t('Notes')}</label>
          <textarea id={`${uid}-notes`} className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} data-testid="task-notes" />
        </div>
      </div>
    </ShellModal>
  );
}
