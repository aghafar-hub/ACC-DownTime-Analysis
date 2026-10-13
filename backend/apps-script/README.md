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
   `Master.js`, `Events.js`, `Upload.js`, `Notifications.js`, `Setup.js`, `Code.js`): click **+** next
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

Expected: `{"status":"ok","data":{"version":"1.3.0"}}`

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
3. **Run `seedDefaults`.** It adds the seven new settings (`notif_long_stop_hours`, `notif_spike_pct`, `notif_upload_gap_days`,
   `notif_availability_target_pct`, `notif_repeat_alert`, `notif_retention_days`, `app_url`) and never overwrites a value you
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

## 12. Update to version 1.3.0 (Keep as entered, targets, saved views)

Version 1.3.0 adds the **Keep as entered** button on the Validate page, three target settings and saved views. Nothing in your
data changes. Do these steps in order; all of them are safe to repeat.

1. **Paste these 7 files** into the Apps Script project, replacing the old content of each (same names, same order does not matter):
   `Schema.js`, `Config.js`, `Access.js`, `Code.js`, `Events.js`, `Settings.js`, `Notifications.js`.
   The other files (`Utils.js`, `Crypto.js`, `Audit.js`, `Auth.js`, `Users.js`, `Master.js`, `Upload.js`, `Setup.js`) and
   `appsscript.json` did not change from 1.2.0: leave them alone. With the one-file bundle (option A2), run
   `node tools/bundle-apps-script.mjs` and paste `ACC_Downtime_Backend.gs` over `Code.gs` instead.
2. **Run `ensureSchema`.** It adds three columns at the end of the `events` sheet (`accepted_flags`, `accepted_by`,
   `accepted_at`) and never touches existing rows or columns.
3. **Run `seedDefaults`.** It adds three settings with blank values (`target_availability_pct`, `target_mtbf_h`,
   `target_mttr_h`; blank = no target) and never overwrites a value you changed.
4. **Deploy a new version** as in section 10 (**Manage deployments**, pencil, **Version: New version**, **Deploy**). The web app
   address stays the same, and no new permission is asked.
5. **Check.** Open the web app address with `?action=ping`: it must answer version `1.3.0`. Run **installCheck**.

Good to know: an old app build keeps working against 1.3.0 (it just does not show the button). The new app build needs 1.3.0,
otherwise **Keep as entered** answers "Unknown action".

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
- **Permissions** (`appsscript.json`, `oauthScopes`): the spreadsheet, sending e-mail (digest) and managing the script's own
  triggers (`installNotificationTriggers`). Nothing else is requested.
- **Tests** (for developers): `npm run test:backend` in the repository runs the
  backend against an in-memory fake of Google Sheets.
