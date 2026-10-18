/**
 * Constants shared by every backend file. Table and column definitions live in
 * Schema.js (generated from schema/tables.json); nothing here may read SCHEMA
 * at load time, so file order does not matter.
 */

var APP_VERSION = '1.9.0';
var TIMEZONE = 'Africa/Cairo';

// Password hashing cost. Run benchmarkHashRounds() and, if it suggests a
// different number, set the Script Property HASH_ROUNDS.
var HASH_ROUNDS_DEFAULT = 2000;
var HASH_ROUNDS_MAX = 50000;

var LOCK_WAIT_MS = 30000;
var MIN_SECRET_LENGTH = 24;
var TEMP_PASSWORD_LENGTH = 14;

var UPLOAD_CHUNK_MAX_ROWS = 1000;
var UPLOAD_WARNING_MAX = 20000;
var FINGERPRINT_HINT_MAX = 20;
var TEXT_MAX = 1000;

var TAB_IDS = ['overview', 'pareto', 'repeats', 'reliability', 'reports', 'actions', 'events', 'upload', 'master', 'settings', 'users'];
var DASHBOARD_TABS = ['overview', 'pareto', 'repeats', 'reliability', 'reports', 'actions', 'events'];
var LEVELS = ['Hidden', 'View', 'Edit'];

var AREA_LEVEL_KEYS = ['N/A', 'NA'];
var PLACEHOLDER_CODES = ['AFR', 'AFR2'];

// Data-check flags (mirror of src/calc/flags.ts). A user may keep any of them as entered ("accept" them).
var BLOCKING_FLAG_NAMES = ['missing_classification', 'invalid_classification', 'unknown_area', 'end_before_start'];
var WARNING_FLAG_NAMES = ['missing_code', 'unknown_code', 'placeholder', 'unlisted_reason', 'blank_reason', 'line_mismatch'];
var INFO_FLAG_NAMES = ['code_not_in_area'];
/**
 * Worked out by the browser, never stored (src/calc/flags.ts DERIVED_FLAGS): overlap_in_area (information: overlapping
 * stops of one area are counted once) and failure_flag_mismatch (warning: Failure = YES on a PL / CIR or Freq = 0 row).
 */
var DERIVED_FLAG_NAMES = ['overlap_in_area', 'failure_flag_mismatch'];
var KNOWN_FLAG_NAMES = BLOCKING_FLAG_NAMES.concat(WARNING_FLAG_NAMES, INFO_FLAG_NAMES, DERIVED_FLAG_NAMES);
var ACCEPT_NOTE_MIN = 3;

var EDITABLE_EVENT_FIELDS = [
  'event_date', 'line_id', 'area_id', 'code_raw', 'stop_ts', 'start_ts',
  'freq', 'classification', 'criticality', 'is_failure', 'reason_raw', 'description'
];

var ERR = {
  BAD_REQUEST: 'bad_request',
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  LOCKED: 'locked',
  BAD_CREDENTIALS: 'bad_credentials',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  BUSY: 'busy',
  SERVER: 'server',
  TASKS_OPEN: 'tasks_open'
};

// Table (sheet) names. A test checks each one exists in the schema.
var T = {
  LINES: 'lines', AREAS: 'areas', EQUIPMENT: 'equipment', EQUIPMENT_AREAS: 'equipment_areas',
  ALIASES: 'equipment_aliases', CLASSIFICATIONS: 'classifications', REASONS: 'reasons',
  BATCHES: 'upload_batches', EVENTS: 'events', EDITS: 'event_edits', WARNINGS: 'upload_warnings',
  ROLES: 'roles', USERS: 'users', TAB_ACCESS: 'tab_access', SETTINGS: 'settings', AUDIT: 'audit_log',
  NOTIFICATIONS: 'notifications', NOTIFICATION_STATE: 'notification_state', NOTIFICATION_PREFS: 'notification_prefs',
  ACTIONS: 'actions', ACTION_LOG: 'action_log', CONTRACTORS: 'contractors', AREA_TARGETS: 'area_targets',
  USER_ACTIVITY: 'user_activity', ACTION_TASKS: 'action_tasks', TASK_TEMPLATES: 'task_templates', TASK_TEMPLATE_STEPS: 'task_template_steps'
};

// Script Property names.
var PROP = {
  SECRET: 'SESSION_SIGNING_SECRET',
  PEPPER: 'PASSWORD_PEPPER',
  SPREADSHEET: 'SPREADSHEET_ID',
  ROUNDS: 'HASH_ROUNDS',
  TASKS_MIGRATED: 'ACTIONS_TASKS_MIGRATED'
};
