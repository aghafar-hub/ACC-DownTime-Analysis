/**
 * Upload (docs/wire-protocol.md section 5). Chunks are idempotent: the server
 * recomputes every fingerprint and skips rows that already exist.
 *
 * Occurrence number (the last part of the fingerprint): the browser counts
 * identical rows in file order. The server accepts that number only when the
 * fingerprint the browser sent really equals the hash of the server's own
 * values plus that number (so nothing is trusted). Without a matching
 * fingerprint it counts for itself: rows of the same key already stored in this
 * batch (earlier chunks) plus earlier rows of the same key in this chunk; a row
 * whose source_row is already stored in the batch is a retry, not a new copy.
 */

function enumOf_(table, column) {
  return tableDef_(table).columns.filter(function (c) { return c.name === column; })[0].enum;
}

function batchOrThrow_(batchId) {
  var b = typeof batchId === 'string' ? findBy_(T.BATCHES, 'batch_id', batchId) : null;
  if (!b) throw apiError_(ERR.NOT_FOUND, 'Upload not found.');
  return b;
}

function uploadStart_(session, fileName, fileHash) {
  var name = cleanText_(fileName, 'File name', false, 200);
  var hash = cleanText_(fileHash, 'File hash', false, 128);
  return withLock_(function () {
    var id = 'B-' + compactTs_('yyyyMMdd-HHmmss') + '-' + randomHex_(4);
    appendRow_(T.BATCHES, {
      batch_id: id, uploaded_by: session.user.user_id, uploaded_at: nowTs_(), file_name: name, file_hash: hash,
      rows_read: 0, rows_added: 0, rows_identical: 0, rows_skipped: 0, warning_count: 0, status: 'Started'
    });
    auditLog_(session.user.user_id, 'upload_start', T.BATCHES, id, name);
    return { batch_id: id };
  });
}

function fingerprintOf_(key, occurrence) { return sha256Hex_(key + '|' + occurrence); }

/** The occurrence number the browser used, if its fingerprint verifies; otherwise 0. */
function verifiedHint_(key, clientFingerprint) {
  if (typeof clientFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(clientFingerprint)) return 0;
  for (var n = 1; n <= FINGERPRINT_HINT_MAX; n++) if (fingerprintOf_(key, n) === clientFingerprint) return n;
  return 0;
}

function uploadChunk_(session, batchId, rows) {
  if (!Array.isArray(rows)) throw apiError_(ERR.BAD_REQUEST, 'Rows must be a list.');
  if (rows.length > UPLOAD_CHUNK_MAX_ROWS) throw apiError_(ERR.BAD_REQUEST, 'Too many rows in one chunk (limit ' + UPLOAD_CHUNK_MAX_ROWS + ').');
  return withLock_(function () {
    var batch = batchOrThrow_(batchId);
    if (batch.status !== 'Started') throw apiError_(ERR.CONFLICT, 'This upload is already finished.');
    var ctx = eventContext_();
    var known = {}, inBatch = {};
    var fps = readColumn_(T.EVENTS, 'fingerprint'), bids = readColumn_(T.EVENTS, 'batch_id'), srcs = readColumn_(T.EVENTS, 'source_row');
    for (var i = 0; i < fps.length; i++) {
      known[fps[i]] = true;
      if (bids[i] === batch.batch_id) inBatch[fps[i]] = srcs[i];
    }

    var base = {}, extra = {}, fresh = [], rejected = [], identical = 0;
    rows.forEach(function (row) {
      var norm = normalizeEvent_(ctx, row);
      if (norm.error) {
        rejected.push({ source_row: toIntOr_(row && row.source_row, 0), reason: norm.error });
        return;
      }
      var rec = norm.rec; // a row with a data problem is stored with flags, never dropped
      var key = rec.area_id + '|' + rec.code_key + '|' + rec.stop_ts + '|' + rec.start_ts;
      var srcRow = toIntOr_(row.source_row, null);
      var n = verifiedHint_(key, row.fingerprint);
      if (!n) {
        // Source rows of this key already stored in this batch, in occurrence order.
        if (!base[key]) {
          base[key] = [];
          while (Object.prototype.hasOwnProperty.call(inBatch, fingerprintOf_(key, base[key].length + 1))) {
            base[key].push(inBatch[fingerprintOf_(key, base[key].length + 1)]);
          }
        }
        var at = srcRow === null ? -1 : base[key].indexOf(srcRow);
        if (at >= 0) n = at + 1; // the same file row sent again (a retry)
        else { extra[key] = (extra[key] || 0) + 1; n = base[key].length + extra[key]; }
      }
      var fp = fingerprintOf_(key, n);
      if (known[fp]) { identical++; return; }
      known[fp] = true;
      delete rec.code_key;
      rec.event_id = 'EV-' + fp.slice(0, 16);
      rec.batch_id = batch.batch_id;
      rec.source_file = batch.file_name;
      rec.source_row = srcRow;
      rec.fingerprint = fp;
      rec.edited = false;
      rec.is_void = false;
      rec.created_at = nowTs_();
      fresh.push(rec);
    });
    appendRows_(T.EVENTS, fresh);
    updateRow_(T.BATCHES, batch._row, { rows_added: batch.rows_added + fresh.length, rows_identical: batch.rows_identical + identical });
    auditLog_(session.user.user_id, 'upload_chunk', T.BATCHES, batch.batch_id,
      'Added ' + fresh.length + ', identical ' + identical + ', rejected ' + rejected.length);
    return { added: fresh.length, identical: identical, rejected: rejected };
  });
}

