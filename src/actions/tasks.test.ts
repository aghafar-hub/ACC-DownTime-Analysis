import { describe, expect, it } from 'vitest';
import type { Action, ActionLog, ActionTask, Contractor, TaskTemplate } from '../api/types';
import { dropRule, dueInfo, emptyFilters, filterActions, nextStatus, sortActions, statusOptions, taskTally } from './model';
import {
  buildTaskViews, draftsFromTemplate, draftsToTasks, filterTasks, nextTask, openOwners, overdueTaskCount, parseTaskFilters, quickCounts, resolveStepOwner,
  shutdownGroups, shutdownTable, shutdownTotals, sortTaskViews, suggestedTemplate, taskDueInfo, taskNoteProblem, taskStatusOptions, taskSummary, tasksTable,
  templateProblem, templateInput, titleWithoutCode, waitingSince, writeTaskFilters,
} from './tasks';

const TODAY = '2026-10-14';
let n = 0;
const act = (over: Partial<Action> = {}): Action => ({
  action_id: `AC-202610-${String(++n).padStart(4, '0')}`, title: '131.BC100 - Belt torn', detail: '', status: 'In progress', priority: 'Medium', source: 'manual', source_ref: '',
  scope_kind: 'equipment', area_id: 'K.1', line_id: 'L.1', equipment_id: '131.BC100', reason_key: 'belt torn', owner_kind: 'contractor', owner: 'RHI',
  assignee: 'U-1', due_date: '', needs_stop: false, root_cause: '', required_action: '', created_by: 'U-1', created_at: '2026-10-01 08:00:00.000',
  updated_at: '2026-10-01 08:00:00.000', updated_by: 'U-1', closed_by: '', closed_at: '', closure_note: '', effectiveness: '', effectiveness_checked_at: '',
  evidence: [], dedupe_key: '', ...over,
});
let m = 0;
const task = (a: Action, over: Partial<ActionTask> = {}): ActionTask => ({
  task_id: `AT-${String(++m).padStart(12, '0')}`, action_id: a.action_id, seq: m, title: `Task ${m}`, owner_kind: 'contractor', owner: 'RHI', assignee: '', due_date: '',
  status: 'Open', needs_stop: false, est_stop_h: null, notes: '', template_step: '', created_at: '2026-10-02 08:00:00.000', created_by: 'U-1',
  updated_at: '2026-10-02 08:00:00.000', updated_by: 'U-1', done_at: '', done_by: '', done_note: '', ...over,
});
const contractors: Contractor[] = [
  { contractor_id: 'RHI', name: 'RHI', areas: ['K.1', 'RM.1'], kind: 'contractor', active: true, sort_order: 1, default_assignee: 'U-9' },
  { contractor_id: 'ASEC', name: 'ASEC', areas: ['CM.1'], kind: 'contractor', active: true, sort_order: 2, default_assignee: '' },
  { contractor_id: 'MEC', name: 'Mechanical', areas: [], kind: 'internal', active: true, sort_order: 3, default_assignee: 'U-2' },
];
const people = [{ user_id: 'U-1', display_name: 'A. Ghafar' }, { user_id: 'U-2', display_name: 'O. Hamdy' }];
const areas = [{ area_id: 'K.1', name: 'Kiln 1', line_id: 'L.1' }, { area_id: 'CM.1', name: 'Cement Mill 1', line_id: 'L.1' }];

