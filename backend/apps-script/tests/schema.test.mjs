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
