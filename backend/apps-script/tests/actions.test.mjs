import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, makeUser, seedMaster, uploadAll, uploadRow } from './harness.mjs';

// Actions (backend 1.4.0): create / merge, closers, transitions, contractors, area targets, the draft rules,
// effectiveness, and the two new notification types. Synthetic data only.

function setup() {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  const eng = makeUser(env, admin.token, 'ROLE-ENG', 'eng@example.com');
  const viewer = makeUser(env, admin.token, 'ROLE-VIEW', 'view@example.com');
  return { env, admin, eng, viewer };
}

/** A failure row of 100.AA01 in K.1 (reason Bearing failure) starting at `stop` ('YYYY-MM-DD HH:MM') lasting `hours`. */
function failure(stop, hours = 1, over = {}) {
  const s = Date.parse(stop.replace(' ', 'T') + ':00Z');
  const e = new Date(s + hours * 3600000).toISOString().replace('T', ' ').replace('Z', '');
  return uploadRow({ event_date: stop.slice(0, 10), stop_ts: `${stop}:00.000`, start_ts: e, ...over });
}

const NEW = (over = {}) => ({ title: 'Bearing runs hot', scope_kind: 'equipment', equipment_id: '100.aa01', reason_key: ' Bearing  FAILURE ', ...over });

test('createAction: ids, defaults, scope from master data, history; listActions returns everything', () => {
  const { env, admin, eng } = setup();
  const r = env.ok('createAction', eng.token, { input: NEW({ evidence: [{ note: 'seen on the round' }] }) });
  assert.equal(r.merged, false);
  const a = r.action;
  assert.match(a.action_id, /^AC-202610-0001$/);
  assert.equal(a.status, 'Draft');
  assert.equal(a.priority, 'Medium');
  assert.equal(a.source, 'manual');
  assert.equal(a.equipment_id, '100.AA01');
  assert.equal(a.area_id, 'K.1');
  assert.equal(a.line_id, 'L.1');
  assert.equal(a.reason_key, 'bearing failure');
  assert.equal(a.dedupe_key, 'repeat|100.AA01|bearing failure');
  assert.equal(a.owner, '');
  assert.equal(a.owner_kind, 'internal');
  assert.equal(a.needs_stop, false);
  assert.deepEqual(a.evidence.map((x) => x.note), ['seen on the round']);
  assert.equal(a.evidence[0].added_by, eng.user_id);
  assert.deepEqual(r.logs.map((l) => [l.kind, l.to_status]), [['status', 'Draft'], ['evidence', '']]);
  const second = env.ok('createAction', eng.token, { input: { title: 'Plant wide housekeeping', scope_kind: 'plant', area_id: 'K.1', owner: 'MEC', status: 'Open' } });
  assert.equal(second.action.action_id, 'AC-202610-0002');
  assert.equal(second.action.area_id, '');
  assert.equal(second.action.owner_kind, 'internal');
  const rhi = env.ok('createAction', eng.token, { input: { title: 'Kiln inlet seal', scope_kind: 'area', area_id: 'k.1', owner: 'RHI' } });
  assert.equal(rhi.action.area_id, 'K.1');
  assert.equal(rhi.action.owner_kind, 'contractor');
  assert.equal(rhi.action.dedupe_key, '');

  const list = env.ok('listActions', admin.token);
  assert.equal(list.actions.length, 3);
  assert.equal(list.logs.length, 4);
  assert.deepEqual(list.contractors.map((c) => c.contractor_id), ['RHI', 'ASEC', 'MEC', 'ELE', 'AUT', 'PRO']);
  assert.ok(list.contractors[0].areas.includes('AFR new'));
  assert.ok(list.people.every((p) => Object.keys(p).sort().join() === 'display_name,user_id'));
  assert.equal(list.can_close, true);
  assert.equal(env.ok('listActions', eng.token).can_close, false);
  assert.equal(env.rows('audit_log').filter((x) => x.action === 'create_action').length, 3);
});

