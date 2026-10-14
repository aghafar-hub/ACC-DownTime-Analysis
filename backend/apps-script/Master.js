/** Master data: startup read, and audited saves for equipment, areas, reasons and aliases. */

/** Everything the dashboards need except events. Never includes users or the audit log. */
function getStartup_() {
  var years = {};
  readColumn_(T.EVENTS, 'event_date').forEach(function (d) {
    if (/^\d{4}/.test(d)) years[d.slice(0, 4)] = true;
  });
  return {
    lines: readTable_(T.LINES), areas: readTable_(T.AREAS), equipment: readTable_(T.EQUIPMENT),
    equipment_areas: readTable_(T.EQUIPMENT_AREAS), aliases: readTable_(T.ALIASES),
    classifications: readTable_(T.CLASSIFICATIONS), reasons: readTable_(T.REASONS),
    settings: readSettings_(),
    years: Object.keys(years).map(Number).sort(function (a, b) { return b - a; })
  };
}

function actor_(session) { return session.user.user_id; }

// ---------- equipment ----------

function equipmentReviewNote_(row, areaCount) {
  var missing = [];
  if (!row.description) missing.push('description');
  if (!row.criticality) missing.push('criticality');
  if (!areaCount) missing.push('area');
  return missing;
}

function saveEquipment_(session, row, areaIds) {
  requireObject_(row, 'Equipment');
  var id = codeKey_(cleanText_(row.equipment_id, 'Equipment code', true, 60));
  if (!Array.isArray(areaIds)) throw apiError_(ERR.BAD_REQUEST, 'Areas must be a list.');
  var wanted = [];
  areaIds.forEach(function (a) {
    var s = cleanText_(a, 'Area', true, 60);
    if (wanted.indexOf(s) < 0) wanted.push(s);
  });
  var status = row.status === 'Retired' ? 'Retired' : (row.status === 'Active' || !row.status ? 'Active' : null);
  if (!status) throw apiError_(ERR.BAD_REQUEST, 'Status must be Active or Retired.');
  var parent = row.parent_id ? codeKey_(cleanText_(row.parent_id, 'Parent code', false, 60)) : '';
  if (parent === id) throw apiError_(ERR.BAD_REQUEST, 'Equipment cannot be its own parent.');
  var rec = {
    equipment_id: id,
    description: cleanText_(row.description, 'Description', false),
    equipment_type: cleanText_(row.equipment_type, 'Type', false, 100),
    criticality: cleanText_(row.criticality, 'Criticality', false, 100),
    parent_id: parent, status: status,
    origin: cleanText_(row.origin, 'Origin', false, 100),
    platform_plant_area: cleanText_(row.platform_plant_area, 'Plant area', false, 100),
    platform_main_area: cleanText_(row.platform_main_area, 'Main area', false, 100),
    platform_sub_area: cleanText_(row.platform_sub_area, 'Sub area', false, 100),
    updated_at: nowTs_(), updated_by: actor_(session)
  };
  var missing = equipmentReviewNote_(rec, wanted.length);
  rec.needs_review = missing.length > 0;
  var note = cleanText_(row.review_note, 'Review note', false);
  if (rec.needs_review) rec.review_note = note || 'Missing: ' + missing.join(', ');
  else rec.review_note = /^Missing:/.test(note) ? '' : note;
  withLock_(function () {
    var areaSet = {};
    readTable_(T.AREAS).forEach(function (a) { areaSet[a.area_id] = true; });
    wanted.forEach(function (a) { if (!areaSet[a]) throw apiError_(ERR.BAD_REQUEST, 'Unknown area: ' + a + '.'); });
    var existing = findBy_(T.EQUIPMENT, 'equipment_id', id);
    if (!rec.origin) rec.origin = existing ? existing.origin : 'User';
    if (existing) updateRow_(T.EQUIPMENT, existing._row, rec);
    else { rec.created_at = nowTs_(); appendRow_(T.EQUIPMENT, rec); }
    var links = readTable_(T.EQUIPMENT_AREAS).filter(function (l) { return l.equipment_id === id; });
    var have = links.map(function (l) { return l.area_id; });
    deleteRows_(T.EQUIPMENT_AREAS, links.filter(function (l) { return wanted.indexOf(l.area_id) < 0; }).map(function (l) { return l._row; }));
    appendRows_(T.EQUIPMENT_AREAS, wanted.filter(function (a) { return have.indexOf(a) < 0; })
      .map(function (a) { return { equipment_id: id, area_id: a }; }));
    auditLog_(actor_(session), existing ? 'update_equipment' : 'add_equipment', T.EQUIPMENT, id, 'Areas: ' + (wanted.join(', ') || '(none)'));
  });
  return null;
}

// ---------- areas ----------

function saveArea_(session, row) {
  requireObject_(row, 'Area');
  var rec = {
    area_id: cleanText_(row.area_id, 'Area code', true, 60),
    name: cleanText_(row.name, 'Name', true, 100),
    line_id: cleanText_(row.line_id, 'Line', true, 20),
    sort_order: toIntOr_(row.sort_order, 0),
    active: toBool_(row.active),
    in_downtime_sheet: toBool_(row.in_downtime_sheet),
    notes: cleanText_(row.notes, 'Notes', false)
  };
  withLock_(function () {
    if (!findBy_(T.LINES, 'line_id', rec.line_id)) throw apiError_(ERR.BAD_REQUEST, 'Unknown line: ' + rec.line_id + '.');
    // 1.5.0: switching an area on or off hides or shows all its records plant-wide, so only an Admin may change it
    var before = findBy_(T.AREAS, 'area_id', rec.area_id);
    var wasActive = before ? toBool_(before.active) : true;
    if (rec.active !== wasActive && !isAdmin_(session)) {
      throw apiError_(ERR.FORBIDDEN, 'Only an Admin can switch an area on or off (Settings > Areas).');
    }
    var how = upsertBy_(T.AREAS, 'area_id', rec);
    auditLog_(actor_(session), how === 'added' ? 'add_area' : 'update_area', T.AREAS, rec.area_id, rec.name + ' on ' + rec.line_id);
  });
  return null;
}

