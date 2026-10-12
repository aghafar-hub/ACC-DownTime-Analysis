import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, makeUser, seedMaster, startBatch, uploadRow } from './harness.mjs';

const snapshot = (env) => Object.fromEntries([...env.ss.sheets].map(([n, s]) => [n, JSON.stringify(s.data)]));

test('ensureSchema creates every sheet with the exact schema headers and Plain Text formats', () => {
  const env = createEnv({ prepare: false });
  env.setProp('SESSION_SIGNING_SECRET', 'x'.repeat(30));
  env.ctx.ensureSchema();
  const schema = env.json(env.run('SCHEMA'));
  assert.equal(env.ss.sheets.size, schema.tableOrder.length);
  for (const name of schema.tableOrder) {
    const sheet = env.sheet(name);
    assert.deepEqual(sheet.data[0], schema.tables[name].columns.map((c) => c.name), name);
    schema.tables[name].columns.forEach((c, i) => {
      const textual = ['text', 'date', 'timestamp', 'enum'].includes(c.type);
      assert.equal(sheet.formats.get(`500,${i + 1}`) === '@', textual, `${name}.${c.name} (${c.type})`);
    });
  }
});

test('ensureSchema is idempotent and never changes data', () => {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  env.ok('uploadChunk', admin.token, { batchId: startBatch(env, admin.token), rows: [uploadRow()] });
  const before = snapshot(env);
  env.ctx.ensureSchema();
  env.ctx.ensureSchema();
  assert.deepEqual(snapshot(env), before);
});

test('ensureSchema adds missing columns at the END only, keeps data and extra columns', () => {
  const env = createEnv({ prepare: false });
  env.setProp('SESSION_SIGNING_SECRET', 'x'.repeat(30));
  const users = env.ss.insertSheet('users');
  users.getRange(1, 1, 1, 4).setValues([['email', 'my_custom_note', 'user_id', 'display_name']]);
  users.getRange(2, 1, 1, 4).setValues([['a@example.com', 'keep me', 'U-1', 'Alice']]);
  env.ctx.ensureSchema();
  const header = users.data[0];
  assert.deepEqual(header.slice(0, 4), ['email', 'my_custom_note', 'user_id', 'display_name']);
  const expected = env.json(env.run('SCHEMA')).tables.users.columns.map((c) => c.name).filter((n) => !header.slice(0, 4).includes(n));
  assert.deepEqual(header.slice(4), expected);
  assert.deepEqual(users.data[1].slice(0, 4), ['a@example.com', 'keep me', 'U-1', 'Alice']);
  // reading by header name still works with the foreign order
  const row = env.rows('users')[0];
  assert.equal(row.user_id, 'U-1');
  assert.equal(row.display_name, 'Alice');
  assert.equal(row.active, false);
  assert.equal(row.hash_rounds, null);
  // new rows are written by header name too
  env.ctx.appendRow_('users', { user_id: 'U-2', email: 'b@example.com', display_name: 'Bob', active: true });
  assert.deepEqual(users.data[2].slice(0, 4), ['b@example.com', '', 'U-2', 'Bob']);
  // a sheet that has grown beyond the default grid width
  env.sheet('events').maxCols = 5;
  env.ss.sheets.delete('events');
  env.ctx.ensureSchema();
  assert.ok(env.sheet('events').data[0].length > 5);
});

test('seedDefaults is idempotent, adds everything, and never overwrites edits', () => {
  const env = createEnv({ prepare: false });
  env.setProp('SESSION_SIGNING_SECRET', 'x'.repeat(30));
  env.ctx.ensureSchema();
  const first = env.json(env.ctx.seedDefaults());
  assert.deepEqual(first, { lines: 2, areas: 19, classifications: 6, roles: 4, settings: 14, tab_access: 36 });
  const second = env.json(env.ctx.seedDefaults());
  assert.ok(Object.values(second).every((n) => n === 0));
  assert.equal(env.rows('areas').length, 19);
  assert.equal(env.rows('areas').find((a) => a.area_id === 'FM.1').notes, 'Name to be confirmed');
  assert.equal(env.rows('lines').find((l) => l.line_id === 'L.1').active, true);
  assert.equal(env.rows('classifications').find((c) => c.code === 'PL').is_incident, false);
  env.ctx.updateRow_('settings', env.ctx.findBy_('settings', 'key', 'repeat_window_days')._row, { value: '99' });
  env.ctx.seedDefaults();
  assert.equal(env.rows('settings').find((s) => s.key === 'repeat_window_days').value, '99');
});

