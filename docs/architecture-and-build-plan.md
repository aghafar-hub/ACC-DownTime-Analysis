# ACC Downtime Analysis — Architecture and Build Plan

Status: **proposal for approval. No application code exists yet.**
Date: 12 October 2026

This document turns the decisions made in discussion into a build plan. It
contains design decisions only. It must never contain real plant data (see §11).

---

## 1. Purpose and scope

A mobile-first installable web app (PWA) that analyses cement-plant downtime.
Version 1 does three things:

1. **Ingest** the monthly cumulative downtime workbook: upload, validate, add new
   rows only, warn on anything that differs from stored data.
2. **Analyse** the stored events in five dashboard tabs (Overview, Pareto and
   Contributors, Repeated Failures, Reliability Trends, Event Explorer).
3. **Correct** stored events (edit fields or void a record) with a full history.
4. **Administer** master data (equipment, areas, reasons), settings and users.

Out of scope for version 1: operator logging on phones, corrective-action log
and before/after comparison, shift analysis, lost-tonnes estimates, production
impact (full vs reduced), open/ongoing stoppages (the sheet's Status column is
empty), equipment-level MTBF and availability (no equipment operating hours).

The app is **standalone**. It copies the look, PWA behaviour and access model of
the ACC Reliability Platform but does not run inside it.

---

## 2. Decision log

| # | Topic | Decision |
|---|---|---|
| 1 | Source | Monthly cumulative workbook (older months stay in the sheet). The sheet resets each year; the app keeps all years. |
| 2 | Classifications | PRO Production, MEC Mechanical, ELE Electrical, AUT Automation, PL Planned, CIR Circumstantial. Case-insensitive. |
| 3 | Sheet values | Freq, Criticality and Failure are **read from the sheet** (cached values), never recalculated. Duration is calculated by the app. |
| 4 | Equipment code `N/A` | Valid. Means the whole area stopped. |
| 5 | Old data | Never updated. Differences produce warnings with the sheet row number. The user decides per late row: add or skip. |
| 6 | Area of a record | The **EQUIPMENT** column (the area that stopped). The equipment code is the cause and may belong to another area. |
| 7 | Areas | CR, RM.1, K.1, FM.1, HD, CM.1, CM.2, PK.1, HY.1 (Line L.1); RM.2, K.2, FM.2, AFR, AFR new, SHR, CM.3, CM.4, PK.2, HY.2 (Line L.2). PK = Packing, HY = Hydrogen, each its own area. Line comes from the downtime sheet, not the platform master. |
| 8 | Equipment master | Seeded from the platform EQUIPMENT_MASTER plus codes found in the downtime lists. A code can belong to several areas (many-to-many). |
| 9 | Reasons | Kept exactly as listed, one list per classification. Matching uses a trimmed, lower-case key. |
| 10 | Reporting unit | The area. Totals across areas are labelled "area-hours". |
| 11 | Failure event | One Freq = 1 INC row plus the Freq = 0 rows that follow it on the same area. |
| 12 | Repeated failure | Same equipment code and reason, 2 or more failure events within 30 days. Adjustable in settings. |
| 13 | Availability and operating hours | Suggested defaults; adjustable in an admin settings screen. |
| 14 | Users | **Separate accounts** for this app. Improved password handling (§7). |
| 15 | Backend | Apps Script + Google Sheets for the test phase. The team will migrate to a real database later. |
| 16 | Look and feel | Same five themes, shell, phone design and PWA behaviour as the platform. No contractor concept. English first; Arabic open (§12). |
| 17 | Access | Per-tab levels Hidden / View / Edit, enforced by the server. |
| 18 | Correcting data | Authorised users can **edit or void** a stored event in the app when something is wrong. Upload still never changes stored rows. Every edit keeps the original value, who changed it, when and why. |

---

## 3. Architecture

```
Phone / desktop browser (installed PWA)
  React + TypeScript + Vite
  ├─ UI shell, themes, pages
  ├─ calc/        pure functions: durations, events, KPIs, Pareto, repeats (unit-tested)
  ├─ api/         one interface + two implementations
  │    ├─ sheetsApi   -> Apps Script web app (test phase)
  │    └─ mockApi     -> in-memory synthetic data (dev, tests, demos)
  └─ cache        IndexedDB: events per year, masters, settings
            │  HTTPS, text/plain POST (no CORS preflight)
            ▼
Apps Script web app (one project)
  Code (router) · Auth · Access · Master · Upload · Events · Settings · Audit
            │
            ▼
Google Sheets (one spreadsheet, one sheet per table)
```

