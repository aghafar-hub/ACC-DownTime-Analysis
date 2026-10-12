/** Events: validation and derived fields (shared with Upload), reads, edit and void. */

/** Lookup tables used to validate and resolve events. Built once per request. */
function eventContext_() {
  var ctx = { areas: {}, areasLower: {}, lines: {}, equipment: {}, equipmentAreas: {}, aliases: {}, reasons: {}, classes: {} };
  readTable_(T.AREAS).forEach(function (a) { ctx.areas[a.area_id] = a; ctx.areasLower[a.area_id.toLowerCase()] = a; });
  readTable_(T.LINES).forEach(function (l) { ctx.lines[l.line_id] = l; });
  readColumn_(T.EQUIPMENT, 'equipment_id').forEach(function (id) { ctx.equipment[id] = true; });
  readTable_(T.EQUIPMENT_AREAS).forEach(function (l) {
    (ctx.equipmentAreas[l.equipment_id] = ctx.equipmentAreas[l.equipment_id] || {})[l.area_id] = true;
  });
  readTable_(T.ALIASES).forEach(function (a) { ctx.aliases[a.alias] = a.equipment_id; });
  readTable_(T.CLASSIFICATIONS).forEach(function (c) { ctx.classes[c.code] = c; });
  readTable_(T.REASONS).slice().sort(function (a, b) { return (a.order_no || 0) - (b.order_no || 0); }).forEach(function (r) {
    var k = r.classification + '|' + r.match_key;
    if (!ctx.reasons[k]) ctx.reasons[k] = r.reason_id;
  });
  return ctx;
}

function optionalText_(v, label) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') return { error: label + ' must be text.' };
  if (v.length > TEXT_MAX) return { error: label + ' is too long.' };
  return v.trim();
}

function findArea_(ctx, id) {
  if (typeof id !== 'string') return null;
  var t = id.trim();
  return ctx.areas[t] || ctx.areasLower[t.toLowerCase()] || null;
}

/**
 * Data checks (docs/wire-protocol.md section 4a). The blocking flags come first: a record that carries
 * one is kept out of every calculation until it is fixed. Order is fixed so client and server agree.
 * `r` holds: area (the master row or null), line_id, classification (upper case), reason_raw, code_key,
 * equipment_id, is_area_level, duration_s.
 */
function computeFlags_(ctx, r) {
  var flags = [];
  var cls = r.classification;
  if (!cls) flags.push('missing_classification');
  else if (!ctx.classes[cls]) flags.push('invalid_classification');
  if (!r.area) flags.push('unknown_area');
  if (r.duration_s < 0) flags.push('end_before_start');
  if (!r.code_key) flags.push('missing_code');
  else if (!r.is_area_level && !r.equipment_id) flags.push('unknown_code');
  if (PLACEHOLDER_CODES.indexOf(r.code_key) >= 0) flags.push('placeholder');
  if (!r.reason_raw) flags.push('blank_reason');
  else if (ctx.classes[cls] && !ctx.reasons[cls + '|' + matchKey_(r.reason_raw)]) flags.push('unlisted_reason');
  if (r.area && r.equipment_id) {
    var inAreas = ctx.equipmentAreas[r.equipment_id];
    if (inAreas && Object.keys(inAreas).length && !inAreas[r.area.area_id]) flags.push('code_not_in_area');
  }
  if (r.area && r.line_id !== r.area.line_id) flags.push('line_mismatch');
  return flags;
}

/**
 * Validates what must be readable to store a row at all (dates, times, freq, criticality, failure)
 * and works out the derived fields and flags. Everything else (area, line, code, classification,
 * reason) is stored as given and flagged: import never drops a row.
 * Returns { error: 'plain English' } or { rec: {...} }.
 */
