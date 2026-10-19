import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, makeUser, seedMaster, startBatch, uploadAll, uploadRow, GOOD_PASSWORD, stubMailApp } from './harness.mjs';

// Backend 1.6.0: who is online (throttled activity notes, listActiveUsers), the activity log (listAuditLog: newest first,
// server-side filters and paging) and the audit coverage of every write. Synthetic data only. The harness clock reads
// 2026-10-12 08:00 UTC (10:00 or 11:00 plant time).

const MIN = 60000;

function setup() {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  const eng = makeUser(env, admin.token, 'ROLE-ENG', 'eng@example.com');
  const mgr = makeUser(env, admin.token, 'ROLE-MGR', 'mgr@example.com');
  const viewer = makeUser(env, admin.token, 'ROLE-VIEW', 'view@example.com');
  return { env, admin, eng, mgr, viewer };
}

const activityWrites = (env) => env.sheet('user_activity').stats.setValues;
const activityRow = (env, uid) => env.rows('user_activity').find((r) => r.user_id === uid);

test('listActiveUsers and listAuditLog are for the Admin role only, whatever the tab access says', () => {
  const { env, admin, eng, mgr, viewer } = setup();
  // even a manager with Edit on Users and Settings is refused
  env.ok('setUserTabAccess', admin.token, { userId: mgr.user_id, overrides: { users: 'Edit', settings: 'Edit' } });
  for (const u of [eng, mgr, viewer]) {
    for (const action of ['listActiveUsers', 'listAuditLog']) {
      const r = env.call(action, u.token, {});
      assert.equal(r.status, 'error', `${u.email} ${action}`);
      assert.equal(r.error.code, 'forbidden');
      assert.equal(r.error.accessDenied, true);
    }
  }
  assert.equal(env.call('listActiveUsers', '', {}).error.code, 'unauthenticated');
  assert.equal(env.call('listAuditLog', '', {}).error.code, 'unauthenticated');
  assert.ok(env.ok('listActiveUsers', admin.token).users.length >= 4);
  assert.ok(env.ok('listAuditLog', admin.token, { filter: {} }).entries.length > 0);
});

test('activity is noted on signed-in calls but written to the sheet at most once every 3 minutes per user', () => {
  const { env, eng } = setup();
  env.advance(10 * MIN); // past the throttle of the sign-in
  const before = activityWrites(env);
  env.ok('getStartup', eng.token);
  assert.equal(activityWrites(env), before + 1, 'the first call after a pause writes');
  for (let i = 0; i < 20; i++) { env.advance(5000); env.ok('getStartup', eng.token); }
  assert.equal(activityWrites(env), before + 1, '20 calls in 100 s: no more writes');
  env.advance(3 * MIN);
  env.ok('getMyAccess', eng.token, { activity: { page: '/pareto', device: 'phone' } });
  assert.equal(activityWrites(env), before + 2, 'after 3 minutes the next call writes again');
  const row = activityRow(env, eng.user_id);
  assert.equal(row.last_page, '/pareto');
  assert.equal(row.device, 'phone');
  assert.equal(env.rows('user_activity').filter((r) => r.user_id === eng.user_id).length, 1, 'one row per user (upsert)');
});

test('the throttle holds without the cache (the sheet row is the throttle) and a busy lock never fails a call', () => {
  const { env, eng } = setup();
  env.cacheState.off = true;
  env.advance(10 * MIN);
  const before = activityWrites(env);
  for (let i = 0; i < 10; i++) { env.ok('getStartup', eng.token); env.advance(10000); }
  assert.equal(activityWrites(env), before + 1);
  env.advance(4 * MIN);
  env.lockState.busy = true;
  assert.equal(env.call('getStartup', eng.token).status, 'ok', 'a read works while the lock is busy');
  assert.equal(activityWrites(env), before + 1, 'the write was skipped');
  env.lockState.busy = false;
  env.ok('getStartup', eng.token);
  assert.equal(activityWrites(env), before + 2, 'and done by the next call');
  assert.equal(env.lockState.held, 0);
});

