// The Actions page's pure helpers (docs/actions-design.md, docs/wire-protocol.md section 10): filtering, sorting and
// grouping the board, the counts of the summary cards, which status an action may move to next, due-date words, the
// dedupe key the server will use, and the CSV export rows. No React; the clock is passed in.
import {
  ACTION_PRIORITIES, ACTION_STATUSES, contractorForArea, isTaskOpen, isTerminalStatus,
  type Action, type ActionPerson, type ActionPriority, type ActionSource, type ActionStatus, type ActionTask, type Contractor, type NewAction,
} from '../api/types';
import { addDays, addMonthsToKey, matchKey, parseDate, MS_DAY } from '../calc';
import { t } from '../i18n/t';
import { dayText, monthShort } from '../util/dates';

// ---------------------------------------------------------------- labels

/**
 * The statuses shown as board columns (Cancelled only when asked for). Backend 1.7.0: Contractor informed and Waiting stoppage
 * are task statuses now (TASK_STATUSES, src/actions/tasks.ts).
 */
export const BOARD_STATUSES: ActionStatus[] = ['Draft', 'Open', 'In progress', 'Closed'];
/** The open statuses (everything before Closed / Cancelled). */
export const OPEN_STATUSES: ActionStatus[] = ACTION_STATUSES.filter((s) => !isTerminalStatus(s));

/** CSS key of a status ('draft', 'contractor-informed' ...). */
export const statusKey = (s: string): string => s.toLowerCase().replace(/[^a-z]+/g, '-');

export const SOURCE_LABEL: Record<ActionSource, string> = {
  auto_repeat: 'Auto · Repeated failure',
  auto_chronic: 'Auto · Chronic equipment',
  auto_long_stop: 'Auto · Long stop',
  auto_planned_overrun: 'Auto · Planned overrun',
  notification: 'Notification',
  report: 'Report',
  pareto: 'Pareto',
  event: 'Event',
  manual: 'Manual',
};
export const isAutoSource = (s: ActionSource): boolean => s.startsWith('auto_');

export const ROOT_CAUSE_LABEL: Record<string, string> = {
  '': 'Not known yet', PRO: 'Process', MEC: 'Mechanical', ELE: 'Electrical', AUT: 'Automation', OPR: 'Operation', EXT: 'External',
};

export const PRIORITY_SYMBOL: Record<ActionPriority, string> = { High: '◆', Medium: '◆', Low: '◇' };

// ---------------------------------------------------------------- dates

const p2 = (n: number): string => String(n).padStart(2, '0');
/** The viewer's own date today, 'YYYY-MM-DD'. */
export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
}

/** Whole days from a to b ('YYYY-MM-DD' or a timestamp; only the date counts). */
export function daysFrom(a: string, b: string): number {
  const x = parseDate(String(a).slice(0, 10));
  const y = parseDate(String(b).slice(0, 10));
  if (x === null || y === null) return 0;
  return Math.round((y - x) / MS_DAY);
}

/** The due date to show: backend 1.7.0 derives it from the tasks (due_date_derived); an older server sends only due_date. */
export const dueOf = (a: Pick<Action, 'due_date'> & { due_date_derived?: string }): string => a.due_date_derived ?? a.due_date;

/** Not Closed or Cancelled, with a due date before today. */
export const isOverdue = (a: Pick<Action, 'status' | 'due_date'> & { due_date_derived?: string }, today: string): boolean =>
  !isTerminalStatus(a.status) && !!dueOf(a) && dueOf(a) < today;

