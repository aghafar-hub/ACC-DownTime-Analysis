import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, seedMaster, uploadAll, uploadRow } from './harness.mjs';

// 1.10.0: text starting with = + - @ is written with a leading apostrophe (Utils.js toSheet_), so it can never run as a
// formula; reading it back gives the text unchanged (Sheets hides the apostrophe, and so does the harness).

test('formula-like text is written as text and reads back unchanged', () => {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  uploadAll(env, admin.token, [uploadRow({ description: '=HYPERLINK("http://x","y")' })]);
  const ev = env.rows('events')[0];
  assert.equal(ev.description, '=HYPERLINK("http://x","y")');
  const sheet = env.sheet('events');
  const before = sheet.stats.apostrophes || 0;
  for (const text of ['+20 bar', '-5 mm', '@team check', '  =1+1']) {
    const saved = env.ok('editEvent', admin.token, { eventId: ev.event_id, changes: { description: text }, note: 'formula test' });
    assert.equal(saved.description, text.trim() === text ? text : text.trim());
  }
  assert.ok((sheet.stats.apostrophes || 0) - before >= 4, 'each formula-like value went to the sheet with an apostrophe');
  // the history keeps the exact text too
  const edits = env.ok('getEventEdits', admin.token, { eventId: ev.event_id });
  assert.ok(edits.some((e) => e.new_value === '@team check'));
});

test('ordinary text, numbers, dates and booleans are written as before', () => {
  const env = createEnv();
  assert.equal(env.ctx.toSheet_('Bearing failure', 'text'), 'Bearing failure');
  assert.equal(env.ctx.toSheet_('2026-03-05 10:00:00.000', 'timestamp'), '2026-03-05 10:00:00.000');
  assert.equal(env.ctx.toSheet_(-5, 'float'), -5);
  assert.equal(env.ctx.toSheet_(true, 'bool'), true);
  assert.equal(env.ctx.toSheet_('=SUM(A1)', 'text'), "'=SUM(A1)");
  assert.equal(env.ctx.toSheet_('-x', 'text'), "'-x");
});

test('a row rewritten with its other values keeps formula-like text protected', () => {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  uploadAll(env, admin.token, [uploadRow({ description: '=1+1' })]);
  const ev = env.rows('events')[0];
  const sheet = env.sheet('events');
  const before = sheet.stats.apostrophes || 0;
  env.ok('voidEvent', admin.token, { eventId: ev.event_id, isVoid: true, note: 'rewrite test' });
  assert.ok((sheet.stats.apostrophes || 0) > before, 'the untouched description went back with its apostrophe');
  assert.equal(env.rows('events')[0].description, '=1+1');
});
