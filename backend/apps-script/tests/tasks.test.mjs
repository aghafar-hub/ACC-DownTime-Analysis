import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, makeUser, seedMaster } from './harness.mjs';

// Tasks inside actions (backend 1.7.0): task statuses and notes, the action status that follows the tasks, closing refused
// while a task is open, ready-to-close and task-overdue alerts (who sees them), templates (seed, apply, save), listTasks and
// the one-time move of the old action statuses to tasks. Synthetic data only. The harness clock is 2026-10-12 (Cairo).

function setup() {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  const eng = makeUser(env, admin.token, 'ROLE-ENG', 'eng@example.com');
  const eng2 = makeUser(env, admin.token, 'ROLE-ENG', 'eng2@example.com');
  const mgr = makeUser(env, admin.token, 'ROLE-MGR', 'mgr@example.com');
  const viewer = makeUser(env, admin.token, 'ROLE-VIEW', 'view@example.com');
  env.ok('saveSettings', admin.token, { changes: { actions_closers: mgr.user_id } });
  return { env, admin, eng, eng2, mgr, viewer };
}

const ACTION = (over = {}) => ({ title: 'Chute blockage', scope_kind: 'equipment', equipment_id: '100.AA01', reason_key: 'Chute blockage', status: 'Open', ...over });
const err = (r) => r.error && [r.error.code, r.error.message];

test('schema: action_tasks, task templates and their seeds; seedDefaults adds the three templates once', () => {
  const env = createEnv();
  const schema = env.json(env.run('SCHEMA'));
  const cols = (t) => schema.tables[t].columns.map((c) => c.name);
  assert.deepEqual(cols('action_tasks'), ['task_id', 'action_id', 'seq', 'title', 'owner_kind', 'owner', 'assignee', 'due_date', 'status', 'needs_stop',
    'est_stop_h', 'notes', 'template_step', 'created_at', 'created_by', 'updated_at', 'updated_by', 'done_at', 'done_by', 'done_note']);
  assert.deepEqual(schema.tables.action_tasks.columns.find((c) => c.name === 'status').enum,
    ['Open', 'Contractor informed', 'Waiting stoppage', 'In progress', 'Done', 'Not needed']);
  assert.deepEqual(cols('task_templates'), ['template_id', 'name', 'applies_to', 'active', 'sort_order', 'updated_at', 'updated_by']);
  assert.deepEqual(cols('task_template_steps'), ['template_id', 'seq', 'title', 'default_owner', 'due_offset_days', 'needs_stop', 'est_stop_h']);
  assert.ok(cols('actions').includes('template_id'));
  const t = env.ok('listTaskTemplates', bootstrapAdmin(env).token);
  assert.deepEqual(t.map((x) => [x.template_id, x.name, x.applies_to, x.steps.map((s) => [s.title, s.default_owner, s.due_offset_days, s.needs_stop])]), [
    ['TT-REPEAT', 'Repeated failure', ['auto_repeat', 'auto_chronic'], [['Repair', 'area_contractor', 2, true], ['Root cause (5-why)', 'MEC', 7, false],
      ['Corrective action', 'area_contractor', 21, true], ['Spare parts', 'MEC', 14, false]]],
    ['TT-LONGSTOP', 'Long stop', ['auto_long_stop'], [['Restore and report', 'area_contractor', 1, false], ['Root cause (5-why)', 'MEC', 7, false],
      ['Corrective action', 'area_contractor', 21, true]]],
    ['TT-PLANNED', 'Planned overrun', ['auto_planned_overrun'], [['Review planned work', 'PRO', 7, false], ['Adjust allowance or plan', 'PRO', 14, false]]],
  ]);
  assert.ok(!t.some((x) => x.steps.some((s) => /60 days/.test(s.title))), 'the 60-day check is not a task');
  assert.equal(env.json(env.ctx.seedDefaults()).task_templates, 0);
  assert.equal(env.rows('task_template_steps').length, 9);
});

