# ACC Downtime Analysis - Apps Script backend

This folder is the server for the app. It runs inside Google Apps Script and
stores everything in one Google Sheet. You do not need to be a programmer: follow
the steps in order and tick them off. Allow about 45 minutes the first time.

Never put real URLs, passwords or plant data into any file in this repository.
The repository is public. Secrets live only in **Script Properties** (step 4).

## What you need

- A Google account that will own the system (the "deploying account"). Calls run
  as this account, so use a shared plant account if more than one person will
  maintain it.
- A Google Sheet for the data (name it for example `ACC Downtime - TEST`). Use a
  separate sheet for the test copy and for the live copy. Two ways to get one:
  - **Recommended: the ready-made database sheet** (`ACC_Downtime_Database.xlsx`,
    supplied separately because it holds plant data and is not in this
    repository). Upload it to Google Drive, open it with Google Sheets, then
    choose **File > Save as Google Sheets**. It already has every table with its
    headers and your starting data (areas, equipment, reasons, aliases, roles,
    settings). The `events` and `users` sheets are empty on purpose. With this
    sheet, step 2 reports "Schema is up to date" and step 3 can be skipped.
  - Or a new, empty Google Sheet. Then steps 2 and 3 create the tables and the
    starting areas, roles and settings, but you would have to enter the equipment
    and reasons yourself.

## 1. Put the code into Apps Script

**Option A - copy and paste (simplest)**

1. Open the Google Sheet, then **Extensions > Apps Script**. A project opens,
   bound to the sheet.
2. In the left list, open **Project Settings** (gear icon) and tick
   **Show "appsscript.json" manifest file in editor**.
3. Open `appsscript.json` in the editor and replace its content with the content
   of `backend/apps-script/appsscript.json` from this repository.
4. For each `.js` file in this folder (`Schema.js`, `Config.js`, `Utils.js`,
   `Crypto.js`, `Audit.js`, `Settings.js`, `Access.js`, `Auth.js`, `Users.js`,
   `Master.js`, `Events.js`, `Upload.js`, `Notifications.js`, `Actions.js`, `Tasks.js`, `Activity.js`, `Setup.js`, `Code.js`): click **+** next
   to **Files > Script**, name it the same without `.js` (for example `Utils`),
   and paste the content. Delete the empty default `Code.gs` first, or paste
   `Code.js` into it.
5. Click **Save** (disk icon).

**Option A2 - one paste (fastest)**

If you were given the single file `ACC_Downtime_Backend.gs` (made by
`node tools/bundle-apps-script.mjs`): do steps 1 to 3 of option A, then open
`Code.gs`, select everything, paste the whole content of `ACC_Downtime_Backend.gs`
and click **Save**. There is no need to create the other files. In step 6 you
will find `createFirstAdminRun` by using **Ctrl+F** in this one file.

**Option B - clasp (for people who use the command line)**

1. Install Node.js, then `npm install -g @google/clasp` and `clasp login`.
2. In the Apps Script project, **Project Settings** shows the *Script ID*.
3. In a terminal inside `backend/apps-script/` run `clasp clone <Script ID>`
   once, then `clasp push` whenever the files change. Never commit the
   generated `.clasp.json` (it holds your script id); keep it local.

`Schema.js` is generated from `schema/tables.json`. If the schema changes, run
`node tools/gen-apps-script-schema.mjs` in the repository and paste the new
`Schema.js`. Never edit `Schema.js` by hand.

## 2. Create the sheets (run `ensureSchema`)

1. In the editor, choose the function **ensureSchema** in the drop-down above the
   code and click **Run**.
2. The first time, Google asks for permission ("Review permissions"). Choose your
   account, **Advanced**, **Go to (project) (unsafe)**, **Allow**. This is normal
   for your own script.
3. Open **Execution log**. It lists the sheets it created. The spreadsheet now has
   one tab per table. Do not rename, delete or reorder the columns.

`ensureSchema` is safe to run again at any time, for example after an update. It
only adds missing sheets and missing columns (at the right-hand end) and never
touches your data. It also sets date and time columns to **Plain Text** so Google
Sheets never turns `2026-03-05` into a date.

## 3. Add the starting data (run `seedDefaults`)

(Skip this step if you started from the ready-made database sheet; running it
anyway is harmless.) Run **seedDefaults**. It adds the two lines, the 19 areas, the six
classifications, the four roles (Admin, Manager, Engineer, Viewer), the default
settings and the default tab access. It never overwrites anything, so it is also
safe to run again.

