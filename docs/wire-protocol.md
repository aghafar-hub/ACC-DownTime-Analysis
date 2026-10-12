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
  `setUserTabAccess` -> `{ "userId", "overrides" }`).
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

`getStartup.years` is sorted newest first.

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
| `code_not_in_area` | warning | the code resolves to an equipment that has areas, and the row's (known) area is not one of them |
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