test('createAction with a template or with tasks; the action status follows; due_date_derived; tasks in listActions', () => {
  const { env, eng } = setup();
  const r = env.ok('createAction', eng.token, { input: ACTION({ template_id: 'TT-REPEAT' }) });
  assert.equal(r.action.template_id, 'TT-REPEAT');
  assert.equal(r.action.status, 'Open');
  assert.deepEqual(r.tasks.map((t) => [t.seq, t.title, t.owner, t.owner_kind, t.due_date, t.status, t.template_step, t.est_stop_h]), [
    [1, 'Repair', 'RHI', 'contractor', '2026-10-14', 'Open', 'Repair', null],
    [2, 'Root cause (5-why)', 'MEC', 'internal', '2026-10-19', 'Open', 'Root cause (5-why)', null],
    [3, 'Corrective action', 'RHI', 'contractor', '2026-11-02', 'Open', 'Corrective action', null],
    [4, 'Spare parts', 'MEC', 'internal', '2026-10-26', 'Open', 'Spare parts', null],
  ]);
  assert.equal(r.action.due_date_derived, '2026-11-02');
  assert.equal(r.logs.filter((l) => l.kind === 'task_create').length, 4);
  assert.ok(r.logs.filter((l) => l.kind === 'task_create').every((l) => /^AT-[0-9a-f]{12}$/.test(l.task_id)));
  assert.match(env.rows('audit_log').filter((a) => a.action === 'create_action').pop().detail, /^Open: Chute blockage \(4 tasks, template Repeated failure\)$/);

  const own = env.ok('createAction', eng.token, { input: { title: 'Seal', scope_kind: 'area', area_id: 'CM.1', status: 'Draft', template_id: 'TT-LONGSTOP',
    tasks: [{ title: 'Inform ASEC', owner: 'ASEC', due_date: '2026-10-20', needs_stop: true, est_stop_h: 2.5 }, { title: 'Order parts', owner: 'MEC', est_stop_h: 3 }] } });
  assert.equal(own.action.status, 'Draft');
  assert.deepEqual(own.tasks.map((t) => [t.title, t.owner_kind, t.needs_stop, t.est_stop_h, t.template_step]), [
    ['Inform ASEC', 'contractor', true, 2.5, ''], ['Order parts', 'internal', false, null, ''],
  ]);
  assert.equal(own.action.template_id, 'TT-LONGSTOP', 'with tasks the template is only recorded');

  const list = env.ok('listActions', eng.token);
  assert.equal(list.tasks.length, 6);
  assert.equal(list.templates.length, 3);
  assert.equal(list.actions.find((a) => a.action_id === own.action.action_id).due_date_derived, '2026-10-20');

  const bad = (input) => err(env.call('createAction', eng.token, { input }));
  assert.match(bad(ACTION({ template_id: 'TT-NOPE' }))[1], /template TT-NOPE not found/);
  assert.match(bad(ACTION({ tasks: [{ title: '' }] }))[1], /Task title is required/);
  assert.match(bad(ACTION({ tasks: [{ title: 'x', owner: 'NOBODY' }] }))[1], /not an active contractor/);
  assert.match(bad(ACTION({ tasks: [{ title: 'x', est_stop_h: -1 }] }))[1], /Estimated stop hours/);
  assert.match(bad(ACTION({ tasks: [{ title: 'x', colour: 'red' }] }))[1], /unknown field/);
  assert.match(bad(ACTION({ tasks: 'x' }))[1], /Tasks must be a list/);
  assert.match(bad(ACTION({ status: 'Waiting stoppage' }))[1], /is a task status since version 1\.7\.0/);
});

test('merge: tasks the open action does not have yet are added to it', () => {
  const { env, eng } = setup();
  const first = env.ok('createAction', eng.token, { input: ACTION({ tasks: [{ title: 'Repair', template_step: 'Repair', owner: 'RHI' }] }) });
  const again = env.ok('createAction', eng.token, { input: ACTION({ source: 'pareto', template_id: 'TT-REPEAT' }) });
  assert.equal(again.merged, true);
  assert.equal(again.action.action_id, first.action.action_id);
  assert.deepEqual(again.tasks.map((t) => t.title), ['Repair', 'Root cause (5-why)', 'Corrective action', 'Spare parts']);
  assert.match(env.rows('audit_log').filter((a) => a.action === 'merge_action').pop().detail, /3 tasks added$/);
});