export type DueTone = 'none' | 'ok' | 'soon' | 'overdue' | 'closed';
/** 'Due 18 Oct', 'Due today', '12 d overdue', 'Due not set'; and how it should look. */
export function dueInfo(a: Pick<Action, 'status' | 'due_date'> & { due_date_derived?: string }, today: string): { text: string; tone: DueTone; days: number } {
  const due = dueOf(a);
  if (!due) return { text: t('Due not set'), tone: 'none', days: 0 };
  const days = daysFrom(today, due);
  if (isTerminalStatus(a.status)) return { text: t('Due {d}', { d: dayText(due) }), tone: 'closed', days };
  if (days < 0) return { text: t('{n} d overdue', { n: -days }), tone: 'overdue', days };
  if (days === 0) return { text: t('Due today'), tone: 'soon', days };
  return { text: t('Due {d}', { d: dayText(due) }), tone: days <= 7 ? 'soon' : 'ok', days };
}

/** A sensible due date for a new action: High 14 days, Medium 30, Low 60. */
export const DEFAULT_DUE_DAYS: Record<ActionPriority, number> = { High: 14, Medium: 30, Low: 60 };
export const defaultDue = (priority: ActionPriority, today: string): string => addDays(today, DEFAULT_DUE_DAYS[priority]);

// ---------------------------------------------------------------- people and owners

/** A person's name from a user id (or the free name itself; 'System' for the rules). */
export function personName(people: readonly ActionPerson[], id: string): string {
  if (!id) return '';
  if (id === 'system') return t('System');
  return people.find((p) => p.user_id === id)?.display_name ?? id;
}

/** 'AG' from 'A. Ghafar' / 'Demo Admin'. */
export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?');
}

export const contractorName = (contractors: readonly Contractor[], id: string): string =>
  contractors.find((c) => c.contractor_id === id)?.name ?? id;

/** The owner (contractor or team) and person a new action gets for an area: the area's external contractor and its default person. */
export function defaultOwnerFor(contractors: readonly Contractor[], areaId: string): { owner: string; assignee: string; auto: boolean } {
  const c = contractorForArea(contractors, areaId);
  return c ? { owner: c.contractor_id, assignee: c.default_assignee, auto: true } : { owner: '', assignee: '', auto: false };
}

// ---------------------------------------------------------------- filters, search, sort

/** active: every status but Cancelled (unless shown); open: before Closed; all: every status. */
export type StatusFilter = 'active' | 'open' | 'all' | ActionStatus;
export type SortKey = 'next' | 'due' | 'priority' | 'newest' | 'oldest' | 'updated';
export const SORT_KEYS: SortKey[] = ['next', 'due', 'priority', 'newest', 'oldest', 'updated'];
export const SORT_LABEL: Record<SortKey, string> = { next: 'Next task due', due: 'Due date', priority: 'Priority', newest: 'Newest', oldest: 'Oldest', updated: 'Last changed' };

export interface ActionFilters {
  q: string;
  status: StatusFilter;
  areas: string[];
  lines: string[];
  /** contractor / team ids; '-' = nobody */
  owners: string[];
  /** person ids (or free names); '-' = nobody */
  assignees: string[];
  sources: ActionSource[];
  priorities: ActionPriority[];
  overdue: boolean;
  mine: boolean;
  /** Cancelled actions are hidden unless this is on (or the status filter asks for them) */
  cancelled: boolean;
  /** backend 1.7.0: a contractor / team with an open task in the action ('-' = an open task without owner) */
  taskOwners: string[];
  /** has an open task past its due date */
  taskOverdue: boolean;
  /** every task Done or Not needed, not closed yet */
  ready: boolean;
}

export const emptyFilters = (): ActionFilters => ({
  q: '', status: 'active', areas: [], lines: [], owners: [], assignees: [], sources: [], priorities: [], overdue: false, mine: false, cancelled: false,
  taskOwners: [], taskOverdue: false, ready: false,
});

