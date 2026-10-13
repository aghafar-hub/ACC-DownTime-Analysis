/**
 * API contract between the app and any backend (Apps Script now, a real
 * database later). Row types mirror schema/tables.json exactly.
 *
 * Conventions
 * - Timestamps: 'YYYY-MM-DD HH:MM:SS.mmm' plant-local text. Dates: 'YYYY-MM-DD'.
 * - Fingerprint = lower-case hex SHA-256 of
 *   `${area_id}|${code_key}|${stop_ts}|${start_ts}|${occurrence}`
 *   where code_key is the code upper-cased with spaces removed and runs of dots
 *   collapsed, and occurrence is 1 for the first row with that key in a file,
 *   2 for the second, and so on. event_id = 'EV-' + first 16 hex characters.
 * - The server never trusts the client: it re-validates every write.
 */

export type TabId =
  | 'overview' | 'pareto' | 'repeats' | 'reliability' | 'reports' | 'events'
  | 'upload' | 'master' | 'settings' | 'users';
export const TAB_IDS: TabId[] = [
  'overview', 'pareto', 'repeats', 'reliability', 'reports', 'events', 'upload', 'master', 'settings', 'users',
];
export type AccessLevel = 'Hidden' | 'View' | 'Edit';
export type Access = Record<TabId, AccessLevel>;

export type ClassificationCode = 'PRO' | 'MEC' | 'ELE' | 'AUT' | 'PL' | 'CIR';
export type Criticality = 'INC' | 'NO_INC';

export interface Line { line_id: string; name: string; sort_order: number; active: boolean }
export interface Area {
  area_id: string; name: string; line_id: string; sort_order: number;
  active: boolean; in_downtime_sheet: boolean; notes?: string;
}
export interface Equipment {
  equipment_id: string; description?: string; equipment_type?: string; criticality?: string;
  parent_id?: string; status: 'Active' | 'Retired'; origin?: string;
  platform_plant_area?: string; platform_main_area?: string; platform_sub_area?: string;
  needs_review: boolean; review_note?: string;
  created_at?: string; updated_at?: string; updated_by?: string;
}
export interface EquipmentArea { equipment_id: string; area_id: string }
export interface EquipmentAlias { alias: string; equipment_id: string; reason?: string }
export interface Classification { code: ClassificationCode; name: string; is_incident: boolean; sort_order: number }
export interface Reason {
  reason_id: string; classification: ClassificationCode; text_as_listed: string;
  match_key: string; order_no: number; active: boolean;
}
export interface Setting { key: string; value: string; description?: string; updated_by?: string; updated_at?: string }

export interface EventRow {
  event_id: string; batch_id: string; event_date: string; line_id: string; area_id: string;
  code_raw: string; equipment_id?: string; is_area_level: boolean;
  stop_ts: string; start_ts: string; duration_s: number; freq: 0 | 1;
  classification: ClassificationCode; criticality: Criticality; is_failure: boolean;
  reason_raw?: string; reason_id?: string; description?: string;
  source_file?: string; source_row?: number; fingerprint: string; flags?: string;
  edited: boolean; is_void: boolean; created_at: string;
  /** flags the user chose to keep as entered (comma separated, Validate > Keep as entered); absent or blank when none */
  accepted_flags?: string;
  /** user_id of the last person who changed accepted_flags */
  accepted_by?: string;
  /** when accepted_flags was last changed ('YYYY-MM-DD HH:MM:SS.mmm') */
  accepted_at?: string;
}

/** Fields an authorised user may correct on a stored event. */
export type EditableEventField =
  | 'event_date' | 'line_id' | 'area_id' | 'code_raw' | 'stop_ts' | 'start_ts'
  | 'freq' | 'classification' | 'criticality' | 'is_failure'
  | 'reason_raw' | 'description';
export type EventChanges = Partial<Pick<EventRow, EditableEventField>>;

export interface EventEdit {
  edit_id: string; event_id: string; edited_at: string; edited_by: string;
  field: string; old_value?: string; new_value?: string; note?: string;
}

export type WarningType =
  | 'late_row' | 'changed_row' | 'missing_row' | 'unknown_code' | 'code_not_in_area'
  | 'unlisted_reason' | 'blank_reason' | 'end_before_start' | 'duration_mismatch'
  | 'orphan_continuation' | 'overlap_in_area' | 'placeholder_code' | 'edited_in_app'
  | 'missing_code' | 'missing_classification' | 'invalid_classification' | 'unknown_area' | 'line_mismatch'
  | 'late_month';
export type WarningResolution = 'added' | 'skipped' | 'kept_stored' | 'accepted';

