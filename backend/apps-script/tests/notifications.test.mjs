import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  BACKEND_DIR, GOOD_PASSWORD, bootstrapAdmin, createEnv, makeUser, seedMaster, stubMailApp, stubScriptApp, uploadAll,
} from './harness.mjs';

// The harness clock reads 2026-10-12 08:00 UTC (a Monday); plant time is Africa/Cairo.

let seqN = 0;
/** One synthetic row. The default reason is unique per row so rows never form a repeated-failure group by accident. */
function ev(stop, start, over = {}) {
  seqN++;
  return {
    source_row: 5000 + seqN, event_date: stop.slice(0, 10), line_id: 'L.1', area_id: 'K.1', code_raw: '100.AA01',
    stop_ts: stop, start_ts: start, freq: 1, classification: 'MEC', criticality: 'INC', is_failure: true,
    reason_raw: `Cause ${seqN}`, description: 'synthetic', fingerprint: '', ...over,
  };
}
const at = (day, from, to, over = {}) => ev(`${day} ${from}:00.000`, `${day} ${to}:00.000`, over);

function setup() {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  return { env, admin };
}
const items = (env, token) => env.ok('getNotifications', token).items;
const keysOf = (env, token, type) => items(env, token).filter((i) => !type || i.type === type).map((i) => i.dedupe_key).sort();
const setSetting = (env, token, changes) => env.ok('saveSettings', token, { changes });
const check = (env, token) => env.ok('runNotificationChecks', token);
const eventId = (env, token, row, year = 2026) => env.ok('getEvents', token, { year }).find((e) => e.source_row === row.source_row).event_id;

// ------------------------------------------------------------------ rules

test('long_stop: chained failure hours above the threshold; voided, blocked, non-failure and old events are left out', () => {
  const { env, admin } = setup();
  const A = at('2026-10-10', '02:00', '12:00'); // 10 h
  const B = at('2026-10-09', '01:00', '08:00'); // 7 h
  const head = at('2026-10-08', '00:00', '05:00'); // 5 h, continued below: 9 h in all
  const cont = at('2026-10-08', '05:00', '09:00', { freq: 0, is_failure: false });
  const D = at('2026-10-07', '00:00', '12:00'); // voided below
  const E = at('2026-10-06', '00:00', '12:00', { classification: '' }); // blocked
  const F = at('2026-10-05', '00:00', '12:00', { classification: 'PL', criticality: 'NO_INC', is_failure: false });
  const H = at('2026-10-04', '00:00', '08:00'); // exactly 8 h: not above
  const G = at('2026-08-01', '00:00', '12:00'); // 12 h but older than the retention window before the latest event
  uploadAll(env, admin.token, [A, B, head, cont, D, E, F, H, G]);
  const idA = eventId(env, admin.token, A), idHead = eventId(env, admin.token, head), idD = eventId(env, admin.token, D);

  // the upload hook already ran the checks, and nothing is created twice
  assert.deepEqual(keysOf(env, admin.token, 'long_stop'), [`long_stop|${idA}`, `long_stop|${idHead}`, `long_stop|${idD}`].sort());
  assert.deepEqual(check(env, admin.token), { created: 0, resolved: 0, expired: 0 });
  const a = items(env, admin.token).find((i) => i.source_ref === idA);
  assert.equal(a.title, 'Long stop: K.1 10.0 h');
  assert.equal(a.severity, 'alert');
  assert.equal(a.area_id, 'K.1');
  assert.equal(a.line_id, 'L.1');
  assert.match(a.notification_id, /^NT-[0-9a-f]{16}$/);
  assert.equal(items(env, admin.token).find((i) => i.source_ref === idHead).title, 'Long stop: K.1 9.0 h');

  // a voided event is excluded exactly as in the app
  env.ok('voidEvent', admin.token, { eventId: idD, isVoid: true, note: 'duplicate' });
  assert.deepEqual(check(env, admin.token), { created: 0, resolved: 1, expired: 0 });
  assert.ok(!keysOf(env, admin.token, 'long_stop').includes(`long_stop|${idD}`));

  // the condition goes away -> resolved; it comes back -> the same row is opened again
  env.ok('voidEvent', admin.token, { eventId: idA, isVoid: true, note: 'entered twice' });
  assert.deepEqual(check(env, admin.token), { created: 0, resolved: 1, expired: 0 });
  assert.ok(!items(env, admin.token).some((i) => i.source_ref === idA));
  const row = env.rows('notifications').find((n) => n.source_ref === idA);
  assert.equal(row.status, 'resolved');
  assert.ok(row.resolved_at);
  env.ok('voidEvent', admin.token, { eventId: idA, isVoid: false, note: 'restored' });
  assert.deepEqual(check(env, admin.token), { created: 1, resolved: 0, expired: 0 });
  assert.equal(env.rows('notifications').filter((n) => n.source_ref === idA).length, 1);
  assert.equal(items(env, admin.token).find((i) => i.source_ref === idA).notification_id, row.notification_id);
  assert.equal(items(env, admin.token).find((i) => i.source_ref === idA).resolved_at, '');

  // thresholds are settings; the chain (5 h + 4 h) counts as one event of 9 h
  setSetting(env, admin.token, { notif_long_stop_hours: '9' });
  assert.deepEqual(check(env, admin.token), { created: 0, resolved: 1, expired: 0 }); // the 9.0 h chain is not above 9
  setSetting(env, admin.token, { notif_long_stop_hours: '5' });
  const r = check(env, admin.token);
  assert.equal(r.created, 3); // the chain again, plus the 7 h and the 8 h event
  assert.equal(keysOf(env, admin.token, 'long_stop').length, 4);
});