test('createAction refuses bad input in plain words', () => {
  const { env, eng } = setup();
  const bad = (input, options) => env.call('createAction', eng.token, { input, options }).error;
  assert.match(bad(NEW({ equipment_id: '999.NOPE' })).message, /not in Master Data/);
  assert.match(bad(NEW({ status: 'Closed' })).message, /cannot start Closed/);
  assert.match(bad(NEW({ due_date: '2026-02-30' })).message, /Due date/);
  assert.match(bad(NEW({ owner: 'NOBODY' })).message, /not an active contractor/);
  assert.match(bad(NEW({ colour: 'red' })).message, /unknown field/);
  assert.match(bad(NEW({ title: ' ' })).message, /Title is required/);
  assert.match(bad({ title: 'x', scope_kind: 'area' }).message, /Choose the area/);
  assert.match(bad({ title: 'x', scope_kind: 'line', line_id: 'L.9' }).message, /not in the list of lines/);
  assert.match(bad(NEW({ evidence: [{ event_id: 'EV-1' }] })).message, /EV- and 16 hex/);
  assert.match(bad(NEW({ needs_stop: 'yes' })).message, /true or false/);
  assert.match(bad(NEW(), { merge: 'no' }).message, /true or false/);
  assert.equal(env.rows('actions').length, 0);
});

test('dedupe: an open action with the same key receives the evidence; merge false and closed ones make a new action', () => {
  const { env, admin, eng } = setup();
  const first = env.ok('createAction', eng.token, { input: NEW({ evidence: [{ event_id: 'EV-0000000000000001' }] }) }).action;
  const again = env.ok('createAction', eng.token, {
    input: NEW({ title: 'From the Pareto bar', source: 'pareto', evidence: [{ event_id: 'EV-0000000000000001' }, { event_id: 'EV-0000000000000002' }] }),
  });
  assert.equal(again.merged, true);
  assert.equal(again.action.action_id, first.action_id);
  assert.equal(again.action.title, 'Bearing runs hot');
  assert.deepEqual(again.action.evidence.map((x) => x.event_id), ['EV-0000000000000001', 'EV-0000000000000002']);
  assert.match(again.logs[again.logs.length - 1].text, /Merged instead of a new action \(pareto\).*1 evidence item added/);
  assert.equal(env.rows('actions').length, 1);

  const separate = env.ok('createAction', eng.token, { input: NEW(), options: { merge: false } });
  assert.equal(separate.merged, false);
  assert.notEqual(separate.action.action_id, first.action_id);
  // the oldest open one keeps receiving
  assert.equal(env.ok('createAction', eng.token, { input: NEW() }).action.action_id, first.action_id);

  for (const a of [first, separate.action]) env.ok('updateAction', admin.token, { actionId: a.action_id, changes: { status: 'Closed', closure_note: 'done and checked' } });
  const fresh = env.ok('createAction', eng.token, { input: NEW() });
  assert.equal(fresh.merged, false);
  assert.equal(env.rows('actions').length, 3);
});