/** Filters read from the page address (?q=belt&st=Open&area=K.1&area=K.2&mine=1 ...). */
export function parseActionFilters(sp: URLSearchParams): ActionFilters {
  const st = sp.get('st') ?? 'active';
  const status: StatusFilter = st === 'all' || st === 'active' || st === 'open' || (ACTION_STATUSES as readonly string[]).includes(st) ? (st as StatusFilter) : 'active';
  return {
    q: sp.get('q') ?? '',
    status,
    areas: sp.getAll('area'),
    lines: sp.getAll('line'),
    owners: sp.getAll('owner'),
    assignees: sp.getAll('who'),
    sources: sp.getAll('src').filter((s) => s in SOURCE_LABEL) as ActionSource[],
    priorities: sp.getAll('pri').filter((p) => (ACTION_PRIORITIES as readonly string[]).includes(p)) as ActionPriority[],
    overdue: sp.get('overdue') === '1',
    mine: sp.get('mine') === '1',
    cancelled: sp.get('cancelled') === '1',
    taskOwners: sp.getAll('towner'),
    taskOverdue: sp.get('tod') === '1',
    ready: sp.get('ready') === '1',
  };
}

/** The filter keys of the page address. */
export const FILTER_KEYS = ['q', 'st', 'area', 'line', 'owner', 'who', 'src', 'pri', 'overdue', 'mine', 'cancelled', 'towner', 'tod', 'ready'];

export function writeActionFilters(sp: URLSearchParams, f: ActionFilters): URLSearchParams {
  const out = new URLSearchParams(sp);
  for (const k of FILTER_KEYS) out.delete(k);
  if (f.q.trim()) out.set('q', f.q);
  if (f.status !== 'active') out.set('st', f.status);
  f.areas.forEach((v) => out.append('area', v));
  f.lines.forEach((v) => out.append('line', v));
  f.owners.forEach((v) => out.append('owner', v));
  f.assignees.forEach((v) => out.append('who', v));
  f.sources.forEach((v) => out.append('src', v));
  f.priorities.forEach((v) => out.append('pri', v));
  if (f.overdue) out.set('overdue', '1');
  if (f.mine) out.set('mine', '1');
  if (f.cancelled) out.set('cancelled', '1');
  f.taskOwners.forEach((v) => out.append('towner', v));
  if (f.taskOverdue) out.set('tod', '1');
  if (f.ready) out.set('ready', '1');
  return out;
}

/** Number of narrowing filters that are on (the status filter and the search are not counted). */
export function activeFilterCount(f: ActionFilters): number {
  return [f.areas, f.lines, f.owners, f.assignees, f.sources, f.priorities, f.taskOwners].filter((l) => l.length > 0).length
    + (f.overdue ? 1 : 0) + (f.mine ? 1 : 0) + (f.taskOverdue ? 1 : 0) + (f.ready ? 1 : 0);
}

export interface FilterEnv {
  today: string;
  /** the signed-in person's user id ('My actions': assigned to me or created by me) */
  me: string;
  people?: readonly ActionPerson[];
  contractors?: readonly Contractor[];
  /** backend 1.7.0: every task (task filters, task search, "My actions" includes actions with a task of mine) */
  tasks?: readonly ActionTask[];
}

/** Lower-case text the search box looks in: id, title, equipment, area, line, reason, detail, required action, owner and person names. */
export function searchText(a: Action, env: Pick<FilterEnv, 'people' | 'contractors'>): string {
  return [
    a.action_id, a.title, a.equipment_id, a.area_id, a.line_id, a.reason_key, a.detail, a.required_action, a.owner,
    env.contractors ? contractorName(env.contractors, a.owner) : '', env.people ? personName(env.people, a.assignee) : a.assignee,
  ].join(' ').toLowerCase();
}

