import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, makeUser, GOOD_PASSWORD } from './harness.mjs';

const MIN = 60000;
const HOUR = 3600000;

function setup() {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  const eng = makeUser(env, admin.token, 'ROLE-ENG', 'eng@example.com');
  return { env, admin, eng };
}

test('login success returns a session with access, never hash fields', () => {
  const { env, eng } = setup();
  const s = env.ok('login', '', { email: ' ENG@Example.com ', password: eng.password, keepSignedIn: false });
  assert.equal(s.user.email, 'eng@example.com');
  assert.equal(s.user.role_id, 'ROLE-ENG');
  assert.equal(s.must_change, false);
  assert.equal(s.access.upload, 'Edit');
  assert.equal(Date.parse(s.expires_at) - env.clock.now, 12 * HOUR);
  assert.ok(!JSON.stringify(s).match(/password_hash|password_salt|hash_rounds/));
  const payload = JSON.parse(Buffer.from(s.token.split('.')[0], 'base64url').toString());
  assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'pv', 'role', 'uid']);
  assert.equal(payload.pv.length, 12); // a short password fingerprint, never the hash itself
  assert.equal(payload.exp - payload.iat, 12 * HOUR);
  const row = env.rows('users').find((u) => u.email === 'eng@example.com');
  assert.equal(row.last_login_at.slice(0, 4), '2026');
});

test('keep signed in uses the longer session', () => {
  const { env, eng } = setup();
  const s = env.ok('login', '', { email: eng.email, password: eng.password, keepSignedIn: true });
  assert.equal(Date.parse(s.expires_at) - env.clock.now, 720 * HOUR);
});

test('wrong password and unknown email give the same message', () => {
  const { env, eng } = setup();
  const a = env.call('login', '', { email: eng.email, password: 'wrong-wrong-1' });
  const b = env.call('login', '', { email: 'nobody@example.com', password: 'wrong-wrong-1' });
  assert.equal(a.status, 'error');
  assert.equal(a.error.code, 'bad_credentials');
  assert.deepEqual(a, b);
  assert.equal(env.call('login', '', { email: '', password: '' }).error.code, 'bad_request');
});

test('lockout after the configured number of wrong passwords, then unlock after the time', () => {
  const { env, eng } = setup();
  for (let i = 1; i <= 4; i++) assert.equal(env.call('login', '', { email: eng.email, password: 'nope-nope-1' }).error.code, 'bad_credentials');
  const fifth = env.call('login', '', { email: eng.email, password: 'nope-nope-1' });
  assert.equal(fifth.error.code, 'locked');
  assert.match(fifth.error.message, /15 minutes/);
  // the correct password is refused while locked
  assert.equal(env.call('login', '', { email: eng.email, password: eng.password }).error.code, 'locked');
  env.advance(14 * MIN);
  assert.equal(env.call('login', '', { email: eng.email, password: eng.password }).error.code, 'locked');
  env.advance(2 * MIN);
  const ok = env.call('login', '', { email: eng.email, password: eng.password });
  assert.equal(ok.status, 'ok');
  const row = env.rows('users').find((u) => u.email === eng.email);
  assert.equal(row.failed_attempts, 0);
  assert.equal(row.locked_until, '');
});

test('a correct login resets the failed-attempt counter', () => {
  const { env, eng } = setup();
  for (let i = 0; i < 4; i++) env.call('login', '', { email: eng.email, password: 'nope-nope-1' });
  env.ok('login', '', { email: eng.email, password: eng.password });
  for (let i = 0; i < 4; i++) assert.equal(env.call('login', '', { email: eng.email, password: 'nope-nope-1' }).error.code, 'bad_credentials');
});

test('lockout settings are honoured', () => {
  const { env, admin, eng } = setup();
  env.ok('saveSettings', admin.token, { changes: { lockout_attempts: '2', lockout_minutes: '3' } });
  env.call('login', '', { email: eng.email, password: 'nope-nope-1' });
  const r = env.call('login', '', { email: eng.email, password: 'nope-nope-1' });
  assert.equal(r.error.code, 'locked');
  assert.match(r.error.message, /3 minutes/);
});

test('an existing token stops working while the user is locked', () => {
  const { env, eng } = setup();
  for (let i = 0; i < 5; i++) env.call('login', '', { email: eng.email, password: 'nope-nope-1' });
  assert.equal(env.call('getStartup', eng.token).error.code, 'locked');
});