describe('task status rules', () => {
  it('Contractor informed only for an external contractor; Done needs a note, Not needed a reason', () => {
    const team = taskStatusOptions({ status: 'Open', owner_kind: 'internal' });
    expect(team.find((o) => o.status === 'Contractor informed')!.allowed).toBe(false);
    expect(team.find((o) => o.status === 'Open')).toMatchObject({ allowed: false, current: true });
    expect(taskStatusOptions({ status: 'Open', owner_kind: 'contractor' }).find((o) => o.status === 'Contractor informed')!.allowed).toBe(true);
    expect(taskNoteProblem('Done', 'ok')).toMatch(/what was done/);
    expect(taskNoteProblem('Not needed', '  ')).toMatch(/not needed/);
    expect(taskNoteProblem('Done', 'Fixed it')).toBeNull();
    expect(taskNoteProblem('In progress', '')).toBeNull();
  });
  it('due words: done, not needed, overdue, soon', () => {
    expect(taskDueInfo({ status: 'Done', due_date: '2026-10-01', done_at: '2026-10-08 10:00:00' }, TODAY)).toMatchObject({ tone: 'done', text: 'Done 8 Oct' });
    expect(taskDueInfo({ status: 'Open', due_date: '2026-10-12', done_at: '' }, TODAY)).toMatchObject({ tone: 'overdue', text: '2 d overdue' });
    expect(taskDueInfo({ status: 'Open', due_date: '2026-10-25', done_at: '' }, TODAY)).toMatchObject({ tone: 'ok', text: 'Due 25 Oct' });
    expect(taskDueInfo({ status: 'Not needed', due_date: '2026-10-22', done_at: '' }, TODAY).tone).toBe('notneeded');
  });
});

describe('the action follows its tasks', () => {
  const a = act();
  it('next step: Draft -> Open (accept); then Closed only for a closer with every task done', () => {
    expect(nextStatus({ status: 'Draft' }, false, { total: 3, open: 3 })).toBe('Open');
    expect(nextStatus({ status: 'In progress' }, true, { total: 3, open: 1 })).toBeNull();
    expect(nextStatus({ status: 'In progress' }, true, { total: 3, open: 0 })).toBe('Closed');
    expect(nextStatus({ status: 'In progress' }, false, { total: 3, open: 0 })).toBeNull();
    // without tasks: as before
    expect(nextStatus({ status: 'Open' }, false)).toBe('In progress');
  });
  it('status options: Open / In progress follow the tasks, Closed waits for the open tasks', () => {
    const o = statusOptions({ status: 'In progress' }, true, { total: 3, open: 2 });
    expect(o.find((x) => x.status === 'Open')).toMatchObject({ allowed: false, note: 'follows the tasks' });
    expect(o.find((x) => x.status === 'Closed')).toMatchObject({ allowed: false, note: '2 tasks still open' });
    expect(o.find((x) => x.status === 'Cancelled')!.allowed).toBe(true);
    expect(statusOptions({ status: 'Draft' }, false, { total: 1, open: 1 }).find((x) => x.status === 'Open')!.allowed).toBe(true);
    expect(statusOptions({ status: 'Closed' }, true, { total: 1, open: 0 }).filter((x) => x.allowed).map((x) => x.status)).toEqual(['Open']);
  });
  it('board drops: no dragging between Open and In progress with tasks; accept, close (all done) and cancel stay manual', () => {
    expect(dropRule(a, 'In progress', { total: 2, open: 2 }, true)).toMatchObject({ kind: 'refuse', text: expect.stringContaining('follows its tasks') });
    expect(dropRule({ ...a, status: 'Draft' }, 'Open', { total: 2, open: 2 }, false)).toEqual({ kind: 'update' });
    expect(dropRule(a, 'Closed', { total: 2, open: 1 }, true)).toMatchObject({ kind: 'refuse', text: expect.stringContaining('1 task is still open') });
    expect(dropRule(a, 'Closed', { total: 2, open: 0 }, true)).toEqual({ kind: 'dialog', to: 'Closed' });
    expect(dropRule(a, 'Closed', { total: 2, open: 0 }, false).kind).toBe('refuse');
    expect(dropRule(a, 'Cancelled', { total: 2, open: 2 }, true)).toEqual({ kind: 'dialog', to: 'Cancelled' });
    expect(dropRule({ ...a, status: 'Closed' }, 'In progress', { total: 2, open: 0 }, true)).toEqual({ kind: 'dialog', to: 'Open' });
    expect(dropRule({ ...a, status: 'Open' }, 'In progress', { total: 0, open: 0 }, false)).toEqual({ kind: 'update' });
  });
  it('the due date shown is the derived one; tally counts open tasks', () => {
    expect(dueInfo({ status: 'Open', due_date: '', due_date_derived: '2026-10-10' }, TODAY).tone).toBe('overdue');
    const t1 = task(a, { status: 'Done' });
    const t2 = task(a);
    expect(taskTally(a.action_id, [t1, t2])).toEqual({ total: 2, open: 1 });
  });
});

