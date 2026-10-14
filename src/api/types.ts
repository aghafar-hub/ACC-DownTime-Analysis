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
  | 'overview' | 'pareto' | 'repeats' | 'reliability' | 'reports' | 'actions' | 'events'
  | 'upload' | 'master' | 'settings' | 'users';
export const TAB_IDS: TabId[] = [
  'overview', 'pareto', 'repeats', 'reliability', 'reports', 'actions', 'events', 'upload', 'master', 'settings', 'users',
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
  /** The theme saved with the account (backend 1.5.0; '' or absent when none, or from an older server). */
  theme?: string;
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
  | 'long_stop' | 'repeat_group' | 'failure_spike' | 'availability_low' | 'upload_gap' | 'upload_done' | 'user_event'
  | 'planned_overrun' | 'action_due';
export const NOTIFICATION_TYPES: NotificationType[] = [
  'long_stop', 'repeat_group', 'failure_spike', 'availability_low', 'upload_gap', 'upload_done', 'user_event',
  'planned_overrun', 'action_due',
];
/** Inbox categories (backend 1.4.0). The server derives the category from the type; it is not stored. */
export const NOTIFICATION_CATEGORIES = ['Reliability', 'Availability & planned', 'Data quality', 'Actions', 'System'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
/** The category of each type, the same table as NOTIF_CATEGORY_ in backend/apps-script/Notifications.js. */
export const NOTIFICATION_CATEGORY_OF: Record<NotificationType, NotificationCategory> = {
  long_stop: 'Reliability', repeat_group: 'Reliability', failure_spike: 'Reliability',
  availability_low: 'Availability & planned', planned_overrun: 'Availability & planned',
  upload_gap: 'Data quality', upload_done: 'Data quality', action_due: 'Actions', user_event: 'System',
};
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
  /** derived from `type` by getNotifications (backend 1.4.0); older servers leave it out: use NOTIFICATION_CATEGORY_OF */
  category?: NotificationCategory;
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
 * (JSON text: at most 20 report templates, see SavedReportTemplate; docs/wire-protocol.md) and theme (backend 1.5.0: one of the
 * five theme names, blank = none). A key that was never saved is absent.
 */
export type NotificationPrefs = Record<string, string>;
export type NotificationPrefKey = 'alert_types' | 'watch_areas' | 'digest' | 'last_seen_at' | 'saved_views' | 'saved_reports' | 'theme';

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

// ---- actions (docs/actions-design.md, docs/wire-protocol.md section 10, backend 1.4.0) ----

export const ACTION_STATUSES = ['Draft', 'Open', 'Contractor informed', 'Waiting stoppage', 'In progress', 'Closed', 'Cancelled'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
/** Closed and Cancelled: only people in actions_closers (or an Admin) move an action to or from them. */
export const ACTION_TERMINAL_STATUSES: readonly ActionStatus[] = ['Closed', 'Cancelled'];
export const isTerminalStatus = (s: ActionStatus): boolean => ACTION_TERMINAL_STATUSES.includes(s);
export const ACTION_PRIORITIES = ['High', 'Medium', 'Low'] as const;
export type ActionPriority = (typeof ACTION_PRIORITIES)[number];
export const ACTION_SOURCES = [
  'auto_repeat', 'auto_chronic', 'auto_long_stop', 'auto_planned_overrun', 'notification', 'report', 'pareto', 'event', 'manual',
] as const;
export type ActionSource = (typeof ACTION_SOURCES)[number];
export const ACTION_SCOPES = ['equipment', 'area', 'line', 'plant'] as const;
export type ActionScope = (typeof ACTION_SCOPES)[number];
export type ActionOwnerKind = 'contractor' | 'internal';
/** Root-cause category; '' = not known yet. OPR = operation, EXT = external. */
export const ACTION_ROOT_CAUSES = ['', 'PRO', 'MEC', 'ELE', 'AUT', 'OPR', 'EXT'] as const;
export type ActionRootCause = (typeof ACTION_ROOT_CAUSES)[number];
export type ActionEffectiveness = '' | 'Watching' | 'Effective' | 'Not effective';
export const ACTION_EVIDENCE_MAX = 200;

/** One evidence item: a stored event, a note, or both. The server stamps who added it and when. */
export interface ActionEvidence { event_id?: string; note?: string; added_at: string; added_by: string }
export interface ActionEvidenceInput { event_id?: string; note?: string }

/** An action as the API sends it (blank text fields are ''). `evidence` is stored as JSON text and sent as a list. */
export interface Action {
  /** 'AC-' + yyyymm + '-' + 4-digit sequence within the month, e.g. AC-202610-0007 */
  action_id: string;
  title: string; detail: string; status: ActionStatus; priority: ActionPriority;
  source: ActionSource;
  /** notification_id, event_id, report name ... the action came from */
  source_ref: string;
  scope_kind: ActionScope; area_id: string; line_id: string; equipment_id: string;
  /** reason in match_key form (trimmed, single spaces, lower case) */
  reason_key: string;
  owner_kind: ActionOwnerKind;
  /** a Contractor.contractor_id (external contractor or internal team); '' = nobody yet */
  owner: string;
  /** the person following it up: a user_id (see ActionsPayload.people) or a free name; '' = nobody */
  assignee: string;
  /** 'YYYY-MM-DD' or '' */
  due_date: string;
  needs_stop: boolean; root_cause: ActionRootCause; required_action: string;
  created_by: string; created_at: string; updated_at: string; updated_by: string;
  closed_by: string; closed_at: string; closure_note: string;
  effectiveness: ActionEffectiveness; effectiveness_checked_at: string;
  evidence: ActionEvidence[];
  /** at most one action that is not Closed / Cancelled per key, e.g. 'repeat|<equipment>|<reason_key>' */
  dedupe_key: string;
}

export type ActionLogKind = 'status' | 'comment' | 'edit' | 'evidence';
export interface ActionLog {
  log_id: string; action_id: string; at: string;
  /** user_id or 'system' */
  by: string;
  kind: ActionLogKind; from_status: string; to_status: string; text: string;
}

/** An external contractor or an internal team. `areas` is stored as csv and sent as a list. */
export interface Contractor {
  contractor_id: string; name: string; areas: string[]; kind: ActionOwnerKind; active: boolean; sort_order: number;
  /** user_id suggested as assignee for new actions; '' = none */
  default_assignee: string;
}
/** An active user, for the assignee picker and history names (no e-mail addresses). */
export interface ActionPerson { user_id: string; display_name: string }

export interface ActionsPayload {
  actions: Action[]; logs: ActionLog[]; contractors: Contractor[]; people: ActionPerson[];
  /** user ids in actions_closers (Admins can always close as well) */
  closers: string[];
  /** may the caller close, cancel or reopen actions */
  can_close: boolean;
}

/** createAction input. Defaults: status Draft, priority Medium, source manual. Closed / Cancelled are refused here. */
export interface NewAction {
  title: string; scope_kind: ActionScope;
  detail?: string; status?: ActionStatus; priority?: ActionPriority; source?: ActionSource; source_ref?: string;
  area_id?: string; line_id?: string; equipment_id?: string; reason_key?: string;
  owner?: string; assignee?: string; due_date?: string; needs_stop?: boolean; root_cause?: ActionRootCause; required_action?: string;
  evidence?: ActionEvidenceInput[];
  /** blank: equipment scope with a reason uses 'repeat|<equipment>|<reason_key>' */
  dedupe_key?: string;
}
export type ActionEditableField =
  | 'title' | 'detail' | 'status' | 'priority' | 'scope_kind' | 'area_id' | 'line_id' | 'equipment_id' | 'reason_key' | 'owner'
  | 'assignee' | 'due_date' | 'needs_stop' | 'root_cause' | 'required_action' | 'closure_note';
export type ActionChanges = Partial<Pick<Action, ActionEditableField>> & { add_evidence?: ActionEvidenceInput[] };
export interface ActionResult { action: Action; logs: ActionLog[] }
/** merged = an open action with the same dedupe_key received the evidence instead (that action is returned). */
export interface CreateActionResult extends ActionResult { merged: boolean }
export interface ActionCheckResult { created: number; merged: number; effectiveness: number }

/** Per area and year. `monthly_split` (12 hours, Jan..Dec) adds up to the allowance; overhaul months are 1-12. */
export interface AreaTarget {
  area_id: string; year: number; availability_target_pct: number | null; planned_allowance_h_year: number;
  monthly_split: number[]; overhaul_months: number[]; updated_at: string; updated_by: string;
}
/** saveAreaTargets input; monthly_split left out = even split (evenMonthlySplit). */
export interface AreaTargetInput {
  area_id: string; availability_target_pct?: number | null; planned_allowance_h_year: number;
  monthly_split?: number[]; overhaul_months?: number[];
}

/** The even split the server uses: 2-decimal months, December takes the rounding rest. */
export function evenMonthlySplit(allowance: number): number[] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const each = r2(allowance / 12);
  let sum = 0;
  const out: number[] = [];
  for (let i = 0; i < 11; i++) { out.push(each); sum += each; }
  out.push(r2(allowance - sum));
  return out;
}

/** The active external contractor responsible for an area (the owner the server gives an auto draft), or null. */
export function contractorForArea(contractors: readonly Contractor[], areaId: string): Contractor | null {
  if (!areaId) return null;
  return contractors.find((c) => c.active && c.kind === 'contractor' && c.areas.includes(areaId)) ?? null;
}

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
  /** Also the theme saved with the account (backend 1.5.0; absent from older servers). */
  getMyAccess(token: string): Promise<{ user: SessionUser; access: Access; must_change: boolean; theme?: string }>;

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
  /** Changing `active` needs the Admin role (backend 1.5.0; 'forbidden' otherwise): use setAreaActive. */
  saveArea(token: string, row: Area): Promise<void>;
  /**
   * Switches one area on or off (backend 1.5.0, Admin role only, audited). An inactive area and all its records are left
   * out of every page, number, list and server rule; the records stay stored. Returns the area as stored.
   */
  setAreaActive(token: string, areaId: string, active: boolean): Promise<Area>;
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

  // --- actions (backend 1.4.0) ---
  /** Every action with its history, the contractors, the active people and whether the caller may close. Needs actions View. */
  listActions(token: string): Promise<ActionsPayload>;
  /**
   * Creates an action (actions Edit). When an action that is not Closed / Cancelled has the same dedupe_key, the evidence is
   * added to it instead and that action comes back with merged = true (options.merge = false always creates a new one).
   */
  createAction(token: string, input: NewAction, options?: { merge?: boolean }): Promise<CreateActionResult>;
  /**
   * Changes some fields (actions Edit). Moving to or from Closed / Cancelled, and changing a closed action, needs the caller in
   * actions_closers or an Admin ('forbidden' otherwise); closing needs closure_note (3+ characters); a closed or cancelled
   * action reopens only to Open. 'Nothing was changed.' when nothing would change.
   */
  updateAction(token: string, actionId: string, changes: ActionChanges): Promise<ActionResult>;
  /** Adds a comment to the history (actions Edit; also on a closed action). */
  addActionComment(token: string, actionId: string, text: string): Promise<ActionResult>;
  /** Inserts or updates the contractors sent (settings Edit); an area belongs to at most one active external contractor. Returns all. */
  saveContractors(token: string, rows: Contractor[]): Promise<Contractor[]>;
  /** Area targets of one year (every year when left out). Any signed-in user. */
  getAreaTargets(token: string, year?: number): Promise<AreaTarget[]>;
  /** Inserts or updates the targets of one year for the areas sent (settings Edit). Returns the year's targets. */
  saveAreaTargets(token: string, year: number, rows: AreaTargetInput[]): Promise<AreaTarget[]>;
  /** Runs the draft rules and the effectiveness check now (settings Edit). Also runs after every upload and notification check. */
  runActionChecks(token: string): Promise<ActionCheckResult>;
}
