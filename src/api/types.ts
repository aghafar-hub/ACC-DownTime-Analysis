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
  | 'overview' | 'pareto' | 'repeats' | 'reliability' | 'events'
  | 'upload' | 'master' | 'settings' | 'users';
export const TAB_IDS: TabId[] = [
  'overview', 'pareto', 'repeats', 'reliability', 'events', 'upload', 'master', 'settings', 'users',
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
  | 'orphan_continuation' | 'overlap_in_area' | 'placeholder_code' | 'edited_in_app';
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

  // --- event correction (never done by upload) ---
  editEvent(token: string, eventId: string, changes: EventChanges, note: string): Promise<EventRow>;
  voidEvent(token: string, eventId: string, isVoid: boolean, note: string): Promise<EventRow>;

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
}