## 4. Create the secrets (run `generateSecrets`)

Run **generateSecrets** (function drop-down, then **Run**). It creates, inside
Script Properties and nowhere else:

- `SESSION_SIGNING_SECRET`: signs the login tokens (changing it signs everyone out).
- `PASSWORD_PEPPER`: mixed into every password hash (**never change it after users
  exist**, or every password stops working; then use Reset password for each user).
- `HASH_ROUNDS`: the password-hash cost, measured on your Google account (a sign-in
  takes roughly half a second).

The two secrets are random, 96 characters long, and are **never shown or logged**,
so there is nothing to copy or store. The function never overwrites a value that
already exists, so it is safe to run again.

You can check them any time under Project Settings (gear icon) > **Script
Properties**. `SPREADSHEET_ID` is optional when the script is bound to the sheet
(step 1, option A); if you ever need it, it is the long text between `/d/` and
`/edit` in the sheet's address. Use different secrets for the test copy and the
live copy (each copy has its own project, so each runs `generateSecrets` itself).

*Manual alternative:* add the properties yourself with values of at least 40 random
characters from a password manager (a different value for each secret).

## 5. Raise the password-hash cost later (optional)

`generateSecrets` already chose `HASH_ROUNDS`. To change it later, run
**benchmarkHashRounds**, read the suggestion in the log, and edit the
`HASH_ROUNDS` Script Property. Each user's stored hash is upgraded automatically
the next time they sign in.

## 6. Create the first Admin

1. Open `Setup.js`, find `createFirstAdminRun`, and replace
   `CHANGE-ME@example.com` and `Plant Admin` with the real email and name.
   **Do not save these edits to the repository; this is only in the Apps Script
   editor.**
2. Run **createFirstAdminRun**. Open the Execution log. It shows a temporary
   password **once**. Write it down now; it is not stored anywhere readable.
3. Change the line back to the placeholder (so no real email stays in the code).
4. Sign in to the app with that email and the temporary password. The app makes
   you choose your own password. Further users are added inside the app
   (Users page).

If you lose the temporary password, ask another Admin to use *Reset password*, or
delete the user's row in the `users` sheet and run `createFirstAdminRun` again.

## 7. Check the installation (`installCheck`)

Run **installCheck**. It prints plain-English lines starting with `OK:` or
`PROBLEM:` and ends with `Everything looks ready.` when all is well. It never
prints your secret values. Fix any `PROBLEM` line using the hint in the same line.

## 8. Deploy as a web app

1. **Deploy > New deployment**. Click the gear next to *Select type*, choose
   **Web app**.
