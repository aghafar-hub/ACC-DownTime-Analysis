import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, makeUser } from './harness.mjs';

// 1.10.0: only an Admin manages Admins (Users.js requireAdminFor_).

test('a non-Admin with Edit on Users manages non-Admins only', () => {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  const mgr = makeUser(env, admin.token, 'ROLE-MGR', 'mgr@example.com');
  const other = makeUser(env, admin.token, 'ROLE-ENG', 'other@example.com');
  env.ok('setUserTabAccess', admin.token, { userId: mgr.user_id, overrides: { users: 'Edit' } });
  const err = (r) => [r.error?.code, r.error?.message];
  assert.deepEqual(err(env.call('createUser', mgr.token, { u: { email: 'x@example.com', display_name: 'X', role_id: 'ROLE-ADMIN' } })), ['forbidden', 'Only an Admin can create an Admin.']);
  assert.deepEqual(err(env.call('updateUser', mgr.token, { userId: admin.user_id, changes: { display_name: 'Boss' } })), ['forbidden', 'Only an Admin can change an Admin.']);
  assert.deepEqual(err(env.call('updateUser', mgr.token, { userId: other.user_id, changes: { role_id: 'ROLE-ADMIN' } })), ['forbidden', 'Only an Admin can give the Admin role.']);
  assert.deepEqual(err(env.call('resetPassword', mgr.token, { userId: admin.user_id })), ['forbidden', 'Only an Admin can reset the password of an Admin.']);
  assert.deepEqual(err(env.call('setUserTabAccess', mgr.token, { userId: admin.user_id, overrides: { events: 'View' } })), ['forbidden', 'Only an Admin can change the page access of an Admin.']);
  // non-Admins: allowed as before
  env.ok('createUser', mgr.token, { u: { email: 'y@example.com', display_name: 'Y', role_id: 'ROLE-VIEW' } });
  env.ok('updateUser', mgr.token, { userId: other.user_id, changes: { display_name: 'Other Two' } });
  env.ok('resetPassword', mgr.token, { userId: other.user_id });
  env.ok('setUserTabAccess', mgr.token, { userId: other.user_id, overrides: { events: 'View' } });
  // the Admin still does everything
  env.ok('createUser', admin.token, { u: { email: 'z@example.com', display_name: 'Z', role_id: 'ROLE-ADMIN' } });
  env.ok('updateUser', admin.token, { userId: other.user_id, changes: { role_id: 'ROLE-ADMIN' } });
});
