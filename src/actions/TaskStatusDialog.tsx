// "Change status" of one task (docs/actions-mockups/tasks/05-task-status-change.png, 12-phone-task-status.png): the six task
// statuses with a line each. Contractor informed is greyed out for a task owned by an internal team; Done needs a short note
// (what was done) and Not needed a reason. A desktop gets a small dialog, a phone a bottom sheet. The action follows its tasks
// on the server (In progress as soon as a task starts; the closers are told when the last one closes).
import { useId, useState } from 'react';
import type { Action, ActionTask, Contractor, ActionPerson, TaskStatus } from '../api/types';
import { BottomSheet } from '../components/PhoneParts';
import ShellModal from '../components/ShellModal';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useActions } from './ActionsContext';
import { contractorName, personName } from './model';
import { TaskStatusChip } from './parts';
import { taskDueInfo, taskNeedsNote, taskNoteLabel, taskNoteProblem, taskStatusOptions } from './tasks';

export default function TaskStatusDialog({ task, action, contractors, people, today, initial, onClose, onDone }: {
  task: ActionTask; action: Pick<Action, 'action_id' | 'area_id'>; contractors: readonly Contractor[]; people: readonly ActionPerson[]; today: string;
  initial?: TaskStatus; onClose: () => void; onDone: (text: string) => void;
}) {
  const acts = useActions();
  const mobile = useIsMobile();
  const uid = useId().replace(/:/g, '');
  const options = taskStatusOptions(task);
  const [to, setTo] = useState<TaskStatus | null>(initial && initial !== task.status ? initial : null);
  const [note, setNote] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = to ? taskNoteProblem(to, note) : null;
  const blocked = acts.blockedReason;
  const due = taskDueInfo(task, today);
  const who = [contractorName(contractors, task.owner), personName(people, task.assignee), due.tone === 'overdue' ? due.text : ''].filter(Boolean).join(' · ');

  async function go() {
    setShown(true);
    setError(null);
    if (!to || problem) return;
    setBusy(true);
    const res = await acts.updateTask(task.task_id, { status: to, ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const a = res.value.action;
    onDone(to === 'Done' ? t('Task {n} is done.', { n: task.seq }) : t('Task {n} moved to {s}.', { n: task.seq, s: t(to) })
      + (a.status !== 'Draft' && res.value.tasks.every((x) => x.status === 'Done' || x.status === 'Not needed') ? ` ${t('All tasks are done: the action is ready to close.')}` : ''));
  }

  const stopLine = (s: TaskStatus) => (s === 'Waiting stoppage' && action.area_id ? t('Needs a stop of {a} · goes to the Shutdown list', { a: action.area_id }) : null);
  const label = !to ? t('Choose a status') : to === 'Done' ? t('Mark done') : to === 'Not needed' ? t('Set Not needed') : t('Move to {s}', { s: t(to) });
  const body = (
    <div className="ts-dialog" data-testid="task-status-dialog" data-task={task.task_id}>
      <div className="st-list ts-list" role="radiogroup" aria-label={t('New status of task {n}', { n: task.seq })}>
        {options.map((o) => (
          <label key={o.status} className={`st-opt ts-opt${to === o.status ? ' st-opt--on' : ''}${!o.allowed ? ' st-opt--off' : ''}`}
            data-testid={`task-opt-${o.status.replace(/\s+/g, '-')}`} data-allowed={o.allowed}>
            <input type="radio" name={`${uid}-ts`} value={o.status} checked={to === o.status} disabled={!o.allowed} onChange={() => setTo(o.status)} />
            <span className="ts-opt-text">
              <TaskStatusChip status={o.status} testid="task-opt-chip" />
              <small>{(!o.current && stopLine(o.status)) || o.note}</small>
            </span>
            {o.current && <span className="ts-current">{t('current')}</span>}
          </label>
        ))}
      </div>
      <div className={shown && problem ? 'field field--error' : 'field'}>
        <label htmlFor={`${uid}-note`}>{to ? taskNoteLabel(to) : t('Note (optional)')}{to && taskNeedsNote(to) && <span className="req"> *</span>}</label>
        <textarea id={`${uid}-note`} className="textarea" rows={mobile ? 2 : 3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} data-testid="task-status-note"
          placeholder={to === 'Done' ? t('e.g. 5-why done with RHI: wet clay + short flap stroke.') : ''} />
        {shown && problem && <span className="field-error" role="alert" data-testid="task-status-note-error">{problem}</span>}
        <span className="field-hint">{t('Saved in the task history with your name and the time.')}</span>
      </div>
      {blocked && <div className="callout callout--warning" role="status"><Icon name="wifiOff" size={16} /><span>{blocked}</span></div>}
      {error && <div className="callout callout--danger" role="alert" data-testid="task-status-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
    </div>
  );
  const footer = (
    <>
      {!mobile && <button type="button" className="btn" onClick={onClose} disabled={busy} data-testid="task-status-back">{t('Cancel')}</button>}
      <button type="button" className="btn-primary" onClick={() => void go()} disabled={busy || !to || !!blocked} data-testid="task-status-apply">
        {to === 'Done' && <Icon name="check" size={15} />} {busy ? t('Saving…') : label}
      </button>
    </>
  );
  const title = t('Task {n} · {title}', { n: task.seq, title: task.title });
  if (mobile) {
    return (
      <BottomSheet title={title} onClose={onClose} withClose footer={<div className="st-foot ts-foot">{footer}</div>} testid="task-status-sheet">
        <p className="ts-who">{who}</p>
        {body}
      </BottomSheet>
    );
  }
  return (
    <ShellModal icon="sync" title={t('Change status · task {n}', { n: task.seq })} subtitle={`${task.title}${who ? ` · ${who}` : ''}`} onClose={onClose} footer={footer} width={560} testid="task-status-modal">
      {body}
    </ShellModal>
  );
}