test('repeat_group: same code and reason, within the window, alerted once by its first event', () => {
  const { env, admin } = setup();
  const motor = { code_raw: '100.AB02', classification: 'ELE', reason_raw: 'Motor trip' };
  const R1 = at('2026-10-01', '01:00', '02:00', motor);
  uploadAll(env, admin.token, [R1]);
  assert.deepEqual(keysOf(env, admin.token, 'repeat_group'), []);

  const R2 = at('2026-10-05', '01:00', '02:00', { ...motor, reason_raw: ' motor   TRIP ' }); // same reason after match_key
  uploadAll(env, admin.token, [R2]);
  const id1 = eventId(env, admin.token, R1);
  assert.deepEqual(keysOf(env, admin.token, 'repeat_group'), [`repeat|K.1|100.AB02|motor trip|${id1}`]);
  const n = items(env, admin.token).find((i) => i.type === 'repeat_group');
  assert.equal(n.title, 'Repeated failure: 100.AB02 - Motor trip');
  assert.equal(n.detail, '2 failures within 30 days, latest 2026-10-05. First in K.1.');
  assert.equal(n.source_ref, id1);

  // a third event joins the same group: no second alert
  uploadAll(env, admin.token, [at('2026-10-09', '01:00', '02:00', motor)]);
  assert.equal(keysOf(env, admin.token, 'repeat_group').length, 1);

  // an alias resolves to the canonical code; area-level, blank-reason and non-failure events do not group
  const alias = { code_raw: '100.AA1', reason_raw: 'Bearing failure' };
  uploadAll(env, admin.token, [
    at('2026-10-02', '03:00', '04:00', alias), at('2026-10-03', '03:00', '04:00', alias),
    at('2026-10-02', '05:00', '06:00', { code_raw: 'N/A', reason_raw: 'Same' }), at('2026-10-03', '05:00', '06:00', { code_raw: 'N/A', reason_raw: 'Same' }),
    at('2026-10-02', '07:00', '08:00', { reason_raw: '' }), at('2026-10-03', '07:00', '08:00', { reason_raw: '' }),
    at('2026-10-02', '09:00', '10:00', { reason_raw: 'Quiet', is_failure: false }), at('2026-10-03', '09:00', '10:00', { reason_raw: 'Quiet', is_failure: false }),
  ]);
  const repeats = keysOf(env, admin.token, 'repeat_group');
  assert.equal(repeats.length, 2);
  assert.ok(repeats.some((k) => k.startsWith('repeat|K.1|100.AA01|bearing failure|')));

  // exactly the window apart still groups (30 days), one day more does not; the latest event decides what is recent
  const edge = { reason_raw: 'Edge case', code_raw: '100.AB02' };
  const gap = { reason_raw: 'Gap case', code_raw: '100.AB02' };
  uploadAll(env, admin.token, [
    at('2026-09-09', '05:00', '06:00', edge), at('2026-10-09', '05:00', '06:00', edge),
    at('2026-09-08', '07:00', '08:00', gap), at('2026-10-09', '07:00', '08:00', gap),
  ]);
  const all = keysOf(env, admin.token, 'repeat_group');
  assert.ok(all.some((k) => k.includes('|edge case|')));
  assert.ok(!all.some((k) => k.includes('|gap case|')));

  // settings: the minimum number of events, and the alert switch
  setSetting(env, admin.token, { repeat_min_events: '3' });
  const r = check(env, admin.token);
  assert.equal(r.resolved, 2); // the alias group and the edge case have only two events
  assert.deepEqual(keysOf(env, admin.token, 'repeat_group'), [`repeat|K.1|100.AB02|motor trip|${id1}`]);
  setSetting(env, admin.token, { notif_repeat_alert: 'false' });
  assert.deepEqual(check(env, admin.token), { created: 0, resolved: 1, expired: 0 });
  assert.deepEqual(keysOf(env, admin.token, 'repeat_group'), []);
  setSetting(env, admin.token, { notif_repeat_alert: 'true' });
  assert.equal(check(env, admin.token).created, 1); // reopened, not duplicated
  assert.equal(env.rows('notifications').filter((x) => x.type === 'repeat_group' && x.source_ref === id1).length, 1);
});

/** `n` one-hour failures of an area on consecutive days ending at `lastDay`. */
function failuresOn(area, days, over = {}) {
  return days.map((d) => at(d, '03:00', '04:00', { area_id: area, ...over }));
}

test('failure_spike: per area, 30 days to the latest event against the 30 before; > pct and at least 5 now; deduped by window end', () => {
  const { env, admin } = setup();
  const sep = (...d) => d.map((x) => `2026-09-${x}`);
  const aug = (...d) => d.map((x) => `2026-08-${x}`);
  uploadAll(env, admin.token, [
    ...failuresOn('K.1', aug('15', '16', '17', '18')), ...failuresOn('K.1', sep('15', '16', '17', '18', '19', '20')), // 4 -> 6: +50%
    ...failuresOn('RM.1', aug('15', '16', '17', '18')), ...failuresOn('RM.1', sep('15', '16', '17', '18', '19')), // 4 -> 5: +25%
    ...failuresOn('CR', aug('15')), ...failuresOn('CR', ['2026-09-20', '2026-09-21', '2026-09-22', '2026-10-10']), // 1 -> 4: under 5
    ...failuresOn('HD', sep('11', '12', '13', '14', '15')), // 0 -> 5
    ...failuresOn('K.2', sep('11', '12', '13', '14', '15', '16'), { classification: 'PL', criticality: 'NO_INC', is_failure: false }),
    ...failuresOn('ZZ', sep('11', '12', '13', '14', '15', '16'), { line_id: 'L.9' }), // unknown area: blocked, never counted
  ]);
  assert.deepEqual(keysOf(env, admin.token, 'failure_spike'), ['spike|HD|2026-10-10', 'spike|K.1|2026-10-10']);
  const k1 = items(env, admin.token).find((i) => i.dedupe_key === 'spike|K.1|2026-10-10');
  assert.equal(k1.title, 'Failures up 50% in K.1');
  assert.equal(k1.detail, '6 failures in the 30 days to 2026-10-10, against 4 in the 30 days before.');
  assert.equal(items(env, admin.token).find((i) => i.dedupe_key === 'spike|HD|2026-10-10').title, 'Failures rising in HD: 5 (none before)');
  assert.deepEqual(check(env, admin.token), { created: 0, resolved: 0, expired: 0 });

  // a later window end is a new cause, so the same spike is reported again for it
  uploadAll(env, admin.token, [at('2026-10-11', '10:00', '10:30', { area_id: 'CR', reason_raw: 'late' })]);
  assert.ok(keysOf(env, admin.token, 'failure_spike').includes('spike|K.1|2026-10-11'));
  assert.ok(keysOf(env, admin.token, 'failure_spike').includes('spike|K.1|2026-10-10'));
});