2. Description: for example `v1 test`. **Execute as: Me** (the deploying
   account). **Who has access: Anyone**. (Every request is still checked by the
   app's own login token, so "Anyone" does not mean open data.)
3. Click **Deploy**, then **Copy** the *Web app URL*. This URL goes into the
   frontend build as a repository variable. Never commit it.

## 9. Test it with curl

Use a terminal. Replace `YOUR_WEB_APP_URL`, the email and the password.
Always add `-L`; Apps Script answers through a redirect.

Ping (no login needed):

```
curl -L "YOUR_WEB_APP_URL?action=ping"
```

Expected: `{"status":"ok","data":{"version":"1.5.0"}}`

Sign in:

```
curl -L -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"action":"login","token":"","params":{"email":"you@example.com","password":"YOUR_PASSWORD","keepSignedIn":false}}' \
  "YOUR_WEB_APP_URL"
```

Expected: `{"status":"ok","data":{"token":"...","expires_at":"...","user":{...},"must_change":false,"access":{...}}}`.
A wrong password gives `{"status":"error","error":{"message":"Incorrect email or password.","code":"bad_credentials",...}}`.

Use the token for another call:

```
curl -L -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"action":"getStartup","token":"PASTE_TOKEN_HERE","params":{}}' \
  "YOUR_WEB_APP_URL"
```

(Do not use `-X POST` together with `-L`; plain `-d` is correct.)

Error codes you may see: `bad_request`, `unauthenticated` (sign in again),
`forbidden` (your role may not do this), `locked` (too many wrong passwords, wait
15 minutes), `bad_credentials`, `not_found`, `conflict`, `busy` (try again),
`server` (see the Executions page, below).

## 10. Roll out a new version

1. Paste the changed files (or `clasp push`). Run **ensureSchema** if the schema
   changed, then **installCheck**.
2. **Deploy > Manage deployments**, click the pencil on your deployment, set
   **Version: New version**, **Deploy**. The web app URL stays the same, so the
   app needs no change.
3. Do **not** use "New deployment" for updates: that creates a second URL.
4. To go back, edit the deployment and pick an earlier version.
5. Try the test copy first, then repeat on the live project.

## 11. Notifications (alerts, updates and the e-mail digest)

Version 1.2.0 adds the bell in the app (alerts, updates), and an optional daily or weekly e-mail digest. Do this once after
pasting the new code; everything is safe to run again. See `docs/wire-protocol.md` section 9 for what each alert means.

1. **Paste the files.** From 1.1.0 these files changed or are new: `Notifications.js` (new), `Schema.js`, `Config.js`,
   `Settings.js`, `Access.js`, `Code.js`, `Upload.js`, `Users.js`, `Setup.js` and `appsscript.json` (it now lists the three
   permissions the script uses, see step 4). With the one-file bundle (option A2) paste `ACC_Downtime_Backend.gs` again instead;
   run `node tools/bundle-apps-script.mjs` first, it includes `Notifications.js`. Remember to add `Notifications.js` as a new
   file if you paste file by file.
2. **Run `ensureSchema`.** It adds the three new sheets (`notifications`, `notification_state`, `notification_prefs`) and never
   touches your data.
3. **Run `seedDefaults`.** It adds the six new settings (`notif_long_stop_hours`, `notif_spike_pct`, `notif_upload_gap_days`,
   `notif_repeat_alert`, `notif_retention_days`, `app_url`) and never overwrites a value you
   changed. Without it the defaults still apply, but the Settings page cannot show the rows.
4. **Install the daily trigger and re-authorise.** Run **installNotificationTriggers**. Google asks once for permission again
   (new: *Send email as you* and *Manage your triggers*; the spreadsheet permission is the one you already gave). Review
   permissions, choose your account, **Advanced**, **Go to (project)**, **Allow**. If the run stops at the permission screen,
   run it again. The function removes its own earlier triggers first, so running it twice never leaves two. The log says
   `Notification trigger installed`; check **Triggers** (clock icon in the left bar) for one `notificationDailyJob` trigger,
   daily, around 07:00 plant time. `removeNotificationTriggers` switches the daily job off again.
5. **Set the app address.** In the app (Settings, admin) or directly in the `settings` sheet, set `app_url` to the address people
   open the app at, for example `https://example.github.io/acc-downtime/`. The digest links to it. Blank = no link.
6. **Deploy the new version** as in section 10 (**Manage deployments**, pencil, **New version**). The permissions changed, so a
   new version is needed even though the web app address stays the same.
7. **Try it.** Run **notificationDailyJob** once from the editor: it runs the checks and sends any digests that are due. The log
   and **Executions** show what happened. Each person chooses `none`, `daily` or `weekly` (Sunday) under Settings,
   Notifications; nobody gets e-mail unless they choose it.

Good to know:

- **Mail quota.** E-mail is sent as the deploying account with Apps Script `MailApp`, which has a daily limit on recipients (at the
  time of writing about 100 for a free Google account and about 1,500 for Google Workspace; Google changes the figures, see
  *Quotas for Google Services* in the Apps Script documentation). The digest sends at most one e-mail per person per day and nothing when there is
  nothing to report. When Google refuses a mail, the reason is written to the `audit_log` sheet (`digest_failed`, with the user
  id, not the address), the checks and the app are not affected, and the person simply gets the digest the next day.
- **The checks also run** at the end of every upload and when an admin presses *Run checks* (action `runNotificationChecks`,
  needs Edit on Settings). An upload never fails because of them; a problem is written to `audit_log` (`notification_failed`).
- **Alerts expire** after `notif_retention_days` and are marked resolved when the cause is gone (event voided, newer data
  uploaded). Nothing is deleted; the `notifications` sheet is the record.

## 12. Update to version 1.3.0 (Keep as entered, targets, saved views, Reports)

Version 1.3.0 adds the **Keep as entered** button on the Validate page, two new target settings (MTBF and MTTR; the availability target already existed), saved views and the **Reports** page (a new `reports` access tab and a `saved_reports` preference for report templates). Nothing in your
data changes. Do these steps in order; all of them are safe to repeat.

1. **Paste these 7 files** into the Apps Script project, replacing the old content of each (same names, same order does not matter):
   `Schema.js`, `Config.js`, `Access.js`, `Code.js`, `Events.js`, `Settings.js`, `Notifications.js`.
   `Schema.js`, `Settings.js` and `Notifications.js` are part of this 1.3.0 paste set (they carry the targets and the availability
   alert that reads `availability_target_pct`); do not skip them.
   The Reports page changes four of these seven files: `Schema.js` (the `reports` tab in the access list and the role defaults),
   `Config.js` (the tab list), `Access.js` (`getEvents` also accepts the `reports` tab) and `Notifications.js` (the `saved_reports`
   preference). It adds no eighth file: the paste set stays these 7 files and the version stays 1.3.0.
   The approved analytical rules (overlapping stops counted once, failures counted as failure events, repeated failures
   merged across areas) change two of these seven files and no other: `Notifications.js` (the alerts `availability_low`,
   `failure_spike` and `repeat_group`, and the digest's "records to validate" count, which now includes the derived
   `failure_flag_mismatch` warning) and `Config.js` (`failure_flag_mismatch` may be kept as entered). The paste set stays
   these 7 files and the version stays 1.3.0.
   The other files (`Utils.js`, `Crypto.js`, `Audit.js`, `Auth.js`, `Users.js`, `Master.js`, `Upload.js`, `Setup.js`) and
   `appsscript.json` did not change from 1.2.0: leave them alone. With the one-file bundle (option A2), run
   `node tools/bundle-apps-script.mjs` and paste `ACC_Downtime_Backend.gs` over `Code.gs` instead.
2. **Run `ensureSchema`.** It adds three columns at the end of the `events` sheet (`accepted_flags`, `accepted_by`,
   `accepted_at`) and never touches existing rows or columns.
3. **Run `seedDefaults`.** It adds the four role rows of the new `reports` tab (Admin Edit, Manager Edit, Engineer View, Viewer View;
   change a person with the Users page as for any tab) and two settings with blank values (`target_mtbf_h`, `target_mttr_h`; blank = no target) and never overwrites a value
   you changed. The availability target is the existing `availability_target_pct`, and the availability alert now uses it too:
   an old `notif_availability_target_pct` row in your sheet is ignored (you can delete it).
4. **Deploy a new version** as in section 10 (**Manage deployments**, pencil, **Version: New version**, **Deploy**). The web app
   address stays the same, and no new permission is asked.
5. **Check.** Open the web app address with `?action=ping`: it must answer version `1.3.0`. Run **installCheck**.

Until `seedDefaults` has run, nobody (not even an Admin) sees the Reports page, because a missing access row means Hidden.

Good to know: an old app build keeps working against 1.3.0 (it just does not show the button). The new app build needs 1.3.0,
otherwise **Keep as entered** answers "Unknown action".

## 13. Actions (1.4.0)

Version 1.4.0 adds the **Actions** page (a new `actions` access tab), the contractors and their areas, per-area targets with a planned-stop
allowance per year, two new alerts (planned stops over the allowance, overdue actions) and a category on every notification. Nothing in
your data changes. Do these steps in order; all of them are safe to repeat.

1. **Paste these 8 files** into the Apps Script project, replacing the old content of each:
   `Actions.js` (**new**: add it with **+** next to **Files > Script** and name it `Actions`), `Schema.js`, `Config.js`, `Access.js`,
   `Code.js`, `Settings.js`, `Notifications.js`, `Setup.js`.
   The other files (`Utils.js`, `Crypto.js`, `Audit.js`, `Auth.js`, `Users.js`, `Master.js`, `Events.js`, `Upload.js`) and
   `appsscript.json` did not change from 1.3.0: leave them alone. With the one-file bundle (option A2), run
   `node tools/bundle-apps-script.mjs` (it includes `Actions.js`) and paste `ACC_Downtime_Backend.gs` over `Code.gs` instead.
2. **Run `ensureSchema`.** It adds four sheets (`actions`, `action_log`, `contractors`, `area_targets`) and never touches existing sheets,
   rows or columns.
3. **Run `seedDefaults`.** It only adds what is missing and never overwrites a value you changed:
   - the four role rows of the `actions` tab (Admin Edit, Manager Edit, Engineer Edit, Viewer View; change a person with the Users page as
     for any tab);
   - seven settings: `actions_closers` (blank: only Admins can close actions until you add people), `actions_repeat_n` (3),
     `actions_repeat_days` (30), `actions_chronic_top` (10), `actions_chronic_months` (3), `actions_effect_days` (60),
     `actions_auto_draft` (`true`);
   - the contractors: RHI (CR, RM.1, RM.2, K.1, K.2, HD, AFR, AFR new, SHR, FM.1, FM.2, HY.1, HY.2), ASEC (CM.1, CM.2, CM.3, CM.4, PK.1,
     PK.2) and the internal teams Mechanical, Electrical, Automation and Production. A contractor you already have (same id) is left as it is.
   The log line `Defaults added: ...` shows how many rows of each table it added (all 0 on a second run).
4. **Deploy a new version** as in section 10 (**Manage deployments**, pencil, **Version: New version**, **Deploy**). The web app
   address stays the same, and no new permission is asked (the daily trigger from section 11 now also runs the action checks; there is
   nothing to install).
5. **Check.** Open the web app address with `?action=ping`: it must answer version `1.4.0`. Run **installCheck**: the four new sheets
   must say `is ready`.
6. **Optional, in the app (Settings, admin):** choose who can close actions, check the contractors' areas, and enter the area targets
   for the year (availability target and planned-stop hours a year; the months are split evenly unless you change them).

Good to know:

- **Drafts.** After every upload, every *Run checks* and the daily job, the server drafts actions for review: repeated failures (3 or more
  of the same equipment and reason in 30 days), chronic equipment (top 10 by failure hours 3 complete months in a row), long stops (from
  the long-stop alert) and planned stops over a month's allowance (only for areas with targets). An open action for the same cause gets the
  new records as evidence instead of a second draft. Set `actions_auto_draft` to `false` to switch drafting off. The exact rules are in
  `docs/wire-protocol.md` section 10.
- **Closing.** Only people in `actions_closers` (and Admins) can close, cancel or reopen an action. A closing note is required. Sixty days
  after an equipment action is closed (once the data reaches that far), the server compares the failures before and after and marks it
  Effective or Not effective.
- **Until `seedDefaults` has run**, nobody (not even an Admin) sees the Actions page, because a missing access row means Hidden. Before
  `ensureSchema` has run, uploads and the alerts still work: the action checks are simply skipped.
- An old app build keeps working against 1.4.0 (it ignores the new fields). The new app build needs 1.4.0 for the Actions page,
  otherwise it answers "Unknown action".

## 14. Areas on and off, the theme with the account (1.5.0)

Version 1.5.0 adds two things. **Settings > Areas** (Admins only) switches an area off for the whole plant: the area and all its
records are then left out of every number, chart, list, report, export, the Validate list and the alerts, as if they did not exist,
until it is switched on again. Nothing is deleted. It uses the column `areas.active` that already exists ("Shown in the app"), so there
is no new sheet or column. And the **theme** each person picks is saved with their account, so it follows them to every device.
Nothing in your data changes. Do these steps in order; all of them are safe to repeat.

1. **Paste these 7 files** into the Apps Script project, replacing the old content of each:
   `Config.js`, `Access.js`, `Code.js`, `Auth.js`, `Master.js`, `Notifications.js`, `Actions.js`.
   The other files (`Schema.js`, `Utils.js`, `Crypto.js`, `Audit.js`, `Users.js`, `Events.js`, `Upload.js`, `Settings.js`,
   `Setup.js`) and `appsscript.json` did not change from 1.4.0: leave them alone. With the one-file bundle (option A2), run
   `node tools/bundle-apps-script.mjs` and paste `ACC_Downtime_Backend.gs` over `Code.gs` instead.
2. **No `ensureSchema` and no `seedDefaults` are needed**: there is no new sheet, column, setting or access row. (Running them does no
   harm.)
3. **Deploy a new version** as in section 10 (**Manage deployments**, pencil, **Version: New version**, **Deploy**). The web app
   address stays the same, and no new permission is asked.
4. **Check.** Open the web app address with `?action=ping`: it must answer version `1.5.0`. Run **installCheck** as usual.
5. **Optional, in the app (Settings > Areas, Admin):** switch off any area that should not count for now. Every area starts active,
   as before.

Good to know:

- **Who.** Only people with the Admin role can switch an area on or off (the server refuses everyone else and writes every change to
  `audit_log` as `deactivate_area` / `activate_area`). The master data page can still edit an area's name, line and notes, but its
  Active choice is also Admin only now.
- **What an inactive area does.** Its records stay in the `events` sheet and are still sent to the app, which leaves them out of every
  page; the data status strip says "<area> inactive" so the numbers are never silently different, and Validate says how many of its
  records are hidden. The alert rules and the action draft rules skip it; its open long-stop and repeated-failure alerts are resolved by
  the next check and come back when the area is switched on again. Existing actions of the area stay on the Actions page, marked
  "Area inactive"; their effectiveness is judged again once the area is active.
- **The theme.** Saved in `notification_prefs` (key `theme`) when a person picks one in Settings > Appearance, and sent back at sign-in.
  The theme kept on the device is still used on the sign-in page and offline. An older app build keeps working against 1.5.0; the new
  app build against a 1.4.0 server keeps the theme on the device only and cannot switch areas ("Unknown action").
- The exact rules are in `docs/wire-protocol.md` section 11.

## 15. Who is online and the activity log (1.6.0)

Version 1.6.0 adds two Settings subtabs for people with the Admin role only: **Active users** (who is using the app now, who was here
today, when each person was last seen, their role, phone or desktop and the page they had open) and **Activity log** (every change made
in the app, newest first, with filters, "Load more" and a CSV export). Every change in the app is now in `audit_log` with its old and
new values where that makes sense (see `docs/wire-protocol.md` section 12.3); sign-outs and comments on actions are logged too.
Nothing in your data changes. Do these steps in order; all of them are safe to repeat.

1. **Paste these 12 files** into the Apps Script project, replacing the old content of each:
   `Activity.js` (**new**: add it with **+** next to **Files > Script** and name it `Activity`), `Schema.js`, `Config.js`, `Access.js`,
   `Code.js`, `Audit.js`, `Auth.js`, `Users.js`, `Master.js`, `Events.js`, `Upload.js`, `Actions.js`.
   The other files (`Utils.js`, `Crypto.js`, `Settings.js`, `Setup.js`, `Notifications.js`) and `appsscript.json` did not change from
   1.5.0: leave them alone. With the one-file bundle (option A2), run `node tools/bundle-apps-script.mjs` (it includes `Activity.js`)
   and paste `ACC_Downtime_Backend.gs` over `Code.gs` instead.
2. **Run `ensureSchema`.** It adds one sheet, `user_activity` (one row per person: `user_id`, `last_seen_at`, `last_page`, `device`,
   `updated_at`), and never touches existing sheets, rows or columns. Until it has run the app works as before; the Active users list
   then shows the last sign-in only.
3. **No `seedDefaults` is needed**: there is no new setting or access row (the two subtabs follow the Admin role, not the tab access).
   Running it does no harm.
4. **Deploy a new version** as in section 10 (**Manage deployments**, pencil, **Version: New version**, **Deploy**). The web app
   address stays the same, and no new permission is asked (the script cache it uses needs none).
5. **Check.** Open the web app address with `?action=ping`: it must answer version `1.6.0`. Run **installCheck**: `user_activity` must
   say `is ready`.

Good to know:

- **How "online" works.** The app already checks the person's access every 2 minutes while it is open and in front; from 1.6.0 that
  check also says which page is open and whether it is a phone or a desktop. Every call a person makes counts as activity. To keep the
  sheet quiet, the server writes a person's row at most once every 3 minutes and keeps the exact time in the script cache in between.
  "Online now" means activity in the last 5 minutes. The page refreshes itself every minute.
- **The activity log keeps everything.** Nothing is ever deleted from `audit_log`. Reading stays fast however long it gets: the server
  reads from the bottom of the sheet (the newest rows) a block at a time and stops when a page of 100 is full; a date range ending in
  the past jumps to its last day first. If the sheet ever becomes very large (hundreds of thousands of rows), you may move old rows to a
  copy of the spreadsheet by hand; the app does not need them for anything else.
- **Who.** Only the Admin role sees the two subtabs; the server refuses everyone else (`forbidden`), even someone with Edit on Users or
  Settings. Passwords and tokens are never written to the log.
- An older app build keeps working against 1.6.0 (it does not send the page or device). The new app build against a 1.5.0 server
  shows the two subtabs with the message "Unknown action"; everything else works.
- The exact rules are in `docs/wire-protocol.md` section 12.

## 16. Tasks inside actions (1.7.0)

Version 1.7.0 splits every action into **tasks**: the action is the problem, the tasks are the work (who does what, by when, and
whether the area has to be stopped). The action statuses become Draft, Open, In progress, Closed and Cancelled; **Contractor
informed** and **Waiting stoppage** move to the tasks. The action follows its tasks (In progress as soon as a task starts), can only be
closed when every task is Done or Not needed, and the people on "Who can close actions" get a "ready to close" notification. A task
past its due date alerts the task's person and the action owner. Task templates (Repeated failure, Long stop, Planned overrun) fill
the tasks of new actions and of the automatic drafts. Do these steps in order; all of them are safe to repeat.

1. **Paste these 9 files** into the Apps Script project, replacing the old content of each:
   `Tasks.js` (**new**: add it with **+** next to **Files > Script** and name it `Tasks`), `Schema.js`, `Config.js`, `Access.js`,
   `Code.js`, `Audit.js`, `Actions.js`, `Notifications.js`, `Setup.js`.
   The other files (`Utils.js`, `Crypto.js`, `Settings.js`, `Auth.js`, `Users.js`, `Master.js`, `Events.js`, `Upload.js`,
   `Activity.js`) and `appsscript.json` did not change from 1.6.0: leave them alone. With the one-file bundle (option A2), run
   `node tools/bundle-apps-script.mjs` (it includes `Tasks.js`) and paste `ACC_Downtime_Backend.gs` over `Code.gs` instead.
2. **Run `ensureSchema`.** It adds three sheets, `action_tasks`, `task_templates` and `task_template_steps`, and four columns:
   `template_id` on `actions`, `task_id` on `action_log`, `recipients` on `notifications`. It never touches existing rows.
3. **Run `seedDefaults`** (needed this time). It adds the three task templates (only the ones that are missing) and then, **once**,
   moves the old statuses to tasks: every action that is Contractor informed, Waiting stoppage or In progress and has no task yet
   becomes In progress with one task that carries the old status (title from "Required action", else the action title; owner,
   person and due date from the action; a Waiting stoppage task is marked as needing a stop). Draft, Open, Closed and Cancelled
   actions do not change. The log (**Executions**) shows `actions_moved_to_tasks` with the number moved, and the Activity log has one
   row "Moved the old action statuses ... to tasks". Running `seedDefaults` again moves nothing (the Script Property
   `ACTIONS_TASKS_MIGRATED` remembers it; do not delete it). If you run `seedDefaults` before `ensureSchema`, nothing is moved: run
   `ensureSchema` and then `seedDefaults` again.
4. **Deploy a new version** as in section 10 (**Manage deployments**, pencil, **Version: New version**, **Deploy**). The web app
   address stays the same, and no new permission is asked.
5. **Check.** Open the web app address with `?action=ping`: it must answer version `1.7.0`. Run **installCheck**: the three new sheets
   must say `is ready`. In the app, Settings › Actions & targets › Task templates lists the three templates.

Good to know:

- **"Check after 60 days" is not a task.** It is the action's existing effectiveness check, which starts when the action is closed (a
  task would block closing for 60 days).