/** Everything but the status filter: the board shows every status column from it, the counts per status come from it. */
export function filterActionsExceptStatus(list: readonly Action[], f: ActionFilters, env: FilterEnv): Action[] {
  const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const has = (vals: string[], v: string): boolean => vals.length === 0 || vals.includes(v || '-');
  return list.filter((a) => {
    if (!has(f.areas, a.area_id)) return false;
    if (!has(f.lines, a.line_id)) return false;
    if (!has(f.owners, a.owner)) return false;
    if (!has(f.assignees, a.assignee)) return false;
    if (f.sources.length && !f.sources.includes(a.source)) return false;
    if (f.priorities.length && !f.priorities.includes(a.priority)) return false;
    if (f.overdue && !isOverdue(a, env.today)) return false;
    const mine = env.tasks ? env.tasks.filter((x) => x.action_id === a.action_id) : [];
    if (f.mine && !(env.me && (a.assignee === env.me || a.created_by === env.me || mine.some((x) => x.assignee === env.me)))) return false;
    if (f.taskOwners.length && !mine.some((x) => isTaskOpen(x) && f.taskOwners.includes(x.owner || '-'))) return false;
    if (f.taskOverdue && (a.status === 'Draft' || isTerminalStatus(a.status) || !mine.some((x) => isTaskOpen(x) && !!x.due_date && x.due_date < env.today))) return false;
    if (f.ready && !(a.status !== 'Draft' && !isTerminalStatus(a.status) && mine.length > 0 && !mine.some(isTaskOpen))) return false;
    if (terms.length) {
      const text = `${searchText(a, env)} ${mine.map((x) => x.title).join(' ').toLowerCase()}`;
      if (!terms.every((w) => text.includes(w))) return false;
    }
    return true;
  });
}

/** Whether the status filter lets an action through. 'active' = every status but Cancelled unless asked for. */
export function statusPasses(s: ActionStatus, f: Pick<ActionFilters, 'status' | 'cancelled'>): boolean {
  if (f.status === 'all') return true;
  if (f.status === 'open') return !isTerminalStatus(s);
  if (f.status === 'active') return s !== 'Cancelled' || f.cancelled;
  return s === f.status;
}

export function filterActions(list: readonly Action[], f: ActionFilters, env: FilterEnv): Action[] {
  return filterActionsExceptStatus(list, f, env).filter((a) => statusPasses(a.status, f));
}

const PRIORITY_RANK: Record<ActionPriority, number> = { High: 0, Medium: 1, Low: 2 };
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sorted copy. Due date: overdue first, then the nearest; no due date last. Ties: priority, then the newest. Next task due
 * (backend 1.7.0): the earliest due date of the open tasks (an action without tasks uses its own due date).
 */
export function sortActions(list: readonly Action[], key: SortKey, tasks: readonly ActionTask[] = []): Action[] {
  const out = [...list];
  const nextDue = new Map<string, string>();
  if (key === 'next') {
    for (const x of tasks) {
      if (!isTaskOpen(x) || !x.due_date) continue;
      const cur = nextDue.get(x.action_id);
      if (!cur || x.due_date < cur) nextDue.set(x.action_id, x.due_date);
    }
  }
  const nd = (a: Action): string => (tasks.some((x) => x.action_id === a.action_id) ? nextDue.get(a.action_id) ?? '' : dueOf(a));
  const newest = (a: Action, b: Action) => byText(b.created_at, a.created_at) || byText(b.action_id, a.action_id);
  const prio = (a: Action, b: Action) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  out.sort((a, b) => {
    switch (key) {
      case 'next': {
        if (!nd(a) !== !nd(b)) return nd(a) ? -1 : 1;
        return byText(nd(a), nd(b)) || prio(a, b) || newest(a, b);
      }
      case 'due': {
        if (!dueOf(a) !== !dueOf(b)) return dueOf(a) ? -1 : 1;
        return byText(dueOf(a), dueOf(b)) || prio(a, b) || newest(a, b);
      }
      case 'priority': return prio(a, b) || byText(dueOf(a) || '9999', dueOf(b) || '9999') || newest(a, b);
      case 'newest': return newest(a, b);
      case 'oldest': return -newest(a, b);
      case 'updated': return byText(b.updated_at, a.updated_at) || newest(a, b);
      default: return 0;
    }
  });
  return out;
}