### 3.1 Why this shape

- **One API interface** keeps the later move to a real database cheap: only the
  implementation behind `api/` changes. The calculation code is shared and stays
  identical, so numbers do not change on migration.
- **Calculations run in the browser** on cached events. Filters, charts and
  drill-downs stay instant and cost no server calls. The server stays a data
  store plus access guard.
- **Uploads are parsed in the browser** (an Excel parsing library), so Apps
  Script never has to parse a multi-megabyte workbook.
- **The server never trusts the client.** It re-validates every upload row,
  re-checks identity and access, and writes under a script lock.

### 3.2 Repository layout

```
src/
  app/            shell: rail, top bar, page tabs, phone bottom bar, More sheet
  theme/          five themes (tokens copied unchanged from the platform)
  pages/          overview, pareto, repeats, reliability, events, upload, master, admin
  components/     tiles, charts (Pareto, stacked bars, heatmap, scatter), modal, bottom sheet
  calc/           pure TypeScript, no UI imports
  api/            interface, sheetsApi, mockApi, types
  auth/           login, change password, route guard
  i18n/           phrase table (English now, Arabic-ready)
backend/apps-script/   one file per topic (see §5)
docs/              this file, schema, data dictionary
tests/             unit (calc), API contract, Playwright
tools/             synthetic data generator, golden-file checker (local only)
local-data/        git-ignored; never committed
```

### 3.3 Hosting and environments

- Static site on GitHub Pages under a sub-path, as the platform does.
- Backend URL comes from a repository variable (never in source).
- A **test copy** is built from a separate branch with its own storage prefix
  and its own spreadsheet, so test never touches live data.
- The PWA has its own identity (name "ACC Downtime Analysis", short name
  "ACC Downtime"), so it installs separately from the platform.

---

## 4. Data model (database-ready)

Written as tables with keys so the migration team can use it directly. Each is a
sheet in the test phase. Timestamps are stored as plant-local time without a time
zone (as in the Excel source); see risk R4.

| Table | Key fields |
|---|---|
| `lines` | `line_id` (L.1, L.2) |
| `areas` | `area_id` (K.1…), `name`, `line_id`, `sort_order`, `active`, `in_downtime_sheet` |
| `equipment` | `equipment_id` PK, `description`, `type`, `criticality`, `parent_id`, `status`, `origin`, `platform_plant_area`, `platform_main_area`, `platform_sub_area` |
| `equipment_areas` | (`equipment_id`, `area_id`) PK |
| `equipment_aliases` | `alias` PK, `equipment_id`, `reason` |
| `classifications` | `code` PK (PRO, MEC, ELE, AUT, PL, CIR), `name`, `is_incident` |
| `reasons` | `reason_id` PK, `classification`, `text_as_listed`, `match_key`, `order_no`, `active` |
| `events` | `event_id` PK, `edited`, `is_void` (see §6.1), `batch_id`, `event_date`, `line_id`, `area_id`, `code_raw`, `equipment_id` null, `is_area_level`, `stop_ts`, `start_ts`, `duration_s`, `freq`, `classification`, `criticality`, `is_failure`, `reason_raw`, `reason_id` null, `description`, `source_file`, `source_row`, `fingerprint` unique, `created_at` |
| `upload_batches` | `batch_id` PK, `uploaded_by`, `uploaded_at`, `file_name`, `file_hash`, `rows_read`, `rows_added`, `rows_identical`, `rows_skipped`, `warning_count`, `status` |
| `upload_warnings` | `warning_id` PK, `batch_id`, `type`, `source_row`, `event_id` null, `detail`, `resolution`, `resolved_by` |
| `users` | `user_id` PK, `email` unique, `display_name`, `role_id`, `password_hash`, `password_salt`, `hash_rounds`, `must_change`, `active`, `failed_attempts`, `locked_until`, `last_login_at` |
| `event_edits` | `edit_id` PK, `event_id`, `edited_at`, `edited_by`, `field`, `old_value`, `new_value`, `note` |
| `roles` | `role_id` PK, `name`, `description` |
| `tab_access` | (`role_id` or `user_id`, `tab_id`) → `level` (Hidden / View / Edit) |
| `settings` | `key` PK, `value`, `updated_by`, `updated_at` |
| `audit_log` | `at`, `user_id`, `action`, `entity`, `entity_id`, `detail` |