test('closers: only actions_closers or an Admin closes, cancels, reopens or changes a closed action; closing needs a note', () => {
  const { env, admin, eng } = setup();
  const a = env.ok('createAction', eng.token, { input: NEW({ status: 'Open' }) }).action;
  const id = a.action_id;
  const r = env.call('updateAction', eng.token, { actionId: id, changes: { status: 'Closed', closure_note: 'fixed it' } });
  assert.equal(r.error.code, 'forbidden');
  assert.equal(r.error.accessDenied, true);
  assert.equal(env.call('updateAction', eng.token, { actionId: id, changes: { status: 'Cancelled', closure_note: 'not needed' } }).error.code, 'forbidden');

  assert.match(env.call('saveSettings', admin.token, { changes: { actions_closers: 'U-NOBODY' } }).error.message, /no user U-NOBODY/);
  env.ok('saveSettings', admin.token, { changes: { actions_closers: ` ${eng.user_id}, ${eng.user_id} ` } });
  assert.equal(env.rows('settings').find((s) => s.key === 'actions_closers').value, eng.user_id);
  assert.equal(env.ok('listActions', eng.token).can_close, true);

  assert.match(env.call('updateAction', eng.token, { actionId: id, changes: { status: 'Closed' } }).error.message, /closing note/);
  assert.match(env.call('updateAction', eng.token, { actionId: id, changes: { status: 'Closed', closure_note: 'ok' } }).error.message, /at least 3/);
  assert.match(env.call('updateAction', eng.token, { actionId: id, changes: { closure_note: 'early note' } }).error.message, /only be written when/);
  env.advance(60000);
  const closed = env.ok('updateAction', eng.token, { actionId: id, changes: { status: 'Closed', closure_note: 'Bearing replaced' } });
  assert.equal(closed.action.status, 'Closed');
  assert.equal(closed.action.closed_by, eng.user_id);
  assert.ok(closed.action.closed_at);
  assert.equal(closed.action.closure_note, 'Bearing replaced');
  assert.equal(closed.action.effectiveness, 'Watching');
  const statusLog = closed.logs.filter((l) => l.kind === 'status').pop();
  assert.deepEqual([statusLog.from_status, statusLog.to_status, statusLog.text], ['Open', 'Closed', 'Bearing replaced']);

  // a closed action: comments for everyone with Edit, changes for closers only, reopen only to Open
  env.ok('saveSettings', admin.token, { changes: { actions_closers: '' } });
  assert.equal(env.call('updateAction', eng.token, { actionId: id, changes: { priority: 'High' } }).error.code, 'forbidden');
  assert.equal(env.call('updateAction', eng.token, { actionId: id, changes: { status: 'Open' } }).error.code, 'forbidden');
  assert.equal(env.ok('addActionComment', eng.token, { actionId: id, text: 'Still watching it' }).logs.pop().kind, 'comment');
  assert.match(env.call('updateAction', admin.token, { actionId: id, changes: { status: 'In progress' } }).error.message, /only be reopened to Open/);
  const reopened = env.ok('updateAction', admin.token, { actionId: id, changes: { status: 'Open' } }).action;
  assert.deepEqual([reopened.status, reopened.closed_by, reopened.closed_at, reopened.closure_note, reopened.effectiveness], ['Open', '', '', '', '']);
  // cancelling an area action: no effectiveness watch
  const area = env.ok('createAction', eng.token, { input: { title: 'Area thing', scope_kind: 'area', area_id: 'CR' } }).action;
  const cancelled = env.ok('updateAction', admin.token, { actionId: area.action_id, changes: { status: 'Cancelled', closure_note: 'duplicate' } }).action;
  assert.deepEqual([cancelled.status, cancelled.effectiveness], ['Cancelled', '']);
});

test('updateAction: any open status to any other, edits logged in one row, nothing changed refused, viewers refused', () => {
  const { env, eng, viewer } = setup();
  const id = env.ok('createAction', eng.token, { input: NEW() }).action.action_id;
  for (const s of ['Open', 'Waiting stoppage', 'Contractor informed', 'Draft', 'In progress']) {
    assert.equal(env.ok('updateAction', eng.token, { actionId: id, changes: { status: s } }).action.status, s);
  }
  const r = env.ok('updateAction', eng.token, {
    actionId: id, changes: { priority: 'High', due_date: '2026-10-30', owner: 'RHI', needs_stop: true, root_cause: 'MEC', title: 'New title', add_evidence: [{ note: 'photo' }] },
  });
  assert.equal(r.action.owner_kind, 'contractor');
  const edit = r.logs.filter((l) => l.kind === 'edit').pop();
  assert.equal(edit.text, 'title changed; priority: Medium -> High; due_date: (blank) -> 2026-10-30; needs_stop: no -> yes; root_cause: (blank) -> MEC; owner: (blank) -> RHI');
  assert.equal(r.logs.filter((l) => l.kind === 'evidence').length, 1);
  assert.match(env.call('updateAction', eng.token, { actionId: id, changes: { priority: 'High' } }).error.message, /Nothing was changed/);
  assert.match(env.call('updateAction', eng.token, { actionId: id, changes: {} }).error.message, /No changes/);
  assert.match(env.call('updateAction', eng.token, { actionId: id, changes: { action_id: 'x' } }).error.message, /unknown field/);
  assert.equal(env.call('updateAction', eng.token, { actionId: 'AC-000000-0000', changes: { priority: 'Low' } }).error.code, 'not_found');
  // scope change: to area keeps the area, drops the equipment
  const sc = env.ok('updateAction', eng.token, { actionId: id, changes: { scope_kind: 'area', area_id: 'RM.1' } }).action;
  assert.deepEqual([sc.scope_kind, sc.area_id, sc.line_id, sc.equipment_id], ['area', 'RM.1', 'L.1', '']);
  assert.equal(env.call('updateAction', viewer.token, { actionId: id, changes: { priority: 'Low' } }).error.code, 'forbidden');
  assert.equal(env.call('addActionComment', viewer.token, { actionId: id, text: 'hi' }).error.code, 'forbidden');
  assert.match(env.call('addActionComment', eng.token, { actionId: id, text: '  ' }).error.message, /Comment is required/);
});