test('failure_spike: the percentage is a setting', () => {
  const { env, admin } = setup();
  setSetting(env, admin.token, { notif_spike_pct: '60' });
  const aug = ['15', '16', '17', '18'].map((x) => `2026-08-${x}`);
  const sep = ['15', '16', '17', '18', '19', '20'].map((x) => `2026-09-${x}`);
  uploadAll(env, admin.token, [...failuresOn('K.1', aug), ...failuresOn('K.1', sep)]);
  assert.deepEqual(keysOf(env, admin.token, 'failure_spike'), []);
});

test('upload_gap: latest event older than N days from today; resolved when newer data arrives', () => {
  const { env, admin } = setup();
  uploadAll(env, admin.token, [at('2026-09-07', '01:00', '01:30')]); // 35 days before 2026-10-12: not older than 35
  assert.deepEqual(keysOf(env, admin.token, 'upload_gap'), []);
  uploadAll(env, admin.token, [at('2026-08-20', '01:00', '01:30')]); // earlier date: latest stays 09-07
  assert.deepEqual(keysOf(env, admin.token, 'upload_gap'), []);

  setSetting(env, admin.token, { notif_upload_gap_days: '30' });
  assert.deepEqual(check(env, admin.token), { created: 1, resolved: 0, expired: 0 });
  const g = items(env, admin.token).find((i) => i.type === 'upload_gap');
  assert.equal(g.dedupe_key, 'upload_gap|2026-09-07');
  assert.equal(g.title, 'No upload since 2026-09-07');
  assert.equal(g.detail, 'The latest stored event is dated 2026-09-07, 35 days ago (limit 30 days).');
  assert.equal(g.area_id, '');

  setSetting(env, admin.token, { notif_upload_gap_days: '35' });
  assert.deepEqual(check(env, admin.token), { created: 0, resolved: 1, expired: 0 });
  setSetting(env, admin.token, { notif_upload_gap_days: '30' });
  assert.equal(check(env, admin.token).created, 1);

  uploadAll(env, admin.token, [at('2026-10-10', '01:00', '01:30')]);
  assert.deepEqual(keysOf(env, admin.token, 'upload_gap'), []);
  assert.equal(env.rows('notifications').find((n) => n.type === 'upload_gap').status, 'resolved');
  // no events at all: nothing to compare
  const fresh = setup();
  assert.deepEqual(check(fresh.env, fresh.admin.token), { created: 0, resolved: 0, expired: 0 });
});

test('availability_low: basis B per area for the latest complete month, only when the target is set', () => {
  const { env, admin } = setup();
  const day = (d, over = {}) => ev(`2026-09-${d} 00:00:00.000`, `2026-09-${String(Number(d) + 1).padStart(2, '0')} 00:00:00.000`, over);
  uploadAll(env, admin.token, [
    day('05', { area_id: 'K.1' }), day('10', { area_id: 'K.1' }), day('15', { area_id: 'K.1' }), // 72 h of failures
    day('03', { area_id: 'RM.1', classification: 'PL', criticality: 'NO_INC', is_failure: false }), day('05', { area_id: 'RM.1' }),
    at('2026-09-30', '22:00', '23:00', { area_id: 'CR' }),
  ]);
  assert.deepEqual(keysOf(env, admin.token, 'availability_low'), []); // rule off while the target is blank
  setSetting(env, admin.token, { availability_target_pct: '95' });
  assert.deepEqual(check(env, admin.token), { created: 1, resolved: 0, expired: 0 });
  const n = items(env, admin.token).find((i) => i.type === 'availability_low');
  // data starts on 3 September: T = 28 days x 24 h = 672 h, K.1 lost 72 h
  assert.equal(n.dedupe_key, 'availability|K.1|2026-09');
  assert.equal(n.title, 'Availability below target: K.1 89.3%');
  assert.equal(n.detail, '2026-09: availability 89.3% against a target of 95% (basis B).');
  setSetting(env, admin.token, { availability_target_pct: '97' });
  assert.deepEqual(keysOf(env, admin.token, 'availability_low'), ['availability|K.1|2026-09']);
  assert.equal(check(env, admin.token).created, 1); // RM.1: (672-24-24)/(672-24) = 96.3 %
  assert.deepEqual(keysOf(env, admin.token, 'availability_low'), ['availability|K.1|2026-09', 'availability|RM.1|2026-09']);

  // the month in progress is not judged: with data to 5 October, September is still the month, and no duplicate appears
  uploadAll(env, admin.token, [at('2026-10-05', '01:00', '01:30', { area_id: 'CR' })]);
  assert.equal(keysOf(env, admin.token, 'availability_low').length, 2);
  assert.equal(env.rows('notifications').filter((x) => x.type === 'availability_low').length, 2);
});

test('upload_done: written once per upload by uploadFinish; finishing twice adds nothing', () => {
  const { env, admin } = setup();
  const { batch } = uploadAll(env, admin.token, [at('2026-10-10', '01:00', '01:30'), at('2026-10-10', '02:00', '02:30')], 'october.xlsx');
  const u = items(env, admin.token).filter((i) => i.type === 'upload_done');
  assert.equal(u.length, 1);
  assert.equal(u[0].severity, 'update');
  assert.equal(u[0].dedupe_key, `upload|${batch.batch_id}`);
  assert.equal(u[0].title, 'Workbook uploaded: october.xlsx (+2 rows)');
  assert.equal(u[0].detail, 'Read 2, added 2, identical 0, skipped 0, warnings 0.');
  assert.equal(u[0].source_ref, batch.batch_id);
  env.ok('uploadFinish', admin.token, { batchId: batch.batch_id, summary: { rows_read: 2, rows_skipped: 0 }, warnings: [] });
  assert.equal(items(env, admin.token).filter((i) => i.type === 'upload_done').length, 1);
});

test('the upload hook never fails an upload, even when the notification sheet is gone', () => {
  const { env, admin } = setup();
  env.ss.sheets.delete('notifications');
  const { batch } = uploadAll(env, admin.token, [at('2026-10-10', '02:00', '12:00')]);
  assert.equal(batch.status, 'Completed');
  assert.equal(env.rows('events').length, 1);
  assert.ok(env.errors.some((e) => e.includes('Notification step failed (upload)')));
  assert.ok(env.rows('audit_log').some((a) => a.action === 'notification_failed'));
  // and the manual action reports the problem plainly instead of crashing
  assert.equal(env.call('runNotificationChecks', admin.token).error.code, 'server');
});

