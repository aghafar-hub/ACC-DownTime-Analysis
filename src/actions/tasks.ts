// Tasks inside actions (backend 1.7.0, docs/actions-mockups/tasks/, docs/wire-protocol.md section 13): the pure helpers of
// the task screens. The task list of every action across the plant (the Tasks tab), the Shutdown list (open tasks that need
// the area stopped, grouped by area), the board card's "next task" and "open tasks with", the summary figures, the task
// status choices with their rules, template steps resolved for one action, and the Excel tables. No React; the day is passed in.
import {
  AREA_CONTRACTOR, contractorForArea, isTaskOpen, isTerminalStatus, TASK_NOTE_MIN, TASK_STATUSES,
  type Action, type ActionLog, type ActionPerson, type ActionSource, type ActionTask, type Contractor, type NewTask,
  type TaskStatus, type TaskTemplate, type TaskTemplateInput, type TaskView,
} from '../api/types';
import { addDays } from '../calc';
import { exportCol, type ExportTable } from '../export/table';
import { t } from '../i18n/t';
import { dayText } from '../util/dates';
import { contractorName, daysFrom, personName } from './model';

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const r1 = (n: number): number => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- statuses

/** One line under each status in the status chooser (docs/actions-mockups/tasks/05-task-status-change.png). */
export const TASK_STATUS_HELP: Record<TaskStatus, string> = {
  Open: 'Not started yet',
  'Contractor informed': 'The contractor knows about it',
  'Waiting stoppage': 'Needs the area stopped · goes to the Shutdown list',
  'In progress': 'Work started',
  Done: 'Needs a short note: what was done',
  'Not needed': 'Needs a reason · the task stays in the list, crossed out',
};
/** The symbol of each task status (a word plus a symbol, never colour alone). */
export const TASK_STATUS_ICON: Record<TaskStatus, string> = {
  Open: 'target', 'Contractor informed': 'send', 'Waiting stoppage': 'clock', 'In progress': 'sync', Done: 'check', 'Not needed': 'ban',
};

export interface TaskStatusOption { status: TaskStatus; allowed: boolean; current: boolean; note: string }

/** Every task status with whether it may be chosen: Contractor informed only for an external contractor's task. */
export function taskStatusOptions(task: Pick<ActionTask, 'status' | 'owner_kind'>): TaskStatusOption[] {
  return TASK_STATUSES.map((s) => {
    const current = s === task.status;
    if (s === 'Contractor informed' && task.owner_kind !== 'contractor') {
      return { status: s, allowed: false, current, note: t('Only for RHI / ASEC tasks — this task is owned by a team') };
    }
    return { status: s, allowed: !current, current, note: t(TASK_STATUS_HELP[s]) };
  });
}

/** Done and Not needed need a note of at least TASK_NOTE_MIN characters. */
export const taskNeedsNote = (s: TaskStatus): boolean => s === 'Done' || s === 'Not needed';
/** The label over the note box for a status change. */
export const taskNoteLabel = (s: TaskStatus): string =>
  s === 'Done' ? t('What was done?') : s === 'Not needed' ? t('Why is it not needed?') : t('Note (optional)');
/** The problem with the note, or null (the same rule as the server, in the app's words). */
export function taskNoteProblem(s: TaskStatus, note: string): string | null {
  if (!taskNeedsNote(s) || note.trim().length >= TASK_NOTE_MIN) return null;
  return s === 'Done' ? t('Write what was done (at least {n} characters).', { n: TASK_NOTE_MIN }) : t('Write why the task is not needed (at least {n} characters).', { n: TASK_NOTE_MIN });
}

// ---------------------------------------------------------------- one task

export type TaskDueTone = 'none' | 'ok' | 'soon' | 'overdue' | 'done' | 'notneeded';
/** 'Due 25 Oct', '2 d overdue', 'Done 8 Oct', a crossed-out '22 Oct' for Not needed. */
export function taskDueInfo(task: Pick<ActionTask, 'status' | 'due_date' | 'done_at'>, today: string): { text: string; tone: TaskDueTone; days: number } {
  if (task.status === 'Done') return { text: t('Done {d}', { d: dayText(task.done_at || task.due_date) }), tone: 'done', days: 0 };
  if (task.status === 'Not needed') return { text: task.done_at || task.due_date ? dayText(task.done_at || task.due_date) : t('Not needed'), tone: 'notneeded', days: 0 };
  if (!task.due_date) return { text: t('No due date'), tone: 'none', days: 0 };
  const days = daysFrom(today, task.due_date);
  if (days < 0) return { text: t('{n} d overdue', { n: -days }), tone: 'overdue', days };
  if (days === 0) return { text: t('Due today'), tone: 'soon', days };
  return { text: t('Due {d}', { d: dayText(task.due_date) }), tone: days <= 3 ? 'soon' : 'ok', days };
}

