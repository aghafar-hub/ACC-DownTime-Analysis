import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, seedMaster, uploadAll, uploadRow } from './harness.mjs';

// 1.10.0: a single-record change finds its row through the event_id column and never reads the whole events sheet;
// "keep as entered" for many records is one call with one batched write.

function setup(n = 40) {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  uploadAll(env, admin.token, Array.from({ length: n }, (_, i) => uploadRow({ code_raw: i % 2 ? 'ZZ.99' : '100.AA01' })));
  return { env, admin, events: env.rows('events'), sheet: env.sheet('events') };
}

const wide = (sheet) => sheet.stats.wideReads || 0;

test('editEvent, voidEvent and acceptEventFlags read no more than the id column and their own row', () => {
  const { env, admin, events, sheet } = setup();
  const flagged = events.find((e) => e.flags.includes('unknown_code'));
  const plain = events.find((e) => e.flags === '');
  for (const [action, params] of [
    ['editEvent', { eventId: plain.event_id, changes: { description: 'faster' }, note: 'speed test' }],
    ['voidEvent', { eventId: plain.event_id, isVoid: true, note: 'speed test' }],
    ['acceptEventFlags', { eventId: flagged.event_id, flags: ['unknown_code'], note: 'speed test' }],
  ]) {
    const before = wide(sheet);
    env.ok(action, admin.token, params);
    assert.equal(wide(sheet) - before, 0, `${action} read the whole events sheet`);
  }
  // a wrong id is still 'not found'
  assert.equal(env.call('voidEvent', admin.token, { eventId: 'EV-NOPE', isVoid: true, note: 'speed test' }).error.code, 'not_found');
});

test('acceptEventFlagsBulk: many records, one note, one call; the rest saved when one fails', () => {
  const { env, admin, events, sheet } = setup(60);
  const flagged = events.filter((e) => e.flags.includes('unknown_code'));
  assert.ok(flagged.length >= 20);
  const items = flagged.map((e) => ({ eventId: e.event_id, flags: ['unknown_code'] }));
  items.push({ eventId: 'EV-NOPE', flags: ['unknown_code'] });
  items.push({ eventId: events.find((e) => e.flags === '').event_id, flags: ['unknown_code'] });
  const writesBefore = sheet.stats.setValues;
  const wideBefore = wide(sheet);
  const res = env.ok('acceptEventFlagsBulk', admin.token, { items, note: 'checked in bulk' });
  assert.equal(res.saved.length, flagged.length);
  assert.deepEqual(res.failed.map((f) => f.message), ['Event not found.', 'This record does not have the problem "unknown_code".']);
  assert.ok(res.saved.every((r) => r.accepted_flags === 'unknown_code' && r.accepted_by === admin.user_id));
  // the flagged rows are every other row: few runs, so few writes, and the whole sheet is never read
  assert.ok(sheet.stats.setValues - writesBefore <= 25, `writes: ${sheet.stats.setValues - writesBefore}`);
  assert.equal(wide(sheet) - wideBefore, 0);
  const stored = env.rows('events').filter((e) => e.accepted_flags === 'unknown_code');
  assert.equal(stored.length, flagged.length);
  const history = env.rows('event_edits').filter((h) => h.note === 'checked in bulk');
  assert.equal(history.length, flagged.length);
  assert.equal(env.rows('audit_log').filter((a) => a.action === 'accept_event_flags').length, flagged.length);
  // undo for all in one call
  const undo = env.ok('acceptEventFlagsBulk', admin.token, { items: flagged.map((e) => ({ eventId: e.event_id, flags: [] })), note: 'undo bulk' });
  assert.equal(undo.saved.length, flagged.length);
  assert.ok(undo.saved.every((r) => r.accepted_flags === '' && r.accepted_by === ''));
  // limits and rights
  const tooMany = Array.from({ length: 201 }, (_, i) => ({ eventId: `EV-${i}`, flags: [] }));
  assert.match(env.call('acceptEventFlagsBulk', admin.token, { items: tooMany, note: 'x x x' }).error.message, /At most 200/);
  assert.match(env.call('acceptEventFlagsBulk', admin.token, { items: [], note: 'x x x' }).error.message, /at least one/);
  assert.match(env.call('acceptEventFlagsBulk', admin.token, { items: [{ eventId: 'a', flags: ['nope'] }], note: 'x x x' }).error.message, /Unknown flag/);
});