/** The actions per status, in board order (every status present, empty lists included). */
export function groupByStatus(list: readonly Action[]): Record<ActionStatus, Action[]> {
  const out = Object.fromEntries(ACTION_STATUSES.map((s) => [s, [] as Action[]])) as Record<ActionStatus, Action[]>;
  for (const a of list) out[a.status].push(a);
  return out;
}

export const countByStatus = (list: readonly Action[]): Record<ActionStatus, number> =>
  Object.fromEntries(ACTION_STATUSES.map((s) => [s, list.filter((a) => a.status === s).length])) as Record<ActionStatus, number>;

// ---------------------------------------------------------------- summary cards

export interface ActionSummary {
  open: number;
  overdue: number;
  drafts: number;
  /** open actions nobody follows up (no person) */
  noOwner: number;
  noOwnerDrafts: number;
  /** overdue per contractor id */
  overdueBy: Map<string, number>;
  closedRecent: number;
  cancelled: number;
  effective: number;
  notEffective: number;
  watching: number;
}

/** The figures over the board. "Recent" = closed in the last `days` (90) days. */
export function summarize(list: readonly Action[], today: string, days = 90): ActionSummary {
  const since = addDays(today, -days);
  const open = list.filter((a) => !isTerminalStatus(a.status));
  const overdue = open.filter((a) => isOverdue(a, today));
  const overdueBy = new Map<string, number>();
  for (const a of overdue) overdueBy.set(a.owner, (overdueBy.get(a.owner) ?? 0) + 1);
  const recent = list.filter((a) => a.status === 'Closed' && a.closed_at.slice(0, 10) >= since);
  const noOwner = open.filter((a) => !a.assignee);
  return {
    open: open.length, overdue: overdue.length, drafts: open.filter((a) => a.status === 'Draft').length,
    noOwner: noOwner.length, noOwnerDrafts: noOwner.filter((a) => a.status === 'Draft').length, overdueBy,
    closedRecent: recent.length, cancelled: list.filter((a) => a.status === 'Cancelled').length,
    effective: recent.filter((a) => a.effectiveness === 'Effective').length,
    notEffective: recent.filter((a) => a.effectiveness === 'Not effective').length,
    watching: recent.filter((a) => a.effectiveness === 'Watching').length,
  };
}

/** Open actions per area and status, most actions first (areas without any are left out; '' = plant / line scope). */
export function openByArea(list: readonly Action[]): { area: string; total: number; byStatus: Record<string, number> }[] {
  const map = new Map<string, Record<string, number>>();
  for (const a of list) {
    if (isTerminalStatus(a.status)) continue;
    const row = map.get(a.area_id) ?? {};
    row[a.status] = (row[a.status] ?? 0) + 1;
    map.set(a.area_id, row);
  }
  return [...map.entries()]
    .map(([area, byStatus]) => ({ area, byStatus, total: Object.values(byStatus).reduce((s, n) => s + n, 0) }))
    .sort((a, b) => b.total - a.total || byText(a.area, b.area));
}

/** Open actions per contractor / team ('' = nobody yet), most first, with the overdue ones. */
export function openByOwner(list: readonly Action[], today: string): { owner: string; total: number; overdue: number }[] {
  const map = new Map<string, { total: number; overdue: number }>();
  for (const a of list) {
    if (isTerminalStatus(a.status)) continue;
    const row = map.get(a.owner) ?? { total: 0, overdue: 0 };
    row.total++;
    if (isOverdue(a, today)) row.overdue++;
    map.set(a.owner, row);
  }
  return [...map.entries()].map(([owner, r]) => ({ owner, ...r })).sort((a, b) => b.total - a.total || byText(a.owner, b.owner));
}