- **Who may do what.** Everyone with Edit on Actions adds and changes tasks; closing and cancelling stay with the people on "Who can
  close actions" (and Admins). Templates are edited by people with Edit on Settings. Tasks are never deleted: set **Not needed** with a
  reason instead. Every task change is in the Activity log with its old and new values.
- **Notifications.** "Ready to close" goes only to the closers and Admins; "Task overdue" only to the task's person and the action
  owner (to the closers when neither is set). The daily digest follows the same rule.
- An older app build against 1.7.0 still shows the actions, but cannot set the two removed statuses (the server says why). The new app
  build against a 1.6.0 server shows no tasks and "Unknown action" on the task buttons; deploy the backend first.
- The exact rules are in `docs/wire-protocol.md` section 13.

## 17. Email: the system email, reports and actions reports by email (1.9.0)

Version 1.9.0 sends reports and actions reports by email (a PDF of the report, Excel if ticked, and a summary in the email
body), and every email of the app (also the digest) can come from a **system email** set in Settings › Notifications. All
mail goes through `Mail.js`. Who may send: Edit on the Reports tab, or an Admin. Any address may receive; at most 25 in To,
25 in Cc and 30 emails per person a day.

1. **Copy the files.** New: `Mail.js`. Changed: `Config.js`, `Access.js`, `Audit.js`, `Code.js`, `Notifications.js`,
   `Settings.js`, `Schema.js` and **`appsscript.json`** (it now turns on the Gmail service and adds the scopes `gmail.send` and
   `gmail.settings.basic`). Show the manifest (Project Settings › Show "appsscript.json") and replace its content.
