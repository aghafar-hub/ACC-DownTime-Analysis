// Small pieces of the Actions screens: status, priority, source, due and effectiveness tags, the person avatar and the
// board card. Every state is a word plus a symbol, never colour alone.
import type { DragEvent } from 'react';
import {
  actionProgress, isTerminalStatus,
  type Action, type ActionPerson, type ActionPriority, type ActionStatus, type ActionTask, type Contractor, type TaskStatus,
} from '../api/types';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { dayText } from '../util/dates';
import { contractorName, dueInfo, initials, isAutoSource, newEvidence, personName, PRIORITY_SYMBOL, SOURCE_LABEL, statusKey, watchDaysLeft } from './model';
import { nextTask, openOwners, taskDueInfo, TASK_STATUS_ICON, tasksOfAction } from './tasks';
import './tasks.css';

export function StatusDot({ status }: { status: ActionStatus | string }) {
  return <span className={`act-dot act-dot--${statusKey(status)}`} aria-hidden="true" />;
}

export function StatusChip({ status, testid = 'action-status' }: { status: ActionStatus; testid?: string }) {
  return (
    <span className={`act-status act-status--${statusKey(status)}`} data-testid={testid} data-status={status}>
      <StatusDot status={status} />{t(status)}
    </span>
  );
}

export function PriorityTag({ priority }: { priority: ActionPriority }) {
  return (
    <span className={`act-pri act-pri--${priority.toLowerCase()}`} data-testid="action-priority">
      <span aria-hidden="true">{PRIORITY_SYMBOL[priority]}</span> {priority === 'Medium' ? t('Med') : t(priority)}
      <span className="sr-only"> {t('priority')}</span>
    </span>
  );
}

export function SourceTag({ action }: { action: Pick<Action, 'source'> }) {
  const auto = isAutoSource(action.source);
  return (
    <span className={auto ? 'act-tag act-tag--auto' : 'act-tag'} data-testid="action-source">
      <Icon name={auto ? 'sync' : action.source === 'manual' ? 'edit' : action.source === 'report' ? 'registry' : action.source === 'pareto' ? 'limits' : action.source === 'event' ? 'list' : 'bell'} size={13} />
      {t(SOURCE_LABEL[action.source])}
    </span>
  );
}

export function DueTag({ action, today }: { action: Pick<Action, 'status' | 'due_date' | 'due_date_derived'>; today: string }) {
  const d = dueInfo(action, today);
  return (
    <span className={`act-due act-due--${d.tone}`} data-testid="action-due" data-tone={d.tone}>
      <Icon name={d.tone === 'overdue' ? 'alert' : 'calendar'} size={13} />{d.text}
    </span>
  );
}

/** Watching / Effective / Not effective after closing (nothing for other actions). */
export function EffectBadge({ action, today, effectDays }: { action: Pick<Action, 'status' | 'effectiveness' | 'closed_at'>; today: string; effectDays: number }) {
  const e = action.effectiveness;
  if (!e) return null;
  if (e === 'Watching') {
    const left = watchDaysLeft(action, today, effectDays);
    return <span className="act-eff act-eff--watching" data-testid="action-effect" data-effect={e}><Icon name="clock" size={13} />{left === null ? t('Watching') : t('Watching · {n} days left', { n: left })}</span>;
  }
  if (e === 'Effective') return <span className="act-eff act-eff--effective" data-testid="action-effect" data-effect={e}><Icon name="check" size={13} />{t('Effective')}</span>;
  return <span className="act-eff act-eff--not" data-testid="action-effect" data-effect={e}><Icon name="ban" size={13} />{t('Not effective · failure returned')}</span>;
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return <span className={`act-avatar act-avatar--${size}`} aria-hidden="true">{initials(name)}</span>;
}

/** The mark on an action whose area is switched off: the action stays, its area's records are left out of the numbers. */
export function InactiveAreaTag() {
  return (
    <span className="act-tag act-tag--inactive" data-testid="action-area-inactive"
      title={t('This area is switched off (Settings > Areas): its records are left out of every number, and no new drafts are made for it.')}>
      <Icon name="ban" size={13} />{t('Area inactive')}
    </span>
  );
}

/** 'K.2 · L.2' or 'Plant'. */
export function scopeText(a: Pick<Action, 'scope_kind' | 'area_id' | 'line_id'>): string {
  if (a.scope_kind === 'plant') return t('Plant');
  return [a.area_id, a.line_id].filter(Boolean).join(' · ') || t('Plant');
}

