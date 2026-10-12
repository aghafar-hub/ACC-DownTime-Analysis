/** Events: validation and derived fields (shared with Upload), reads, edit and void. */

/** Lookup tables used to validate and resolve events. Built once per request. */
function eventContext_() {
  var ctx = { areas: {}, areasLower: {}, equipment: {}, aliases: {}, reasons: {}, classes: {} };
  readTable_(T.AREAS).forEach(function (a) { ctx.areas[a.area_id] = a; ctx.areasLower[a.area_id.toLowerCase()] = a; });
  readColumn_(T.EQUIPMENT, 'equipment_id').forEach(function (id) { ctx.equipment[id] = true; });
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

/**
 * Validates a complete event and works out the derived fields.
 * Returns { error: 'plain English' } or { rec: {...} }.
 */
function normalizeEvent_(ctx, f) {
  if (!f || typeof f !== 'object') return { error: 'Row is not readable.' };
  var area = typeof f.area_id === 'string' ? (ctx.areas[f.area_id.trim()] || ctx.areasLower[f.area_id.trim().toLowerCase()]) : null;
  if (!area) return { error: 'Unknown area "' + String(f.area_id).slice(0, 40) + '".' };
  if (f.line_id !== area.line_id) return { error: 'Line "' + String(f.line_id).slice(0, 20) + '" does not match area ' + area.area_id + ' (' + area.line_id + ').' };
  if (!isValidDate_(f.event_date)) return { error: 'Unreadable date.' };
  var stop = normTs_(f.stop_ts), start = normTs_(f.start_ts);
  if (!stop) return { error: 'Unreadable stop time.' };
  if (!start) return { error: 'Unreadable start time.' };
  var cls = typeof f.classification === 'string' ? f.classification.trim().toUpperCase() : '';
  if (!ctx.classes[cls]) return { error: 'Classification "' + String(f.classification).slice(0, 20) + '" is not one of the allowed codes.' };
  var freq = (f.freq === 0 || f.freq === 1) ? f.freq : (f.freq === '0' ? 0 : (f.freq === '1' ? 1 : null));
  if (freq === null) return { error: 'Freq must be 0 or 1.' };
  if (f.criticality !== 'INC' && f.criticality !== 'NO_INC') return { error: 'Criticality must be INC or NO_INC.' };
  if (typeof f.is_failure !== 'boolean') return { error: 'Failure must be true or false.' };
  if (typeof f.code_raw !== 'string' || f.code_raw.length > 200) return { error: 'Equipment code is not readable.' };
  var reasonRaw = optionalText_(f.reason_raw, 'Reason');
  var description = optionalText_(f.description, 'Description');
  if (typeof reasonRaw === 'object') return reasonRaw;
  if (typeof description === 'object') return description;

  var key = codeKey_(f.code_raw);
  var areaLevel = AREA_LEVEL_KEYS.indexOf(key) >= 0;
  var resolved = Object.prototype.hasOwnProperty.call(ctx.aliases, key) ? ctx.aliases[key] : key;
  var equipmentId = !areaLevel && ctx.equipment[resolved] ? resolved : '';
  var reasonId = '';
  var flags = [];
  if (!areaLevel && !equipmentId) flags.push('unknown_code');
  if (PLACEHOLDER_CODES.indexOf(key) >= 0) flags.push('placeholder');
  if (!reasonRaw) flags.push('blank_reason');
  else {
    reasonId = ctx.reasons[cls + '|' + matchKey_(reasonRaw)] || '';
    if (!reasonId) flags.push('unlisted_reason');
  }
  var duration = (parseTs_(start) - parseTs_(stop)) / 1000;
  if (duration < 0) flags.push('end_before_start');
  return {
    rec: {
      event_date: f.event_date, line_id: area.line_id, area_id: area.area_id, code_raw: f.code_raw.trim(),
      stop_ts: stop, start_ts: start, freq: freq, classification: cls, criticality: f.criticality,
      is_failure: f.is_failure, reason_raw: reasonRaw, description: description,
      equipment_id: equipmentId, is_area_level: areaLevel, duration_s: duration, reason_id: reasonId,
      flags: flags.join(','), code_key: key
    }
  };
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
    if ('area_id' in changes && !('line_id' in changes)) {
      var a = typeof changes.area_id === 'string' ? (ctx.areas[changes.area_id.trim()] || ctx.areasLower[changes.area_id.trim().toLowerCase()]) : null;
      if (a) cand.line_id = a.line_id;
    }
    var norm = normalizeEvent_(ctx, cand);
    if (norm.error) throw apiError_(ERR.BAD_REQUEST, norm.error);
    var rec = norm.rec;
    if ('classification' in changes && !('criticality' in changes) && rec.classification !== ev.classification) {
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