Rules:

- `events.fingerprint` = hash of (area, equipment code, stop time, start time),
  with an occurrence counter for identical keys inside one file.
- `events.is_failure` is **copied from the sheet** (INC and Freq = 1), not derived.
- Original text (`code_raw`, `reason_raw`) is always kept next to the resolved ids.
- Unknown codes and reasons are **stored and flagged**, never dropped.

---

## 5. Backend (Apps Script)

One file per topic, as in the platform backends:

| File | Role |
|---|---|
| `Code` | `doGet` / `doPost` router; every action goes through session check, then access check |
| `Config` | sheet names, headers, constants |
| `Utils` | sheet read/write, JSON output, lock helper |
| `Auth` | login, change password, token issue/verify (§7) |
| `Access` | tab levels, role defaults, per-user overrides; server rules per action |
| `Master` | equipment, areas, reasons, aliases: read, edit, import |
| `Upload` | batch create, row commit in chunks, warnings and resolutions |
| `Events` | packed reads by year |
| `Settings` | read/write settings with audit |
| `Audit` | append-only log |

Conventions: reads by `GET`, writes by `POST` as `text/plain`; every write inside
`LockService`; writes idempotent (same upload chunk twice adds nothing); the
person always comes from the session, never from the request; secrets only in
Script Properties; short plain-English error messages.

### 5.1 API contract (the interface the migration must keep)

`login`, `changePassword`, `getMyAccess`, `getStartup` (areas, equipment, reasons,
aliases, settings), `getEvents(year)`, `uploadStart`, `uploadChunk`,
`uploadFinish`, `getUploadHistory`, `getUploadWarnings`, `saveMaster*`,
`saveSettings`, user admin actions, `exportEvents`.

---

## 6. Upload and validation

1. User picks the workbook. The browser reads only the **Downtime** sheet and
   ignores formula text; it uses the **cached values** (Freq, Criticality,
   Failure). If those cells are empty the file is rejected with a clear message
   ("open and save the file in Excel first").
2. Rows are normalised (trim, case-insensitive classification, double dots in
   codes, aliases) and checked.
3. The browser compares each row's fingerprint with stored events and builds a
   review screen:

| Result | Handling |
|---|---|
| Identical to a stored row | Skipped silently, counted |
| New row, date after the latest stored date | Added |
| New row on or before the latest stored date, in a month that already has stored rows (late entry) | **Warning; user chooses Add or Skip per row** (with Add all / Skip all) |
| New rows on or before the latest stored date, in a month with nothing stored (late month) | **One decision per month: Add month or Skip month** (with Add all / Skip all) |
| Stored row whose fields differ in the file | **Warning with sheet row and both values; stored value kept** |
| Stored row missing from the file | Warning (informational) |

4. **Import never drops a row.** Every row of the workbook becomes a stored event.
   A row with a data problem is stored **with flags**: no classification, unknown
   classification, area not in Master Data, restart before stop (these four are
   *blocking*: the record is kept out of every calculation until fixed, like a
   voided one), and unknown equipment code, no code, placeholder code, reason not
   listed, no reason, code not in the area's list, line not matching the area
   (warnings: analysed as they are). Overlapping stops in one area, Freq = 0 with no
   predecessor and a duration that differs from the sheet's total are shown on the
   review screen. The review screen lists the records that will need checking, with
   counts per flag, and says so: nothing is dropped.
5. **File-level refusal** (nothing is imported, so nothing is lost; the rows are
   listed, "fix these in Excel and choose the file again"): wrong sheet or headers,
   an unreadable date, stop or start time, Freq not 0 or 1, CRITICALITY not
   INC / NO_INC, Failure not YES / NO, empty cached values.
6. On confirmation the browser sends rows in chunks (about 300). The server
   re-validates, takes the lock, inserts, and records the batch and its warnings.
   Re-sending a chunk is harmless.
7. The user can download the warning list (with sheet row numbers) to fix the
   workbook itself.

Golden check (local only): uploading a real monthly workbook must reproduce the
totals computed independently from that workbook (row count, stoppage hours,
Freq = 1 rows, failure count). The reference figures are kept outside the
repository with the data, and are never committed.

### 6.0 The Validate page

Flagged records wait on the **Validate page**, where a user with Edit access to
the events tab fixes them one by one (the area decides the line; a classification,
area, code or reason is chosen from the lists). Every fix is an ordinary
correction with a note (6.1), and the flags are recomputed from the master data.
After adding a code, alias, reason or area in Master Data, a **re-check**
(`revalidateEvents`) clears the flags that the new entry explains. Until a blocking
flag is cleared the record is stored and visible but excluded from every number.