/** The action title without the equipment code it starts with ('131.BC100 - Inlet seal worn' -> 'Inlet seal worn'). */
export const titleWithoutCode = (v: Pick<TaskView, 'action_title' | 'equipment_id'>): string =>
  v.equipment_id && v.action_title.startsWith(v.equipment_id) ? v.action_title.slice(v.equipment_id.length).replace(/^[\s·:–-]+/, '') : v.action_title;

export const isTaskOverdue = (task: Pick<ActionTask, 'status' | 'due_date'>, today: string): boolean =>
  isTaskOpen(task) && !!task.due_date && task.due_date < today;

/** The tasks of one action, by seq. */
export function tasksOfAction(actionId: string, tasks: readonly ActionTask[]): ActionTask[] {
  return tasks.filter((x) => x.action_id === actionId).sort((a, b) => a.seq - b.seq || byText(a.task_id, b.task_id));
}

/** The task to do next: the open task due first (no date last), then the lowest number. */
export function nextTask(actionId: string, tasks: readonly ActionTask[]): ActionTask | null {
  const open = tasksOfAction(actionId, tasks).filter(isTaskOpen);
  open.sort((a, b) => (!a.due_date !== !b.due_date ? (a.due_date ? -1 : 1) : byText(a.due_date, b.due_date)) || a.seq - b.seq);
  return open[0] ?? null;
}

/** The contractors / teams that still have open tasks in the action, in task order ('' = nobody yet). */
export function openOwners(actionId: string, tasks: readonly ActionTask[]): string[] {
  return [...new Set(tasksOfAction(actionId, tasks).filter(isTaskOpen).map((x) => x.owner))];
}

/** The history rows of one task, newest first. */
export const taskLogs = (taskId: string, logs: readonly ActionLog[]): ActionLog[] =>
  logs.filter((l) => l.task_id === taskId).slice().sort((a, b) => byText(b.at, a.at) || byText(b.log_id, a.log_id));

/** When the task last moved to Waiting stoppage ('' when it is not waiting); the task's last change when the log has no row. */
export function waitingSince(task: Pick<ActionTask, 'task_id' | 'status' | 'updated_at'>, logs: readonly ActionLog[]): string {
  if (task.status !== 'Waiting stoppage') return '';
  let at = '';
  for (const l of logs) if (l.task_id === task.task_id && l.kind === 'task_status' && l.to_status === 'Waiting stoppage' && l.at > at) at = l.at;
  return at || task.updated_at;
}

// ---------------------------------------------------------------- every task (the Tasks tab, the Shutdown list)

/**
 * The tasks with what the lists show of their action (the same rows as listTasks with status 'all'): tasks of Draft and
 * Cancelled actions are left out. Overdue first, then by due date (no date last), action and number.
 */
export function buildTaskViews(actions: readonly Action[], tasks: readonly ActionTask[], logs: readonly ActionLog[], today: string): TaskView[] {
  const byId = new Map(actions.map((a) => [a.action_id, a]));
  const out: TaskView[] = [];
  for (const x of tasks) {
    const a = byId.get(x.action_id);
    if (!a || a.status === 'Draft' || a.status === 'Cancelled') continue;
    out.push({
      ...x, action_title: a.title, action_status: a.status, action_assignee: a.assignee, action_owner: a.owner, area_id: a.area_id, line_id: a.line_id,
      equipment_id: a.equipment_id, overdue: isTaskOverdue(x, today), waiting_since: waitingSince(x, logs),
    });
  }
  return sortTaskViews(out, 'due', 'asc');
}

