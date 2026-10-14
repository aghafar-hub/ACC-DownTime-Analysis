import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expected, OUTPUT_JS, SCHEMA_JSON } from '../../../tools/gen-apps-script-schema.mjs';
import { createEnv, BACKEND_DIR } from './harness.mjs';

test('Schema.js is up to date with schema/tables.json (run: node tools/gen-apps-script-schema.mjs)', () => {
  assert.equal(readFileSync(OUTPUT_JS, 'utf8'), expected());
});

test('every table in the schema is known to the backend and vice versa', () => {
  const env = createEnv({ prepare: false });
  const schema = JSON.parse(readFileSync(SCHEMA_JSON, 'utf8'));
  const names = schema.tables.map((t) => t.name);
  assert.deepEqual(env.json(env.run('SCHEMA.tableOrder')), names);
  assert.deepEqual(Object.values(env.json(env.run('T'))).sort(), [...names].sort());
});

test('settings rules cover every default setting and nothing else', () => {
  const env = createEnv({ prepare: false });
  const schema = JSON.parse(readFileSync(SCHEMA_JSON, 'utf8'));
  assert.deepEqual(Object.keys(env.json(env.run('SETTING_RULES'))).sort(), schema.settingsDefaults.map((s) => s.key).sort());
});

test('backend source rules: no Math.random, no real URLs, no secrets', () => {
  for (const f of readdirSync(BACKEND_DIR).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(resolve(BACKEND_DIR, f), 'utf8');
    assert.ok(!/Math\.random/.test(src), `${f} uses Math.random`);
    assert.ok(!/script\.google\.com\/macros\/s\//.test(src), `${f} contains a deployment URL`);
    assert.ok(!/AKfy[0-9A-Za-z_-]{20,}/.test(src), `${f} looks like it contains a deployment id`);
  }
});

test('appsscript.json: V8, Cairo, anonymous web app executed as the deployer', () => {
  const m = JSON.parse(readFileSync(resolve(BACKEND_DIR, 'appsscript.json'), 'utf8'));
  assert.equal(m.runtimeVersion, 'V8');
  assert.equal(m.timeZone, 'Africa/Cairo');
  assert.equal(m.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(m.webapp.access, 'ANYONE_ANONYMOUS');
});

test('notification tables follow docs/notifications-design.md section 4', () => {
  const env = createEnv({ prepare: false });
  const schema = env.json(env.run('SCHEMA'));
  assert.ok(schema.version >= 2);
  const cols = (t) => schema.tables[t].columns.map((c) => c.name);
  assert.deepEqual(cols('notifications'), ['notification_id', 'type', 'severity', 'dedupe_key', 'title', 'detail', 'area_id', 'line_id', 'source_ref', 'created_at', 'expires_at', 'status', 'resolved_at']);
  assert.deepEqual(cols('notification_state'), ['user_id', 'notification_id', 'state', 'snooze_until', 'updated_at']);
  assert.deepEqual(cols('notification_prefs'), ['user_id', 'key', 'value', 'updated_at']);
  const col = (t, c) => schema.tables[t].columns.find((x) => x.name === c);
  assert.deepEqual(col('notifications', 'type').enum, ['long_stop', 'repeat_group', 'failure_spike', 'availability_low', 'upload_gap', 'upload_done', 'user_event', 'planned_overrun', 'action_due']);
  assert.deepEqual(col('notifications', 'severity').enum, ['alert', 'update']);
  assert.deepEqual(col('notifications', 'status').enum, ['open', 'resolved', 'expired']);
  assert.deepEqual(col('notification_state', 'state').enum, ['seen', 'snoozed', 'dismissed']);
  assert.equal(col('notifications', 'dedupe_key').required, true);
  const defaults = Object.fromEntries(env.json(env.run('SCHEMA.seeds.settings')).map((s) => [s.key, s.value]));
  assert.ok(!('notif_availability_target_pct' in defaults) && !('target_availability_pct' in defaults), 'one availability target only');
  assert.deepEqual(
    ['notif_long_stop_hours', 'notif_spike_pct', 'notif_upload_gap_days', 'notif_repeat_alert', 'notif_retention_days', 'app_url'].map((k) => defaults[k]),
    ['8', '30', '35', 'true', '30', ''],
  );
});

test('action tables follow docs/wire-protocol.md section 10; contractor seeds use the area ids of the area seeds', () => {
  const env = createEnv({ prepare: false });
  const schema = env.json(env.run('SCHEMA'));
  assert.ok(schema.version >= 4);
  const cols = (t) => schema.tables[t].columns.map((c) => c.name);
  for (const c of ['action_id', 'title', 'detail', 'status', 'priority', 'source', 'source_ref', 'scope_kind', 'area_id', 'line_id', 'equipment_id',
    'reason_key', 'owner_kind', 'owner', 'due_date', 'created_by', 'created_at', 'updated_at', 'updated_by', 'closed_by', 'closed_at',
    'closure_note', 'effectiveness', 'effectiveness_checked_at', 'evidence', 'dedupe_key']) assert.ok(cols('actions').includes(c), c);
  assert.deepEqual(cols('action_log'), ['log_id', 'action_id', 'at', 'by', 'kind', 'from_status', 'to_status', 'text']);
  for (const c of ['contractor_id', 'name', 'areas', 'kind', 'active', 'sort_order']) assert.ok(cols('contractors').includes(c), c);
  for (const c of ['area_id', 'year', 'availability_target_pct', 'planned_allowance_h_year', 'monthly_split', 'overhaul_months', 'updated_at', 'updated_by']) {
    assert.ok(cols('area_targets').includes(c), c);
  }
  const col = (t, c) => schema.tables[t].columns.find((x) => x.name === c);
  assert.deepEqual(col('actions', 'status').enum, ['Draft', 'Open', 'Contractor informed', 'Waiting stoppage', 'In progress', 'Closed', 'Cancelled']);
  assert.deepEqual(col('actions', 'effectiveness').enum, ['', 'Watching', 'Effective', 'Not effective']);
  const areas = new Set(schema.seeds.areas.map((a) => a.area_id));
  const seeded = schema.seeds.contractors;
  assert.deepEqual(seeded.map((c) => c.contractor_id), ['RHI', 'ASEC', 'MEC', 'ELE', 'AUT', 'PRO']);
  for (const c of seeded) for (const a of c.areas.split(',').filter(Boolean)) assert.ok(areas.has(a), `${c.contractor_id}: ${a}`);
  const all = seeded.flatMap((c) => c.areas.split(',').filter(Boolean));
  assert.equal(new Set(all).size, all.length, 'an area belongs to one contractor');
  assert.equal(all.length, 19, 'every area has a contractor');
  const defaults = Object.fromEntries(schema.seeds.settings.map((s) => [s.key, s.value]));
  assert.deepEqual(['actions_closers', 'actions_repeat_n', 'actions_repeat_days', 'actions_chronic_top', 'actions_chronic_months', 'actions_effect_days', 'actions_auto_draft'].map((k) => defaults[k]),
    ['', '3', '30', '10', '3', '60', 'true']);
});
