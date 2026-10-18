// Actions for the mock API (docs/actions-design.md, docs/wire-protocol.md section 10). The draft rules are written with the
// calc library (the same code the screens use), while backend/apps-script/Actions.js has its own plain-JS port of the same
// formulas and checks. tests/unit/contract.test.ts runs both over the same scenarios, so the two cannot drift apart.
import tables from '../../schema/tables.json';
import {
  ACTION_EVIDENCE_MAX, ACTION_PRIORITIES, ACTION_ROOT_CAUSES, ACTION_SCOPES, ACTION_SOURCES, ACTION_STATUSES, actionDueDate, ApiError, AREA_CONTRACTOR,
  deriveActionStatus, evenMonthlySplit, isTaskOpen, isTerminalStatus, REMOVED_ACTION_STATUSES, TASK_CLOSED_STATUSES, TASK_NOTE_MIN, TASK_STATUSES,
  TASKS_PER_ACTION_MAX, TEMPLATE_STEPS_MAX,
  type Action, type ActionCheckResult, type ActionEvidence, type ActionLog, type ActionLogKind, type ActionResult, type ActionSource,
  type ActionsPayload, type ActionTask, type AreaTarget, type Contractor, type CreateActionResult, type EventRow,
  type Notification, type Setting, type TaskList, type TaskResult, type TaskStatus, type TaskTemplate, type TaskTemplateStep, type TaskView,
} from './types';
import {
  addDays, attributedHours, attributeRows, buildFailureEvents, findClusters, groupOccurrences, isAnalysable, lastDayOfMonth, matchKey,
  addMonthsToKey, parseDate, parseTs, rowCode, MS_DAY, type ChainedEvent, type MasterIndex,
} from '../calc';
import { codeKey, isValidDate } from '../util/normalize';
import type { SyntheticDb } from '../mock/synthetic';

const NOTE_MIN = 3;
const TITLE_MAX = 200;
const LONG_MAX = 2000;
const TEXT_MAX = 1000;
const SPLIT_TOLERANCE = 0.1;
const EDIT_FIELDS = [
  'title', 'detail', 'status', 'priority', 'scope_kind', 'area_id', 'line_id', 'equipment_id', 'reason_key', 'owner',
  'assignee', 'due_date', 'needs_stop', 'root_cause', 'required_action', 'closure_note',
];
const INPUT_FIELDS = [
  'title', 'detail', 'status', 'priority', 'source', 'source_ref', 'scope_kind', 'area_id', 'line_id', 'equipment_id',
  'reason_key', 'owner', 'assignee', 'due_date', 'needs_stop', 'root_cause', 'required_action', 'evidence', 'dedupe_key',
  'tasks', 'template_id',
];
// backend 1.7.0 (Tasks.js)
const TASK_TITLE_MAX = 200;
const TEMPLATES_MAX = 30;
const TASK_INPUT_FIELDS = ['title', 'owner', 'assignee', 'due_date', 'needs_stop', 'est_stop_h', 'notes', 'template_step'];
const TASK_CHANGE_FIELDS = ['title', 'owner', 'assignee', 'due_date', 'status', 'needs_stop', 'est_stop_h', 'notes', 'note'];
const TASK_FILTER_FIELDS = ['mine', 'overdue', 'needs_stop', 'status', 'owner', 'assignee', 'area_id', 'line_id', 'action_id', 'done_since', 'include_drafts'];
const CONTRACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;
const EVENT_ID = /^EV-[0-9a-f]{16}$/;