export type TaskQuick = 'mine' | 'open' | 'overdue' | 'stop' | 'done';
export const TASK_QUICKS: TaskQuick[] = ['mine', 'open', 'overdue', 'stop', 'done'];
export const TASK_QUICK_LABEL: Record<TaskQuick, string> = { mine: 'My tasks', open: 'All open', overdue: 'Overdue', stop: 'Needs stoppage', done: 'Done · 90 d' };
export type TaskSortKey = 'task' | 'action' | 'area' | 'owner' | 'status' | 'due' | 'stop';
export const TASK_SORT_KEYS: TaskSortKey[] = ['task', 'action', 'area', 'owner', 'status', 'due', 'stop'];

export interface TaskListFilters {
  quick: TaskQuick;
  q: string;
  /** contractor / team id; '-' = nobody yet */
  owner: string;
  /** person; '-' = nobody */
  person: string;
  /** '' = what the quick filter says, else one task status */
  status: TaskStatus | '';
  area: string;
  line: string;
  stop: boolean;
  sort: TaskSortKey;
  dir: 'asc' | 'desc';
}
export const TASK_FILTER_KEYS = ['tq', 'q', 'owner', 'who', 'tst', 'area', 'line', 'stop', 'sort', 'dir'];

export function parseTaskFilters(sp: URLSearchParams): TaskListFilters {
  const quick = (TASK_QUICKS as string[]).includes(sp.get('tq') ?? '') ? (sp.get('tq') as TaskQuick) : 'open';
  const st = sp.get('tst') ?? '';
  const sort = (TASK_SORT_KEYS as string[]).includes(sp.get('sort') ?? '') ? (sp.get('sort') as TaskSortKey) : 'due';
  return {
    quick, q: sp.get('q') ?? '', owner: sp.get('owner') ?? '', person: sp.get('who') ?? '',
    status: (TASK_STATUSES as readonly string[]).includes(st) ? (st as TaskStatus) : '',
    area: sp.get('area') ?? '', line: sp.get('line') ?? '', stop: sp.get('stop') === '1', sort, dir: sp.get('dir') === 'desc' ? 'desc' : 'asc',
  };
}

export function writeTaskFilters(sp: URLSearchParams, f: TaskListFilters): URLSearchParams {
  const out = new URLSearchParams(sp);
  for (const k of TASK_FILTER_KEYS) out.delete(k);
  if (f.quick !== 'open') out.set('tq', f.quick);
  if (f.q.trim()) out.set('q', f.q);
  if (f.owner) out.set('owner', f.owner);
  if (f.person) out.set('who', f.person);
  if (f.status) out.set('tst', f.status);
  if (f.area) out.set('area', f.area);
  if (f.line) out.set('line', f.line);
  if (f.stop) out.set('stop', '1');
  if (f.sort !== 'due') out.set('sort', f.sort);
  if (f.dir !== 'asc') out.set('dir', f.dir);
  return out;
}

export interface TaskEnv { today: string; me: string; people?: readonly ActionPerson[]; contractors?: readonly Contractor[] }

/** Does the quick filter let the task through ('done' = Done or Not needed in the last 90 days). */
export function quickPasses(v: TaskView, quick: TaskQuick, env: Pick<TaskEnv, 'today' | 'me'>): boolean {
  switch (quick) {
    case 'mine': return isTaskOpen(v) && !!env.me && v.assignee === env.me;
    case 'open': return isTaskOpen(v);
    case 'overdue': return v.overdue;
    case 'stop': return isTaskOpen(v) && v.needs_stop;
    case 'done': return !isTaskOpen(v) && (v.done_at || v.updated_at).slice(0, 10) >= addDays(env.today, -90);
    default: return true;
  }
}

export function taskSearchText(v: TaskView, env: Pick<TaskEnv, 'people' | 'contractors'>): string {
  return [
    v.title, v.action_id, v.action_title, v.equipment_id, v.area_id, v.line_id, v.owner, v.notes, v.status,
    env.contractors ? contractorName(env.contractors, v.owner) : '', env.people ? personName(env.people, v.assignee) : v.assignee,
  ].join(' ').toLowerCase();
}

/** Everything but the quick filter (its counts come from this). */
export function filterTasksExceptQuick(list: readonly TaskView[], f: TaskListFilters, env: TaskEnv): TaskView[] {
  const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((v) => {
    if (f.owner && (v.owner || '-') !== f.owner) return false;
    if (f.person && (v.assignee || '-') !== f.person) return false;
    if (f.status && v.status !== f.status) return false;
    if (f.area && v.area_id !== f.area) return false;
    if (f.line && v.line_id !== f.line) return false;
    if (f.stop && !v.needs_stop) return false;
    if (terms.length) {
      const text = taskSearchText(v, env);
      if (!terms.every((w) => text.includes(w))) return false;
    }
    return true;
  });
}