test('saveContractors: upsert, area ids in master spelling, one active contractor per area', () => {
  const { env, admin, eng } = setup();
  assert.equal(env.call('saveContractors', eng.token, { rows: [] }).error.code, 'forbidden');
  const all = env.ok('saveContractors', admin.token, { rows: [
    { contractor_id: 'RHI', name: 'RHI Magnesita', areas: ['CR', 'rm.1', 'RM.2', 'K.1', 'K.2', 'HD', 'AFR', 'afr new', 'SHR', 'FM.1', 'FM.2', 'HY.1', 'HY.2'], kind: 'contractor', active: true, sort_order: 1, default_assignee: admin.user_id },
    { contractor_id: 'CIV', name: 'Civil works', areas: [], kind: 'internal', active: true, sort_order: 7 },
  ] });
  assert.equal(all.length, 7);
  const rhi = all.find((c) => c.contractor_id === 'RHI');
  assert.equal(rhi.name, 'RHI Magnesita');
  assert.ok(rhi.areas.includes('AFR new') && rhi.areas.includes('RM.1'));
  assert.equal(all.find((c) => c.contractor_id === 'CIV').default_assignee, '');
  const clash = env.call('saveContractors', admin.token, { rows: [{ contractor_id: 'NEWCO', name: 'New Co', areas: ['CM.1'], kind: 'contractor', active: true, sort_order: 8 }] });
  assert.equal(clash.error.code, 'conflict');
  assert.match(clash.error.message, /CM.1 would belong to both ASEC and NEWCO/);
  // switched off, an area is free again
  env.ok('saveContractors', admin.token, { rows: [{ contractor_id: 'NEWCO', name: 'New Co', areas: ['CM.1'], kind: 'contractor', active: false, sort_order: 8 }] });
  const bad = (row) => env.call('saveContractors', admin.token, { rows: [row] }).error.message;
  assert.match(bad({ contractor_id: '', name: 'x', areas: [], kind: 'internal', active: true }), /contractor id/);
  assert.match(bad({ contractor_id: 'X', name: 'x', areas: ['NOWHERE'], kind: 'internal', active: true }), /not in the list of areas/);
  assert.match(bad({ contractor_id: 'X', name: 'x', areas: 'CR', kind: 'internal', active: true }), /must be a list/);
  assert.match(bad({ contractor_id: 'X', name: 'x', areas: [], kind: 'vendor', active: true }), /Contractor kind/);
  // a draft's owner follows the area's contractor; an inactive owner is refused
  assert.match(env.call('createAction', admin.token, { input: { title: 'x', scope_kind: 'area', area_id: 'CM.1', owner: 'NEWCO' } }).error.message, /not an active contractor/);
});

