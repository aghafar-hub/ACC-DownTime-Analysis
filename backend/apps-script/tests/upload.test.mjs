import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, makeUser, seedMaster, startBatch, uploadRow, sha256 } from './harness.mjs';

function setup() {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  seedMaster(env, admin.token);
  return { env, admin };
}
const chunk = (env, token, batchId, rows) => env.ok('uploadChunk', token, { batchId, rows });
const events = (env) => env.rows('events');
const fp = (r, code, n) => sha256(`${r.area_id}|${code}|${r.stop_ts}|${r.start_ts}|${n}`);

test('full upload flow: start, chunk, finish, history, warnings', () => {
  const { env, admin } = setup();
  const b = startBatch(env, admin.token, 'march.xlsx');
  assert.match(b, /^B-\d{8}-\d{6}-[0-9a-f]{4}$/);
  assert.equal(env.ok('getUploadHistory', admin.token)[0].status, 'Started');
  const rows = [uploadRow(), uploadRow({ code_raw: 'N/A', classification: 'pl', criticality: 'NO_INC', is_failure: false, reason_raw: '' }), uploadRow({ code_raw: '100.AA1' })];
  const r = chunk(env, admin.token, b, rows);
  assert.deepEqual(r, { added: 3, identical: 0, rejected: [] });
  const fin = env.ok('uploadFinish', admin.token, {
    batchId: b, summary: { rows_read: 10, rows_skipped: 2 },
    warnings: [
      { type: 'late_row', source_row: 12, detail: 'late', resolution: 'skipped' },
      { type: 'changed_row', source_row: 13, event_id: 'EV-1', detail: 'differs' },
    ],
  });
  assert.equal(fin.status, 'Completed');
  assert.deepEqual([fin.rows_read, fin.rows_added, fin.rows_skipped, fin.rows_identical, fin.warning_count], [10, 3, 2, 0, 2]);
  assert.equal(fin.uploaded_by, admin.user_id);
  const w = env.ok('getUploadWarnings', admin.token, { batchId: b });
  assert.deepEqual(w.map((x) => x.warning_id), [`W-${b}-1`, `W-${b}-2`]);
  assert.equal(w[0].resolution, 'skipped');
  assert.equal(w[0].resolved_by, admin.user_id);
  assert.equal(w[1].resolution, '');
  assert.deepEqual(env.ok('getUploadWarnings', admin.token, { batchId: 'B-other' }), []);
  const hist = env.ok('getUploadHistory', admin.token);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].file_name, 'march.xlsx');
  assert.equal(hist[0].file_hash, sha256('march.xlsx'));
  const actions = env.rows('audit_log').map((a) => a.action);
  for (const a of ['upload_start', 'upload_chunk', 'upload_finish']) assert.ok(actions.includes(a), a);
});

test('server computes ids, fingerprint, equipment, reasons, duration and stores everything typed', () => {
  const { env, admin } = setup();
  const b = startBatch(env, admin.token);
  const row = uploadRow({ code_raw: ' 100.aa1 ', stop_ts: '2026-03-05 10:00:00', start_ts: '2026-03-05 10:01:30.500', classification: 'Mec', reason_raw: '  bearing   FAILURE ' });
  chunk(env, admin.token, b, [row]);
  const [e] = events(env);
  const expectFp = sha256('K.1|100.AA1|2026-03-05 10:00:00.000|2026-03-05 10:01:30.500|1');
  assert.equal(e.fingerprint, expectFp);
  assert.equal(e.event_id, 'EV-' + expectFp.slice(0, 16));
  assert.equal(e.equipment_id, '100.AA01', 'alias resolved');
  assert.equal(e.code_raw, '100.aa1', 'raw text kept (trimmed)');
  assert.equal(e.is_area_level, false);
  assert.equal(e.duration_s, 90.5);
  assert.equal(e.classification, 'MEC');
  assert.equal(e.reason_id, 'R-MEC-001');
  assert.equal(e.reason_raw, 'bearing   FAILURE');
  assert.equal(e.flags, '');
  assert.deepEqual([e.edited, e.is_void, e.freq, e.is_failure, e.criticality], [false, false, 1, true, 'INC']);
  assert.equal(e.batch_id, b);
  assert.equal(e.source_file, 'synthetic.xlsx');
  assert.equal(e.source_row, row.source_row);
  assert.match(e.created_at, /^2026-10-12 \d\d:\d\d:\d\d\.\d{3}$/);
});