test('listActiveUsers: online now, active today, last seen, page and device; the cache gives the freshest time', () => {
  const { env, admin, eng, mgr, viewer } = setup();
  env.advance(30 * MIN); // everyone signed in 30 minutes ago
  env.ok('getMyAccess', eng.token, { activity: { page: '/validate', device: 'desktop' } });
  env.advance(2 * MIN);
  env.ok('getMyAccess', mgr.token, { activity: { page: '/settings/areas', device: 'phone' } });
  env.advance(1 * MIN);
  env.ok('getStartup', eng.token); // not written (throttled) but cached: eng is seen "now"
  env.ok('getMyAccess', eng.token, { activity: { page: '/javascript:alert(1)', device: 'tablet' } }); // invalid hints are ignored
  const out = env.ok('listActiveUsers', admin.token);
  assert.equal(out.online_minutes, 5);
  const by = Object.fromEntries(out.users.map((u) => [u.user_id, u]));
  assert.equal(by[eng.user_id].online, true);
  assert.equal(by[eng.user_id].last_page, '/validate');
  assert.equal(by[eng.user_id].device, 'desktop');
  assert.equal(by[eng.user_id].last_seen_at, out.now.slice(0, 19) + out.now.slice(19), 'seen at the latest call (from the cache)');
  assert.equal(by[mgr.user_id].online, true);
  assert.equal(by[mgr.user_id].device, 'phone');
  assert.equal(by[mgr.user_id].last_page, '/settings/areas');
  assert.equal(by[viewer.user_id].online, false, 'signed in 33 minutes ago');
  assert.equal(by[viewer.user_id].today, true);
  assert.equal(by[admin.user_id].online, true, 'the admin asking is online');
  assert.ok(out.users.every((u) => !('email' in u)), 'no emails');
  assert.deepEqual(out.users.slice(0, out.online_count).map((u) => u.online), Array(out.online_count).fill(true), 'online people first');
  assert.equal(out.online_count, 3);
  // later: nobody but the admin is online; yesterday's people are not "today"
  env.advance(26 * 3600000);
  env.cacheState.data.clear();
  const again = env.ok('login', '', { email: admin.email, password: admin.password, keepSignedIn: false }).token; // the session ended
  const later = env.ok('listActiveUsers', again);
  const lby = Object.fromEntries(later.users.map((u) => [u.user_id, u]));
  assert.equal(lby[eng.user_id].online, false);
  assert.equal(lby[eng.user_id].today, false);
  assert.ok(lby[eng.user_id].last_seen_at, 'still has a last-seen time (from the sheet)');
  assert.equal(lby[admin.user_id].online, true);
  // a switched-off account is never online
  env.ok('updateUser', again, { userId: mgr.user_id, changes: { active: false } });
  assert.equal(env.ok('listActiveUsers', again).users.find((u) => u.user_id === mgr.user_id).online, false);
});

test('before ensureSchema adds user_activity, every call still works and the list falls back to the last sign-in', () => {
  const { env, admin, eng } = setup();
  env.ss.sheets.delete('user_activity');
  env.advance(10 * MIN);
  assert.equal(env.call('getStartup', eng.token).status, 'ok');
  const out = env.ok('listActiveUsers', admin.token);
  assert.ok(out.users.find((u) => u.user_id === eng.user_id).last_seen_at);
});

// ---------- listAuditLog ----------

/** Appends n synthetic audit rows, one a minute, after the existing ones (time order like the real log). */
function addRows(env, n, make) {
  const start = Date.parse('2026-10-20T00:00:00Z');
  const rows = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start + i * MIN);
    const at = d.toISOString().replace('T', ' ').replace('Z', '');
    rows.push({ at, user_id: 'U-x', action: 'save_setting', entity: 'settings', entity_id: 'k', detail: `${i} -> ${i + 1}`, ...make(i) });
  }
  env.run('LOCK_DEPTH_ = 1');
  env.ctx.appendRows_('audit_log', rows);
  env.run('LOCK_DEPTH_ = 0');
  return rows;
}

