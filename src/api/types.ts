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
  | 'planned_overrun' | 'action_due' | 'action_ready_to_close' | 'task_overdue';
export const NOTIFICATION_TYPES: NotificationType[] = [
  'long_stop', 'repeat_group', 'failure_spike', 'availability_low', 'upload_gap', 'upload_done', 'user_event',
  'planned_overrun', 'action_due', 'action_ready_to_close', 'task_overdue',
];
/** Inbox categories (backend 1.4.0). The server derives the category from the type; it is not stored. */
export const NOTIFICATION_CATEGORIES = ['Reliability', 'Availability & planned', 'Data quality', 'Actions', 'System'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
/** The category of each type, the same table as NOTIF_CATEGORY_ in backend/apps-script/Notifications.js. */
export const NOTIFICATION_CATEGORY_OF: Record<NotificationType, NotificationCategory> = {
  long_stop: 'Reliability', repeat_group: 'Reliability', failure_spike: 'Reliability',
  availability_low: 'Availability & planned', planned_overrun: 'Availability & planned',
  upload_gap: 'Data quality', upload_done: 'Data quality', action_due: 'Actions', user_event: 'System',
  action_ready_to_close: 'Actions', task_overdue: 'Actions',
};
export type NotificationSeverity = 'alert' | 'update';
/** getNotifications only returns 'open' items; resolved and expired ones stay in the table for the record. */
export type NotificationStatus = 'open' | 'resolved' | 'expired';

export interface Notification {
  notification_id: string; type: NotificationType; severity: NotificationSeverity;
  /** unique over all statuses, e.g. 'long_stop|EV-1234abcd5678ef90' */
  dedupe_key: string;
  title: string; detail?: string; area_id?: string; line_id?: string;
  /**
   * event_id, batch_id, user_id or action_id the notification is about. action_due, action_ready_to_close and task_overdue
   * carry the action_id; task_overdue names its task in the dedupe key 'task_due|<task_id>|<due_date>'.
   */
  source_ref?: string;
  created_at: string; expires_at: string; status: NotificationStatus; resolved_at?: string;
  /**
   * Backend 1.7.0: who sees it. Comma-separated user ids and/or '@closers' (actions_closers and the Admins); blank or absent =
   * everyone. getNotifications only returns the caller's own, so the app never needs to filter on it.
   */
  recipients?: string;
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

/**
 * Backend 1.7.0: Draft (until accepted, by hand) -> Open -> In progress (set by the tasks: as soon as any task leaves Open) ->
 * Closed (by a closer, every task Done or Not needed), or Cancelled. 'Contractor informed' and 'Waiting stoppage' moved to the
 * tasks (TASK_STATUSES); updateAction refuses them.
 */
export const ACTION_STATUSES = ['Draft', 'Open', 'In progress', 'Closed', 'Cancelled'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
/** The two action statuses of backend 1.4.0-1.6.0 that are task statuses since 1.7.0 (refused by updateAction). */
export const REMOVED_ACTION_STATUSES = ['Contractor informed', 'Waiting stoppage'] as const;
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
  /** 'YYYY-MM-DD' or ''. Set by hand only while the action has no tasks (backend 1.7.0); see due_date_derived. */
  due_date: string;
  /**
   * Backend 1.7.0: the due date to show. With tasks: the latest due date of the open tasks ('' when no open task has one);
   * without tasks: due_date. Absent from older servers: use actionDueDate().
   */
  due_date_derived?: string;
  /** Backend 1.7.0: the task template the tasks were first made from ('' = none). */
  template_id?: string;
  needs_stop: boolean; root_cause: ActionRootCause; required_action: string;
  created_by: string; created_at: string; updated_at: string; updated_by: string;
  closed_by: string; closed_at: string; closure_note: string;
  effectiveness: ActionEffectiveness; effectiveness_checked_at: string;
  evidence: ActionEvidence[];
  /** at most one action that is not Closed / Cancelled per key, e.g. 'repeat|<equipment>|<reason_key>' */
  dedupe_key: string;
}

/** task_* (backend 1.7.0): the history of one task (task_id). task_status carries the task statuses in from_status / to_status. */
export type ActionLogKind = 'status' | 'comment' | 'edit' | 'evidence' | 'task_create' | 'task_status' | 'task_edit' | 'task_note';
export interface ActionLog {
  log_id: string; action_id: string; at: string;
  /** user_id or 'system' */
  by: string;
  kind: ActionLogKind; from_status: string; to_status: string; text: string;
  /** backend 1.7.0: the task of a task_* row ('' otherwise; absent from older servers) */
  task_id?: string;
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
  /** backend 1.7.0: every task of the returned actions, by action and seq (absent from older servers) */
  tasks?: ActionTask[];
  /** backend 1.7.0: every task template with its steps, active or not (absent from older servers) */
  templates?: TaskTemplate[];
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
  /**
   * Backend 1.7.0: the tasks to create with the action (at most TASKS_PER_ACTION_MAX, all start Open). When they are left out
   * and template_id is given, the template's steps are created instead; with both, the tasks are created and template_id is
   * only recorded on the action. When the action is merged into an open one, the tasks whose template_step that action does
   * not have yet are added to it.
   */
  tasks?: NewTask[];
  template_id?: string;
}
export type ActionEditableField =
  | 'title' | 'detail' | 'status' | 'priority' | 'scope_kind' | 'area_id' | 'line_id' | 'equipment_id' | 'reason_key' | 'owner'
  | 'assignee' | 'due_date' | 'needs_stop' | 'root_cause' | 'required_action' | 'closure_note';
export type ActionChanges = Partial<Pick<Action, ActionEditableField>> & { add_evidence?: ActionEvidenceInput[] };
/** `tasks` (backend 1.7.0): every task of the action, by seq. */
export interface ActionResult { action: Action; logs: ActionLog[]; tasks?: ActionTask[] }
/** merged = an open action with the same dedupe_key received the evidence instead (that action is returned). */
export interface CreateActionResult extends ActionResult { merged: boolean }
export interface ActionCheckResult { created: number; merged: number; effectiveness: number }

// ---- tasks inside actions (backend 1.7.0, docs/wire-protocol.md section 13) ----

/** Contractor informed only for an external contractor; Done needs a note, Not needed a reason (TASK_NOTE_MIN characters). */
export const TASK_STATUSES = ['Open', 'Contractor informed', 'Waiting stoppage', 'In progress', 'Done', 'Not needed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** A task in one of these no longer blocks closing the action. */
export const TASK_CLOSED_STATUSES: readonly TaskStatus[] = ['Done', 'Not needed'];
export const TASK_NOTE_MIN = 3;
export const TASKS_PER_ACTION_MAX = 50;
export const TEMPLATE_STEPS_MAX = 20;
/** default_owner of a template step: the active external contractor of the action's area. */
export const AREA_CONTRACTOR = 'area_contractor';

export interface ActionTask {
  /** 'AT-' + 12 hex characters */
  task_id: string; action_id: string;
  /** 1, 2, 3 ... within the action */
  seq: number;
  title: string;
  owner_kind: ActionOwnerKind;
  /** a Contractor.contractor_id; '' = nobody yet (then owner_kind 'internal') */
  owner: string;
  /** user_id or a free name; '' = nobody. Gets the task_overdue alert. */
  assignee: string;
  /** 'YYYY-MM-DD' or '' */
  due_date: string;
  status: TaskStatus;
  needs_stop: boolean;
  /** estimated stop hours; null = not estimated (always null when needs_stop is false) */
  est_stop_h: number | null;
  notes: string;
  /** the template step title it was made from; '' = added by hand */
  template_step: string;
  created_at: string; created_by: string; updated_at: string; updated_by: string;
  /** set when it becomes Done or Not needed, cleared when it is reopened */
  done_at: string; done_by: string; done_note: string;
}

/** addTask / createAction input. A new task always starts Open. */
export interface NewTask {
  title: string; owner?: string; assignee?: string; due_date?: string; needs_stop?: boolean; est_stop_h?: number | null; notes?: string;
  template_step?: string;
}
/**
 * updateTask changes. `note` goes with a status change (required for Done: what was done; for Not needed: the reason; optional
 * otherwise) or, alone, adds a note to the task history.
 */
export type TaskChanges = Partial<Pick<ActionTask, 'title' | 'owner' | 'assignee' | 'due_date' | 'status' | 'needs_stop' | 'est_stop_h' | 'notes'>> & { note?: string };
/**
 * addTask / updateTask / applyTemplate: the action (its status may have followed the tasks), all its tasks and its history.
 * `task` is the task added or changed (addTask, updateTask); `added` how many tasks were added (applyTemplate).
 */
export interface TaskResult { action: Action; tasks: ActionTask[]; logs: ActionLog[]; task?: ActionTask; added?: number }

export interface TaskTemplateStep {
  seq: number; title: string;
  /** AREA_CONTRACTOR or a Contractor.contractor_id */
  default_owner: string;
  due_offset_days: number; needs_stop: boolean; est_stop_h: number | null;
}
export interface TaskTemplate {
  /** 'TT-…' */
  template_id: string; name: string;
  /** action sources the template is suggested for first; a source belongs to at most one active template */
  applies_to: ActionSource[];
  active: boolean; sort_order: number; updated_at: string; updated_by: string;
  steps: TaskTemplateStep[];
}
/** saveTaskTemplates input: template_id blank = a new template. The steps replace the template's steps (1-20, unique titles). */
export interface TaskTemplateInput {
  template_id?: string; name: string; applies_to: ActionSource[]; active: boolean; sort_order?: number;
  steps: Omit<TaskTemplateStep, 'seq'>[];
}

/**
 * listTasks filter (all optional). status: 'open' (default) = not Done / Not needed, 'closed' = Done / Not needed, 'all', or a
 * list. mine = the caller is the task's person. overdue = open and due before today. needs_stop = needs a stop (with the
 * default status: the Shutdown list). done_since ('YYYY-MM-DD') keeps only tasks finished on or after that day. Tasks of Draft
 * and Cancelled actions are left out (include_drafts adds the Draft ones).
 */
export interface TaskFilter {
  mine?: boolean; overdue?: boolean; needs_stop?: boolean;
  status?: 'open' | 'closed' | 'all' | TaskStatus[];
  owner?: string; assignee?: string; area_id?: string; line_id?: string; action_id?: string;
  done_since?: string; include_drafts?: boolean;
}
/** A task with what the Tasks and Shutdown lists show of its action. */
export interface TaskView extends ActionTask {
  action_title: string; action_status: ActionStatus; action_assignee: string; action_owner: string;
  area_id: string; line_id: string; equipment_id: string;
  /** open and due before `today` */
  overdue: boolean;
  /** when it last moved to Waiting stoppage ('' when it is not waiting) */
  waiting_since: string;
}
/** listTasks: overdue first, then by due date (no date last), action and seq. `today` is the server's plant date. */
export interface TaskList { tasks: TaskView[]; today: string }

export const isTaskOpen = (t: Pick<ActionTask, 'status'>): boolean => !TASK_CLOSED_STATUSES.includes(t.status);

const tasksOfAction = <T extends Pick<ActionTask, 'action_id'>>(a: Pick<Action, 'action_id'>, tasks: readonly T[]): T[] =>
  tasks.filter((t) => t.action_id === a.action_id);

/** Today's plant date as the browser sees it ('YYYY-MM-DD', local clock). */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export interface ActionProgress {
  /** Done + Not needed */
  done: number; total: number;
  /** total - done */
  open: number;
  /** open tasks due before today */
  overdue: number;
  /** earliest due date of the open tasks ('' when none has one) */
  nextDue: string;
  /** Not needed (included in done) */
  notNeeded: number;
  /** open tasks that need a stop, and their estimated hours */
  needsStop: number; stopHours: number;
}
/** Progress of one action (all tasks may be passed; only this action's count). */
export function actionProgress(action: Pick<Action, 'action_id'>, tasks: readonly ActionTask[], today: string = localToday()): ActionProgress {
  const mine = tasksOfAction(action, tasks);
  const open = mine.filter(isTaskOpen);
  const dues = open.map((t) => t.due_date).filter(Boolean).sort();
  return {
    done: mine.length - open.length, total: mine.length, open: open.length,
    overdue: open.filter((t) => t.due_date && t.due_date < today).length,
    nextDue: dues[0] ?? '', notNeeded: mine.filter((t) => t.status === 'Not needed').length,
    needsStop: open.filter((t) => t.needs_stop).length,
    stopHours: Math.round(open.reduce((s, t) => s + (t.needs_stop && t.est_stop_h ? t.est_stop_h : 0), 0) * 10) / 10,
  };
}

/**
 * The status the server keeps (backend 1.7.0): Draft, Closed and Cancelled stay; an action without tasks keeps its own status;
 * otherwise In progress as soon as any task has left Open, else Open.
 */
export function deriveActionStatus(action: Pick<Action, 'action_id' | 'status'>, tasks: readonly ActionTask[]): ActionStatus {
  if (action.status === 'Draft' || isTerminalStatus(action.status)) return action.status;
  const mine = tasksOfAction(action, tasks);
  if (!mine.length) return action.status;
  return mine.some((t) => t.status !== 'Open') ? 'In progress' : 'Open';
}

/** The action's due date (due_date_derived): the latest open task due date with tasks, else the stored due_date. */
export function actionDueDate(action: Pick<Action, 'action_id' | 'due_date'>, tasks: readonly ActionTask[]): string {
  const mine = tasksOfAction(action, tasks);
  if (!mine.length) return action.due_date;
  return mine.filter(isTaskOpen).map((t) => t.due_date).filter(Boolean).sort().pop() ?? '';
}

/** May the action be closed as far as its tasks go: not closed or cancelled, and no open task (an action without tasks may). */
export function canClose(action: Pick<Action, 'action_id' | 'status'>, tasks: readonly ActionTask[]): boolean {
  return !isTerminalStatus(action.status) && !tasksOfAction(action, tasks).some(isTaskOpen);
}

/** Accepted, not closed, at least one task and every task Done or Not needed (the action_ready_to_close condition). */
export function isReadyToClose(action: Pick<Action, 'action_id' | 'status'>, tasks: readonly ActionTask[]): boolean {
  return action.status !== 'Draft' && tasksOfAction(action, tasks).length > 0 && canClose(action, tasks);
}

/** Why a task status change would be refused ('' when fine): the same checks as the server. */
export function taskStatusProblem(task: Pick<ActionTask, 'owner_kind'>, status: TaskStatus, note: string): string {
  const n = note.trim();
  if (status === 'Contractor informed' && task.owner_kind !== 'contractor') return 'Contractor informed is only for a task owned by an external contractor.';
  if (status === 'Done' && n.length < TASK_NOTE_MIN) return `Write what was done (at least ${TASK_NOTE_MIN} characters).`;
  if (status === 'Not needed' && n.length < TASK_NOTE_MIN) return `Write why the task is not needed (at least ${TASK_NOTE_MIN} characters).`;
  return '';
}

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

// ---------------------------------------------------------------- who is online and the change log (backend 1.6.0)

/** The device a person uses, as the browser says (a small touch screen = phone). */
export type DeviceKind = 'phone' | 'desktop';
/** Sent with the 2-minute access check (getMyAccess): the address open in the app and the device. Anything invalid is ignored. */
export interface ActivityHint { page?: string; device?: DeviceKind }
/** online = a call in the last `online_minutes` (5); today = seen today (plant date). last_seen_at '' = never seen. */
export interface ActiveUser {
  user_id: string; display_name: string; role_id: string; active: boolean;
  last_seen_at: string; last_page: string; device: DeviceKind | '';
  online: boolean; today: boolean;
}
export interface ActiveUsersPayload {
  /** the server's plant-local time when the list was made (relative times are counted from it) */
  now: string; online_minutes: number; online_count: number; today_count: number; users: ActiveUser[];
}

/** The plain-English groups of the Activity log filter (backend Audit.js AUDIT_GROUPS_). */
export const AUDIT_GROUPS = ['signin', 'users', 'settings', 'master', 'events', 'upload', 'actions', 'areas', 'notifications', 'system'] as const;
export type AuditGroup = (typeof AUDIT_GROUPS)[number];
/** Every field optional; from / to are plant dates (inclusive); q is case-insensitive text; limit 1-200 (100). */
export interface AuditFilter { user_id?: string; group?: AuditGroup; from?: string; to?: string; q?: string; limit?: number }
export interface AuditEntry {
  at: string; user_id: string; action: string; entity: string; entity_id: string; detail: string; group: AuditGroup;
}
export interface AuditPage {
  /** newest first */
  entries: AuditEntry[];
  /** pass back to get the next (older) page; null = nothing older matches */
  next_cursor: string | null;
  /** rows looked at for this page (a rare filter may return fewer entries than the page size with a cursor) */
  scanned: number;
  /** every user's name, to show names instead of ids */
  users: { user_id: string; display_name: string }[];
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

/** An attachment of an outgoing email: the file as base64 (no data: prefix). */
export interface MailAttachment {
  name: string;
  mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' | 'text/csv';
  base64: string;
}

/** sendReport input (backend 1.9.0). `kind` only names the email in the activity log. */
export interface OutgoingEmail {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  attachments?: MailAttachment[];
  kind?: 'report' | 'actions';
}

/** Which sender the server used: the system email through Gmail, or the deploying account through MailApp. */
export interface SendResult { from: string; via: 'gmail' | 'mailapp'; recipients?: number }

export interface Api {
  // --- auth ---
  login(email: string, password: string, keepSignedIn: boolean): Promise<Session>;
  changePassword(token: string, current: string, next: string): Promise<Session>;
  /**
   * Also the theme saved with the account (backend 1.5.0; absent from older servers). The app calls it every 2 minutes
   * while it is open and visible: it is also the heartbeat of Settings > Active users (backend 1.6.0), carrying the
   * address open and the device in `activity` (older servers ignore it).
   */
  getMyAccess(token: string, activity?: ActivityHint): Promise<{ user: SessionUser; access: Access; must_change: boolean; theme?: string }>;
  /** Writes the sign-out to the activity log (backend 1.6.0). Best effort: the app signs out whatever the answer. */
  logout(token: string): Promise<void>;

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

  // --- tasks inside actions (backend 1.7.0) ---
  /** Adds one task (Open) to an action that is not Closed / Cancelled (actions Edit). */
  addTask(token: string, actionId: string, task: NewTask): Promise<TaskResult>;
  /**
   * Changes one task (actions Edit). Done needs `note` (what was done) and Not needed a reason, 3+ characters; Contractor informed
   * only for an external contractor's task. The action's status follows (Open <-> In progress); when the last open task closes,
   * the closers get action_ready_to_close. On a Closed / Cancelled action only a note may be added. Tasks are never deleted.
   */
  updateTask(token: string, taskId: string, changes: TaskChanges): Promise<TaskResult>;
  /** Adds the template's steps the action does not have yet (matched by template_step), due from today (actions Edit). */
  applyTemplate(token: string, actionId: string, templateId: string): Promise<TaskResult>;
  /** Tasks across all actions, filtered on the server (actions View): the Tasks tab and the Shutdown list. */
  listTasks(token: string, filter?: TaskFilter): Promise<TaskList>;
  /** Every task template with its steps (any signed-in user; also part of listActions). */
  listTaskTemplates(token: string): Promise<TaskTemplate[]>;
  /** Inserts or updates the templates sent, replacing their steps (settings Edit). Returns all templates. */
  saveTaskTemplates(token: string, templates: TaskTemplateInput[]): Promise<TaskTemplate[]>;

  // --- email (backend 1.9.0, backend/apps-script/Mail.js) ---
  /**
   * Sends a report or an actions report (reports Edit, or the Admin role): 1-25 To, up to 25 Cc (any domain), a subject,
   * an HTML summary (cleaned on the server) and up to 3 attachments (PDF, Excel, CSV; 15 MB together). At most 30 a day each.
   */
  sendReport(token: string, email: OutgoingEmail): Promise<SendResult>;
  /** A short test email to the Admin's own address; says which sender was used (Admin role only). */
  sendTestEmail(token: string): Promise<SendResult & { to: string }>;

  // --- admin only (backend 1.6.0, the Admin role ROLE-ADMIN whatever the tab access says) ---
  /** Every user with when they were last seen, the page open and the device; online ones first. */
  listActiveUsers(token: string): Promise<ActiveUsersPayload>;
  /** The audit log newest first, filtered on the server, one page at a time (cursor from the previous page). */
  listAuditLog(token: string, filter?: AuditFilter, cursor?: string | null): Promise<AuditPage>;
}