function normalizeEvent_(ctx, f) {
  if (!f || typeof f !== 'object') return { error: 'Row is not readable.' };
  if (!isValidDate_(f.event_date)) return { error: 'Unreadable date.' };
  var stop = normTs_(f.stop_ts), start = normTs_(f.start_ts);
  if (!stop) return { error: 'Unreadable stop time.' };
  if (!start) return { error: 'Unreadable start time.' };
  var freq = (f.freq === 0 || f.freq === 1) ? f.freq : (f.freq === '0' ? 0 : (f.freq === '1' ? 1 : null));
  if (freq === null) return { error: 'Freq must be 0 or 1.' };
  if (f.criticality !== 'INC' && f.criticality !== 'NO_INC') return { error: 'Criticality must be INC or NO_INC.' };
  if (typeof f.is_failure !== 'boolean') return { error: 'Failure must be true or false.' };
  var codeRaw = f.code_raw === null || f.code_raw === undefined ? '' : f.code_raw;
  if (typeof codeRaw !== 'string' || codeRaw.length > 200) return { error: 'Equipment code is not readable.' };
  var texts = {};
  var bad = null;
  [['area_id', 'Area', 40], ['line_id', 'Line', 20], ['classification', 'Classification', 20]].forEach(function (c) {
    var v = f[c[0]] === null || f[c[0]] === undefined ? '' : f[c[0]];
    if (typeof v !== 'string' || v.length > c[2]) bad = bad || { error: c[1] + ' is not readable.' };
    texts[c[0]] = typeof v === 'string' ? v.trim() : '';
  });
  if (bad) return bad;
  var reasonRaw = optionalText_(f.reason_raw, 'Reason');
  var description = optionalText_(f.description, 'Description');
  if (typeof reasonRaw === 'object') return reasonRaw;
  if (typeof description === 'object') return description;

  var area = findArea_(ctx, texts.area_id);
  var cls = texts.classification.toUpperCase();
  var key = codeKey_(codeRaw);
  var areaLevel = AREA_LEVEL_KEYS.indexOf(key) >= 0;
  var resolved = Object.prototype.hasOwnProperty.call(ctx.aliases, key) ? ctx.aliases[key] : key;
  var equipmentId = key && !areaLevel && ctx.equipment[resolved] ? resolved : '';
  var reasonId = reasonRaw && ctx.classes[cls] ? (ctx.reasons[cls + '|' + matchKey_(reasonRaw)] || '') : '';
  var duration = (parseTs_(start) - parseTs_(stop)) / 1000;
  var rec = {
    event_date: f.event_date, line_id: texts.line_id, area_id: area ? area.area_id : texts.area_id, code_raw: codeRaw.trim(),
    stop_ts: stop, start_ts: start, freq: freq, classification: cls, criticality: f.criticality,
    is_failure: f.is_failure, reason_raw: reasonRaw, description: description,
    equipment_id: equipmentId, is_area_level: areaLevel, duration_s: duration, reason_id: reasonId, code_key: key
  };
  rec.flags = computeFlags_(ctx, {
    area: area, line_id: rec.line_id, classification: cls, reason_raw: reasonRaw, code_key: key,
    equipment_id: equipmentId, is_area_level: areaLevel, duration_s: duration
  }).join(',');
  return { rec: rec };
}

// ---------- reads ----------

function getEvents_(year) {
  var y = Number(year);
  if (!isFinite(y) || Math.floor(y) !== y || y < 1990 || y > 2200) throw apiError_(ERR.BAD_REQUEST, 'Year is not valid.');
  var prefix = y + '-';
  return readTable_(T.EVENTS, function (row, idx) {
    var d = row[idx.event_date];
    return typeof d === 'string' ? d.indexOf(prefix) === 0 : isDate_(d) && d.getUTCFullYear() === y;
  });
}

function getEventEdits_(eventId) {
  var id = cleanText_(eventId, 'Event', true, 60);
  return readTable_(T.EDITS, function (row, idx) { return row[idx.event_id] === id; })
    .sort(function (a, b) { return a.edited_at < b.edited_at ? -1 : (a.edited_at > b.edited_at ? 1 : 0); });
}

// ---------- edit and void ----------

function editText_(v) {
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  return v === null || v === undefined ? '' : String(v);
}

function eventOrThrow_(eventId) {
  var id = typeof eventId === 'string' ? eventId.trim() : '';
  var ev = id ? findBy_(T.EVENTS, 'event_id', id) : null;
  if (!ev) throw apiError_(ERR.NOT_FOUND, 'Event not found.');
  return ev;
}