2. **Gmail service.** In the editor, the left bar **Services** should now list **Gmail API** (from the manifest). If it does
   not, press **+** next to Services, pick Gmail API (v1), identifier `Gmail`, and Add.
3. **Deploy** a new version (Deploy › Manage deployments › edit › New version). Google asks once to allow the new permissions
   (send email as you, see your Gmail "Send mail as" settings): allow them with the account that runs the app.
4. **Send mail as.** Sign in to Gmail with the account that runs the app › Settings › See all settings › Accounts ›
   **Send mail as › Add another email address**: enter the system email, keep "Treat as an alias" ticked, and confirm with
   the code Google sends to that address. (A Google Workspace admin can also add it as an alias of that account.)
5. **In the app:** Settings › Notifications › Email sender: write the system email and the sender name, Save, then press
   **Send a test email**: it says which address the email came from. With the system email blank the app sends from the
   account that runs it, as before.
6. **Check.** `?action=ping` answers version `1.9.0`. Run **seedDefaults** once if you want the two new settings rows to show
   in the sheet (the app works without them).

## 18. Security and speed (1.10.0)

Version 1.10.0 hardens sign-in and user management and makes edits and uploads faster. Nothing in the sheet changes
shape: no new sheets or columns.

- **Only Admins manage Admins.** Someone with Edit on the Users tab who is not an Admin can still add and change other
  people, but cannot create an Admin, give the Admin role, or change, reset, sign out or set the page access of an Admin.