**Cross-area causes are normal, shown as information, never as problems.** When one area
stops because of equipment that belongs to another area (a raw mill stops because the
kiln stopped, or the cause sits in CR), the sheet records the stopped area in EQUIPMENT and
the cause's code, and a code may belong to several areas. The backend keeps storing the
flag `code_not_in_area` for such rows, but the app treats it as an **information flag**
(`INFO_FLAGS` in `src/calc/flags.ts`, shown as "Cause in CR"): it is never listed on
Validate, never counted in the badge, banner, tiles or the "data issues" filter, and never
needs a decision at upload. The equipment finder in the edit form offers every active code
(the stopped area's first, then "Other areas" with their owner area), and the Pareto card
"Stopped by other areas" shows each code's owner area and the area it stopped.

**Keep as entered (backend 1.3.0).** When a flagged record is correct exactly as written, a user with Edit access presses
**Keep as entered** (one record, or all ticked rows at once). Nothing in the record changes: the flags are acknowledged in
`events.accepted_flags` with who, when (`accepted_by`, `accepted_at`) and why (an `event_edits` row, field `accepted_flags`).
An accepted *warning* is resolved and the record is normal everywhere. An accepted *blocking* flag stops being something to fix
(it leaves the Validate list, the badge, the banner and the notifications) but the record is **still left out of the numbers**,
because it still cannot be calculated; its hours are shown on Validate as "kept as entered, left out of the numbers". The
**Kept as entered** view lists accepted records with an Undo. Editing a record or re-checking drops accepted flags the record no
longer has. Helpers: `acceptedFlagsOf` and `openFlagsOf` in `src/calc/flags.ts`; the calc layer (`isBlocked`) keeps reading the stored
flags. Details: `docs/wire-protocol.md` section 6a.

### 6.1 Correcting stored events

Upload and correction are separate. Upload never modifies a stored row; the
correction screen does, under these rules:

- Needs **Edit** on the `events` tab (Admin and Engineer by default).
- A **note (reason for the change) is required** on every edit and void.
- Editable fields: date, line, area, equipment code, stop and start time, Freq,
  classification, criticality, failure flag, reason, description. Duration, the
  resolved equipment and reason ids, data-quality flags and (when not set by hand)
  criticality and the failure flag are **recalculated** after the edit.
- Each changed field becomes a row in `event_edits` (old value, new value, who,
  when, why). The event is marked `edited`. Its upload fingerprint never changes,
  so a later re-upload of the same sheet row still matches it.
- **Void** instead of delete: a voided event stays in the table and its history,
  and is excluded from every calculation. It can be restored.
- If a later upload differs from an edited row, the app reports "edited in app"
  and keeps the corrected value; it does not raise a changed-row warning.

---

## 7. Accounts, passwords and access

### 7.1 Accounts

- Created and managed in the app's admin area. A new user gets a one-time
  temporary password and must change it at first sign-in.
- Roles proposed (to confirm): **Admin** (everything), **Manager**, **Engineer**,
  **Viewer** (never edits).

### 7.2 Password handling (improved over the platform's)

| Item | Design |
|---|---|
| Salt | Random per user from `Utilities.getUuid()`, not `Math.random` |
| Pepper | Server-side secret in Script Properties, mixed into the hash |
| Hash | Iterated HMAC-SHA256; iteration count measured on your Apps Script account and stored per user (`hash_rounds`) so it can be raised later |
| Lockout | 5 failed attempts → temporary lock (15 min); counter reset on success |
| Temporary passwords | Generated server-side, shown once, change forced |
| Session token | Signed (HMAC) payload with `exp`; shorter when "Keep me signed in" is off |
| Replacement | The migration plan requires bcrypt or Argon2 and a password reset for all users |

Apps Script cannot do memory-hard hashing, so this is a stopgap for the test
phase, not a final design.

### 7.3 Access

- Each tab has a level per role: **Hidden / View / Edit**, with per-user overrides.
- Tab ids: `overview`, `pareto`, `repeats`, `reliability`, `events`, `upload`,
  `master`, `settings`, `users`.
- The server maps every read and write action to the tabs allowed to call it and
  refuses everything else. The frontend only hides what the server would refuse.
- Access is per tab, not per area or line (decided). Hidden tabs never receive
  their data.

Proposed defaults (to confirm):

| Tab | Admin | Manager | Engineer | Viewer |
|---|---|---|---|---|
| Dashboards (4) | Edit | View | View | View |
| Event Explorer (view; edit/void) | Edit | View | Edit | View |
| Upload | Edit | Hidden | Edit | Hidden |
| Master data | Edit | View | Edit | Hidden |
| Settings | Edit | Hidden | Hidden | Hidden |
| Users | Edit | Hidden | Hidden | Hidden |

---

## 8. Calculation rules (`calc/`)

All functions are pure and unit-tested against synthetic fixtures.

**Durations.** `duration = start_ts − stop_ts` in seconds. Rows are clipped to the
selected window for hours; events are counted once, in the period where they start.

**Events.** Sort by area and stop time. A Freq = 1 row starts an event; each
following Freq = 0 row whose stop time equals the previous row's start time (or
continues at 00:00:00 after a midnight split) joins it, even if its reason or
classification differs. A Freq = 0 row with no predecessor is an orphan and
raises a warning. Event duration is the sum of its rows.

