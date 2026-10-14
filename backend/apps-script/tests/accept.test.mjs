import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, makeUser, seedMaster, uploadAll, uploadRow, stubMailApp } from './harness.mjs';

// "Keep as entered": acceptEventFlags, pruning, notifications, saved views and targets (backend 1.3.0).

function world() {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  const warn = uploadRow({ code_raw: 'ZZ.99', reason_raw: 'Bearing failure' }); // unknown_code (warning)
  const two = uploadRow({ code_raw: 'AFR', reason_raw: '' }); // placeholder + blank_reason (warnings)
  const block = uploadRow({ classification: '' }); // missing_classification (blocking)
  const clean = uploadRow();
  uploadAll(env, admin.token, [warn, two, block, clean]);
  const rows = env.rows('events');
  const by = (pred) => rows.find(pred);
  return {
    env, admin,
    warn: by((e) => e.code_raw === 'ZZ.99'),
    two: by((e) => e.code_raw === 'AFR'),
    block: by((e) => e.flags.includes('missing_classification')),
    clean: by((e) => e.flags === ''),
  };
}
const accept = (env, token, ev, flags, note = 'Checked: entered correctly') => env.call('acceptEventFlags', token, { eventId: ev.event_id, flags, note });
const history = (env, ev) => env.rows('event_edits').filter((h) => h.event_id === ev.event_id && h.field === 'accepted_flags');
const now = (env) => env.rows('events');

test('the schema gains the three event columns and the new settings', () => {
  const env = createEnv();
  const cols = env.json(env.run('SCHEMA.tables.events.columns')).map((c) => c.name);
  assert.deepEqual(cols.slice(-3), ['accepted_flags', 'accepted_by', 'accepted_at']);
  const keys = env.rows('settings').map((s) => s.key);
  for (const k of ['availability_target_pct', 'target_mtbf_h', 'target_mttr_h']) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes('target_availability_pct') && !keys.includes('notif_availability_target_pct'));
  assert.ok(['1.3.0', '1.4.0'].includes(env.run('APP_VERSION'))); // 1.3.0 features, still present in later versions
});

test('ensureSchema + seedDefaults upgrade a 1.2.0 database without touching data', () => {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  uploadAll(env, admin.token, [uploadRow({ code_raw: 'ZZ.99' })]);
  // make the sheets look like version 1.2.0: no accepted columns, no new settings
  const sh = env.sheet('events');
  const headers = sh.data[0];
  const cut = headers.indexOf('accepted_flags');
  sh.data.forEach((line) => line.splice(cut, 3));
  const st = env.sheet('settings');
  const kc = st.data[0].indexOf('key');
  st.data = st.data.filter((line, i) => i === 0 || !String(line[kc]).startsWith('target_'));
  const before = env.rows('events');
  assert.ok(!('accepted_flags' in before[0]));
  const settingsBefore = env.rows('settings');
  env.ctx.ensureSchema();
  env.ctx.seedDefaults();
  const after = env.rows('events');
  assert.equal(after.length, 1);
  for (const k of Object.keys(before[0])) assert.deepEqual(after[0][k], before[0][k], k);
  assert.equal(after[0].accepted_flags, '');
  assert.deepEqual(env.rows('settings').filter((s) => !s.key.startsWith('target_')).map((s) => [s.key, s.value]), settingsBefore.map((s) => [s.key, s.value]));
  assert.equal(env.rows('settings').filter((s) => s.key.startsWith('target_')).length, 2);
  // and it works on the upgraded sheet
  const r = accept(env, admin.token, after[0], ['unknown_code']);
  assert.equal(r.status, 'ok');
  assert.equal(r.data.accepted_flags, 'unknown_code');
});

