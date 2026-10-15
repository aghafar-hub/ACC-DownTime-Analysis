# Wire protocol and server rules

Contract between the app (`src/api/sheetsApi.ts`) and the Apps Script backend
(`backend/apps-script`). TypeScript signatures are in `src/api/types.ts`; table
columns are in `schema/tables.json`. A future database backend must keep this
contract.

## 1. Transport

- One endpoint URL (the Apps Script web app).
- Every call is `POST` with header `Content-Type: text/plain;charset=utf-8` (avoids a CORS preflight)
  and a JSON body:

```json
{ "action": "getEvents", "token": "<session token or empty>", "params": { "year": 2026 } }
```

- `params` keys are exactly the TypeScript parameter names that follow `token`
  in `Api` (for example `editEvent` -> `{ "eventId", "changes", "note" }`,
  `uploadFinish` -> `{ "batchId", "summary", "warnings" }`,
  `saveEquipment` -> `{ "row", "areaIds" }`, `login` -> `{ "email", "password", "keepSignedIn" }`,
  `changePassword` -> `{ "current", "next" }`, `uploadChunk` -> `{ "batchId", "rows" }`,
  `createUser` -> `{ "u" }`, `updateUser` -> `{ "userId", "changes" }`,
  `setUserTabAccess` -> `{ "userId", "overrides" }`, `setNotificationState` -> `{ "notificationId", "state", "snoozeUntil" }`,
  `saveNotificationPrefs` -> `{ "prefs" }`; `getNotifications` and `runNotificationChecks` take no params;
  `createAction` -> `{ "input", "options" }`, `updateAction` -> `{ "actionId", "changes" }`, `addActionComment` -> `{ "actionId", "text" }`,
  `saveContractors` -> `{ "rows" }`, `getAreaTargets` -> `{ "year" }`, `saveAreaTargets` -> `{ "year", "rows" }`; `listActions` and
  `runActionChecks` take no params).
- Success: `{ "status": "ok", "data": <result> }`.
- Failure: `{ "status": "error", "error": { "message": "<plain English>", "code": "<code>", "accessDenied": false } }`.
- Error codes: `bad_request`, `unauthenticated` (missing/invalid/expired token), `forbidden`
  (`accessDenied: true`), `locked`, `bad_credentials`, `not_found`, `conflict`, `busy`, `server`.
- `GET` with `?action=ping` returns `{ "status": "ok", "data": { "version": "..." } }` (install check, no auth).

## 2. Session token

`base64url(JSON{ uid, role, iat, exp, pv }) + "." + hex(HMAC-SHA256(payloadB64, SESSION_SIGNING_SECRET))`
with `iat` / `exp` in epoch milliseconds; `pv` is a short fingerprint of the user's current password hash, so changing or resetting a password ends every open session (the server compares it on each call). Issued only by `login` and
`changePassword`. The server re-reads the user (active, role, lock) on every call;
a deactivated user is refused even with a valid token. The client may decode the
payload for display of expiry only, never as a security check.

## 3. Access per action

Levels: Hidden < View < Edit. A user override in `tab_access` (`subject_type=user`)
wins over the role row. Missing row = Hidden.

| Action | Requirement |
|---|---|
| `login` | none |
| `changePassword`, `getMyAccess` | any valid session |
| `getStartup` | any valid session with at least one non-Hidden tab |
| `getEvents` | `overview`, `pareto`, `repeats`, `reliability`, `reports`, `actions` or `events` at View or Edit |
| `getEventEdits` | `events` View |
| `getUploadHistory`, `getUploadWarnings` | `upload` View |
| `uploadStart`, `uploadChunk`, `uploadFinish` | `upload` Edit |
| `editEvent`, `voidEvent`, `revalidateEvents`, `acceptEventFlags` | `events` Edit |
| `saveEquipment`, `saveArea`, `saveReason`, `saveAlias`, `deleteAlias` | `master` Edit |
| `setAreaActive` | the Admin role (`ROLE-ADMIN`), whatever the tab access (backend 1.5.0, section 11) |
| `saveSettings` | `settings` Edit |
| `listUsers` | `users` View |
| `createUser`, `updateUser`, `resetPassword`, `setUserTabAccess` | `users` Edit |
| `getNotifications`, `setNotificationState`, `saveNotificationPrefs` | any valid session (not while a temporary password is still unchanged); only the caller's own state and preferences are read or written |
| `runNotificationChecks` | `settings` Edit |
| `listActions` | `actions` View |
| `createAction`, `updateAction`, `addActionComment` | `actions` Edit (closing, cancelling, reopening and changing a closed action also need the caller in `actions_closers` or the Admin role, checked in the action: section 10) |
| `getAreaTargets` | any valid session |
| `saveContractors`, `saveAreaTargets`, `runActionChecks` | `settings` Edit |
| `logout` | any valid session, also with a temporary password (backend 1.6.0, section 12) |
| `listActiveUsers`, `listAuditLog` | the Admin role (`ROLE-ADMIN`), whatever the tab access (backend 1.6.0, section 12) |
| `addTask`, `updateTask`, `applyTemplate` | `actions` Edit (backend 1.7.0, section 13) |
| `listTasks` | `actions` View (backend 1.7.0) |
| `listTaskTemplates` | any valid session (backend 1.7.0) |
| `saveTaskTemplates` | `settings` Edit (backend 1.7.0) |

`getStartup.years` is sorted newest first.

Notifications are not tied to a tab: a viewer with every tab hidden still gets alerts and updates. What a person sees is
decided inside the action (section 9), never by the client.

`getStartup` hides master data a user may not see only by tab: the data is the
same for everyone who can read any dashboard (areas, equipment, reasons,
settings). The `users` and `audit_log` tables are never returned by it.

## 4. Normalisation rules (identical in client and server)

- `code_key(code)` = upper-case, remove all whitespace, collapse runs of `.` into one `.`.
- Area-level code: `code_key` is `N/A` or `NA`.
- Alias resolution: look up `code_key` in `equipment_aliases.alias` (also stored in
  `code_key` form); if found use its `equipment_id`.
- `equipment_id` = the resolved code if it exists in `equipment`, else empty (and flag `unknown_code`).
- `match_key(text)` = trim, collapse whitespace to single spaces, lower-case.
- `reason_id` = the `reasons` row with the same `classification` and `match_key`
  (if several, the lowest `order_no`); empty if none (flag `unlisted_reason`);
  blank reason gives flag `blank_reason`. A reason is only looked up when the classification is valid.
- `classification` is trimmed and upper-cased (`Aut` becomes `AUT`). A blank or unknown text is kept as written
  (upper-cased) and flagged, see 4a.
- `area_id` is matched against the area list ignoring letter case and stored in the list's spelling; an area that is
  not in the list is stored as written (trimmed) and flagged. `line_id` is stored as written.
- `duration_s` = (`start_ts` - `stop_ts`) in seconds from the two plant-local timestamps
  (no time-zone conversion). `start_ts` earlier than `stop_ts` is flagged `end_before_start`.
