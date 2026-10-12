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

`base64url(JSON{ uid, role, iat, exp }) + "." + hex(HMAC-SHA256(payloadB64, SESSION_SIGNING_SECRET))`
with `iat` / `exp` in epoch milliseconds. Issued only by `login` and
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
| `editEvent`, `voidEvent` | `events` Edit |
| `saveEquipment`, `saveArea`, `saveReason`, `saveAlias`, `deleteAlias` | `master` Edit |
| `saveSettings` | `settings` Edit |
| `listUsers` | `users` View |
| `createUser`, `updateUser`, `resetPassword`, `setUserTabAccess` | `users` Edit |

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
  blank reason gives flag `blank_reason`.
- `classification` is upper-cased (`Aut` becomes `AUT`).
- `duration_s` = (`start_ts` - `stop_ts`) in seconds from the two plant-local timestamps
  (no time-zone conversion). `start_ts` earlier than `stop_ts` is flagged `end_before_start`.
- Fingerprint and `event_id`: see the comment at the top of `src/api/types.ts`.

## 5. Upload (server side)

`uploadStart` creates a `Started` batch. `uploadChunk` (about 300 rows) is
idempotent: the server recomputes each row's fingerprint, skips rows whose
`fingerprint` already exists (counted as `identical`), and inserts the rest,
resolving ids and flags per section 4. Hard rejects (returned in `rejected`, not
inserted): unknown `area_id`, `line_id` not matching the area's line, unreadable
timestamps, classification outside the six codes, `freq` not 0 or 1, criticality
not INC / NO_INC. `uploadFinish` stores the warnings the client computed (adding
server flags is optional), writes the batch totals, sets `Completed`, and appends
to `audit_log`. All writes happen inside the script lock; a busy lock returns
`busy` ("Server is busy - please try again.").

## 6. Editing and voiding events

`editEvent(eventId, changes, note)`:

- `note` is required (non-empty).
- Only fields in `EditableEventField` may change. The fingerprint never changes.
- After applying: recompute `duration_s`; resolve `equipment_id` / `reason_id` / flags again;
  if `classification` changed and `criticality` was not given, set `criticality`
  from `classifications.is_incident` (INC / NO_INC); if `criticality` or `freq`
  changed and `is_failure` was not given, set `is_failure = (criticality == INC and freq == 1)`.
- Set `edited = TRUE`.
- Write one `event_edits` row per changed field (old and new value as text) and one `audit_log` row.
- Return the updated `EventRow`.

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