test('event dates and timestamps round-trip as plain text through the sheet', () => {
  const { env, admin } = setup();
  const b = startBatch(env, admin.token);
  chunk(env, admin.token, b, [uploadRow({ event_date: '2026-03-05' })]);
  const raw = env.sheet('events').data[1];
  const headers = env.sheet('events').data[0];
  for (const h of ['event_date', 'stop_ts', 'start_ts', 'created_at']) {
    assert.equal(typeof raw[headers.indexOf(h)], 'string', `${h} is stored as text, not a date`);
  }
  const got = env.ok('getEvents', admin.token, { year: 2026 });
  assert.equal(got.length, 1);
  assert.equal(got[0].event_date, '2026-03-05');
  assert.match(got[0].stop_ts, /^2026-03-05 \d\d:\d\d:00\.000$/);
  assert.equal(typeof got[0].duration_s, 'number');
  assert.equal(typeof got[0].is_failure, 'boolean');
});

test('getEvents filters by the year prefix of event_date and validates the year', () => {
  const { env, admin } = setup();
  const b = startBatch(env, admin.token);
  chunk(env, admin.token, b, [
    uploadRow({ event_date: '2025-12-31', stop_ts: '2025-12-31 23:00:00.000', start_ts: '2025-12-31 23:30:00.000' }),
    uploadRow({ event_date: '2026-01-01', stop_ts: '2026-01-01 00:10:00.000', start_ts: '2026-01-01 00:20:00.000' }),
    uploadRow({ event_date: '2026-06-01', stop_ts: '2026-06-01 00:10:00.000', start_ts: '2026-06-01 00:20:00.000' }),
  ]);
  assert.equal(env.ok('getEvents', admin.token, { year: 2026 }).length, 2);
  assert.equal(env.ok('getEvents', admin.token, { year: 2025 }).length, 1);
  assert.equal(env.ok('getEvents', admin.token, { year: 2024 }).length, 0);
  assert.deepEqual(env.ok('getStartup', admin.token).years, [2026, 2025]); // newest first
  assert.equal(env.call('getEvents', admin.token, { year: 'abc' }).error.code, 'bad_request');
  assert.equal(env.call('getEvents', admin.token, {}).error.code, 'bad_request');
});

test('idempotent: the same chunk twice adds 0, a re-upload in a new batch adds 0', () => {
  const { env, admin } = setup();
  const rows = [uploadRow(), uploadRow(), uploadRow()];
  const b1 = startBatch(env, admin.token);
  assert.equal(chunk(env, admin.token, b1, rows).added, 3);
  const again = chunk(env, admin.token, b1, rows);
  assert.deepEqual(again, { added: 0, identical: 3, rejected: [] });
  assert.equal(events(env).length, 3);
  const b2 = startBatch(env, admin.token, 'again.xlsx');
  assert.deepEqual(chunk(env, admin.token, b2, rows), { added: 0, identical: 3, rejected: [] });
  const fin = env.ok('uploadFinish', admin.token, { batchId: b2, summary: { rows_read: 3, rows_skipped: 0 }, warnings: [] });
  assert.deepEqual([fin.rows_added, fin.rows_identical], [0, 3]);
  assert.equal(events(env).length, 3);
});

test('a partly new file adds only the new rows', () => {
  const { env, admin } = setup();
  const old = [uploadRow(), uploadRow()];
  chunk(env, admin.token, startBatch(env, admin.token), old);
  const b2 = startBatch(env, admin.token);
  const r = chunk(env, admin.token, b2, [...old, uploadRow(), uploadRow()]);
  assert.equal(r.added, 2);
  assert.equal(r.identical, 2);
  assert.equal(events(env).length, 4);
});

test('hard rejects: reported with the source row and a reason, never inserted', () => {
  const { env, admin } = setup();
  const b = startBatch(env, admin.token);
  const cases = [
    ['unknown area', { area_id: 'ZZ' }, /Unknown area/],
    ['line not matching area', { line_id: 'L.2' }, /does not match/],
    ['bad stop time', { stop_ts: '2026-13-40 10:00:00' }, /stop time/],
    ['bad start time', { start_ts: 'yesterday' }, /start time/],
    ['bad date', { event_date: '05/03/2026' }, /date/],
    ['bad classification', { classification: 'XYZ' }, /Classification/],
    ['freq 2', { freq: 2 }, /Freq/],
    ['criticality', { criticality: 'MAYBE' }, /Criticality/],
    ['failure not boolean', { is_failure: 'YES' }, /Failure/],
  ];
  const rows = cases.map(([, over], i) => uploadRow({ ...over, source_row: 500 + i }));
  const good = uploadRow({ source_row: 900 });
  const r = chunk(env, admin.token, b, [...rows, good]);
  assert.equal(r.added, 1);
  assert.equal(r.rejected.length, cases.length);
  cases.forEach(([name, , re], i) => {
    assert.equal(r.rejected[i].source_row, 500 + i, name);
    assert.match(r.rejected[i].reason, re, name);
  });
  assert.equal(events(env).length, 1);
  assert.equal(events(env)[0].source_row, 900);
  // non-object rows are rejected too
  assert.equal(chunk(env, admin.token, b, [null, 'x', 5]).rejected.length, 3);
});