test('user_event: created / password reset / role change, only for people who can see the Users page', () => {
  const { env, admin } = setup();
  const eng = makeUser(env, admin.token, 'ROLE-ENG', 'eng@example.com');
  const view = makeUser(env, admin.token, 'ROLE-VIEW', 'view@example.com');
  env.ok('resetPassword', admin.token, { userId: view.user_id });
  env.ok('updateUser', admin.token, { userId: view.user_id, changes: { display_name: 'Renamed' } }); // not a role change
  env.ok('updateUser', admin.token, { userId: view.user_id, changes: { role_id: 'ROLE-MGR' } });
  const titles = items(env, admin.token).filter((i) => i.type === 'user_event').map((i) => i.title).sort();
  assert.deepEqual(titles, ['Password reset: Test ROLE-VIEW', 'Role changed: Renamed', 'User created: Test ROLE-ENG', 'User created: Test ROLE-VIEW']);
  const role = items(env, admin.token).find((i) => i.title.startsWith('Role changed'));
  assert.equal(role.detail, 'Test Admin changed the role of view@example.com from ROLE-VIEW to ROLE-MGR.');
  assert.equal(role.severity, 'update');
  assert.equal(role.source_ref, view.user_id);
  assert.deepEqual(items(env, eng.token), []);
  // no secret ever reaches the table
  const dump = JSON.stringify(env.rows('notifications'));
  assert.ok(!/temp_password|password_hash/i.test(dump));
  // a user event is not stored twice for the same second
  assert.equal(env.rows('notifications').filter((n) => n.type === 'user_event').length, 4);
  // an admin who cannot see Users (override) does not see them either
  env.ok('setUserTabAccess', admin.token, { userId: eng.user_id, overrides: { users: 'View' } });
  assert.equal(items(env, eng.token).length, 4);
});

test('alerts expire after notif_retention_days and are never re-opened; read-time filtering hides them before the job runs', () => {
  const { env, admin } = setup();
  setSetting(env, admin.token, { notif_retention_days: '2' });
  const A = at('2026-10-10', '02:00', '12:00');
  uploadAll(env, admin.token, [A]);
  const long = items(env, admin.token).find((i) => i.type === 'long_stop');
  assert.equal(long.expires_at.slice(0, 10), '2026-10-14'); // created 12 Oct, two days
  assert.equal(items(env, admin.token).length, 2); // the long stop and the upload update

  env.advance(3 * 86400000);
  const login = env.ok('login', '', { email: admin.email, password: GOOD_PASSWORD, keepSignedIn: true });
  assert.deepEqual(items(env, login.token), []); // omitted although the check has not run
  assert.equal(env.rows('notifications').filter((n) => n.status === 'open').length, 2);
  const r = check(env, login.token);
  assert.deepEqual(r, { created: 0, resolved: 0, expired: 2 });
  // the old long stop is expired for good: the same event does not raise it again
  assert.equal(env.rows('notifications').find((n) => n.dedupe_key === long.dedupe_key).status, 'expired');
  assert.deepEqual(check(env, login.token), { created: 0, resolved: 0, expired: 0 });
});

// ------------------------------------------------------------------ access, state, preferences

function people() {
  const { env, admin } = setup();
  const mgr = makeUser(env, admin.token, 'ROLE-MGR', 'mgr@example.com');
  const eng = makeUser(env, admin.token, 'ROLE-ENG', 'eng@example.com');
  const view = makeUser(env, admin.token, 'ROLE-VIEW', 'view@example.com');
  uploadAll(env, admin.token, [at('2026-10-10', '02:00', '12:00')]);
  return { env, admin, mgr, eng, view };
}

test('access: any signed-in user reads and writes their own state; only Edit on settings runs the checks', () => {
  const { env, admin, mgr, eng, view } = people();
  for (const u of [admin, mgr, eng, view]) {
    const r = env.ok('getNotifications', u.token);
    assert.ok(r.items.some((i) => i.type === 'long_stop'), u.email);
    assert.deepEqual(r.state, []);
    assert.deepEqual(r.prefs, {});
  }
  assert.equal(env.call('runNotificationChecks', admin.token).status, 'ok');
  for (const u of [mgr, eng, view]) {
    const r = env.call('runNotificationChecks', u.token);
    assert.equal(r.error.code, 'forbidden', u.email);
    assert.equal(r.error.accessDenied, true);
  }
  env.ok('setUserTabAccess', admin.token, { userId: eng.user_id, overrides: { settings: 'Edit' } });
  assert.equal(env.call('runNotificationChecks', eng.token).status, 'ok');
  env.ok('setUserTabAccess', admin.token, { userId: eng.user_id, overrides: { settings: 'View' } });
  assert.equal(env.call('runNotificationChecks', eng.token).error.code, 'forbidden');

  // no session, bad token, temporary password
  for (const a of ['getNotifications', 'setNotificationState', 'saveNotificationPrefs', 'runNotificationChecks']) {
    assert.equal(env.call(a, '', {}).error.code, 'unauthenticated', a);
    assert.equal(env.call(a, 'junk.token', {}).error.code, 'unauthenticated', a);
  }
  const created = env.ok('createUser', admin.token, { u: { email: 'new@example.com', display_name: 'New', role_id: 'ROLE-VIEW' } });
  const first = env.ok('login', '', { email: 'new@example.com', password: created.temp_password, keepSignedIn: false });
  assert.equal(env.call('getNotifications', first.token, {}).error.code, 'forbidden');
});

