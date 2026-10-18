// 1.9.0: outgoing mail (Mail.js): the system email setting, sending as a Gmail alias, sendReport and sendTestEmail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv, bootstrapAdmin, makeUser, stubMailApp, stubGmail, GOOD_PASSWORD } from './harness.mjs';

function setup() {
  const env = createEnv();
  const admin = bootstrapAdmin(env);
  const mgr = makeUser(env, admin.token, 'ROLE-MGR', 'mgr@example.com');
  const viewer = makeUser(env, admin.token, 'ROLE-VIEW', 'view@example.com');
  return { env, admin, mgr, viewer };
}

const PDF = Buffer.from('%PDF-1.4 synthetic').toString('base64');
const email = (over = {}) => ({ to: ['a@outside.org'], subject: 'Monthly report', html: '<p>Total <b>374.5 h</b></p>', ...over });
const setSetting = (env, token, changes) => env.ok('saveSettings', token, { changes });

test('settings: system email is blank or an email address; the sender name is plain text', () => {
  const { env, admin } = setup();
  const get = (k) => env.rows('settings').find((s) => s.key === k)?.value;
  assert.equal(get('system_email'), '');
  assert.equal(get('system_email_name'), 'ACC Downtime Analysis');
  setSetting(env, admin.token, { system_email: ' Downtime@ArabianCement.com ', system_email_name: 'ACC <Downtime>' });
  assert.equal(get('system_email'), 'downtime@arabiancement.com');
  assert.equal(get('system_email_name'), 'ACC Downtime');
  for (const v of ['not-an-email', 'a@b', 'x@y.com, z@w.com']) {
    assert.equal(env.call('saveSettings', admin.token, { changes: { system_email: v } }).error?.code, 'bad_request', v);
  }
  assert.equal(env.call('saveSettings', admin.token, { changes: { system_email_name: 'x'.repeat(81) } }).error?.code, 'bad_request');
});

