import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, makeUser, seedMaster } from './harness.mjs';

function setup() {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  return { env, admin };
}
const auditCount = (env) => env.rows('audit_log').length;

test('getStartup returns masters and settings, but never users or the audit log', () => {
  const { env, admin } = setup();
  const eng = makeUser(env, admin.token, 'ROLE-VIEW', 'v@example.com');
  const s = env.ok('getStartup', eng.token);
  assert.deepEqual(Object.keys(s).sort(), ['aliases', 'areas', 'classifications', 'equipment', 'equipment_areas', 'lines', 'reasons', 'settings', 'years']);
  assert.equal(s.areas.length, 19);
  assert.equal(s.lines.length, 2);
  assert.equal(s.classifications.length, 6);
  assert.equal(s.settings.length, 14);
  const text = JSON.stringify(s);
  assert.ok(!/password_hash|password_salt|hash_rounds|@example\.com|audit_log/i.test(text));
  assert.deepEqual(s.years, []);
  const area = s.areas.find((a) => a.area_id === 'AFR new');
  assert.equal(area.in_downtime_sheet, true);
  assert.equal(typeof area.sort_order, 'number');
});

test('saveEquipment: code stored upper-case, areas replaced, needs_review recomputed, audited', () => {
  const { env, admin } = setup();
  const before = auditCount(env);
  env.ok('saveEquipment', admin.token, { row: { equipment_id: ' 131.st200 ', status: 'Active' }, areaIds: ['K.1', 'RM.1', 'K.1'] });
  let eq = env.rows('equipment');
  assert.equal(eq.length, 1);
  assert.equal(eq[0].equipment_id, '131.ST200');
  assert.equal(eq[0].needs_review, true);
  assert.match(eq[0].review_note, /^Missing: description, criticality$/);
  assert.equal(eq[0].origin, 'User');
  assert.equal(eq[0].updated_by, admin.user_id);
  assert.ok(eq[0].created_at);
  assert.deepEqual(env.rows('equipment_areas').map((r) => r.area_id).sort(), ['K.1', 'RM.1']);
  const created = eq[0].created_at;

  env.ok('saveEquipment', admin.token, {
    row: { equipment_id: '131.ST200', description: 'Test fan', criticality: 'High', status: 'Active', parent_id: '131.p1' },
    areaIds: ['RM.1', 'CR'],
  });
  eq = env.rows('equipment');
  assert.equal(eq.length, 1, 'updated in place');
  assert.equal(eq[0].needs_review, false);
  assert.equal(eq[0].review_note, '');
  assert.equal(eq[0].parent_id, '131.P1');
  assert.equal(eq[0].created_at, created);
  assert.deepEqual(env.rows('equipment_areas').map((r) => r.area_id).sort(), ['CR', 'RM.1']);

  env.ok('saveEquipment', admin.token, { row: { equipment_id: '131.ST200', description: 'Test fan', criticality: 'High', status: 'Retired' }, areaIds: [] });
  assert.equal(env.rows('equipment')[0].needs_review, true);
  assert.equal(env.rows('equipment')[0].status, 'Retired');
  assert.equal(env.rows('equipment_areas').length, 0);
  assert.equal(auditCount(env) - before, 3);
  assert.ok(env.rows('audit_log').some((a) => a.action === 'add_equipment' && a.entity_id === '131.ST200'));
});

test('saveEquipment validation', () => {
  const { env, admin } = setup();
  const row = { equipment_id: 'X1', status: 'Active' };
  assert.equal(env.call('saveEquipment', admin.token, { row, areaIds: ['NOPE'] }).error.code, 'bad_request');
  assert.equal(env.call('saveEquipment', admin.token, { row: { ...row, equipment_id: '' }, areaIds: [] }).error.code, 'bad_request');
  assert.equal(env.call('saveEquipment', admin.token, { row: { ...row, status: 'Gone' }, areaIds: [] }).error.code, 'bad_request');
  assert.equal(env.call('saveEquipment', admin.token, { row: { ...row, parent_id: 'x1' }, areaIds: [] }).error.code, 'bad_request');
  assert.equal(env.call('saveEquipment', admin.token, { row, areaIds: 'K.1' }).error.code, 'bad_request');
  assert.equal(env.rows('equipment').length, 0);
});

test('saveArea: add, update, unknown line, audited', () => {
  const { env, admin } = setup();
  const before = auditCount(env);
  env.ok('saveArea', admin.token, { row: { area_id: 'XX.9', name: 'Test area', line_id: 'L.2', sort_order: 99, active: true, in_downtime_sheet: false, notes: 'n' } });
  env.ok('saveArea', admin.token, { row: { area_id: 'XX.9', name: 'Renamed', line_id: 'L.1', sort_order: 98, active: false, in_downtime_sheet: true } });
  const a = env.rows('areas').filter((r) => r.area_id === 'XX.9');
  assert.equal(a.length, 1);
  assert.deepEqual([a[0].name, a[0].line_id, a[0].sort_order, a[0].active, a[0].in_downtime_sheet, a[0].notes], ['Renamed', 'L.1', 98, false, true, '']);
  assert.equal(env.call('saveArea', admin.token, { row: { area_id: 'YY', name: 'x', line_id: 'L.9' } }).error.code, 'bad_request');
  assert.equal(auditCount(env) - before, 2);
  assert.equal(env.rows('areas').length, 20);
});

