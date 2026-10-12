import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, makeUser } from './harness.mjs';

function setup() {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  return { env, admin };
}

test('createUser: temp password shown once, hash verifies, nothing else leaks it', () => {
  const { env, admin } = setup();
  const r = env.ok('createUser', admin.token, { u: { email: 'New.User@Example.com', display_name: 'New User', role_id: 'ROLE-ENG' } });
  assert.ok(r.temp_password.length >= 12);
  assert.match(r.temp_password, /[a-z]/);
  assert.match(r.temp_password, /[A-Z]/);
  assert.match(r.temp_password, /[0-9]/);
  assert.equal(r.user.email, 'new.user@example.com');
  assert.equal(r.user.must_change, true);
  assert.equal(r.user.active, true);
  assert.deepEqual(r.user.overrides, {});
  assert.ok(!('password_hash' in r.user));
  const row = env.rows('users').find((u) => u.email === 'new.user@example.com');
  assert.equal(row.must_change, true);
  assert.equal(row.hash_rounds, 25);
  assert.equal(row.created_by, admin.user_id);
  assert.equal(env.ctx.verifyPassword_(env.ctx.findUserByEmail_('new.user@example.com'), r.temp_password), true);
  assert.equal(env.ctx.verifyPassword_(env.ctx.findUserByEmail_('new.user@example.com'), r.temp_password + 'x'), false);
  // the temp password is nowhere else: not in the sheets, the listing or the audit log
  for (const name of ['users', 'audit_log', 'tab_access', 'settings']) {
    assert.ok(!JSON.stringify(env.rows(name)).includes(r.temp_password), name);
  }
  assert.ok(!JSON.stringify(env.ok('listUsers', admin.token)).includes(r.temp_password));
  assert.ok(!env.logs.join('\n').includes(r.temp_password));
  assert.ok(env.rows('audit_log').some((a) => a.action === 'create_user' && a.user_id === admin.user_id));
});

test('createUser validation and duplicates', () => {
  const { env, admin } = setup();
  const u = { email: 'a@example.com', display_name: 'A', role_id: 'ROLE-VIEW' };
  env.ok('createUser', admin.token, { u });
  assert.equal(env.call('createUser', admin.token, { u: { ...u, email: 'A@EXAMPLE.COM' } }).error.code, 'conflict');
  assert.equal(env.call('createUser', admin.token, { u: { ...u, email: 'not-an-email' } }).error.code, 'bad_request');
  assert.equal(env.call('createUser', admin.token, { u: { ...u, email: 'b@example.com', role_id: 'ROLE-NONE' } }).error.code, 'bad_request');
  assert.equal(env.call('createUser', admin.token, { u: { ...u, email: 'b@example.com', display_name: ' ' } }).error.code, 'bad_request');
  assert.equal(env.call('createUser', admin.token, { u: null }).error.code, 'bad_request');
  assert.equal(env.rows('users').length, 2);
});

test('temporary passwords are random: many are all different and well formed', () => {
  const { ctx } = createEnv();
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = ctx.generateTempPassword_();
    assert.match(p, /^[A-HJ-NP-Za-hj-km-np-z2-9]{14}$/);
    assert.match(p, /[a-z]/); assert.match(p, /[A-Z]/); assert.match(p, /[0-9]/);
    seen.add(p);
  }
  assert.equal(seen.size, 200);
});

test('listUsers: admin view with overrides and no secrets', () => {
  const { env, admin } = setup();
  const v = makeUser(env, admin.token, 'ROLE-VIEW', 'v@example.com');
  env.ok('setUserTabAccess', admin.token, { userId: v.user_id, overrides: { upload: 'View' } });
  const list = env.ok('listUsers', admin.token);
  assert.equal(list.length, 2);
  const row = list.find((u) => u.email === 'v@example.com');
  assert.deepEqual(row.overrides, { upload: 'View' });
  assert.equal(row.must_change, false);
  assert.ok(row.last_login_at === undefined || typeof row.last_login_at === 'string');
  assert.ok(!/hash|salt|rounds|locked|failed/.test(JSON.stringify(list)));
  assert.equal(env.call('listUsers', v.token).error.code, 'forbidden');
});

test('listUsers is allowed for users with View on the Users tab (but createUser is not)', () => {
  const { env, admin } = setup();
  const v = makeUser(env, admin.token, 'ROLE-VIEW', 'v@example.com');
  env.ok('setUserTabAccess', admin.token, { userId: v.user_id, overrides: { users: 'View' } });
  assert.equal(env.call('listUsers', v.token).status, 'ok');
  assert.equal(env.call('createUser', v.token, { u: {} }).error.code, 'forbidden');
});

