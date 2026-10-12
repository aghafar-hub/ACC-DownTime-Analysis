# Notifications – design (N1 + N2 + N3)

Status: approved by the plant owner to build in three stages together. Defaults below were chosen
by the design lead where the owner had not answered; they are all editable settings.

## 1. What a notification is

| Kind (`severity`) | Examples | Who acts | Behaviour |
|---|---|---|---|
| `action` | records left out of the numbers (Validate), pending late-month decision, unknown / placeholder code in stored events, equipment flagged `needs_review` | editors, admins | derived live from the data, resolves itself when fixed, cannot be dismissed |
| `alert` | stop longer than N h, new repeated-failure group, failure-count spike vs previous period, availability below target, no upload for N days | managers, engineers, everyone watching the area | stored, can be acknowledged / snoozed, expires |
| `update` | workbook uploaded (+N rows), user created, password reset | people concerned | stored, informational, expires |
| information | cross-area causes | nobody | NOT a notification (neutral chip only) |

Principles: one item per cause (never per row); counts not lists; only `action` items count in the red
badge, alerts show an amber dot, updates show nothing; every item has ONE primary button that opens the
place where it is fixed (deep link with filters applied); never colour alone; 12 px min text; 44 px targets.

## 2. Screens (frontend)

- Bell button in the top bar next to Settings. Badge = number of open `action` items for this person
  (99+ cap). Phone: bell opens a full-screen sheet; the bottom-bar More badge shows the same total
  (replaces the Validate-only count).
- Panel groups: Action needed, Alerts, Updates. Row = severity icon + text label, one-line title with
  count, area/line chip, age, primary button; alerts/updates also have Snooze (1 day / 7 days) and Dismiss.
