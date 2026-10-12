import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, makeUser, seedMaster, startBatch, uploadRow } from './harness.mjs';

function setup(rowOver = {}) {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  const b = startBatch(env, admin.token);
  env.ok('uploadChunk', admin.token, { batchId: b, rows: [uploadRow(rowOver)] });
  const ev = env.rows('events')[0];
  return { env, admin, ev };
}
const edit = (env, admin, ev, changes, note = 'because') => env.call('editEvent', admin.token, { eventId: ev.event_id, changes, note });
const edits = (env) => env.rows('event_edits');

test('editing classification recomputes criticality and is_failure, logs each changed field', () => {
  const { env, admin, ev } = setup({ classification: 'MEC', criticality: 'INC', is_failure: true, freq: 1 });
  const r = edit(env, admin, ev, { classification: 'pl' }, 'Was planned work');
  assert.equal(r.status, 'ok');
  const e = r.data;
  assert.equal(e.classification, 'PL');
  assert.equal(e.criticality, 'NO_INC');
  assert.equal(e.is_failure, false);
  assert.equal(e.edited, true);
  assert.equal(e.event_id, ev.event_id);
  assert.equal(e.fingerprint, ev.fingerprint);
  assert.equal(e.flags, 'unlisted_reason', 'reason re-resolved within the new classification');
  const rows = edits(env);
  assert.deepEqual(rows.map((x) => [x.field, x.old_value, x.new_value]), [
    ['classification', 'MEC', 'PL'], ['criticality', 'INC', 'NO_INC'], ['is_failure', 'TRUE', 'FALSE'],
  ]);
  assert.ok(rows.every((x) => x.event_id === ev.event_id && x.edited_by === admin.user_id && x.note === 'Was planned work'));
  assert.equal(new Set(rows.map((x) => x.edit_id)).size, 3);
  assert.ok(rows.every((x) => /^ED-\d{17}-\d+$/.test(x.edit_id)));
  const a = env.rows('audit_log').filter((x) => x.action === 'edit_event');
  assert.equal(a.length, 1);
  assert.match(a[0].detail, /classification/);
  assert.match(a[0].detail, /Was planned work/);
  // and back again
  const back = edit(env, admin, ev, { classification: 'MEC' }).data;
  assert.equal(back.criticality, 'INC');
  assert.equal(back.is_failure, true);
});

test('explicit criticality / is_failure win over the automatic rules', () => {
  const { env, admin, ev } = setup();
  let e = edit(env, admin, ev, { classification: 'ELE', criticality: 'NO_INC' }).data;
  assert.equal(e.criticality, 'NO_INC');
  assert.equal(e.is_failure, false, 'criticality changed, is_failure not given: recomputed');
  e = edit(env, admin, ev, { criticality: 'INC', is_failure: false }).data;
  assert.equal(e.criticality, 'INC');
  assert.equal(e.is_failure, false, 'given explicitly');
  e = edit(env, admin, ev, { freq: 0 }).data;
  assert.equal(e.freq, 0);
  assert.equal(e.is_failure, false);
  e = edit(env, admin, ev, { freq: 1 }).data;
  assert.equal(e.is_failure, true, 'INC and freq 1');
});

test('a classification change inside the incident group leaves failure alone', () => {
  const { env, admin, ev } = setup();
  const e = edit(env, admin, ev, { classification: 'ELE', reason_raw: 'Motor trip' }).data;
  assert.equal(e.criticality, 'INC');
  assert.equal(e.is_failure, true);
  assert.equal(e.reason_id, 'R-ELE-001');
  assert.equal(e.flags, '');
  assert.deepEqual(edits(env).map((x) => x.field), ['classification', 'reason_raw']);
});

test('editing times recomputes duration and flags; area change follows its line', () => {
  const { env, admin, ev } = setup({ stop_ts: '2026-03-05 10:00:00.000', start_ts: '2026-03-05 10:10:00.000' });
  let e = edit(env, admin, ev, { start_ts: '2026-03-05 09:00:00' }).data;
  assert.equal(e.duration_s, -3600);
  assert.equal(e.flags, 'end_before_start');
  assert.equal(e.start_ts, '2026-03-05 09:00:00.000');
  e = edit(env, admin, ev, { start_ts: '2026-03-05 10:30:00.000' }).data;
  assert.equal(e.duration_s, 1800);
  assert.equal(e.flags, '');
  e = edit(env, admin, ev, { area_id: 'RM.2' }).data;
  assert.equal(e.area_id, 'RM.2');
  assert.equal(e.line_id, 'L.2');
  assert.ok(edits(env).some((x) => x.field === 'line_id' && x.old_value === 'L.1' && x.new_value === 'L.2'));
  e = edit(env, admin, ev, { code_raw: 'zzz' }).data;
  assert.equal(e.equipment_id, '');
  assert.match(e.flags, /unknown_code/);
  e = edit(env, admin, ev, { code_raw: '100.aa1' }).data;
  assert.equal(e.equipment_id, '100.AA01');
  assert.equal(e.is_area_level, false);
  e = edit(env, admin, ev, { code_raw: 'N/A' }).data;
  assert.equal(e.is_area_level, true);
  assert.equal(e.fingerprint, ev.fingerprint, 'fingerprint never changes');
});