test('accept a warning: only accepted_* change, one history row, one audit row', () => {
  const { env, admin, warn } = world();
  const before = env.json(warn);
  const r = accept(env, admin.token, warn, ['unknown_code'], '  Checked: entered correctly ');
  assert.equal(r.status, 'ok');
  const ev = r.data;
  assert.equal(ev.accepted_flags, 'unknown_code');
  assert.equal(ev.accepted_by, admin.user_id);
  assert.match(ev.accepted_at, /^2026-10-12 \d\d:\d\d:\d\d\.\d{3}$/);
  for (const k of Object.keys(before)) if (!k.startsWith('accepted_')) assert.deepEqual(ev[k], before[k], `${k} unchanged`);
  assert.equal(ev.edited, false, 'accepting is not an edit');
  assert.equal(ev.flags, before.flags, 'flags are not recalculated');
  const h = history(env, warn);
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].old_value, h[0].new_value, h[0].note, h[0].edited_by], ['', 'unknown_code', 'Checked: entered correctly', admin.user_id]);
  assert.equal(env.rows('event_edits').filter((x) => x.event_id === warn.event_id).length, 1);
  const a = env.rows('audit_log').filter((x) => x.action === 'accept_event_flags');
  assert.equal(a.length, 1);
  assert.match(a[0].detail, /unknown_code/);
  assert.match(a[0].detail, /Checked: entered correctly/);
  // getEvents returns the new fields
  const listed = env.ok('getEvents', admin.token, { year: 2026 }).find((e) => e.event_id === warn.event_id);
  assert.equal(listed.accepted_flags, 'unknown_code');
});

test('partial accept, change of set, partial undo and undo all (the set sent is the full new set)', () => {
  const { env, admin, two } = world();
  assert.equal(two.flags, 'unknown_code,placeholder,blank_reason');
  let r = accept(env, admin.token, two, ['blank_reason', 'placeholder']).data; // any order, stored in catalogue order
  assert.equal(r.accepted_flags, 'placeholder,blank_reason');
  env.advance(60000);
  r = accept(env, admin.token, two, ['placeholder']).data; // fewer = undo one
  assert.equal(r.accepted_flags, 'placeholder');
  assert.equal(r.flags, 'unknown_code,placeholder,blank_reason');
  const t1 = r.accepted_at;
  env.advance(60000);
  r = accept(env, admin.token, two, []).data; // empty = undo all
  assert.equal(r.accepted_flags, '');
  assert.equal(r.accepted_by, '');
  assert.equal(r.accepted_at, '');
  assert.ok(t1 > '');
  const h = history(env, two);
  assert.deepEqual(h.map((x) => [x.old_value, x.new_value]), [['', 'placeholder,blank_reason'], ['placeholder,blank_reason', 'placeholder'], ['placeholder', '']]);
  assert.equal(new Set(h.map((x) => x.edit_id)).size, 3);
});

test('refusals: unknown flag, short note, repeat, flag the record does not have, void, missing event', () => {
  const { env, admin, warn, clean } = world();
  const bad = (res, re) => { assert.equal(res.status, 'error'); assert.equal(res.error.code, 'bad_request'); assert.match(res.error.message, re); };
  bad(accept(env, admin.token, warn, ['made_up']), /Unknown flag/);
  bad(accept(env, admin.token, warn, 'unknown_code'), /list/);
  bad(accept(env, admin.token, warn, [7]), /Unknown flag/);
  bad(accept(env, admin.token, warn, ['unknown_code'], 'ok'), /at least 3/);
  bad(accept(env, admin.token, warn, ['unknown_code'], '   '), /required/);
  bad(accept(env, admin.token, warn, ['unknown_code'], null), /required/);
  bad(accept(env, admin.token, warn, ['placeholder']), /does not have the problem/);
  bad(accept(env, admin.token, clean, ['unknown_code']), /does not have the problem/);
  bad(accept(env, admin.token, warn, []), /Nothing was changed/); // nothing accepted, nothing to undo
  assert.equal(accept(env, admin.token, warn, ['unknown_code']).status, 'ok');
  bad(accept(env, admin.token, warn, ['unknown_code']), /Nothing was changed/);
  // undo needs a note too
  bad(accept(env, admin.token, warn, [], 'x'), /at least 3/);
  assert.equal(accept(env, admin.token, warn, [], 'Entered wrong after all').status, 'ok');
  // voided
  env.ok('voidEvent', admin.token, { eventId: warn.event_id, isVoid: true, note: 'duplicate' });
  const v = accept(env, admin.token, warn, ['unknown_code']);
  assert.equal(v.error.code, 'conflict');
  assert.match(v.error.message, /void/);
  const missing = env.call('acceptEventFlags', admin.token, { eventId: 'EV-nope', flags: ['unknown_code'], note: 'abc' });
  assert.equal(missing.error.code, 'not_found');
  assert.equal(history(env, warn).length, 2, 'refusals wrote nothing');
});

