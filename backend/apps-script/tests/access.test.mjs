import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEnv, bootstrapAdmin, makeUser, BACKEND_DIR } from './harness.mjs';

const ROOT = resolve(BACKEND_DIR, '../..');
const schema = JSON.parse(readFileSync(resolve(ROOT, 'schema/tables.json'), 'utf8'));
const DASH = ['overview', 'pareto', 'repeats', 'reliability', 'events'];

// Independent copy of docs/wire-protocol.md section 3.
const REQ = {
  login: 'none', changePassword: 'session', getMyAccess: 'session', getStartup: 'anyTab',
  getEvents: [DASH, 'View'], getEventEdits: [['events'], 'View'],
  getUploadHistory: [['upload'], 'View'], getUploadWarnings: [['upload'], 'View'],
  uploadStart: [['upload'], 'Edit'], uploadChunk: [['upload'], 'Edit'], uploadFinish: [['upload'], 'Edit'],
  editEvent: [['events'], 'Edit'], revalidateEvents: [['events'], 'Edit'], voidEvent: [['events'], 'Edit'], acceptEventFlags: [['events'], 'Edit'],
  saveEquipment: [['master'], 'Edit'], saveArea: [['master'], 'Edit'], saveReason: [['master'], 'Edit'],
  saveAlias: [['master'], 'Edit'], deleteAlias: [['master'], 'Edit'], saveSettings: [['settings'], 'Edit'],
  listUsers: [['users'], 'View'], createUser: [['users'], 'Edit'], updateUser: [['users'], 'Edit'],
  resetPassword: [['users'], 'Edit'], setUserTabAccess: [['users'], 'Edit'],
  getNotifications: 'session', setNotificationState: 'session', saveNotificationPrefs: 'session',
  runNotificationChecks: [['settings'], 'Edit'],
};
const RANK = { Hidden: 0, View: 1, Edit: 2 };

function allowed(action, access) {
  const r = REQ[action];
  if (r === 'none' || r === 'session') return true;
  if (r === 'anyTab') return Object.values(access).some((l) => l !== 'Hidden');
  return r[0].some((t) => RANK[access[t]] >= RANK[r[1]]);
}

test('every action in the Api interface has an access rule and a handler (and no extras)', () => {
  const src = readFileSync(resolve(ROOT, 'src/api/types.ts'), 'utf8');
  const block = src.slice(src.indexOf('export interface Api {'));
  const names = [...block.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]);
  assert.ok(names.length >= 24, 'parsed the Api interface');
  const env = createEnv({ prepare: false });
  const rules = Object.keys(env.json(env.run('ACTION_RULES')));
  const handlers = Object.keys(env.run('HANDLERS'));
  for (const n of names) {
    assert.ok(rules.includes(n), `Api.${n} has no access rule in Access.js`);
    assert.ok(handlers.includes(n), `Api.${n} has no handler in Code.js`);
  }
  assert.deepEqual([...rules].sort(), [...names].sort());
  assert.deepEqual([...handlers].sort(), [...names].sort());
  assert.deepEqual(Object.keys(REQ).sort(), [...names].sort(), 'test table is complete');
});

test('rule table matches docs/wire-protocol.md section 3', () => {
  const env = createEnv({ prepare: false });
  const rules = env.json(env.run('ACTION_RULES'));
  for (const [action, r] of Object.entries(REQ)) {
    if (typeof r === 'string') { assert.equal(rules[action].auth, r === 'none' ? 'none' : r, action); continue; }
    assert.equal(rules[action].auth, 'tabs', action);
    assert.deepEqual([...rules[action].tabs].sort(), [...r[0]].sort(), action);
    assert.equal(rules[action].level, r[1], action);
  }
});

function setup() {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  const users = {
    'ROLE-MGR': makeUser(env, admin.token, 'ROLE-MGR', 'mgr@example.com'),
    'ROLE-ENG': makeUser(env, admin.token, 'ROLE-ENG', 'eng@example.com'),
    'ROLE-VIEW': makeUser(env, admin.token, 'ROLE-VIEW', 'view@example.com'),
    'ROLE-ADMIN': admin,
  };
  return { env, admin, users };
}