- Fingerprint and `event_id`: see the comment at the top of `src/api/types.ts`.

### 4a. Data checks (flags) and the blocking rule

**Import never drops a row.** Every row of a workbook becomes a stored event. A row with a data problem is stored
with flags in `events.flags` (comma separated) and is fixed later by an authorised user on the Validate page.
Nothing is excluded, nothing is silently rejected, nothing is corrected without a trace (a fix is an `editEvent`
with a note and an `event_edits` row).

The server computes the flags on `uploadChunk`, on `editEvent` and on `revalidateEvents`, in this fixed order:

| Flag | Kind | Set when |
|---|---|---|
| `missing_classification` | blocking | the classification is empty |
| `invalid_classification` | blocking | the classification is not PRO, MEC, ELE, AUT, PL or CIR |
| `unknown_area` | blocking | `area_id` is not in `areas` (blank included) |
| `end_before_start` | blocking | `start_ts` is earlier than `stop_ts` |
| `missing_code` | warning | the equipment code is empty |
| `unknown_code` | warning | the code is not blank, not N/A and does not resolve (alias or equipment) |
| `placeholder` | warning | the `code_key` is `AFR` or `AFR2` |
| `blank_reason` | warning | the reason is empty |
| `unlisted_reason` | warning | the classification is valid, the reason is not empty and matches no listed reason |
| `code_not_in_area` | information | the code resolves to an equipment that has areas, and the row's (known) area is not one of them. The flag stays stored exactly as before; the client treats it as information ("Cause in another area"), not as a problem: not listed on Validate, not counted in badges, banners or filters |
| `line_mismatch` | warning | the area is known and `line_id` differs from the area's line (the area decides the line) |

Two **derived** flags are worked out in the browser and never stored:
- `overlap_in_area` (information): two events of one area covering the same time, tolerance 1 s (`src/calc/overlaps.ts`).
  Overlapping stops of one area are counted once in every figure (union per area, `src/calc/attribution.ts`), so it is
  nothing to fix; Validate shows it apart, as information.
- `failure_flag_mismatch` (warning): Failure = YES on a PL or CIR row, or on a continuation (Freq = 0) row. Such a row is
  never a failure event; the digest counts it as a record to validate until it is kept as entered.

`orphan_continuation` and `duration_mismatch` are upload-time warnings only and are not stored either.

**Blocking rule.** A record that carries a blocking flag stays in the table and is shown, but is left out of every
calculation (KPIs, Pareto, repeats, trends, overlaps) until it is fixed, exactly like a voided record.
Records with only warning flags are analysed as they are. The calc layer applies this in one place
(`applyFilters`, `buildFailureEvents` and the entry points of the other modules; `includeInvalid` keeps them).
The line of an event, for filtering, is the line of its area in the master data, never `events.line_id`.

## 5. Upload (server side)

`uploadStart` creates a `Started` batch. `uploadChunk` (about 300 rows) is
idempotent: the server recomputes each row's fingerprint, skips rows whose
`fingerprint` already exists (counted as `identical`), and inserts the rest,
resolving ids and flags per section 4 and 4a.

**Hard rejects** are the only rows the server refuses (returned in `rejected`, not
inserted), because they cannot be stored at all: unreadable `event_date`, `stop_ts` or `start_ts`; `freq` not 0
or 1; criticality not INC / NO_INC; `is_failure` not a boolean (and values of the wrong type). A blank area, line, code
or classification, an unknown area, a line that does not match the area and an invalid classification are **not**
rejected: the row is stored with flags. The browser refuses the whole file before sending when it finds such rows
(it lists them: fix in Excel and choose the file again), so nothing is imported and nothing is lost.

`uploadFinish` stores the warnings the client computed (including `late_month` entries with
resolution `added` or `skipped`, one per month the user decided as a whole, and `late_row` entries for single late
rows), writes the batch totals, sets `Completed`, and appends to `audit_log`. All writes happen inside the script
lock; a busy lock returns `busy` ("Server is busy - please try again.").

**Late data.** A new row dated after the latest stored date is plain new. A new row on or before that date is "late":
if its month (`YYYY-MM` of `event_date`) has no stored non-void events at all, the month is decided as a whole (Add
month or Skip month); if the month already has stored events, the row is decided on its own (Add or Skip). The
decision is made in the browser; rows that are skipped are not sent.

## 6. Editing, re-checking and voiding events

`editEvent(eventId, changes, note)`:

- `note` is required (non-empty).
- Only fields in `EditableEventField` may change. The fingerprint never changes.
- `classification` may only be set to one of the six valid codes, `area_id` only to a known area, `line_id` only to a
  known line (plain-English errors otherwise). When `area_id` changes and `line_id` is not given, the line follows the area.
- After applying: recompute `duration_s`; resolve `equipment_id` / `reason_id` and recompute **all** flags (section 4a);
  if `classification` changed and `criticality` was not given, set `criticality`
  from `classifications.is_incident` (INC / NO_INC), unless the old classification was blank or unknown (the sheet's
  value stays); if `criticality` or `freq`
  changed and `is_failure` was not given, set `is_failure = (criticality == INC and freq == 1)`.
- Set `edited = TRUE`.
- Write one `event_edits` row per changed field (old and new value as text) and one `audit_log` row.
- Return the updated `EventRow`.

`revalidateEvents(year?)` recomputes the flags (and the derived `equipment_id`, `reason_id`, `is_area_level`,
`duration_s`) of every non-void event, of one year or of all years, against the current Master Data, so that a code,
alias, reason or area added later clears the flags it explains. Only rows whose flags or derived values changed are
written back (consecutive rows in one `setValues` call), under the script lock. It is not an edit: no `event_edits`
row, `edited` unchanged. One `audit_log` row. Returns `{ checked, changed }`. Needs `events` Edit.

`voidEvent(eventId, isVoid, note)` sets `is_void`, writes an `event_edits` row
(`field = is_void`) and an `audit_log` row. Voided events stay in the table and
are excluded from analysis.

### 6a. Keep as entered (`acceptEventFlags`, backend 1.3.0)

`acceptEventFlags(eventId, flags, note)` lets a person say "this record is correct exactly as entered" for the data-check flags
(section 4a) it carries. Nothing in the record changes.

- Needs `events` Edit. `flags` is a list and is the **full new accepted set**: sending fewer flags undoes some, an empty list
  undoes all. Every name must be a known flag (the four blocking, six warning, information `code_not_in_area` and the derived
  `overlap_in_area` (information) and `failure_flag_mismatch` (warning); `KNOWN_FLAG_NAMES` in `Config.js` mirrors `src/calc/flags.ts`).
  A flag must be one the record carries in `events.flags` (or already accepted, or one of the two derived flags, which are never stored).
- `note` is required, at least 3 characters (also for an undo), at most 500.
- Stored in `events`: `accepted_flags` (comma separated, catalogue order), `accepted_by` (user_id), `accepted_at` (timestamp). An empty
  set clears all three. `flags`, `edited`, `equipment_id` and every other field stay as they are; no flag is recalculated.