test('listAuditLog: newest first, 100 a page, the cursor continues exactly where the page ended', () => {
  const { env, admin } = setup();
  const rows = addRows(env, 250, (i) => ({ detail: `row ${i}` }));
  const p1 = env.ok('listAuditLog', admin.token, { filter: {} });
  assert.equal(p1.entries.length, 100);
  assert.equal(p1.entries[0].detail, 'row 249');
  assert.equal(p1.entries[99].detail, 'row 150');
  assert.match(p1.next_cursor, /^r\d+$/);
  const p2 = env.ok('listAuditLog', admin.token, { filter: {}, cursor: p1.next_cursor });
  assert.equal(p2.entries[0].detail, 'row 149');
  assert.equal(p2.entries[99].detail, 'row 50');
  const p3 = env.ok('listAuditLog', admin.token, { filter: { limit: 200 }, cursor: p2.next_cursor });
  assert.equal(p3.entries[0].detail, 'row 49');
  assert.ok(p3.entries.length > 50, 'then the older rows of the setup');
  assert.equal(p3.next_cursor, null);
  const all = [...p1.entries, ...p2.entries, ...p3.entries];
  assert.equal(all.length, env.rows('audit_log').length, 'every row once');
  assert.ok(all.every((e, i) => i === 0 || all[i - 1].at >= e.at), 'newest first');
  assert.ok(p1.users.some((u) => u.user_id === admin.user_id && u.display_name === 'Test Admin'));
  assert.ok(p1.users.every((u) => !('email' in u)));
  assert.equal(rows.length, 250);
  // validation
  const bad = (params) => env.call('listAuditLog', admin.token, params).error.code;
  assert.equal(bad({ filter: {}, cursor: 'row-5' }), 'bad_request');
  assert.equal(bad({ filter: { group: 'nope' } }), 'bad_request');
  assert.equal(bad({ filter: { from: '14/10/2026' } }), 'bad_request');
  assert.equal(bad({ filter: { from: '2026-10-21', to: '2026-10-20' } }), 'bad_request');
  assert.equal(bad({ filter: { limit: 500 } }), 'bad_request');
  assert.equal(bad({ filter: { colour: 'red' } }), 'bad_request');
});

test('listAuditLog filters on the server: user, kind of change, dates (inclusive), free text (also the user name)', () => {
  const { env, admin, eng } = setup();
  addRows(env, 300, (i) => (i % 3 === 0
    ? { user_id: eng.user_id, action: 'edit_event', entity: 'events', entity_id: `EV-${i}`, detail: `reason_raw: a -> b${i}. Note: fix` }
    : { user_id: admin.user_id }));
  const f = (filter, cursor) => env.ok('listAuditLog', admin.token, { filter, cursor });
  const byUser = f({ user_id: eng.user_id });
  assert.ok(byUser.entries.length === 100 && byUser.entries.every((e) => e.user_id === eng.user_id));
  const events = f({ group: 'events', limit: 200 });
  assert.equal(events.entries.length, 100);
  assert.ok(events.entries.every((e) => e.group === 'events' && e.action === 'edit_event'));
  const signins = f({ group: 'signin', limit: 200 });
  assert.ok(signins.entries.length > 0 && signins.entries.every((e) => ['login', 'change_password', 'login_failed', 'login_locked', 'login_throttled', 'logout', 'sign_out_everywhere'].includes(e.action)));
  // 2026-10-20 00:00 UTC is 03:00 plant... the rows carry the text as written: 300 rows from 2026-10-20 00:00 to 04:59
  const day = f({ from: '2026-10-20', to: '2026-10-20', limit: 200 });
  assert.equal(day.entries.length, 200);
  assert.ok(day.entries.every((e) => e.at.startsWith('2026-10-20')));
  const dayAll = [...day.entries, ...f({ from: '2026-10-20', to: '2026-10-20', limit: 200 }, day.next_cursor).entries];
  assert.equal(dayAll.length, 300);
  assert.equal(f({ from: '2026-10-20', to: '2026-10-20', limit: 200 }, f({ from: '2026-10-20', to: '2026-10-20', limit: 200 }, day.next_cursor).next_cursor ?? 'r1').entries.length, 0);
  const before = f({ to: '2026-10-19', limit: 200 });
  assert.ok(before.entries.length > 0 && before.entries.every((e) => e.at < '2026-10-20'), 'the end date jumps over newer rows');
  assert.equal(f({ from: '2026-10-21' }).entries.length, 0);
  assert.equal(f({ from: '2026-10-21' }).next_cursor, null);
  const text = f({ q: 'B297' });
  assert.deepEqual(text.entries.map((e) => e.entity_id), ['EV-297']);
  const byName = f({ q: 'test role-eng', limit: 5 });
  assert.ok(byName.entries.length === 5 && byName.entries.every((e) => e.user_id === eng.user_id), 'search finds the user name');
});

