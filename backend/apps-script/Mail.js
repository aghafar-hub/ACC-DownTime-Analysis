/**
 * Outgoing mail (1.9.0): one helper for every email the app sends (digests, reports, the test email).
 *
 * - Settings `system_email` blank: MailApp, sent by the Google account that deploys the script (as before).
 * - Settings `system_email` set: the Gmail advanced service (Gmail API users.messages.send) with
 *   From: "system_email_name <system_email>". Gmail only keeps that From when the address is a verified
 *   'Send mail as' alias of the deploying account; the helper checks the alias list first and says so plainly.
 * - sendReport (Reports Edit, or an Admin): 1-25 To, up to 25 Cc, any domain, a sanitised HTML summary and up to
 *   3 attachments (PDF, Excel, CSV; 15 MB together). At most MAIL_LIMITS.perUserPerDay sends per person a day.
 */

var MAIL_LIMITS = {
  maxTo: 25,
  maxCc: 25,
  maxAttachments: 3,
  maxBytes: 15 * 1024 * 1024,
  maxHtml: 300000,
  maxText: 20000,
  maxSubject: 200,
  perUserPerDay: 30
};

var MAIL_TYPES_ = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv'
};

var DEFAULT_SENDER_NAME = 'ACC Downtime Analysis';

function settingText_(key, fallback) {
  var rows = readSettings_();
  for (var i = 0; i < rows.length; i++) if (rows[i].key === key) return String(rows[i].value === null || rows[i].value === undefined ? '' : rows[i].value).trim();
  return fallback;
}

/** The sender the settings ask for: { email: '' | address, name }. */
function mailSender_() {
  var email = settingText_('system_email', '').toLowerCase();
  var name = settingText_('system_email_name', '') || DEFAULT_SENDER_NAME;
  return { email: email, name: name };
}