describe('board helpers', () => {
  const a = act();
  const b = act({ status: 'Open' });
  const d = act({ status: 'Draft' });
  const ts = [
    task(a, { status: 'Done' }),
    task(a, { owner: 'MEC', owner_kind: 'internal', due_date: '2026-10-20', status: 'In progress' }),
    task(a, { due_date: '2026-10-12', needs_stop: true, est_stop_h: 6 }),
    task(b, { due_date: '2026-10-30' }),
    task(d, { due_date: '2026-10-01' }),
  ];
  it('next task = the open one due first; open owners in task order', () => {
    expect(nextTask(a.action_id, ts)!.task_id).toBe(ts[2]!.task_id);
    expect(openOwners(a.action_id, ts)).toEqual(['MEC', 'RHI']);
  });
  it('summary and the badge count accepted, open actions only (drafts proposed tasks are left out)', () => {
    const s = taskSummary([a, b, d], ts, TODAY);
    expect(s).toMatchObject({ open: 3, closed: 1, overdue: 1, overdueActions: 1, ready: 0, needsStop: 1, stopHours: 6, openActions: 2 });
    expect(s.byStatus['In progress']).toBe(1);
    expect(overdueTaskCount([a, b, d], ts, TODAY)).toBe(1);
    const ready = act();
    expect(taskSummary([ready], [task(ready, { status: 'Done' }), task(ready, { status: 'Not needed' })], TODAY).ready).toBe(1);
  });
  it('filters: task owner, has overdue tasks, ready to close, my task; sort by next task due', () => {
    const env = { today: TODAY, me: 'U-7', contractors, people, tasks: ts };
    expect(filterActions([a, b, d], { ...emptyFilters(), taskOwners: ['MEC'] }, env)).toEqual([a]);
    expect(filterActions([a, b, d], { ...emptyFilters(), taskOverdue: true }, env)).toEqual([a]);
    expect(filterActions([a, b], { ...emptyFilters(), ready: true }, env)).toEqual([]);
    expect(filterActions([a, b, d], { ...emptyFilters(), mine: true }, { ...env, tasks: [...ts, task(b, { assignee: 'U-7' })] })).toEqual([b]);
    expect(sortActions([b, a], 'next', ts).map((x) => x.action_id)).toEqual([a.action_id, b.action_id]);
  });
});