- Writes ONE `event_edits` row (`field = accepted_flags`, old and new value, the note) and one `audit_log` row (`accept_event_flags`).
- Refused: a voided event (`conflict`), an unknown flag or a short note (`bad_request`), a flag the record does not have, and a change
  that changes nothing (`bad_request`, "Nothing was changed.").
- **Pruning.** After `editEvent` or `revalidateEvents` recomputes the flags, accepted flags the record no longer carries are dropped
  (`accepted_by`/`accepted_at` are cleared when nothing is left) and an `event_edits` row records it ("Removed automatically: ...").
  The derived flags (`overlap_in_area`, `failure_flag_mismatch`) are kept until the user undoes them. Upload never touches stored rows.
- **Meaning for the numbers.** An accepted warning flag is resolved: the record is normal everywhere. An accepted blocking flag stops being
  something to fix (not listed on Validate, not in the badge, the banner or the notifications) but the record is still left out of the
  calculations, because the blocking rule (section 4a) reads the stored `flags`, never `accepted_flags`.
- **Notifications.** The server rules still leave out blocked records (stored flags). The digest counts only open problems: a record
  whose problems are all accepted is not counted as "to validate", "left out of the numbers" or "unknown or placeholder code".

`getEvents` returns the three new columns on every event.

## 7. Passwords and accounts

- Passwords never leave the server in any form; `createUser` and `resetPassword`
  return a one-time `temp_password` (shown once by the app).
- Hash: iterated HMAC-SHA256 with a per-user salt (from `Utilities.getUuid()`),
  a server-wide pepper (Script Property `PASSWORD_PEPPER`), and `hash_rounds`
  stored per user so the cost can be raised later (login rehashes when the stored
  rounds are below the current default). Comparison is constant-time.
- Failed sign-ins: counter per user; at `lockout_attempts` set `locked_until`
  (`lockout_minutes`). Error for a bad email and a bad password is the same message.
- Minimum length from `settings.min_password_length`; the new password must differ
  from the temporary one. A user with `must_change = TRUE` can only call
  `changePassword`, `getMyAccess` and `login`.
- Script Properties: `SESSION_SIGNING_SECRET`, `PASSWORD_PEPPER`, `SPREADSHEET_ID`.
  Never stored in a sheet or in git.

## 9. Notifications

Design: `docs/notifications-design.md`. Code: `backend/apps-script/Notifications.js` (server rules, plain JS) and
`src/api/mockNotifications.ts` (the same rules for the mock, written with `src/calc`). `tests/unit/contract.test.ts` runs one
scenario against both and expects identical rows. Action items (records to validate, unknown codes, `needs_review`) are
derived by the app from live data and are never stored.

### 9.1 Actions

| Action | Params | Result |
|---|---|---|
| `getNotifications` | none | `{ items, state, prefs }` |
| `setNotificationState` | `notificationId`, `state` (`seen` / `snoozed` / `dismissed`), `snoozeUntil` | the caller's `NotificationState` row |
| `saveNotificationPrefs` | `prefs` (object) | all of the caller's prefs (`Record<string,string>`) |
| `runNotificationChecks` | none | `{ created, resolved, expired }` |

- `items`: stored rows with `status = open` that have not passed `expires_at` (resolved and expired rows stay in the sheet
  but are never returned), newest first. Rows of type `user_event` are returned only to people whose access to the `users`
  tab is not Hidden. Backend 1.7.0: a row with `recipients` (comma-separated user ids and/or `@closers` = the people in
  `actions_closers` and the Admins, resolved when read) is returned only to them; blank `recipients` = everyone. Everyone signed in
  sees all other alerts and updates; the app filters them with the person's watched areas.
- `state`: only the caller's rows, only for returned items. `prefs`: only the caller's rows. Neither can be read or written for
  another person; a `userId` sent by the client is ignored.
- `setNotificationState`: the notification must be visible to the caller (else `not_found`). `snoozed` needs `snoozeUntil`:
  a plant-local timestamp `YYYY-MM-DD HH:MM:SS(.mmm)` or a date `YYYY-MM-DD` (midnight), in the future and less than 366 days ahead.
  For `seen` and `dismissed` the snooze time is cleared. One row per user and notification (upsert).
- `saveNotificationPrefs`: unknown keys are refused, nothing is saved when any value is invalid. Keys: `alert_types` (csv of
  notification types, blank = all), `watch_areas` (csv of existing area ids, blank = all; stored in the master spelling),
  `digest` (`none` / `daily` / `weekly`), `last_seen_at` (timestamp, stored as `YYYY-MM-DD HH:MM:SS.mmm`), `saved_views`
  (JSON text up to 20000 characters: a list of at most 20 objects `{ id: text 1-40, name: text 1-60, page: overview | pareto |
  repeats | reliability | events, query: text up to 1500 }`, no other fields, unique ids; checked on the server and stored as
  given; blank clears them), `saved_reports` (JSON text up to 20000 characters: a list of at most 20 report templates
  `{ id: text 1-40, name: text 1-60, template: monthly | area | failure | custom, period: { preset: lastmonth | thismonth | last3 |
  ytd | custom, from: date or blank, to: date or blank (not before from), compare: true | false }, filters: { lines, areas,
  equipment: lists of text 1-60; classifications: list of PRO | MEC | ELE | AUT | PL | CIR; criticality: list of INC | NO_INC;
  failuresOnly: true | false }, sections: list of section ids (cover, summary, daily, monthly, classes, area_downtime,
  availability, mtbf_mttr, failure_rate, top_equipment, top_reasons, pareto, repeats, longest, quadrant, when, events, quality,
  methodology), options: { <section id>: { top: whole number 1-1000 or "all", measure: hours | count } } }`; every list at most
  100 entries without repeats, no other fields, unique ids; checked on the server and stored as given; blank clears them),
  `theme` (backend 1.5.0: one of `ACC Light`, `Warm Paper`, `High Contrast`, `Navy Dark`, `Carbon Dark`, exactly; blank clears it;
  section 11.2). `last_digest_at`
  is written by the server when it sends a digest; it is returned by `getNotifications` but cannot be saved.
- `runNotificationChecks`: runs every rule now, audited as `notification_check`.

### 9.2 Settings

`notif_long_stop_hours` (8, whole hours 1-720), `notif_spike_pct` (30, 1-1000), `notif_upload_gap_days` (35, 1-3650),
`notif_repeat_alert` (`true` / `false`), `notif_retention_days`
(30, 1-3650), `app_url` (blank or `http(s)://...`, no spaces or quotes, up to 300 characters). Validated by `saveSettings` like
every other setting; a database without these rows uses the defaults until `seedDefaults` adds them.

Targets (backend 1.3.0): `availability_target_pct` (blank = off, 0-100; also the threshold of the `availability_low` alert), `target_mtbf_h` and
`target_mttr_h` (blank = off, more than 0 and at most 100000 hours). Validated by `saveSettings` like every other setting.