/** Actions opened (created) and closed per month, the last `months` months up to today's month. */
export function openedVsClosed(list: readonly Action[], today: string, months = 6): { month: string; label: string; opened: number; closed: number }[] {
  const last = today.slice(0, 7);
  const keys = Array.from({ length: months }, (_, i) => addMonthsToKey(last, i - months + 1));
  return keys.map((m) => ({
    month: m, label: monthShort(m),
    opened: list.filter((a) => a.created_at.slice(0, 7) === m).length,
    closed: list.filter((a) => a.status === 'Closed' && a.closed_at.slice(0, 7) === m).length,
  }));
}

export const AGE_BUCKETS = [
  { id: '0-7', label: '0–7 d', min: 0, max: 7 },
  { id: '8-30', label: '8–30 d', min: 8, max: 30 },
  { id: '31-60', label: '31–60 d', min: 31, max: 60 },
  { id: '60+', label: '60+ d', min: 61, max: Infinity },
] as const;

/** Open actions by days since they were created; and the oldest one. */
export function openByAge(list: readonly Action[], today: string): { buckets: { id: string; label: string; count: number }[]; oldest: { id: string; days: number } | null; over30: number } {
  const open = list.filter((a) => !isTerminalStatus(a.status)).map((a) => ({ id: a.action_id, days: Math.max(0, daysFrom(a.created_at, today)) }));
  const buckets = AGE_BUCKETS.map((b) => ({ id: b.id, label: b.label, count: open.filter((x) => x.days >= b.min && x.days <= b.max).length }));
  const oldest = open.reduce<{ id: string; days: number } | null>((m, x) => (!m || x.days > m.days ? x : m), null);
  return { buckets, oldest, over30: open.filter((x) => x.days > 30).length };
}

// ---------------------------------------------------------------- status changes

export interface StatusOption {
  status: ActionStatus;
  allowed: boolean;
  /** why it cannot be chosen, or the note it needs */
  note: string;
  current: boolean;
  next: boolean;
}

/** How far the tasks of an action are (backend 1.7.0): total and still open (Open .. In progress). */
export interface TaskTally { total: number; open: number }
const NO_TASKS: TaskTally = { total: 0, open: 0 };
/** The tally of one action's tasks. */
export function taskTally(actionId: string, tasks: readonly ActionTask[] | undefined): TaskTally {
  const mine = (tasks ?? []).filter((x) => x.action_id === actionId);
  return { total: mine.length, open: mine.filter(isTaskOpen).length };
}

/**
 * The status an action normally moves to next: Draft -> Open -> In progress -> Closed (only for people who may close). Null
 * when there is no such step for this person. Backend 1.7.0: with tasks, Open and In progress follow the tasks, so the next
 * step of an accepted action is Closed, and only once every task is Done or Not needed.
 */
export function nextStatus(a: Pick<Action, 'status'>, canClose: boolean, tk: TaskTally = NO_TASKS): ActionStatus | null {
  if (isTerminalStatus(a.status)) return null;
  if (tk.total > 0) {
    if (a.status === 'Draft') return 'Open';
    return canClose && tk.open === 0 ? 'Closed' : null;
  }
  const order = BOARD_STATUSES;
  const at = order.indexOf(a.status);
  const next = at >= 0 ? order[at + 1] : 'In progress';
  if (!next) return null;
  if (isTerminalStatus(next) && !canClose) return null;
  return next;
}

/**
 * Every status with whether this person may move the action there. Any open status may move to any other; Closed and
 * Cancelled (to and from) need a closer; a closed or cancelled action reopens only to Open. Backend 1.7.0, an action with
 * tasks: Open and In progress follow the tasks (a draft is accepted to Open), and Closed waits until no task is open.
 */