describe('the Tasks list', () => {
  const a = act({ assignee: 'U-1' });
  const draft = act({ status: 'Draft' });
  const gone = act({ status: 'Cancelled' });
  const ts = [
    task(a, { title: 'Replace chain links', assignee: 'U-1', due_date: '2026-10-11', status: 'Contractor informed', needs_stop: true, est_stop_h: 8 }),
    task(a, { title: 'Root cause', owner: 'MEC', owner_kind: 'internal', due_date: '2026-10-20' }),
    task(a, { title: 'Spare parts', status: 'Done', done_at: '2026-10-10 09:00:00.000', done_note: 'In store' }),
    task(a, { title: 'Old', status: 'Done', done_at: '2026-01-10 09:00:00.000' }),
    task(a, { title: 'No date' }),
    task(draft, { title: 'Proposed' }),
    task(gone, { title: 'Cancelled one' }),
  ];
  const logs: ActionLog[] = [
    { log_id: 'L1', action_id: a.action_id, at: '2026-10-05 08:00:00.000', by: 'U-1', kind: 'task_status', from_status: 'Open', to_status: 'Waiting stoppage', text: '', task_id: ts[0]!.task_id },
  ];
  const views = buildTaskViews([a, draft, gone], ts, logs, TODAY);
  const env = { today: TODAY, me: 'U-1', contractors, people };
  it('leaves out drafts and cancelled actions; overdue first, no date last', () => {
    expect(views.map((v) => v.title)).toEqual(['Replace chain links', 'Root cause', 'No date', 'Spare parts', 'Old'].filter((x) => views.some((v) => v.title === x)).sort((x, y) => views.findIndex((v) => v.title === x) - views.findIndex((v) => v.title === y)));
    expect(views[0]!.title).toBe('Replace chain links');
    expect(views[0]!.overdue).toBe(true);
    expect(views.some((v) => v.title === 'Proposed' || v.title === 'Cancelled one')).toBe(false);
    expect(views.find((v) => v.title === 'No date')).toBeDefined();
    const open = views.filter((v) => v.status !== 'Done');
    expect(open[open.length - 1]!.title).toBe('No date');
  });
  it('quick filters and their counts; Done · 90 d keeps the recent ones only', () => {
    const f = parseTaskFilters(new URLSearchParams());
    expect(quickCounts(views, env)).toEqual({ mine: 1, open: 3, overdue: 1, stop: 1, done: 1 });
    expect(filterTasks(views, { ...f, quick: 'done' }, env).map((v) => v.title)).toEqual(['Spare parts']);
    expect(filterTasks(views, { ...f, owner: 'MEC' }, env).map((v) => v.title)).toEqual(['Root cause']);
    expect(filterTasks(views, { ...f, q: 'chain' }, env)).toHaveLength(1);
    expect(filterTasks(views, { ...f, status: 'Done' }, env)).toHaveLength(2);
  });
  it('filters round-trip through the address; sorting by task title', () => {
    const f = { ...parseTaskFilters(new URLSearchParams()), quick: 'overdue' as const, owner: 'RHI', stop: true, sort: 'task' as const, dir: 'desc' as const };
    expect(parseTaskFilters(writeTaskFilters(new URLSearchParams('id=AC-1'), f))).toEqual(f);
    expect(writeTaskFilters(new URLSearchParams('id=AC-1'), f).get('id')).toBe('AC-1');
    expect(sortTaskViews(views, 'task', 'asc').map((v) => v.title)[0]).toBe('No date');
  });
  it('waiting since comes from the task history; the action title loses its equipment code', () => {
    expect(waitingSince({ ...ts[0]!, status: 'Waiting stoppage' }, logs)).toBe('2026-10-05 08:00:00.000');
    expect(waitingSince(ts[1]!, logs)).toBe('');
    expect(titleWithoutCode(views[0]!)).toBe('Belt torn');
  });
  it('Excel table of the list', () => {
    const tb = tasksTable(views, { people, contractors, today: TODAY });
    expect(tb.rows).toHaveLength(views.length);
    expect(tb.rows[0]![6]).toBe('RHI');
    expect(tb.rows[0]![7]).toBe('A. Ghafar');
  });
});