/** The list the Tasks tab shows. A chosen status replaces the quick filter's open / done rule (mine and stop still apply). */
export function filterTasks(list: readonly TaskView[], f: TaskListFilters, env: TaskEnv): TaskView[] {
  return filterTasksExceptQuick(list, f, env).filter((v) => {
    if (!f.status) return quickPasses(v, f.quick, env);
    if (f.quick === 'mine') return !!env.me && v.assignee === env.me;
    if (f.quick === 'stop') return v.needs_stop;
    if (f.quick === 'overdue') return v.overdue;
    return true;
  });
}

const STATUS_RANK = Object.fromEntries(TASK_STATUSES.map((s, i) => [s, i])) as Record<TaskStatus, number>;

/** Sorted copy. Due: overdue first, then the nearest date, no date last (descending reverses it). */
export function sortTaskViews(list: readonly TaskView[], key: TaskSortKey, dir: 'asc' | 'desc', env?: Pick<TaskEnv, 'contractors' | 'people'>): TaskView[] {
  const sign = dir === 'desc' ? -1 : 1;
  const tie = (a: TaskView, b: TaskView) => byText(a.action_id, b.action_id) || a.seq - b.seq || byText(a.task_id, b.task_id);
  const own = (v: TaskView) => `${env?.contractors ? contractorName(env.contractors, v.owner) : v.owner} ${env?.people ? personName(env.people, v.assignee) : v.assignee}`.toLowerCase();
  const due = (a: TaskView, b: TaskView): number => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (!a.due_date !== !b.due_date) return a.due_date ? -1 : 1;
    return byText(a.due_date, b.due_date);
  };
  return [...list].sort((a, b) => {
    let c = 0;
    switch (key) {
      case 'task': c = byText(a.title.toLowerCase(), b.title.toLowerCase()); break;
      case 'action': c = byText(a.action_id, b.action_id) || a.seq - b.seq; break;
      case 'area': c = byText(a.area_id, b.area_id); break;
      case 'owner': c = byText(own(a), own(b)); break;
      case 'status': c = STATUS_RANK[a.status] - STATUS_RANK[b.status]; break;
      case 'stop': c = (a.needs_stop ? a.est_stop_h ?? 0 : -1) - (b.needs_stop ? b.est_stop_h ?? 0 : -1); break;
      default: c = due(a, b);
    }
    return c * sign || (key === 'due' ? 0 : due(a, b)) || tie(a, b);
  });
}

export interface TaskCounts { mine: number; open: number; overdue: number; stop: number; done: number }
export function quickCounts(list: readonly TaskView[], env: Pick<TaskEnv, 'today' | 'me'>): TaskCounts {
  return {
    mine: list.filter((v) => quickPasses(v, 'mine', env)).length, open: list.filter((v) => quickPasses(v, 'open', env)).length,
    overdue: list.filter((v) => v.overdue).length, stop: list.filter((v) => quickPasses(v, 'stop', env)).length,
    done: list.filter((v) => quickPasses(v, 'done', env)).length,
  };
}

// ---------------------------------------------------------------- Shutdown list

export interface ShutdownGroup {
  /** '' = actions about a whole line or the plant */
  area: string; areaName: string; line: string;
  /** the active external contractor of the area ('' = none) */
  contractor: string;
  tasks: TaskView[];
  /** estimated stop hours (tasks without an estimate add nothing) */
  hours: number;
  noEstimate: number;
  /** days the longest-waiting task has waited (Waiting stoppage since, else since it was created) */
  longestDays: number;
  overdue: number;
}

/** Days a stop task has been waiting: since it moved to Waiting stoppage, else since it was created. */
export const waitingDays = (v: Pick<TaskView, 'waiting_since' | 'created_at'>, today: string): number =>
  Math.max(0, daysFrom((v.waiting_since || v.created_at).slice(0, 10), today));

