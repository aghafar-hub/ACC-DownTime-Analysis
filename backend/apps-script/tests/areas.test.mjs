import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, makeUser, seedMaster, uploadAll, uploadRow } from './harness.mjs';

// Backend 1.5.0: areas switched on and off (Admin only, audited, every rule leaves inactive areas out) and the theme kept
// with the account. Synthetic data only. The harness clock reads 2026-10-12 08:00 UTC.

function setup() {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  const eng = makeUser(env, admin.token, 'ROLE-ENG', 'eng@example.com');
  const mgr = makeUser(env, admin.token, 'ROLE-MGR', 'mgr@example.com');
  const viewer = makeUser(env, admin.token, 'ROLE-VIEW', 'view@example.com');
  return { env, admin, eng, mgr, viewer };
}

/** A failure of 100.AA01 (K.1 unless overridden) starting at `stop` ('YYYY-MM-DD HH:MM') lasting `hours`. */
function failure(stop, hours = 1, over = {}) {
  const s = Date.parse(stop.replace(' ', 'T') + ':00Z');
  const e = new Date(s + hours * 3600000).toISOString().replace('T', ' ').replace('Z', '');
  return uploadRow({ event_date: stop.slice(0, 10), stop_ts: `${stop}:00.000`, start_ts: e, ...over });
}
const rm1 = (stop, hours, over = {}) => failure(stop, hours, { area_id: 'RM.1', code_raw: '100.AB02', reason_raw: `RM cause ${stop}`, ...over });
const area = (env, id) => env.rows('areas').find((a) => a.area_id === id);
const keys = (env, token, type) => env.ok('getNotifications', token).items.filter((i) => i.type === type).map((i) => i.area_id).sort();

test('setAreaActive: Admin only, audited once per change, validated; getStartup reports the flag', () => {
  const { env, admin, eng, mgr, viewer } = setup();
  for (const u of [eng, mgr, viewer]) {
    const r = env.call('setAreaActive', u.token, { areaId: 'K.1', active: false });
    assert.equal(r.error.code, 'forbidden', u.email);
    assert.equal(r.error.accessDenied, true);
  }
  assert.equal(area(env, 'K.1').active, true, 'nothing changed');
  const before = env.rows('audit_log').length;
  const out = env.ok('setAreaActive', admin.token, { areaId: 'K.1', active: false });
  assert.equal(out.area_id, 'K.1');
  assert.equal(out.active, false);
  assert.equal(area(env, 'K.1').active, false);
  const log = env.rows('audit_log').slice(before);
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'deactivate_area');
  assert.equal(log[0].entity, 'areas');
  assert.equal(log[0].entity_id, 'K.1');
  assert.equal(log[0].user_id, admin.user_id);
  // the same value again changes nothing and logs nothing
  env.ok('setAreaActive', admin.token, { areaId: 'K.1', active: false });
  assert.equal(env.rows('audit_log').length, before + 1);
  assert.equal(env.ok('getStartup', viewer.token).areas.find((a) => a.area_id === 'K.1').active, false);
  env.ok('setAreaActive', admin.token, { areaId: 'K.1', active: true });
  assert.equal(env.rows('audit_log').pop().action, 'activate_area');
  assert.equal(area(env, 'K.1').active, true);
  // validation
  assert.equal(env.call('setAreaActive', admin.token, { areaId: 'NOPE', active: false }).error.code, 'not_found');
  assert.equal(env.call('setAreaActive', admin.token, { areaId: 'K.1', active: 'no' }).error.code, 'bad_request');
  assert.equal(env.call('setAreaActive', admin.token, { areaId: '', active: false }).error.code, 'bad_request');
  assert.equal(env.call('setAreaActive', '', { areaId: 'K.1', active: false }).error.code, 'unauthenticated');
});