test('state: own rows only, upserted, validated; invisible notifications are not found', () => {
  const { env, admin, eng, view } = people();
  const alert = items(env, view.token).find((i) => i.type === 'long_stop');
  const adminOnly = items(env, admin.token).find((i) => i.type === 'user_event');

  const seen = env.ok('setNotificationState', eng.token, { notificationId: alert.notification_id, state: 'seen' });
  assert.deepEqual({ ...seen, updated_at: '' }, { user_id: eng.user_id, notification_id: alert.notification_id, state: 'seen', snooze_until: '', updated_at: '' });
  env.ok('setNotificationState', eng.token, { notificationId: alert.notification_id, state: 'dismissed' });
  assert.equal(env.rows('notification_state').filter((s) => s.user_id === eng.user_id).length, 1); // upsert, not a second row
  const snooze = env.ok('setNotificationState', view.token, { notificationId: alert.notification_id, state: 'snoozed', snoozeUntil: '2026-10-13 09:00:00' });
  assert.equal(snooze.snooze_until, '2026-10-13 09:00:00.000');
  assert.equal(env.ok('setNotificationState', view.token, { notificationId: alert.notification_id, state: 'snoozed', snoozeUntil: '2026-10-19' }).snooze_until, '2026-10-19 00:00:00.000');

  // no leakage between people
  const engState = env.ok('getNotifications', eng.token).state;
  const viewState = env.ok('getNotifications', view.token).state;
  assert.deepEqual(engState.map((s) => [s.user_id, s.state]), [[eng.user_id, 'dismissed']]);
  assert.deepEqual(viewState.map((s) => [s.user_id, s.state]), [[view.user_id, 'snoozed']]);
  assert.deepEqual(env.ok('getNotifications', admin.token).state, []);
  // a user id sent by the caller is ignored: the state is the caller's
  env.ok('setNotificationState', eng.token, { notificationId: alert.notification_id, state: 'seen', user_id: admin.user_id, userId: admin.user_id });
  assert.deepEqual(env.ok('getNotifications', admin.token).state, []);

  // bad input
  const bad = (params, token = eng.token) => env.call('setNotificationState', token, params).error;
  assert.equal(bad({ notificationId: alert.notification_id, state: 'deleted' }).code, 'bad_request');
  assert.equal(bad({ notificationId: alert.notification_id }).code, 'bad_request');
  assert.equal(bad({ notificationId: alert.notification_id, state: 'snoozed' }).code, 'bad_request');
  assert.equal(bad({ notificationId: alert.notification_id, state: 'snoozed', snoozeUntil: 'tomorrow' }).code, 'bad_request');
  assert.equal(bad({ notificationId: alert.notification_id, state: 'snoozed', snoozeUntil: '2026-10-12 00:00:00' }).code, 'bad_request'); // in the past
  assert.equal(bad({ notificationId: alert.notification_id, state: 'snoozed', snoozeUntil: '2030-01-01' }).code, 'bad_request'); // too far
  assert.equal(bad({ notificationId: alert.notification_id, state: 'snoozed', snoozeUntil: 12345 }).code, 'bad_request');
  assert.equal(bad({ notificationId: '', state: 'seen' }).code, 'bad_request');
  assert.equal(bad({ notificationId: 42, state: 'seen' }).code, 'bad_request');
  assert.equal(bad({ notificationId: 'NT-0000000000000000', state: 'seen' }).code, 'not_found');
  assert.equal(bad({ notificationId: adminOnly.notification_id, state: 'seen' }).code, 'not_found'); // admin-only item
  assert.equal(env.call('setNotificationState', admin.token, { notificationId: adminOnly.notification_id, state: 'seen' }).status, 'ok');
  // after a snooze the state is cleared again by a later 'seen'
  assert.equal(env.ok('setNotificationState', view.token, { notificationId: alert.notification_id, state: 'seen', snoozeUntil: '2026-10-19' }).snooze_until, '');
});

test('prefs: own keys only, validated and normalised, returned in full', () => {
  const { env, admin, eng, view } = people();
  assert.deepEqual(env.ok('saveNotificationPrefs', eng.token, { prefs: { digest: 'weekly', watch_areas: 'rm.1, K.1 ,K.1', alert_types: 'upload_gap,long_stop,long_stop' } }),
    { digest: 'weekly', watch_areas: 'RM.1,K.1', alert_types: 'upload_gap,long_stop' });
  assert.deepEqual(env.ok('saveNotificationPrefs', eng.token, { prefs: { last_seen_at: '2026-10-12 09:30:00' } }),
    { digest: 'weekly', watch_areas: 'RM.1,K.1', alert_types: 'upload_gap,long_stop', last_seen_at: '2026-10-12 09:30:00.000' });
  assert.deepEqual(env.ok('saveNotificationPrefs', eng.token, { prefs: { watch_areas: '', alert_types: '' } }),
    { digest: 'weekly', watch_areas: '', alert_types: '', last_seen_at: '2026-10-12 09:30:00.000' });
  assert.equal(env.rows('notification_prefs').filter((r) => r.user_id === eng.user_id).length, 4); // upserts

  // nobody else sees or changes them
  assert.deepEqual(env.ok('getNotifications', view.token).prefs, {});
  assert.deepEqual(env.ok('getNotifications', admin.token).prefs, {});
  env.ok('saveNotificationPrefs', view.token, { prefs: { digest: 'daily' } });
  assert.equal(env.ok('getNotifications', eng.token).prefs.digest, 'weekly');
  assert.equal(env.ok('getNotifications', view.token).prefs.digest, 'daily');

  const bad = (prefs) => env.call('saveNotificationPrefs', eng.token, { prefs }).error;
  assert.equal(bad({}).code, 'bad_request');
  assert.equal(bad(null).code, 'bad_request');
  assert.equal(bad([]).code, 'bad_request');
  assert.equal(bad({ digest: 'hourly' }).code, 'bad_request');
  assert.equal(bad({ digest: 1 }).code, 'bad_request');
  assert.equal(bad({ watch_areas: 'NOWHERE' }).code, 'bad_request');
  assert.equal(bad({ alert_types: 'long_stop,made_up' }).code, 'bad_request');
  assert.equal(bad({ last_seen_at: 'yesterday' }).code, 'bad_request');
  assert.equal(bad({ nonsense: 'x' }).code, 'bad_request');
  assert.equal(bad({ last_digest_at: '2026-01-01 00:00:00.000' }).code, 'bad_request'); // written by the server only
  assert.equal(bad({ user_id: admin.user_id }).code, 'bad_request');
  // a rejected save changes nothing at all
  assert.equal(bad({ digest: 'daily', watch_areas: 'NOWHERE' }).code, 'bad_request');
  assert.equal(env.ok('getNotifications', eng.token).prefs.digest, 'weekly');
});