/** The headline of a card: the equipment (or area / line) in bold, then the title. */
export function cardHead(a: Action): { code: string; text: string } {
  if (a.scope_kind === 'equipment' && a.equipment_id) return { code: a.equipment_id, text: a.title.startsWith(a.equipment_id) ? a.title.slice(a.equipment_id.length).replace(/^[\s·:–-]+/, '') : a.title };
  if (a.scope_kind === 'area' && a.area_id) return { code: t('Area {a}', { a: a.area_id }), text: a.title };
  if (a.scope_kind === 'line' && a.line_id) return { code: t('Line {l}', { l: a.line_id }), text: a.title };
  return { code: '', text: a.title };
}

export interface CardEnv {
  today: string;
  /** areas switched off (Settings > Areas): their actions stay but are marked */
  inactiveAreas?: ReadonlySet<string>;
  people: readonly ActionPerson[];
  contractors: readonly Contractor[];
  effectDays: number;
  /** backend 1.7.0: every task (the card shows the progress, the next task and who still has open tasks) */
  tasks?: readonly ActionTask[];
}

// ---------------------------------------------------------------- tasks (backend 1.7.0)

/** A task status as a chip: symbol and word (a button with a chevron when it can be changed). */
export function TaskStatusChip({ status, testid = 'task-status' }: { status: TaskStatus; testid?: string }) {
  return (
    <span className={`tk-status tk-status--${statusKey(status)}`} data-testid={testid} data-status={status}>
      <Icon name={TASK_STATUS_ICON[status]} size={13} />{t(status)}
    </span>
  );
}

/** The contractor / team of a task or action: a chip (square mark = external contractor, round = internal team). */
export function OwnerChip({ owner, contractors, testid }: { owner: string; contractors: readonly Contractor[]; testid?: string }) {
  if (!owner) return <span className="tk-owner tk-owner--none" data-testid={testid}>{t('Nobody yet')}</span>;
  const c = contractors.find((x) => x.contractor_id === owner);
  const ext = c?.kind === 'contractor';
  return (
    <span className={ext ? 'tk-owner tk-owner--ext' : 'tk-owner'} data-testid={testid} data-owner={owner} title={ext ? t('External contractor') : t('Internal team')}>
      <span className={ext ? 'tk-owner-mark tk-owner-mark--ext' : 'tk-owner-mark'} aria-hidden="true" />{contractorName(contractors, owner)}
    </span>
  );
}

/** The due date of a task: 'Due 25 Oct', '2 d overdue' (red), 'Done 8 Oct' (green), a crossed-out date for Not needed. */
export function TaskDue({ task, today }: { task: Pick<ActionTask, 'status' | 'due_date' | 'done_at'>; today: string }) {
  const d = taskDueInfo(task, today);
  const icon = d.tone === 'overdue' ? 'alert' : d.tone === 'done' ? 'check' : d.tone === 'notneeded' ? 'ban' : 'calendar';
  const legacy = d.tone === 'overdue' || d.tone === 'soon' ? ` act-due--${d.tone}` : '';
  return <span className={`act-due${legacy} tk-due tk-due--${d.tone}`} data-testid="task-due" data-tone={d.tone}><Icon name={icon} size={13} />{d.text}</span>;
}

/** Estimated stop hours of a task that needs a stop ('–' otherwise); no estimate shows 'stop'. */
export function StopTag({ task }: { task: Pick<ActionTask, 'needs_stop' | 'est_stop_h'> }) {
  if (!task.needs_stop) return <span className="muted" aria-label={t('No stop needed')}>–</span>;
  return <span className="tk-stop" data-testid="task-stop"><Icon name="clock" size={13} />{task.est_stop_h !== null ? `${task.est_stop_h.toFixed(1)} h` : t('stop')}</span>;
}

/** The progress bar of an action's tasks: one segment per task in its status colour, then "2 / 5 tasks done". */
export function TaskProgress({ actionId, tasks, today, label = true, testid = 'task-progress' }: {
  actionId: string; tasks: readonly ActionTask[]; today: string; label?: boolean; testid?: string;
}) {
  const mine = tasksOfAction(actionId, tasks);
  const p = actionProgress({ action_id: actionId }, mine, today);
  if (!p.total) return null;
  return (
    <span className="tk-prog" data-testid={testid} data-done={p.done} data-total={p.total}>
      <span className="tk-prog-bar" role="img" aria-label={t('{d} of {n} tasks done or not needed', { d: p.done, n: p.total })}>
        {mine.map((x) => <span key={x.task_id} className={`tk-seg act-fill--${statusKey(x.status)}`} />)}
      </span>
      {label && <span className="tk-prog-text"><b>{p.done} / {p.total}</b> {t('tasks done')}</span>}
    </span>
  );
}

