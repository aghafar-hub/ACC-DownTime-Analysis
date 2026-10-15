// The Tasks section of an action (docs/actions-mockups/tasks/02-action-detail-tasks.png, 03, 11): the main content of the
// action. Desktop: a table, one row per task (status, task, owner and person, due, stop hours) that opens to its notes, its
// own history and the buttons Change status, Edit task and Open in Shutdown list. Phone: one card per task. Add task and
// Apply template are in the header. Tasks are never deleted; a closed or cancelled action only takes notes.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { actionProgress, isTaskOpen, isTerminalStatus, type Action, type ActionLog, type ActionTask, type TaskStatus } from '../api/types';
import PopMenu, { MenuItem } from '../components/PopMenu';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { dayText, tsText } from '../util/dates';
import { useActions } from './ActionsContext';
import { personName, statusKey } from './model';
import { OwnerChip, StopTag, TaskDue, TaskProgress, TaskStatusChip } from './parts';
import TaskDialog from './TaskDialog';
import TaskStatusDialog from './TaskStatusDialog';
import { taskDueInfo, taskLogs, tasksOfAction, templateLine } from './tasks';

const FIELD: Record<string, string> = {
  due_date: 'Due date', owner: 'Owner', assignee: 'Person', needs_stop: 'Needs stoppage', est_stop_h: 'Est. stop hours', title: 'Title', notes: 'Notes',
};
/** '#3 due_date: 2026-10-17 -> 2026-10-25; title changed' as 'Due date 17 Oct → 25 Oct · Title changed'. */
export function taskEditText(text: string): string {
  return text.replace(/^#\d+\s*/, '').split('; ').map((part) => {
    const m = /^([a-z_]+)(?:: (.*) -> (.*)| changed)$/.exec(part);
    if (!m) return part;
    const name = t(FIELD[m[1]!] ?? m[1]!.replace(/_/g, ' '));
    if (m[2] === undefined) return t('{f} changed', { f: name });
    const v = (x: string) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? dayText(x) : x === '(blank)' ? '–' : x);
    return `${name} ${v(m[2])} → ${v(m[3]!)}`;
  }).join(' · ');
}

/** One history line of a task: the head in bold and the rest. */
export function taskLogText(l: ActionLog, people: Parameters<typeof personName>[0]): { head: string; body: string } {
  const who = personName(people, l.by);
  switch (l.kind) {
    case 'task_create': return { head: t('Created'), body: who };
    case 'task_status': return { head: t(l.to_status), body: l.text ? `${who} · “${l.text}”` : who };
    case 'task_edit': return { head: taskEditText(l.text), body: who };
    default: return { head: t('Note'), body: `${who} · “${l.text}”` };
  }
}