test('flags: unknown_code, unlisted_reason, blank_reason, end_before_start, placeholder', () => {
  const { env, admin } = setup();
  const b = startBatch(env, admin.token);
  const mk = (over) => uploadRow({ source_row: undefined, ...over });
  chunk(env, admin.token, b, [
    mk({ code_raw: 'NOPE.99', source_row: 1 }),
    mk({ reason_raw: 'Something not listed', source_row: 2 }),
    mk({ reason_raw: '   ', source_row: 3 }),
    mk({ stop_ts: '2026-03-05 12:00:00.000', start_ts: '2026-03-05 11:00:00.000', source_row: 4 }),
    mk({ code_raw: 'AFR', source_row: 5 }),
    mk({ code_raw: 'n/a', reason_raw: '', source_row: 6 }),
    mk({ code_raw: '100.AB02', classification: 'ELE', reason_raw: 'Bearing failure', source_row: 7 }), // listed only under MEC
    mk({ code_raw: '100. .AB02', classification: 'ELE', reason_raw: 'motor TRIP', source_row: 8 }),
  ]);
  const by = Object.fromEntries(events(env).map((e) => [e.source_row, e]));
  assert.equal(by[1].flags, 'unknown_code'); assert.equal(by[1].equipment_id, '');
  assert.equal(by[2].flags, 'unlisted_reason'); assert.equal(by[2].reason_id, '');
  assert.equal(by[3].flags, 'blank_reason');
  assert.equal(by[4].flags, 'end_before_start'); assert.equal(by[4].duration_s, -3600);
  assert.deepEqual(by[5].flags.split(','), ['unknown_code', 'placeholder']);
  assert.equal(by[6].is_area_level, true); assert.equal(by[6].equipment_id, ''); assert.equal(by[6].flags, 'blank_reason');
  assert.equal(by[7].flags, 'unlisted_reason', 'reason must match within the classification');
  assert.equal(by[8].flags, ''); assert.equal(by[8].equipment_id, '100.AB02'); assert.equal(by[8].reason_id, 'R-ELE-001');
});

test('occurrence counter: identical rows in one file get occurrence 1, 2, 3', () => {
  const { env, admin } = setup();
  const x = uploadRow();
  const b = startBatch(env, admin.token);
  const r = chunk(env, admin.token, b, [x, { ...x, source_row: 2001 }, { ...x, source_row: 2002 }]);
  assert.equal(r.added, 3);
  const ev = events(env);
  assert.deepEqual(ev.map((e) => e.fingerprint), [1, 2, 3].map((n) => fp(x, '100.AA01', n)));
  assert.deepEqual(ev.map((e) => e.event_id), ev.map((e) => 'EV-' + e.fingerprint.slice(0, 16)));
  // re-upload adds nothing
  const b2 = startBatch(env, admin.token);
  assert.equal(chunk(env, admin.token, b2, [x, { ...x, source_row: 2001 }, { ...x, source_row: 2002 }]).added, 0);
});

test('occurrence counter keeps counting across chunks of one batch, and replays are harmless', () => {
  const { env, admin } = setup();
  const x = uploadRow();
  const b = startBatch(env, admin.token);
  assert.equal(chunk(env, admin.token, b, [x]).added, 1);
  assert.equal(chunk(env, admin.token, b, [{ ...x, source_row: 2001 }]).added, 1);
  assert.deepEqual(events(env).map((e) => e.fingerprint), [1, 2].map((n) => fp(x, '100.AA01', n)));
  // replay of chunk 2 (a network retry): still 2 rows
  assert.equal(chunk(env, admin.token, b, [{ ...x, source_row: 2001 }]).added, 0);
  assert.equal(events(env).length, 2);
});

test('a client fingerprint that verifies decides the occurrence (a third copy straddling chunks)', () => {
  const { env, admin } = setup();
  const x = uploadRow();
  chunk(env, admin.token, startBatch(env, admin.token), [x, { ...x }]);
  const b2 = startBatch(env, admin.token);
  const withFp = (n) => ({ ...x, source_row: 3000 + n, fingerprint: fp(x, '100.AA01', n) });
  assert.deepEqual(chunk(env, admin.token, b2, [withFp(1), withFp(2)]), { added: 0, identical: 2, rejected: [] });
  assert.deepEqual(chunk(env, admin.token, b2, [withFp(3)]), { added: 1, identical: 0, rejected: [] });
  assert.equal(events(env).length, 3);
  // a made-up fingerprint is ignored, never trusted
  const forged = { ...x, source_row: 3999, fingerprint: 'a'.repeat(64) };
  const b3 = startBatch(env, admin.token);
  assert.equal(chunk(env, admin.token, b3, [forged]).identical, 1);
  assert.ok(events(env).every((e) => e.fingerprint !== 'a'.repeat(64)));
});