/** One action on the board or in the phone list: id, priority, headline, scope and contractor, source, who and when. */
export function ActionCard({ action: a, env, onOpen, draggable, onDragStart, compact }: {
  action: Action; env: CardEnv; onOpen: (id: string) => void; draggable?: boolean; onDragStart?: (e: DragEvent, a: Action) => void; compact?: boolean;
}) {
  const head = cardHead(a);
  const person = personName(env.people, a.assignee);
  const fresh = newEvidence(a);
  const due = dueInfo(a, env.today);
  const terminal = isTerminalStatus(a.status);
  const tasks = env.tasks ?? [];
  const mine = tasksOfAction(a.action_id, tasks);
  const p = actionProgress(a, mine, env.today);
  const next = !terminal ? nextTask(a.action_id, mine) : null;
  const owners = !terminal && a.status !== 'Draft' ? openOwners(a.action_id, mine) : [];
  const ready = a.status !== 'Draft' && !terminal && p.total > 0 && p.open === 0;
  return (
    <article
      className={`act-card act-card--${statusKey(a.status)}${compact ? ' act-card--phone' : ''}`} data-testid="action-card" data-id={a.action_id} data-status={a.status}
      data-tasks={p.total || undefined} data-ready={ready || undefined}
      draggable={draggable} onDragStart={draggable && onDragStart ? (e) => onDragStart(e, a) : undefined}
    >
      <button type="button" className="act-card-btn" onClick={() => onOpen(a.action_id)} aria-label={t('Open action {id}: {title}', { id: a.action_id, title: a.title })} data-testid="action-open">
        <span className="act-card-top">
          <span className="act-card-id mono">{a.action_id}</span>
          <PriorityTag priority={a.priority} />
          {compact && (due.tone === 'overdue' || (!terminal && !!(a.due_date_derived ?? a.due_date))) && <span className="act-card-topdue"><DueTag action={a} today={env.today} /></span>}
        </span>
        <span className="act-card-title">{head.code && <b>{head.code}</b>} {head.text}</span>
        <span className="act-card-tags">
          <span className="act-tag">{scopeText(a)}</span>
          {a.area_id && env.inactiveAreas?.has(a.area_id) && <InactiveAreaTag />}
          {a.owner && <span className="act-tag"><Icon name="database" size={13} />{contractorName(env.contractors, a.owner)}</span>}
          <SourceTag action={a} />
        </span>
        {a.status === 'Draft' && p.total > 0 && (
          <span className="act-card-tpl" data-testid="card-template"><Icon name="list" size={13} />{t('{n} tasks proposed', { n: p.total })}</span>
        )}
        {a.status !== 'Draft' && p.total > 0 && <TaskProgress actionId={a.action_id} tasks={mine} today={env.today} />}
        {next && a.status !== 'Draft' && (
          <span className="act-card-next" data-testid="card-next-task">
            <small>{t('Next task')}</small>
            <span className="act-card-next-title">{next.title}</span>
            <span className="act-card-next-meta"><OwnerChip owner={next.owner} contractors={env.contractors} />{next.due_date && <TaskDue task={next} today={env.today} />}</span>
          </span>
        )}
        {ready && <span className="act-card-ready" data-testid="card-ready"><Icon name="check" size={13} />{t('All tasks done — ready to close')}</span>}
        {owners.length > 0 && !compact && (
          <span className="act-card-owners" data-testid="card-open-owners"><small>{t('Open tasks with')}</small>{owners.map((o) => <OwnerChip key={o || '-'} owner={o} contractors={env.contractors} />)}</span>
        )}
        {fresh > 0 && !terminal && <span className="act-card-new" data-testid="action-new-evidence"><Icon name="trend" size={13} />{fresh === 1 ? t('+1 new failure since opened') : t('+{n} new failures since opened', { n: fresh })}</span>}
        {a.status === 'Closed' && <EffectBadge action={a} today={env.today} effectDays={env.effectDays} />}
        <span className="act-card-foot">
          {person ? <span className="act-card-who"><Avatar name={person} size="sm" />{person}</span> : <span className="act-card-who act-card-who--none"><Icon name="users" size={13} />{t('No owner')}</span>}
          {terminal
            ? <span className="act-due act-due--closed"><Icon name="check" size={13} />{a.status === 'Closed' ? t('Closed {d}', { d: dayText(a.closed_at) }) : t('Cancelled {d}', { d: dayText(a.closed_at) })}</span>
            : !compact && (p.total === 0 || a.status === 'Draft') && <DueTag action={a} today={env.today} />}
          {!terminal && p.needsStop > 0
            ? <span className="act-stop" data-testid="card-stop"><Icon name="clock" size={13} />{p.needsStop === 1 ? t('1 needs stop') : t('{n} need stop', { n: p.needsStop })}{p.stopHours > 0 ? ` · ${p.stopHours} h` : ''}</span>
            : a.needs_stop && !terminal && p.total === 0 && <span className="act-stop"><Icon name="clock" size={13} />{t('Needs stop')}</span>}
          {compact && <Icon name="chevronRight" size={18} />}
        </span>
      </button>
    </article>
  );
}