test('area targets: even split by default, 12 numbers adding up to the allowance, overhaul months 1-12; anyone signed in reads', () => {
  const { env, admin, viewer } = setup();
  const saved = env.ok('saveAreaTargets', admin.token, { year: 2026, rows: [
    { area_id: 'k.1', availability_target_pct: 90, planned_allowance_h_year: 576, monthly_split: [14, 374, 14, 14, 14, 14, 14, 62, 14, 14, 14, 14], overhaul_months: [2, 2] },
    { area_id: 'CR', planned_allowance_h_year: 100 },
  ] });
  assert.deepEqual(saved.map((t) => t.area_id), ['CR', 'K.1']);
  const cr = saved[0];
  assert.equal(cr.availability_target_pct, null);
  assert.deepEqual(cr.monthly_split, [8.33, 8.33, 8.33, 8.33, 8.33, 8.33, 8.33, 8.33, 8.33, 8.33, 8.33, 8.37]);
  assert.deepEqual(saved[1].overhaul_months, [2]);
  assert.equal(saved[1].availability_target_pct, 90);
  assert.deepEqual(env.ok('getAreaTargets', viewer.token, { year: 2026 }).map((t) => t.area_id), ['CR', 'K.1']);
  assert.deepEqual(env.ok('getAreaTargets', viewer.token, { year: 2025 }), []);
  assert.equal(env.ok('getAreaTargets', viewer.token, {}).length, 2);
  assert.equal(env.call('saveAreaTargets', viewer.token, { year: 2026, rows: [] }).error.code, 'forbidden');
  // update in place
  env.ok('saveAreaTargets', admin.token, { year: 2026, rows: [{ area_id: 'CR', planned_allowance_h_year: 120, monthly_split: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10.05] }] });
  assert.equal(env.rows('area_targets').length, 2);
  const bad = (row, year = 2026) => env.call('saveAreaTargets', admin.token, { year, rows: [row] }).error.message;
  assert.match(bad({ area_id: 'CR', planned_allowance_h_year: 120, monthly_split: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10.2] }), /add up to 120.2 h, not the 120 h/);
  assert.match(bad({ area_id: 'CR', planned_allowance_h_year: 110, monthly_split: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10] }), /12 numbers/);
  assert.match(bad({ area_id: 'CR', planned_allowance_h_year: 100, monthly_split: [-10, 20, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0] }), /12 numbers of 0 or more/);
  assert.match(bad({ area_id: 'CR', planned_allowance_h_year: 100, overhaul_months: [13] }), /month numbers from 1 to 12/);
  assert.match(bad({ area_id: 'CR', planned_allowance_h_year: -1 }), /between 0 and 8784/);
  assert.match(bad({ area_id: 'CR', planned_allowance_h_year: 1, availability_target_pct: 101 }), /between 0 and 100/);
  assert.match(bad({ area_id: 'NOWHERE', planned_allowance_h_year: 1 }), /not in the list of areas/);
  assert.match(bad({ area_id: 'CR', planned_allowance_h_year: 1 }, 1999), /year such as/);
});

test('rule repeat: N failures of the same equipment and reason within D days draft one action, later ones add evidence', () => {
  const { env, admin } = setup();
  uploadAll(env, admin.token, [failure('2026-03-01 10:00'), failure('2026-03-10 10:00')]);
  assert.equal(env.rows('actions').length, 0, 'two failures are not enough (actions_repeat_n = 3)');
  uploadAll(env, admin.token, [failure('2026-03-20 10:00')]);
  const [a] = env.ok('listActions', admin.token).actions;
  assert.equal(a.dedupe_key, 'repeat|100.AA01|bearing failure');
  assert.equal(a.source, 'auto_repeat');
  assert.equal(a.status, 'Draft');
  assert.equal(a.created_by, 'system');
  assert.equal(a.owner, 'RHI');
  assert.equal(a.owner_kind, 'contractor');
  assert.equal(a.area_id, 'K.1');
  assert.equal(a.evidence.length, 3);
  assert.equal(a.title, '100.AA01 - Bearing failure: 3 failures in 30 days');
  assert.match(a.detail, /^3 failures within 30 days \(3\.0 h stopped\), latest 2026-03-20 in K\.1/);
  uploadAll(env, admin.token, [failure('2026-03-25 10:00')]);
  const after = env.ok('listActions', admin.token);
  assert.equal(after.actions.length, 1);
  assert.equal(after.actions[0].evidence.length, 4);
  assert.match(after.logs.pop().text, /Rule auto_repeat: 1 new record added as evidence/);
  assert.deepEqual(env.ok('runActionChecks', admin.token), { created: 0, merged: 0, effectiveness: 0 });
  // closed: it drafts again only when the failure comes back after the closing
  env.clock.now = Date.parse('2026-04-01T08:00:00Z');
  env.ok('updateAction', admin.token, { actionId: a.action_id, changes: { status: 'Closed', closure_note: 'replaced the bearing' } });
  assert.equal(env.ok('runActionChecks', admin.token).created, 0);
  uploadAll(env, admin.token, [failure('2026-10-11 01:00'), failure('2026-10-11 03:00'), failure('2026-10-11 05:00')]);
  const drafts = env.ok('listActions', admin.token).actions.filter((x) => x.status === 'Draft');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].dedupe_key, 'repeat|100.AA01|bearing failure');
});