test('saveArea: only an Admin may change active; other master editors keep the flag as it is', () => {
  const { env, admin, eng } = setup();
  const k1 = { ...area(env, 'K.1') };
  const r = env.call('saveArea', eng.token, { row: { ...k1, active: false } });
  assert.equal(r.error.code, 'forbidden');
  assert.equal(area(env, 'K.1').active, true);
  env.ok('saveArea', eng.token, { row: { ...k1, notes: 'kept active' } });
  assert.equal(area(env, 'K.1').notes, 'kept active');
  assert.equal(env.call('saveArea', eng.token, { row: { area_id: 'NEW.1', name: 'New', line_id: 'L.1', sort_order: 50, active: false, in_downtime_sheet: true } }).error.code, 'forbidden');
  env.ok('saveArea', eng.token, { row: { area_id: 'NEW.1', name: 'New', line_id: 'L.1', sort_order: 50, active: true, in_downtime_sheet: true } });
  env.ok('saveArea', admin.token, { row: { ...k1, active: false } });
  assert.equal(area(env, 'K.1').active, false);
  env.ok('saveArea', eng.token, { row: { ...k1, active: false, notes: 'still off' } });
  assert.equal(area(env, 'K.1').notes, 'still off');
});

test('notification rules leave inactive areas out; their alerts are hidden and come back when switched on', () => {
  const { env, admin, viewer } = setup();
  env.ok('saveSettings', admin.token, { changes: { availability_target_pct: '99' } });
  uploadAll(env, admin.token, [
    failure('2026-09-20 01:00', 10), rm1('2026-09-21 01:00', 10), // long stops in K.1 and RM.1
    ...[1, 3, 5, 7, 9, 11].map((d) => failure(`2026-09-${String(d).padStart(2, '0')} 05:00`, 1, { reason_raw: `K spike ${d}` })),
    rm1('2026-09-30 22:00', 1),
  ]);
  assert.deepEqual(keys(env, admin.token, 'long_stop'), ['K.1', 'RM.1']);
  assert.ok(keys(env, admin.token, 'availability_low').includes('K.1'));
  assert.ok(keys(env, admin.token, 'failure_spike').includes('K.1'));

  env.ok('setAreaActive', admin.token, { areaId: 'K.1', active: false });
  // hidden at once, before any check runs
  for (const type of ['long_stop', 'availability_low', 'failure_spike']) assert.ok(!keys(env, viewer.token, type).includes('K.1'), type);
  // a check resolves the long stop (its condition is gone) and raises nothing new for K.1
  const res = env.ok('runNotificationChecks', admin.token);
  assert.equal(res.created, 0);
  assert.equal(res.resolved, 1);
  assert.equal(env.rows('notifications').find((n) => n.type === 'long_stop' && n.area_id === 'K.1').status, 'resolved');
  assert.deepEqual(keys(env, admin.token, 'long_stop'), ['RM.1']);
  // more K.1 data while it is off: still nothing
  uploadAll(env, admin.token, [failure('2026-10-01 01:00', 12, { reason_raw: 'Kiln long' })]);
  assert.ok(!env.rows('notifications').some((n) => n.area_id === 'K.1' && n.title.includes('12.0 h')));

  env.ok('setAreaActive', admin.token, { areaId: 'K.1', active: true });
  assert.ok(keys(env, admin.token, 'availability_low').includes('K.1'), 'unexpired alerts come back');
  const back = env.ok('runNotificationChecks', admin.token);
  // the old long stop opens again; the new long stop and the spike at the new latest date are raised
  assert.equal(back.created, 3);
  assert.ok(env.rows('notifications').some((n) => n.type === 'failure_spike' && n.dedupe_key === 'spike|K.1|2026-10-01'));
  assert.deepEqual(keys(env, admin.token, 'long_stop'), ['K.1', 'K.1', 'RM.1']);
});