test('edit rules: note required, only editable fields, valid values, something must change', () => {
  const { env, admin, ev } = setup();
  const code = (changes, note = 'n') => edit(env, admin, ev, changes, note).error?.code;
  assert.equal(code({ description: 'x' }, ''), 'bad_request');
  assert.equal(code({ description: 'x' }, '   '), 'bad_request');
  assert.equal(env.call('editEvent', admin.token, { eventId: ev.event_id, changes: { description: 'x' } }).error.code, 'bad_request');
  for (const field of ['event_id', 'fingerprint', 'duration_s', 'batch_id', 'edited', 'is_void', 'flags', 'equipment_id', 'created_at', 'reason_id']) {
    assert.equal(code({ [field]: 'x' }), 'bad_request', field);
  }
  assert.equal(code({}), 'bad_request');
  assert.equal(code({ classification: 'XYZ' }), 'bad_request');
  assert.equal(code({ area_id: 'NOPE' }), 'bad_request');
  assert.equal(code({ stop_ts: 'garbage' }), 'bad_request');
  assert.equal(code({ freq: 5 }), 'bad_request');
  assert.equal(code({ description: ev.description }), 'bad_request', 'no real change');
  assert.equal(env.call('editEvent', admin.token, { eventId: 'EV-none', changes: { description: 'x' }, note: 'n' }).error.code, 'not_found');
  assert.equal(edits(env).length, 0);
  assert.equal(env.rows('events')[0].edited, false);
  // a plain description edit
  const e = edit(env, admin, ev, { description: 'new text' }, 'typo').data;
  assert.equal(e.description, 'new text');
  assert.equal(e.is_failure, true);
  assert.deepEqual(edits(env).map((x) => [x.field, x.old_value, x.new_value]), [['description', 'synthetic', 'new text']]);
});

test('voidEvent: flag set, edit row, audit row, event stays; restoring works; voided events are not editable', () => {
  const { env, admin, ev } = setup();
  assert.equal(env.call('voidEvent', admin.token, { eventId: ev.event_id, isVoid: true, note: '' }).error.code, 'bad_request');
  assert.equal(env.call('voidEvent', admin.token, { eventId: ev.event_id, isVoid: 'yes', note: 'x' }).error.code, 'bad_request');
  const v = env.ok('voidEvent', admin.token, { eventId: ev.event_id, isVoid: true, note: 'Duplicate of row 5' });
  assert.equal(v.is_void, true);
  assert.equal(v.fingerprint, ev.fingerprint);
  assert.deepEqual(edits(env).map((x) => [x.field, x.old_value, x.new_value, x.note]), [['is_void', 'FALSE', 'TRUE', 'Duplicate of row 5']]);
  assert.ok(env.rows('audit_log').some((a) => a.action === 'void_event' && a.entity_id === ev.event_id));
  const got = env.ok('getEvents', admin.token, { year: 2026 });
  assert.equal(got.length, 1, 'voided events stay in the table and are returned');
  assert.equal(got[0].is_void, true);
  assert.equal(edit(env, admin, ev, { description: 'x' }).error.code, 'conflict');
  // voiding again changes nothing
  env.ok('voidEvent', admin.token, { eventId: ev.event_id, isVoid: true, note: 'again' });
  assert.equal(edits(env).length, 1);
  const r = env.ok('voidEvent', admin.token, { eventId: ev.event_id, isVoid: false, note: 'restore' });
  assert.equal(r.is_void, false);
  assert.equal(edits(env).length, 2);
  assert.equal(env.call('voidEvent', admin.token, { eventId: 'EV-none', isVoid: true, note: 'x' }).error.code, 'not_found');
});

test('getEventEdits returns the history of one event in time order', () => {
  const { env, admin, ev } = setup();
  edit(env, admin, ev, { description: 'one' }, 'first');
  env.advance(5000);
  edit(env, admin, ev, { description: 'two' }, 'second');
  const h = env.ok('getEventEdits', admin.token, { eventId: ev.event_id });
  assert.deepEqual(h.map((x) => [x.old_value, x.new_value, x.note]), [['synthetic', 'one', 'first'], ['one', 'two', 'second']]);
  assert.deepEqual(env.ok('getEventEdits', admin.token, { eventId: 'EV-other' }), []);
});

test('edit and void need Events Edit; reading edits needs Events View', () => {
  const { env, admin, ev } = setup();
  const mgr = makeUser(env, admin.token, 'ROLE-MGR', 'm@example.com');
  const eng = makeUser(env, admin.token, 'ROLE-ENG', 'e@example.com');
  assert.equal(env.call('editEvent', mgr.token, { eventId: ev.event_id, changes: { description: 'x' }, note: 'n' }).error.code, 'forbidden');
  assert.equal(env.call('voidEvent', mgr.token, { eventId: ev.event_id, isVoid: true, note: 'n' }).error.code, 'forbidden');
  assert.equal(env.call('getEventEdits', mgr.token, { eventId: ev.event_id }).status, 'ok');
  assert.equal(env.call('editEvent', eng.token, { eventId: ev.event_id, changes: { description: 'x' }, note: 'n' }).status, 'ok');
  assert.equal(env.rows('event_edits')[0].edited_by, eng.user_id);
});