### 9.3 Rules

All rules leave out voided events and events with a blocking flag, exactly like the app (section 4a), and chain rows into events
with the app's algorithm (1 s tolerance, a Freq = 0 row joins the open event it continues; an exact duplicate row, same area, code,
stop, restart and classification, is one stop). A **failure event** is a chain whose head row has Freq = 1, Failure = YES and a
class other than PL and CIR (owner decision P2; `src/calc/events.ts` `isFailureHead`).
"Latest event date" `L` is the largest `event_date` of any stored non-void event. "Today" is the plant-local date of the server clock.

| Type | Raised when | `dedupe_key` | Resolved when |
|---|---|---|---|
| `long_stop` | a failure event (chain) lasts more than `notif_long_stop_hours` (summed hours of its rows) | `long_stop\|<event_id of the head>` | the event is voided, edited below the limit or the limit is raised |
| `repeat_group` | at least `repeat_min_events` OCCURRENCES with the same code and reason (code after alias resolution, reason compared by `match_key`, blank reasons and area-level N/A excluded) start within `repeat_window_days` of each other (sliding window, exactly the window still counts); one occurrence = one failure event, or several failure events in DIFFERENT areas that start within 10 minutes of the occurrence's first event (P5); one alert per cluster, when it first exists; needs `notif_repeat_alert = true`. The detail's "N failures" counts occurrences | `repeat\|<area of the first event>\|<code>\|<reason_key>\|<first event_id>` | the cluster no longer exists, or the switch is turned off |
| `failure_spike` | per area, failure EVENTS (by the head's stop time) in the 30 days ending on `L` are at least 5 and exceed the 30 days before by more than `notif_spike_pct` percent (any rise from zero counts) | `spike\|<area>\|<L>` | stays until it expires |
| `availability_low` | basis B = (T - PL - (INC + CIR)) / (T - PL) of an area for the latest complete month is below `availability_target_pct`. The month is the month of `L` if `L` is its last day, otherwise the month before; the window is clipped to the data range like the KPI cards. The area's downtime is the UNION of its stops (P1): time covered by several rows counts once, for PL first, then INC, then CIR (same class: the row that started first). A month without any non-void record is not uploaded and raises nothing. Off while the target is blank | `availability\|<area>\|<yyyy-mm>` | stays until it expires |
| `upload_gap` | today is more than `notif_upload_gap_days` after `L` | `upload_gap\|<L>` | newer data arrives (`L` changes) |
| `upload_done` (update) | `uploadFinish` completes an upload | `upload\|<batch_id>` | never |
| `user_event` (update) | a user is created, a password is reset, a role is changed | `user\|<kind>\|<user_id>\|<epoch ms>` (kind: `created`, `password_reset`, `role_changed`) | never |
| `planned_overrun` (1.4.0) | an area with `area_targets` for the year used more planned hours in a complete month than that month's allowance (`monthly_split`); section 10.4 | `planned\|<area>\|<yyyy-mm>` | stays until it expires |
| `action_due` (1.4.0) | an action that is not Closed or Cancelled has a `due_date` before today (plant date, server clock). 1.7.0: an action with tasks uses its `due_date_derived` (the latest due date of its open tasks) and is left out while it is a Draft | `action_due\|<action_id>\|<due date used>` | the action is closed or cancelled, or its due date moves |
| `task_overdue` (1.7.0) | an open task (not Done / Not needed) of an action that is not Draft, Closed or Cancelled has a `due_date` before today. `recipients` = the task's person and the action's owner (`assignee`); `@closers` when neither is set. `source_ref` = the action | `task_due\|<task_id>\|<due_date>` | the task is done or not needed, its due date moves, or the action is closed or cancelled |
| `action_ready_to_close` (1.7.0) | an action that is not Draft, Closed or Cancelled has at least one task and every task is Done or Not needed. `recipients` = `@closers`. Raised at once by the task change (and kept by the checks) | `ready\|<action_id>\|<number of tasks>` | a task is reopened or added, or the action is closed or cancelled (at once) |

Recency: a `long_stop` or `repeat_group` alert is only raised when the event (the last event of the cluster) started no more than
`notif_retention_days` before `L`. Older ones would expire at once, and without this the first check on a database with years of
history would raise hundreds of alerts. `failure_spike` and `availability_low` are about the latest data by construction.

Dedupe: `dedupe_key` is unique over all statuses. A check never creates a second row for a key. A `resolved` row is re-opened (new
expiry, same `notification_id`) if its condition returns; an `expired` row is never re-opened. Expiry: `expires_at = created_at +
notif_retention_days`; open rows past it become `expired` at the next check and are hidden from `getNotifications` right away.
`long_stop`, `repeat_group`, `upload_gap`, `action_due`, `task_overdue` and `action_ready_to_close` rows whose key is no longer produced
by the rules become `resolved` at the next check. When an open row's `recipients` change (a new person on the task), the check updates
them (1.7.0).

When checks run: at the end of `uploadFinish` (never fails the upload; also writes `upload_done`), on `runNotificationChecks`, and in
the daily job. Each time, the action checks (section 10.4) run right after them, best effort.

**Category** (1.4.0). Every item returned by `getNotifications` carries `category`, derived from `type` and not stored:
Reliability (`long_stop`, `repeat_group`, `failure_spike`), Availability & planned (`availability_low`, `planned_overrun`),
Data quality (`upload_gap`, `upload_done`), Actions (`action_due`, `task_overdue`, `action_ready_to_close`), System (`user_event`).
Alerts of the Actions category stay visible while their area is switched off (section 11). The table is `NOTIF_CATEGORY_` in
`Notifications.js` and `NOTIFICATION_CATEGORY_OF` in `src/api/types.ts`. `user_event` rows are written by `createUser`, `resetPassword` and `updateUser` (role change), best effort.

### 9.4 Digest e-mail

Sent by `sendDigest_` from the daily time trigger `notificationDailyJob` (Setup.js, created by `installNotificationTriggers()`, about
07:00 plant time). Per person, from `notification_prefs.digest`: `daily`, or `weekly` (sent only on Sunday, plant time). Only active
users with an e-mail address, at most one digest per person per plant-local day, and nothing is sent when there is nothing to say.
Content (plain text and simple HTML, counts and titles only, never event rows):

- Needs action (only what the server can count, for people who could act on it): records to validate (events with an OPEN flag: a stored flag
  other than the information flag `code_not_in_area` that nobody kept as entered, section 6a, or the derived warning
  `failure_flag_mismatch` (Failure = YES on a PL / CIR or Freq = 0 row) not kept as entered; overlaps are information and never
  counted; the number left out of the numbers because of a blocking flag), records with an
  unknown or placeholder code (needs `master` Edit), equipment to review (`needs_review`, needs `master` Edit). Pending late months
  are known to the browser only and are not in the e-mail.
- New alerts since the person's `last_digest_at`: open alerts of the person's `alert_types` and `watch_areas` (an alert without an
  area always matches), not dismissed by the person and meant for them (`recipients`, 1.7.0), at most 10, most severe first (long stop,
  availability, planned overrun, spike, repeated group, task overdue, action overdue, ready to close, upload gap), the rest as "and N more".
- A link from `app_url` (omitted when blank).

`MailApp` quota, permission and send errors are written to `audit_log` (`digest_failed`, with the user id, never the address) and never
raise; when the daily quota is used up the run stops. `last_digest_at` is saved only after a successful send.

## 10. Actions (backend 1.4.0)

**Backend 1.7.0 changed the statuses** (section 13): an action is Draft, Open, In progress, Closed or Cancelled; Contractor informed and
Waiting stoppage are task statuses; Open and In progress follow the tasks; closing needs every task Done or Not needed. What follows is
the 1.4.0 behaviour, which still holds for an action without tasks.

Design: `docs/actions-design.md` and the mockups in `docs/actions-mockups/`. Code: `backend/apps-script/Actions.js` (plain JS) and
`src/api/mockActions.ts` (the same rules for the mock, written with `src/calc`). `tests/unit/contract.test.ts` runs one scenario against
both and expects identical drafts, alerts and refusals. Tab: `actions` (Admin Edit, Manager Edit, Engineer Edit, Viewer View).

### 10.1 Tables and settings

- `actions`: one row per action. `action_id` is `AC-` + `yyyymm` (plant time of creation) + `-` + a 4-digit sequence within the month.
  `evidence` is stored as JSON text (a list of `{ event_id?, note?, added_at, added_by }`, at most 200: the oldest drop out) and sent as a
  list. Besides the fields of the design, the mockups needed `assignee` (the person following it up: a user id or a free name),
  `needs_stop`, `root_cause` (blank, PRO, MEC, ELE, AUT, OPR, EXT) and `required_action`.
- `action_log`: append-only history, `kind` = `status` (with `from_status`, `to_status`; the text is the closing note), `comment`,
  `edit` (one row per call: `field: old -> new` joined with `; `, long texts only as `title changed`), `evidence`. `by` is a user id
  or `system`. Rows written in the same millisecond keep their order.
- `contractors`: `contractor_id`, `name`, `areas` (csv, sent as a list), `kind` (`contractor` external / `internal` team), `active`,
  `sort_order`, `default_assignee`. Seeded: RHI (CR, RM.1, RM.2, K.1, K.2, HD, AFR, AFR new, SHR, FM.1, FM.2, HY.1, HY.2), ASEC (CM.1-CM.4,
  PK.1, PK.2) and the internal teams MEC Mechanical, ELE Electrical, AUT Automation, PRO Production. An area belongs to at most one active
  external contractor.
- `area_targets`: per area and year, `availability_target_pct` (blank = none), `planned_allowance_h_year`, `monthly_split` (JSON text of
  12 hours, sent as a list), `overhaul_months` (csv, sent as a list of numbers), `updated_at`, `updated_by`.

Settings (validated by `saveSettings`): `actions_closers` (csv of existing user ids, cleaned of repeats; Admins can always close),
`actions_repeat_n` (3, 2-100), `actions_repeat_days` (30, 1-3650), `actions_chronic_top` (10, 1-100), `actions_chronic_months` (3, 1-24),
`actions_effect_days` (60, 1-3650), `actions_auto_draft` (`true` / `false`).

### 10.2 Calls

| Action | Params | Result |
|---|---|---|
| `listActions` | none | `{ actions, logs, contractors, people, closers, can_close }`: every action (newest first) and log row (oldest first); `people` = active users as `{ user_id, display_name }` only |
| `createAction` | `input` (`NewAction`), `options` (`{ merge }`, optional) | `{ action, logs, merged }` |
| `updateAction` | `actionId`, `changes` (`ActionChanges`) | `{ action, logs }` |
| `addActionComment` | `actionId`, `text` (1-2000 characters) | `{ action, logs }` |
| `saveContractors` | `rows` (`Contractor[]`, 1-50) | every contractor |
| `getAreaTargets` | `year` (optional) | the targets of the year (all years when left out) |
| `saveAreaTargets` | `year`, `rows` (`AreaTargetInput[]`, 1-100) | the targets of the year |
| `runActionChecks` | none | `{ created, merged, effectiveness }` |

- `createAction`: `title` and `scope_kind` are required; defaults Draft, Medium, `manual`; Closed and Cancelled are refused. Scope:
  `equipment` needs an equipment code of Master Data (area and line follow it when left blank), `area` needs an area (the line
  follows it), `line` needs a line, `plant` clears all three. `owner` is blank or an active contractor or team (`owner_kind` follows it).
  `reason_key` is stored in `match_key` form. A blank `dedupe_key` of an equipment action with a reason becomes
  `repeat|<equipment>|<reason_key>`, so "same equipment + reason" is one action whoever creates it.
- **Dedupe.** When an action that is not Closed or Cancelled has the same `dedupe_key` (the oldest such action), the new evidence is added
  to it (an event already listed is not added twice), one `evidence` log row says so and that action is returned with `merged: true`.
  `options.merge: false` always creates a new action.
- `updateAction`: fields `title`, `detail`, `status`, `priority`, `scope_kind`, `area_id`, `line_id`, `equipment_id`, `reason_key`, `owner`,
  `assignee`, `due_date`, `needs_stop`, `root_cause`, `required_action`, `closure_note`, plus `add_evidence`. Any open status may move to
  any other. Moving to or from Closed or Cancelled, and any change to a closed or cancelled action, needs the caller in `actions_closers`
  or the Admin role (`forbidden` otherwise). Closing or cancelling needs `closure_note` of at least 3 characters and sets `closed_by`,
  `closed_at`; closing an equipment action sets `effectiveness` to Watching. A closed or cancelled action reopens only to Open, which
  clears the closing fields and the effectiveness. `closure_note` alone may only be written on a closed or cancelled action. A call that
  changes nothing is refused ("Nothing was changed."). Comments are allowed on any action, closed ones included.
- `saveContractors` inserts or updates the rows sent (by id); others stay (switch one off with `active: false`). Areas are matched without
  regard to case and stored in the master spelling; two active external contractors for one area give `conflict`.
- `saveAreaTargets` inserts or updates the targets of the areas sent for the year. `monthly_split` left out is the even split (2-decimal
  months, December takes the rounding rest; `evenMonthlySplit` in `src/api/types.ts`); when sent it must be 12 numbers of 0 or more adding
  up to the allowance within 0.1 h. Allowance 0-8784 h, target 0-100 or blank, overhaul months whole numbers 1-12 (repeats dropped, sorted).

### 10.3 Draft rules

Only when `actions_auto_draft` is `true`. Every rule uses the notification rules' data (section 9.3): voided and blocked events left out,
rows chained into events, a failure event as P2, the code after alias resolution (area-level N/A never), the reason in `match_key` form,
and `L` = the latest event date. A draft is a Draft action by `system`, owner = the active external contractor of its area (blank,
internal, when none) with that contractor's `default_assignee`, evidence = the event ids listed.

| Rule (`source`) | Raised when | `dedupe_key` | Priority |
|---|---|---|---|
| `auto_repeat` | the same equipment and reason has at least `actions_repeat_n` occurrences (P5, as `repeat_group`) within `actions_repeat_days`; the latest cluster of the group only, and only when its last occurrence started on or after `L - actions_repeat_days`. Area = the area of the last occurrence. Evidence = every failure event of the cluster | `repeat\|<equipment>\|<reason_key>` | Medium |
| `auto_chronic` | the equipment is in the top `actions_chronic_top` by failure hours in each of the last `actions_chronic_months` complete months (the month of `L` when `L` is its last day, else the month before, and the months before it). Failure hours of a month = the summed hours of the equipment's failure events that started in it (whole events, by the head's stop); ties: more hours first, then the code. Evidence = its failure events of the last month | `chronic\|<equipment>\|<last yyyy-mm>` | High |
| `auto_long_stop` | an open `long_stop` alert whose event is still in the data; `source_ref` = the notification id; scope equipment (area for N/A) | `long_stop\|<event_id>` | High |
| `auto_planned_overrun` | a planned overrun (10.4); `source_ref` = the `planned_overrun` notification id when it exists; scope area; evidence = the PL rows of the area that started in the month | `planned\|<area>\|<yyyy-mm>` | Medium |