test('action rules: no drafts for an inactive area, effectiveness waits; existing actions stay', () => {
  const { env, admin } = setup();
  env.ok('setAreaActive', admin.token, { areaId: 'K.1', active: false });
  uploadAll(env, admin.token, [failure('2026-03-01 10:00', 10), failure('2026-03-10 10:00'), failure('2026-03-20 10:00')]);
  assert.equal(env.rows('actions').length, 0, 'no repeat, long-stop or chronic drafts for K.1');
  env.ok('setAreaActive', admin.token, { areaId: 'K.1', active: true });
  env.ok('runNotificationChecks', admin.token); // runs the action checks too
  const drafts = env.ok('listActions', admin.token).actions;
  assert.deepEqual(drafts.map((a) => a.source).sort(), ['auto_long_stop', 'auto_repeat']);

  // effectiveness: a closed K.1 action is not judged while K.1 is off (its failures would look like none)
  env.ok('saveSettings', admin.token, { changes: { actions_auto_draft: 'false', actions_effect_days: '30' } });
  const id = env.ok('createAction', admin.token, { input: { title: 'fix', scope_kind: 'equipment', equipment_id: '100.AA01', reason_key: 'bearing failure', status: 'Open' }, options: { merge: false } }).action.action_id;
  env.clock.now = Date.parse('2026-03-21T10:00:00Z');
  env.ok('updateAction', admin.token, { actionId: id, changes: { status: 'Closed', closure_note: 'fixed it' } });
  env.ok('setAreaActive', admin.token, { areaId: 'K.1', active: false });
  // the bearing fails again after the closing, but K.1 is off: without the guard this would read as 'no failure after'
  uploadAll(env, admin.token, [failure('2026-04-01 10:00', 1), rm1('2026-05-01 10:00', 1)]);
  env.ok('runActionChecks', admin.token);
  const closed = () => env.ok('listActions', admin.token).actions.find((a) => a.action_id === id);
  assert.equal(closed().effectiveness, 'Watching', 'not judged while K.1 is off');
  assert.equal(env.ok('listActions', admin.token).actions.length, 3, 'existing actions stay listed');
  env.ok('setAreaActive', admin.token, { areaId: 'K.1', active: true });
  env.ok('runActionChecks', admin.token);
  // judged with the K.1 records: 1 failure (1 h) after against 3 (12 h) before
  assert.equal(closed().effectiveness, 'Effective');
});

test('digest counts leave inactive areas out', () => {
  const { env, admin } = setup();
  uploadAll(env, admin.token, [failure('2026-10-01 01:00', 1, { classification: '' }), rm1('2026-10-02 01:00', 1, { classification: '' })]);
  assert.equal(env.run('digestContext_()').counts.validate, 2);
  env.ok('setAreaActive', admin.token, { areaId: 'K.1', active: false });
  assert.equal(env.run('digestContext_()').counts.validate, 1);
});

test('theme preference: any signed-in user, validated, returned at sign-in and by getMyAccess', () => {
  const { env, viewer } = setup();
  assert.equal(env.ok('getMyAccess', viewer.token).theme, '');
  assert.equal(env.ok('login', '', { email: 'view@example.com', password: 'Correct-Horse-9' }).theme, '');
  for (const bad of ['Purple', 'acc light', 'Navy Dark ; x']) {
    assert.equal(env.call('saveNotificationPrefs', viewer.token, { prefs: { theme: bad } }).error.code, 'bad_request', bad);
  }
  assert.equal(env.ok('saveNotificationPrefs', viewer.token, { prefs: { theme: 'Carbon Dark' } }).theme, 'Carbon Dark');
  assert.equal(env.ok('getMyAccess', viewer.token).theme, 'Carbon Dark');
  assert.equal(env.ok('getNotifications', viewer.token).prefs.theme, 'Carbon Dark');
  assert.equal(env.ok('login', '', { email: 'view@example.com', password: 'Correct-Horse-9', keepSignedIn: true }).theme, 'Carbon Dark');
  env.ok('saveNotificationPrefs', viewer.token, { prefs: { theme: '' } });
  assert.equal(env.ok('getMyAccess', viewer.token).theme, '', 'blank clears it');
});