- **No more account lock.** After `lockout_attempts` wrong passwords (5) each further try for that email must wait 1, 2, 4,
  8, 16 minutes, then `lockout_minutes` (now the longest wait, 30). A try that comes too early is refused without checking
  the password. Wrong passwords never end a session that is already open, so a stranger who knows an email cannot lock its
  owner out.
- **Sign out of all devices.** Everyone has it in the user menu; an Admin also has it in a person's details (lost or shared
  phone). It ends every session issued before that moment (kept as a script property `SIGNED_OUT_<user id>`; nothing in the
  sheet).
- **Keep me signed in: 14 days** (`session_hours_keep` 336) instead of 30.
- **Formula-safe text.** Text that starts with `=`, `+`, `-` or `@` is written with a leading apostrophe, so it can never run
  as a formula even if a cell loses its Plain Text format. Sheets hides the apostrophe; the app sees the text unchanged.
- **Faster edits.** Editing, voiding and "keep as entered" find the record through the `event_id` column instead of reading
  the whole events sheet; "keep as entered" for many records (Validate) is one call that writes all of them together
  (`acceptEventFlagsBulk`).
- **Uploads answer at once.** The alert and action checks after an upload run a few seconds later in the background (a
  one-off trigger, `afterUploadJob`, that removes itself). Without that permission they run inside the upload as before.