/** "Name" <a@b.c> with the name as an RFC 2047 word when it is not plain ASCII. */
function mimeAddress_(name, email) {
  var n = String(name || '').replace(/[\r\n"]/g, ' ').trim();
  if (!n) return '<' + email + '>';
  return (/^[\x20-\x7e]*$/.test(n) ? '"' + n + '"' : mimeWord_(n)) + ' <' + email + '>';
}

function mimeWord_(text) {
  var s = String(text || '').replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return '=?UTF-8?B?' + Utilities.base64Encode(s, Utilities.Charset.UTF_8) + '?=';
}

function wrap76_(b64) {
  var out = [];
  for (var i = 0; i < b64.length; i += 76) out.push(b64.slice(i, i + 76));
  return out.join('\r\n');
}

/**
 * The raw MIME text: multipart/mixed { multipart/alternative { text, html }, attachments... }.
 * msg: { from, to: [], cc: [], replyTo, subject, text, html, attachments: [{ name, mimeType, base64 }] }
 */
function buildMime_(msg) {
  var stamp = Utilities.getUuid().replace(/-/g, '');
  var mixed = 'mix_' + stamp;
  var alt = 'alt_' + stamp;
  var lines = [];
  lines.push('MIME-Version: 1.0');
  lines.push('From: ' + msg.from);
  lines.push('To: ' + msg.to.join(', '));
  if (msg.cc && msg.cc.length) lines.push('Cc: ' + msg.cc.join(', '));
  if (msg.replyTo) lines.push('Reply-To: ' + msg.replyTo);
  lines.push('Subject: ' + mimeWord_(msg.subject));
  lines.push('Content-Type: multipart/mixed; boundary="' + mixed + '"');
  lines.push('');
  lines.push('--' + mixed);
  lines.push('Content-Type: multipart/alternative; boundary="' + alt + '"');
  lines.push('');
  lines.push('--' + alt);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(wrap76_(Utilities.base64Encode(msg.text || '', Utilities.Charset.UTF_8)));
  if (msg.html) {
    lines.push('--' + alt);
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrap76_(Utilities.base64Encode(msg.html, Utilities.Charset.UTF_8)));
  }
  lines.push('--' + alt + '--');
  (msg.attachments || []).forEach(function (a) {
    var fname = String(a.name).replace(/["\r\n\\]/g, '_');
    lines.push('--' + mixed);
    lines.push('Content-Type: ' + a.mimeType + '; name="' + fname + '"');
    lines.push('Content-Disposition: attachment; filename="' + fname + '"');
    lines.push('Content-Transfer-Encoding: base64');
    lines.push('');
    lines.push(wrap76_(a.base64));
  });
  lines.push('--' + mixed + '--');
  return lines.join('\r\n');
}

/** The verified 'Send mail as' addresses of the deploying account (lower case), cached for 6 hours. Null if unknown. */
function sendAsAddresses_() {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  var hit = cache && cache.get('mail_send_as');
  if (hit) return JSON.parse(hit);
  try {
    var res = Gmail.Users.Settings.SendAs.list('me');
    var list = ((res && res.sendAs) || []).filter(function (s) {
      return s.isPrimary || !s.verificationStatus || s.verificationStatus === 'accepted';
    }).map(function (s) { return String(s.sendAsEmail || '').toLowerCase(); });
    if (cache) cache.put('mail_send_as', JSON.stringify(list), 6 * 3600);
    return list;
  } catch (e) {
    return null;
  }
}

function remainingQuota_() {
  if (typeof MailApp !== 'undefined' && MailApp && typeof MailApp.getRemainingDailyQuota === 'function') return MailApp.getRemainingDailyQuota();
  return null;
}

/**
 * Sends one email. msg: { to: [], cc: [], replyTo, subject, text, html, attachments: [{ name, mimeType, base64 }] }.
 * Returns { from, via: 'gmail' | 'mailapp' }. Throws an api error (plain words) when it cannot send.
 */
function sendMail_(msg) {
  var sender = mailSender_();
  var count = msg.to.length + (msg.cc ? msg.cc.length : 0);
  var left = remainingQuota_();
  if (left !== null && left < count) {
    throw apiError_(ERR.BAD_REQUEST, 'The daily email quota of the Google account that runs the app is used up (' + Math.max(0, left) + ' left). Try again tomorrow.');
  }
  if (sender.email) {
    if (typeof Gmail === 'undefined' || !Gmail || !Gmail.Users) {
      throw apiError_(ERR.BAD_REQUEST, 'The system email is set, but the Gmail service is not turned on in the Apps Script project (Services > Gmail API). Turn it on, or clear the system email to send from the deploying account.');
    }
    var aliases = sendAsAddresses_();
    if (aliases && aliases.indexOf(sender.email) < 0) {
      throw apiError_(ERR.BAD_REQUEST, sender.email + ' is not a verified "Send mail as" address of the Google account that runs the app. Add it in Gmail > Settings > Accounts > Send mail as, confirm it, then try again.');
    }
    var from = mimeAddress_(sender.name, sender.email);
    var raw = buildMime_({ from: from, to: msg.to, cc: msg.cc || [], replyTo: msg.replyTo || '', subject: msg.subject, text: msg.text, html: msg.html, attachments: msg.attachments || [] });
    try {
      Gmail.Users.Messages.send({ raw: Utilities.base64EncodeWebSafe(raw, Utilities.Charset.UTF_8) }, 'me');
    } catch (err) {
      throw apiError_(ERR.BAD_REQUEST, 'Gmail did not send the email: ' + oneLine_(err && err.message ? err.message : err, 200));
    }
    return { from: from, via: 'gmail' };
  }
  if (typeof MailApp === 'undefined' || !MailApp) throw apiError_(ERR.BAD_REQUEST, 'Mail is not available (MailApp).');
  var opts = { to: msg.to.join(','), subject: msg.subject, body: msg.text || '', name: sender.name };
  if (msg.html) opts.htmlBody = msg.html;
  if (msg.cc && msg.cc.length) opts.cc = msg.cc.join(',');
  if (msg.replyTo) opts.replyTo = msg.replyTo;
  if (msg.attachments && msg.attachments.length) {
    opts.attachments = msg.attachments.map(function (a) { return Utilities.newBlob(Utilities.base64Decode(a.base64), a.mimeType, a.name); });
  }
  try {
    MailApp.sendEmail(opts);
  } catch (err2) {
    throw apiError_(ERR.BAD_REQUEST, 'The email could not be sent: ' + oneLine_(err2 && err2.message ? err2.message : err2, 200));
  }
  return { from: sender.name + ' (the Google account that runs the app)', via: 'mailapp' };
}

// ---------------------------------------------------------------- input checks

function cleanAddressList_(list, label, min, max) {
  if (list === undefined || list === null) list = [];
  if (!Array.isArray(list)) throw apiError_(ERR.BAD_REQUEST, label + ' must be a list of email addresses.');
  var out = [];
  list.forEach(function (x) {
    var e = String(x === null || x === undefined ? '' : x).trim().toLowerCase();
    if (!e) return;
    if (e.length > 254 || !EMAIL_PATTERN_.test(e) || /[<>,;"\s]/.test(e)) throw apiError_(ERR.BAD_REQUEST, label + ': "' + e.slice(0, 60) + '" is not a valid email address.');
    if (out.indexOf(e) < 0) out.push(e);
  });
  if (out.length < min) throw apiError_(ERR.BAD_REQUEST, 'Add at least one recipient.');
  if (out.length > max) throw apiError_(ERR.BAD_REQUEST, label + ': at most ' + max + ' addresses.');
  return out;
}

/**
 * Keeps the formatting of the summary and removes anything that could run or call out: scripts, styles blocks,
 * frames, forms, event handlers, javascript: and data: links (data:image is allowed in src), and non-https links.
 */
function sanitizeMailHtml_(html) {
  var s = String(html || '');
  if (s.length > MAIL_LIMITS.maxHtml) throw apiError_(ERR.BAD_REQUEST, 'The email text is too long.');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<\s*(script|style|iframe|object|embed|form|textarea|select|button|svg|math|template|noscript)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  s = s.replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|input|textarea|select|button|link|meta|base|frame|frameset|svg|math|template|noscript)\b[^>]*>/gi, '');
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/\s+(href|src|action|formaction|background|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, function (m, attr, val) {
    var v = val.replace(/^["']|["']$/g, '').trim();
    var a = attr.toLowerCase();
    if (a === 'href' && /^https:\/\//i.test(v)) return ' href="' + v.replace(/"/g, '&quot;') + '"';
    if (a === 'href' && /^mailto:/i.test(v)) return ' href="' + v.replace(/"/g, '&quot;') + '"';
    if (a === 'src' && (/^https:\/\//i.test(v) || /^data:image\/(png|jpe?g|gif);base64,[a-z0-9+\/=]+$/i.test(v))) return ' src="' + v + '"';
    return '';
  });
  s = s.replace(/style\s*=\s*("[^"]*"|'[^']*')/gi, function (m, val) {
    return /expression\s*\(|javascript:|url\s*\(/i.test(val) ? '' : m;
  });
  return s;
}

function htmlToText_(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/(p|div|tr|h[1-6]|li|table)\s*>/gi, '\n')
    .replace(/<\s*\/t[dh]\s*>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function cleanAttachments_(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw apiError_(ERR.BAD_REQUEST, 'Attachments must be a list.');
  if (list.length > MAIL_LIMITS.maxAttachments) throw apiError_(ERR.BAD_REQUEST, 'At most ' + MAIL_LIMITS.maxAttachments + ' attachments.');
  var total = 0;
  return list.map(function (a) {
    requireObject_(a, 'An attachment');
    var type = String(a.mimeType || '');
    var ext = MAIL_TYPES_[type];
    if (!ext) throw apiError_(ERR.BAD_REQUEST, 'Only PDF, Excel and CSV files can be attached.');
    var name = cleanText_(a.name, 'The file name', true, 120).replace(/[\\\/:*?"<>|\r\n]/g, '_');
    if (!new RegExp('\\.' + ext + '$', 'i').test(name)) name += '.' + ext;
    var b64 = String(a.base64 || '').replace(/\s+/g, '');
    if (!b64 || !/^[A-Za-z0-9+\/]+=*$/.test(b64)) throw apiError_(ERR.BAD_REQUEST, 'The file ' + name + ' could not be read.');
    total += Math.floor(b64.length * 3 / 4);
    if (total > MAIL_LIMITS.maxBytes) throw apiError_(ERR.BAD_REQUEST, 'The attachments are larger than 15 MB together.');
    return { name: name, mimeType: type, base64: b64 };
  });
}

/** Counts sends per person per plant day in the script properties; throws past the limit. */
function countMailSend_(userId) {
  var day = Utilities.formatDate(new Date(nowMs_()), TIMEZONE, 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties();
  var key = 'MAILCOUNT_' + userId;
  var cur = String(props.getProperty(key) || '');
  var n = cur.slice(0, 10) === day ? Number(cur.slice(11)) || 0 : 0;
  if (n >= MAIL_LIMITS.perUserPerDay) throw apiError_(ERR.BAD_REQUEST, 'You have sent ' + n + ' emails today, the most allowed in one day. Try again tomorrow.');
  return function () { props.setProperty(key, day + ' ' + (n + 1)); };
}

// ---------------------------------------------------------------- actions

/**
 * sendReport: { to: [], cc: [], subject, html, attachments: [{ name, mimeType, base64 }], kind }.
 * kind: 'report' | 'actions' (only for the log). Returns { from, via, recipients }.
 */
function sendReport_(session, p) {
  requireObject_(p, 'The email');
  var to = cleanAddressList_(p.to, 'To', 1, MAIL_LIMITS.maxTo);
  var cc = cleanAddressList_(p.cc, 'Cc', 0, MAIL_LIMITS.maxCc).filter(function (e) { return to.indexOf(e) < 0; });
  var subject = cleanText_(p.subject, 'The subject', true, MAIL_LIMITS.maxSubject).replace(/[\r\n]+/g, ' ');
  var html = sanitizeMailHtml_(p.html);
  var text = htmlToText_(html).slice(0, MAIL_LIMITS.maxText);
  var attachments = cleanAttachments_(p.attachments);
  var kind = p.kind === 'actions' ? 'actions' : 'report';
  var done = countMailSend_(session.user.user_id);
  var replyTo = EMAIL_PATTERN_.test(String(session.user.email || '')) ? session.user.email : '';
  var res = sendMail_({ to: to, cc: cc, replyTo: replyTo, subject: subject, text: text, html: html, attachments: attachments });
  done();
  var detail = (kind === 'actions' ? 'Actions report' : 'Report') + ' to ' + (to.length + cc.length) + ' recipient' + (to.length + cc.length === 1 ? '' : 's') +
    ': ' + subject + (attachments.length ? ' (' + attachments.map(function (a) { return a.name; }).join(', ') + ')' : '');
  withLock_(function () { auditLog_(session.user.user_id, 'send_report', '', kind, detail); });
  return { from: res.from, via: res.via, recipients: to.length + cc.length };
}

/** sendTestEmail (Admin): a short email to the Admin's own address. Returns { from, via, to }. */
function sendTestEmail_(session) {
  var to = String(session.user.email || '').trim().toLowerCase();
  if (!EMAIL_PATTERN_.test(to)) throw apiError_(ERR.BAD_REQUEST, 'Your account has no valid email address.');
  var sender = mailSender_();
  var html = '<p>This is a test email from ACC Downtime Analysis.</p><p>' +
    (sender.email ? 'It was sent as <b>' + htmlEscape_(sender.email) + '</b>.' : 'No system email is set, so it was sent by the Google account that runs the app.') + '</p>';
  var res = sendMail_({ to: [to], cc: [], replyTo: '', subject: 'ACC Downtime Analysis: test email', text: htmlToText_(html), html: html, attachments: [] });
  withLock_(function () { auditLog_(session.user.user_id, 'send_test_email', '', '', 'Test email to ' + to + ' (' + res.via + ')'); });
  return { from: res.from, via: res.via, to: to };
}
