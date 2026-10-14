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
  tab is not Hidden. Everyone signed in sees all other alerts and updates; the app filters them with the person's watched areas.
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
| `action_due` (1.4.0) | an action that is not Closed or Cancelled has a `due_date` before today (plant date, server clock) | `action_due\|<action_id>\|<due_date>` | the action is closed or cancelled, or its due date moves |

Recency: a `long_stop` or `repeat_group` alert is only raised when the event (the last event of the cluster) started no more than
`notif_retention_days` before `L`. Older ones would expire at once, and without this the first check on a database with years of
history would raise hundreds of alerts. `failure_spike` and `availability_low` are about the latest data by construction.

Dedupe: `dedupe_key` is unique over all statuses. A check never creates a second row for a key. A `resolved` row is re-opened (new
expiry, same `notification_id`) if its condition returns; an `expired` row is never re-opened. Expiry: `expires_at = created_at +
notif_retention_days`; open rows past it become `expired` at the next check and are hidden from `getNotifications` right away.
`long_stop`, `repeat_group` and `upload_gap` rows whose key is no longer produced by the rules become `resolved` at the next check.

When checks run: at the end of `uploadFinish` (never fails the upload; also writes `upload_done`), on `runNotificationChecks`, and in
the daily job. Each time, the action checks (section 10.4) run right after them, best effort.

**Category** (1.4.0). Every item returned by `getNotifications` carries `category`, derived from `type` and not stored:
Reliability (`long_stop`, `repeat_group`, `failure_spike`), Availability & planned (`availability_low`, `planned_overrun`),
Data quality (`upload_gap`, `upload_done`), Actions (`action_due`), System (`user_event`). The table is `NOTIF_CATEGORY_` in
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
  area always matches), not dismissed by the person, at most 10, most severe first (long stop, availability, spike, repeated group,
  upload gap), the rest as "and N more".
- A link from `app_url` (omitted when blank).

`MailApp` quota, permission and send errors are written to `audit_log` (`digest_failed`, with the user id, never the address) and never
raise; when the daily quota is used up the run stops. `last_digest_at` is saved only after a successful send.

## 10. Actions (backend 1.4.0)

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