- **Clean-up.** The daily job also removes alerts that were resolved or expired more than `notif_retention_days` ago, with
  their seen / dismissed rows.

Steps:

1. **Copy the files.** Changed: `Access.js`, `Audit.js`, `Auth.js`, `Code.js`, `Config.js`, `Events.js`, `Notifications.js`,
   `Schema.js`, `Setup.js`, `Users.js`, `Utils.js`. `appsscript.json` does not change.
2. **Deploy** a new version (Deploy › Manage deployments › edit › New version).
3. **Run `seedDefaults` once.** It sets "keep me signed in" to 14 days and the longest wait to 30 minutes, but only where
   nobody changed those two settings since setup; a value someone saved stays.
4. **Check.** `?action=ping` answers version `1.10.0`. The app shows "Sign out of all devices" in the user menu once it talks
   to 1.10.0; before that it works as with 1.9.0.

## Good to know

- **Access levels** are per tab: Hidden, View, Edit, from the role with optional
  per-user overrides (Users page). The server enforces them on every call.
- **Where problems show up**: in the editor, **Executions** (left bar) lists every
  call and its log. Error messages shown to users never contain technical
  details; the details are only in Executions.
- **Backups**: use **File > Version history** on the Google Sheet and make a copy
  of the sheet before big changes.
- **Limits**: one chunk of a workbook upload is about 300 rows; a single call can
  run for up to 6 minutes. The system is meant for the test phase; the plan is to
  move to a real database later (see `docs/architecture-and-build-plan.md`).
- **Permissions** (`appsscript.json`, `oauthScopes`): the spreadsheet, sending e-mail (digest, reports; 1.9.0: also through Gmail as the system email, and reading the "Send mail as" list) and managing the script's own
  triggers (`installNotificationTriggers`). Nothing else is requested.
- **Tests** (for developers): `npm run test:backend` in the repository runs the
  backend against an in-memory fake of Google Sheets.