test('listAuditLog reads a bounded number of rows per call and continues with the cursor (a rare filter on a big log)', () => {
  const { env, admin, eng } = setup();
  addRows(env, 400, (i) => (i === 10 ? { user_id: eng.user_id, detail: 'the rare one' } : {}));
  env.run('AUDIT_SCAN_MAX_ = 150');
  env.run('AUDIT_BLOCK_ROWS_ = 64');
  const p1 = env.ok('listAuditLog', admin.token, { filter: { q: 'the rare one' } });
  assert.equal(p1.entries.length, 0);
  assert.equal(p1.scanned, 150);
  assert.ok(p1.next_cursor);
  const p2 = env.ok('listAuditLog', admin.token, { filter: { q: 'the rare one' }, cursor: p1.next_cursor });
  const p3 = env.ok('listAuditLog', admin.token, { filter: { q: 'the rare one' }, cursor: p2.next_cursor });
  assert.deepEqual([...p2.entries, ...p3.entries].map((e) => e.detail), ['the rare one']);
});

// ---------- every write is in the audit log ----------

/**
 * Every action the router knows, sorted into: a write (with how to call it and the audit action it must leave), a
 * personal preference or read (not logged). A new action must be added here, or this test fails.
 */
const NOT_LOGGED = {
  personal: ['setNotificationState', 'saveNotificationPrefs'],
  read: ['getMyAccess', 'getStartup', 'getEvents', 'getEventEdits', 'getUploadHistory', 'getUploadWarnings', 'listUsers', 'getNotifications',
    'listActions', 'getAreaTargets', 'listActiveUsers', 'listAuditLog', 'listTasks', 'listTaskTemplates'],
};

