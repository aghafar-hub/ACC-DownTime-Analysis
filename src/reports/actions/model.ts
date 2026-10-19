// The actions report (Reports › Actions report): every action of one area or of all areas, filtered by status and
// creation date, or one chosen action, with its tasks and history. Pure: the page draws it, the Excel file and the email
// are made from the same model, so they always agree.
import { TASK_CLOSED_STATUSES, isTerminalStatus, type Action, type ActionLog, type ActionPerson, type ActionStatus, type ActionTask, type Contractor } from '../../api/types';
import { contractorName, dueOf, isOverdue, personName, ROOT_CAUSE_LABEL, SOURCE_LABEL } from '../../actions/model';
import { t } from '../../i18n/t';
import { dateText, tsText } from '../../util/dates';

/** 'open' = not Closed or Cancelled; 'all'; or one status. */
export type ActionsReportStatus = 'open' | 'all' | ActionStatus;

export interface ActionsReportFilters {
  /** '' = all areas */
  area: string;
  status: ActionsReportStatus;
  /** created on or after / on or before, 'YYYY-MM-DD' or '' */
  from: string;
  to: string;
  /** one action id: only that action (the other filters are ignored) */
  id: string;
  /** each action's tasks and history under the list */
  details: boolean;
}

export const defaultActionsFilters = (): ActionsReportFilters => ({ area: '', status: 'open', from: '', to: '', id: '', details: true });

export function parseActionsFilters(sp: URLSearchParams): ActionsReportFilters {
  const d = defaultActionsFilters();
  const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const st = sp.get('ast') ?? '';
  return {
    area: sp.get('aarea') ?? '',
    status: (['open', 'all', 'Draft', 'Open', 'In progress', 'Closed', 'Cancelled'] as string[]).includes(st) ? st as ActionsReportStatus : d.status,
    from: date(sp.get('afrom')),
    to: date(sp.get('ato')),
    id: (sp.get('aid') ?? '').slice(0, 40),
    details: sp.get('adet') !== '0',
  };
}

export function writeActionsFilters(sp: URLSearchParams, f: ActionsReportFilters): URLSearchParams {
  const q = new URLSearchParams(sp);
  for (const k of ['aarea', 'ast', 'afrom', 'ato', 'aid', 'adet']) q.delete(k);
  q.set('type', 'actions');
  if (f.area) q.set('aarea', f.area);
  if (f.status !== 'open') q.set('ast', f.status);
  if (f.from) q.set('afrom', f.from);
  if (f.to) q.set('ato', f.to);
  if (f.id) q.set('aid', f.id);
  if (!f.details) q.set('adet', '0');
  return q;
}

export interface ActionsReportInput {
  actions: readonly Action[];
  tasks: readonly ActionTask[];
  logs: readonly ActionLog[];
  people: readonly ActionPerson[];
  contractors: readonly Contractor[];
  filters: ActionsReportFilters;
  today: string;
  plant: string;
  generatedAt: string;
  generatedBy: string;
  /** area id -> name */
  areaNames?: ReadonlyMap<string, string>;
}

export interface ActionRow {
  id: string; title: string; area: string; equipment: string; status: ActionStatus; priority: string; owner: string; assignee: string;
  due: string; overdue: boolean; tasksDone: number; tasksTotal: number; created: string;
}

export interface TaskRow { seq: number; title: string; owner: string; assignee: string; due: string; status: string; overdue: boolean; note: string }
export interface HistoryRow { at: string; by: string; what: string }

export interface ActionDetail {
  row: ActionRow;
  facts: [string, string][];
  detail: string;
  required: string;
  evidence: string[];
  tasks: TaskRow[];
  history: HistoryRow[];
}

export interface ActionsReportModel {
  title: string;
  plant: string;
  generatedAt: string;
  generatedBy: string;
  /** "Area K.1 · open actions · created 2026-08-01 to 2026-08-31" */
  scope: string;
  single: boolean;
  counts: { total: number; byStatus: [ActionStatus, number][]; overdue: number; tasksOpen: number; tasksDone: number };
  rows: ActionRow[];
  details: ActionDetail[];
}

const STATUS_ORDER: ActionStatus[] = ['Draft', 'Open', 'In progress', 'Closed', 'Cancelled'];
const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

export function statusPasses(s: ActionStatus, f: ActionsReportStatus): boolean {
  if (f === 'all') return true;
  if (f === 'open') return !isTerminalStatus(s);
  return s === f;
}