test('rule chronic: top N by failure hours in M complete months in a row', () => {
  const { env, admin } = setup();
  env.ok('saveSettings', admin.token, { changes: { actions_chronic_top: '1', actions_chronic_months: '2', actions_repeat_n: '10' } });
  uploadAll(env, admin.token, [
    failure('2026-01-05 10:00', 5), failure('2026-01-06 10:00', 1, { code_raw: '100.AB02', reason_raw: 'Motor trip', classification: 'ELE' }),
    failure('2026-02-05 10:00', 4), failure('2026-02-06 10:00', 3, { code_raw: '100.AB02', reason_raw: 'Motor trip', classification: 'ELE' }),
    failure('2026-03-02 10:00', 1, { area_id: 'CR', code_raw: 'N/A' }), // so February is complete
  ]);
  const chronic = env.ok('listActions', admin.token).actions.filter((x) => x.source === 'auto_chronic');
  assert.equal(chronic.length, 1);
  assert.equal(chronic[0].dedupe_key, 'chronic|100.AA01|2026-02');
  assert.equal(chronic[0].priority, 'High');
  assert.equal(chronic[0].title, '100.AA01: top 1 by failure hours for 2 months (2026-01 to 2026-02)');
  assert.equal(chronic[0].detail, 'Failure hours: 2026-01 5.0 h (#1), 2026-02 4.0 h (#1).');
  assert.equal(chronic[0].evidence.length, 1);
  assert.equal(env.ok('runActionChecks', admin.token).created, 0);
});

test('rule long stop: an open long_stop alert drafts an action that points at the notification', () => {
  const { env, admin } = setup();
  uploadAll(env, admin.token, [failure('2026-03-05 01:00', 10)]);
  const n = env.ok('getNotifications', admin.token).items.find((x) => x.type === 'long_stop');
  assert.ok(n);
  assert.equal(n.category, 'Reliability');
  const a = env.ok('listActions', admin.token).actions.find((x) => x.source === 'auto_long_stop');
  assert.equal(a.dedupe_key, `long_stop|${n.source_ref}`);
  assert.equal(a.source_ref, n.notification_id);
  assert.equal(a.scope_kind, 'equipment');
  assert.equal(a.title, 'Long stop: K.1 10.0 h on 100.AA01 - Bearing failure');
  assert.deepEqual(a.evidence.map((x) => x.event_id), [n.source_ref]);
});