test('saveReason: match_key computed by the server, ids and order generated', () => {
  const { env, admin } = setup();
  const before = auditCount(env);
  env.ok('saveReason', admin.token, { row: { reason_id: '', classification: 'mec', text_as_listed: '  Bearing   Failure ', match_key: 'evil', order_no: 0, active: true } });
  env.ok('saveReason', admin.token, { row: { reason_id: '', classification: 'MEC', text_as_listed: 'Belt tear', order_no: 0, active: true } });
  let r = env.rows('reasons');
  assert.deepEqual(r.map((x) => x.reason_id), ['R-MEC-001', 'R-MEC-002']);
  assert.equal(r[0].match_key, 'bearing failure');
  assert.equal(r[0].text_as_listed, '  Bearing   Failure ', 'kept exactly as listed');
  assert.deepEqual(r.map((x) => x.order_no), [1, 2]);
  env.ok('saveReason', admin.token, { row: { reason_id: 'R-MEC-002', classification: 'MEC', text_as_listed: 'Belt TEAR', order_no: 2, active: false } });
  r = env.rows('reasons');
  assert.equal(r.length, 2);
  assert.equal(r[1].match_key, 'belt tear');
  assert.equal(r[1].active, false);
  assert.equal(env.call('saveReason', admin.token, { row: { classification: 'ZZZ', text_as_listed: 'x' } }).error.code, 'bad_request');
  assert.equal(env.call('saveReason', admin.token, { row: { classification: 'MEC', text_as_listed: '   ' } }).error.code, 'bad_request');
  assert.equal(auditCount(env) - before, 3);
});

test('saveAlias / deleteAlias: stored in code_key form, target must exist, audited', () => {
  const { env, admin } = setup();
  seedMaster(env, admin.token);
  const before = auditCount(env);
  env.ok('saveAlias', admin.token, { row: { alias: ' 100 . . ab2 ', equipment_id: '100.ab02', reason: 'typo' } });
  const al = env.rows('equipment_aliases');
  assert.deepEqual(al.map((a) => [a.alias, a.equipment_id]), [['100.AA1', '100.AA01'], ['100.AB2', '100.AB02']]);
  env.ok('saveAlias', admin.token, { row: { alias: '100.AB2', equipment_id: '100.AA01' } });
  assert.equal(env.rows('equipment_aliases').length, 2);
  assert.equal(env.rows('equipment_aliases')[1].equipment_id, '100.AA01');
  assert.equal(env.call('saveAlias', admin.token, { row: { alias: 'Q1', equipment_id: 'NOPE' } }).error.code, 'bad_request');
  assert.equal(env.call('saveAlias', admin.token, { row: { alias: '100.aa01', equipment_id: '100.AA01' } }).error.code, 'bad_request');
  env.ok('deleteAlias', admin.token, { alias: '100.ab2' });
  assert.equal(env.rows('equipment_aliases').length, 1);
  assert.equal(env.call('deleteAlias', admin.token, { alias: 'NOPE' }).error.code, 'not_found');
  assert.equal(auditCount(env) - before, 3);
  assert.ok(env.rows('audit_log').some((a) => a.action === 'delete_alias' && a.entity_id === '100.AB2'));
});

test('every master save needs master Edit', () => {
  const { env, admin } = setup();
  const mgr = makeUser(env, admin.token, 'ROLE-MGR', 'm@example.com');
  for (const [a, p] of [['saveEquipment', { row: { equipment_id: 'X' }, areaIds: [] }], ['saveArea', { row: {} }], ['saveReason', { row: {} }], ['saveAlias', { row: {} }], ['deleteAlias', { alias: 'x' }]]) {
    assert.equal(env.call(a, mgr.token, p).error.code, 'forbidden', a);
  }
});

test('settings: validation of keys and values, audit, visible in getStartup', () => {
  const { env, admin } = setup();
  const before = auditCount(env);
  env.ok('saveSettings', admin.token, { changes: { availability_basis: 'C', repeat_window_days: '45', availability_target_pct: '92.5', default_comparison: 'same_period_last_year' } });
  const s = Object.fromEntries(env.ok('getStartup', admin.token).settings.map((x) => [x.key, x]));
  assert.equal(s.availability_basis.value, 'C');
  assert.equal(s.repeat_window_days.value, '45');
  assert.equal(s.availability_target_pct.value, '92.5');
  assert.equal(s.availability_basis.updated_by, admin.user_id);
  assert.equal(auditCount(env) - before, 4);
  env.ok('saveSettings', admin.token, { changes: { availability_target_pct: '' } });
  assert.equal(env.rows('settings').find((x) => x.key === 'availability_target_pct').value, '');
  const bad = [{ nope: '1' }, { availability_basis: 'Z' }, { repeat_window_days: 'abc' }, { repeat_window_days: '0' }, { repeat_window_days: '1.5' },
    { lockout_attempts: '' }, { availability_target_pct: '150' }, { min_password_length: '3' }, { default_comparison: 'x' }, {}];
  for (const changes of bad) assert.equal(env.call('saveSettings', admin.token, { changes }).error.code, 'bad_request', JSON.stringify(changes));
  assert.equal(env.rows('settings').find((x) => x.key === 'availability_basis').value, 'C', 'a rejected save changes nothing');
  // one bad key rejects the whole request
  assert.equal(env.call('saveSettings', admin.token, { changes: { repeat_window_days: '10', nope: '1' } }).status, 'error');
  assert.equal(env.rows('settings').find((x) => x.key === 'repeat_window_days').value, '45');
});

test('audit log is append-only: rows are never rewritten by later actions', () => {
  const { env, admin } = setup();
  seedMaster(env, admin.token);
  const first = env.rows('audit_log');
  env.ok('saveSettings', admin.token, { changes: { repeat_window_days: '31' } });
  const second = env.rows('audit_log');
  assert.deepEqual(second.slice(0, first.length), first);
  assert.ok(second.length > first.length);
  assert.ok(second.every((a) => a.at && a.action));
});