/** The open tasks that need a stop, grouped by area (most estimated hours first); each group by due date. */
export function shutdownGroups(
  views: readonly TaskView[], areas: readonly { area_id: string; name: string; line_id: string }[], contractors: readonly Contractor[], today: string,
): ShutdownGroup[] {
  const map = new Map<string, TaskView[]>();
  for (const v of views) {
    if (!isTaskOpen(v) || !v.needs_stop) continue;
    const list = map.get(v.area_id) ?? [];
    list.push(v);
    map.set(v.area_id, list);
  }
  const out: ShutdownGroup[] = [];
  for (const [area, list] of map) {
    const a = areas.find((x) => x.area_id === area);
    const sorted = sortTaskViews(list, 'due', 'asc');
    out.push({
      area, areaName: a?.name ?? '', line: a?.line_id ?? sorted[0]?.line_id ?? '', contractor: area ? contractorForArea(contractors, area)?.contractor_id ?? '' : '',
      tasks: sorted, hours: r1(list.reduce((s, v) => s + (v.est_stop_h ?? 0), 0)), noEstimate: list.filter((v) => v.est_stop_h === null).length,
      longestDays: Math.max(0, ...list.map((v) => waitingDays(v, today))), overdue: list.filter((v) => v.overdue).length,
    });
  }
  return out.sort((a, b) => b.hours - a.hours || b.tasks.length - a.tasks.length || byText(a.area, b.area));
}

export interface ShutdownTotals {
  tasks: number; actions: number; hours: number; noEstimate: number; areas: number;
  top: ShutdownGroup | null;
  overdue: number; overdueAreas: string[];
  /** open stop tasks per external contractor, and how many internal-team ones */
  byContractor: { owner: string; n: number }[]; internal: number;
}
export function shutdownTotals(groups: readonly ShutdownGroup[], contractors: readonly Contractor[]): ShutdownTotals {
  const all = groups.flatMap((g) => g.tasks);
  const kind = (id: string) => contractors.find((c) => c.contractor_id === id)?.kind ?? 'internal';
  const ext = new Map<string, number>();
  let internal = 0;
  for (const v of all) {
    if (v.owner && kind(v.owner) === 'contractor') ext.set(v.owner, (ext.get(v.owner) ?? 0) + 1);
    else internal++;
  }
  return {
    tasks: all.length, actions: new Set(all.map((v) => v.action_id)).size, hours: r1(groups.reduce((s, g) => s + g.hours, 0)),
    noEstimate: groups.reduce((s, g) => s + g.noEstimate, 0), areas: groups.length, top: groups[0] ?? null,
    overdue: all.filter((v) => v.overdue).length, overdueAreas: groups.filter((g) => g.overdue > 0).map((g) => g.area || t('Plant / line')),
    byContractor: [...ext.entries()].map(([owner, n]) => ({ owner, n })).sort((a, b) => b.n - a.n || byText(a.owner, b.owner)), internal,
  };
}

// ---------------------------------------------------------------- the board and its summary

export interface TaskSummary {
  /** open tasks of the open (accepted) actions */
  open: number;
  byStatus: Record<TaskStatus, number>;
  /** Done or Not needed, in the same actions */
  closed: number;
  openActions: number;
  overdue: number; overdueActions: number;
  /** overdue tasks per owner kind: external contractors by id, and the internal teams together */
  overdueBy: { owner: string; n: number }[];
  ready: number;
  needsStop: number; stopHours: number;
}

/** The figures of the Open tasks, Tasks overdue and Ready to close cards (accepted, open actions only). */
export function taskSummary(actions: readonly Action[], tasks: readonly ActionTask[], today: string): TaskSummary {
  const live = new Set(actions.filter((a) => a.status !== 'Draft' && !isTerminalStatus(a.status)).map((a) => a.action_id));
  const mine = tasks.filter((x) => live.has(x.action_id));
  const open = mine.filter(isTaskOpen);
  const byStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, mine.filter((x) => x.status === s).length])) as Record<TaskStatus, number>;
  const overdue = open.filter((x) => isTaskOverdue(x, today));
  const by = new Map<string, number>();
  for (const x of overdue) by.set(x.owner, (by.get(x.owner) ?? 0) + 1);
  const withTasks = new Set(mine.map((x) => x.action_id));
  const ready = [...withTasks].filter((id) => !open.some((x) => x.action_id === id)).length;
  const stop = open.filter((x) => x.needs_stop);
  return {
    open: open.length, byStatus, closed: mine.length - open.length, openActions: new Set(open.map((x) => x.action_id)).size,
    overdue: overdue.length, overdueActions: new Set(overdue.map((x) => x.action_id)).size,
    overdueBy: [...by.entries()].map(([owner, n]) => ({ owner, n })).sort((a, b) => b.n - a.n || byText(a.owner, b.owner)),
    ready, needsStop: stop.length, stopHours: r1(stop.reduce((s, x) => s + (x.est_stop_h ?? 0), 0)),
  };
}