export function statusOptions(a: Pick<Action, 'status'>, canClose: boolean, tk: TaskTally = NO_TASKS): StatusOption[] {
  const next = nextStatus(a, canClose, tk);
  const terminal = isTerminalStatus(a.status);
  const withTasks = tk.total > 0;
  return ACTION_STATUSES.map((s) => {
    const current = s === a.status;
    let allowed = !current;
    let note = '';
    if (current) note = t('current');
    else if (terminal) {
      allowed = canClose && s === 'Open';
      note = s === 'Open' ? (canClose ? (withTasks ? t('reopen · then follows the tasks') : t('reopen')) : t('only people who can close')) : t('reopen to Open first');
    } else if (isTerminalStatus(s)) {
      allowed = canClose;
      note = canClose ? (s === 'Closed' ? t('you can close · needs a note') : t('needs a reason')) : t('only people who can close');
      if (s === 'Closed' && withTasks && tk.open > 0) {
        allowed = false;
        note = tk.open === 1 ? t('1 task still open') : t('{n} tasks still open', { n: tk.open });
      }
    } else if (withTasks) {
      // Draft -> Open accepts the action; otherwise the tasks set Open / In progress
      allowed = a.status === 'Draft' && s === 'Open';
      note = allowed ? t('accept · then follows the tasks') : s === 'Draft' ? t('not back to Draft') : t('follows the tasks');
    }
    return { status: s, allowed, note, current, next: s === next };
  });
}

export type DropRule = { kind: 'refuse'; text: string } | { kind: 'dialog'; to: ActionStatus } | { kind: 'update' };
/**
 * What dropping a board card on a column does. Backend 1.7.0: with tasks, Open and In progress follow the tasks, so only
 * accepting a draft (Draft -> Open), closing (no task open) and cancelling stay manual. Closed / Cancelled (to or from) need
 * a closer and a note (the status dialog); a closed or cancelled card reopens to Open.
 */
export function dropRule(a: Pick<Action, 'action_id' | 'status'>, to: ActionStatus, tk: TaskTally, canClose: boolean): DropRule {
  const id = a.action_id;
  if (tk.total > 0 && !isTerminalStatus(to) && !isTerminalStatus(a.status) && !(a.status === 'Draft' && to === 'Open')) {
    return { kind: 'refuse', text: to === 'Draft' ? t('{id} cannot go back to Draft.', { id })
      : t('{id} follows its tasks: it moves to In progress by itself when a task starts. Open the action to change its tasks.', { id }) };
  }
  if (tk.total > 0 && to === 'Closed' && tk.open > 0 && !isTerminalStatus(a.status)) {
    return { kind: 'refuse', text: tk.open === 1 ? t('{id} cannot be closed: 1 task is still open.', { id }) : t('{id} cannot be closed: {n} tasks are still open.', { id, n: tk.open }) };
  }
  if (isTerminalStatus(to) || isTerminalStatus(a.status)) {
    if (!canClose) return { kind: 'refuse', text: t('Only people on the "Who can close actions" list can close, cancel or reopen an action.') };
    return { kind: 'dialog', to: isTerminalStatus(a.status) ? 'Open' : to };
  }
  return { kind: 'update' };
}

/** Moving to Closed or Cancelled needs a note of at least 3 characters. */
export const NOTE_MIN = 3;
export const needsNote = (to: ActionStatus): boolean => isTerminalStatus(to);
export function noteProblem(to: ActionStatus, note: string): string | null {
  if (!needsNote(to)) return null;
  return note.trim().length >= NOTE_MIN ? null : to === 'Closed' ? t('Write a closing note (at least 3 characters).') : t('Write why it is cancelled (at least 3 characters).');
}

/** The step number of the stepper (1-6) and its total; a cancelled action has none. */
export function stepOf(a: Pick<Action, 'status'>): { step: number; of: number } | null {
  const at = BOARD_STATUSES.indexOf(a.status);
  return at < 0 ? null : { step: at + 1, of: BOARD_STATUSES.length };
}

/** Evidence items added after the action was opened (merged records), as "+3 new failures since opened". */
export function newEvidence(a: Pick<Action, 'evidence' | 'created_at'>): number {
  return a.evidence.filter((e) => e.event_id && e.added_at > a.created_at.slice(0, 19) + '￿'.slice(0, 0) && e.added_at.slice(0, 19) > a.created_at.slice(0, 19)).length;
}