test('task statuses: notes for Done and Not needed, Contractor informed only for a contractor, the action follows Open <-> In progress', () => {
  const { env, eng, viewer } = setup();
  const r = env.ok('createAction', eng.token, { input: ACTION({ tasks: [{ title: 'Repair', owner: 'RHI' }, { title: '5-why', owner: 'MEC' }] }) });
  const [rhi, mec] = r.tasks;
  const up = (task, changes, token = eng.token) => env.call('updateTask', token, { taskId: task.task_id, changes });
  assert.deepEqual(err(up(mec, { status: 'Contractor informed' })), ['bad_request', 'Contractor informed is only for a task owned by an external contractor.']);
  assert.match(err(up(rhi, { status: 'Done' }))[1], /Write what was done \(at least 3 characters\)/);
  assert.match(err(up(rhi, { status: 'Done', note: 'ok' }))[1], /at least 3/);
  assert.match(err(up(rhi, { status: 'Not needed', note: ' ' }))[1], /Write why the task is not needed/);
  assert.match(err(up(rhi, { status: 'Started' }))[1], /Task status must be one of/);
  assert.match(err(up(rhi, {}))[1], /No changes/);
  assert.match(err(up(rhi, { title: 'Repair' }))[1], /Nothing was changed/);
  assert.match(err(up(rhi, { seq: 9 }))[1], /unknown field/);
  assert.equal(err(env.call('updateTask', eng.token, { taskId: 'AT-000000000000', changes: { note: 'hi' } }))[0], 'not_found');

  const informed = up(rhi, { status: 'Contractor informed', note: 'told the RHI supervisor' }).data;
  assert.equal(informed.task.status, 'Contractor informed');
  assert.equal(informed.action.status, 'In progress', 'In progress as soon as a task leaves Open');
  const st = informed.logs.filter((l) => l.kind === 'status').pop();
  assert.deepEqual([st.from_status, st.to_status, st.text], ['Open', 'In progress', 'Follows the tasks: a task has started']);
  const tl = informed.logs.filter((l) => l.kind === 'task_status').pop();
  assert.deepEqual([tl.task_id, tl.from_status, tl.to_status, tl.text], [rhi.task_id, 'Open', 'Contractor informed', 'told the RHI supervisor']);
  // the owner cannot become a team while the task is Contractor informed
  assert.match(err(up(rhi, { owner: 'MEC' }))[1], /Contractor informed is only for/);
  // back to Open: the action follows back to Open
  assert.equal(up(rhi, { status: 'Open' }).data.action.status, 'Open');
  // edits and a lone note, logged with before -> after
  const ed = up(rhi, { due_date: '2026-10-30', needs_stop: true, est_stop_h: 6, assignee: eng.user_id, note: 'booked for the stop' }).data;
  assert.deepEqual([ed.task.due_date, ed.task.needs_stop, ed.task.est_stop_h], ['2026-10-30', true, 6]);
  assert.equal(ed.logs.filter((l) => l.kind === 'task_note').pop().text, 'booked for the stop');
  assert.equal(ed.logs.filter((l) => l.kind === 'task_edit').pop().text, `#1 assignee: (blank) -> ${eng.user_id}; due_date: (blank) -> 2026-10-30; needs_stop: no -> yes; est_stop_h: (blank) -> 6`);
  assert.match(env.rows('audit_log').filter((a) => a.action === 'update_task').pop().detail, /#1: note: booked for the stop; assignee: \(blank\) -> .*; est_stop_h: \(blank\) -> 6$/);
  assert.equal(up(rhi, { needs_stop: false }).data.task.est_stop_h, null, 'no stop, no estimate');
  // Done sets done_*; reopening clears them
  const done = up(mec, { status: 'Done', note: '5-why sheet attached' }).data.task;
  assert.deepEqual([done.status, done.done_by, done.done_note, !!done.done_at], ['Done', eng.user_id, '5-why sheet attached', true]);
  const reopened = up(mec, { status: 'In progress' }).data.task;
  assert.deepEqual([reopened.done_at, reopened.done_by, reopened.done_note], ['', '', '']);
  // a viewer cannot change tasks
  assert.equal(err(up(rhi, { note: 'hello' }, viewer.token))[0], 'forbidden');
  assert.equal(env.call('addTask', viewer.token, { actionId: r.action.action_id, task: { title: 'x' } }).error.code, 'forbidden');
  assert.equal(env.ok('listTasks', viewer.token, {}).tasks.length, 2, 'View on actions reads the tasks');
});

test('the action status: Draft stays until accepted, accepting lands on what the tasks say, Open / In progress by hand refused with tasks', () => {
  const { env, eng, mgr } = setup();
  const r = env.ok('createAction', eng.token, { input: ACTION({ status: 'Draft', tasks: [{ title: 'Repair', owner: 'RHI' }] }) });
  const id = r.action.action_id;
  const t = r.tasks[0];
  assert.equal(env.ok('updateTask', eng.token, { taskId: t.task_id, changes: { status: 'In progress' } }).action.status, 'Draft');
  assert.equal(env.ok('updateAction', eng.token, { actionId: id, changes: { status: 'Open' } }).action.status, 'In progress', 'accepted: the tasks say In progress');
  assert.match(env.call('updateAction', eng.token, { actionId: id, changes: { status: 'Open' } }).error.message, /follows its tasks/);
  assert.match(env.call('updateAction', eng.token, { actionId: id, changes: { due_date: '2026-12-01' } }).error.message, /due date of an action with tasks follows its tasks/);
  // without tasks, In progress by hand still works and the due date is the action's own
  const plain = env.ok('createAction', eng.token, { input: { title: 'Housekeeping', scope_kind: 'plant', status: 'Open', due_date: '2026-10-30' } }).action;
  assert.equal(plain.due_date_derived, '2026-10-30');
  assert.equal(env.ok('updateAction', eng.token, { actionId: plain.action_id, changes: { status: 'In progress' } }).action.status, 'In progress');
  // closing an action without tasks works as before
  assert.equal(env.ok('updateAction', mgr.token, { actionId: plain.action_id, changes: { status: 'Closed', closure_note: 'done by hand' } }).action.status, 'Closed');
});

test('closing is refused while a task is open (tasks_open); cancelling is not; a closed action takes only task notes', () => {
  const { env, eng, mgr } = setup();
  const r = env.ok('createAction', eng.token, { input: ACTION({ tasks: [{ title: 'Repair', owner: 'RHI' }, { title: '5-why', owner: 'MEC' }] }) });
  const id = r.action.action_id;
  const close = () => env.call('updateAction', mgr.token, { actionId: id, changes: { status: 'Closed', closure_note: 'all fixed' } });
  assert.deepEqual(err(close()), ['tasks_open', '2 tasks are still open: every task must be Done or Not needed before the action can be closed.']);
  assert.equal(env.call('updateAction', eng.token, { actionId: id, changes: { status: 'Closed', closure_note: 'all fixed' } }).error.code, 'forbidden', 'closers first');
  env.ok('updateTask', eng.token, { taskId: r.tasks[0].task_id, changes: { status: 'Done', note: 'pin replaced' } });
  assert.equal(err(close())[0], 'tasks_open');
  env.ok('updateTask', eng.token, { taskId: r.tasks[1].task_id, changes: { status: 'Not needed', note: 'cause is known' } });
  const closed = close().data;
  assert.equal(closed.action.status, 'Closed');
  assert.equal(closed.action.effectiveness, 'Watching', 'the 60-day effectiveness check starts on close');
  // only notes on a closed action
  assert.match(env.call('updateTask', eng.token, { taskId: r.tasks[0].task_id, changes: { status: 'Open' } }).error.message, /reopen it before changing its tasks/);
  assert.equal(env.ok('updateTask', eng.token, { taskId: r.tasks[0].task_id, changes: { note: 'checked again' } }).logs.pop().kind, 'task_note');
  assert.match(env.call('addTask', eng.token, { actionId: id, task: { title: 'more' } }).error.message, /reopen it before adding tasks/);
  // reopening lands on what the tasks say
  assert.equal(env.ok('updateAction', mgr.token, { actionId: id, changes: { status: 'Open' } }).action.status, 'In progress');
  // cancelling with open tasks is fine
  const other = env.ok('createAction', eng.token, { input: { title: 'x', scope_kind: 'area', area_id: 'CR', status: 'Open', tasks: [{ title: 'one' }] } });
  assert.equal(env.ok('updateAction', mgr.token, { actionId: other.action.action_id, changes: { status: 'Cancelled', closure_note: 'duplicate' } }).action.status, 'Cancelled');
  // tasks are never deleted: there is no call for it
  assert.equal(env.call('deleteTask', eng.token, { taskId: r.tasks[0].task_id }).error.message, 'Unknown action.');
});

test('ready to close: the closers (and Admins) get it when the last task closes; reopening a task resolves it; closing resolves it', () => {
  const { env, admin, eng, mgr } = setup();
  const r = env.ok('createAction', eng.token, { input: ACTION({ tasks: [{ title: 'Repair', owner: 'RHI' }, { title: '5-why', owner: 'MEC' }] }) });
  const id = r.action.action_id;
  const ready = (token) => env.ok('getNotifications', token).items.filter((n) => n.type === 'action_ready_to_close');
  env.ok('updateTask', eng.token, { taskId: r.tasks[0].task_id, changes: { status: 'Done', note: 'pin replaced' } });
  assert.equal(ready(mgr.token).length, 0);
  env.ok('updateTask', eng.token, { taskId: r.tasks[1].task_id, changes: { status: 'Not needed', note: 'cause is known' } });
  const [n] = ready(mgr.token);
  assert.deepEqual([n.dedupe_key, n.category, n.source_ref, n.recipients, n.severity], [`ready|${id}|2`, 'Actions', id, '@closers', 'alert']);
  assert.equal(n.title, `Ready to close: ${id} - Chute blockage`);
  assert.equal(n.detail, 'All 2 tasks done or not needed (1 done, 1 not needed). Only the people on the "Who can close actions" list can close it.');
  assert.equal(ready(admin.token).length, 1, 'Admins can always close');
  assert.equal(ready(eng.token).length, 0, 'not for people who cannot close');
  assert.equal(env.call('setNotificationState', eng.token, { notificationId: n.notification_id, state: 'seen' }).error.code, 'not_found');
  // a check keeps it (the rule agrees)
  env.ok('runNotificationChecks', admin.token);
  assert.equal(ready(mgr.token).length, 1);
  // reopening a task resolves it; done again re-opens the same row
  env.ok('updateTask', eng.token, { taskId: r.tasks[0].task_id, changes: { status: 'In progress', note: 'pin loose again' } });
  assert.equal(ready(mgr.token).length, 0);
  assert.equal(env.rows('notifications').find((x) => x.notification_id === n.notification_id).status, 'resolved');
  env.ok('updateTask', eng.token, { taskId: r.tasks[0].task_id, changes: { status: 'Done', note: 'pin welded' } });
  assert.equal(ready(mgr.token)[0].notification_id, n.notification_id);
  // a new task resolves it with the count in the key; done again raises ready|id|3
  const added = env.ok('addTask', eng.token, { actionId: id, task: { title: 'Check after a week', owner: 'MEC' } });
  assert.equal(added.action.status, 'In progress');
  assert.equal(ready(mgr.token).length, 0);
  env.ok('updateTask', eng.token, { taskId: added.task.task_id, changes: { status: 'Done', note: 'checked' } });
  assert.equal(ready(mgr.token)[0].dedupe_key, `ready|${id}|3`);
  // closing resolves it
  env.ok('updateAction', mgr.token, { actionId: id, changes: { status: 'Closed', closure_note: 'all three done' } });
  assert.equal(ready(mgr.token).length, 0);
  env.ok('runNotificationChecks', admin.token);
  assert.equal(ready(mgr.token).length, 0);
  // drafts never raise it
  const draft = env.ok('createAction', eng.token, { input: { title: 'd', scope_kind: 'area', area_id: 'CR', tasks: [{ title: 'one' }] } });
  env.ok('updateTask', eng.token, { taskId: draft.tasks[0].task_id, changes: { status: 'Done', note: 'done early' } });
  assert.equal(ready(mgr.token).length, 0);
});

test('task overdue: to the task person and the action owner only; action_due follows the latest open task due date', () => {
  const { env, admin, eng, eng2, mgr } = setup();
  const r = env.ok('createAction', eng.token, { input: ACTION({ assignee: eng2.user_id, tasks: [
    { title: 'Repair', owner: 'RHI', assignee: eng.user_id, due_date: '2026-10-09' },
    { title: '5-why', owner: 'MEC', due_date: '2026-10-11' },
    { title: 'Spare parts', owner: 'MEC', due_date: '2026-10-20' },
  ] }) });
  const id = r.action.action_id;
  env.ok('runNotificationChecks', admin.token);
  const mine = (token, type) => env.ok('getNotifications', token).items.filter((n) => n.type === type);
  const overdue = env.rows('notifications').filter((n) => n.type === 'task_overdue');
  assert.deepEqual(overdue.map((n) => [n.dedupe_key, n.recipients]), [
    [`task_due|${r.tasks[0].task_id}|2026-10-09`, `${eng.user_id},${eng2.user_id}`],
    [`task_due|${r.tasks[1].task_id}|2026-10-11`, eng2.user_id],
  ]);
  assert.equal(overdue[0].title, `Task overdue: ${id} - Repair`);
  assert.equal(overdue[0].detail, `Due 2026-10-09, 3 days ago. Task 1 of ${id}, status Open, owner RHI, person ${eng.user_id}.`);
  assert.equal(mine(eng.token, 'task_overdue').length, 1);
  assert.equal(mine(eng2.token, 'task_overdue').length, 2, 'the action owner sees every overdue task');
  assert.equal(mine(mgr.token, 'task_overdue').length, 0);
  // action_due: the latest open task due date (2026-10-20) is not past yet
  assert.equal(mine(admin.token, 'action_due').length, 0);
  // done resolves; moving the due date resolves the old key and raises a new one later
  env.ok('updateTask', eng.token, { taskId: r.tasks[0].task_id, changes: { status: 'Done', note: 'repaired' } });
  env.ok('updateTask', eng.token, { taskId: r.tasks[2].task_id, changes: { status: 'Not needed', note: 'parts in store' } });
  env.ok('runNotificationChecks', admin.token);
  assert.equal(mine(eng.token, 'task_overdue').length, 0);
  assert.equal(mine(eng2.token, 'task_overdue').length, 1);
  // now the latest open due date is 2026-10-11: the action is overdue too
  const due = mine(admin.token, 'action_due');
  assert.deepEqual(due.map((n) => n.dedupe_key), [`action_due|${id}|2026-10-11`]);
  // a new person on the task: the alert follows them
  env.ok('updateTask', eng.token, { taskId: r.tasks[1].task_id, changes: { assignee: mgr.user_id } });
  env.ok('runNotificationChecks', admin.token);
  assert.equal(mine(mgr.token, 'task_overdue').length, 1);
  // nobody named: the closers get it
  const lone = env.ok('createAction', eng.token, { input: { title: 'lone', scope_kind: 'area', area_id: 'CR', status: 'Open', tasks: [{ title: 'x', due_date: '2026-10-01' }] } });
  env.ok('runNotificationChecks', admin.token);
  assert.equal(env.rows('notifications').find((n) => n.dedupe_key === `task_due|${lone.tasks[0].task_id}|2026-10-01`).recipients, '@closers');
});

test('applyTemplate adds only the steps the action does not have; templates are validated when saved', () => {
  const { env, admin, eng } = setup();
  const r = env.ok('createAction', eng.token, { input: { title: 'K.1 planned', scope_kind: 'area', area_id: 'CM.1', status: 'Open', tasks: [{ title: 'Review', template_step: 'Review planned work' }] } });
  const id = r.action.action_id;
  const ap = env.ok('applyTemplate', eng.token, { actionId: id, templateId: 'TT-PLANNED' });
  assert.equal(ap.added, 1);
  assert.deepEqual(ap.tasks.map((t) => [t.seq, t.title, t.owner, t.due_date]), [[1, 'Review', '', ''], [2, 'Adjust allowance or plan', 'PRO', '2026-10-26']]);
  assert.equal(ap.action.template_id, 'TT-PLANNED');
  assert.equal(env.ok('applyTemplate', eng.token, { actionId: id, templateId: 'TT-PLANNED' }).added, 0, 'nothing twice');
  const rep = env.ok('applyTemplate', eng.token, { actionId: id, templateId: 'TT-REPEAT' });
  assert.equal(rep.added, 4);
  assert.equal(rep.tasks.find((t) => t.title === 'Repair').owner, 'ASEC', 'area contractor of CM.1');
  assert.equal(env.call('applyTemplate', eng.token, { actionId: id, templateId: 'TT-NONE' }).error.code, 'not_found');

  // saving: new template, replaced steps, conflicts and bad input
  const bad = (templates) => err(env.call('saveTaskTemplates', admin.token, { templates }));
  const step = (over = {}) => ({ title: 'Look', default_owner: 'MEC', due_offset_days: 3, ...over });
  assert.match(bad([])[1], /at least one template/);
  assert.match(bad([{ name: 'Repeated failure', applies_to: [], active: true, steps: [step()] }])[1], /Two templates would be called "Repeated failure"/);
  assert.match(bad([{ name: 'New', applies_to: ['auto_repeat'], active: true, steps: [step()] }])[1], /auto_repeat would be suggested by both/);
  assert.match(bad([{ name: 'New', applies_to: ['nowhere'], active: true, steps: [step()] }])[1], /not an action source/);
  assert.match(bad([{ name: 'New', applies_to: [], active: true, steps: [] }])[1], /at least one task/);
  assert.match(bad([{ name: 'New', applies_to: [], active: true, steps: [step(), step({ title: 'look' })] }])[1], /listed twice/);
  assert.match(bad([{ name: 'New', applies_to: [], active: true, steps: [step({ default_owner: 'NOBODY' })] }])[1], /not area_contractor or an active contractor/);
  assert.match(bad([{ name: 'New', applies_to: [], active: true, steps: [step({ due_offset_days: 400 })] }])[1], /0 to 365/);
  assert.match(bad([{ name: 'New', applies_to: [], active: 'yes', steps: [step()] }])[1], /active must be true or false/);
  assert.equal(bad([{ template_id: 'TT-GONE', name: 'New', applies_to: [], active: true, steps: [step()] }])[0], 'not_found');
  assert.equal(env.call('saveTaskTemplates', eng.token, { templates: [] }).error.code, 'forbidden');

  const all = env.ok('saveTaskTemplates', admin.token, { templates: [
    { template_id: 'TT-PLANNED', name: 'Planned overrun', applies_to: ['auto_planned_overrun', 'manual'], active: true, sort_order: 3,
      steps: [step({ title: 'Compare plan and actual', default_owner: 'PRO', due_offset_days: 5 }), step({ title: 'Lessons learned', default_owner: 'area_contractor', needs_stop: true, est_stop_h: 2 })] },
    { name: 'Belt tear', applies_to: [], active: true, sort_order: 4, steps: [step({ title: 'Replace belt', default_owner: 'area_contractor', needs_stop: true, est_stop_h: 8 })] },
  ] });
  assert.equal(all.length, 4);
  const planned = all.find((t) => t.template_id === 'TT-PLANNED');
  assert.deepEqual(planned.steps.map((s) => [s.seq, s.title, s.default_owner, s.due_offset_days, s.needs_stop, s.est_stop_h]),
    [[1, 'Compare plan and actual', 'PRO', 5, false, null], [2, 'Lessons learned', 'area_contractor', 3, true, 2]]);
  assert.match(all.find((t) => t.name === 'Belt tear').template_id, /^TT-[0-9A-F]{8}$/);
  assert.equal(env.rows('task_template_steps').length, 4 + 3 + 2 + 1);
  const audit = env.rows('audit_log').filter((a) => a.action === 'save_task_templates').pop().detail;
  assert.match(audit, /^TT-PLANNED applies_to: auto_planned_overrun -> auto_planned_overrun,manual; tasks: Review planned work \(PRO, \+7 d\), Adjust allowance or plan \(PRO, \+14 d\) -> Compare plan and actual/);
  assert.match(audit, /added: Belt tear \(1 tasks: Replace belt \(area_contractor, \+3 d, stop 8 h\)\)/);
  // a switched-off template is not applied
  env.ok('saveTaskTemplates', admin.token, { templates: [{ ...all.find((t) => t.name === 'Belt tear'), active: false }] });
  assert.match(env.call('applyTemplate', eng.token, { actionId: id, templateId: all.find((t) => t.name === 'Belt tear').template_id }).error.message, /switched off/);
});

test('listTasks: open tasks of accepted actions, overdue first; mine, overdue, needs stop, status, area and line filters', () => {
  const { env, eng, eng2 } = setup();
  const a = env.ok('createAction', eng.token, { input: ACTION({ tasks: [
    { title: 'Repair', owner: 'RHI', assignee: eng.user_id, due_date: '2026-10-20', needs_stop: true, est_stop_h: 4 },
    { title: '5-why', owner: 'MEC', due_date: '2026-10-05' },
    { title: 'Parts', owner: 'MEC' },
  ] }) });
  env.ok('createAction', eng.token, { input: { title: 'draft', scope_kind: 'area', area_id: 'CR', tasks: [{ title: 'proposed', needs_stop: true }] } });
  const b = env.ok('createAction', eng.token, { input: { title: 'cm', scope_kind: 'area', area_id: 'CM.1', status: 'Open', tasks: [{ title: 'Idlers', owner: 'ASEC', needs_stop: true, due_date: '2026-10-15' }] } });
  env.ok('updateTask', eng.token, { taskId: b.tasks[0].task_id, changes: { status: 'Waiting stoppage' } });
  const list = (filter) => env.ok('listTasks', eng2.token, { filter });
  const all = list();
  assert.equal(all.today, '2026-10-12');
  assert.deepEqual(all.tasks.map((t) => [t.title, t.overdue]), [['5-why', true], ['Idlers', false], ['Repair', false], ['Parts', false]]);
  const idl = all.tasks.find((t) => t.title === 'Idlers');
  assert.deepEqual([idl.action_id, idl.action_title, idl.area_id, idl.line_id, idl.action_status, !!idl.waiting_since], [b.action.action_id, 'cm', 'CM.1', 'L.1', 'In progress', true]);
  assert.deepEqual(list({ needs_stop: true }).tasks.map((t) => t.title), ['Idlers', 'Repair']);
  assert.deepEqual(list({ overdue: true }).tasks.map((t) => t.title), ['5-why']);
  assert.deepEqual(env.ok('listTasks', eng.token, { filter: { mine: true } }).tasks.map((t) => t.title), ['Repair']);
  assert.deepEqual(list({ area_id: 'CM.1' }).tasks.map((t) => t.title), ['Idlers']);
  assert.deepEqual(list({ owner: 'MEC' }).tasks.map((t) => t.title), ['5-why', 'Parts']);
  assert.deepEqual(list({ include_drafts: true, needs_stop: true }).tasks.map((t) => t.title), ['Idlers', 'Repair', 'proposed']);
  assert.deepEqual(list({ status: ['Waiting stoppage'] }).tasks.map((t) => t.title), ['Idlers']);
  env.ok('updateTask', eng.token, { taskId: a.tasks[2].task_id, changes: { status: 'Done', note: 'in store' } });
  assert.deepEqual(list({ status: 'closed' }).tasks.map((t) => t.title), ['Parts']);
  assert.deepEqual(list({ status: 'closed', done_since: '2026-10-13' }).tasks.map((t) => t.title), []);
  assert.equal(list({ status: 'all' }).tasks.length, 4);
  for (const f of [{ status: 'later' }, { mine: 'yes' }, { done_since: '2026-13-01' }, { colour: 'red' }]) {
    assert.equal(env.call('listTasks', eng.token, { filter: f }).error.code, 'bad_request', JSON.stringify(f));
  }
});

test('migration (seedDefaults, once): old Contractor informed / Waiting stoppage / In progress actions get one task carrying the old status', () => {
  const { env, admin, eng } = setup();
  const base = env.ok('createAction', eng.token, { input: { title: 'base', scope_kind: 'area', area_id: 'CR', status: 'Open' } }).action;
  const row = (id, status, over = {}) => ({ ...base, action_id: id, status, title: `Old ${status}`, evidence: '[]', ...over });
  env.ctx.appendRows_('actions', [
    row('AC-202609-0001', 'Contractor informed', { owner: 'RHI', owner_kind: 'contractor', required_action: 'Replace the chain links', due_date: '2026-10-20' }),
    row('AC-202609-0002', 'Waiting stoppage', { owner: 'MEC', owner_kind: 'internal', assignee: eng.user_id }),
    row('AC-202609-0003', 'In progress', { owner: 'MEC', owner_kind: 'internal', needs_stop: true }),
    row('AC-202609-0004', 'Contractor informed', { owner: 'MEC', owner_kind: 'internal' }),
    row('AC-202609-0005', 'Draft'), row('AC-202609-0006', 'Closed'),
  ]);
  env.props.delete('ACTIONS_TASKS_MIGRATED'); // as on a 1.6.0 database
  const res = env.json(env.ctx.seedDefaults());
  assert.equal(res.actions_moved_to_tasks, 4);
  const actions = Object.fromEntries(env.rows('actions').map((a) => [a.action_id, a.status]));
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => actions[`AC-202609-000${n}`]), ['In progress', 'In progress', 'In progress', 'In progress', 'Draft', 'Closed']);
  const tasks = env.rows('action_tasks');
  const of = (id) => tasks.filter((t) => t.action_id === id).map((t) => [t.seq, t.title, t.status, t.owner, t.owner_kind, t.assignee, t.due_date, t.needs_stop, t.created_by]);
  assert.deepEqual(of('AC-202609-0001'), [[1, 'Replace the chain links', 'Contractor informed', 'RHI', 'contractor', '', '2026-10-20', false, 'system']]);
  assert.deepEqual(of('AC-202609-0002'), [[1, 'Old Waiting stoppage', 'Waiting stoppage', 'MEC', 'internal', eng.user_id, '', true, 'system']]);
  assert.deepEqual(of('AC-202609-0003'), [[1, 'Old In progress', 'In progress', 'MEC', 'internal', '', '', true, 'system']]);
  assert.deepEqual(of('AC-202609-0004'), [[1, 'Old Contractor informed', 'In progress', 'MEC', 'internal', '', '', false, 'system']], 'a team cannot be Contractor informed');
  assert.equal(of('AC-202609-0005').length + of('AC-202609-0006').length, 0);
  const logs = env.rows('action_log').filter((l) => l.action_id === 'AC-202609-0001');
  assert.deepEqual(logs.map((l) => [l.kind, l.from_status, l.to_status]), [['task_create', '', 'Contractor informed'], ['status', 'Contractor informed', 'In progress']]);
  const audit = env.rows('audit_log').filter((a) => a.action === 'migrate_actions');
  assert.equal(audit.length, 1);
  assert.match(audit[0].detail, /^Moved 4 action\(s\) to tasks: AC-202609-0001 \(Contractor informed\), /);
  // idempotent: a second run (and a later In progress action without tasks) is left alone
  env.ok('updateAction', eng.token, { actionId: base.action_id, changes: { status: 'In progress' } });
  assert.equal(env.json(env.ctx.seedDefaults()).actions_moved_to_tasks, 0);
  assert.equal(env.rows('action_tasks').length, 4);
  // even with the marker gone, an action that has tasks is never touched again
  env.props.delete('ACTIONS_TASKS_MIGRATED');
  env.ctx.seedDefaults();
  assert.equal(env.rows('action_tasks').filter((t) => t.action_id.startsWith('AC-202609')).length, 4);
  // listActions reads the migrated actions with their tasks
  const list = env.ok('listActions', admin.token);
  assert.equal(list.actions.find((a) => a.action_id === 'AC-202609-0001').due_date_derived, '2026-10-20');
});