function writeCases(w) {
  return [
    ['login', () => ({ token: '', params: { email: w.eng.email, password: GOOD_PASSWORD, keepSignedIn: false } }), 'login'],
    ['login', () => ({ token: '', params: { email: w.eng.email, password: 'Wrong-password-1', keepSignedIn: false } }), 'login_failed'],
    ['changePassword', () => ({ token: w.viewer.token, params: { current: GOOD_PASSWORD, next: 'Another-Good-Pass-2' } }), 'change_password'],
    ['logout', () => ({ token: w.mgr.token, params: {} }), 'logout'],
    ['uploadStart', () => ({ params: { fileName: 'cover.xlsx', fileHash: 'c'.repeat(64) } }), 'upload_start'],
    ['uploadChunk', () => ({ params: { batchId: w.batch, rows: [uploadRow({ code_raw: 'ZZ.98' })] } }), 'upload_chunk'],
    ['uploadFinish', () => ({ params: { batchId: w.batch, summary: { rows_read: 1, rows_skipped: 0 }, warnings: [] } }), 'upload_finish', /^File cover\.xlsx\. Read 1, added 1/],
    ['revalidateEvents', () => ({ params: { year: 2026 } }), 'revalidate_events'],
    ['editEvent', () => ({ params: { eventId: w.clean.event_id, changes: { description: 'covered' }, note: 'audit coverage' } }), 'edit_event', /description: synthetic -> covered\. Note: audit coverage/],
    ['voidEvent', () => ({ params: { eventId: w.clean.event_id, isVoid: true, note: 'audit coverage' } }), 'void_event'],
    ['acceptEventFlags', () => ({ params: { eventId: w.warn.event_id, flags: ['unknown_code'], note: 'audit coverage' } }), 'accept_event_flags'],
    ['acceptEventFlagsBulk', () => ({ params: { items: [{ eventId: w.warn.event_id, flags: [] }], note: 'audit coverage' } }), 'accept_event_flags', /^Undid keep as entered/],
    ['saveEquipment', () => ({ params: { row: { equipment_id: '100.AA01', description: 'Renamed fan', criticality: 'High', status: 'Active' }, areaIds: ['K.1'] } }), 'update_equipment', /description: Test fan -> Renamed fan/],
    ['saveEquipment', () => ({ params: { row: { equipment_id: '300.NEW1', description: 'New', criticality: 'Low', status: 'Active' }, areaIds: ['K.1'] } }), 'add_equipment'],
    ['saveArea', () => ({ params: { row: { area_id: 'K.1', name: 'Kiln one', line_id: 'L.1', sort_order: 1, active: true, in_downtime_sheet: true } } }), 'update_area', /name: .* -> Kiln one/],
    ['setAreaActive', () => ({ params: { areaId: 'RM.2', active: false } }), 'deactivate_area'],
    ['saveReason', () => ({ params: { row: { reason_id: '', classification: 'MEC', text_as_listed: 'Audit reason', order_no: 0, active: true } } }), 'add_reason'],
    ['saveAlias', () => ({ params: { row: { alias: '100.AA9', equipment_id: '100.AA01', reason: 'typo' } } }), 'add_alias'],
    ['deleteAlias', () => ({ params: { alias: '100.AA9' } }), 'delete_alias'],
    ['saveSettings', () => ({ params: { changes: { availability_target_pct: '88' } } }), 'save_setting'],
    ['createUser', () => ({ params: { u: { email: 'new@example.com', display_name: 'New Person', role_id: 'ROLE-VIEW' } } }), 'create_user'],
    ['updateUser', () => ({ params: { userId: w.viewer.user_id, changes: { role_id: 'ROLE-ENG' } } }), 'update_user', /^role_id: ROLE-VIEW -> ROLE-ENG$/],
    ['resetPassword', () => ({ params: { userId: w.viewer.user_id } }), 'reset_password'],
    ['setUserTabAccess', () => ({ params: { userId: w.eng.user_id, overrides: { upload: 'Edit' } } }), 'set_tab_access', /^upload: role default -> Edit$/],
    ['runNotificationChecks', () => ({ params: {} }), 'notification_check'],
    ['createAction', () => ({ params: { input: { title: 'Audit action', scope_kind: 'area', area_id: 'K.1', owner: 'MEC', status: 'Open' } } }), 'create_action'],
    ['updateAction', () => ({ params: { actionId: w.actionId(), changes: { priority: 'High' } } }), 'update_action', /priority: .* -> High/],
    ['addActionComment', () => ({ params: { actionId: w.actionId(), text: 'Seal ordered' } }), 'comment_action', /^Seal ordered$/],
    // 1.7.0: tasks inside actions and the task templates
    ['addTask', () => ({ params: { actionId: w.actionId(), task: { title: 'Audit task', owner: 'MEC', due_date: '2026-10-20' } } }), 'create_task',
      /^AC-\d{6}-\d{4}: #1 Audit task \(MEC, due 2026-10-20\)$/],
    ['updateTask', () => ({ params: { taskId: w.taskId(), changes: { status: 'In progress', due_date: '2026-10-25', note: 'started' } } }), 'update_task',
      /#1: status: Open -> In progress \(started\); due_date: 2026-10-20 -> 2026-10-25; action status: Open -> In progress$/],
    ['applyTemplate', () => ({ params: { actionId: w.actionId(), templateId: 'TT-PLANNED' } }), 'apply_template',
      /^Template Planned overrun: 2 tasks added \(Review planned work, Adjust allowance or plan\)$/],
    ['saveTaskTemplates', () => ({ params: { templates: [{ name: 'Audit template', applies_to: ['manual'], active: true, steps: [{ title: 'Look', default_owner: 'MEC', due_offset_days: 3 }] }] } }),
      'save_task_templates', /added: Audit template \(1 tasks: Look \(MEC, \+3 d\)\)/],
    ['saveContractors', () => ({ params: { rows: [{ contractor_id: 'NEWCO', name: 'New Co', areas: [], kind: 'internal', active: true, sort_order: 9 }] } }), 'save_contractors'],
    ['saveAreaTargets', () => ({ params: { year: 2026, rows: [{ area_id: 'K.1', availability_target_pct: 90, planned_allowance_h_year: 120 }] } }), 'save_area_targets', /K\.1 availability_target_pct: \(blank\) -> 90/],
    ['runActionChecks', () => ({ params: {} }), 'action_check'],
    // 1.9.0: email
    ['sendReport', () => { stubMailApp(w.env); return { params: { email: { to: ['someone@outside.org'], subject: 'August report', html: '<p>Hi</p>' } } }; }, 'send_report',
      /^Report to 1 recipient: August report$/],
    ['sendTestEmail', () => { stubMailApp(w.env); return { params: {} }; }, 'send_test_email', /^Test email to admin@example\.com \(mailapp\)$/],
    // 1.10.0 (the clock does not move here, so the tokens of this test stay valid)
    ['signOutUserEverywhere', () => ({ params: { userId: w.eng.user_id } }), 'sign_out_user_everywhere', /^Signed eng@example\.com out on all devices$/],
    ['signOutEverywhere', () => ({ token: w.mgr.token, params: {} }), 'sign_out_everywhere'],
  ];
}

test('every write action leaves an audit row (table-driven over the router), reads and personal preferences leave none', () => {
  const { env, admin, eng, mgr, viewer } = setup();
  const warnRow = uploadRow({ code_raw: 'ZZ.99' });
  const cleanRow = uploadRow();
  uploadAll(env, admin.token, [warnRow, cleanRow]);
  const events = env.rows('events');
  const w = {
    env, admin, eng, mgr, viewer,
    warn: events.find((e) => e.code_raw === 'ZZ.99'),
    clean: events.find((e) => e.code_raw === '100.AA01' && e.flags === ''),
    batch: null,
    actionId: () => env.rows('actions')[0].action_id,
    taskId: () => env.rows('action_tasks')[0].task_id,
  };
  assert.ok(w.warn && w.clean);
  const cases = writeCases(w);
  const handlers = Object.keys(env.run('HANDLERS'));
  const covered = new Set([...cases.map((c) => c[0]), ...NOT_LOGGED.personal, ...NOT_LOGGED.read]);
  assert.deepEqual(handlers.filter((h) => !covered.has(h)), [], 'every router action is sorted into write / personal / read');

  for (const [action, make, auditAction, detailRe] of cases) {
    if (action === 'uploadChunk' && !w.batch) w.batch = startBatch(env, admin.token, 'cover.xlsx');
    const { token = admin.token, params } = make();
    const before = env.rows('audit_log').length;
    const r = env.call(action, token, params);
    if (auditAction !== 'login_failed') assert.equal(r.status, 'ok', `${action}: ${JSON.stringify(r.error)}`);
    const added = env.rows('audit_log').slice(before);
    const hit = added.find((a) => a.action === auditAction);
    assert.ok(hit, `${action} must log ${auditAction}; got ${JSON.stringify(added.map((a) => a.action))}`);
    assert.ok(hit.at && hit.user_id, `${action}: who and when`);
    if (detailRe) assert.match(hit.detail, detailRe, `${action} detail`);
    assert.ok(!/Correct-Horse|Another-Good-Pass|Wrong-password/.test(JSON.stringify(added)), `${action}: no password in the log`);
    if (action === 'uploadStart') w.batch = r.data.batch_id;
  }

  // reads and personal preferences add nothing
  const n = env.rows('audit_log').length;
  const ev = env.rows('events')[0];
  const nid = env.ok('getNotifications', admin.token).items[0]?.notification_id;
  const quiet = [
    ['getMyAccess', {}], ['getStartup', {}], ['getEvents', { year: 2026 }], ['getEventEdits', { eventId: ev.event_id }],
    ['getUploadHistory', {}], ['getUploadWarnings', { batchId: ev.batch_id }], ['listUsers', {}], ['getNotifications', {}],
    ['listActions', {}], ['getAreaTargets', { year: 2026 }], ['listActiveUsers', {}], ['listAuditLog', { filter: {} }],
    ['listTasks', { filter: { status: 'all' } }], ['listTaskTemplates', {}],
    ['saveNotificationPrefs', { prefs: { digest: 'daily' } }],
  ];
  if (nid) quiet.push(['setNotificationState', { notificationId: nid, state: 'seen' }]);
  for (const [action, params] of quiet) assert.equal(env.call(action, admin.token, params).status, 'ok', action);
  assert.equal(env.rows('audit_log').length, n, 'reads and personal preferences are not logged');
});

test('the activity log groups match the app (src/api/auditGroups.ts) and unknown actions fall in System', async () => {
  const env = createEnv({ prepare: false });
  const { AUDIT_GROUP_ACTIONS } = await import('../../../src/api/auditGroups.ts').catch(() => ({ AUDIT_GROUP_ACTIONS: null }));
  const server = env.json(env.run('AUDIT_GROUPS_'));
  if (AUDIT_GROUP_ACTIONS) assert.deepEqual(server, JSON.parse(JSON.stringify(AUDIT_GROUP_ACTIONS)));
  assert.equal(env.run('auditGroupOf_("something_new")'), 'system');
  assert.equal(env.run('auditGroupOf_("deactivate_area")'), 'areas');
});