test('the derived overlap flag may be accepted and is kept until undone', () => {
  const { env, admin, clean } = world();
  const r = accept(env, admin.token, clean, ['overlap_in_area']);
  assert.equal(r.status, 'ok');
  assert.equal(r.data.accepted_flags, 'overlap_in_area');
  const ed = env.call('editEvent', admin.token, { eventId: clean.event_id, changes: { description: 'x' }, note: 'minor' });
  assert.equal(ed.data.accepted_flags, 'overlap_in_area');
});

test('access: Edit on events needed; view-only roles and the unauthenticated are refused', () => {
  const { env, admin, warn } = world();
  const view = makeUser(env, admin.token, 'ROLE-VIEW', 'view@example.com');
  const eng = makeUser(env, admin.token, 'ROLE-ENG', 'eng@example.com');
  const mgr = makeUser(env, admin.token, 'ROLE-MGR', 'mgr@example.com');
  const denied = accept(env, view.token, warn, ['unknown_code']);
  assert.equal(denied.error.code, 'forbidden');
  assert.equal(env.call('acceptEventFlags', '', { eventId: warn.event_id, flags: ['unknown_code'], note: 'abc' }).error.code, 'unauthenticated');
  assert.equal(now(env).find((e) => e.event_id === warn.event_id).accepted_flags, '');
  // an engineer may; a manager only if the role has Edit on events
  assert.equal(accept(env, eng.token, warn, ['unknown_code']).status, 'ok');
  const mgrAccess = env.ok('getMyAccess', mgr.token).access.events;
  assert.equal(accept(env, mgr.token, warn, []).status === 'ok', mgrAccess === 'Edit');
  // a user override that removes Edit also removes the action
  env.ok('setUserTabAccess', admin.token, { userId: eng.user_id, overrides: { events: 'View' } });
  assert.equal(accept(env, eng.token, warn, []).error.code, 'forbidden');
});

test('pruning: an edit drops accepted flags the record no longer has; others stay; history says so', () => {
  const { env, admin, two } = world();
  accept(env, admin.token, two, ['placeholder', 'blank_reason']);
  const before = history(env, two).length;
  // fixing the reason removes blank_reason (still unlisted? 'Bearing failure' is listed for MEC) and keeps the placeholder
  const ed = env.call('editEvent', admin.token, { eventId: two.event_id, changes: { reason_raw: 'Bearing failure' }, note: 'Reason found' });
  assert.equal(ed.status, 'ok');
  assert.equal(ed.data.flags, 'unknown_code,placeholder');
  assert.equal(ed.data.accepted_flags, 'placeholder');
  assert.equal(ed.data.accepted_by, admin.user_id, 'who accepted stays while something is still accepted');
  const h = history(env, two);
  assert.equal(h.length, before + 1);
  assert.deepEqual([h.at(-1).old_value, h.at(-1).new_value], ['placeholder,blank_reason', 'placeholder']);
  assert.match(h.at(-1).note, /no longer has this problem/);
  // fixing the code removes the last one: columns cleared
  const ed2 = env.call('editEvent', admin.token, { eventId: two.event_id, changes: { code_raw: '100.AA01' }, note: 'Code found' }).data;
  assert.equal(ed2.flags, '');
  assert.equal(ed2.accepted_flags, '');
  assert.equal(ed2.accepted_by, '');
  assert.equal(ed2.accepted_at, '');
  // an edit that keeps the problem keeps the acceptance
  const { env: e2, admin: a2, warn } = world();
  accept(e2, a2.token, warn, ['unknown_code']);
  const ed3 = e2.call('editEvent', a2.token, { eventId: warn.event_id, changes: { description: 'more words' }, note: 'text only' }).data;
  assert.equal(ed3.accepted_flags, 'unknown_code');
  assert.equal(history(e2, warn).length, 1);
});