test('sendReport without a system email goes through MailApp with the attachments as blobs and reply-to the sender', () => {
  const { env, mgr } = setup();
  const sent = stubMailApp(env);
  const r = env.ok('sendReport', mgr.token, { email: email({ cc: ['b@outside.org', 'a@outside.org'], attachments: [{ name: 'report.pdf', mimeType: 'application/pdf', base64: PDF }] }) });
  assert.deepEqual(r, { from: 'ACC Downtime Analysis (the Google account that runs the app)', via: 'mailapp', recipients: 2 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'a@outside.org');
  assert.equal(sent[0].cc, 'b@outside.org');
  assert.equal(sent[0].replyTo, 'mgr@example.com');
  assert.equal(sent[0].name, 'ACC Downtime Analysis');
  assert.match(sent[0].body, /Total 374\.5 h/);
  assert.equal(sent[0].attachments[0].name, 'report.pdf');
  const log = env.rows('audit_log').filter((a) => a.action === 'send_report');
  assert.equal(log.length, 1);
  assert.match(log[0].detail, /^Report to 2 recipients: Monthly report \(report\.pdf\)$/);
});

test('with a system email that is a verified alias the mail goes through the Gmail API as that address', () => {
  const { env, admin, mgr } = setup();
  stubMailApp(env);
  const sent = stubGmail(env, { aliases: ['owner@example.com', 'downtime@arabiancement.com'] });
  setSetting(env, admin.token, { system_email: 'downtime@arabiancement.com', system_email_name: 'ACC Downtime' });
  const r = env.ok('sendReport', mgr.token, { email: email({ subject: 'Rapport – août', attachments: [{ name: 'r.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: PDF }] }) });
  assert.equal(r.via, 'gmail');
  assert.equal(r.from, '"ACC Downtime" <downtime@arabiancement.com>');
  assert.equal(sent.length, 1);
  const mime = sent[0].mime;
  assert.equal(sent[0].user, 'me');
  assert.match(mime, /^From: "ACC Downtime" <downtime@arabiancement\.com>$/m);
  assert.match(mime, /^To: a@outside\.org$/m);
  assert.match(mime, /^Reply-To: mgr@example\.com$/m);
  assert.match(mime, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/m);
  assert.match(mime, /Content-Disposition: attachment; filename="r\.xlsx"/);
  assert.match(mime, /Content-Type: text\/html; charset="UTF-8"/);
});

test('a system email that is not a verified alias, or a missing Gmail service, is explained', () => {
  const { env, admin, mgr } = setup();
  stubMailApp(env);
  setSetting(env, admin.token, { system_email: 'downtime@arabiancement.com' });
  let r = env.call('sendReport', mgr.token, { email: email() });
  assert.match(r.error.message, /Gmail service is not turned on/);
  stubGmail(env, { aliases: ['owner@example.com'] });
  r = env.call('sendReport', mgr.token, { email: email() });
  assert.match(r.error.message, /not a verified "Send mail as" address/);
  assert.equal(env.rows('audit_log').filter((a) => a.action === 'send_report').length, 0);
});

test('sendReport needs Edit on Reports or the Admin role; recipients, subject and attachments are checked', () => {
  const { env, admin, viewer } = setup();
  stubMailApp(env);
  assert.equal(env.call('sendReport', viewer.token, { email: email() }).error.code, 'forbidden');
  assert.equal(env.call('sendReport', admin.token, { email: email() }).status, 'ok');
  const bad = (over, re) => {
    const r = env.call('sendReport', admin.token, { email: email(over) });
    assert.equal(r.error?.code, 'bad_request', JSON.stringify(over));
    if (re) assert.match(r.error.message, re);
  };
  bad({ to: [] }, /at least one recipient/);
  bad({ to: ['nope'] }, /not a valid email/);
  bad({ to: ['a@b.com>, c@d.com'] }, /not a valid email/);
  bad({ to: Array.from({ length: 26 }, (_, i) => `p${i}@x.org`) }, /at most 25/);
  bad({ subject: '' }, /subject is required/i);
  bad({ subject: 's'.repeat(201) }, /too long/);
  bad({ attachments: [{ name: 'x.exe', mimeType: 'application/octet-stream', base64: PDF }] }, /Only PDF, Excel and CSV/);
  bad({ attachments: [1, 2, 3, 4].map(() => ({ name: 'r.pdf', mimeType: 'application/pdf', base64: PDF })) }, /At most 3/);
  bad({ attachments: [{ name: 'r.pdf', mimeType: 'application/pdf', base64: 'A'.repeat(21 * 1024 * 1024) }] }, /15 MB/);
});

test('the HTML summary is cleaned: no scripts, handlers, frames or non-https links', () => {
  const { env, admin } = setup();
  const sent = stubMailApp(env);
  const html = '<p onclick="x()">Hi<script>alert(1)</script><iframe src="https://e.vil"></iframe>' +
    '<a href="javascript:alert(1)">bad</a><a href="http://plain">plain</a><a href="https://ok.example/x">ok</a>' +
    '<img src="data:image/png;base64,iVBORw0KGgo=" onerror="x()"><span style="background:url(https://t.rack)">s</span></p>';
  env.ok('sendReport', admin.token, { email: email({ html }) });
  const out = sent[0].htmlBody;
  assert.ok(!/script|onclick|onerror|iframe|javascript:|http:\/\/plain|url\(/i.test(out), out);
  assert.match(out, /href="https:\/\/ok\.example\/x"/);
  assert.match(out, /src="data:image\/png;base64,iVBORw0KGgo="/);
});

test('at most 30 report emails per person per day; the count starts again the next day', () => {
  const { env, mgr } = setup();
  stubMailApp(env, { quota: 1000 });
  for (let i = 0; i < 30; i++) assert.equal(env.call('sendReport', mgr.token, { email: email() }).status, 'ok', `send ${i}`);
  assert.match(env.call('sendReport', mgr.token, { email: email() }).error.message, /most allowed in one day/);
  env.advance(24 * 3600 * 1000);
  const again = env.ok('login', '', { email: 'mgr@example.com', password: GOOD_PASSWORD, keepSignedIn: false }).token;
  assert.equal(env.call('sendReport', again, { email: email() }).status, 'ok');
});

test('people picked in the app by user id are looked up on the server and join To', () => {
  const { env, mgr, viewer } = setup();
  const sent = stubMailApp(env);
  const r = env.ok('sendReport', mgr.token, { email: email({ to: [], users: [viewer.user_id] }) });
  assert.equal(r.recipients, 1);
  assert.equal(sent[0].to, 'view@example.com');
  assert.match(env.call('sendReport', mgr.token, { email: email({ users: ['U-NOPE'] }) }).error.message, /no active user U-NOPE/);
});

test('a used-up mail quota is reported in words', () => {
  const { env, mgr } = setup();
  stubMailApp(env, { quota: 0 });
  assert.match(env.call('sendReport', mgr.token, { email: email() }).error.message, /quota .* is used up/);
});

test('sendTestEmail: Admin only, to the Admin\'s own address, says which sender was used', () => {
  const { env, admin, mgr } = setup();
  const sent = stubMailApp(env);
  assert.equal(env.call('sendTestEmail', mgr.token).error.code, 'forbidden');
  const r = env.ok('sendTestEmail', admin.token);
  assert.equal(r.to, 'admin@example.com');
  assert.equal(r.via, 'mailapp');
  assert.equal(sent[0].to, 'admin@example.com');
  const g = stubGmail(env, { aliases: ['owner@example.com', 'downtime@arabiancement.com'] });
  setSetting(env, admin.token, { system_email: 'downtime@arabiancement.com' });
  const r2 = env.ok('sendTestEmail', admin.token);
  assert.equal(r2.via, 'gmail');
  assert.match(r2.from, /downtime@arabiancement\.com/);
  assert.match(g[0].mime, /^To: admin@example\.com$/m);
});

test('the digest uses the same helper: with a system email it goes out through Gmail', () => {
  const { env, admin } = setup();
  stubMailApp(env);
  const g = stubGmail(env, { aliases: ['owner@example.com', 'downtime@arabiancement.com'] });
  setSetting(env, admin.token, { system_email: 'downtime@arabiancement.com' });
  const res = env.run('sendMail_({ to: ["x@y.org"], cc: [], subject: "Digest", text: "t", html: "<p>t</p>", attachments: [] })');
  assert.equal(env.json(res).via, 'gmail');
  assert.equal(g.length, 1);
});