export interface UploadWarning {
  warning_id: string; batch_id: string; type: WarningType; source_row?: number;
  event_id?: string; detail?: string; resolution?: WarningResolution; resolved_by?: string;
}
export interface UploadBatch {
  batch_id: string; uploaded_by: string; uploaded_at: string; file_name?: string; file_hash?: string;
  rows_read: number; rows_added: number; rows_identical: number; rows_skipped: number;
  warning_count: number; status: 'Started' | 'Completed' | 'Failed';
}

/** A row read from the workbook, normalised by the browser, ready to send. */
export interface UploadRow {
  source_row: number;
  event_date: string; line_id: string; area_id: string; code_raw: string;
  stop_ts: string; start_ts: string; freq: 0 | 1;
  classification: string; criticality: Criticality; is_failure: boolean;
  reason_raw?: string; description?: string; fingerprint: string;
}

export interface SessionUser { user_id: string; email: string; display_name: string; role_id: string }
export interface Session {
  token: string; expires_at: string; user: SessionUser; must_change: boolean; access: Access;
}
export interface AdminUser extends SessionUser { active: boolean; must_change: boolean; last_login_at?: string; overrides?: Partial<Access> }

export interface Startup {
  lines: Line[]; areas: Area[]; equipment: Equipment[]; equipment_areas: EquipmentArea[];
  aliases: EquipmentAlias[]; classifications: Classification[]; reasons: Reason[];
  settings: Setting[]; years: number[];
}

// ---- notifications (docs/notifications-design.md, docs/wire-protocol.md section 9) ----

/** Stored notification types. Action items are derived by the app and are not stored. */
export type NotificationType =
  | 'long_stop' | 'repeat_group' | 'failure_spike' | 'availability_low' | 'upload_gap' | 'upload_done' | 'user_event';
export const NOTIFICATION_TYPES: NotificationType[] = [
  'long_stop', 'repeat_group', 'failure_spike', 'availability_low', 'upload_gap', 'upload_done', 'user_event',
];
export type NotificationSeverity = 'alert' | 'update';
/** getNotifications only returns 'open' items; resolved and expired ones stay in the table for the record. */
export type NotificationStatus = 'open' | 'resolved' | 'expired';

export interface Notification {
  notification_id: string; type: NotificationType; severity: NotificationSeverity;
  /** unique over all statuses, e.g. 'long_stop|EV-1234abcd5678ef90' */
  dedupe_key: string;
  title: string; detail?: string; area_id?: string; line_id?: string;
  /** event_id, batch_id or user_id the notification is about */
  source_ref?: string;
  created_at: string; expires_at: string; status: NotificationStatus; resolved_at?: string;
}

export type NotificationStateValue = 'seen' | 'snoozed' | 'dismissed';
/** One row per user and notification. The server only ever returns the caller's own rows. */
export interface NotificationState {
  user_id: string; notification_id: string; state: NotificationStateValue;
  /** plant-local 'YYYY-MM-DD HH:MM:SS.mmm', only for state 'snoozed' */
  snooze_until?: string; updated_at: string;
}

/**
 * The caller's own preferences. Keys: alert_types (csv of NotificationType, blank = all), watch_areas (csv of
 * area ids, blank = all), digest ('none' | 'daily' | 'weekly'), last_seen_at (timestamp), and last_digest_at
 * (read only, written by the server), saved_views (JSON text: at most 20 of {id, name, page, query}) and saved_reports
 * (JSON text: at most 20 report templates, see SavedReportTemplate; docs/wire-protocol.md). A key that was never saved is absent.
 */
export type NotificationPrefs = Record<string, string>;
export type NotificationPrefKey = 'alert_types' | 'watch_areas' | 'digest' | 'last_seen_at' | 'saved_views' | 'saved_reports';

/** The report templates the Reports page can start from, and the saved-template shape (preference `saved_reports`). */
export const REPORT_TEMPLATES = ['monthly', 'area', 'failure', 'custom'] as const;
export type ReportTemplateId = (typeof REPORT_TEMPLATES)[number];
export const REPORT_PRESETS = ['lastmonth', 'thismonth', 'last3', 'ytd', 'custom'] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];
/** Every section a report can contain, in report order. The backend (Notifications.js REPORT_SECTION_IDS_) mirrors this list. */
export const REPORT_SECTION_IDS = [
  'cover', 'summary', 'daily', 'monthly', 'classes', 'area_downtime', 'availability', 'mtbf_mttr', 'failure_rate',
  'top_equipment', 'top_reasons', 'pareto', 'repeats', 'longest', 'quadrant', 'when', 'events', 'quality', 'methodology',
] as const;
export type ReportSectionId = (typeof REPORT_SECTION_IDS)[number];
export interface ReportSectionOptions { top?: number | 'all'; measure?: 'hours' | 'count' }
export interface SavedReportTemplate {
  id: string; name: string; template: ReportTemplateId;
  period: { preset: ReportPreset; from: string; to: string; compare: boolean };
  filters: { lines: string[]; areas: string[]; equipment: string[]; classifications: string[]; criticality: string[]; failuresOnly: boolean };
  sections: ReportSectionId[];
  options: Partial<Record<ReportSectionId, ReportSectionOptions>>;
}
export const SAVED_REPORTS_MAX = 20;