test('pruning: revalidateEvents drops accepted flags that master data now explains', () => {
  const { env, admin, warn, block } = world();
  accept(env, admin.token, warn, ['unknown_code']);
  accept(env, admin.token, block, ['missing_classification']);
  // add the code to master data: the record is no longer unknown
  env.ok('saveEquipment', admin.token, { row: { equipment_id: 'ZZ.99', description: 'New', criticality: 'Low', status: 'Active' }, areaIds: ['K.1'] });
  const r = env.ok('revalidateEvents', admin.token, {});
  assert.ok(r.changed >= 1);
  const rows = env.rows('events');
  const w = rows.find((e) => e.event_id === warn.event_id);
  assert.equal(w.flags, '');
  assert.equal(w.accepted_flags, '');
  assert.equal(w.accepted_by, '');
  const b = rows.find((e) => e.event_id === block.event_id);
  assert.equal(b.accepted_flags, 'missing_classification', 'still has the problem: stays accepted');
  const h = history(env, warn);
  assert.equal(h.at(-1).new_value, '');
  assert.match(h.at(-1).note, /no longer has this problem/);
  // running it again changes nothing
  assert.equal(env.ok('revalidateEvents', admin.token, {}).changed, 0);
});

test('notifications: accepted flags are not counted as records to validate; blocked records stay out of the rules', () => {
  const { env, admin, warn, two, block } = world();
  const count = () => {
    const d = env.ctx.digestContext_();
    return env.json(d.counts);
  };
  assert.deepEqual(count(), { validate: 3, blocked: 1, codes: 2 });
  accept(env, admin.token, warn, ['unknown_code']);
  assert.deepEqual(count(), { validate: 2, blocked: 1, codes: 1 });
  accept(env, admin.token, two, ['unknown_code', 'placeholder']); // blank_reason still open
  assert.deepEqual(count(), { validate: 2, blocked: 1, codes: 0 });
  accept(env, admin.token, two, ['unknown_code', 'placeholder', 'blank_reason']);
  assert.deepEqual(count(), { validate: 1, blocked: 1, codes: 0 });
  accept(env, admin.token, block, ['missing_classification']);
  assert.deepEqual(count(), { validate: 0, blocked: 0, codes: 0 });
  // the digest has no "to validate" line any more
  stubMailApp(env);
  env.ok('saveNotificationPrefs', admin.token, { prefs: { digest: 'daily' } });
  const text = env.json(env.ctx.buildDigest_(env.ctx.findUserById_(admin.user_id), env.ctx.digestContext_()));
  assert.ok(text === null || !/to validate/.test(text.text));
  // the accepted blocking record is still left out of the rules (it cannot be calculated)
  const loaded = env.ctx.notifLoadContext_(env.ctx.notifSettings_());
  assert.ok(!loaded.rows.some((r) => r.event_id === block.event_id));
  assert.ok(loaded.all.some((r) => r.event_id === block.event_id));
});

test('settings: the three targets are validated like the other settings (blank = off)', () => {
  const { env, admin } = world();
  const save = (changes) => env.call('saveSettings', admin.token, { changes });
  assert.equal(save({ availability_target_pct: '95.5', target_mtbf_h: '120', target_mttr_h: '2.5' }).status, 'ok');
  const get = (k) => env.rows('settings').find((s) => s.key === k).value;
  assert.deepEqual([get('availability_target_pct'), get('target_mtbf_h'), get('target_mttr_h')], ['95.5', '120', '2.5']);
  assert.equal(save({ availability_target_pct: '', target_mtbf_h: '', target_mttr_h: '' }).status, 'ok');
  assert.equal(get('target_mtbf_h'), '');
  assert.equal(save({ availability_target_pct: '0' }).status, 'ok');
  assert.equal(save({ availability_target_pct: '100' }).status, 'ok');
  for (const [k, v] of [['availability_target_pct', '100.1'], ['availability_target_pct', '-1'], ['availability_target_pct', 'abc'],
    ['target_mtbf_h', '0'], ['target_mtbf_h', '-5'], ['target_mtbf_h', '100001'], ['target_mttr_h', '0'], ['target_mttr_h', 'x']]) {
    const r = save({ [k]: v });
    assert.equal(r.error?.code, 'bad_request', `${k}=${v}`);
    assert.match(r.error.message, new RegExp(k));
  }
  assert.equal(save({ target_mttr_h: '100000' }).status, 'ok');
  assert.equal(get('target_mttr_h'), '100000');
});