const bad = (m: string) => new ApiError(m, 'bad_request');
const oneLine = (s: string | undefined | null, max: number): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}.` : t;
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const csv = (s: string | undefined | null): string[] => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const r2 = (n: number): number => Math.round(n * 100) / 100;
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The same rules as cleanText_ in backend/apps-script/Utils.js. */
function cleanText(v: unknown, label: string, required: boolean, max = TEXT_MAX): string {
  if (v === null || v === undefined) v = '';
  if (typeof v !== 'string') throw bad(`${label} must be text.`);
  const s = v.trim();
  if (required && !s) throw bad(`${label} is required.`);
  if (s.length > max) throw bad(`${label} is too long.`);
  return s;
}
function onlyKeys(o: Record<string, unknown>, keys: string[], what: string): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) throw bad(`${what} has an unknown field: ${oneLine(k, 40)}.`);
}
function pickEnum<T extends string>(v: unknown, allowed: readonly T[], label: string, dflt?: T): T {
  if (v === undefined || v === null || v === '') {
    if (dflt !== undefined) return dflt;
    throw bad(`${label} is required.`);
  }
  if (!(allowed as readonly unknown[]).includes(v)) throw bad(`${label} must be one of: ${allowed.filter(Boolean).join(', ')}.`);
  return v as T;
}

// ---------------------------------------------------------------- settings

export interface ActionSettings {
  closers: string[]; repeatN: number; repeatDays: number; chronicTop: number; chronicMonths: number; effectDays: number; autoDraft: boolean;
}
function num(raw: string | undefined, dflt: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
}
/** Same defaults and ranges as actionSettings_ in Actions.js. */
export function parseActionSettings(settings: Setting[]): ActionSettings {
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;
  const auto = (map.actions_auto_draft ?? 'true').trim().toLowerCase();
  return {
    closers: csv(map.actions_closers),
    repeatN: Math.round(num(map.actions_repeat_n, 3, 2, 100)),
    repeatDays: num(map.actions_repeat_days, 30, 1, 3650),
    chronicTop: Math.round(num(map.actions_chronic_top, 10, 1, 100)),
    chronicMonths: Math.round(num(map.actions_chronic_months, 3, 1, 24)),
    effectDays: num(map.actions_effect_days, 60, 1, 3650),
    autoDraft: auto !== 'false' && auto !== '0' && auto !== 'no',
  };
}

// ---------------------------------------------------------------- planned overrun (shared with the notification rule)

export interface PlannedOverrun {
  area: string; line: string; month: string; used: number; allowed: number; ytdUsed: number; ytdAllowed: number; allowance: number; eventIds: string[];
}

/** Port of plannedOverruns_ in Actions.js: PL hours (union per area, P1) of complete, recent months above the month's allowance. */
export function plannedOverruns(events: EventRow[], areas: { area_id: string; line_id: string }[], targets: AreaTarget[], latest: string, cutoff: string): PlannedOverrun[] {
  const out: PlannedOverrun[] = [];
  if (!latest || !targets.length) return out;
  const rows = events.filter(isAnalysable);
  const attr = attributeRows(rows);
  const plOf = (area: string, from: string, to: string): number => {
    const w = { fromMs: parseDate(from)!, toMs: parseDate(to)! + MS_DAY };
    let h = 0;
    for (const r of rows) if (r.area_id === area && r.classification === 'PL') h += attributedHours(r, w, attr);
    return h;
  };
  const sorted = [...targets].sort((a, b) => byText(a.area_id, b.area_id) || a.year - b.year);
  for (const t of sorted) {
    for (let m = 1; m <= 12; m++) {
      const month = `${t.year}-${String(m).padStart(2, '0')}`;
      const last = lastDayOfMonth(month);
      if (last > latest || last < cutoff) continue;
      const used = plOf(t.area_id, `${month}-01`, last);
      const allowed = t.monthly_split[m - 1]!;
      if (!(used > allowed + 1e-9)) continue;
      let ytdAllowed = 0;
      for (let k = 0; k < m; k++) ytdAllowed += t.monthly_split[k]!;
      const ids = rows.filter((r) => r.area_id === t.area_id && r.classification === 'PL' && r.stop_ts.slice(0, 7) === month)
        .sort((a, b) => byText(a.stop_ts, b.stop_ts) || byText(a.event_id, b.event_id)).map((r) => r.event_id);
      out.push({
        area: t.area_id, line: areas.find((a) => a.area_id === t.area_id)?.line_id ?? '', month, used, allowed,
        ytdUsed: plOf(t.area_id, `${t.year}-01-01`, last), ytdAllowed, allowance: t.planned_allowance_h_year, eventIds: ids.slice(0, ACTION_EVIDENCE_MAX),
      });
    }
  }
  return out;
}

export function plannedOverrunText(o: PlannedOverrun): { title: string; detail: string } {
  return {
    title: `Planned overrun: ${o.area} used ${o.used.toFixed(1)} h of ${o.allowed.toFixed(1)} h allowed in ${o.month}`,
    detail: `Year to date ${o.ytdUsed.toFixed(1)} h of ${o.ytdAllowed.toFixed(1)} h allowed (${o.allowance.toFixed(1)} h for ${o.month.slice(0, 4)}).`,
  };
}

/** One action-category alert candidate (action_due, task_overdue, action_ready_to_close). */
export interface TaskAlert {
  type: 'action_due' | 'task_overdue' | 'action_ready_to_close';
  key: string; title: string; detail: string; area: string; line: string; ref: string;
  /** backend 1.7.0: '' = everyone, else user ids and/or @closers */
  recipients: string;
}
const tasksOf = (actionId: string, tasks: readonly ActionTask[]): ActionTask[] =>
  tasks.filter((t) => t.action_id === actionId).sort((a, b) => a.seq - b.seq || byText(a.task_id, b.task_id));
const daysAgo = (today: string, due: string): number => Math.round((parseDate(today)! - parseDate(due)!) / MS_DAY);

/**
 * action_due candidates (port of notifRuleActionDue_): not closed or cancelled, due date before today. 1.7.0: an action with
 * tasks uses the latest open task due date and is left out while it is a Draft.
 */
export function actionDueAlerts(actions: Action[], tasks: readonly ActionTask[], today: string): TaskAlert[] {
  const out: TaskAlert[] = [];
  for (const a of actions.filter((x) => !isTerminalStatus(x.status)).sort((x, y) => byText(x.action_id, y.action_id))) {
    const mine = tasksOf(a.action_id, tasks);
    if (mine.length && a.status === 'Draft') continue;
    const due = actionDueDate(a, mine);
    if (!due || !isValidDate(due) || !(due < today)) continue;
    const days = daysAgo(today, due);
    out.push({
      type: 'action_due', key: `action_due|${a.action_id}|${due}`, title: `Action overdue: ${a.action_id} - ${oneLine(a.title, 120)}`,
      detail: `Due ${due}, ${days} day${days === 1 ? '' : 's'} ago. Status ${a.status}, owner ${a.owner || 'nobody yet'}.`,
      area: a.area_id, line: a.line_id, ref: a.action_id, recipients: '',
    });
  }
  return out;
}

/** task_overdue (port of notifRuleTaskOverdue_): open tasks of accepted, open actions due before today; to the task person and the action owner. */
export function taskOverdueAlerts(actions: Action[], tasks: readonly ActionTask[], today: string): TaskAlert[] {
  const out: TaskAlert[] = [];
  for (const a of actions.filter((x) => x.status !== 'Draft' && !isTerminalStatus(x.status)).sort((x, y) => byText(x.action_id, y.action_id))) {
    for (const t of tasksOf(a.action_id, tasks)) {
      if (!isTaskOpen(t) || !t.due_date || !isValidDate(t.due_date) || !(t.due_date < today)) continue;
      const days = daysAgo(today, t.due_date);
      const people = [...new Set([t.assignee, a.assignee].filter(Boolean))];
      out.push({
        type: 'task_overdue', key: `task_due|${t.task_id}|${t.due_date}`, title: `Task overdue: ${a.action_id} - ${oneLine(t.title, 120)}`,
        detail: `Due ${t.due_date}, ${days} day${days === 1 ? '' : 's'} ago. Task ${t.seq} of ${a.action_id}, status ${t.status}, owner ${t.owner || 'nobody yet'}, person ${t.assignee || 'nobody yet'}.`,
        area: a.area_id, line: a.line_id, ref: a.action_id, recipients: people.length ? people.join(',') : '@closers',
      });
    }
  }
  return out;
}

/** action_ready_to_close (port of readyCandidate_): accepted, open, every task Done or Not needed; to the closers. */
export function readyAlert(a: Action, actionTasks: readonly ActionTask[]): TaskAlert | null {
  if (a.status === 'Draft' || isTerminalStatus(a.status) || !actionTasks.length || actionTasks.some(isTaskOpen)) return null;
  const n = actionTasks.length;
  const notNeeded = actionTasks.filter((t) => t.status === 'Not needed').length;
  return {
    type: 'action_ready_to_close', key: `ready|${a.action_id}|${n}`, title: `Ready to close: ${a.action_id} - ${oneLine(a.title, 120)}`,
    detail: `All ${n} task${n === 1 ? '' : 's'} done or not needed (${n - notNeeded} done, ${notNeeded} not needed). Only the people on the "Who can close actions" list can close it.`,
    area: a.area_id, line: a.line_id, ref: a.action_id, recipients: '@closers',
  };
}

export function readyAlerts(actions: Action[], tasks: readonly ActionTask[]): TaskAlert[] {
  const out: TaskAlert[] = [];
  for (const a of [...actions].sort((x, y) => byText(x.action_id, y.action_id))) {
    const r = readyAlert(a, tasksOf(a.action_id, tasks));
    if (r) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------- draft rules

interface Draft {
  dedupe_key: string; source: Action['source']; source_ref: string; priority: Action['priority']; title: string; detail: string;
  scope_kind: Action['scope_kind']; area_id: string; line_id: string; equipment_id: string; reason_key: string; eventIds: string[]; latestTs: string;
}

interface RuleCtx {
  chains: ChainedEvent[]; index: MasterIndex; latest: string; cutoff: string; lineOf: (area: string, fallback?: string) => string;
}

const codeOf = (c: ChainedEvent, index: MasterIndex): string | null => {
  const rc = rowCode(c.head, index);
  return rc.kind === 'area_level' ? null : rc.kind === 'equipment' ? rc.equipmentId.toUpperCase() : rc.key;
};
const tsOf = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').replace('Z', '');

function ruleRepeat(x: RuleCtx, st: ActionSettings): Draft[] {
  const groups = new Map<string, { code: string; reasonKey: string; list: ChainedEvent[] }>();
  for (const c of x.chains) {
    if (!c.isFailure) continue;
    const code = codeOf(c, x.index);
    if (code === null) continue;
    const reasonKey = matchKey(c.head.reason_raw);
    if (reasonKey === '') continue;
    const key = `${code}|${reasonKey}`;
    const g = groups.get(key);
    if (g) g.list.push(c); else groups.set(key, { code, reasonKey, list: [c] });
  }
  const recent = addDays(x.latest, -st.repeatDays);
  const out: Draft[] = [];
  for (const g of groups.values()) {
    g.list.sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : 1));
    const occs = groupOccurrences(g.list);
    const clusters = findClusters(occs.map((o) => o.startMs), st.repeatN, st.repeatDays);
    if (!clusters.length) continue;
    const cl = clusters[clusters.length - 1]!;
    const latest = occs[cl[cl.length - 1]!]!.members[0]!;
    if (latest.startDate < recent) continue;
    const members = cl.flatMap((i) => occs[i]!.members);
    const hours = members.reduce((s, c) => s + c.durationS / 3600, 0);
    const label = oneLine(occs[cl[0]!]!.members[0]!.head.reason_raw, 120);
    out.push({
      dedupe_key: `repeat|${g.code}|${g.reasonKey}`, source: 'auto_repeat', source_ref: latest.id, priority: 'Medium',
      title: `${g.code} - ${label}: ${cl.length} failures in ${st.repeatDays} days`,
      detail: `${cl.length} failures within ${st.repeatDays} days (${hours.toFixed(1)} h stopped), latest ${latest.startDate} in ${latest.area_id}. Rule: ${st.repeatN} or more in ${st.repeatDays} days.`,
      scope_kind: 'equipment', area_id: latest.area_id, line_id: x.lineOf(latest.area_id, latest.line_id), equipment_id: g.code, reason_key: g.reasonKey,
      eventIds: members.map((c) => c.id), latestTs: tsOf(latest.startMs),
    });
  }
  return out;
}

function ruleChronic(x: RuleCtx, st: ActionSettings): Draft[] {
  let lastMonth = x.latest.slice(0, 7);
  if (x.latest !== lastDayOfMonth(lastMonth)) lastMonth = addMonthsToKey(lastMonth, -1);
  const months: string[] = [];
  for (let i = st.chronicMonths - 1; i >= 0; i--) months.push(addMonthsToKey(lastMonth, -i));
  const hours = new Map<string, Map<string, number>>(months.map((m) => [m, new Map()]));
  const events = new Map<string, Map<string, ChainedEvent[]>>(months.map((m) => [m, new Map()]));
  for (const c of x.chains) {
    if (!c.isFailure) continue;
    const m = c.startDate.slice(0, 7);
    const hm = hours.get(m);
    if (!hm) continue;
    const code = codeOf(c, x.index);
    if (code === null) continue;
    hm.set(code, (hm.get(code) ?? 0) + c.durationS / 3600);
    const em = events.get(m)!;
    const list = em.get(code);
    if (list) list.push(c); else em.set(code, [c]);
  }
  const tops = months.map((m) => {
    const hm = hours.get(m)!;
    return [...hm.keys()].filter((k) => hm.get(k)! > 0).sort((a, b) => hm.get(b)! - hm.get(a)! || (a < b ? -1 : 1)).slice(0, st.chronicTop);
  });
  const out: Draft[] = [];
  for (const code of tops[tops.length - 1]!) {
    if (!tops.every((t) => t.includes(code))) continue;
    const list = events.get(lastMonth)!.get(code)!;
    const latest = list[list.length - 1]!;
    const parts = months.map((m, k) => `${m} ${hours.get(m)!.get(code)!.toFixed(1)} h (#${tops[k]!.indexOf(code) + 1})`);
    out.push({
      dedupe_key: `chronic|${code}|${lastMonth}`, source: 'auto_chronic', source_ref: '', priority: 'High',
      title: `${code}: top ${st.chronicTop} by failure hours for ${st.chronicMonths} months (${months[0]} to ${lastMonth})`,
      detail: `Failure hours: ${parts.join(', ')}.`,
      scope_kind: 'equipment', area_id: latest.area_id, line_id: x.lineOf(latest.area_id, latest.line_id), equipment_id: code, reason_key: '',
      eventIds: list.map((c) => c.id), latestTs: tsOf(latest.startMs),
    });
  }
  return out;
}

function ruleLongStop(x: RuleCtx, notifications: Notification[]): Draft[] {
  const byId = new Map(x.chains.map((c) => [c.id, c]));
  const out: Draft[] = [];
  for (const n of notifications.filter((n) => n.type === 'long_stop' && n.status === 'open').sort((a, b) => (a.dedupe_key < b.dedupe_key ? -1 : 1))) {
    const c = byId.get(n.source_ref ?? '');
    if (!c) continue;
    const code = codeOf(c, x.index);
    const h = (c.durationS / 3600).toFixed(1);
    const reason = oneLine(c.head.reason_raw, 120);
    out.push({
      dedupe_key: `long_stop|${c.id}`, source: 'auto_long_stop', source_ref: n.notification_id, priority: 'High',
      title: `Long stop: ${c.area_id} ${h} h${code !== null ? ` on ${code}` : ''}${reason ? ` - ${reason}` : ''}`,
      detail: `A failure stopped ${c.area_id} for ${h} hours, starting ${c.head.stop_ts.slice(0, 16)}.`,
      scope_kind: code !== null ? 'equipment' : 'area', area_id: c.area_id, line_id: x.lineOf(c.area_id, c.line_id),
      equipment_id: code ?? '', reason_key: code !== null ? matchKey(c.head.reason_raw) : '', eventIds: [c.id], latestTs: tsOf(c.startMs),
    });
  }
  return out;
}

function rulePlanned(overruns: PlannedOverrun[], notifications: Notification[]): Draft[] {
  const byKey = new Map(notifications.map((n) => [n.dedupe_key, n]));
  return overruns.map((o) => {
    const key = `planned|${o.area}|${o.month}`;
    const t = plannedOverrunText(o);
    return {
      dedupe_key: key, source: 'auto_planned_overrun', source_ref: byKey.get(key)?.notification_id ?? '', priority: 'Medium', title: t.title, detail: t.detail,
      scope_kind: 'area', area_id: o.area, line_id: o.line, equipment_id: '', reason_key: '', eventIds: o.eventIds, latestTs: '',
    };
  });
}