test('a cell that lost its Plain Text format is still read as text', () => {
  const env = createEnv();
  const sheet = env.sheet('events');
  sheet.formats.clear(); // as if somebody cleared formatting
  sheet.putCell(2, sheet.data[0].indexOf('event_date') + 1, '2026-03-05');
  sheet.putCell(2, sheet.data[0].indexOf('event_id') + 1, 'EV-x');
  assert.ok(Object.prototype.toString.call(sheet.data[1][sheet.data[0].indexOf('event_date')]) === '[object Date]');
  assert.equal(env.rows('events')[0].event_date, '2026-03-05');
});

test('createFirstAdmin then installCheck: everything ready', () => {
  const env = createEnv();
  assert.match(env.ctx.installCheck(), /0 active Admin|active Admin/);
  assert.match(env.ctx.installCheck(), /PROBLEM: 0 active Admin/);
  bootstrapAdmin(env);
  const text = env.ctx.installCheck();
  assert.match(text, /Everything looks ready/);
  assert.ok(!text.includes('test-pepper'));
  assert.ok(!text.includes('test-signing'));
  assert.ok(env.logs.some((l) => l.includes('Everything looks ready')));
});

test('installCheck explains problems in plain English', () => {
  const env = createEnv({ prepare: false });
  const text = env.ctx.installCheck();
  assert.match(text, /PROBLEM: SESSION_SIGNING_SECRET is missing/);
  assert.match(text, /PROBLEM: PASSWORD_PEPPER is missing/);
  assert.match(text, /Sheet "events" is missing\. Run ensureSchema/);
  assert.match(text, /thing\(s\) need attention/);
  env.setProp('PASSWORD_PEPPER', 'short');
  assert.match(env.ctx.installCheck(), /PASSWORD_PEPPER is set but too short/);
});

test('benchmarkHashRounds suggests a sensible number', () => {
  const env = createEnv();
  const rounds = env.ctx.benchmarkHashRounds();
  assert.ok(Number.isInteger(rounds) && rounds >= 200 && rounds <= 50000);
  assert.ok(env.logs.some((l) => l.includes('Suggested HASH_ROUNDS = ' + rounds)));
});

test('doGet ping and doPost envelopes', () => {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  const ping = JSON.parse(env.ctx.doGet({ parameter: { action: 'ping' } }).getContent());
  assert.deepEqual(ping, { status: 'ok', data: { version: '1.1.0' } });
  assert.equal(JSON.parse(env.ctx.doGet({ parameter: {} }).getContent()).error.code, 'bad_request');
  assert.equal(JSON.parse(env.ctx.doGet(undefined).getContent()).status, 'error');

  const post = (body) => JSON.parse(env.ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body), type: 'text/plain' } }).getContent());
  const me = post({ action: 'getMyAccess', token: admin.token, params: {} });
  assert.equal(me.status, 'ok');
  assert.equal(me.data.user.email, 'admin@example.com');
  assert.equal(post('not json').error.code, 'bad_request');
  assert.equal(post('null').error.code, 'bad_request');
  assert.equal(post('[]').error.code, 'bad_request');
  assert.equal(post({ action: 5 }).error.code, 'bad_request');
  assert.equal(post({ action: 'getMyAccess' }).error.code, 'unauthenticated');
  assert.equal(post({ action: 'getMyAccess', token: admin.token, params: 'x' }).error.code, 'bad_request');
  assert.equal(env.ctx.doPost({}).getContent().includes('bad_request'), true);
  // save actions answer with data: null (not a missing key)
  const saved = post({ action: 'saveSettings', token: admin.token, params: { changes: { lockout_minutes: '20' } } });
  assert.deepEqual(saved, { status: 'ok', data: null });
});

test('unexpected failures give a short message, never a stack trace', () => {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  env.ss.sheets.delete('reasons');
  const r = env.call('getStartup', admin.token);
  assert.equal(r.status, 'error');
  assert.equal(r.error.code, 'server');
  assert.ok(!/\bat \w|\.js:\d|stack/i.test(r.error.message));
  // a genuine bug inside a handler is hidden from the caller but logged server-side
  env.run('HANDLERS.getUploadHistory = function () { return null.boom; };');
  const r2 = env.call('getUploadHistory', admin.token);
  assert.deepEqual(r2.error, { message: 'Something went wrong on the server. Please try again.', code: 'server', accessDenied: false });
  assert.ok(env.errors.some((e) => e.includes('TypeError')));
});