test('temporary password: must_change limits actions to changePassword, getMyAccess and login', () => {
  const { env, admin } = setup();
  const created = env.ok('createUser', admin.token, { u: { email: 'new@example.com', display_name: 'New', role_id: 'ROLE-ENG' } });
  const s = env.ok('login', '', { email: 'new@example.com', password: created.temp_password, keepSignedIn: false });
  assert.equal(s.must_change, true);
  const blocked = env.call('getStartup', s.token);
  assert.equal(blocked.error.code, 'forbidden');
  assert.match(blocked.error.message, /change your temporary password/);
  assert.equal(env.call('getEvents', s.token, { year: 2026 }).error.code, 'forbidden');
  const me = env.ok('getMyAccess', s.token);
  assert.equal(me.must_change, true);

  // rules for the new password
  const cp = (current, next) => env.call('changePassword', s.token, { current, next });
  assert.equal(cp(created.temp_password, created.temp_password).error.code, 'bad_request'); // same as temp
  assert.match(cp(created.temp_password, 'short1').error.message, /at least 10/);
  assert.equal(cp('not-the-temp-password', 'Another-Pass-77').error.code, 'bad_credentials');
  const done = cp(created.temp_password, 'Another-Pass-77');
  assert.equal(done.status, 'ok');
  assert.equal(done.data.must_change, false);
  assert.equal(env.call('getStartup', done.data.token).status, 'ok');
  // old temp password no longer works, new one does
  assert.equal(env.call('login', '', { email: 'new@example.com', password: created.temp_password }).error.code, 'bad_credentials');
  assert.equal(env.call('login', '', { email: 'new@example.com', password: 'Another-Pass-77' }).status, 'ok');
});

test('minimum password length comes from settings', () => {
  const { env, admin, eng } = setup();
  env.ok('saveSettings', admin.token, { changes: { min_password_length: '14' } });
  const r = env.call('changePassword', eng.token, { current: eng.password, next: 'Twelve-chars1' });
  assert.equal(r.error.code, 'bad_request');
  assert.match(r.error.message, /14/);
});

test('wrong current password counts towards the lockout', () => {
  const { env, eng } = setup();
  for (let i = 0; i < 4; i++) env.call('changePassword', eng.token, { current: 'bad-bad-bad-1', next: 'Another-Pass-77' });
  assert.equal(env.call('changePassword', eng.token, { current: 'bad-bad-bad-1', next: 'Another-Pass-77' }).error.code, 'locked');
});

test('expired tokens are refused', () => {
  const { env, eng } = setup();
  assert.equal(env.call('getStartup', eng.token).status, 'ok');
  env.advance(11 * HOUR);
  assert.equal(env.call('getStartup', eng.token).status, 'ok');
  env.advance(2 * HOUR);
  const r = env.call('getStartup', eng.token);
  assert.equal(r.error.code, 'unauthenticated');
});

test('tampered, malformed and empty tokens are refused', () => {
  const { env, admin, eng } = setup();
  const [body, sig] = eng.token.split('.');
  const forge = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  const bad = [
    '', 'abc', 'a.b', 'a.b.c', body + '.' + '0'.repeat(64), body + '.' + sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0'),
    forge({ ...payload, uid: admin.user_id }) + '.' + sig,           // swap user, keep signature
    forge({ ...payload, exp: payload.exp + 10 * HOUR }) + '.' + sig, // extend expiry
    forge({ ...payload, role: 'ROLE-ADMIN' }) + '.' + sig,
    body + '.' + sig + 'x', null, 42, { a: 1 },
  ];
  for (const t of bad) {
    const r = env.call('getStartup', t);
    assert.equal(r.status, 'error', JSON.stringify(t));
    assert.equal(r.error.code, 'unauthenticated', JSON.stringify(t));
  }
});

test('a token signed with another secret is refused', () => {
  const { env, eng } = setup();
  env.setProp('SESSION_SIGNING_SECRET', 'a-completely-different-secret-value-123');
  assert.equal(env.call('getStartup', eng.token).error.code, 'unauthenticated');
});

test('a deactivated user is refused even with a valid token, and cannot sign in', () => {
  const { env, admin, eng } = setup();
  assert.equal(env.call('getStartup', eng.token).status, 'ok');
  env.ok('updateUser', admin.token, { userId: eng.user_id, changes: { active: false } });
  assert.equal(env.call('getStartup', eng.token).error.code, 'unauthenticated');
  assert.equal(env.call('login', '', { email: eng.email, password: eng.password }).error.code, 'bad_credentials');
  env.ok('updateUser', admin.token, { userId: eng.user_id, changes: { active: true } });
  assert.equal(env.call('getStartup', eng.token).status, 'ok');
});

test('a token for a user that no longer exists is refused', () => {
  const { env, eng } = setup();
  const sheet = env.sheet('users');
  sheet.deleteRow(3);
  assert.equal(env.call('getStartup', eng.token).error.code, 'unauthenticated');
});

test('login rehashes when stored rounds are lower than the current default', () => {
  const env = createEnv({ hashRounds: 10 });
  const admin = bootstrapAdmin(env);
  const before = env.rows('users')[0];
  assert.equal(before.hash_rounds, 10);
  env.setProp('HASH_ROUNDS', '30');
  env.ok('login', '', { email: admin.email, password: admin.password });
  const after = env.rows('users')[0];
  assert.equal(after.hash_rounds, 30);
  assert.notEqual(after.password_hash, before.password_hash);
  assert.notEqual(after.password_salt, before.password_salt);
  env.ok('login', '', { email: admin.email, password: admin.password });
  assert.equal(env.call('login', '', { email: admin.email, password: 'wrong-wrong-1' }).error.code, 'bad_credentials');
  // lowering the default later does not weaken stored hashes
  env.setProp('HASH_ROUNDS', '5');
  env.ok('login', '', { email: admin.email, password: admin.password });
  assert.equal(env.rows('users')[0].hash_rounds, 30);
});