function cleanWarning_(w, batchId, n, userId) {
  requireObject_(w, 'Warning');
  if (enumOf_(T.WARNINGS, 'type').indexOf(w.type) < 0) throw apiError_(ERR.BAD_REQUEST, 'Unknown warning type.');
  var resolution = w.resolution ? String(w.resolution) : '';
  if (resolution && enumOf_(T.WARNINGS, 'resolution').indexOf(resolution) < 0) throw apiError_(ERR.BAD_REQUEST, 'Unknown warning resolution.');
  return {
    warning_id: 'W-' + batchId + '-' + n, batch_id: batchId, type: w.type,
    source_row: toIntOr_(w.source_row, null), event_id: cleanText_(w.event_id, 'Event', false, 60),
    detail: cleanText_(w.detail, 'Detail', false), resolution: resolution, resolved_by: resolution ? userId : ''
  };
}

function nonNegInt_(v, label) {
  if (typeof v !== 'number' || v < 0 || Math.floor(v) !== v) throw apiError_(ERR.BAD_REQUEST, label + ' must be a whole number.');
  return v;
}

function uploadFinish_(session, batchId, summary, warnings) {
  requireObject_(summary, 'Summary');
  var read = nonNegInt_(summary.rows_read, 'Rows read');
  var skipped = nonNegInt_(summary.rows_skipped, 'Rows skipped');
  if (!Array.isArray(warnings)) throw apiError_(ERR.BAD_REQUEST, 'Warnings must be a list.');
  if (warnings.length > UPLOAD_WARNING_MAX) throw apiError_(ERR.BAD_REQUEST, 'Too many warnings (limit ' + UPLOAD_WARNING_MAX + ').');
  return withLock_(function () {
    var batch = batchOrThrow_(batchId);
    if (batch.status === 'Completed') return batch; // finishing twice changes nothing
    if (batch.status !== 'Started') throw apiError_(ERR.CONFLICT, 'This upload cannot be finished.');
    var rows = warnings.map(function (w, i) { return cleanWarning_(w, batch.batch_id, i + 1, session.user.user_id); });
    var added = readColumn_(T.EVENTS, 'batch_id').filter(function (b) { return b === batch.batch_id; }).length;
    var identical = Math.max(0, Math.min(batch.rows_identical, read - added - skipped));
    appendRows_(T.WARNINGS, rows);
    updateRow_(T.BATCHES, batch._row, {
      rows_read: read, rows_added: added, rows_identical: identical, rows_skipped: skipped,
      warning_count: rows.length, status: 'Completed'
    });
    auditLog_(session.user.user_id, 'upload_finish', T.BATCHES, batch.batch_id,
      'Read ' + read + ', added ' + added + ', identical ' + identical + ', skipped ' + skipped + ', warnings ' + rows.length);
    return readRowAt_(T.BATCHES, batch._row);
  });
}

function getUploadHistory_() {
  return readTable_(T.BATCHES).sort(function (a, b) { return a.uploaded_at < b.uploaded_at ? 1 : (a.uploaded_at > b.uploaded_at ? -1 : 0); });
}

function getUploadWarnings_(batchId) {
  var id = cleanText_(batchId, 'Upload', true, 60);
  return readTable_(T.WARNINGS, function (row, idx) { return row[idx.batch_id] === id; });
}