function editRows_(session, ev, pairs, note) {
  var at = nowTs_();
  var stamp = compactTs_('yyyyMMddHHmmssSSS');
  return pairs.map(function (p, i) {
    return {
      edit_id: 'ED-' + stamp + '-' + (i + 1), event_id: ev.event_id, edited_at: at, edited_by: session.user.user_id,
      field: p.field, old_value: editText_(p.oldValue), new_value: editText_(p.newValue), note: note
    };
  });
}

function editEvent_(session, eventId, changes, note) {
  var why = cleanText_(note, 'A note explaining the change', true, 500);
  requireObject_(changes, 'Changes');
  var fields = Object.keys(changes);
  if (!fields.length) throw apiError_(ERR.BAD_REQUEST, 'No changes to save.');
  fields.forEach(function (f) {
    if (EDITABLE_EVENT_FIELDS.indexOf(f) < 0) throw apiError_(ERR.BAD_REQUEST, 'The field "' + f + '" cannot be edited.');
  });
  return withLock_(function () {
    var ev = eventOrThrow_(eventId);
    if (ev.is_void) throw apiError_(ERR.CONFLICT, 'This event is void. Restore it before editing.');
    var cand = {};
    EDITABLE_EVENT_FIELDS.forEach(function (f) { cand[f] = ev[f]; });
    fields.forEach(function (f) { cand[f] = changes[f]; });
    var ctx = eventContext_();
    if ('classification' in changes) {
      var c = typeof changes.classification === 'string' ? changes.classification.trim().toUpperCase() : '';
      if (!ctx.classes[c]) throw apiError_(ERR.BAD_REQUEST, 'Classification must be one of ' + Object.keys(ctx.classes).join(', ') + '.');
      cand.classification = c;
    }
    if ('area_id' in changes) {
      var a = findArea_(ctx, changes.area_id);
      if (!a) throw apiError_(ERR.BAD_REQUEST, 'Area "' + String(changes.area_id).slice(0, 40) + '" is not in the list of areas.');
      cand.area_id = a.area_id;
      if (!('line_id' in changes)) cand.line_id = a.line_id;
    }
    if ('line_id' in changes) {
      var ln = typeof changes.line_id === 'string' ? changes.line_id.trim() : '';
      if (!ctx.lines[ln]) throw apiError_(ERR.BAD_REQUEST, 'Line "' + String(changes.line_id).slice(0, 20) + '" is not in the list of lines.');
      cand.line_id = ln;
    }
    var norm = normalizeEvent_(ctx, cand);
    if (norm.error) throw apiError_(ERR.BAD_REQUEST, norm.error);
    var rec = norm.rec;
    // Criticality follows a changed classification, unless the old one was blank or unknown (then the sheet's value stays).
    if ('classification' in changes && !('criticality' in changes) && ctx.classes[ev.classification] && rec.classification !== ev.classification) {
      rec.criticality = ctx.classes[rec.classification].is_incident ? 'INC' : 'NO_INC';
    }
    if (!('is_failure' in changes) && (rec.criticality !== ev.criticality || rec.freq !== ev.freq)) {
      rec.is_failure = rec.criticality === 'INC' && rec.freq === 1;
    }
    var pairs = [];
    EDITABLE_EVENT_FIELDS.forEach(function (f) {
      if (editText_(rec[f]) !== editText_(ev[f])) pairs.push({ field: f, oldValue: ev[f], newValue: rec[f] });
    });
    if (!pairs.length) throw apiError_(ERR.BAD_REQUEST, 'Nothing was changed.');
    var patch = {
      event_date: rec.event_date, line_id: rec.line_id, area_id: rec.area_id, code_raw: rec.code_raw,
      stop_ts: rec.stop_ts, start_ts: rec.start_ts, freq: rec.freq, classification: rec.classification,
      criticality: rec.criticality, is_failure: rec.is_failure, reason_raw: rec.reason_raw, description: rec.description,
      equipment_id: rec.equipment_id, is_area_level: rec.is_area_level, duration_s: rec.duration_s,
      reason_id: rec.reason_id, flags: rec.flags, edited: true
    };
    updateRow_(T.EVENTS, ev._row, patch);
    appendRows_(T.EDITS, editRows_(session, ev, pairs, why));
    auditLog_(session.user.user_id, 'edit_event', T.EVENTS, ev.event_id,
      'Changed ' + pairs.map(function (p) { return p.field; }).join(', ') + '. Note: ' + why);
    return readRowAt_(T.EVENTS, ev._row);
  });
}