/** The actions the filters keep, most urgent first (status, priority, due date, id). */
export function selectActions(actions: readonly Action[], f: ActionsReportFilters): Action[] {
  if (f.id) return actions.filter((a) => a.action_id === f.id);
  return actions.filter((a) => (!f.area || a.area_id === f.area) && statusPasses(a.status, f.status)
    && (!f.from || a.created_at.slice(0, 10) >= f.from) && (!f.to || a.created_at.slice(0, 10) <= f.to))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      || (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
      || (dueOf(a) || '9999').localeCompare(dueOf(b) || '9999') || a.action_id.localeCompare(b.action_id));
}

function statusWords(f: ActionsReportStatus): string {
  return f === 'open' ? t('open actions') : f === 'all' ? t('all actions') : t('{s} actions', { s: f });
}

export function scopeText(f: ActionsReportFilters, areaNames?: ReadonlyMap<string, string>): string {
  if (f.id) return t('Action {id}', { id: f.id });
  const parts = [f.area ? t('Area {a}', { a: areaNames?.get(f.area) ? `${f.area} (${areaNames.get(f.area)})` : f.area }) : t('All areas'), statusWords(f.status)];
  if (f.from || f.to) parts.push(f.from && f.to ? t('created {a} to {b}', { a: f.from, b: f.to }) : f.from ? t('created from {a}', { a: f.from }) : t('created up to {b}', { b: f.to }));
  return parts.join(' · ');
}

const LOG_WORDS: Record<string, string> = {
  status: 'Status', comment: 'Comment', edit: 'Changed', evidence: 'Evidence', task_create: 'Task added', task_status: 'Task status', task_edit: 'Task changed', task_note: 'Task note',
};

export function buildActionsReport(input: ActionsReportInput): ActionsReportModel {
  const { filters: f, people, contractors, today } = input;
  const list = selectActions(input.actions, f);
  const tasksBy = new Map<string, ActionTask[]>();
  for (const tk of input.tasks) {
    const l = tasksBy.get(tk.action_id) ?? [];
    l.push(tk);
    tasksBy.set(tk.action_id, l);
  }
  const rowOf = (a: Action): ActionRow => {
    const tks = tasksBy.get(a.action_id) ?? [];
    return {
      id: a.action_id, title: a.title, area: a.area_id, equipment: a.equipment_id, status: a.status, priority: a.priority,
      owner: a.owner ? contractorName(contractors, a.owner) : '', assignee: personName(people, a.assignee), due: dueOf(a), overdue: isOverdue(a, today),
      tasksDone: tks.filter((x) => TASK_CLOSED_STATUSES.includes(x.status)).length, tasksTotal: tks.length, created: a.created_at.slice(0, 10),
    };
  };
  const rows = list.map(rowOf);
  const allTasks = list.flatMap((a) => tasksBy.get(a.action_id) ?? []);
  const single = !!f.id;
  const details = single || f.details ? list.map((a): ActionDetail => {
    const row = rowOf(a);
    const tks = (tasksBy.get(a.action_id) ?? []).slice().sort((x, y) => x.seq - y.seq);
    const taskTitle = new Map(tks.map((x) => [x.task_id, `#${x.seq} ${x.title}`]));
    const facts: [string, string][] = [
      [t('Status'), a.status], [t('Priority'), a.priority], [t('Area'), a.area_id || '—'], [t('Equipment'), a.equipment_id || '—'],
      [t('Contractor / team'), row.owner || '—'], [t('Owner'), row.assignee || '—'],
      [t('Due'), row.due ? `${dateText(row.due)}${row.overdue ? ` (${t('overdue')})` : ''}` : '—'],
      [t('Tasks'), row.tasksTotal ? t('{d} of {n} done', { d: row.tasksDone, n: row.tasksTotal }) : t('none')],
      [t('Needs a stoppage'), a.needs_stop ? t('Yes') : t('No')],
      [t('Root cause'), a.root_cause ? (ROOT_CAUSE_LABEL[a.root_cause] ?? a.root_cause) : '—'],
      [t('Source'), SOURCE_LABEL[a.source] ?? a.source],
      [t('Created'), `${shownTs(a.created_at)} · ${personName(people, a.created_by)}`],
      ...(a.closed_at ? [[t('Closed'), `${shownTs(a.closed_at)} · ${personName(people, a.closed_by)}${a.closure_note ? ` · ${a.closure_note}` : ''}`] as [string, string]] : []),
      ...(a.effectiveness ? [[t('Effect after closing'), a.effectiveness] as [string, string]] : []),
    ];
    const evidence = a.evidence.map((e) => [e.event_id ? t('Record {id}', { id: e.event_id }) : '', e.note ?? ''].filter(Boolean).join(' · ')).filter(Boolean);
    const history = input.logs.filter((l) => l.action_id === a.action_id).sort((x, y) => x.at.localeCompare(y.at)).map((l): HistoryRow => {
      const subject = l.task_id ? `${taskTitle.get(l.task_id) ?? t('Task')}: ` : '';
      const change = l.from_status || l.to_status ? `${l.from_status || '—'} → ${l.to_status || '—'}` : '';
      return { at: l.at.slice(0, 16), by: personName(people, l.by), what: `${t(LOG_WORDS[l.kind] ?? l.kind)}: ${subject}${[change, l.text].filter(Boolean).join(' · ')}` };
    });
    return {
      row, facts, detail: a.detail, required: a.required_action, evidence,
      tasks: tks.map((x) => ({
        seq: x.seq, title: x.title, owner: x.owner ? contractorName(contractors, x.owner) : '', assignee: personName(people, x.assignee), due: x.due_date,
        status: x.status, overdue: !!x.due_date && x.due_date < today && !TASK_CLOSED_STATUSES.includes(x.status), note: x.done_note || x.notes,
      })),
      history,
    };
  }) : [];
  return {
    title: single ? t('Action report') : t('Actions report'),
    plant: input.plant, generatedAt: input.generatedAt, generatedBy: input.generatedBy,
    scope: scopeText(f, input.areaNames), single,
    counts: {
      total: list.length,
      byStatus: STATUS_ORDER.map((s): [ActionStatus, number] => [s, list.filter((a) => a.status === s).length]).filter(([, n]) => n > 0),
      overdue: rows.filter((r) => r.overdue).length,
      tasksOpen: allTasks.filter((x) => !TASK_CLOSED_STATUSES.includes(x.status)).length,
      tasksDone: allTasks.filter((x) => TASK_CLOSED_STATUSES.includes(x.status)).length,
    },
    rows,
    details,
  };
}