test('settings: ranges are validated server-side like the other settings', () => {
  const { env, admin } = setup();
  const bad = (changes) => env.call('saveSettings', admin.token, { changes }).error;
  assert.equal(bad({ notif_long_stop_hours: '0' }).code, 'bad_request');
  assert.equal(bad({ notif_long_stop_hours: '1.5' }).code, 'bad_request');
  assert.equal(bad({ notif_long_stop_hours: 'many' }).code, 'bad_request');
  assert.equal(bad({ notif_spike_pct: '0' }).code, 'bad_request');
  assert.equal(bad({ notif_spike_pct: '5000' }).code, 'bad_request');
  assert.equal(bad({ notif_upload_gap_days: '-1' }).code, 'bad_request');
  assert.equal(bad({ notif_retention_days: '0' }).code, 'bad_request');
  assert.equal(bad({ availability_target_pct: '101' }).code, 'bad_request');
  assert.equal(bad({ availability_target_pct: 'x' }).code, 'bad_request');
  assert.equal(bad({ notif_repeat_alert: 'maybe' }).code, 'bad_request');
  assert.equal(bad({ app_url: 'javascript:alert(1)' }).code, 'bad_request');
  assert.equal(bad({ app_url: 'ftp://example.com' }).code, 'bad_request');
  assert.equal(bad({ app_url: 'https://exa mple.com' }).code, 'bad_request');
  assert.equal(bad({ app_url: 'https://example.com/"><script>' }).code, 'bad_request');
  assert.equal(bad({ notif_spike_pct: '40', notif_retention_days: '0' }).code, 'bad_request'); // all or nothing
  setSetting(env, admin.token, {
    notif_long_stop_hours: '12', notif_spike_pct: '40', notif_upload_gap_days: '10', availability_target_pct: '92.5',
    notif_repeat_alert: 'false', notif_retention_days: '14', app_url: 'https://acc.example.test/app/',
  });
  const s = Object.fromEntries(env.ok('getStartup', admin.token).settings.map((x) => [x.key, x.value]));
  assert.deepEqual(
    [s.notif_long_stop_hours, s.notif_spike_pct, s.notif_upload_gap_days, s.availability_target_pct, s.notif_repeat_alert, s.notif_retention_days, s.app_url],
    ['12', '40', '10', '92.5', 'false', '14', 'https://acc.example.test/app/'],
  );
  setSetting(env, admin.token, { availability_target_pct: '', app_url: '' });
});

test('a database made before notifications still works: missing settings fall back to the defaults', () => {
  const { env, admin } = setup();
  const isNew = (r) => r.key.startsWith('notif_') || r.key === 'app_url';
  const before = env.rows('settings').length;
  env.ctx.deleteRows_('settings', env.rows('settings').filter(isNew).map((r) => env.ctx.findBy_('settings', 'key', r.key)._row));
  assert.equal(env.rows('settings').length, before - 6);
  uploadAll(env, admin.token, [at('2026-10-10', '02:00', '12:00')]);
  assert.equal(keysOf(env, admin.token, 'long_stop').length, 1); // default 8 h
  setSetting(env, admin.token, { notif_long_stop_hours: '11' }); // the row is created on first save
  assert.equal(check(env, admin.token).resolved, 1);
});

// ------------------------------------------------------------------ digest

function digestWorld() {
  const { env, admin } = setup();
  setSetting(env, admin.token, { app_url: 'https://acc.example.test/app?x=1&y=2' });
  env.ok('saveEquipment', admin.token, { row: { equipment_id: '100.ZZ99', status: 'Active' }, areaIds: [] }); // needs review
  const mgr = makeUser(env, admin.token, 'ROLE-MGR', 'mgr@example.com');
  const eng = makeUser(env, admin.token, 'ROLE-ENG', 'eng@example.com');
  const view = makeUser(env, admin.token, 'ROLE-VIEW', 'view@example.com');
  const ghost = makeUser(env, admin.token, 'ROLE-ENG', 'ghost@example.com');
  const listed = { reason_raw: 'Bearing failure' };
  uploadAll(env, admin.token, [
    at('2026-10-10', '02:00', '12:00', listed), // long stop in K.1
    at('2026-10-09', '02:00', '13:00', { ...listed, area_id: 'RM.1', code_raw: '100.AB02' }), // long stop in RM.1
    at('2026-10-08', '02:00', '02:30', { ...listed, code_raw: 'ZZ.99' }), // unknown code
    at('2026-10-07', '02:00', '02:30', { ...listed, classification: '' }), // blocked
    at('2026-10-06', '02:00', '02:30', { ...listed, area_id: 'CR', code_raw: '100.AB02', is_failure: false }), // information only
  ]);
  env.ok('saveNotificationPrefs', admin.token, { prefs: { digest: 'daily' } });
  env.ok('saveNotificationPrefs', eng.token, { prefs: { digest: 'weekly' } });
  env.ok('saveNotificationPrefs', view.token, { prefs: { digest: 'daily', watch_areas: 'RM.1' } });
  env.ok('saveNotificationPrefs', mgr.token, { prefs: { digest: 'none' } });
  env.ok('saveNotificationPrefs', ghost.token, { prefs: { digest: 'daily' } });
  env.ok('updateUser', admin.token, { userId: ghost.user_id, changes: { active: false } });
  return { env, admin, mgr, eng, view, ghost };
}

test('digest builder: counts the person can act on, new alerts filtered by their areas, link, no event rows', () => {
  const { env, admin, view } = digestWorld();
  const dctx = env.ctx.digestContext_();
  const get = (u) => env.json(env.ctx.buildDigest_(env.ctx.findUserById_(u.user_id), dctx));
  const a = get(admin);
  assert.equal(a.subject, 'ACC Downtime daily digest - 2 new alerts, 3 items need action');
  assert.match(a.text, /Needs action\n- 2 records to validate \(1 left out of the numbers\)\n- 1 record with an unknown or placeholder code\n- 1 equipment item to review/);
  assert.match(a.text, /New alerts \(2\)\n- Long stop: K\.1 10\.0 h \[K\.1\]\n- Long stop: RM\.1 11\.0 h \[RM\.1\]|New alerts \(2\)\n- Long stop: RM\.1 11\.0 h \[RM\.1\]\n- Long stop: K\.1 10\.0 h \[K\.1\]/);
  assert.match(a.text, /Open the app: https:\/\/acc\.example\.test\/app\?x=1&y=2\n/);
  assert.ok(a.html.includes('href="https://acc.example.test/app?x=1&amp;y=2"'));
  assert.ok(!/EV-[0-9a-f]{16}/.test(a.text + a.html)); // counts, never event rows
  assert.ok(!a.text.includes('<'));
  // a viewer cannot act on records, and follows RM.1 only
  const v = get(view);
  assert.equal(v.subject, 'ACC Downtime daily digest - 1 new alert, 0 items need action');
  assert.ok(!v.text.includes('Needs action'));
  assert.ok(v.text.includes('Long stop: RM.1 11.0 h [RM.1]'));
  assert.ok(!v.text.includes('K.1'));
  // nothing to say for a person without access and without matching alerts
  env.ok('saveNotificationPrefs', view.token, { prefs: { watch_areas: 'HD' } });
  assert.equal(env.ctx.buildDigest_(env.ctx.findUserById_(view.user_id), env.ctx.digestContext_()), null);
  // alert types and dismissed alerts are respected
  env.ok('saveNotificationPrefs', admin.token, { prefs: { alert_types: 'upload_gap' } });
  assert.ok(!env.json(env.ctx.buildDigest_(env.ctx.findUserById_(admin.user_id), env.ctx.digestContext_())).text.includes('New alerts'));
});

