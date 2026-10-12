/**
 * Web app entry points. Every POST is: parse -> find the action -> session check
 * -> access check -> handler -> uniform envelope. Errors never carry stack traces.
 */

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'ping') return jsonOut_(okEnvelope_({ version: APP_VERSION }));
  return jsonOut_(errorEnvelope_(ERR.BAD_REQUEST, 'Unknown request.'));
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e && e.postData && e.postData.contents);
  } catch (err) {
    return jsonOut_(errorEnvelope_(ERR.BAD_REQUEST, 'The request could not be read.'));
  }
  return jsonOut_(handleRequest_(body));
}

// Handlers get (session, params). `params` keys are the TypeScript parameter names.
var HANDLERS = {
  login: function (s, p) { return login_(p.email, p.password, p.keepSignedIn === true); },
  changePassword: function (s, p) { return changePassword_(s, p.current, p.next); },
  getMyAccess: function (s) { return getMyAccess_(s); },
  getStartup: function () { return getStartup_(); },
  getEvents: function (s, p) { return getEvents_(p.year); },
  getEventEdits: function (s, p) { return getEventEdits_(p.eventId); },
  getUploadHistory: function () { return getUploadHistory_(); },
  getUploadWarnings: function (s, p) { return getUploadWarnings_(p.batchId); },
  uploadStart: function (s, p) { return uploadStart_(s, p.fileName, p.fileHash); },
  uploadChunk: function (s, p) { return uploadChunk_(s, p.batchId, p.rows); },
  uploadFinish: function (s, p) { return uploadFinish_(s, p.batchId, p.summary, p.warnings); },
  revalidateEvents: function (s, p) { return revalidateEvents_(s, p.year); },
  editEvent: function (s, p) { return editEvent_(s, p.eventId, p.changes, p.note); },
  voidEvent: function (s, p) { return voidEvent_(s, p.eventId, p.isVoid, p.note); },
  saveEquipment: function (s, p) { return saveEquipment_(s, p.row, p.areaIds); },
  saveArea: function (s, p) { return saveArea_(s, p.row); },
  saveReason: function (s, p) { return saveReason_(s, p.row); },
  saveAlias: function (s, p) { return saveAlias_(s, p.row); },
  deleteAlias: function (s, p) { return deleteAlias_(s, p.alias); },
  saveSettings: function (s, p) { return saveSettings_(s, p.changes); },
  listUsers: function () { return listUsers_(); },
  createUser: function (s, p) { return createUser_(s, p.u); },
  updateUser: function (s, p) { return updateUser_(s, p.userId, p.changes); },
  resetPassword: function (s, p) { return resetPassword_(s, p.userId); },
  setUserTabAccess: function (s, p) { return setUserTabAccess_(s, p.userId, p.overrides); }
};

/** Runs one request and returns the response envelope (an object, never throws). */
function handleRequest_(body) {
  try {
    if (!body || typeof body !== 'object' || typeof body.action !== 'string') {
      throw apiError_(ERR.BAD_REQUEST, 'The request could not be read.');
    }
    var action = body.action;
    var rule = Object.prototype.hasOwnProperty.call(ACTION_RULES, action) ? ACTION_RULES[action] : null;
    if (!rule || !HANDLERS[action]) throw apiError_(ERR.BAD_REQUEST, 'Unknown action.');
    var params = body.params === undefined || body.params === null ? {} : body.params;
    requireObject_(params, 'Parameters');
    var session = null;
    if (rule.auth !== 'none') {
      session = requireSession_(body.token);
      if (session.user.must_change && !rule.mustChangeOk) {
        throw apiError_(ERR.FORBIDDEN, 'You must change your temporary password first.');
      }
      requireAccess_(action, session.access);
    }
    return okEnvelope_(HANDLERS[action](session, params));
  } catch (err) {
    if (err && err.isApiError) return errorEnvelope_(err.code, err.message);
    console.error('Unexpected error: ' + (err && err.stack ? err.stack : err));
    return errorEnvelope_(ERR.SERVER, 'Something went wrong on the server. Please try again.');
  }
}