describe('the Shutdown list', () => {
  const k1 = act({ area_id: 'K.1' });
  const cm = act({ area_id: 'CM.1', equipment_id: '361.BC210' });
  const ts = [
    task(k1, { needs_stop: true, est_stop_h: 8, status: 'Waiting stoppage', due_date: '2026-10-20' }),
    task(k1, { needs_stop: true, est_stop_h: null, due_date: '2026-10-10', owner: 'MEC', owner_kind: 'internal' }),
    task(k1, { needs_stop: true, est_stop_h: 3, status: 'Done' }),
    task(k1, { needs_stop: false }),
    task(cm, { needs_stop: true, est_stop_h: 1.5, owner: 'ASEC' }),
  ];
  const views = buildTaskViews([k1, cm], ts, [], TODAY);
  const groups = shutdownGroups(views, areas, contractors, TODAY);
  it('open stop tasks only, grouped by area with its line, contractor and totals, most hours first', () => {
    expect(groups.map((g) => g.area)).toEqual(['K.1', 'CM.1']);
    expect(groups[0]).toMatchObject({ areaName: 'Kiln 1', line: 'L.1', contractor: 'RHI', hours: 8, noEstimate: 1, overdue: 1, longestDays: 12 });
    expect(groups[0]!.tasks.map((v) => v.task_id)).toEqual([ts[1]!.task_id, ts[0]!.task_id]);
    expect(groups[1]).toMatchObject({ contractor: 'ASEC', hours: 1.5 });
  });
  it('totals over the groups', () => {
    expect(shutdownTotals(groups, contractors)).toMatchObject({ tasks: 3, actions: 2, hours: 9.5, noEstimate: 1, areas: 2, overdue: 1, internal: 1,
      byContractor: [{ owner: 'ASEC', n: 1 }, { owner: 'RHI', n: 1 }] });
  });
  it('Excel table: one row per task with a total', () => {
    const tb = shutdownTable(groups, { people, contractors, today: TODAY });
    expect(tb.rows).toHaveLength(3);
    expect(tb.rows[0]![0]).toBe('K.1');
    expect(tb.total![12]).toBe(9.5);
  });
});

describe('templates', () => {
  const tpl: TaskTemplate = {
    template_id: 'TT-REPEAT', name: 'Repeated failure', applies_to: ['auto_repeat', 'auto_chronic'], active: true, sort_order: 1, updated_at: '', updated_by: '',
    steps: [
      { seq: 2, title: 'Root cause (5-why)', default_owner: 'MEC', due_offset_days: 7, needs_stop: false, est_stop_h: null },
      { seq: 1, title: 'Repair', default_owner: 'area_contractor', due_offset_days: 2, needs_stop: true, est_stop_h: 4 },
    ],
  };
  const other: TaskTemplate = { ...tpl, template_id: 'TT-LONG', name: 'Long stop', applies_to: ['auto_long_stop'], sort_order: 2 };
  it('the suggested template follows the source', () => {
    expect(suggestedTemplate([other, tpl], 'auto_chronic')!.template_id).toBe('TT-REPEAT');
    expect(suggestedTemplate([other, tpl], 'manual')).toBeNull();
    expect(suggestedTemplate([{ ...tpl, active: false }], 'auto_repeat')).toBeNull();
  });
  it('"Area contractor" becomes the area\'s contractor, the person its default; rows become tasks due from today', () => {
    expect(resolveStepOwner('area_contractor', 'CM.1', contractors)).toBe('ASEC');
    expect(resolveStepOwner('area_contractor', 'HD', contractors)).toBe('');
    expect(resolveStepOwner('MEC', 'CM.1', contractors)).toBe('MEC');
    const rows = draftsFromTemplate(tpl, 'K.1', contractors);
    expect(rows.map((r) => [r.title, r.owner, r.assignee, r.offset])).toEqual([['Repair', 'RHI', 'U-9', 2], ['Root cause (5-why)', 'MEC', 'U-2', 7]]);
    rows[1]!.on = false;
    expect(draftsToTasks(rows, TODAY)).toEqual([{ title: 'Repair', owner: 'RHI', assignee: 'U-9', due_date: '2026-10-16', needs_stop: true, est_stop_h: 4, template_step: 'Repair' }]);
  });
  it('template checks: name, unique titles, one template per rule', () => {
    const input = templateInput(tpl);
    expect(input.steps.map((s) => s.title)).toEqual(['Repair', 'Root cause (5-why)']);
    expect(templateProblem(input, [tpl, other])).toBeNull();
    expect(templateProblem({ ...input, name: 'long STOP' }, [tpl, other])).toMatch(/already called/);
    expect(templateProblem({ ...input, steps: [input.steps[0]!, input.steps[0]!] }, [tpl])).toMatch(/same title/);
    expect(templateProblem({ ...input, applies_to: ['auto_long_stop'] }, [tpl, other])).toMatch(/already suggested by Long stop/);
    expect(templateProblem({ ...input, steps: [] }, [])).toMatch(/at least one task/);
  });
});