test('digest counts (P1/P2): a Failure YES on a PL / CIR / Freq 0 row is to validate until kept as entered; overlaps are information', () => {
  const { env, admin } = setup();
  const listed = { reason_raw: 'Bearing failure' };
  uploadAll(env, admin.token, [
    at('2026-10-01', '02:00', '03:00', { ...listed, code_raw: '100.AA01' }), // clean
    at('2026-10-01', '02:30', '03:30', { ...listed, code_raw: '100.AA01', reason_raw: 'Bearing failure', stop_ts: '2026-10-01 02:30:00.000' }), // overlaps the first: information only
    at('2026-10-02', '02:00', '03:00', { ...listed, classification: 'PL', criticality: 'NO_INC', reason_raw: 'Planned work' }), // PL + Failure YES
    at('2026-10-02', '03:00', '04:00', { ...listed, freq: 0 }), // continuation + Failure YES
  ]);
  const before = env.ctx.digestContext_().counts;
  assert.equal(before.validate - before.codes >= 0, true);
  const mismatch = env.ok('getEvents', admin.token, { year: 2026 }).filter((e) => e.is_failure && (e.classification === 'PL' || e.freq === 0));
  assert.equal(mismatch.length, 2);
  const openNow = (e) => env.ctx.hasOpenProblem_(e);
  const events = env.ok('getEvents', admin.token, { year: 2026 });
  // only the two mismatches (plus whatever stored flags the rows carry) are to validate: the overlapping pair is not
  const clean = events.filter((e) => !e.flags);
  assert.deepEqual(clean.map(openNow).sort(), clean.map((e) => mismatch.some((m) => m.event_id === e.event_id)).sort());
  const cont = mismatch.find((e) => e.freq === 0);
  assert.equal(cont.flags || '', ''); // nothing stored: only the derived warning makes it a record to validate
  assert.equal(openNow(cont), true);
  env.ok('acceptEventFlags', admin.token, { eventId: cont.event_id, flags: ['failure_flag_mismatch'], note: 'Checked: entered correctly' });
  const kept = env.ok('getEvents', admin.token, { year: 2026 }).find((e) => e.event_id === cont.event_id);
  assert.equal(kept.accepted_flags, 'failure_flag_mismatch');
  assert.equal(openNow(kept), false);
  const after = env.ctx.digestContext_().counts;
  assert.equal(after.validate, before.validate - 1);
});

test('sendDigest_: only active users who asked, daily or Sunday weekly, once a day, last_digest_at recorded, new alerts since then', () => {
  const { env, admin, eng } = digestWorld();
  const sent = stubMailApp(env);
  assert.deepEqual(env.json(env.ctx.sendDigest_()), { sent: 2, skipped: 1, failed: 0 }); // Monday: admin and view; eng is weekly
  assert.deepEqual(sent.map((m) => m.to), ['admin@example.com', 'view@example.com']);
  assert.equal(sent[0].name, 'ACC Downtime Analysis');
  assert.ok(sent[0].body && sent[0].htmlBody && sent[0].subject);
  assert.match(env.ok('getNotifications', admin.token).prefs.last_digest_at, /^2026-10-12 11:00:00\.000$/);
  assert.ok(env.rows('audit_log').some((a) => a.action === 'digest_sent' && a.user_id === admin.user_id));

  // again on the same day: nothing is sent twice
  assert.deepEqual(env.json(env.ctx.sendDigest_()), { sent: 0, skipped: 3, failed: 0 });
  assert.equal(sent.length, 2);

  // Tuesday: nothing new for the viewer, who has nothing to act on; the admin still has open records
  env.advance(86400000);
  assert.deepEqual(env.json(env.ctx.sendDigest_()), { sent: 1, skipped: 2, failed: 0 });
  assert.equal(sent[2].to, 'admin@example.com');
  assert.ok(!sent[2].body.includes('New alerts'));
  assert.ok(sent[2].body.includes('Needs action'));

  // Sunday: the weekly digest of the engineer goes out (and only now)
  env.advance(5 * 86400000);
  const r = env.json(env.ctx.sendDigest_());
  assert.equal(r.failed, 0);
  const toEng = sent.filter((m) => m.to === 'eng@example.com');
  assert.equal(toEng.length, 1);
  assert.match(toEng[0].subject, /^ACC Downtime weekly digest - /);
  assert.ok(env.rows('notification_prefs').find((r) => r.user_id === eng.user_id && r.key === 'last_digest_at'));
  assert.ok(!sent.some((m) => m.to === 'mgr@example.com' || m.to === 'ghost@example.com'));
});

test('digest: at most 10 alerts, most severe first, with the number left out', () => {
  const { env, admin } = setup();
  const rows = [];
  for (let d = 10; d <= 21; d++) rows.push(at(`2026-09-${d}`, '01:00', '10:00')); // 12 long stops
  uploadAll(env, admin.token, rows);
  uploadAll(env, admin.token, ['06', '07', '08', '09', '10'].map((d) => at(`2026-10-${d}`, '03:00', '03:30', { area_id: 'HD' }))); // a spike, newer
  assert.equal(keysOf(env, admin.token, 'long_stop').length, 12);
  assert.equal(keysOf(env, admin.token, 'failure_spike').length, 3); // K.1 at two window ends, and HD
  env.ok('saveNotificationPrefs', admin.token, { prefs: { digest: 'daily' } });
  const sent = stubMailApp(env);
  env.ctx.sendDigest_();
  assert.equal(sent.length, 1);
  const body = sent[0].body;
  assert.equal((body.match(/^- Long stop:/gm) || []).length, 10);
  assert.ok(!body.includes('Failures rising'));
  assert.ok(body.includes('New alerts (15)'));
  assert.ok(body.includes('and 5 more - open the app to see them all'));
});