function voidEvent_(session, eventId, isVoid, note) {
  var why = cleanText_(note, 'A note explaining the change', true, 500);
  if (typeof isVoid !== 'boolean') throw apiError_(ERR.BAD_REQUEST, 'isVoid must be true or false.');
  return withLock_(function () {
    var ev = eventOrThrow_(eventId);
    if (ev.is_void === isVoid) return ev;
    updateRow_(T.EVENTS, ev._row, { is_void: isVoid });
    appendRows_(T.EDITS, editRows_(session, ev, [{ field: 'is_void', oldValue: ev.is_void, newValue: isVoid }], why));
    auditLog_(session.user.user_id, isVoid ? 'void_event' : 'unvoid_event', T.EVENTS, ev.event_id, 'Note: ' + why);
    return readRowAt_(T.EVENTS, ev._row);
  });
}

// ---------- revalidate ----------

/**
 * Re-runs the data checks of every non-void event (one year, or all) against the current Master Data.
 * Rows whose flags or derived fields (resolved equipment, reason, area-level, duration) changed are
 * written back in batches; nothing else is touched. Returns { checked, changed }.
 */
function revalidateEvents_(session, year) {
  var y = null;
  if (year !== undefined && year !== null) {
    y = Number(year);
    if (!isFinite(y) || Math.floor(y) !== y || y < 1990 || y > 2200) throw apiError_(ERR.BAD_REQUEST, 'Year is not valid.');
  }
  return withLock_(function () {
    var ctx = eventContext_();
    var sheet = getSheet_(T.EVENTS);
    var headers = sheetHeaders_(sheet);
    var last = sheet.getLastRow();
    var checked = 0, changedRows = [];
    if (last >= 2) {
      var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
      var types = columnTypes_(T.EVENTS);
      for (var i = 0; i < values.length; i++) {
        var ev = rowToObject_(types, headers, values[i], i + 2);
        if (ev.is_void) continue;
        if (y !== null && String(ev.event_date).slice(0, 4) !== String(y)) continue;
        checked++;
        var norm = normalizeEvent_(ctx, ev);
        if (norm.error) continue;
        var rec = norm.rec;
        if (rec.flags === (ev.flags || '') && rec.equipment_id === (ev.equipment_id || '') && rec.reason_id === (ev.reason_id || '') &&
            rec.is_area_level === ev.is_area_level && rec.duration_s === ev.duration_s) continue;
        changedRows.push({
          rowNum: i + 2,
          values: objectToRow_(T.EVENTS, headers, {
            flags: rec.flags, equipment_id: rec.equipment_id, reason_id: rec.reason_id,
            is_area_level: rec.is_area_level, duration_s: rec.duration_s
          }, values[i])
        });
      }
    }
    writeRowRuns_(sheet, headers.length, changedRows);
    auditLog_(session.user.user_id, 'revalidate_events', T.EVENTS, y === null ? 'all' : String(y),
      'Checked ' + checked + ', changed ' + changedRows.length);
    return { checked: checked, changed: changedRows.length };
  });
}

/** Writes full rows (rowNum ascending) with as few setValues calls as sensible: consecutive rows go together. */
function writeRowRuns_(sheet, width, rows) {
  if (!rows.length) return;
  var runs = [];
  rows.forEach(function (r) {
    var run = runs[runs.length - 1];
    if (run && r.rowNum === run.start + run.rows.length) run.rows.push(r.values);
    else runs.push({ start: r.rowNum, rows: [r.values] });
  });
  if (runs.length > 20) {
    // Too many separate pieces: rewrite the span from the first to the last changed row once.
    var first = rows[0].rowNum, lastRow = rows[rows.length - 1].rowNum;
    var span = sheet.getRange(first, 1, lastRow - first + 1, width).getValues();
    rows.forEach(function (r) { span[r.rowNum - first] = r.values; });
    sheet.getRange(first, 1, span.length, width).setValues(span);
    return;
  }
  runs.forEach(function (run) { sheet.getRange(run.start, 1, run.rows.length, width).setValues(run.rows); });
}