/** Port of effectivenessOf_ in Actions.js. */
function effectivenessOf(x: RuleCtx, a: Action, days: number): { verdict: Action['effectiveness']; text?: string } | null {
  const c0 = parseTs(a.closed_at);
  if (c0 === null || !x.latest) return null;
  const span = days * MS_DAY;
  if (parseDate(x.latest)! + MS_DAY < c0 + span) return { verdict: 'Watching' };
  const eq = a.equipment_id.toUpperCase();
  const before = { n: 0, h: 0 };
  const after = { n: 0, h: 0 };
  for (const c of x.chains) {
    if (!c.isFailure || codeOf(c, x.index) !== eq) continue;
    if (a.reason_key && matchKey(c.head.reason_raw) !== a.reason_key) continue;
    const w = c.startMs >= c0 - span && c.startMs < c0 ? before : c.startMs >= c0 && c.startMs < c0 + span ? after : null;
    if (!w) continue;
    w.n++;
    w.h += c.durationS / 3600;
  }
  const verdict = after.n === 0 ? 'Effective' : after.n >= before.n ? 'Not effective' : after.h < before.h ? 'Effective' : 'Not effective';
  const f = (n: number) => `${n} failure${n === 1 ? '' : 's'}`;
  return { verdict, text: `Effectiveness: ${verdict} (${days} days before closing: ${f(before.n)}, ${before.h.toFixed(1)} h; ${days} days after: ${f(after.n)}, ${after.h.toFixed(1)} h)` };
}

// ---------------------------------------------------------------- the store

type TemplateSeed = Omit<TaskTemplate, 'applies_to' | 'steps' | 'updated_at' | 'updated_by'> & { applies_to: string; steps: Omit<TaskTemplateStep, 'seq'>[] };
const TABLES = tables as unknown as { contractorSeeds: (Omit<Contractor, 'areas'> & { areas: string })[]; taskTemplateSeeds: TemplateSeed[] };

export interface ActionStoreDeps {
  db: () => SyntheticDb;
  index: () => MasterIndex;
  nowTs: () => string;
  notifications: () => Notification[];
  /** retention days of the notifications (recency of the planned-overrun months) */
  retentionDays: () => number;
  audit: (userId: string, action: string, entityId: string, detail: string) => void;
  /** backend 1.7.0 (syncReadyToClose_): the action's ready-to-close alert now (null = none), raised, re-opened or resolved at once */
  syncReady?: (actionId: string, alert: TaskAlert | null) => void;
}

export interface ActionUser { user_id: string; role_id: string }

export interface ActionStore {
  list(u: ActionUser): ActionsPayload;
  create(u: ActionUser, input: unknown, options: unknown): CreateActionResult;
  update(u: ActionUser, actionId: unknown, changes: unknown): ActionResult;
  comment(u: ActionUser, actionId: unknown, text: unknown): ActionResult;
  saveContractors(u: ActionUser, rows: unknown): Contractor[];
  getTargets(year: unknown): AreaTarget[];
  saveTargets(u: ActionUser, year: unknown, rows: unknown): AreaTarget[];
  runChecks(): ActionCheckResult;
  // backend 1.7.0: tasks inside actions
  addTask(u: ActionUser, actionId: unknown, task: unknown): TaskResult;
  updateTask(u: ActionUser, taskId: unknown, changes: unknown): TaskResult;
  applyTemplate(u: ActionUser, actionId: unknown, templateId: unknown): TaskResult;
  listTasks(u: ActionUser, filter: unknown): TaskList;
  listTemplates(): TaskTemplate[];
  saveTemplates(u: ActionUser, list: unknown): TaskTemplate[];
  isCloser(u: ActionUser): boolean;
  /** read-only views for the notification rules */
  actions(): Action[];
  tasks(): ActionTask[];
  targets(): AreaTarget[];
  /** test helper: clean the closers setting the way saveSettings does */
  cleanClosers(value: string): string;
}