function isAdmin_(session) { return !!session && session.user.role_id === 'ROLE-ADMIN'; }

/**
 * 1.5.0: switches one area on or off (Admin only, audited). An inactive area (active = FALSE) and every record of it are
 * left out of every page, number and rule as if they did not exist; the records stay stored and come back when the
 * area is switched on again. Returns the area as stored.
 */
function setAreaActive_(session, areaId, active) {
  if (!isAdmin_(session)) throw apiError_(ERR.FORBIDDEN, 'Only an Admin can switch an area on or off.'); // also in ACTION_RULES
  var id = cleanText_(areaId, 'Area code', true, 60);
  if (typeof active !== 'boolean') throw apiError_(ERR.BAD_REQUEST, 'Active must be true or false.');
  return withLock_(function () {
    var row = findBy_(T.AREAS, 'area_id', id);
    if (!row) throw apiError_(ERR.NOT_FOUND, 'Unknown area: ' + oneLine_(id, 60) + '.');
    if (toBool_(row.active) !== active) {
      updateRow_(T.AREAS, row._row, { active: active });
      auditLog_(actor_(session), active ? 'activate_area' : 'deactivate_area', T.AREAS, id,
        (active ? 'Area switched on: ' : 'Area switched off: ') + row.name + ' on ' + row.line_id);
    }
    return findBy_(T.AREAS, 'area_id', id);
  });
}

/** Ids of the areas switched off (active = FALSE). Every rule leaves their records out (1.5.0). */
function inactiveAreaIds_() {
  var out = {};
  readTable_(T.AREAS).forEach(function (a) { if (!toBool_(a.active)) out[a.area_id] = true; });
  return out;
}

// ---------- reasons ----------

function saveReason_(session, row) {
  requireObject_(row, 'Reason');
  var cls = cleanText_(row.classification, 'Classification', true, 10).toUpperCase();
  if (typeof row.text_as_listed !== 'string' || !row.text_as_listed.trim()) throw apiError_(ERR.BAD_REQUEST, 'Reason text is required.');
  if (row.text_as_listed.length > TEXT_MAX) throw apiError_(ERR.BAD_REQUEST, 'Reason text is too long.');
  withLock_(function () {
    if (!findBy_(T.CLASSIFICATIONS, 'code', cls)) throw apiError_(ERR.BAD_REQUEST, 'Unknown classification: ' + cls + '.');
    var all = readTable_(T.REASONS);
    var id = typeof row.reason_id === 'string' ? row.reason_id.trim() : '';
    var existing = id ? all.filter(function (r) { return r.reason_id === id; })[0] : null;
    var order = toIntOr_(row.order_no, 0);
    if (existing && order < 1) order = existing.order_no;
    if (!existing && order < 1) {
      order = 1 + all.filter(function (r) { return r.classification === cls; })
        .reduce(function (m, r) { return Math.max(m, r.order_no || 0); }, 0);
    }
    if (!id) {
      id = 'R-' + cls + '-' + ('000' + order).slice(-3);
      while (all.some(function (r) { return r.reason_id === id; })) { order++; id = 'R-' + cls + '-' + ('000' + order).slice(-3); }
    }
    var rec = {
      reason_id: id, classification: cls, text_as_listed: row.text_as_listed, match_key: matchKey_(row.text_as_listed),
      order_no: order, active: row.active === undefined ? true : toBool_(row.active)
    };
    var how = upsertBy_(T.REASONS, 'reason_id', rec);
    auditLog_(actor_(session), how === 'added' ? 'add_reason' : 'update_reason', T.REASONS, id, cls + ': ' + rec.match_key);
  });
  return null;
}

// ---------- aliases ----------

function saveAlias_(session, row) {
  requireObject_(row, 'Alias');
  var alias = codeKey_(cleanText_(row.alias, 'Alias', true, 60));
  var target = codeKey_(cleanText_(row.equipment_id, 'Equipment code', true, 60));
  if (alias === target) throw apiError_(ERR.BAD_REQUEST, 'The alias must differ from the code it points to.');
  var rec = { alias: alias, equipment_id: target, reason: cleanText_(row.reason, 'Reason', false) };
  withLock_(function () {
    if (!findBy_(T.EQUIPMENT, 'equipment_id', target)) throw apiError_(ERR.BAD_REQUEST, 'Unknown equipment code: ' + target + '.');
    var how = upsertBy_(T.ALIASES, 'alias', rec);
    auditLog_(actor_(session), how === 'added' ? 'add_alias' : 'update_alias', T.ALIASES, alias, 'Points to ' + target);
  });
  return null;
}

function deleteAlias_(session, alias) {
  var key = codeKey_(cleanText_(alias, 'Alias', true, 60));
  withLock_(function () {
    var existing = findBy_(T.ALIASES, 'alias', key);
    if (!existing) throw apiError_(ERR.NOT_FOUND, 'Alias not found.');
    deleteRows_(T.ALIASES, [existing._row]);
    auditLog_(actor_(session), 'delete_alias', T.ALIASES, key, 'Was pointing to ' + existing.equipment_id);
  });
  return null;
}
