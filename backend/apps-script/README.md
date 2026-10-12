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
   `Master.js`, `Events.js`, `Upload.js`, `Setup.js`, `Code.js`): click **+** next
   to **Files > Script**, name it the same without `.js` (for example `Utils`),
   and paste the content. Delete the empty default `Code.gs` first, or paste
   `Code.js` into it.
5. Click **Save** (disk icon).

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

## 4. Set the three Script Properties

Project Settings (gear icon) > **Script Properties** > **Add script property**.

| Property | Value | Notes |
|---|---|---|
| `SESSION_SIGNING_SECRET` | a long random value | Signs login tokens. Changing it signs everyone out. |
| `PASSWORD_PEPPER` | a different long random value | Mixed into every password hash. **Never change it after users exist**, or every password stops working (then use Reset password for each user). |
| `SPREADSHEET_ID` | the id of your sheet | Optional when the script is bound to the sheet (step 1, option A). It is the long text between `/d/` and `/edit` in the sheet's address. |

How to make a strong value (at least 40 characters, letters and digits):

- Easiest: ask your password manager (Bitwarden, 1Password, the one built into
  Chrome or Edge) to "generate a password", length 48, then copy it.
- Mac or Linux terminal: `openssl rand -hex 32`
- Make **two different** values, one for each secret. Store them in your
  password manager. Do not email them or paste them into any file or chat.

Use different values for the test copy and the live copy.

## 5. Tune the password hashing (run `benchmarkHashRounds`)

1. Run **benchmarkHashRounds**. Open the log. It says, for example,
   `Suggested HASH_ROUNDS = 2300`.
2. Add a Script Property `HASH_ROUNDS` with that number. This makes a sign-in take
   roughly half a second, which is slow enough to hinder guessing and fast enough
   for users. If you skip this step the built-in default (2000) is used.
3. Later you can raise the number. Each user's stored hash is upgraded
   automatically the next time they sign in.

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

Expected: `{"status":"ok","data":{"version":"1.0.0"}}`

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
- **Tests** (for developers): `npm run test:backend` in the repository runs the
  backend against an in-memory fake of Google Sheets.