export default function TasksSection({ action: a, tasks: all, logs, today, focusTask }: {
  action: Action; tasks: readonly ActionTask[]; logs: readonly ActionLog[]; today: string; focusTask?: string | null;
}) {
  const acts = useActions();
  const mobile = useIsMobile();
  const payload = acts.payload;
  const people = payload?.people ?? [];
  const contractors = useMemo(() => payload?.contractors ?? [], [payload]);
  const templates = (payload?.templates ?? []).filter((x) => x.active).sort((x, y) => x.sort_order - y.sort_order);
  const tasks = useMemo(() => tasksOfAction(a.action_id, all), [a.action_id, all]);
  const p = actionProgress(a, tasks, today);
  const terminal = isTerminalStatus(a.status);
  const canWork = acts.canEdit && !terminal;
  const blocked = !!acts.blockedReason;
  const [open, setOpen] = useState<Set<string>>(() => new Set(focusTask ? [focusTask] : []));
  const [statusFor, setStatusFor] = useState<{ task: ActionTask; to?: TaskStatus } | null>(null);
  const [edit, setEdit] = useState<ActionTask | 'new' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // a link to one task (a notification, the Tasks list) opens it and brings it into view
  useEffect(() => {
    if (!focusTask) return;
    setOpen((cur) => new Set([...cur, focusTask]));
    const id = window.setTimeout(() => document.querySelector(`[data-task-id="${focusTask}"]`)?.scrollIntoView({ block: 'center' }), 60);
    return () => window.clearTimeout(id);
  }, [focusTask]);

  const toggle = (id: string) => setOpen((cur) => {
    const n = new Set(cur);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const addNote = async (x: ActionTask) => {
    const text = (notes[x.task_id] ?? '').trim();
    if (!text) return;
    setBusy(true);
    const r = await acts.updateTask(x.task_id, { note: text });
    setBusy(false);
    if (r.ok) {
      setNotes((cur) => ({ ...cur, [x.task_id]: '' }));
      setMsg({ ok: true, text: t('Note added to task {n}.', { n: x.seq }) });
    } else setMsg({ ok: false, text: r.error });
  };
  const apply = async (templateId: string, name: string) => {
    setBusy(true);
    const r = await acts.applyTemplate(a.action_id, templateId);
    setBusy(false);
    if (!r.ok) setMsg({ ok: false, text: r.error });
    else setMsg({ ok: true, text: r.value.added ? t('{n} tasks added from {t}.', { n: r.value.added, t: name }) : t('Every task of {t} is already in this action.', { t: name }) });
  };

  const overdue = p.overdue;
  const stopText = p.needsStop > 0
    ? (p.needsStop === 1 ? t('1 task needs a stop of {a}', { a: a.area_id || t('the plant') }) : t('{n} tasks need a stop of {a}', { n: p.needsStop, a: a.area_id || t('the plant') })) + (p.stopHours ? ` · ${p.stopHours.toFixed(1)} h` : '')
    : '';

  const statusBtn = (x: ActionTask) => (canWork && !blocked
    ? <button type="button" className={`tk-status-btn tk-status--${statusKey(x.status)}`} onClick={() => setStatusFor({ task: x })} aria-label={t('Change the status of task {n}: {s}', { n: x.seq, s: t(x.status) })} data-testid="task-status-btn" data-status={x.status}>
      <TaskStatusChip status={x.status} testid="task-status" /><Icon name="chevronDown" size={13} />
    </button>
    : <TaskStatusChip status={x.status} />);

  const details = (x: ActionTask) => {
    const hist = taskLogs(x.task_id, logs);
    return (
      <div className="tk-detail" data-testid="task-detail">
        <div className="tk-detail-notes">
          <h4 className="tk-h4"><Icon name="mail" size={14} /> {t('Notes')}</h4>
          {x.notes ? <p className="tk-notes" data-testid="task-notes-text">{x.notes}</p> : <p className="muted tk-notes-empty">{t('No notes yet.')}</p>}
          {x.done_note && <p className="tk-done-note" data-testid="task-done-note"><b>{x.status === 'Not needed' ? t('Why not needed') : t('What was done')}</b> · {x.done_note}<br /><small className="muted">{personName(people, x.done_by)} · {tsText(x.done_at)}</small></p>}
          {acts.canEdit && (
            <div className="tk-note-add">
              <input className="input" value={notes[x.task_id] ?? ''} onChange={(e) => setNotes((cur) => ({ ...cur, [x.task_id]: e.target.value }))} placeholder={t('Add a note to this task…')}
                aria-label={t('Add a note to task {n}', { n: x.seq })} maxLength={1000} disabled={blocked} data-testid="task-note-input"
                onKeyDown={(e) => { if (e.key === 'Enter') void addNote(x); }} />
              <button type="button" className="btn btn-sm" onClick={() => void addNote(x)} disabled={busy || blocked || !(notes[x.task_id] ?? '').trim()} data-testid="task-note-add">{t('Add note')}</button>
            </div>
          )}
          <p className="tk-meta">
            <span>{t('Needs stoppage')} <b>{x.needs_stop ? t('Yes') : t('No')}</b>{x.needs_stop && a.area_id ? ` · ${a.area_id}` : ''}</span>
            {x.needs_stop && <span>{t('Est. stop')} <b>{x.est_stop_h !== null ? `${x.est_stop_h.toFixed(1)} h` : t('not estimated')}</b></span>}
            <span>{x.template_step ? <>{t('Created from template')} · <b>{x.template_step}</b></> : t('Added by hand')}</span>
          </p>
          <div className="tk-detail-btns">
            {canWork && <button type="button" className="btn btn-sm" onClick={() => setStatusFor({ task: x })} disabled={blocked} data-testid="task-change-status"><Icon name="sync" size={14} /> {t('Change status')}</button>}
            {canWork && <button type="button" className="btn btn-sm" onClick={() => setEdit(x)} disabled={blocked} data-testid="task-edit"><Icon name="edit" size={14} /> {t('Edit task')}</button>}
            {x.needs_stop && isTaskOpen(x) && <Link className="btn btn-sm" to={`/actions/shutdown${a.area_id ? `?area=${encodeURIComponent(a.area_id)}` : ''}`} data-testid="task-open-shutdown"><Icon name="clock" size={14} /> {t('Open in Shutdown list')}</Link>}
          </div>
        </div>
        <div className="tk-detail-hist">
          <h4 className="tk-h4"><Icon name="history" size={14} /> {t('Task history')}</h4>
          <ol className="ad-history" data-testid="task-history">
            {hist.map((l) => {
              const x2 = taskLogText(l, people);
              return (
                <li key={l.log_id} className="ad-hist" data-testid="task-history-row" data-kind={l.kind}>
                  <span className={`ad-hist-dot act-dot--${statusKey(l.kind === 'task_status' ? l.to_status : l.kind === 'task_create' ? 'open' : 'edit')}`} aria-hidden="true" />
                  <span><b>{x2.head}</b> <span className="muted">· {x2.body}</span><br /><small className="muted">{tsText(l.at)}</small></span>
                </li>
              );
            })}
            {hist.length === 0 && <li className="muted">{t('No history yet.')}</li>}
          </ol>
        </div>
      </div>
    );
  };

  const head = (
    <header className="tk-head">
      <h3 className="tk-title"><Icon name="list" size={18} /> {t('Tasks')}</h3>
      {p.total > 0 && <TaskProgress actionId={a.action_id} tasks={tasks} today={today} testid="detail-progress" />}
      {overdue > 0 && <span className="tk-pill tk-pill--danger" data-testid="tasks-overdue"><Icon name="alert" size={13} />{t('{n} overdue', { n: overdue })}</span>}
      {p.total > 0 && p.open === 0 && <span className="tk-pill tk-pill--ok" data-testid="tasks-all-done"><Icon name="check" size={13} />{t('All tasks done')}</span>}
      {stopText && !mobile && <span className="tk-pill tk-pill--warn" data-testid="tasks-stop"><Icon name="clock" size={13} />{stopText}</span>}
      {canWork && (
        <span className="tk-head-btns">
          {!mobile && templates.length > 0 && (
            <PopMenu label={t('Apply template')} icon="list" testid="apply-template" disabled={blocked || busy} buttonClass="btn">
              {(close) => templates.map((tpl) => (
                <MenuItem key={tpl.template_id} sub={templateLine(tpl)} onClick={() => { close(); void apply(tpl.template_id, tpl.name); }} testid={`apply-template-${tpl.template_id}`}>{tpl.name}</MenuItem>
              ))}
            </PopMenu>
          )}
          <button type="button" className="btn-primary act-blue" onClick={() => setEdit('new')} disabled={blocked} data-testid="task-add"><Icon name="plus" size={15} /> {mobile ? t('Add') : t('Add task')}</button>
        </span>
      )}
    </header>
  );

  const empty = tasks.length === 0 && (
    <p className="muted tk-empty" data-testid="tasks-empty">{canWork ? t('No tasks yet. Add the work as tasks, or apply a template.') : t('This action has no tasks.')}</p>
  );

  const list = mobile ? (
    <ul className="tk-cards" data-testid="task-list">
      {tasks.map((x) => {
        const d = taskDueInfo(x, today);
        const isOpen = open.has(x.task_id);
        return (
          <li key={x.task_id} className={`tk-card tk-card--${statusKey(x.status)}${d.tone === 'overdue' ? ' tk-card--overdue' : ''}`} data-testid="task-row" data-task-id={x.task_id} data-status={x.status}>
            <div className="tk-card-top">{statusBtn(x)}<TaskDue task={x} today={today} /></div>
            <button type="button" className="tk-card-main" onClick={() => toggle(x.task_id)} aria-expanded={isOpen} data-testid="task-toggle">
              <span className={x.status === 'Not needed' ? 'tk-card-title tk-struck' : 'tk-card-title'}>{x.title}</span>
              <span className="tk-card-who"><OwnerChip owner={x.owner} contractors={contractors} /><span>{personName(people, x.assignee)}</span>{x.needs_stop && <StopTag task={x} />}</span>
            </button>
            {isOpen && details(x)}
          </li>
        );
      })}
    </ul>
  ) : (
    <div className="tk-table-wrap">
      <table className="data-table tk-table" data-testid="task-list">
        <thead>
          <tr><th scope="col" className="num">#</th><th scope="col">{t('Status')}</th><th scope="col">{t('Task')}</th><th scope="col">{t('Owner')}</th><th scope="col">{t('Due')}</th><th scope="col">{t('Stop')}</th><th scope="col"><span className="sr-only">{t('Open')}</span></th></tr>
        </thead>
        <tbody>
          {tasks.map((x) => {
            const isOpen = open.has(x.task_id);
            return (
              <Fragment key={x.task_id}>
                <tr className={isOpen ? 'tk-row tk-row--open' : 'tk-row'} data-testid="task-row" data-task-id={x.task_id} data-status={x.status}>
                  <td className="num tk-seq">{x.seq}</td>
                  <td>{statusBtn(x)}</td>
                  <td className="tk-task">
                    <b className={x.status === 'Not needed' ? 'tk-struck' : undefined}>{x.title}</b>
                    <small className="muted">
                      {x.template_step && x.template_step !== x.title && <><Icon name="list" size={12} /> {x.template_step}{(x.done_note || x.notes) ? ' · ' : ''}</>}
                      {(x.done_note || x.notes) && <>{x.done_note || x.notes}</>}
                      {!x.template_step && !x.done_note && !x.notes && t('Added by {w} on {d}', { w: personName(people, x.created_by), d: dayText(x.created_at) })}
                      {x.template_step && x.template_step === x.title && !x.done_note && !x.notes && <><Icon name="list" size={12} /> {t('from the template')}</>}
                    </small>
                  </td>
                  <td><span className="tk-who"><OwnerChip owner={x.owner} contractors={contractors} /><span>{personName(people, x.assignee)}</span></span></td>
                  <td><TaskDue task={x} today={today} /></td>
                  <td><StopTag task={x} /></td>
                  <td>
                    <button type="button" className="ad-icon-btn tk-expand" onClick={() => toggle(x.task_id)} aria-expanded={isOpen} aria-label={isOpen ? t('Close task {n}', { n: x.seq }) : t('Open task {n}', { n: x.seq })} data-testid="task-toggle">
                      <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={16} />
                    </button>
                  </td>
                </tr>
                {isOpen && <tr className="tk-row-detail"><td colSpan={7}>{details(x)}</td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="ad-sec tk-sec" data-testid="action-tasks" aria-label={t('Tasks')}>
      {head}
      <p className="sr-only" role="status" aria-live="polite">{msg?.text ?? ''}</p>
      {msg && !msg.ok && <div className="callout callout--danger" role="alert" data-testid="tasks-error"><Icon name="alert" size={16} /><span>{msg.text}</span></div>}
      {msg && msg.ok && <p className="ad-saved" data-testid="tasks-saved"><Icon name="check" size={14} /> {msg.text}</p>}
      {mobile && stopText && <p className="tk-pill tk-pill--warn tk-pill--block" data-testid="tasks-stop"><Icon name="clock" size={13} />{stopText}</p>}
      {empty || list}
      <p className="tk-foot"><Icon name="info" size={14} /><span>{t('Tasks are never deleted — set')} <b>{t('Not needed')}</b> {t('instead. The action can be closed only when every task is Done or Not needed.')}</span></p>
      {statusFor && (
        <TaskStatusDialog task={statusFor.task} action={a} contractors={contractors} people={people} today={today} initial={statusFor.to}
          onClose={() => setStatusFor(null)} onDone={(text) => { setStatusFor(null); setMsg({ ok: true, text }); }} />
      )}
      {edit && (
        <TaskDialog action={a} task={edit === 'new' ? undefined : edit} today={today} onClose={() => setEdit(null)} onDone={(text) => { setEdit(null); setMsg({ ok: true, text }); }} />
      )}
    </section>
  );
}