test('digest sending never throws: quota, send errors and a missing MailApp are audited', () => {
  const w = digestWorld();
  const { env } = w;
  // quota used up: stop at once
  stubMailApp(env, { quota: 0 });
  assert.deepEqual(env.json(env.ctx.sendDigest_()), { sent: 0, skipped: 0, failed: 1 });
  assert.ok(env.rows('audit_log').some((a) => a.action === 'digest_failed' && /quota/i.test(a.detail)));
  // every send fails: each person is tried, nothing is recorded as sent
  stubMailApp(env, { failWith: 'Service invoked too many times for one day: email.' });
  assert.deepEqual(env.json(env.ctx.sendDigest_()), { sent: 0, skipped: 1, failed: 2 });
  assert.equal(env.rows('audit_log').filter((a) => a.action === 'digest_failed' && a.detail.includes('too many times')).length, 2);
  assert.deepEqual(env.rows('notification_prefs').filter((r) => r.key === 'last_digest_at'), []);
  // no mail service at all
  delete env.ctx.MailApp;
  assert.equal(env.json(env.ctx.sendDigest_()).failed, 2);
  // the audit never holds an address
  assert.ok(!env.rows('audit_log').filter((a) => a.action === 'digest_failed').some((a) => a.detail.includes('@')));
  // once mail works again the digests go out
  const sent = stubMailApp(env);
  assert.equal(env.json(env.ctx.sendDigest_()).sent, 2);
  assert.equal(sent.length, 2);
});

// ------------------------------------------------------------------ triggers and the daily job

test('installNotificationTriggers is idempotent, removes only its own triggers; removeNotificationTriggers likewise', () => {
  const env = createEnv();
  const triggers = stubScriptApp(env, ['someOtherJob']);
  env.ctx.installNotificationTriggers();
  env.ctx.installNotificationTriggers();
  env.ctx.installNotificationTriggers();
  const ours = () => triggers.filter((t) => t.handler === 'notificationDailyJob');
  assert.equal(ours().length, 1);
  assert.deepEqual(
    { kind: ours()[0].kind, everyDays: ours()[0].everyDays, atHour: ours()[0].atHour, timezone: ours()[0].timezone },
    { kind: 'time', everyDays: 1, atHour: 7, timezone: 'Africa/Cairo' },
  );
  assert.equal(triggers.filter((t) => t.handler === 'someOtherJob').length, 1);
  assert.ok(env.logs.some((l) => l.includes('replaced 1 earlier trigger')));
  assert.match(env.ctx.removeNotificationTriggers(), /Removed 1 notification trigger\./);
  assert.equal(ours().length, 0);
  assert.equal(triggers.length, 1);
  assert.match(env.ctx.removeNotificationTriggers(), /Removed 0 notification triggers\./);
});

test('notificationDailyJob: checks first, then digests; one failing step does not stop the other or throw', () => {
  const { env, admin } = setup();
  uploadAll(env, admin.token, [at('2026-08-01', '02:00', '12:00')]); // old data: a gap alert on the next check
  env.ok('saveNotificationPrefs', admin.token, { prefs: { digest: 'daily' } });
  const sent = stubMailApp(env);
  const out = env.json(env.ctx.notificationDailyJob());
  assert.deepEqual(out.checks, { created: 0, resolved: 0, expired: 0 }); // the upload already raised the gap alert
  assert.equal(out.digest.sent, 1);
  assert.ok(sent[0].body.includes('No upload since 2026-08-01'));

  env.ss.sheets.delete('notifications');
  const broken = env.json(env.ctx.notificationDailyJob());
  assert.equal(broken.checks, null);
  assert.ok(env.rows('audit_log').some((a) => a.action === 'notification_failed' && a.detail.startsWith('daily checks')));
});

// ------------------------------------------------------------------ schema, manifest, bundle

test('ensureSchema adds the notification sheets and settings to an older database without touching data', () => {
  const { env, admin } = setup();
  uploadAll(env, admin.token, [at('2026-10-10', '02:00', '12:00')]);
  for (const n of ['notifications', 'notification_state', 'notification_prefs']) env.ss.sheets.delete(n);
  const snapshot = (names) => names.map((n) => JSON.stringify(env.sheet(n).data));
  const keepNames = ['events', 'users', 'settings', 'audit_log'];
  const before = snapshot(keepNames);
  const report = env.json(env.ctx.ensureSchema());
  assert.ok(report.includes('Created sheet notifications'));
  assert.ok(report.includes('Created sheet notification_state'));
  assert.ok(report.includes('Created sheet notification_prefs'));
  assert.deepEqual(snapshot(keepNames), before);
  assert.deepEqual(env.sheet('notifications').data[0], env.json(env.run('SCHEMA')).tables.notifications.columns.map((c) => c.name));
  assert.equal(env.json(env.ctx.ensureSchema()).some((l) => l.startsWith('Created')), false);
  assert.match(env.ctx.installCheck(), /Everything looks ready/);
});

test('appsscript.json keeps the web app settings and lists the scopes the code needs', () => {
  const m = JSON.parse(readFileSync(resolve(BACKEND_DIR, 'appsscript.json'), 'utf8'));
  for (const s of ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/script.send_mail', 'https://www.googleapis.com/auth/script.scriptapp',
    // 1.9.0: sending as the system email (a Gmail 'Send mail as' alias) and checking the alias list
    'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.settings.basic']) {
    assert.ok(m.oauthScopes.includes(s), s);
  }
  assert.equal(m.oauthScopes.length, 5);
  assert.deepEqual(m.dependencies.enabledAdvancedServices, [{ userSymbol: 'Gmail', serviceId: 'gmail', version: 'v1' }]);
});

test('the one-file bundle includes Notifications.js', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'acc-bundle-'));
  const out = resolve(dir, 'bundle.gs');
  execFileSync('node', [resolve(BACKEND_DIR, '../../tools/bundle-apps-script.mjs'), out], { stdio: 'pipe' });
  const text = readFileSync(out, 'utf8');
  assert.ok(text.includes('// Notifications.js'));
  assert.ok(text.includes('function runNotificationChecks_'));
  assert.ok(text.includes('function notificationDailyJob'));
});