A draft whose key has an open action adds only the evidence that action does not have yet (one `evidence` log row; counted as `merged`).
A key that already has a Closed or Cancelled action is never drafted again, except `auto_repeat` when the cluster's last occurrence started
after the latest `closed_at` of those actions.

### 10.4 Planned overrun, effectiveness, when the checks run

- **Planned overrun.** For every `area_targets` row and month: PL hours = the area's planned time in the month, overlapping stops counted
  once and owned PL first (P1, as availability). Checked for complete months (last day on or before `L`) whose last day is on or after
  `L - notif_retention_days`. Raised when PL hours > `monthly_split[month]`. The alert's detail gives the year to date: PL hours from 1 January
  to the month's end against the allowance of January to the month.
- **Effectiveness** of a Closed equipment action (D = `actions_effect_days`): failure events of the equipment, and of the action's reason
  when it has one, that started in the D days before `closed_at` against the D days from `closed_at`. While `L` + 1 day is before
  `closed_at` + D days: Watching. Then no failure after = Effective; at least as many failures after as before = Not effective; fewer failures =
  Effective when the hours fell as well, else Not effective. The verdict is final (it is not judged again) and logged by `system` with the
  counts. Runs whether or not `actions_auto_draft` is on.
- **When.** At the end of `uploadFinish` and of `runNotificationChecks` (after the notification rules, so a new long stop already has its
  alert), in the daily job, and on `runActionChecks` (audited as `action_check`). The automatic runs never fail the call they follow; a
  problem is written to `audit_log` (`notification_failed`, "actions after ..."). A check is idempotent: run twice, the second run changes
  nothing.

