# ACC Downtime Analysis

Installable web app (PWA) that analyses cement-plant downtime. Built so far:
sign-in with per-tab access, the five themes and phone layout, the four
dashboards (Dashboard, Pareto and Contributors, Repeated Failures, Reliability
Trends), the Event Explorer with in-app correction of events (edit or void, with
a required reason and a full history), the Upload page (reads the monthly
workbook, review screen, chunked upload), Master Data, Settings and Users, and
the Apps Script backend in `backend/apps-script/`.

Plan: `docs/architecture-and-build-plan.md`; wire contract: `docs/wire-protocol.md`;
backend setup for a non-programmer: `backend/apps-script/README.md`.

## Run it in demo (mock) mode

```
npm install
npm run dev          # http://localhost:5173
```

With no `VITE_API_URL`, the app uses made-up data held in memory (about 5,300
events over 14 months, 19 areas, about 150 equipment codes, 60 reasons). Edits
last until the page is reloaded. The login screen offers the demo accounts:

| Email | Role | Password |
|---|---|---|
| admin@demo.test | Admin | Demo-Pass-1234 |
| manager@demo.test | Manager | Demo-Pass-1234 |
| engineer@demo.test | Engineer | Demo-Pass-1234 |
| viewer@demo.test | Viewer | Demo-Pass-1234 |
| newhire@demo.test | Viewer with a temporary password (forces a password change) | Temp-Pass-1234 |

## Environment variables (build time)

| Variable | Meaning |
|---|---|
| `VITE_API_URL` | Apps Script web app address. Set: the real backend is used and the demo data is not shipped. Unset: demo mode. Never write it in source. |
| `VITE_BASE` | Site base path, for example `/my-repo/`. Default `./` (works under any sub-path). |
| `VITE_STORAGE_PREFIX` | Prefix for every storage key in a test copy. |
| `VITE_ENV_LABEL` | Shows a "not live data" ribbon on a test copy. |

Storage keys all start with `acc_dt_` (sign-in, theme, year, install hint, and
the IndexedDB cache `acc_dt_cache`).

## Commands

```
npm run typecheck      # tsc
npm run build          # tsc + vite build (PWA service worker included)
npm test               # vitest: calc engine, mock API, wire-protocol client, upload reader, contract test
npm run test:backend   # the Apps Script backend against an in-memory fake of Google Sheets
npx vite-node tools/golden-check.ts -- path/to/workbook.xlsx
                       # reconciles a real monthly workbook with its own Analysis sheet (stays local)
```

Browser tests (Playwright, preinstalled Chromium at /opt/pw-browsers/chromium).
Run **one spec file at a time**, each with its own port, because each run builds
into its own folder:

```
E2E_PORT=4191 npx playwright test tests/e2e/dashboards.spec.ts
```

The `*-screens.spec.ts` files write screenshots of every theme on a phone and a
desktop under `test-results/`.

`tests/unit/contract.test.ts` runs the same scenario through the real backend code
(via the real API client) and through the demo API, so the two cannot drift apart.

## Real plant data

This repository is public. The monthly workbook, the equipment and reason lists and
the database spreadsheet are plant data and are never committed (`local-data/`,
`*.xlsx` and `*.csv` are git-ignored). Tests use synthetic data only.

## Folder map

```
src/
  api/        types.ts (contract), sheetsApi.ts (Apps Script client), mockApi.ts (in-memory server), index.ts (picks one)
  mock/       synthetic.ts (seeded data generator), demoAccounts.ts
  util/       normalize.ts (code_key, match_key, duration, resolve), sha256.ts, format.ts
  auth/       AuthContext (session, 2-minute access refresh), RequireAuth, RequireTab
  data/       stores.ts + useStartup / useEvents / useYearData (loading, error, IndexedDB cache)
  theme/      themes.ts (five themes, tokens unchanged from the platform), ThemeContext
  components/ shell (Sidebar, TopBar, PageTabs, BottomNav), ShellModal, PhoneParts, Tile, ThemePicker, banners
  mobile/     MoreSheet, useBackClose, viewport, UpdatePrompt, ScrollKeeper
  pages/      Login, ChangePassword, Event Explorer (+ events/), placeholder pages
  i18n/t.ts   phrase table (English now, Arabic-ready)
  calc/       analytics engine (written separately)
tests/e2e/    Playwright specs
```