/** The table heads of the list (also the Excel 'Actions' sheet). */
export const ACTION_HEAD = (): string[] => [t('Action'), t('Title'), t('Area'), t('Equipment'), t('Status'), t('Priority'), t('Contractor / team'), t('Owner'), t('Due'), t('Tasks done')];
/** The cells of one action row. `screen`: dates as the app shows them ('26 Aug 2026'); the Excel file keeps ISO dates. */
export const actionCells = (r: ActionRow, screen = false): string[] => [r.id, r.title, r.area, r.equipment, r.status, r.priority, r.owner, r.assignee, r.due ? `${screen ? dateText(r.due) : r.due}${r.overdue ? ' !' : ''}` : '', r.tasksTotal ? `${r.tasksDone}/${r.tasksTotal}` : '—'];
export const TASK_HEAD = (): string[] => ['#', t('Task'), t('Contractor / team'), t('Owner'), t('Due'), t('Status'), t('Note')];
export const taskCells = (x: TaskRow, screen = false): string[] => [String(x.seq), x.title, x.owner, x.assignee, x.due ? `${screen ? dateText(x.due) : x.due}${x.overdue ? ' !' : ''}` : '', x.status, x.note];

/** A stored time ('2026-08-26 14:05:00' or ISO) as the app shows it: '26 Aug 2026 14:05'. */
export const shownTs = (ts: string): string => tsText(String(ts ?? '').replace('T', ' ').slice(0, 16));

/** "Actions report Area K.1 2026-10-18" as a file name base. */
export function actionsFileBase(m: Pick<ActionsReportModel, 'title' | 'scope' | 'generatedAt'>): string {
  return `${m.title} ${m.scope.split(' · ')[0]} ${m.generatedAt.slice(0, 10)}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The Excel sheets: Actions (one row each), Tasks (one row per task), History. */
export function actionsSheets(m: ActionsReportModel): { name: string; rows: (string | number)[][]; headerRow: number }[] {
  const actions = [ACTION_HEAD(), ...m.rows.map((r) => actionCells(r))];
  const tasks = [[t('Action'), ...TASK_HEAD()], ...m.details.flatMap((d) => d.tasks.map((x) => [d.row.id, ...taskCells(x)]))];
  const history = [[t('Action'), t('When'), t('Who'), t('What')], ...m.details.flatMap((d) => d.history.map((h) => [d.row.id, h.at, h.by, h.what]))];
  const out = [{ name: t('Actions'), rows: actions, headerRow: 0 }];
  if (m.details.length) out.push({ name: t('Tasks'), rows: tasks, headerRow: 0 }, { name: t('History'), rows: history, headerRow: 0 });
  return out;
}