export interface NotificationsPayload {
  items: Notification[]; state: NotificationState[]; prefs: NotificationPrefs;
}
export interface NotificationCheckResult { created: number; resolved: number; expired: number }

export class ApiError extends Error {
  code: string;
  accessDenied: boolean;
  constructor(message: string, code = 'error', accessDenied = false) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.accessDenied = accessDenied;
  }
}

export interface Api {
  // --- auth ---
  login(email: string, password: string, keepSignedIn: boolean): Promise<Session>;
  changePassword(token: string, current: string, next: string): Promise<Session>;
  getMyAccess(token: string): Promise<{ user: SessionUser; access: Access; must_change: boolean }>;

  // --- reads ---
  getStartup(token: string): Promise<Startup>;
  getEvents(token: string, year: number): Promise<EventRow[]>;
  getEventEdits(token: string, eventId: string): Promise<EventEdit[]>;
  getUploadHistory(token: string): Promise<UploadBatch[]>;
  getUploadWarnings(token: string, batchId: string): Promise<UploadWarning[]>;

  // --- upload ---
  uploadStart(token: string, fileName: string, fileHash: string): Promise<{ batch_id: string }>;
  uploadChunk(token: string, batchId: string, rows: UploadRow[]): Promise<{ added: number; identical: number; rejected: { source_row: number; reason: string }[] }>;
  uploadFinish(token: string, batchId: string, summary: { rows_read: number; rows_skipped: number }, warnings: Omit<UploadWarning, 'warning_id' | 'batch_id'>[]): Promise<UploadBatch>;

  // --- data checks ---
  /**
   * Re-runs the data checks (flags) of stored events against the current Master Data, for one year
   * or (without a year) every year. Needs Edit on the events tab. Returns how many events were
   * checked and how many had their flags changed. Never changes anything else.
   */
  revalidateEvents(token: string, year?: number): Promise<{ checked: number; changed: number }>;

  // --- event correction (never done by upload) ---
  editEvent(token: string, eventId: string, changes: EventChanges, note: string): Promise<EventRow>;
  voidEvent(token: string, eventId: string, isVoid: boolean, note: string): Promise<EventRow>;
  /**
   * "Keep as entered": says the data-check flags of a record are fine as they are. `flags` is the FULL new set of
   * accepted flags (sending fewer undoes some, an empty list undoes all); every name must be a known flag and
   * a note of at least 3 characters is required (also to undo). Needs Edit on the events tab. Changes nothing else
   * about the record and recalculates no flag. One history row (field accepted_flags) records who, when and why.
   * Refused for a voided record and when nothing would change ('Nothing was changed.').
   */
  acceptEventFlags(token: string, eventId: string, flags: string[], note: string): Promise<EventRow>;

  // --- master data ---
  saveEquipment(token: string, row: Equipment, areaIds: string[]): Promise<void>;
  saveArea(token: string, row: Area): Promise<void>;
  saveReason(token: string, row: Reason): Promise<void>;
  saveAlias(token: string, row: EquipmentAlias): Promise<void>;
  deleteAlias(token: string, alias: string): Promise<void>;
  saveSettings(token: string, changes: Record<string, string>): Promise<void>;

  // --- users (admin) ---
  listUsers(token: string): Promise<AdminUser[]>;
  createUser(token: string, u: { email: string; display_name: string; role_id: string }): Promise<{ user: AdminUser; temp_password: string }>;
  updateUser(token: string, userId: string, changes: Partial<Pick<AdminUser, 'display_name' | 'role_id' | 'active'>>): Promise<AdminUser>;
  resetPassword(token: string, userId: string): Promise<{ temp_password: string }>;
  setUserTabAccess(token: string, userId: string, overrides: Partial<Access>): Promise<AdminUser>;

  // --- notifications ---
  /**
   * Open alerts and updates (expired and resolved ones are left out; user_event only for people who can see the
   * Users page), plus the caller's own state rows for them and the caller's own preferences. Any signed-in user.
   */
  getNotifications(token: string): Promise<NotificationsPayload>;
  /** Sets the caller's own state for one notification. `snoozeUntil` is required for 'snoozed' and must be in the future. */
  setNotificationState(token: string, notificationId: string, state: NotificationStateValue, snoozeUntil?: string): Promise<NotificationState>;
  /** Saves some of the caller's own preferences (validated) and returns all of them. */
  saveNotificationPrefs(token: string, prefs: Partial<Record<NotificationPrefKey, string>>): Promise<NotificationPrefs>;
  /** Runs the server rules now. Needs Edit on the settings tab. */
  runNotificationChecks(token: string): Promise<NotificationCheckResult>;
}