/** The event ids of the evidence, in the order added, without repeats. */
export function evidenceIds(a: Pick<Action, 'evidence'>): string[] {
  return [...new Set(a.evidence.map((e) => e.event_id).filter((x): x is string => !!x))];
}

/** Days left in the effectiveness watch of a closed action (null when it is not watching). */
export function watchDaysLeft(a: Pick<Action, 'status' | 'effectiveness' | 'closed_at'>, today: string, effectDays: number): number | null {
  if (a.status !== 'Closed' || a.effectiveness !== 'Watching' || !a.closed_at) return null;
  return Math.max(0, effectDays - daysFrom(a.closed_at, today));
}

// ---------------------------------------------------------------- creating

/** The key the server merges on: an equipment action with a reason is 'repeat|<equipment>|<reason key>'. */
export function dedupeKeyOf(input: Pick<NewAction, 'scope_kind' | 'equipment_id' | 'reason_key' | 'dedupe_key'>): string {
  if (input.dedupe_key) return input.dedupe_key;
  const reason = matchKey(input.reason_key ?? '');
  if (input.scope_kind === 'equipment' && input.equipment_id && reason) return `repeat|${input.equipment_id.trim().toUpperCase()}|${reason}`;
  return '';
}

/** The open action a new one would be merged into (the oldest open action with the same key), if any. */
export function mergeTarget(list: readonly Action[], input: Pick<NewAction, 'scope_kind' | 'equipment_id' | 'reason_key' | 'dedupe_key'>): Action | null {
  const key = dedupeKeyOf(input);
  if (!key) return null;
  const same = list.filter((a) => !isTerminalStatus(a.status) && a.dedupe_key.toUpperCase() === key.toUpperCase());
  same.sort((a, b) => byText(a.created_at, b.created_at) || byText(a.action_id, b.action_id));
  return same[0] ?? null;
}

/** Open actions about the same equipment (another reason), shown as a hint in the create dialog. */
export function sameEquipmentOpen(list: readonly Action[], equipment: string): Action[] {
  if (!equipment) return [];
  const key = equipment.trim().toUpperCase();
  return list.filter((a) => !isTerminalStatus(a.status) && a.equipment_id.toUpperCase() === key);
}

// ---------------------------------------------------------------- overdue badge

/** The number on the Actions navigation item: open actions whose due date has passed. */
export const overdueCount = (list: readonly Action[], today: string): number => list.filter((a) => isOverdue(a, today)).length;

// ---------------------------------------------------------------- export

export function actionsCsvRows(list: readonly Action[], env: { people: readonly ActionPerson[]; contractors: readonly Contractor[]; today: string }): (string | number)[][] {
  const head = ['Action', 'Status', 'Priority', 'Title', 'Scope', 'Area', 'Line', 'Equipment', 'Reason', 'Contractor / team', 'Owner', 'Due date', 'Overdue',
    'Needs stoppage', 'Root cause', 'Source', 'Evidence records', 'Created', 'Created by', 'Closed', 'Closed by', 'Closing note', 'Effectiveness'];
  return [head, ...list.map((a) => [
    a.action_id, a.status, a.priority, a.title, a.scope_kind, a.area_id, a.line_id, a.equipment_id, a.reason_key,
    contractorName(env.contractors, a.owner), personName(env.people, a.assignee), a.due_date, isOverdue(a, env.today) ? 'yes' : '',
    a.needs_stop ? 'yes' : '', a.root_cause, SOURCE_LABEL[a.source], evidenceIds(a).length, a.created_at.slice(0, 16), personName(env.people, a.created_by),
    a.closed_at.slice(0, 16), personName(env.people, a.closed_by), a.closure_note, a.effectiveness,
  ])];
}
