import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, seedMaster, stubScriptApp, uploadAll, uploadRow } from './harness.mjs';

// 1.10.0: the notification and action checks after an upload run in a one-off background trigger; the daily job also
// removes old resolved / expired notifications and their seen / dismissed rows.

const MIN = 60000;
const DAY = 24 * 60 * MIN;

function setup() {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  return { env, admin };
}
const items = (env, token) => env.ok('getNotifications', token).items;
const longStop = (over = {}) => uploadRow({ stop_ts: '2026-03-05 01:00:00.000', start_ts: '2026-03-05 13:00:00.000', ...over });

test('uploadFinish answers without running the checks; the one-off trigger runs them once for every upload since', () => {
  const { env, admin } = setup();
  const triggers = stubScriptApp(env);
  uploadAll(env, admin.token, [longStop()], 'a.xlsx');
  uploadAll(env, admin.token, [uploadRow({ event_date: '2026-03-06', stop_ts: '2026-03-06 02:00:00.000', start_ts: '2026-03-06 02:10:00.000' })], 'b.xlsx');
  assert.deepEqual(items(env, admin.token).map((i) => i.type), [], 'nothing yet: the checks wait for the trigger');
  const job = triggers.filter((t) => t.handler === 'afterUploadJob');
  assert.equal(job.length, 1, 'one waiting trigger for both uploads');
  assert.ok(job[0].afterMs > 0);
  const out = env.json(env.ctx.afterUploadJob());
  assert.equal(out.uploads, 2);
  const types = items(env, admin.token).map((i) => i.type);
  assert.equal(types.filter((t) => t === 'upload_done').length, 2, 'each upload has its update');
  assert.ok(types.includes('long_stop'));
  assert.equal(triggers.filter((t) => t.handler === 'afterUploadJob').length, 0, 'the trigger removed itself');
  // a second run with nothing pending does nothing
  assert.equal(env.json(env.ctx.afterUploadJob()).uploads, 0);
});

test('without triggers (or when one cannot be made) the checks run inside the upload as before', () => {
  const { env, admin } = setup();
  uploadAll(env, admin.token, [longStop()]);
  assert.ok(items(env, admin.token).some((i) => i.type === 'long_stop'));
  const env2 = setup();
  const t = stubScriptApp(env2.env);
  env2.env.ctx.ScriptApp.newTrigger = () => { throw new Error('Too many triggers'); };
  uploadAll(env2.env, env2.admin.token, [longStop()]);
  assert.ok(items(env2.env, env2.admin.token).some((i) => i.type === 'upload_done'));
  assert.equal(t.length, 0);
});

test('daily clean-up removes notifications resolved or expired longer ago than the retention, with their states', () => {
  const { env, admin } = setup();
  uploadAll(env, admin.token, [longStop()]);
  const all = env.rows('notifications');
  assert.ok(all.length >= 2);
  const first = all[0].notification_id;
  env.ok('setNotificationState', admin.token, { notificationId: first, state: 'dismissed' });
  assert.equal(env.rows('notification_state').length, 1);
  // 31 days later: open ones expire (status written by the checks); 31 more days: older than the 30-day retention
  env.advance(31 * DAY);
  env.ctx.runNotificationChecks_({});
  assert.ok(env.rows('notifications').filter((n) => n.status === 'expired').length >= 2);
  const kept = env.json(env.ctx.cleanupNotifications_());
  assert.deepEqual(kept, { notifications: 0, states: 0 }, 'just expired: kept for the retention period');
  env.advance(31 * DAY);
  const res = env.json(env.ctx.cleanupNotifications_());
  assert.ok(res.notifications >= 2);
  assert.equal(res.states, 1);
  assert.ok(!env.rows('notifications').some((n) => n.notification_id === first));
  assert.equal(env.rows('notification_state').length, 0);
  // the daily job runs it
  const out = env.json(env.ctx.notificationDailyJob());
  assert.ok(out.cleanup);
});