## 11. Areas switched off and the theme with the account (backend 1.5.0)

### 11.1 Areas switched off

`areas.active` has always meant "shown in the app": the scope bar, the Reports builder, the new-action dialog and the timeline
already left inactive areas out of their lists, and the scheduled time `T` of availability counts only active areas. From 1.5.0 an
inactive area also hides its **records**, everywhere, as if they did not exist. Nothing is deleted: switching the area on again brings
everything back.

| Action | Params | Result |
|---|---|---|
| `setAreaActive` | `areaId` (text), `active` (true / false) | the area row as stored |

- Only the Admin role (`ROLE-ADMIN`): everyone else gets `forbidden` (with `accessDenied`). `not_found` for an unknown area,
  `bad_request` when `active` is not a boolean. A change is audited as `deactivate_area` / `activate_area` (entity `areas`); sending
  the value the area already has changes and logs nothing.
- `saveArea` (master Edit) may still save an area, but changing its `active` (or adding an area that is not active) needs the Admin role,
  else `forbidden`. The app offers the switches in Settings > Areas (Admins only).
- `getEvents` still returns the records of inactive areas (the upload compares against them, and Validate says how many are hidden).
  The app leaves them out in one place (`src/data/activeAreas.ts`, used by the event hooks), so every dashboard, chart, table, Pareto,
  repeat, reliability and availability figure, month vs month, heat map, report, export, Event records list and timeline, Since your last
  visit, the data status strip and the Validate list and badge are worked out without them. The data status strip says which areas are
  inactive; Validate says how many of their records would need checking.
- The server rules read the events without the inactive areas (`notifLoadContext_`): long stop, repeated failure, failure spike,
  availability below target, planned overrun and the action draft rules raise nothing for them, and a long stop or repeat alert of an
  area switched off is resolved by the next check (and re-opened when the area is switched on again, as for any resolvable alert).
  The effectiveness of a closed action of an inactive area is not judged until the area is active again (it would otherwise read as
  "no failure after").
- `getNotifications` and the digest leave out the alerts whose `area_id` is inactive, except `action_due`: actions of an inactive area
  stay on the Actions page (marked in the app) and so do their overdue alerts. The digest counts of records to validate leave the
  inactive areas out too.

### 11.2 The theme with the account

- The preference `theme` (section 9.1) is client-writable by any signed-in person for themselves.
- `login`, `changePassword` (the `Session`) and `getMyAccess` also return `theme`: the saved value, or `''` when none.
- The app applies the account's theme at sign-in, when it opens with a kept session and when the value changes on another device (the
  access refresh every 2 minutes); the theme kept on the device stays the fallback (sign-in page, offline, and a backend older than
  1.5.0, which refuses the unknown preference: the app then keeps the choice on the device without a message).

## 12. Who is online and the activity log (backend 1.6.0)

Two Settings subtabs for the Admin role only: **Active users** and **Activity log**. Both read-only; nothing in the existing data
changes. One new sheet, `user_activity` (run `ensureSchema`).

### 12.1 Activity (who is online)

| Action | Params | Result |
|---|---|---|
| `getMyAccess` | optional `activity`: `{ page, device }` | as before (section 2); the call is also the heartbeat |
| `listActiveUsers` | none | `{ now, online_minutes, online_count, today_count, users: [{ user_id, display_name, role_id, active, last_seen_at, last_page, device, online, today }] }` |
| `logout` | none | `null`; writes `logout` to the audit log |

- **Every** signed-in call (and every successful `login`) notes the caller's activity before the action runs. Noting never fails a
  call and never needs a separate request: the app's access check every 2 minutes (`getMyAccess`, skipped while the app is in the
  background, run again when it comes back to the front) is the heartbeat and carries `activity`.
- `activity.page`: the app address open (`/dashboard`, `/settings/areas`...; `^/[A-Za-z0-9/_.-]{0,79}$`); `activity.device`: `phone`
  (narrow window, or a small touch screen) or `desktop`. Anything else is ignored silently, never an error.