export function createActionStore(deps: ActionStoreDeps): ActionStore {
  const actions: Action[] = [];
  const logs: ActionLog[] = [];
  const tasks: ActionTask[] = [];
  const contractors: Contractor[] = TABLES.contractorSeeds.map((c) => ({ ...c, areas: csv(c.areas), default_assignee: c.default_assignee ?? '' }));
  const templates: TaskTemplate[] = (TABLES.taskTemplateSeeds ?? []).map((t) => ({
    template_id: t.template_id, name: t.name, applies_to: csv(t.applies_to) as ActionSource[], active: t.active, sort_order: t.sort_order,
    updated_at: '', updated_by: 'setup',
    steps: t.steps.map((s, i) => ({ seq: i + 1, title: s.title, default_owner: s.default_owner, due_offset_days: s.due_offset_days, needs_stop: !!s.needs_stop, est_stop_h: s.needs_stop ? s.est_stop_h ?? null : null })),
  }));
  const targets: AreaTarget[] = [];
  let logCounter = 0;
  let taskCounter = 0;
  let templateCounter = 0;

  const settings = (): ActionSettings => parseActionSettings(deps.db().settings);
  const isCloser = (u: ActionUser): boolean => u.role_id === 'ROLE-ADMIN' || settings().closers.includes(u.user_id);
  const clone = <T,>(x: T): T => structuredClone(x);
  const logRow = (actionId: string, by: string, kind: ActionLogKind, from: string, to: string, text: string, at: string, taskId = ''): ActionLog => ({
    log_id: `AL-${(++logCounter).toString(16).padStart(16, '0')}`, action_id: actionId, at, by, kind, from_status: from, to_status: to, text: String(text ?? '').slice(0, LONG_MAX),
    task_id: taskId,
  });
  const logsOf = (id: string): ActionLog[] => logs.filter((l) => l.action_id === id).sort((a, b) => byText(a.at, b.at));
  const taskList = (id: string): ActionTask[] => tasksOf(id, tasks);
  const out = (a: Action): Action => ({ ...a, template_id: a.template_id ?? '', due_date_derived: actionDueDate(a, taskList(a.action_id)) });
  const result = (a: Action): ActionResult => clone({ action: out(a), logs: logsOf(a.action_id), tasks: taskList(a.action_id) });
  const syncReady = (a: Action): void => {
    try { deps.syncReady?.(a.action_id, readyAlert(a, taskList(a.action_id))); } catch { /* never fails the change, like the server */ }
  };
  const today = (): string => deps.nowTs().slice(0, 10);
  const nextId = (stamp: string): string => {
    const prefix = `AC-${stamp.slice(0, 4)}${stamp.slice(5, 7)}-`;
    let max = 0;
    for (const a of actions) if (a.action_id.startsWith(prefix)) max = Math.max(max, Number(a.action_id.slice(prefix.length)) || 0);
    return prefix + String(max + 1).padStart(4, '0');
  };
  const contractorFor = (area: string): Contractor | null =>
    area ? contractors.find((c) => c.active && c.kind === 'contractor' && c.areas.includes(area)) ?? null : null;
  const oldestOpen = (key: string): Action | undefined =>
    actions.filter((a) => a.dedupe_key === key && !isTerminalStatus(a.status)).sort((a, b) => byText(a.created_at, b.created_at) || byText(a.action_id, b.action_id))[0];

  function mergeEvidence(list: ActionEvidence[], add: ActionEvidence[]): { list: ActionEvidence[]; added: number } {
    const have = new Set(list.filter((x) => x.event_id).map((x) => x.event_id));
    let out = [...list];
    let added = 0;
    for (const x of add) {
      if (x.event_id) {
        if (have.has(x.event_id)) continue;
        have.add(x.event_id);
      }
      out.push(x);
      added++;
    }
    if (out.length > ACTION_EVIDENCE_MAX) out = out.slice(out.length - ACTION_EVIDENCE_MAX);
    return { list: out, added };
  }

  function cleanEvidence(list: unknown, by: string, at: string): ActionEvidence[] {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) throw bad('Evidence must be a list.');
    if (list.length > ACTION_EVIDENCE_MAX) throw bad(`At most ${ACTION_EVIDENCE_MAX} evidence items at once.`);
    return list.map((x) => {
      if (!isObj(x)) throw bad('Each evidence item must be an object.');
      onlyKeys(x, ['event_id', 'note'], 'An evidence item');
      const ev = x.event_id === undefined || x.event_id === null ? '' : x.event_id;
      if (typeof ev !== 'string' || (ev && !EVENT_ID.test(ev))) throw bad('An evidence event id must look like EV- and 16 hex characters.');
      const note = cleanText(x.note === null ? '' : x.note, 'An evidence note', false, 500);
      if (!ev && !note) throw bad('An evidence item needs an event id or a note.');
      const item: ActionEvidence = { added_at: at, added_by: by };
      if (ev) item.event_id = ev;
      if (note) item.note = note;
      return item;
    });
  }

  function cleanScope(c: Record<string, unknown>, strictEquipment: boolean): Pick<Action, 'scope_kind' | 'area_id' | 'line_id' | 'equipment_id'> {
    const d = deps.db();
    const kind = pickEnum(c.scope_kind, ACTION_SCOPES, 'Scope');
    let area = cleanText(c.area_id, 'Area', false, 40);
    let line = cleanText(c.line_id, 'Line', false, 20);
    let eq = cleanText(c.equipment_id, 'Equipment', false, 60);
    if (area) {
      const real = d.areas.find((a) => a.area_id.toLowerCase() === area.toLowerCase());
      if (!real) throw bad(`Area "${oneLine(area, 40)}" is not in the list of areas.`);
      area = real.area_id;
    }
    if (line && !d.lines.some((l) => l.line_id === line)) throw bad(`Line "${oneLine(line, 20)}" is not in the list of lines.`);
    if (kind === 'equipment') {
      if (!eq) throw bad('Choose the equipment.');
      const key = codeKey(eq);
      const found = d.equipment.find((e) => codeKey(e.equipment_id) === key);
      if (found) eq = found.equipment_id;
      else if (strictEquipment) throw bad(`Equipment "${oneLine(eq, 40)}" is not in Master Data.`);
      else eq = key;
      if (!area) area = d.equipment_areas.find((r) => r.equipment_id === eq)?.area_id ?? '';
    } else {
      eq = '';
    }
    if (kind === 'area' && !area) throw bad('Choose the area.');
    if (kind === 'line' || kind === 'plant') area = '';
    if (area && !line) line = d.areas.find((a) => a.area_id === area)?.line_id ?? '';
    if (kind === 'line' && !line) throw bad('Choose the line.');
    if (kind === 'plant') line = '';
    return { scope_kind: kind, area_id: area, line_id: line, equipment_id: eq };
  }

  function cleanOwner(v: unknown): { owner: string; owner_kind: Action['owner_kind'] } {
    const owner = cleanText(v, 'Owner', false, 40);
    if (!owner) return { owner: '', owner_kind: 'internal' };
    const c = contractors.find((x) => x.contractor_id === owner);
    if (!c || !c.active) throw bad(`Owner "${oneLine(owner, 40)}" is not an active contractor or team.`);
    return { owner, owner_kind: c.kind };
  }
  const cleanDue = (v: unknown): string => {
    const s = cleanText(v, 'Due date', false, 20);
    if (s && !isValidDate(s)) throw bad('Due date must be a date like 2026-10-25, or blank.');
    return s;
  };
  const cleanNeedsStop = (v: unknown): boolean => {
    if (v === undefined || v === null) return false;
    if (typeof v !== 'boolean') throw bad('Needs stoppage must be true or false.');
    return v;
  };

  function newAction(c: Omit<Action, 'action_id' | 'created_by' | 'created_at' | 'updated_at' | 'updated_by' | 'closed_by' | 'closed_at' | 'closure_note' | 'effectiveness' | 'effectiveness_checked_at' | 'evidence'>, by: string, stamp: string, evidence: ActionEvidence[]): Action {
    const a: Action = {
      action_id: nextId(stamp), ...c, created_by: by, created_at: stamp, updated_at: stamp, updated_by: by,
      closed_by: '', closed_at: '', closure_note: '', effectiveness: '', effectiveness_checked_at: '', evidence: mergeEvidence([], evidence).list,
    };
    a.template_id = c.template_id ?? '';
    delete a.due_date_derived;
    return a;
  }

  // ------------------------------------------------------------ tasks (port of Tasks.js)

  interface TaskInput {
    title: string; owner: string; owner_kind: Action['owner_kind']; assignee: string; due_date: string; needs_stop: boolean; est_stop_h: number | null;
    notes: string; template_step: string;
  }
  const cleanEst = (v: unknown): number | null => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000) throw bad('Estimated stop hours must be a number from 0 to 1000, or blank.');
    return v;
  };
  function cleanTaskInput(input: unknown): TaskInput {
    if (!isObj(input)) throw bad('Each task must be an object.');
    onlyKeys(input, TASK_INPUT_FIELDS, 'A task');
    const owner = cleanOwner(input.owner);
    const needs = cleanNeedsStop(input.needs_stop);
    const est = cleanEst(input.est_stop_h);
    return {
      title: cleanText(input.title, 'Task title', true, TASK_TITLE_MAX), ...owner, assignee: cleanText(input.assignee, 'Person', false, 100),
      due_date: cleanDue(input.due_date), needs_stop: needs, est_stop_h: needs ? est : null, notes: cleanText(input.notes, 'Task notes', false, LONG_MAX),
      template_step: cleanText(input.template_step, 'Template step', false, TASK_TITLE_MAX),
    };
  }
  function cleanTaskList(list: unknown): TaskInput[] | null {
    if (list === undefined || list === null) return null;
    if (!Array.isArray(list)) throw bad('Tasks must be a list.');
    if (list.length > TASKS_PER_ACTION_MAX) throw bad(`An action can have at most ${TASKS_PER_ACTION_MAX} tasks.`);
    return list.map(cleanTaskInput);
  }
  const taskCreateText = (t: ActionTask): string =>
    `#${t.seq} ${t.title} (${t.owner || 'no owner'}${t.due_date ? `, due ${t.due_date}` : ''}${t.needs_stop ? ', needs a stop' : ''})`;
  function newTask(actionId: string, seq: number, c: TaskInput, by: string, stamp: string): ActionTask {
    return {
      task_id: `AT-${(++taskCounter).toString(16).padStart(12, '0')}`, action_id: actionId, seq, title: c.title, owner_kind: c.owner ? c.owner_kind : 'internal',
      owner: c.owner, assignee: c.assignee, due_date: c.due_date, status: 'Open', needs_stop: c.needs_stop, est_stop_h: c.needs_stop ? c.est_stop_h : null,
      notes: c.notes, template_step: c.template_step, created_at: stamp, created_by: by, updated_at: stamp, updated_by: by, done_at: '', done_by: '', done_note: '',
    };
  }
  /** buildTaskRows_: new tasks (and their task_create history); skipSteps leaves out a template step the action already has. */
  function buildTasks(actionId: string, existing: ActionTask[], inputs: TaskInput[], by: string, stamp: string, skipSteps: boolean): { rows: ActionTask[]; logs: ActionLog[] } {
    let seq = existing.reduce((m, t) => Math.max(m, t.seq), 0);
    const have = new Set(existing.map((t) => t.template_step).filter(Boolean));
    const rows: ActionTask[] = [];
    const newLogs: ActionLog[] = [];
    for (const c of inputs) {
      if (skipSteps && c.template_step && have.has(c.template_step)) continue;
      if (c.template_step) have.add(c.template_step);
      const t = newTask(actionId, ++seq, c, by, stamp);
      rows.push(t);
      newLogs.push(logRow(actionId, by, 'task_create', '', 'Open', taskCreateText(t), stamp, t.task_id));
    }
    if (existing.length + rows.length > TASKS_PER_ACTION_MAX) throw bad(`An action can have at most ${TASKS_PER_ACTION_MAX} tasks.`);
    return { rows, logs: newLogs };
  }
  /** followTasks_: the status the tasks set, with its history row; null when it does not change. */
  function follow(a: Action, all: ActionTask[], by: string, stamp: string): { from: Action['status']; to: Action['status']; log: ActionLog } | null {
    const to = deriveActionStatus(a, all);
    if (to === a.status) return null;
    return { from: a.status, to, log: logRow(a.action_id, by, 'status', a.status, to, to === 'In progress' ? 'Follows the tasks: a task has started' : 'Follows the tasks: no task has started', stamp) };
  }
  /** storeNewTasks_: writes the tasks, lets the action follow, syncs the ready alert. */
  function storeTasks(a: Action, built: { rows: ActionTask[]; logs: ActionLog[] }, by: string, stamp: string, extra: Partial<Action> = {}) {
    tasks.push(...built.rows);
    const newLogs = [...built.logs];
    const f = follow(a, taskList(a.action_id), by, stamp);
    Object.assign(a, extra, { updated_at: stamp, updated_by: by });
    if (f) { a.status = f.to; newLogs.push(f.log); }
    logs.push(...newLogs);
    syncReady(a);
    return f;
  }
  function stepOwner(step: TaskTemplateStep, areaId: string): { owner: string; owner_kind: Action['owner_kind']; assignee: string } {
    const c = step.default_owner === AREA_CONTRACTOR ? contractorFor(areaId) : contractors.find((x) => x.contractor_id === step.default_owner && x.active) ?? null;
    return c ? { owner: c.contractor_id, owner_kind: c.kind, assignee: c.default_assignee || '' } : { owner: '', owner_kind: 'internal', assignee: '' };
  }
  const templateInputs = (t: TaskTemplate, areaId: string, day: string): TaskInput[] => t.steps.map((s) => ({
    title: s.title, ...stepOwner(s, areaId), due_date: addDays(day, s.due_offset_days || 0), needs_stop: s.needs_stop, est_stop_h: s.needs_stop ? s.est_stop_h : null,
    notes: '', template_step: s.title,
  }));
  const sortedTemplates = (): TaskTemplate[] => [...templates].sort((a, b) => a.sort_order - b.sort_order || byText(a.name, b.name) || byText(a.template_id, b.template_id));
  const templateFor = (source: string): TaskTemplate | null => sortedTemplates().find((t) => t.active && t.applies_to.includes(source as ActionSource)) ?? null;
  const findAction = (actionId: unknown): Action => {
    const id = cleanText(actionId, 'Action', true, 40);
    const row = actions.find((a) => a.action_id === id);
    if (!row) throw new ApiError('Action not found.', 'not_found');
    return row;
  };
  const taskResult = (a: Action, taskId = '', added?: number): TaskResult => {
    const r: TaskResult = { action: out(a), tasks: taskList(a.action_id), logs: logsOf(a.action_id) };
    if (taskId) r.task = tasks.find((t) => t.task_id === taskId);
    if (added !== undefined) r.added = added;
    return clone(r);
  };
  const refuseRemoved = (status: unknown): void => {
    if ((REMOVED_ACTION_STATUSES as readonly unknown[]).includes(status)) {
      throw bad(`"${String(status)}" is a task status since version 1.7.0: set it on a task of the action. An action is Draft, Open, In progress, Closed or Cancelled.`);
    }
  };
  const showValue = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : v === '' || v === null || v === undefined ? '(blank)' : String(v));
  const auditVal = (v: unknown, max = 60): string => {
    if (v === true) return 'yes';
    if (v === false) return 'no';
    const s = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
    if (!s) return '(blank)';
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  };

  const store: ActionStore = {
    list(u) {
      const d = deps.db();
      const st = settings();
      return clone({
        actions: [...actions].sort((a, b) => byText(b.created_at, a.created_at) || byText(b.action_id, a.action_id)).map(out),
        logs: [...logs].sort((a, b) => byText(a.at, b.at)),
        contractors: [...contractors].sort((a, b) => a.sort_order - b.sort_order || byText(a.contractor_id, b.contractor_id)),
        people: d.users.filter((x) => x.active).map((x) => ({ user_id: x.user_id, display_name: x.display_name })).sort((a, b) => byText(a.display_name, b.display_name)),
        closers: st.closers, can_close: isCloser(u),
        tasks: [...tasks].sort((a, b) => byText(a.action_id, b.action_id) || a.seq - b.seq || byText(a.task_id, b.task_id)),
        templates: sortedTemplates(),
      });
    },

    create(u, input, options) {
      if (options !== undefined && options !== null) {
        if (!isObj(options)) throw bad('Options is missing.');
        onlyKeys(options, ['merge'], 'Options');
        if (options.merge !== undefined && typeof options.merge !== 'boolean') throw bad('Options merge must be true or false.');
      }
      const merge = !isObj(options) || options.merge !== false;
      if (!isObj(input)) throw bad('Action is missing.');
      onlyKeys(input, INPUT_FIELDS, 'An action');
      const stamp = deps.nowTs();
      refuseRemoved(input.status);
      const status = pickEnum(input.status, ACTION_STATUSES, 'Status', 'Draft');
      if (isTerminalStatus(status)) throw bad(`A new action cannot start ${status}.`);
      const scope = cleanScope(input, true);
      const owner = cleanOwner(input.owner);
      const c = {
        title: cleanText(input.title, 'Title', true, TITLE_MAX), detail: cleanText(input.detail, 'Detail', false, LONG_MAX), status,
        priority: pickEnum(input.priority, ACTION_PRIORITIES, 'Priority', 'Medium'),
        source: pickEnum(input.source, ACTION_SOURCES, 'Source', 'manual'),
        source_ref: cleanText(input.source_ref, 'Source reference', false, 200),
        ...scope,
        reason_key: matchKey(cleanText(input.reason_key, 'Reason', false, 200)),
        ...owner,
        assignee: cleanText(input.assignee, 'Assignee', false, 100), due_date: cleanDue(input.due_date), needs_stop: cleanNeedsStop(input.needs_stop),
        root_cause: pickEnum(input.root_cause ?? '', ACTION_ROOT_CAUSES, 'Root cause', ''),
        required_action: cleanText(input.required_action, 'Required action', false, LONG_MAX),
        dedupe_key: cleanText(input.dedupe_key, 'Dedupe key', false, 300),
      };
      if (c.scope_kind !== 'equipment' && c.scope_kind !== 'area') c.reason_key = '';
      if (!c.dedupe_key && c.scope_kind === 'equipment' && c.reason_key) c.dedupe_key = `repeat|${c.equipment_id}|${c.reason_key}`;
      const evidence = cleanEvidence(input.evidence, u.user_id, stamp);
      const templateId = cleanText(input.template_id === null ? '' : input.template_id, 'Template', false, 40);
      const taskIn = cleanTaskList(input.tasks);
      let tmpl: TaskTemplate | null = null;
      if (templateId) {
        tmpl = templates.find((t) => t.template_id === templateId) ?? null;
        if (!tmpl) throw bad(`Task template ${oneLine(templateId, 40)} not found.`);
        if (!tmpl.active && taskIn === null) throw bad(`The template "${tmpl.name}" is switched off.`);
      }
      const inputs = taskIn !== null ? taskIn : tmpl ? templateInputs(tmpl, c.area_id, stamp.slice(0, 10)) : [];
      if (merge && c.dedupe_key) {
        const open = oldestOpen(c.dedupe_key);
        if (open) {
          const m = mergeEvidence(open.evidence, evidence);
          open.evidence = m.list;
          open.updated_at = stamp;
          open.updated_by = u.user_id;
          logs.push(logRow(open.action_id, u.user_id, 'evidence', '', '',
            `Merged instead of a new action (${c.source}): ${c.title}. ${m.added} evidence item${m.added === 1 ? '' : 's'} added.`, stamp));
          let mergedTasks = '';
          if (inputs.length) {
            const built = buildTasks(open.action_id, taskList(open.action_id), inputs, u.user_id, stamp, true);
            if (built.rows.length) {
              storeTasks(open, built, u.user_id, stamp);
              mergedTasks = `, ${built.rows.length} task${built.rows.length === 1 ? '' : 's'} added`;
            }
          }
          deps.audit(u.user_id, 'merge_action', open.action_id, `Merged a new ${c.source} action, ${m.added} evidence items added${mergedTasks}`);
          return { ...result(open), merged: true };
        }
      }
      const a = newAction({ ...c, template_id: templateId }, u.user_id, stamp, evidence);
      const built = buildTasks(a.action_id, [], inputs, u.user_id, stamp, false);
      a.status = deriveActionStatus(a, built.rows);
      actions.push(a);
      tasks.push(...built.rows);
      logs.push(logRow(a.action_id, u.user_id, 'status', '', a.status, `Created (${a.source})`, stamp));
      if (evidence.length) logs.push(logRow(a.action_id, u.user_id, 'evidence', '', '', `${evidence.length} evidence item${evidence.length === 1 ? '' : 's'} added.`, stamp));
      logs.push(...built.logs);
      deps.audit(u.user_id, 'create_action', a.action_id, `${a.status}: ${a.title}${built.rows.length ? ` (${built.rows.length} task${built.rows.length === 1 ? '' : 's'}${tmpl ? `, template ${tmpl.name}` : ''})` : ''}`);
      return { ...result(a), merged: false };
    },

    update(u, actionId, changes) {
      if (!isObj(changes)) throw bad('Changes is missing.');
      onlyKeys(changes, [...EDIT_FIELDS, 'add_evidence'], 'Changes');
      if (!Object.keys(changes).length) throw bad('No changes to save.');
      if ('status' in changes) refuseRemoved(changes.status);
      const stamp = deps.nowTs();
      const id = cleanText(actionId, 'Action', true, 40);
      const row = actions.find((a) => a.action_id === id);
      if (!row) throw new ApiError('Action not found.', 'not_found');
      const mine = taskList(row.action_id);
      const closer = isCloser(u);
      const from = row.status;
      const has = (k: string) => Object.prototype.hasOwnProperty.call(changes, k);
      const next: Partial<Action> = {};
      if (has('title')) next.title = cleanText(changes.title, 'Title', true, TITLE_MAX);
      if (has('detail')) next.detail = cleanText(changes.detail, 'Detail', false, LONG_MAX);
      if (has('required_action')) next.required_action = cleanText(changes.required_action, 'Required action', false, LONG_MAX);
      if (has('priority')) next.priority = pickEnum(changes.priority, ACTION_PRIORITIES, 'Priority');
      if (has('status')) next.status = pickEnum(changes.status, ACTION_STATUSES, 'Status');
      if (has('reason_key')) next.reason_key = matchKey(cleanText(changes.reason_key, 'Reason', false, 200));
      if (has('assignee')) next.assignee = cleanText(changes.assignee, 'Assignee', false, 100);
      if (has('due_date')) next.due_date = cleanDue(changes.due_date);
      if (has('due_date') && mine.length && next.due_date !== row.due_date) {
        throw bad('The due date of an action with tasks follows its tasks: change the due dates of the tasks.');
      }
      if (has('needs_stop')) next.needs_stop = cleanNeedsStop(changes.needs_stop);
      if (has('root_cause')) next.root_cause = pickEnum(changes.root_cause === null ? '' : changes.root_cause, ACTION_ROOT_CAUSES, 'Root cause', '');
      if (has('owner')) Object.assign(next, cleanOwner(changes.owner));
      if (has('scope_kind') || has('area_id') || has('line_id') || has('equipment_id')) {
        const cand = {
          scope_kind: has('scope_kind') ? changes.scope_kind : row.scope_kind,
          area_id: has('area_id') ? changes.area_id : has('equipment_id') || has('scope_kind') ? '' : row.area_id,
          line_id: has('line_id') ? changes.line_id : has('area_id') || has('equipment_id') || has('scope_kind') ? '' : row.line_id,
          equipment_id: has('equipment_id') ? changes.equipment_id : row.equipment_id,
        };
        Object.assign(next, cleanScope(cand, has('equipment_id') || (has('scope_kind') && changes.scope_kind !== row.scope_kind)));
      }
      let to = next.status ?? from;
      const note = has('closure_note') ? cleanText(changes.closure_note, 'Closing note', false, TEXT_MAX) : null;
      const evidence = has('add_evidence') ? cleanEvidence(changes.add_evidence, u.user_id, stamp) : [];

      if ((isTerminalStatus(from) || isTerminalStatus(to)) && !closer) {
        throw new ApiError('Only people on the "Who can close actions" list can close, cancel, reopen or change a closed action.', 'forbidden', true);
      }
      if (isTerminalStatus(from) && !isTerminalStatus(to) && to !== 'Open') throw bad('A closed or cancelled action can only be reopened to Open.');
      // backend 1.7.0: with tasks, Open and In progress follow the tasks; accepting a draft or reopening lands on what they say
      if (mine.length && (to === 'Open' || to === 'In progress')) {
        const target = deriveActionStatus({ action_id: row.action_id, status: 'Open' }, mine);
        if (to !== target && from !== 'Draft' && !isTerminalStatus(from)) {
          throw bad('The status of an action with tasks follows its tasks: it is In progress as soon as a task has started, else Open.');
        }
        to = target;
      }
      if (to === 'Closed' && from !== 'Closed') {
        const stillOpen = mine.filter(isTaskOpen).length;
        if (stillOpen) {
          throw new ApiError(`${stillOpen} task${stillOpen === 1 ? ' is' : 's are'} still open: every task must be Done or Not needed before the action can be closed.`, 'tasks_open');
        }
      }
      if (note !== null && !isTerminalStatus(to)) throw bad('A closing note can only be written when the action is closed or cancelled.');
      if (isTerminalStatus(to) && to !== from && (!note || note.length < NOTE_MIN)) throw bad(`Write a closing note of at least ${NOTE_MIN} characters.`);

      const patch: Partial<Action> = {};
      const edits: string[] = [];
      const show = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : v === '' || v === null || v === undefined ? '(blank)' : String(v));
      const order = ['title', 'detail', 'required_action', 'priority', 'reason_key', 'assignee', 'due_date', 'needs_stop', 'root_cause', 'owner', 'scope_kind', 'area_id', 'line_id', 'equipment_id'] as const;
      for (const k of order) {
        if (!(k in next) || next[k] === row[k]) continue;
        (patch as Record<string, unknown>)[k] = next[k];
        if (k === 'owner') patch.owner_kind = next.owner_kind;
        edits.push(['title', 'detail', 'required_action'].includes(k) ? `${k} changed` : `${k}: ${show(row[k])} -> ${show(next[k])}`);
      }
      if (note !== null && note !== row.closure_note && to === from) {
        patch.closure_note = note;
        edits.push('closing note changed');
      }
      const newLogs: ActionLog[] = [];
      if (to !== from) {
        patch.status = to;
        if (isTerminalStatus(to)) {
          const watch = to === 'Closed' && (patch.scope_kind ?? row.scope_kind) === 'equipment';
          Object.assign(patch, { closed_by: u.user_id, closed_at: stamp, closure_note: note ?? '', effectiveness: watch ? 'Watching' : '', effectiveness_checked_at: watch ? stamp : '' });
        } else if (isTerminalStatus(from)) {
          Object.assign(patch, { closed_by: '', closed_at: '', closure_note: '', effectiveness: '', effectiveness_checked_at: '' });
        }
        newLogs.push(logRow(row.action_id, u.user_id, 'status', from, to, isTerminalStatus(to) ? note ?? '' : isTerminalStatus(from) ? 'Reopened' : '', stamp));
      }
      if (edits.length) newLogs.push(logRow(row.action_id, u.user_id, 'edit', '', '', edits.join('; '), stamp));
      if (evidence.length) {
        const m = mergeEvidence(row.evidence, evidence);
        if (m.added) {
          patch.evidence = m.list;
          newLogs.push(logRow(row.action_id, u.user_id, 'evidence', '', '', `${m.added} evidence item${m.added === 1 ? '' : 's'} added.`, stamp));
        }
      }
      if (!newLogs.length) throw bad('Nothing was changed.');
      Object.assign(row, patch, { updated_at: stamp, updated_by: u.user_id });
      logs.push(...newLogs);
      deps.audit(u.user_id, 'update_action', row.action_id, newLogs.map((l) => (l.kind === 'status'
        ? `status: ${l.from_status || '(new)'} -> ${l.to_status}${l.text ? ` (${l.text.slice(0, 80)})` : ''}`
        : `${l.kind}: ${(l.text || '(blank)').slice(0, 200)}`)).join('. '));
      if (to !== from) syncReady(row);
      return result(row);
    },

    comment(u, actionId, text) {
      const body = cleanText(text, 'Comment', true, LONG_MAX);
      const stamp = deps.nowTs();
      const id = cleanText(actionId, 'Action', true, 40);
      const row = actions.find((a) => a.action_id === id);
      if (!row) throw new ApiError('Action not found.', 'not_found');
      logs.push(logRow(row.action_id, u.user_id, 'comment', '', '', body, stamp));
      row.updated_at = stamp;
      row.updated_by = u.user_id;
      deps.audit(u.user_id, 'comment_action', row.action_id, body.length > 160 ? `${body.slice(0, 159)}…` : body);
      return result(row);
    },

    saveContractors(u, rows) {
      if (!Array.isArray(rows) || !rows.length) throw bad('Send at least one contractor.');
      if (rows.length > 50) throw bad('At most 50 contractors at once.');
      const d = deps.db();
      const seen = new Set<string>();
      const clean: Contractor[] = rows.map((r: unknown) => {
        if (!isObj(r)) throw bad('Each contractor must be an object.');
        onlyKeys(r, ['contractor_id', 'name', 'areas', 'kind', 'active', 'sort_order', 'default_assignee'], 'A contractor');
        const id = typeof r.contractor_id === 'string' ? r.contractor_id.trim() : '';
        if (!CONTRACTOR_ID.test(id)) throw bad('A contractor id must be 1 to 40 letters, digits, spaces, dots, dashes or underscores.');
        if (seen.has(id)) throw bad(`Contractor ${id} is listed twice.`);
        seen.add(id);
        if (!Array.isArray(r.areas)) throw bad('Contractor areas must be a list.');
        const areas: string[] = [];
        for (const a of r.areas) {
          const real = typeof a === 'string' ? d.areas.find((x) => x.area_id.toLowerCase() === a.trim().toLowerCase()) : undefined;
          if (!real) throw bad(`Area "${oneLine(String(a), 40)}" is not in the list of areas.`);
          if (!areas.includes(real.area_id)) areas.push(real.area_id);
        }
        if (typeof r.active !== 'boolean') throw bad('Contractor active must be true or false.');
        const order = r.sort_order === undefined || r.sort_order === null ? 0 : r.sort_order;
        if (typeof order !== 'number' || order % 1 !== 0 || order < 0 || order > 1000) throw bad('Contractor sort order must be a whole number from 0 to 1000.');
        return {
          contractor_id: id, name: cleanText(r.name, 'Contractor name', true, 60), areas, kind: pickEnum(r.kind, ['contractor', 'internal'] as const, 'Contractor kind'),
          active: r.active, sort_order: order, default_assignee: cleanText(r.default_assignee, 'Default assignee', false, 100),
        };
      });
      const after = new Map(contractors.map((c) => [c.contractor_id, c]));
      for (const c of clean) after.set(c.contractor_id, c);
      const owner = new Map<string, string>();
      for (const id of [...after.keys()].sort()) {
        const c = after.get(id)!;
        if (!c.active || c.kind !== 'contractor') continue;
        for (const a of c.areas) {
          const o = owner.get(a);
          if (o && o !== id) throw new ApiError(`Area ${a} would belong to both ${o} and ${id}.`, 'conflict');
          owner.set(a, id);
        }
      }
      for (const c of clean) {
        const at = contractors.findIndex((x) => x.contractor_id === c.contractor_id);
        if (at >= 0) contractors[at] = c; else contractors.push(c);
      }
      deps.audit(u.user_id, 'save_contractors', clean.map((c) => c.contractor_id).join(','), `${clean.length} contractor row(s) saved`);
      return clone([...contractors].sort((a, b) => a.sort_order - b.sort_order || byText(a.contractor_id, b.contractor_id)));
    },

    getTargets(year) {
      if (year !== undefined && year !== null && !(typeof year === 'number' && Number.isInteger(year) && year >= 2000 && year <= 2100)) {
        throw bad('Please give a year such as 2026.');
      }
      const order = new Map(deps.db().areas.map((a) => [a.area_id, a.sort_order]));
      return clone(targets.filter((t) => year === undefined || year === null || t.year === year)
        .sort((a, b) => a.year - b.year || (order.get(a.area_id) ?? 0) - (order.get(b.area_id) ?? 0) || byText(a.area_id, b.area_id)));
    },

    saveTargets(u, year, rows) {
      if (!(typeof year === 'number' && Number.isInteger(year) && year >= 2000 && year <= 2100)) throw bad('Please give a year such as 2026.');
      if (!Array.isArray(rows) || !rows.length) throw bad('Send at least one area.');
      if (rows.length > 100) throw bad('At most 100 areas at once.');
      const d = deps.db();
      const seen = new Set<string>();
      const clean = rows.map((r: unknown): AreaTarget => {
        if (!isObj(r)) throw bad('Each area target must be an object.');
        onlyKeys(r, ['area_id', 'availability_target_pct', 'reliability_target_pct', 'utilization_target_pct', 'planned_allowance_h_year', 'monthly_split', 'overhaul_months'], 'An area target');
        const area = typeof r.area_id === 'string' ? d.areas.find((a) => a.area_id.toLowerCase() === (r.area_id as string).trim().toLowerCase())?.area_id : undefined;
        if (!area) throw bad(`Area "${oneLine(String(r.area_id ?? ''), 40)}" is not in the list of areas.`);
        if (seen.has(area)) throw bad(`Area ${area} is listed twice.`);
        seen.add(area);
        let target = r.availability_target_pct as unknown;
        if (target === undefined || target === '') target = null;
        if (target !== null && !(typeof target === 'number' && Number.isFinite(target) && target >= 0 && target <= 100)) {
          throw bad(`${area}: the availability target must be between 0 and 100, or blank.`);
        }
        // backend 1.9.0: RF / UF targets; a key left out keeps what is stored
        const before = targets.find((t) => t.area_id === area && t.year === year);
        const factor = (key: 'reliability_target_pct' | 'utilization_target_pct', name: string): number | null => {
          if (!(key in r)) return before?.[key] ?? null;
          const v = r[key];
          if (v === '' || v === null || v === undefined) return null;
          if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100)) throw bad(`${area}: the ${name} target must be between 0 and 100, or blank.`);
          return v;
        };
        const rfT = factor('reliability_target_pct', 'reliability factor (RF)');
        const ufT = factor('utilization_target_pct', 'utilization factor (UF)');
        const allowance = r.planned_allowance_h_year;
        if (!(typeof allowance === 'number' && Number.isFinite(allowance) && allowance >= 0 && allowance <= 8784)) {
          throw bad(`${area}: the planned allowance must be between 0 and 8784 hours a year.`);
        }
        let split = r.monthly_split as unknown;
        if (split === undefined || split === null) split = evenMonthlySplit(allowance);
        if (!Array.isArray(split) || split.length !== 12 || !split.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
          throw bad(`${area}: the monthly split must be 12 numbers of 0 or more.`);
        }
        const sum = (split as number[]).reduce((s, n) => s + n, 0);
        if (Math.abs(sum - allowance) > SPLIT_TOLERANCE + 1e-9) throw bad(`${area}: the months add up to ${r2(sum)} h, not the ${allowance} h allowed in the year.`);
        const months = r.overhaul_months === undefined || r.overhaul_months === null ? [] : r.overhaul_months;
        if (!Array.isArray(months) || !months.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 12)) {
          throw bad(`${area}: overhaul months must be month numbers from 1 to 12.`);
        }
        return {
          area_id: area, year, availability_target_pct: target as number | null, reliability_target_pct: rfT, utilization_target_pct: ufT,
          planned_allowance_h_year: allowance, monthly_split: [...(split as number[])],
          overhaul_months: [...new Set(months as number[])].sort((a, b) => a - b), updated_at: '', updated_by: u.user_id,
        };
      });
      const stamp = deps.nowTs();
      for (const c of clean) {
        c.updated_at = stamp;
        const at = targets.findIndex((t) => t.area_id === c.area_id && t.year === year);
        if (at >= 0) targets[at] = c; else targets.push(c);
      }
      deps.audit(u.user_id, 'save_area_targets', String(year), clean.map((c) => c.area_id).join(','));
      return store.getTargets(year);
    },

    runChecks() {
      const st = settings();
      const stamp = deps.nowTs();
      const res: ActionCheckResult = { created: 0, merged: 0, effectiveness: 0 };
      const d = deps.db();
      // backend 1.5.0: records of an area switched off are left out of every rule
      const inactive = new Set(d.areas.filter((a) => !a.active).map((a) => a.area_id));
      const events = d.events.filter((e) => !e.is_void && !inactive.has(e.area_id));
      let latest = '';
      for (const e of events) if (isValidDate(e.event_date) && e.event_date > latest) latest = e.event_date;
      const index = deps.index();
      const x: RuleCtx = {
        chains: buildFailureEvents(events).chains, index, latest, cutoff: latest ? addDays(latest, -deps.retentionDays()) : '',
        lineOf: (area, fallback = '') => d.areas.find((a) => a.area_id === area)?.line_id ?? fallback,
      };
      if (st.autoDraft && latest) {
        const notifications = deps.notifications();
        const drafts = [
          ...ruleRepeat(x, st), ...ruleChronic(x, st), ...ruleLongStop(x, notifications),
          ...rulePlanned(plannedOverruns(events, d.areas, targets, latest, x.cutoff), notifications),
        ];
        for (const dr of drafts) {
          const items: ActionEvidence[] = dr.eventIds.map((id) => ({ event_id: id, added_at: stamp, added_by: 'system' }));
          const open = oldestOpen(dr.dedupe_key);
          if (open) {
            const m = mergeEvidence(open.evidence, items);
            if (!m.added) continue;
            open.evidence = m.list;
            open.updated_at = stamp;
            open.updated_by = 'system';
            logs.push(logRow(open.action_id, 'system', 'evidence', '', '', `Rule ${dr.source}: ${m.added} new record${m.added === 1 ? '' : 's'} added as evidence.`, stamp));
            res.merged++;
            continue;
          }
          const same = actions.filter((a) => a.dedupe_key === dr.dedupe_key);
          if (same.length) {
            const lastClosed = same.reduce((mx, a) => (a.closed_at > mx ? a.closed_at : mx), '');
            if (dr.source !== 'auto_repeat' || !(dr.latestTs > lastClosed)) continue;
          }
          const owner = contractorFor(dr.area_id);
          const tmpl = templateFor(dr.source);
          const a = newAction({
            title: oneLine(dr.title, TITLE_MAX), detail: oneLine(dr.detail, LONG_MAX), status: 'Draft', priority: dr.priority, source: dr.source,
            source_ref: dr.source_ref, scope_kind: dr.scope_kind, area_id: dr.area_id, line_id: dr.line_id, equipment_id: dr.equipment_id,
            reason_key: dr.reason_key, owner_kind: owner ? 'contractor' : 'internal', owner: owner?.contractor_id ?? '', assignee: owner?.default_assignee ?? '',
            due_date: '', needs_stop: false, root_cause: '', required_action: '', dedupe_key: dr.dedupe_key, template_id: tmpl?.template_id ?? '',
          }, 'system', stamp, items);
          actions.push(a);
          logs.push(logRow(a.action_id, 'system', 'status', '', 'Draft', `Drafted by rule ${dr.source}${tmpl ? ` with the tasks of template ${tmpl.name}` : ''}`, stamp));
          if (tmpl) {
            // backend 1.7.0: the draft gets the tasks of the template that applies to its rule (proposed, Open)
            const built = buildTasks(a.action_id, [], templateInputs(tmpl, dr.area_id, stamp.slice(0, 10)), 'system', stamp, false);
            tasks.push(...built.rows);
            logs.push(...built.logs);
          }
          res.created++;
        }
      }
      for (const a of actions) {
        if (a.status !== 'Closed' || a.scope_kind !== 'equipment' || a.effectiveness === 'Effective' || a.effectiveness === 'Not effective') continue;
        if (a.area_id && inactive.has(a.area_id)) continue; // not judged while its area is switched off
        const e = effectivenessOf(x, a, st.effectDays);
        if (!e || e.verdict === a.effectiveness) continue;
        a.effectiveness = e.verdict;
        a.effectiveness_checked_at = stamp;
        if (e.text) logs.push(logRow(a.action_id, 'system', 'edit', '', '', e.text, stamp));
        res.effectiveness++;
      }
      return res;
    },

    addTask(u, actionId, task) {
      const stamp = deps.nowTs();
      const row = findAction(actionId);
      if (isTerminalStatus(row.status)) throw bad(`The action is ${row.status.toLowerCase()}: reopen it before adding tasks.`);
      const c = cleanTaskInput(task);
      const built = buildTasks(row.action_id, taskList(row.action_id), [c], u.user_id, stamp, false);
      const f = storeTasks(row, built, u.user_id, stamp);
      const t = built.rows[0]!;
      deps.audit(u.user_id, 'create_task', t.task_id, `${row.action_id}: ${taskCreateText(t)}${f ? `. Action status: ${f.from} -> ${f.to}` : ''}`);
      return taskResult(row, t.task_id);
    },

    updateTask(u, taskId, changes) {
      if (!isObj(changes)) throw bad('Changes is missing.');
      onlyKeys(changes, TASK_CHANGE_FIELDS, 'Changes');
      if (!Object.keys(changes).length) throw bad('No changes to save.');
      const stamp = deps.nowTs();
      const id = cleanText(taskId, 'Task', true, 40);
      const task = tasks.find((t) => t.task_id === id);
      if (!task) throw new ApiError('Task not found.', 'not_found');
      const row = findAction(task.action_id);
      const has = (k: string) => Object.prototype.hasOwnProperty.call(changes, k);
      if (isTerminalStatus(row.status) && Object.keys(changes).some((k) => k !== 'note')) {
        throw bad(`The action is ${row.status.toLowerCase()}: reopen it before changing its tasks. A note can still be added.`);
      }
      const next: Partial<ActionTask> = {};
      if (has('title')) next.title = cleanText(changes.title, 'Task title', true, TASK_TITLE_MAX);
      if (has('assignee')) next.assignee = cleanText(changes.assignee, 'Person', false, 100);
      if (has('due_date')) next.due_date = cleanDue(changes.due_date);
      if (has('notes')) next.notes = cleanText(changes.notes, 'Task notes', false, LONG_MAX);
      if (has('owner')) Object.assign(next, cleanOwner(changes.owner));
      if (has('needs_stop')) next.needs_stop = cleanNeedsStop(changes.needs_stop);
      if (has('est_stop_h')) next.est_stop_h = cleanEst(changes.est_stop_h);
      const to: TaskStatus = has('status') ? pickEnum(changes.status, TASK_STATUSES, 'Task status') : task.status;
      const note = has('note') ? cleanText(changes.note, 'Note', false, LONG_MAX) : '';
      const ownerKind = next.owner_kind ?? task.owner_kind;
      const from = task.status;
      if (to === 'Contractor informed' && ownerKind !== 'contractor') throw bad('Contractor informed is only for a task owned by an external contractor.');
      if (to !== from && to === 'Done' && note.length < TASK_NOTE_MIN) throw bad(`Write what was done (at least ${TASK_NOTE_MIN} characters).`);
      if (to !== from && to === 'Not needed' && note.length < TASK_NOTE_MIN) throw bad(`Write why the task is not needed (at least ${TASK_NOTE_MIN} characters).`);
      const needsAfter = next.needs_stop ?? task.needs_stop;
      const estBefore = task.needs_stop ? task.est_stop_h : null;
      if (has('needs_stop') || has('est_stop_h')) next.est_stop_h = needsAfter ? (has('est_stop_h') ? next.est_stop_h ?? null : estBefore) : null;

      const patch: Partial<ActionTask> = {};
      const edits: string[] = [];
      for (const k of ['title', 'owner', 'assignee', 'due_date', 'needs_stop', 'est_stop_h', 'notes'] as const) {
        if (next[k] === undefined) continue;
        const old = k === 'est_stop_h' ? estBefore : task[k];
        if (next[k] === old) continue;
        (patch as Record<string, unknown>)[k] = next[k];
        if (k === 'owner') patch.owner_kind = next.owner_kind;
        edits.push(k === 'title' || k === 'notes' ? `${k} changed` : `${k}: ${showValue(old)} -> ${showValue(next[k])}`);
      }
      const newLogs: ActionLog[] = [];
      if (to !== from) {
        patch.status = to;
        if (TASK_CLOSED_STATUSES.includes(to)) Object.assign(patch, { done_at: stamp, done_by: u.user_id, done_note: note });
        else if (TASK_CLOSED_STATUSES.includes(from)) Object.assign(patch, { done_at: '', done_by: '', done_note: '' });
        newLogs.push(logRow(row.action_id, u.user_id, 'task_status', from, to, note, stamp, task.task_id));
      } else if (note) {
        newLogs.push(logRow(row.action_id, u.user_id, 'task_note', '', '', note, stamp, task.task_id));
      }
      if (edits.length) newLogs.push(logRow(row.action_id, u.user_id, 'task_edit', '', '', `#${task.seq} ${edits.join('; ')}`, stamp, task.task_id));
      if (!newLogs.length) throw bad('Nothing was changed.');
      Object.assign(task, patch, { updated_at: stamp, updated_by: u.user_id });
      const f = follow(row, taskList(row.action_id), u.user_id, stamp);
      Object.assign(row, { updated_at: stamp, updated_by: u.user_id });
      if (f) { row.status = f.to; newLogs.push(f.log); }
      logs.push(...newLogs);
      syncReady(row);
      const said: string[] = [];
      if (to !== from) said.push(`status: ${from} -> ${to}${note ? ` (${auditVal(note, 80)})` : ''}`);
      else if (note) said.push(`note: ${auditVal(note, 160)}`);
      if (edits.length) said.push(edits.join('; '));
      if (f) said.push(`action status: ${f.from} -> ${f.to}`);
      deps.audit(u.user_id, 'update_task', task.task_id, `${row.action_id} #${task.seq}: ${said.join('; ')}`);
      return taskResult(row, task.task_id);
    },

    applyTemplate(u, actionId, templateId) {
      const tid = cleanText(templateId, 'Template', true, 40);
      const stamp = deps.nowTs();
      const row = findAction(actionId);
      if (isTerminalStatus(row.status)) throw bad(`The action is ${row.status.toLowerCase()}: reopen it before adding tasks.`);
      const tmpl = templates.find((t) => t.template_id === tid);
      if (!tmpl) throw new ApiError('Task template not found.', 'not_found');
      if (!tmpl.active) throw bad(`The template "${tmpl.name}" is switched off.`);
      const built = buildTasks(row.action_id, taskList(row.action_id), templateInputs(tmpl, row.area_id, stamp.slice(0, 10)), u.user_id, stamp, true);
      if (!built.rows.length) return taskResult(row, '', 0);
      const f = storeTasks(row, built, u.user_id, stamp, row.template_id ? {} : { template_id: tmpl.template_id });
      const n = built.rows.length;
      deps.audit(u.user_id, 'apply_template', row.action_id, `Template ${tmpl.name}: ${n} task${n === 1 ? '' : 's'} added (${built.rows.map((t) => t.title).join(', ')})${f ? `. Action status: ${f.from} -> ${f.to}` : ''}`);
      return taskResult(row, '', n);
    },

    listTasks(u, filter) {
      const f = filter === undefined || filter === null ? {} : filter;
      if (!isObj(f)) throw bad('Filter is missing.');
      onlyKeys(f, TASK_FILTER_FIELDS, 'Filter');
      for (const k of ['mine', 'overdue', 'needs_stop', 'include_drafts']) {
        if (f[k] !== undefined && f[k] !== null && typeof f[k] !== 'boolean') throw bad(`Filter ${k} must be true or false.`);
      }
      const status = f.status === undefined || f.status === null || f.status === '' ? 'open' : f.status;
      if (Array.isArray(status)) {
        for (const s of status) if (!(TASK_STATUSES as readonly unknown[]).includes(s)) throw bad(`Filter status must be one of: ${TASK_STATUSES.join(', ')}.`);
      } else if (!['open', 'closed', 'all'].includes(status as string)) {
        throw bad('Filter status must be open, closed, all or a list of task statuses.');
      }
      const txt = (k: string) => cleanText(f[k] === null ? '' : f[k], `Filter ${k}`, false, 100);
      const owner = txt('owner'), assignee = txt('assignee'), area = txt('area_id'), line = txt('line_id'), actionF = txt('action_id');
      const doneSince = cleanText(f.done_since === null ? '' : f.done_since, 'Filter done_since', false, 20);
      if (doneSince && !isValidDate(doneSince)) throw bad('Filter done_since must be a date like 2026-07-01.');
      const day = today();
      const waiting = new Map<string, string>();
      for (const l of logs) {
        if (l.kind === 'task_status' && l.to_status === 'Waiting stoppage' && l.task_id && !((waiting.get(l.task_id) ?? '') > l.at)) waiting.set(l.task_id, l.at);
      }
      const byId = new Map(actions.map((a) => [a.action_id, a]));
      const list: TaskView[] = [];
      for (const t of [...tasks].sort((a, b) => byText(a.action_id, b.action_id) || a.seq - b.seq || byText(a.task_id, b.task_id))) {
        const a = byId.get(t.action_id);
        if (!a || a.status === 'Cancelled' || (a.status === 'Draft' && f.include_drafts !== true)) continue;
        const open = isTaskOpen(t);
        if (status === 'open' && !open) continue;
        if (status === 'closed' && open) continue;
        if (Array.isArray(status) && !status.includes(t.status)) continue;
        const overdue = open && !!t.due_date && t.due_date < day;
        if (f.mine === true && t.assignee !== u.user_id) continue;
        if (f.overdue === true && !overdue) continue;
        if (f.needs_stop === true && !t.needs_stop) continue;
        if (owner && t.owner !== owner) continue;
        if (assignee && t.assignee !== assignee) continue;
        if (area && a.area_id !== area) continue;
        if (line && a.line_id !== line) continue;
        if (actionF && t.action_id !== actionF) continue;
        if (doneSince && !(t.done_at.slice(0, 10) >= doneSince)) continue;
        list.push({
          ...t, action_title: a.title, action_status: a.status, action_assignee: a.assignee, action_owner: a.owner, area_id: a.area_id, line_id: a.line_id,
          equipment_id: a.equipment_id, overdue, waiting_since: t.status === 'Waiting stoppage' ? waiting.get(t.task_id) ?? t.updated_at : '',
        });
      }
      list.sort((a, b) => {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        if (a.due_date !== b.due_date) return !a.due_date ? 1 : !b.due_date ? -1 : byText(a.due_date, b.due_date);
        return byText(a.action_id, b.action_id) || a.seq - b.seq || byText(a.task_id, b.task_id);
      });
      return clone({ tasks: list, today: day });
    },

    listTemplates: () => clone(sortedTemplates()),

    saveTemplates(u, list) {
      if (!Array.isArray(list) || !list.length) throw bad('Send at least one template.');
      if (list.length > TEMPLATES_MAX) throw bad(`At most ${TEMPLATES_MAX} templates at once.`);
      const seenIds = new Set<string>();
      const clean = list.map((t: unknown): Omit<TaskTemplate, 'updated_at' | 'updated_by'> => {
        if (!isObj(t)) throw bad('Each template must be an object.');
        onlyKeys(t, ['template_id', 'name', 'applies_to', 'active', 'sort_order', 'steps', 'updated_at', 'updated_by'], 'A template');
        const id = cleanText(t.template_id === null ? '' : t.template_id, 'Template id', false, 40);
        if (id && !/^TT-[A-Za-z0-9_-]{1,37}$/.test(id)) throw bad('A template id must look like TT-REPEAT.');
        if (id && seenIds.has(id)) throw bad(`Template ${id} is listed twice.`);
        if (id) seenIds.add(id);
        const name = cleanText(t.name, 'Template name', true, 80);
        if (!Array.isArray(t.applies_to)) throw bad(`${name}: "suggested first for" must be a list.`);
        const applies: ActionSource[] = [];
        for (const s of t.applies_to) {
          if (!(ACTION_SOURCES as readonly unknown[]).includes(s)) throw bad(`${name}: "${oneLine(String(s), 40)}" is not an action source.`);
          if (!applies.includes(s as ActionSource)) applies.push(s as ActionSource);
        }
        if (typeof t.active !== 'boolean') throw bad(`${name}: active must be true or false.`);
        const order = t.sort_order === undefined || t.sort_order === null ? 0 : t.sort_order;
        if (typeof order !== 'number' || order % 1 !== 0 || order < 0 || order > 1000) throw bad(`${name}: sort order must be a whole number from 0 to 1000.`);
        if (!Array.isArray(t.steps) || !t.steps.length) throw bad(`${name}: add at least one task.`);
        if (t.steps.length > TEMPLATE_STEPS_MAX) throw bad(`${name}: at most ${TEMPLATE_STEPS_MAX} tasks.`);
        const titles = new Set<string>();
        const steps = t.steps.map((s: unknown, i: number): TaskTemplateStep => {
          if (!isObj(s)) throw bad(`${name}: each task must be an object.`);
          onlyKeys(s, ['seq', 'title', 'default_owner', 'due_offset_days', 'needs_stop', 'est_stop_h'], `${name}: a task`);
          const title = cleanText(s.title, `${name}: task title`, true, TASK_TITLE_MAX);
          const owner = cleanText(s.default_owner, `${name}: default owner`, true, 40);
          if (owner !== AREA_CONTRACTOR && !contractors.some((c) => c.contractor_id === owner && c.active)) {
            throw bad(`${name}: default owner "${oneLine(owner, 40)}" is not area_contractor or an active contractor or team.`);
          }
          const days = s.due_offset_days === undefined || s.due_offset_days === null ? 0 : s.due_offset_days;
          if (typeof days !== 'number' || days % 1 !== 0 || days < 0 || days > 365) throw bad(`${name}: due after must be a whole number of days from 0 to 365.`);
          const needs = cleanNeedsStop(s.needs_stop);
          const est = cleanEst(s.est_stop_h);
          if (titles.has(title.toLowerCase())) throw bad(`${name}: the task "${title}" is listed twice.`);
          titles.add(title.toLowerCase());
          return { seq: i + 1, title, default_owner: owner, due_offset_days: days, needs_stop: needs, est_stop_h: needs ? est : null };
        });
        return { template_id: id, name, applies_to: applies, active: t.active, sort_order: order, steps };
      });
      const stamp = deps.nowTs();
      const byId = new Map(templates.map((t) => [t.template_id, t]));
      for (const c of clean) {
        if (c.template_id && !byId.has(c.template_id)) throw new ApiError(`Template ${c.template_id} not found.`, 'not_found');
        if (!c.template_id) do { c.template_id = `TT-${(++templateCounter).toString(16).toUpperCase().padStart(8, '0')}`; } while (byId.has(c.template_id));
      }
      const after = new Map<string, Pick<TaskTemplate, 'name' | 'active' | 'applies_to'>>(templates.map((t) => [t.template_id, t]));
      for (const c of clean) after.set(c.template_id, c);
      const names = new Map<string, string>();
      const owners = new Map<string, string>();
      for (const id of [...after.keys()].sort()) {
        const t = after.get(id)!;
        const k = t.name.toLowerCase();
        if (names.has(k) && names.get(k) !== id) throw new ApiError(`Two templates would be called "${t.name}".`, 'conflict');
        names.set(k, id);
        if (!t.active) continue;
        for (const s of t.applies_to) {
          const o = owners.get(s);
          if (o && o !== id) throw new ApiError(`Source ${s} would be suggested by both "${after.get(o)!.name}" and "${t.name}".`, 'conflict');
          owners.set(s, id);
        }
      }
      const stepText = (steps: TaskTemplateStep[]) => steps.map((s) => `${s.title} (${s.default_owner}, +${s.due_offset_days} d${s.needs_stop ? `, stop${s.est_stop_h !== null ? ` ${s.est_stop_h} h` : ''}` : ''})`).join(', ');
      const said: string[] = [];
      for (const c of clean) {
        const old = byId.get(c.template_id);
        const rec: TaskTemplate = { ...c, updated_at: stamp, updated_by: u.user_id };
        const at = templates.findIndex((t) => t.template_id === c.template_id);
        if (at >= 0) templates[at] = rec; else templates.push(rec);
        if (!old) {
          said.push(`${c.template_id} added: ${c.name} (${c.steps.length} tasks: ${stepText(c.steps)})`);
          continue;
        }
        const parts: string[] = [];
        const pairs: [string, unknown, unknown][] = [['name', old.name, c.name], ['applies_to', old.applies_to.join(','), c.applies_to.join(',')], ['active', old.active, c.active], ['sort_order', old.sort_order, c.sort_order]];
        for (const [k, a, b] of pairs) if (auditVal(a, 500) !== auditVal(b, 500)) parts.push(`${k}: ${auditVal(a, 80)} -> ${auditVal(b, 80)}`);
        const o = stepText(old.steps), n = stepText(c.steps);
        if (o !== n) parts.push(`tasks: ${auditVal(o, 150)} -> ${auditVal(n, 150)}`);
        if (parts.length) said.push(`${c.template_id} ${parts.join('; ')}`);
      }
      deps.audit(u.user_id, 'save_task_templates', clean.map((c) => c.template_id).join(','), said.join('. ') || 'No change');
      return clone(sortedTemplates());
    },

    isCloser,
    actions: () => actions,
    tasks: () => tasks,
    targets: () => targets,

    cleanClosers(value) {
      const users = new Set(deps.db().users.map((x) => x.user_id));
      const ids: string[] = [];
      for (const id of csv(value)) {
        if (!users.has(id)) throw bad(`Setting actions_closers: there is no user ${id.slice(0, 40)}.`);
        if (!ids.includes(id)) ids.push(id);
      }
      return ids.join(',');
    },
  };
  return store;
}