test('hash depends on salt and pepper', () => {
  const env = createEnv();
  const { ctx } = env;
  const h = ctx.hashPassword_('pw-123456789', 'salt-a', 20);
  assert.equal(h, ctx.hashPassword_('pw-123456789', 'salt-a', 20));
  assert.notEqual(h, ctx.hashPassword_('pw-123456789', 'salt-b', 20));
  assert.notEqual(h, ctx.hashPassword_('pw-123456789', 'salt-a', 21));
  env.setProp('PASSWORD_PEPPER', 'another-pepper-value-0123456789-xyz');
  assert.notEqual(h, ctx.hashPassword_('pw-123456789', 'salt-a', 20));
});

test('constant-time compare and base64url helpers', () => {
  const { ctx } = createEnv({ prepare: false });
  assert.equal(ctx.constantTimeEquals_('abc', 'abc'), true);
  assert.equal(ctx.constantTimeEquals_('abc', 'abd'), false);
  assert.equal(ctx.constantTimeEquals_('abc', 'abcd'), false);
  assert.equal(ctx.constantTimeEquals_('', ''), true);
  const text = 'Hello, é中 {"a":1}';
  const enc = ctx.base64url_(text);
  assert.ok(!/[+/=]/.test(enc));
  assert.equal(ctx.base64urlDecode_(enc), text);
});

test('missing or short secrets stop the server with a clear message', () => {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  env.props.delete('SESSION_SIGNING_SECRET');
  const r = env.call('getStartup', admin.token);
  assert.equal(r.error.code, 'server');
  assert.match(r.error.message, /SESSION_SIGNING_SECRET/);
  env.setProp('SESSION_SIGNING_SECRET', 'short');
  assert.equal(env.call('getStartup', admin.token).error.code, 'server');
});

test('sign-ins and failures are written to the audit log, without secrets', () => {
  const { env, eng } = setup();
  env.call('login', '', { email: eng.email, password: 'wrong-wrong-1' });
  env.ok('login', '', { email: eng.email, password: eng.password });
  const log = env.rows('audit_log');
  assert.ok(log.some((a) => a.action === 'login_failed'));
  assert.ok(log.some((a) => a.action === 'login'));
  assert.ok(!JSON.stringify(log).includes(eng.password));
  assert.ok(!JSON.stringify(log).includes('wrong-wrong-1'));
});

test('a busy lock gives the busy error on writes, and the lock is always released', () => {
  const { env, admin } = setup();
  env.lockState.busy = true;
  const r = env.call('saveSettings', admin.token, { changes: { lockout_minutes: '10' } });
  assert.equal(r.error.code, 'busy');
  assert.equal(r.error.message, 'Server is busy - please try again.');
  env.lockState.busy = false;
  assert.equal(env.call('saveSettings', admin.token, { changes: { lockout_minutes: '10' } }).status, 'ok');
  assert.equal(env.lockState.held, 0);
  // 30 s for every write; the activity note (1.6.0) only tries briefly and skips when the lock is busy
  assert.ok(env.lockState.tryCalls.every((ms) => ms === 30000 || ms === env.run('ACTIVITY_LOCK_WAIT_MS_')));
});

test('changePassword returns a fresh session and keeps GOOD_PASSWORD style rules', () => {
  const { env, eng } = setup();
  const s = env.ok('changePassword', eng.token, { current: eng.password, next: GOOD_PASSWORD + 'x' });
  assert.equal(s.must_change, false);
  assert.equal(env.call('getStartup', s.token).status, 'ok');
  const log = env.rows('audit_log');
  assert.ok(log.some((a) => a.action === 'change_password'));
});

test('a password reset by an admin ends the user\'s open sessions', () => {
  const { env, admin, eng } = setup();
  const s = env.ok('login', '', { email: eng.email, password: eng.password, keepSignedIn: false });
  assert.ok(env.ok('getMyAccess', s.token));
  env.ok('resetPassword', admin.token, { userId: s.user.user_id });
  const r = env.call('getMyAccess', s.token);
  assert.equal(r.status, 'error');
  assert.equal(r.error.code, 'unauthenticated');
  assert.match(r.error.message, /sign in again/i);
});

test('changing your own password ends older sessions but the new token works', () => {
  const { env, eng } = setup();
  const a = env.ok('login', '', { email: eng.email, password: eng.password, keepSignedIn: false });
  const b = env.ok('login', '', { email: eng.email, password: eng.password, keepSignedIn: false });
  const fresh = env.ok('changePassword', a.token, { current: eng.password, next: 'Brand-New-Pass-77' });
  assert.ok(env.ok('getMyAccess', fresh.token));
  assert.equal(env.call('getMyAccess', a.token).error.code, 'unauthenticated');
  assert.equal(env.call('getMyAccess', b.token).error.code, 'unauthenticated');
});