function checkMatrix(env, token, access, label) {
  for (const action of Object.keys(REQ)) {
    if (action === 'login') continue;
    const r = env.call(action, token, {});
    const denied = r.status === 'error' && r.error.code === 'forbidden';
    assert.equal(!denied, allowed(action, access), `${label}: ${action}`);
    if (denied) assert.equal(r.error.accessDenied, true);
  }
}

test('access matrix: every action for every default role', () => {
  const { env, users } = setup();
  for (const [role, u] of Object.entries(users)) {
    const access = schema.tabAccessDefaults[role];
    assert.deepEqual(env.ok('getMyAccess', u.token).access, access, role);
    checkMatrix(env, u.token, access, role);
  }
});

test('user overrides win over the role, including Hidden', () => {
  const { env, admin, users } = setup();
  const v = users['ROLE-VIEW'];
  env.ok('setUserTabAccess', admin.token, { userId: v.user_id, overrides: { events: 'Edit', overview: 'Hidden', master: 'View' } });
  const access = { ...schema.tabAccessDefaults['ROLE-VIEW'], events: 'Edit', overview: 'Hidden', master: 'View' };
  assert.deepEqual(env.ok('getMyAccess', v.token).access, access);
  checkMatrix(env, v.token, access, 'viewer with overrides');

  const e = users['ROLE-ENG'];
  env.ok('setUserTabAccess', admin.token, { userId: e.user_id, overrides: { upload: 'Hidden', events: 'View' } });
  checkMatrix(env, e.token, { ...schema.tabAccessDefaults['ROLE-ENG'], upload: 'Hidden', events: 'View' }, 'engineer with overrides');
});

test('a user with every tab Hidden can only use session actions', () => {
  const { env, admin, users } = setup();
  const v = users['ROLE-VIEW'];
  const all = Object.fromEntries(DASH.concat(['upload', 'master', 'settings', 'users']).map((t) => [t, 'Hidden']));
  env.ok('setUserTabAccess', admin.token, { userId: v.user_id, overrides: all });
  checkMatrix(env, v.token, all, 'all hidden');
  assert.equal(env.call('getStartup', v.token).error.code, 'forbidden');
});

test('a missing row means Hidden', () => {
  const env = createEnv();
  const user = { user_id: 'U-x', role_id: 'ROLE-NONE' };
  const access = env.json(env.ctx.computeAccess_(user, []));
  assert.ok(Object.values(access).every((l) => l === 'Hidden'));
  assert.equal(Object.keys(access).length, 9);
});

test('removing overrides (empty set) returns the user to the role defaults', () => {
  const { env, admin, users } = setup();
  const v = users['ROLE-VIEW'];
  env.ok('setUserTabAccess', admin.token, { userId: v.user_id, overrides: { upload: 'Edit' } });
  assert.equal(env.ok('getMyAccess', v.token).access.upload, 'Edit');
  const u = env.ok('setUserTabAccess', admin.token, { userId: v.user_id, overrides: {} });
  assert.deepEqual(u.overrides, {});
  assert.equal(env.ok('getMyAccess', v.token).access.upload, 'Hidden');
});

test('role change takes effect on the next call with the same token', () => {
  const { env, admin, users } = setup();
  const v = users['ROLE-VIEW'];
  assert.equal(env.call('uploadStart', v.token, {}).error.code, 'forbidden');
  env.ok('updateUser', admin.token, { userId: v.user_id, changes: { role_id: 'ROLE-ENG' } });
  assert.equal(env.call('uploadStart', v.token, {}).status, 'ok');
});

test('unknown actions are refused without leaking anything', () => {
  const { env, admin } = setup();
  const r = env.call('dropEverything', admin.token, {});
  assert.equal(r.error.code, 'bad_request');
  assert.equal(env.call('toString', admin.token, {}).error.code, 'bad_request');
  assert.equal(env.call('__proto__', admin.token, {}).error.code, 'bad_request');
});