test('notification_prefs: saved_views is client-writable and validated', () => {
  const { env, admin } = world();
  const view = (o = {}) => ({ id: 'v1', name: 'Kiln stops', page: 'events', query: 'area=K.1&from=2026-01-01', ...o });
  const put = (v) => env.call('saveNotificationPrefs', admin.token, { prefs: { saved_views: typeof v === 'string' ? v : JSON.stringify(v) } });
  const good = JSON.stringify([view(), view({ id: 'v2', name: 'Pareto', page: 'pareto', query: '' })]);
  const ok = put(good);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.data.saved_views, good, 'stored as given');
  assert.equal(env.ok('getNotifications', admin.token).prefs.saved_views, good);
  assert.equal(put([]).status, 'ok');
  assert.equal(put('').status, 'ok');
  const many = Array.from({ length: 20 }, (_, i) => view({ id: `v${i}` }));
  assert.equal(put(many).status, 'ok');
  const bads = [
    'not json', '{"a":1}', '"x"', 'null', JSON.stringify([...many, view({ id: 'v20' })]),
    [view({ id: '' })], [view({ id: 'x'.repeat(41) })], [view({ name: '' })], [view({ name: 'x'.repeat(61) })],
    [view({ page: 'upload' })], [view({ page: 5 })], [view({ query: 'x'.repeat(1501) })], [view({ query: 3 })],
    [view({ extra: 1 })], [view(), view()], [null], [[1]], ['v'], [{ id: 'a' }],
    JSON.stringify([view({ query: 'q'.repeat(1500) })]).padEnd(20001, ' ') + 'x',
  ];
  for (const b of bads) assert.equal(put(b).error?.code, 'bad_request', typeof b === 'string' ? b.slice(0, 30) : JSON.stringify(b).slice(0, 60));
  assert.equal(put([view({ id: 'x'.repeat(40), name: 'n'.repeat(60), query: 'q'.repeat(1500) })]).status, 'ok');
  // other people's views are their own
  const other = makeUser(env, admin.token, 'ROLE-VIEW', 'v@example.com');
  assert.equal(env.ok('getNotifications', other.token).prefs.saved_views, undefined);
  assert.equal(env.call('saveNotificationPrefs', other.token, { prefs: { saved_views: JSON.stringify([view()]) } }).status, 'ok');
  // the server-written key stays closed
  assert.equal(env.call('saveNotificationPrefs', admin.token, { prefs: { last_digest_at: '2026-01-01 00:00:00.000' } }).error.code, 'bad_request');
});

