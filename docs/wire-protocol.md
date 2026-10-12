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
  `saveNotificationPrefs` -> `{ "prefs" }`; `getNotifications` and `runNotificationChecks` take no params).
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
| `getEvents` | `overview`, `pareto`, `repeats`, `reliability` or `events` at View or Edit |
| `getEventEdits` | `events` View |
| `getUploadHistory`, `getUploadWarnings` | `upload` View |
| `uploadStart`, `uploadChunk`, `uploadFinish` | `upload` Edit |
| `editEvent`, `voidEvent`, `revalidateEvents` | `events` Edit |
| `saveEquipment`, `saveArea`, `saveReason`, `saveAlias`, `deleteAlias` | `master` Edit |
| `saveSettings` | `settings` Edit |
| `listUsers` | `users` View |
| `createUser`, `updateUser`, `resetPassword`, `setUserTabAccess` | `users` Edit |
| `getNotifications`, `setNotificationState`, `saveNotificationPrefs` | any valid session (not while a temporary password is still unchanged); only the caller's own state and preferences are read or written |
| `runNotificationChecks` | `settings` Edit |

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

`overlap_in_area` is a **derived** flag (two events of one area covering the same time, tolerance 1 s): it is found by
comparing events in the browser (`src/calc/overlaps.ts`) and is never stored. `orphan_continuation` and
`duration_mismatch` are upload-time warnings only and are not stored either.

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
  `digest` (`none` / `daily` / `weekly`), `last_seen_at` (timestamp, stored as `YYYY-MM-DD HH:MM:SS.mmm`). `last_digest_at`
  is written by the server when it sends a digest; it is returned by `getNotifications` but cannot be saved.
- `runNotificationChecks`: runs every rule now, audited as `notification_check`.

### 9.2 Settings

`notif_long_stop_hours` (8, whole hours 1-720), `notif_spike_pct` (30, 1-1000), `notif_upload_gap_days` (35, 1-3650),
`notif_availability_target_pct` (blank = rule off, 0-100), `notif_repeat_alert` (`true` / `false`), `notif_retention_days`
(30, 1-3650), `app_url` (blank or `http(s)://...`, no spaces or quotes, up to 300 characters). Validated by `saveSettings` like
every other setting; a database without these rows uses the defaults until `seedDefaults` adds them.

### 9.3 Rules

All rules leave out voided events and events with a blocking flag, exactly like the app (section 4a), and chain rows into events
with the app's algorithm (1 s tolerance, a Freq = 0 row joins the open event it continues).
"Latest event date" `L` is the largest `event_date` of any stored non-void event. "Today" is the plant-local date of the server clock.

| Type | Raised when | `dedupe_key` | Resolved when |
|---|---|---|---|
| `long_stop` | a failure event (chain) lasts more than `notif_long_stop_hours` (summed hours of its rows) | `long_stop\|<event_id of the head>` | the event is voided, edited below the limit or the limit is raised |
| `repeat_group` | at least `repeat_min_events` failure events with the same code and reason (code after alias resolution, reason compared by `match_key`, blank reasons and area-level N/A excluded) start within `repeat_window_days` of each other (sliding window, exactly the window still counts); one alert per cluster, when it first exists; needs `notif_repeat_alert = true` | `repeat\|<area of the first event>\|<code>\|<reason_key>\|<first event_id>` | the cluster no longer exists, or the switch is turned off |
| `failure_spike` | per area, failures (rows with `is_failure`, by their stop time) in the 30 days ending on `L` are at least 5 and exceed the 30 days before by more than `notif_spike_pct` percent (any rise from zero counts) | `spike\|<area>\|<L>` | stays until it expires |
| `availability_low` | basis B = (T - PL - (INC + CIR)) / (T - PL) of an area for the latest complete month is below `notif_availability_target_pct`. The month is the month of `L` if `L` is its last day, otherwise the month before; the window is clipped to the data range like the KPI cards. Off while the target is blank | `availability\|<area>\|<yyyy-mm>` | stays until it expires |
| `upload_gap` | today is more than `notif_upload_gap_days` after `L` | `upload_gap\|<L>` | newer data arrives (`L` changes) |
| `upload_done` (update) | `uploadFinish` completes an upload | `upload\|<batch_id>` | never |
| `user_event` (update) | a user is created, a password is reset, a role is changed | `user\|<kind>\|<user_id>\|<epoch ms>` (kind: `created`, `password_reset`, `role_changed`) | never |

Recency: a `long_stop` or `repeat_group` alert is only raised when the event (the last event of the cluster) started no more than
`notif_retention_days` before `L`. Older ones would expire at once, and without this the first check on a database with years of
history would raise hundreds of alerts. `failure_spike` and `availability_low` are about the latest data by construction.

Dedupe: `dedupe_key` is unique over all statuses. A check never creates a second row for a key. A `resolved` row is re-opened (new
expiry, same `notification_id`) if its condition returns; an `expired` row is never re-opened. Expiry: `expires_at = created_at +
notif_retention_days`; open rows past it become `expired` at the next check and are hidden from `getNotifications` right away.
`long_stop`, `repeat_group` and `upload_gap` rows whose key is no longer produced by the rules become `resolved` at the next check.

When checks run: at the end of `uploadFinish` (never fails the upload; also writes `upload_done`), on `runNotificationChecks`, and in
the daily job. `user_event` rows are written by `createUser`, `resetPassword` and `updateUser` (role change), best effort.

### 9.4 Digest e-mail

Sent by `sendDigest_` from the daily time trigger `notificationDailyJob` (Setup.js, created by `installNotificationTriggers()`, about
07:00 plant time). Per person, from `notification_prefs.digest`: `daily`, or `weekly` (sent only on Sunday, plant time). Only active
users with an e-mail address, at most one digest per person per plant-local day, and nothing is sent when there is nothing to say.
Content (plain text and simple HTML, counts and titles only, never event rows):

- Needs action (only what the server can count, for people who could act on it): records to validate (events with a stored flag
  other than the information flag `code_not_in_area`; the number left out of the numbers because of a blocking flag), records with an
  unknown or placeholder code (needs `master` Edit), equipment to review (`needs_review`, needs `master` Edit). Pending late months
  are known to the browser only and are not in the e-mail.
- New alerts since the person's `last_digest_at`: open alerts of the person's `alert_types` and `watch_areas` (an alert without an
  area always matches), not dismissed by the person, at most 10, most severe first (long stop, availability, spike, repeated group,
  upload gap), the rest as "and N more".
- A link from `app_url` (omitted when blank).

`MailApp` quota, permission and send errors are written to `audit_log` (`digest_failed`, with the user id, never the address) and never
raise; when the daily quota is used up the run stops. `last_digest_at` is saved only after a successful send.