- **Throttle.** The script cache (`CacheService`, key `ua:<user_id>`, 6 h) keeps the exact last-seen time, page and device; it is read
  on every call and rewritten at most every 30 s (or when a hint arrives). The `user_activity` sheet (one row per user, upserted) is
  written at most once every **3 minutes** per user; with the cache empty or unavailable the sheet row itself is the throttle (read
  without the lock, written under a short lock of 1.5 s that is skipped, not waited for, when busy). Before `ensureSchema` has added the
  sheet nothing is written and everything else works.
- `listActiveUsers` merges the sheet, the cache (fresher) and `users.last_login_at` (a sign-in is activity too). `online` = active
  account and last seen in the last `online_minutes` (5) minutes; `today` = seen on today's plant date. Sorted online first, then
  last seen newest first. No e-mail addresses. The app refreshes the list every 60 s while the subtab is open.

### 12.2 Activity log

| Action | Params | Result |
|---|---|---|
| `listAuditLog` | `filter` `{ user_id?, group?, from?, to?, q?, limit? }`, `cursor?` | `{ entries: [{ at, user_id, action, entity, entity_id, detail, group }], next_cursor, scanned, users: [{ user_id, display_name }] }` |

- Newest first. `limit` 1-200 (default 100). `from` / `to` are plant dates, inclusive. `q` is case-insensitive text over action,
  record, record id, detail, user id and the user's name. `group` is one of the plain-English kinds: `signin` (login, login_failed,
  login_locked, logout, change_password), `users` (create_user, update_user, reset_password, set_tab_access, create_first_admin),
  `settings` (save_setting, save_contractors, save_area_targets), `master` (add_/update_ equipment, area, reason, alias; delete_alias),
  `events` (edit_event, void_event, unvoid_event, accept_event_flags, revalidate_events), `upload` (upload_start, upload_chunk,
  upload_finish), `actions` (create_action, merge_action, update_action, comment_action, action_check), `areas` (activate_area,
  deactivate_area), `notifications` (notification_check, notification_failed, digest_sent, digest_failed), `system` (seed_defaults and
  any action not listed). Mirrors: `AUDIT_GROUPS_` in `Audit.js` and `src/api/auditGroups.ts` (a test keeps them equal).
- `bad_request` for an unknown filter field or kind, a date that is not `YYYY-MM-DD`, a start after the end, a bad `limit` or a
  cursor that is not `r<row>`.
- **Reading a big log.** The audit sheet is only ever appended to, in time order, and never deleted from (retention: everything is
  kept). The server reads blocks of 1,000 rows from the bottom up and stops as soon as the page is full, so a page costs about the
  same however long the log grows. With an end date in the past it first finds the last row of that day by a binary search on the `at`
  column (about 17 single-cell reads for 100,000 rows); it stops at the first row older than the start date. At most 20,000 rows are
  looked at per call: a rare filter on a very long log may return fewer entries than `limit` together with a `next_cursor` ("Load
  more" continues). The cursor is the sheet row to continue from, which stays valid because rows are never moved.
- The app turns the stored details into sentences (`src/admin/settings/activityText.ts`) and shows names instead of ids; the CSV
  export pages through every entry of the filter in force (up to 20,000).

### 12.3 What is written to the audit log

Every write action leaves one row (a table-driven backend test calls each one): sign-in, failed sign-in, lock-out, sign-out, password
change; users (create, change with `field: old -> new`, password reset, page access `tab: old -> new`); settings (`old -> new` per
key), contractors and area targets (what changed per row); master data (equipment, areas, reasons, aliases with the changed fields
`old -> new`; alias deletes); events (edit with every changed field `old -> new` and the note, void, restore, keep as entered,
re-check); upload start, every chunk and the finish (file name, counts and the review decisions such as `late_month added 18`);
actions (create, merge, every change incl. status and evidence, comments from 1.6.0); tasks (1.7.0: `create_task`, `update_task` with
every change `old -> new`, the note and the action status it moved, `apply_template`, `save_task_templates` with the old and new steps,
`migrate_actions` once by setup); areas on / off; manual runs of the alert and action checks. Not logged: reads, a person's own notification state (seen, snoozed, dismissed) and own preferences (alert types, areas
followed, digest, saved views and report templates, theme). Passwords, temporary passwords and tokens are never written; details are
cut at 500 characters.

## 13. Tasks inside actions (backend 1.7.0)

Design: `docs/actions-mockups/tasks/` (README and screens, owner-approved). Code: `backend/apps-script/Tasks.js` (plus the changes in
`Actions.js` and `Notifications.js`) and `src/api/mockActions.ts`; `tests/unit/contract.test.ts` runs the same task scenario against both.
Two levels only: an **action** is the problem (one event or a group: equipment + reason), its **tasks** are the work.

### 13.1 Tables

- `action_tasks`: `task_id` (`AT-` + 12 hex), `action_id`, `seq` (1, 2, 3 within the action), `title`, `owner_kind` / `owner` (a contractor
  or team as for actions; blank owner = `internal`), `assignee` (the person: a user id or a free name), `due_date`, `status`, `needs_stop`,
  `est_stop_h` (blank when not estimated, always blank without a stop), `notes`, `template_step` (the template step title it came from;
  blank = added by hand), `created_*`, `updated_*`, `done_at` / `done_by` / `done_note` (set when it becomes Done or Not needed, cleared
  when it is reopened). **Tasks are never deleted**: a task that is not needed gets the status Not needed. At most 50 per action.
- `action_log` gains `task_id` and the kinds `task_create`, `task_status` (task statuses in `from_status` / `to_status`, the text is the
  note), `task_edit` (`#<seq> field: old -> new; ...`) and `task_note`.
- `actions` gains `template_id` (the template the tasks were first made from).
- `task_templates` (`template_id`, `name`, `applies_to` csv of action sources, `active`, `sort_order`, `updated_*`) and
  `task_template_steps` (`template_id`, `seq`, `title`, `default_owner` = `area_contractor` or a contractor / team id, `due_offset_days`
  0-365, `needs_stop`, `est_stop_h`). Seeded by `seedDefaults` when the id is missing (an existing template is never touched):
  - `TT-REPEAT` Repeated failure (for `auto_repeat`, `auto_chronic`): Repair (area contractor, 2 d, needs a stop) · Root cause (5-why)
    (MEC, 7 d) · Corrective action (area contractor, 21 d, needs a stop) · Spare parts (MEC, 14 d).
  - `TT-LONGSTOP` Long stop (for `auto_long_stop`): Restore and report (area contractor, 1 d) · Root cause (5-why) (MEC, 7 d) ·
    Corrective action (area contractor, 21 d, needs a stop).
  - `TT-PLANNED` Planned overrun (for `auto_planned_overrun`): Review planned work (PRO, 7 d) · Adjust allowance or plan (PRO, 14 d).
  - "Check after 60 days" is **not a task**: it is the action's effectiveness check (section 10.4), which starts when the action is
    closed. As a task it would block closing for 60 days.
- `notifications` gains `recipients` (section 9.1) and the types `task_overdue` and `action_ready_to_close` (section 9.3).