test('notification_prefs: saved_reports is client-writable and strictly validated', () => {
  const { env, admin } = world();
  const tpl = (o = {}) => ({
    id: 't1', name: 'Monthly L.1', template: 'monthly',
    period: { preset: 'lastmonth', from: '', to: '', compare: true },
    filters: { lines: ['L.1'], areas: ['CR'], equipment: ['131.ST200'], classifications: ['MEC'], criticality: ['INC'], failuresOnly: true },
    sections: ['cover', 'summary', 'events'], options: { events: { top: 25, measure: 'hours' }, top_equipment: { top: 'all' } }, ...o,
  });
  const put = (v) => env.call('saveNotificationPrefs', admin.token, { prefs: { saved_reports: typeof v === 'string' ? v : JSON.stringify(v) } });
  const good = JSON.stringify([tpl(), tpl({ id: 't2', name: 'Custom', template: 'custom', period: { preset: 'custom', from: '2026-01-01', to: '2026-02-01', compare: false } })]);
  const ok = put(good);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.data.saved_reports, good, 'stored as given');
  assert.equal(env.ok('getNotifications', admin.token).prefs.saved_reports, good);
  assert.equal(put([]).status, 'ok');
  assert.equal(put('').status, 'ok');
  assert.equal(put(Array.from({ length: 20 }, (_, i) => tpl({ id: `t${i}` }))).status, 'ok');
  const sections = (n) => ({ sections: n });
  const bads = [
    'not json', '{"a":1}', '"x"', 'null', JSON.stringify(Array.from({ length: 21 }, (_, i) => tpl({ id: `t${i}` }))),
    [tpl({ id: '' })], [tpl({ id: 'x'.repeat(41) })], [tpl({ name: '' })], [tpl({ name: ' ' })], [tpl({ name: 'x'.repeat(61) })],
    [tpl({ template: 'weekly' })], [tpl({ template: 5 })], [tpl({ extra: 1 })], [tpl(), tpl()], [null], [[1]], ['v'], [{ id: 'a' }],
    [tpl({ period: null })], [tpl({ period: { preset: 'lastweek', from: '', to: '', compare: true } })],
    [tpl({ period: { preset: 'custom', from: '2026-13-01', to: '', compare: true } })], [tpl({ period: { preset: 'custom', from: '2026-03-01', to: '2026-02-01', compare: true } })],
    [tpl({ period: { preset: 'custom', from: '', to: '', compare: 'yes' } })], [tpl({ period: { preset: 'custom', from: '', to: '', compare: true, extra: 1 } })],
    [tpl({ period: { preset: 'custom', from: 5, to: '', compare: true } })],
    [tpl({ filters: null })], [tpl({ filters: { lines: [], areas: [], equipment: [], classifications: [], criticality: [] } })],
    [tpl({ filters: { lines: 'L.1', areas: [], equipment: [], classifications: [], criticality: [], failuresOnly: false } })],
    [tpl({ filters: { lines: [''], areas: [], equipment: [], classifications: [], criticality: [], failuresOnly: false } })],
    [tpl({ filters: { lines: [5], areas: [], equipment: [], classifications: [], criticality: [], failuresOnly: false } })],
    [tpl({ filters: { lines: ['L.1', 'L.1'], areas: [], equipment: [], classifications: [], criticality: [], failuresOnly: false } })],
    [tpl({ filters: { lines: [], areas: [], equipment: Array.from({ length: 101 }, (_, i) => `E${i}`), classifications: [], criticality: [], failuresOnly: false } })],
    [tpl({ filters: { lines: [], areas: [], equipment: ['x'.repeat(61)], classifications: [], criticality: [], failuresOnly: false } })],
    [tpl({ filters: { lines: [], areas: [], equipment: [], classifications: ['XXX'], criticality: [], failuresOnly: false } })],
    [tpl({ filters: { lines: [], areas: [], equipment: [], classifications: [], criticality: ['HIGH'], failuresOnly: false } })],
    [tpl({ filters: { lines: [], areas: [], equipment: [], classifications: [], criticality: [], failuresOnly: 1 } })],
    [tpl({ filters: { lines: [], areas: [], equipment: [], classifications: [], criticality: [], failuresOnly: false, extra: 1 } })],
    [tpl(sections(['nope']))], [tpl(sections('cover'))], [tpl(sections(['cover', 'cover']))], [tpl(sections([1]))],
    [tpl({ options: null })], [tpl({ options: [] })], [tpl({ options: { nope: { top: 5 } } })], [tpl({ options: { events: 5 } })],
    [tpl({ options: { events: { top: 0 } } })], [tpl({ options: { events: { top: 1001 } } })], [tpl({ options: { events: { top: 2.5 } } })],
    [tpl({ options: { events: { top: '5' } } })], [tpl({ options: { events: { measure: 'minutes' } } })], [tpl({ options: { events: { extra: 1 } } })],
    JSON.stringify([tpl({ name: 'n'.repeat(60) })]).padEnd(20001, ' ') + 'x',
  ];
  for (const b of bads) assert.equal(put(b).error?.code, 'bad_request', typeof b === 'string' ? b.slice(0, 30) : JSON.stringify(b).slice(0, 90));
  assert.equal(put([tpl({ id: 'x'.repeat(40), name: 'n'.repeat(60), options: { events: { top: 1000 }, daily: { top: 'all', measure: 'count' } } })]).status, 'ok');
  assert.equal(put([tpl({ sections: [], options: {}, filters: { lines: [], areas: [], equipment: [], classifications: [], criticality: [], failuresOnly: false } })]).status, 'ok');
  // other people's templates are their own
  const other = makeUser(env, admin.token, 'ROLE-VIEW', 'v@example.com');
  assert.equal(env.ok('getNotifications', other.token).prefs.saved_reports, undefined);
  assert.equal(env.call('saveNotificationPrefs', other.token, { prefs: { saved_reports: JSON.stringify([tpl()]) } }).status, 'ok');
  // saved_views stays separate
  assert.equal(env.call('saveNotificationPrefs', admin.token, { prefs: { saved_reports: JSON.stringify([tpl()]), saved_views: '' } }).status, 'ok');
});