test('rule planned overrun: alert and draft when a complete month uses more planned hours than its allowance', () => {
  const { env, admin } = setup();
  env.ok('saveAreaTargets', admin.token, { year: 2026, rows: [{ area_id: 'K.1', planned_allowance_h_year: 120 }] }); // 10 h a month
  const pl = (stop, hours) => failure(stop, hours, { classification: 'PL', criticality: 'NO_INC', is_failure: false, code_raw: 'N/A', reason_raw: 'Planned shutdown' });
  uploadAll(env, admin.token, [
    pl('2026-02-10 00:00', 30), // February: old (not recent), raises nothing
    pl('2026-03-10 00:00', 8), pl('2026-03-10 04:00', 8), // overlapping: 12 h of planned time, not 16
    failure('2026-04-01 10:00', 1, { area_id: 'CR', code_raw: 'N/A' }), // March is complete
  ]);
  const notes = env.ok('getNotifications', admin.token).items.filter((x) => x.type === 'planned_overrun');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].dedupe_key, 'planned|K.1|2026-03');
  assert.equal(notes[0].category, 'Availability & planned');
  assert.equal(notes[0].title, 'Planned overrun: K.1 used 12.0 h of 10.0 h allowed in 2026-03');
  assert.equal(notes[0].detail, 'Year to date 42.0 h of 30.0 h allowed (120.0 h for 2026).');
  const a = env.ok('listActions', admin.token).actions.find((x) => x.source === 'auto_planned_overrun');
  assert.equal(a.dedupe_key, 'planned|K.1|2026-03');
  assert.equal(a.scope_kind, 'area');
  assert.equal(a.source_ref, notes[0].notification_id);
  assert.equal(a.owner, 'RHI');
  assert.equal(a.evidence.length, 2);
  // a check never repeats them
  assert.deepEqual(env.ok('runNotificationChecks', admin.token), { created: 0, resolved: 0, expired: 0 });
  assert.equal(env.ok('runActionChecks', admin.token).created, 0);
});

test('actions_auto_draft false: no drafts, but effectiveness still runs', () => {
  const { env, admin } = setup();
  env.ok('saveSettings', admin.token, { changes: { actions_auto_draft: 'false' } });
  uploadAll(env, admin.token, [failure('2026-03-01 10:00', 10), failure('2026-03-10 10:00'), failure('2026-03-20 10:00')]);
  assert.equal(env.rows('actions').length, 0);
  assert.match(env.call('saveSettings', admin.token, { changes: { actions_auto_draft: 'maybe' } }).error.message, /true, false/);
});

test('effectiveness: Watching until the window has passed in the data, then Effective or Not effective', () => {
  const { env, admin } = setup();
  env.ok('saveSettings', admin.token, { changes: { actions_auto_draft: 'false', actions_effect_days: '30' } });
  uploadAll(env, admin.token, [failure('2026-03-01 10:00', 2), failure('2026-03-05 10:00', 2), failure('2026-03-07 10:00', 2)]);
  const mk = (title, reason) => env.ok('createAction', admin.token, { input: NEW({ title, reason_key: reason, status: 'Open' }), options: { merge: false } }).action.action_id;
  const good = mk('good', 'bearing failure');
  const badOne = mk('bad', '');
  // closed at the harness clock 2026-10-12 (plant time); move the clock back so closing falls on 2026-03-10
  env.clock.now = Date.parse('2026-03-10T10:00:00Z');
  for (const id of [good, badOne]) env.ok('updateAction', admin.token, { actionId: id, changes: { status: 'Closed', closure_note: 'fixed it' } });
  assert.deepEqual(env.ok('runActionChecks', admin.token), { created: 0, merged: 0, effectiveness: 0 }, 'still Watching');
  // after closing: one failure of another reason (counts for the action without a reason only), and data up to the window end
  uploadAll(env, admin.token, [
    failure('2026-03-20 10:00', 1, { reason_raw: 'Seal leak' }), failure('2026-03-25 10:00', 1, { reason_raw: 'Seal leak' }),
    failure('2026-03-28 10:00', 1, { reason_raw: 'Seal leak' }), failure('2026-04-10 10:00', 1, { area_id: 'CR', code_raw: 'N/A' }),
  ]);
  // the upload ran the checks already
  assert.equal(env.rows('audit_log').filter((r) => r.action === 'notification_failed').length, 0);
  const by = Object.fromEntries(env.ok('listActions', admin.token).actions.map((a) => [a.title, a]));
  assert.equal(by.good.effectiveness, 'Effective');
  assert.equal(by.bad.effectiveness, 'Not effective');
  const log = env.ok('listActions', admin.token).logs.filter((l) => l.action_id === badOne && l.by === 'system').pop();
  assert.equal(log.text, 'Effectiveness: Not effective (30 days before closing: 3 failures, 6.0 h; 30 days after: 3 failures, 3.0 h)');
  assert.equal(env.ok('runActionChecks', admin.token).effectiveness, 0, 'a verdict is final');
});