/** The number on the Actions navigation item: open tasks past their due date, in accepted, open actions. */
export function overdueTaskCount(actions: readonly Action[], tasks: readonly ActionTask[], today: string): number {
  const live = new Set(actions.filter((a) => a.status !== 'Draft' && !isTerminalStatus(a.status)).map((a) => a.action_id));
  return tasks.filter((x) => live.has(x.action_id) && isTaskOverdue(x, today)).length;
}

// ---------------------------------------------------------------- templates

/** The template a new action is offered first: the active one whose rules include the source (lowest order first). */
export function suggestedTemplate(templates: readonly TaskTemplate[], source: ActionSource | undefined): TaskTemplate | null {
  if (!source) return null;
  return templates.filter((x) => x.active && x.applies_to.includes(source)).sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;
}

/** One row of the "Tasks to create" list of the create dialog. */
export interface TaskDraft {
  key: string; on: boolean; title: string; owner: string; assignee: string;
  /** days from today */
  offset: number;
  needs_stop: boolean; est_stop_h: number | null;
  /** the template step it came from ('' = added by hand) */
  step: string;
}

/** The owner of a template step for an action in this area: 'area_contractor' = the area's active external contractor ('' = none). */
export function resolveStepOwner(defaultOwner: string, areaId: string, contractors: readonly Contractor[]): string {
  if (defaultOwner === AREA_CONTRACTOR) return areaId ? contractorForArea(contractors, areaId)?.contractor_id ?? '' : '';
  return contractors.some((c) => c.contractor_id === defaultOwner && c.active) ? defaultOwner : '';
}
export const defaultPersonOf = (owner: string, contractors: readonly Contractor[]): string =>
  contractors.find((c) => c.contractor_id === owner)?.default_assignee ?? '';

/** The template's steps as editable rows for an action in this area (owner and person resolved, all ticked). */
export function draftsFromTemplate(tpl: TaskTemplate | null, areaId: string, contractors: readonly Contractor[]): TaskDraft[] {
  if (!tpl) return [];
  return [...tpl.steps].sort((a, b) => a.seq - b.seq).map((s, i) => {
    const owner = resolveStepOwner(s.default_owner, areaId, contractors);
    return {
      key: `${tpl.template_id}-${i}`, on: true, title: s.title, owner, assignee: defaultPersonOf(owner, contractors), offset: s.due_offset_days,
      needs_stop: s.needs_stop, est_stop_h: s.needs_stop ? s.est_stop_h : null, step: s.title,
    };
  });
}

/** The ticked rows as NewTask (createAction input). */
export function draftsToTasks(rows: readonly TaskDraft[], today: string): NewTask[] {
  return rows.filter((r) => r.on && r.title.trim()).map((r) => ({
    title: r.title.trim(), owner: r.owner, assignee: r.assignee, due_date: addDays(today, Math.max(0, Math.round(r.offset))),
    needs_stop: r.needs_stop, est_stop_h: r.needs_stop ? r.est_stop_h : null, ...(r.step ? { template_step: r.step } : {}),
  }));
}

/** "4 tasks · needs a stop: 2" style line under a template card. */
export function templateLine(tpl: TaskTemplate): string {
  const stops = tpl.steps.filter((s) => s.needs_stop).length;
  return t('{n} tasks', { n: tpl.steps.length }) + (stops ? ` · ${t('{n} need a stop', { n: stops })}` : '');
}

/** A template as saveTaskTemplates input. */
export const templateInput = (tpl: TaskTemplate): TaskTemplateInput => ({
  template_id: tpl.template_id, name: tpl.name, applies_to: [...tpl.applies_to], active: tpl.active, sort_order: tpl.sort_order,
  steps: [...tpl.steps].sort((a, b) => a.seq - b.seq).map((s) => ({ title: s.title, default_owner: s.default_owner, due_offset_days: s.due_offset_days, needs_stop: s.needs_stop, est_stop_h: s.needs_stop ? s.est_stop_h : null })),
});