**Hours per area.** Failure hours = hours of INC rows (continuations included).
Planned = PL rows. Other = CIR rows. The three never overlap within an area.

**Failure count.** Rows with Failure = YES (sheet value).

**Availability** (per area, scheduled time 24 × 7 by default, setting):

| Basis | Formula |
|---|---|
| A — calendar | (T − downtime) / T |
| B — calendar minus planned (headline) | (T − PL − (INC + CIR)) / (T − PL) |
| C — minus planned and circumstantial | (T − PL − CIR − INC) / (T − PL − CIR) |

**Operating hours** = T − (PL + CIR + INC) for the area and window.
**MTBF** = operating hours ÷ failure count (area level only).
**Failure rate** = failures ÷ operating hours × 1,000.
**Mean restoration time** = mean event duration of failure events that started in
the window (cohort rule: by start period).
**Zero failures** shows "none recorded", never an infinite MTBF.
**Missing data** shows "Unavailable", never 0.

**Pareto.** Percentages use the complete filtered total. Bars descending,
cumulative line, 80% reference, Top 5/10/20/All, "Others" bar visually distinct,
click-through to the underlying events.

**Equipment Pareto rule.** Count only events whose equipment code belongs to the
stopped area (any of the code's areas). Events with a code from another area are
shown in a separate view: "stopped by other areas". This prevents counting a
cause twice.

**Repeated failures.** Group by (equipment code, reason key); `N/A` excluded.
A group qualifies with ≥ 2 failure events within the window (default 30 days).
Show qualifying groups and recurrence events (occurrences after the first)
separately. Fields: occurrences, total hours, average and maximum duration, last
failure date, days between failures, previous-period occurrences.

**Comparisons.** Previous period, same period last year, or custom; always show
absolute hours and exposure-adjusted rates. Partial months compare against the
equivalent elapsed period.

**Cross-area totals** are labelled area-hours and never averaged as percentages.

---

## 9. User interface

Follows the platform design book; only the look, phone design and access model
are reused.

- **Shell:** left rail (dark in all themes), top bar with breadcrumb, online dot,
  global search, avatar menu; page tabs; phone bottom bar and More sheet.
- **Pages:** Overview, Pareto and Contributors, Repeated Failures, Reliability
  Trends, Event Explorer, Upload, Master Data, Settings and Users.
- **Page pattern:** header with a live-number subtitle; summary tiles; one filter
  row (global filters apply to every chart and table); the list.
- **Global filters:** line, area, equipment code, equipment type (when supplied),
  date range and presets, year/month, classification, criticality, failure only,
  reason, duration band, comparison. Reset, active-filter labels, visible event count.
- **Charts** per the agreed dashboard list. Pareto bars use one colour (15+ areas
  exceed the eight-colour categorical palette). Colour is never the only signal.
- **Phone:** works at 360 and 390 px, no sideways scroll, 16 px inputs, 44 px
  targets, Back closes sheets, lists as cards, summary line before charts,
  filters in a bottom sheet.
- **Themes:** ACC Light (default), Warm Paper, High Contrast, Navy Dark, Carbon
  Dark, from tokens only. Every chart is checked in all five.

---

## 10. PWA, offline and performance

- Installable; update prompt ("New version ready — Reload"); offline banner.
- **Offline is read-only.** Cached events, masters and settings open instantly;
  uploads and edits require a connection.
- Estimate (not measured): about 15,000 events a year, a few MB uncompressed.
  Events load **per year on demand** and are cached in IndexedDB. If years of data
  make this heavy, the first fix is to store each year in its own sheet.
- The first screen loads masters and the latest year; older years load when a
  filter reaches them.

---

## 11. Security and data protection

- The repository is **public**. Real plant data (the workbook, the equipment and
  reason masters, user lists) is never committed. `local-data/` is git-ignored.
- Tests and demos use **synthetic** data from `tools/`.
- Secrets (session signing secret, password pepper, spreadsheet id) live only in
  Apps Script Script Properties.
- Every write is audited. Failed logins are rate-limited.
- Web app access is "Anyone" at the Apps Script level; every call is authenticated
  by the signed token.

---

## 12. Open items and assumptions

| # | Item | Default until decided |
|---|---|---|
| O1 | Arabic and right-to-left | English only in v1; all text in a phrase table so Arabic can be added |
| O2 | Exports | Excel/CSV of the filtered events in v1; PDF later |
| O3 | Roles and default levels | Table in §7.3 |
| O4 | Equipment types, criticality, descriptions for some codes | Blank until supplied; type filter/Pareto appear when filled |
| O5 | AFR new equipment list; placeholders `AFR` / `AFR2` | Stored and flagged |
| O6 | PK.x / HY.x as groups in the downtime sheet | Areas exist; carry events only once the sheet uses them |
| O7 | Availability basis, scheduled hours, repeat rule, duration bands, targets | Defaults in §8, editable in Settings; targets blank |
| O8 | The 10 reason/classification pairs used but not listed | Listed in the reason master; kept as warnings at upload |
| O9 | Deployment branches and URL | Test branch first, live only on request |

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Apps Script latency and the 6-minute limit | Chunked uploads, per-year packed reads, client-side calculation |
| R2 | Sheet limits and growth | Per-year sheets if needed; migration to a database is planned |
| R3 | Password hashing is weaker than bcrypt or Argon2 | Pepper, rounds, lockout; replace at migration |
| R4 | Time zone and daylight saving (Egypt) | Timestamps kept naive as in the source; durations across a clock change may be off by one hour; flag such events |
| R5 | Sheet quality (typos, late edits, unlisted reasons) | Warnings, aliases, user decisions, never silent dropping |
| R6 | A long stop is several rows (midnight splits) | Event chaining; event-level ranking and MTTR |
| R7 | Double counting a cause across areas | Equipment Pareto rule (§8), area-hours labelling |

---

## 14. Build plan

Each phase ends with something runnable and a stated check.

| Phase | Content | Done when |
|---|---|---|
| **P0 Foundation** | Repo scaffold, themes, shell, PWA, login screen, `api/` interface with `mockApi`, synthetic data generator, CI | App runs with mock data on phone and desktop in all five themes |
| **P1 Backend core** | Apps Script project: sheets, auth, tokens, lockout, access, settings, audit | Login, change password, lockout and tab access enforced; API contract tests pass |
| **P2 Master data and corrections** | Import equipment (with many-to-many areas), reasons, aliases, areas; admin screens; event edit and void with history | Masters load, edit, audit; unknown-code reporting works; an edit recalculates and is fully traceable |
| **P3 Upload** | Parse, validate, review, commit, history, warnings download | A real monthly workbook reproduces its golden totals (local check); re-upload adds 0; late-row and changed-row warnings correct |
| **P4 Calc and Overview** | `calc/` with tests; Overview tab; Event Explorer; global filters | KPIs match hand-calculated fixtures and the golden file |
| **P5 Pareto and Repeats** | Pareto tab (all charts and rules), Repeated Failures tab | Pareto percentages use the full total; repeat groups match fixtures |
| **P6 Reliability and polish** | Reliability Trends, comparisons, exports, data-quality panel | Year-over-year works with two synthetic years |
| **P7 Hardening** | Access tests per role, performance, accessibility, docs, migration notes | Role matrix verified; migration schema document complete |

Testing: unit tests for `calc/`, API contract tests run against both
implementations, Playwright at 390 px and desktop in all five themes with no
console errors, and the local-only golden check against the real workbook.

---

## 15. What I need to start P0

1. Approval of this plan (or edits).
2. Confirmation of the roles and defaults in §7.3.
3. Hosting: a repository variable for the backend URL, and agreement that the
   test branch is built first.
4. Whether Arabic is in version 1 (O1).