test('action_due: an overdue open action raises an alert for everyone; closing resolves it', () => {
  const { env, admin, viewer } = setup();
  const id = env.ok('createAction', admin.token, { input: NEW({ due_date: '2026-10-01', status: 'Open', owner: 'RHI' }) }).action.action_id;
  env.ok('createAction', admin.token, { input: { title: 'not due yet', scope_kind: 'plant', due_date: '2026-12-01' } });
  assert.deepEqual(env.ok('runNotificationChecks', admin.token), { created: 1, resolved: 0, expired: 0 });
  const n = env.ok('getNotifications', viewer.token).items.find((x) => x.type === 'action_due');
  assert.equal(n.dedupe_key, `action_due|${id}|2026-10-01`);
  assert.equal(n.category, 'Actions');
  assert.equal(n.title, `Action overdue: ${id} - Bearing runs hot`);
  assert.equal(n.detail, 'Due 2026-10-01, 11 days ago. Status Open, owner RHI.');
  assert.equal(n.source_ref, id);
  env.ok('updateAction', admin.token, { actionId: id, changes: { status: 'Closed', closure_note: 'done in time after all' } });
  assert.deepEqual(env.ok('runNotificationChecks', admin.token), { created: 0, resolved: 1, expired: 0 });
});

test('every notification carries its category', () => {
  const { env, admin } = setup();
  uploadAll(env, admin.token, [failure('2026-03-05 01:00', 10)]);
  const items = env.ok('getNotifications', admin.token).items;
  const want = env.json(env.run('NOTIF_CATEGORY_'));
  assert.ok(items.length >= 2);
  for (const n of items) assert.equal(n.category, want[n.type], n.type);
  assert.equal(want.user_event, 'System');
  assert.equal(want.upload_done, 'Data quality');
});

test('an upload never fails because of the action checks', () => {
  const { env, admin } = setup();
  env.run('runActionChecks_ = function () { throw new Error("boom"); };');
  const { batch } = uploadAll(env, admin.token, [failure('2026-03-05 01:00', 10)]);
  assert.equal(batch.status, 'Completed');
  assert.ok(env.rows('audit_log').some((r) => r.action === 'notification_failed' && /actions after upload: boom/.test(r.detail)));
});

test('seedDefaults adds the contractors once and never overwrites them', () => {
  const { env, admin } = setup();
  env.ok('saveContractors', admin.token, { rows: [{ contractor_id: 'MEC', name: 'Mechanical team', areas: [], kind: 'internal', active: true, sort_order: 3 }] });
  env.run('SCHEMA.seeds.contractors = SCHEMA.seeds.contractors.concat([{ contractor_id: "NEW", name: "New", areas: "", kind: "internal", active: true, sort_order: 9, default_assignee: "" }]);');
  const added = env.json(env.ctx.seedDefaults());
  assert.equal(added.contractors, 1);
  assert.equal(env.rows('contractors').find((c) => c.contractor_id === 'MEC').name, 'Mechanical team');
  assert.equal(env.rows('contractors').length, 7);
});

test('comments keep their line breaks', () => {
  const { env, eng } = setup();
  const id = env.ok('createAction', eng.token, { input: NEW() }).action.action_id;
  assert.equal(env.ok('addActionComment', eng.token, { actionId: id, text: 'Line one\nLine two' }).logs.pop().text, 'Line one\nLine two');
});

test('code pasted before ensureSchema: uploads and alerts still work, the action checks are skipped', () => {
  const { env, admin } = setup();
  for (const t of ['actions', 'action_log', 'contractors', 'area_targets']) env.ss.sheets.delete(t);
  const { batch } = uploadAll(env, admin.token, [failure('2026-03-05 01:00', 10)]);
  assert.equal(batch.status, 'Completed');
  assert.ok(env.ok('getNotifications', admin.token).items.some((n) => n.type === 'long_stop'));
  assert.ok(!env.rows('audit_log').some((r) => r.action === 'notification_failed'));
  assert.deepEqual(env.ok('getAreaTargets', admin.token, {}), []);
  assert.equal(env.call('listActions', admin.token).error.code, 'server');
});