test('rows are inserted with one batched write', () => {
  const { env, admin } = setup();
  const b = startBatch(env, admin.token);
  const before = env.sheet('events').stats.setValues;
  const rows = Array.from({ length: 300 }, () => uploadRow());
  assert.equal(chunk(env, admin.token, b, rows).added, 300);
  assert.equal(env.sheet('events').stats.setValues - before, 1);
});

test('the sheet grows when full and new rows keep text formats', () => {
  const { env, admin } = setup();
  env.sheet('events').maxRows = 5;
  const b = startBatch(env, admin.token);
  chunk(env, admin.token, b, Array.from({ length: 12 }, () => uploadRow()));
  assert.equal(events(env).length, 12);
  assert.ok(env.ok('getEvents', admin.token, { year: 2026 }).every((e) => typeof e.event_date === 'string' && e.event_date.length === 10));
});

test('chunk and finish rules', () => {
  const { env, admin } = setup();
  const b = startBatch(env, admin.token);
  assert.equal(env.call('uploadChunk', admin.token, { batchId: b, rows: 'x' }).error.code, 'bad_request');
  assert.equal(env.call('uploadChunk', admin.token, { batchId: b, rows: Array.from({ length: 1001 }, () => ({})) }).error.code, 'bad_request');
  assert.equal(env.call('uploadChunk', admin.token, { batchId: 'B-none', rows: [] }).error.code, 'not_found');
  assert.equal(env.call('uploadFinish', admin.token, { batchId: b, summary: { rows_read: -1, rows_skipped: 0 }, warnings: [] }).error.code, 'bad_request');
  assert.equal(env.call('uploadFinish', admin.token, { batchId: b, summary: { rows_read: 1, rows_skipped: 0 }, warnings: [{ type: 'nonsense' }] }).error.code, 'bad_request');
  assert.equal(env.call('uploadFinish', admin.token, { batchId: b, summary: { rows_read: 1, rows_skipped: 0 }, warnings: [{ type: 'late_row', resolution: 'maybe' }] }).error.code, 'bad_request');
  assert.equal(env.ok('getUploadHistory', admin.token)[0].status, 'Started');
  const fin1 = env.ok('uploadFinish', admin.token, { batchId: b, summary: { rows_read: 0, rows_skipped: 0 }, warnings: [{ type: 'unknown_code', detail: 'x' }] });
  const fin2 = env.ok('uploadFinish', admin.token, { batchId: b, summary: { rows_read: 0, rows_skipped: 0 }, warnings: [{ type: 'unknown_code', detail: 'x' }] });
  assert.deepEqual(fin2, fin1);
  assert.equal(env.rows('upload_warnings').length, 1, 'finishing twice does not duplicate warnings');
  assert.equal(env.call('uploadChunk', admin.token, { batchId: b, rows: [] }).error.code, 'conflict');
});

test('only users with Upload access can upload or read history', () => {
  const { env, admin } = setup();
  const mgr = makeUser(env, admin.token, 'ROLE-MGR', 'm@example.com');
  const eng = makeUser(env, admin.token, 'ROLE-ENG', 'e@example.com');
  for (const a of ['uploadStart', 'uploadChunk', 'uploadFinish', 'getUploadHistory', 'getUploadWarnings']) {
    assert.equal(env.call(a, mgr.token, {}).error.code, 'forbidden', a);
  }
  const b = startBatch(env, eng.token);
  assert.equal(chunk(env, eng.token, b, [uploadRow()]).added, 1);
  assert.equal(env.rows('upload_batches')[0].uploaded_by, eng.user_id, 'person comes from the session');
});

test('upload edit-state: voided and edited events still count as stored (no re-add)', () => {
  const { env, admin } = setup();
  const x = uploadRow();
  chunk(env, admin.token, startBatch(env, admin.token), [x]);
  const id = events(env)[0].event_id;
  env.ok('editEvent', admin.token, { eventId: id, changes: { stop_ts: '2026-03-05 01:00:00.000' }, note: 'fix' });
  env.ok('voidEvent', admin.token, { eventId: id, isVoid: true, note: 'dup' });
  assert.equal(chunk(env, admin.token, startBatch(env, admin.token), [x]).added, 0);
  assert.equal(events(env).length, 1);
});