test('every write action takes the script lock (30 s wait) and releases it; reads do not need it', () => {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  const e = makeUser(env, admin.token, 'ROLE-ENG', 'e@example.com');
  const b = startBatch(env, admin.token);
  env.ok('uploadChunk', admin.token, { batchId: b, rows: [uploadRow()] });
  const ev = env.rows('events')[0];
  const writes = {
    saveEquipment: { row: { equipment_id: 'Q1' }, areaIds: [] }, saveArea: { row: { area_id: 'Q', name: 'Q', line_id: 'L.1' } },
    saveReason: { row: { classification: 'MEC', text_as_listed: 'Q reason' } }, saveAlias: { row: { alias: 'QQ', equipment_id: 'Q1' } },
    deleteAlias: { alias: 'QQ' }, saveSettings: { changes: { lockout_minutes: '9' } },
    createUser: { u: { email: 'z@example.com', display_name: 'Z', role_id: 'ROLE-VIEW' } },
    updateUser: { userId: e.user_id, changes: { display_name: 'E2' } }, resetPassword: { userId: e.user_id },
    setUserTabAccess: { userId: e.user_id, overrides: { upload: 'View' } },
    editEvent: { eventId: ev.event_id, changes: { description: 'zz' }, note: 'n' }, voidEvent: { eventId: ev.event_id, isVoid: true, note: 'n' },
    uploadStart: { fileName: 'f', fileHash: 'h' }, uploadChunk: { batchId: b, rows: [] },
    uploadFinish: { batchId: b, summary: { rows_read: 1, rows_skipped: 0 }, warnings: [] },
  };
  for (const [action, params] of Object.entries(writes)) {
    env.lockState.tryCalls.length = 0;
    const audit = env.rows('audit_log').length;
    env.ok(action, admin.token, params);
    assert.ok(env.lockState.tryCalls.length >= 1, `${action} did not take the lock`);
    assert.ok(env.lockState.tryCalls.every((ms) => ms === 30000), action);
    assert.equal(env.lockState.held, 0, `${action} left the lock held`);
    assert.ok(env.rows('audit_log').length > audit, `${action} wrote no audit row`);
    // and with the lock busy nothing changes
    env.lockState.busy = true;
    const r = env.call(action, admin.token, params);
    env.lockState.busy = false;
    if (r.status === 'error') assert.equal(r.error.code, 'busy', action);
  }
  env.lockState.tryCalls.length = 0;
  for (const a of ['getStartup', 'getEvents', 'listUsers', 'getUploadHistory']) env.ok(a, admin.token, { year: 2026 });
  assert.equal(env.lockState.tryCalls.length, 0);
});

test('generateSecrets: creates both secrets and the hash cost, never prints or overwrites them', async () => {
  const { createEnv, bootstrapAdmin } = await import('./harness.mjs');
  const env = createEnv({ prepare: false });
  env.ctx.ensureSchema();
  env.ctx.seedDefaults();
  env.logs.length = 0;
  env.ctx.generateSecrets();
  const secret = env.props.get('SESSION_SIGNING_SECRET');
  const pepper = env.props.get('PASSWORD_PEPPER');
  assert.match(secret, /^[0-9a-f]{96}$/);
  assert.match(pepper, /^[0-9a-f]{96}$/);
  assert.notEqual(secret, pepper);
  const rounds = Number(env.props.get('HASH_ROUNDS'));
  assert.ok(rounds >= 200 && rounds <= env.run('HASH_ROUNDS_MAX'));
  const log = env.logs.join('\n');
  assert.ok(!log.includes(secret) && !log.includes(pepper), 'secret values must never be logged');
  assert.match(log, /SESSION_SIGNING_SECRET created/);

  // a second run changes nothing
  env.logs.length = 0;
  env.ctx.generateSecrets();
  assert.equal(env.props.get('SESSION_SIGNING_SECRET'), secret);
  assert.equal(env.props.get('PASSWORD_PEPPER'), pepper);
  assert.equal(Number(env.props.get('HASH_ROUNDS')), rounds);
  assert.match(env.logs.join('\n'), /left unchanged/);

  // and the generated secrets really work: first admin, sign in
  const admin = bootstrapAdmin(env);
  assert.ok(env.ok('getMyAccess', admin.token));
  assert.match(env.ctx.installCheck(), /Everything looks ready/);
});