test('updateUser: name, role, active; guards against locking everyone out', () => {
  const { env, admin } = setup();
  const e = makeUser(env, admin.token, 'ROLE-ENG', 'e@example.com');
  const r = env.ok('updateUser', admin.token, { userId: e.user_id, changes: { display_name: 'Renamed', role_id: 'ROLE-MGR' } });
  assert.equal(r.display_name, 'Renamed');
  assert.equal(r.role_id, 'ROLE-MGR');
  assert.equal(env.call('updateUser', admin.token, { userId: e.user_id, changes: { role_id: 'ROLE-NONE' } }).error.code, 'bad_request');
  assert.equal(env.call('updateUser', admin.token, { userId: e.user_id, changes: {} }).error.code, 'bad_request');
  assert.equal(env.call('updateUser', admin.token, { userId: e.user_id, changes: { active: 'no' } }).error.code, 'bad_request');
  assert.equal(env.call('updateUser', admin.token, { userId: 'U-missing', changes: { active: false } }).error.code, 'not_found');
  assert.equal(env.call('updateUser', admin.token, { userId: admin.user_id, changes: { active: false } }).error.code, 'conflict');
  assert.equal(env.call('updateUser', admin.token, { userId: admin.user_id, changes: { role_id: 'ROLE-VIEW' } }).error.code, 'conflict');
  assert.ok(env.rows('audit_log').some((a) => a.action === 'update_user'));
});

test('the last active Admin cannot be removed even by another admin session', () => {
  const { env, admin } = setup();
  const second = makeUser(env, admin.token, 'ROLE-ADMIN', 'a2@example.com');
  env.ok('updateUser', second.token, { userId: admin.user_id, changes: { active: false } });
  const r = env.call('updateUser', admin.token, { userId: second.user_id, changes: { active: false } });
  assert.equal(r.error.code, 'unauthenticated'); // the first admin was just deactivated
  const r2 = env.call('updateUser', second.token, { userId: second.user_id, changes: { role_id: 'ROLE-VIEW' } });
  assert.equal(r2.error.code, 'conflict');
});

test('resetPassword: new temp password, old one dead, must_change set, lock cleared', () => {
  const { env, admin } = setup();
  const e = makeUser(env, admin.token, 'ROLE-ENG', 'e@example.com');
  for (let i = 0; i < 5; i++) env.call('login', '', { email: e.email, password: 'nope-nope-1' });
  assert.equal(env.call('login', '', { email: e.email, password: e.password }).error.code, 'locked');
  const r = env.ok('resetPassword', admin.token, { userId: e.user_id });
  assert.ok(r.temp_password.length >= 12);
  assert.equal(env.call('login', '', { email: e.email, password: e.password }).error.code, 'bad_credentials');
  const s = env.ok('login', '', { email: e.email, password: r.temp_password });
  assert.equal(s.must_change, true);
  assert.equal(env.call('resetPassword', admin.token, { userId: 'U-missing' }).error.code, 'not_found');
  assert.ok(!JSON.stringify(env.rows('audit_log')).includes(r.temp_password));
});

test('setUserTabAccess replaces overrides, validates input, and protects own Users access', () => {
  const { env, admin } = setup();
  const e = makeUser(env, admin.token, 'ROLE-ENG', 'e@example.com');
  let u = env.ok('setUserTabAccess', admin.token, { userId: e.user_id, overrides: { upload: 'Hidden', settings: 'View' } });
  assert.deepEqual(u.overrides, { upload: 'Hidden', settings: 'View' });
  u = env.ok('setUserTabAccess', admin.token, { userId: e.user_id, overrides: { settings: 'Edit' } });
  assert.deepEqual(u.overrides, { settings: 'Edit' });
  assert.equal(env.rows('tab_access').filter((r) => r.subject_type === 'user').length, 1);
  assert.equal(env.call('setUserTabAccess', admin.token, { userId: e.user_id, overrides: { nope: 'Edit' } }).error.code, 'bad_request');
  assert.equal(env.call('setUserTabAccess', admin.token, { userId: e.user_id, overrides: { upload: 'Admin' } }).error.code, 'bad_request');
  assert.equal(env.call('setUserTabAccess', admin.token, { userId: 'U-missing', overrides: {} }).error.code, 'not_found');
  assert.equal(env.call('setUserTabAccess', admin.token, { userId: admin.user_id, overrides: { users: 'View' } }).error.code, 'conflict');
  assert.deepEqual(env.rows('tab_access').filter((r) => r.subject_type === 'role').length, 36);
  assert.ok(env.rows('audit_log').some((a) => a.action === 'set_tab_access'));
});

test('createFirstAdmin: random temp password logged once, role admin, no duplicate', () => {
  const env = createEnv();
  env.ctx.createFirstAdmin('first@example.com', 'First Admin');
  const lines = env.logs.filter((l) => l.includes('Temporary password'));
  assert.equal(lines.length, 1);
  const temp = /write it down\): (\S+)/.exec(lines[0])[1];
  assert.ok(temp.length >= 12);
  const row = env.rows('users')[0];
  assert.equal(row.role_id, 'ROLE-ADMIN');
  assert.equal(row.must_change, true);
  assert.equal(row.created_by, 'setup');
  assert.ok(!row.password_hash.includes(temp));
  assert.ok(!env.logs.join('\n').includes('test-pepper'));
  assert.throws(() => env.ctx.createFirstAdmin('FIRST@example.com', 'Again'), /already exists/);
  assert.throws(() => env.ctx.createFirstAdmin('bad', 'x'), /valid email/);
  assert.throws(() => env.ctx.createFirstAdminRun(), /Edit the email/);
  assert.equal(env.logs.filter((l) => l.includes('Temporary password')).length, 1);
});