/** What is wrong with a template before it is saved (the server's rules), or null. */
export function templateProblem(input: TaskTemplateInput, others: readonly TaskTemplate[]): string | null {
  if (!input.name.trim()) return t('Give the template a name.');
  if (others.some((o) => o.template_id !== input.template_id && o.name.trim().toLowerCase() === input.name.trim().toLowerCase())) return t('Another template is already called {n}.', { n: input.name.trim() });
  if (!input.steps.length) return t('A template needs at least one task.');
  if (input.steps.length > 20) return t('A template can have at most 20 tasks.');
  const titles = input.steps.map((s) => s.title.trim().toLowerCase());
  if (titles.some((x) => !x)) return t('Every task needs a title.');
  if (new Set(titles).size !== titles.length) return t('Two tasks have the same title.');
  if (input.steps.some((s) => !(s.due_offset_days >= 0 && s.due_offset_days <= 365))) return t('Due after must be 0 to 365 days.');
  if (input.steps.some((s) => s.est_stop_h !== null && !(s.est_stop_h >= 0 && s.est_stop_h <= 1000))) return t('Estimated hours must be 0 to 1,000.');
  if (input.active) {
    for (const src of input.applies_to) {
      const clash = others.find((o) => o.template_id !== input.template_id && o.active && o.applies_to.includes(src));
      if (clash) return t('{s} is already suggested by {n}: a rule suggests one template.', { s: src, n: clash.name });
    }
  }
  return null;
}

// ---------------------------------------------------------------- exports

export interface ExportEnv { people: readonly ActionPerson[]; contractors: readonly Contractor[]; today: string }

/** The Shutdown list as one Excel table (grouped by area, in the order shown). */
export function shutdownTable(groups: readonly ShutdownGroup[], env: ExportEnv): ExportTable {
  const rows = groups.flatMap((g) => g.tasks.map((v) => [
    v.area_id || t('Plant / line'), g.areaName, v.line_id, contractorName(env.contractors, g.contractor), v.action_id, v.equipment_id, v.title,
    contractorName(env.contractors, v.owner), personName(env.people, v.assignee), v.status, v.due_date, v.overdue ? 'yes' : '', v.est_stop_h,
    (v.waiting_since || v.created_at).slice(0, 10), waitingDays(v, env.today),
  ]));
  const hours = r1(groups.reduce((s, g) => s + g.hours, 0));
  return {
    id: 'shutdown-list', sheet: t('Shutdown list'),
    columns: [exportCol(t('Area')), exportCol(t('Area name')), exportCol(t('Line')), exportCol(t('Area contractor')), exportCol(t('Action')), exportCol(t('Equipment')),
      exportCol(t('Task')), exportCol(t('Owner')), exportCol(t('Person')), exportCol(t('Status')), exportCol(t('Due'), 'date'), exportCol(t('Overdue')),
      exportCol(t('Est. stop h'), 'h1'), exportCol(t('Waiting since'), 'date'), exportCol(t('Days waiting'), 'int')],
    rows,
    total: [t('Total'), '', '', '', '', '', t('{n} tasks', { n: rows.length }), '', '', '', '', '', hours, '', ''],
    notes: [t('Open tasks marked Needs stoppage, {d}. Tasks without an estimate add nothing to the hours.', { d: dayText(env.today) })],
  };
}

/** The Tasks list as one Excel table. */
export function tasksTable(list: readonly TaskView[], env: ExportEnv): ExportTable {
  return {
    id: 'tasks', sheet: t('Tasks'),
    columns: [exportCol(t('Action')), exportCol(t('Task no.'), 'int'), exportCol(t('Task')), exportCol(t('Equipment')), exportCol(t('Area')), exportCol(t('Line')),
      exportCol(t('Owner')), exportCol(t('Person')), exportCol(t('Status')), exportCol(t('Due'), 'date'), exportCol(t('Overdue')), exportCol(t('Needs stoppage')),
      exportCol(t('Est. stop h'), 'h1'), exportCol(t('Done')), exportCol(t('Note'))],
    rows: list.map((v) => [
      v.action_id, v.seq, v.title, v.equipment_id, v.area_id, v.line_id, contractorName(env.contractors, v.owner), personName(env.people, v.assignee), v.status,
      v.due_date, v.overdue ? 'yes' : '', v.needs_stop ? 'yes' : '', v.est_stop_h, v.done_at.slice(0, 10), v.done_note,
    ]),
  };
}