### 13.2 Statuses

- **Task**: Open, Contractor informed, Waiting stoppage, In progress, Done, Not needed. Any status may move to any other, with three
  rules: Contractor informed only for a task whose owner is an external contractor (`owner_kind = contractor`; changing the owner of
  such a task to a team is refused too); Done needs `note` (what was done) and Not needed needs `note` (the reason), at least 3
  characters. "Waiting stoppage" is the status; `needs_stop` says the work needs the area stopped (the Shutdown list).
- **Action**: Draft, Open, In progress, Closed, Cancelled. Draft stays until it is accepted by hand (`updateAction` to Open). With
  tasks, Open and In progress **follow the tasks**: In progress as soon as any task is not Open, Open when all are Open (the change
  is written by the caller as a `status` row "Follows the tasks: ..."). Accepting a draft or reopening a closed action lands on what
  the tasks say. Asking for Open or In progress against the tasks is refused (`bad_request`). Closed and Cancelled stay manual (closers
  only, note of 3+ characters, as in 1.4.0). **Closing is refused while any task is open** (error code `tasks_open`, "N tasks are still
  open: ..."); cancelling is not. An action without tasks behaves as in 1.4.0 (In progress by hand, its own due date, closing allowed).
- `updateAction` and `createAction` refuse the removed statuses Contractor informed and Waiting stoppage with a clear message
  (`bad_request`, "... is a task status since version 1.7.0 ...").
- **Due date**: an action with tasks returns `due_date_derived` = the latest due date of its open tasks ('' when none has one);
  `due_date` stays stored and is the due date of an action without tasks. `updateAction` refuses a new `due_date` on an action with tasks.
- On a Closed or Cancelled action, tasks cannot be added or changed; a note can still be added (`updateTask` with `note` only).

TS helpers for the app (`src/api/types.ts`): `TASK_STATUSES`, `TASK_CLOSED_STATUSES`, `isTaskOpen`, `actionProgress(action, tasks, today?)`
→ `{ done, total, open, overdue, nextDue, notNeeded, needsStop, stopHours }` (done counts Done and Not needed), `deriveActionStatus`,
`actionDueDate`, `canClose`, `isReadyToClose`, `taskStatusProblem`, `localToday`.

### 13.3 Calls

| Action | Params | Result |
|---|---|---|
| `listActions` | none | as 1.4.0 plus `tasks` (every task of the returned actions, by action and seq) and `templates` (every template with its steps) |
| `createAction` | `input` (`NewAction` + `tasks?: NewTask[]`, `template_id?`), `options` | `{ action, logs, tasks, merged }` |
| `updateAction`, `addActionComment` | as 1.4.0 | `{ action, logs, tasks }` |
| `addTask` | `actionId`, `task` (`NewTask`) | `TaskResult` `{ action, tasks, logs, task }` |
| `updateTask` | `taskId`, `changes` (`TaskChanges`: `title`, `owner`, `assignee`, `due_date`, `status`, `needs_stop`, `est_stop_h`, `notes`, `note`) | `TaskResult` |
| `applyTemplate` | `actionId`, `templateId` | `TaskResult` with `added` (0 when every step is already there) |
| `listTasks` | `filter` (`TaskFilter`, optional) | `{ tasks: TaskView[], today }` |
| `listTaskTemplates` | none | `TaskTemplate[]` |
| `saveTaskTemplates` | `templates` (`TaskTemplateInput[]`, 1-30) | every template |

- `createAction`: `tasks` (at most 50, each starts Open) are created with the action; when `tasks` is left out and `template_id` is given,
  the template's steps are created (owner `area_contractor` = the active external contractor of the action's area, else the named
  contractor or team; person = that owner's `default_assignee`; due = today + `due_offset_days`); with both, the tasks are created and
  `template_id` is only recorded. A switched-off or unknown template is refused. When the action is merged into an open one (dedupe), the
  tasks whose `template_step` that action does not have yet are added to it. The action's status follows its tasks from the start.
- `applyTemplate` adds the steps whose title is not yet the `template_step` of a task of the action; it sets `template_id` when the action
  has none.
- `updateTask` with only `note` adds a `task_note` row; with a status change the note goes on the `task_status` row (and into `done_note`
  for Done / Not needed). "Nothing was changed." when nothing would change.
- **Ready to close**: when the last open task of an accepted action closes, the closers get `action_ready_to_close` at once; reopening a
  task or adding one resolves it; closing or cancelling the action resolves it. Never for a Draft.
- **listTasks** (server-side filter; the same data is also in `listActions` for the board): tasks of actions that are not Draft
  (unless `include_drafts`) or Cancelled. `status` = `open` (default), `closed`, `all` or a list; `mine` (the caller is the task's
  person), `overdue` (open and due before today), `needs_stop`, `owner`, `assignee`, `area_id`, `line_id` (of the action), `action_id`,
  `done_since` (date). Each `TaskView` adds the action's title, status, owner, assignee, area, line, equipment, `overdue` and
  `waiting_since` (when it last moved to Waiting stoppage). Sorted overdue first, then by due date (no date last), action and seq. The
  Tasks tab uses it as is; the Shutdown list is `{ needs_stop: true }` grouped by area in the app.
- `saveTaskTemplates`: inserts (blank `template_id` gets `TT-` + 8 hex) or updates the templates sent and replaces their steps. Names
  are unique (case-insensitive, `conflict`), an action source belongs to at most one active template (`conflict`), 1-20 steps with
  unique titles, `default_owner` = `area_contractor` or an active contractor / team, `due_offset_days` 0-365, `est_stop_h` 0-1000 or blank
  (kept only with `needs_stop`). An unknown `template_id` is `not_found`. Templates are never deleted: switch one off. Changes apply
  to new actions only; existing tasks are not touched.
- **Auto drafts** (section 10.3): a new draft gets the tasks of the active template whose `applies_to` has the rule's source (lowest
  `sort_order` first), proposed (Open), with owners from the draft's area and due dates from the drafting day; `template_id` is set.
  An auto draft whose key has an open action only adds evidence, as before.

### 13.4 The 1.7.0 migration

`migrateActions_` (Tasks.js) runs **once**, from `seedDefaults`, after `ensureSchema` has made `action_tasks` (if the sheet is missing it
does nothing and says so; run `seedDefaults` again after `ensureSchema`). Every action in Contractor informed, Waiting stoppage or In
progress that has no task yet becomes In progress with **one task carrying the old status**: title = `required_action`, else the title;
owner, person and due date from the action; Waiting stoppage also sets `needs_stop`; Contractor informed on an action owned by an
internal team (not allowed for tasks) becomes In progress. History: a `task_create` row and a `status` row "Moved to tasks (backend
1.7.0)", by `system`; one audit row `migrate_actions` by `setup`. Draft, Open, Closed and Cancelled stay as they are. It is idempotent: the
Script Property `ACTIONS_TASKS_MIGRATED` marks it done, and an action that already has tasks is never touched.