- 'Watch areas' filter chips in the panel (the person's followed areas; empty = all).
- Overview gets a collapsible 'Since your last visit' card (new events, new failures, biggest change,
  new repeated groups, new alerts); last-seen timestamp kept per user on the server (N3) and per device
  as a fallback (N1/N2).
- Settings → new subtab 'Notifications': per person (alert types on/off, watched areas, digest email
  none / daily / weekly); admin only (needs Edit on `settings`): thresholds.

## 3. Rules and defaults (admin settings, keys in the settings table)

| key | default | meaning |
|---|---|---|
| `notif_long_stop_hours` | 8 | a chained failure event longer than this raises an alert |
| `notif_spike_pct` | 30 | failure count of the last 30 days vs the 30 days before, per area, rise above this % (and at least 5 failures now) |
| `notif_upload_gap_days` | 35 | latest stored event older than this many days → 'No upload since …' |
| `notif_availability_target_pct` | (blank = rule off) | an area's availability (basis B) for the latest complete month below this raises an alert |
| `notif_repeat_alert` | true | a repeated-failure group (same code + reason, >= 2 events within the repeat window) that did not exist at the previous check raises an alert |
| `notif_retention_days` | 30 | alerts/updates expire after this |
| `app_url` | (blank) | base URL used for links in digest emails |

Routing: everyone signed in sees alerts/updates (filter with 'Watch areas'); `action` items only for
people with Edit on the `events` tab (Validate, late months) or `master` tab (unknown codes, needs_review)
or `upload` tab (pending late-month decisions). Viewers never see action items.
Dedupe: every stored notification has a `dedupe_key` (e.g. `long_stop|<event_id>`,
`repeat|<area>|<code>|<reason_key>|<first_event_id>`, `spike|<area>|<yyyy-mm-dd of check window end>`,
`upload_gap|<latest_event_date>`, `availability|<area>|<yyyy-mm>`, `upload|<batch_id>`); a check never
creates a second open row with the same key.

## 4. Data model (schema/tables.json, new tables; Schema.js is generated from it)

- `notifications`: notification_id (`NT-`+16 hex), type (enum: long_stop, repeat_group, failure_spike,
  availability_low, upload_gap, upload_done, user_event), severity (enum: alert, update), dedupe_key
  (required, unique), title, detail, area_id?, line_id?, source_ref? (event_id / batch_id / user_id),
  created_at, expires_at, status (open | resolved | expired), resolved_at?.
- `notification_state`: user_id, notification_id, state (seen | snoozed | dismissed), snooze_until?,
  updated_at. One row per user and notification (upsert).
- `notification_prefs`: user_id, key (alert_types csv | watch_areas csv | digest | last_seen_at), value,
  updated_at.
Settings keys above are added to `settingsDefaults` with ranges validated by the backend like other settings.

## 5. API (src/api/types.ts, wire-protocol.md, mockApi, sheetsApi, Apps Script)

- `getNotifications(token)` → `{ items: Notification[], state: NotificationState[], prefs: Record<string,string> }`
  (any signed-in user; only the caller's state/prefs; expired items omitted).
- `setNotificationState(token, notificationId, state, snoozeUntil?)` (any signed-in user, own state).
- `saveNotificationPrefs(token, prefs)` (any signed-in user, own prefs; validated enums, area ids exist).
- `runNotificationChecks(token)` (Edit on `settings`): runs the server rules now, returns counts created/resolved.
- Server also runs the checks automatically at the end of `uploadFinish` (idempotent, never fails the upload;
  also writes the `upload_done` update) and from a daily time trigger.
- Digest: `sendDigest_()` run by a time trigger created by the owner via `installNotificationTriggers()` in
  Setup.js (daily 07:00 plant time check; sends daily or weekly (Sunday) digests per user pref).
  Content (plain text + simple HTML, no event rows): counts of open action items, new alerts since the user's
  last digest (max 10, most severe first), the app link from `app_url`. Respects watched areas.
  Uses `MailApp.sendEmail`; needs the `script.send_mail` and `script.scriptapp` OAuth scopes in
  appsscript.json (owner must re-authorise once). Mail quota errors are logged to audit and never break checks.
- Server rules (Apps Script, plain JS, documented formulas, same in mockApi, covered by the contract test):
  long_stop, repeat_group, failure_spike, upload_gap, availability_low (basis B per area per complete month,
  voided and blocked events excluded exactly like the client calc), upload_done, user_event (user created /
  password reset / role change, only visible to admins). The client derives `action` items itself from the
  data (live conditions).

## 6. Client structure

- `src/notifications/` : `derive.ts` (pure: action items from events + master data; unit-tested),
  `NotificationsContext.tsx` (loads server items + state, merges with derived action items, unread/badge counts,
  polling every 5 min and on focus, offline-safe), `BellButton.tsx`, `NotificationPanel.tsx` (desktop popover /
  phone sheet), `SinceLastVisit.tsx`, `notifications.css`, Settings subtab `src/admin/settings/Notifications.tsx`.
- Tab access: no new tab id. The Notifications settings subtab needs no special access for personal prefs; the
  thresholds block needs Edit on `settings`.

## 7. Acceptance

- Action items: Validate count (blocking + warning records excluding information-only), unknown/placeholder
  codes used by stored events, `needs_review` equipment count, pending late months; each deep-links to the fixing
  page with filters applied; the count equals what that page shows.
- Alerts/updates stored once (dedupe), expire, snooze/dismiss persist per user across devices.
- Digest renders and is sent only to users who asked, tested with a stubbed MailApp in the backend harness.
- All new actions covered in the contract test (real backend vm harness + mockApi) and access matrix tests;
  Playwright for bell, panel (desktop + phone), badge counts, snooze/dismiss, prefs, since-last-visit, thresholds
  (admin only), no console errors, 360/390 no sideways scroll, themes.

## 8. Implementation notes (backend and API, version 1.2.0)

The server and API side is built as specified above. Exact formulas, the choices the design left open (recency window for
long stops and repeated groups, what `getNotifications` returns, snooze limits, digest rules) and the access table are in
`docs/wire-protocol.md` section 9 and section 3. Setup steps for the owner are in `backend/apps-script/README.md` section 11.
