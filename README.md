# ACC Downtime Analysis

Installable web app (PWA) that analyses cement-plant downtime. This is the
foundation (phase P0): the shell, themes, sign-in, access gating, the API layer
with an in-memory demo backend, and a complete Event Explorer. Dashboards,
upload and admin pages are placeholders that show live facts until the next step.
Plan: `docs/architecture-and-build-plan.md`; wire contract: `docs/wire-protocol.md`.

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
npm run typecheck    # tsc
npm run build        # tsc + vite build (PWA service worker included)
npm test             # vitest: calc, mock API, wire protocol client, data cache
npm run test:e2e     # Playwright (builds, then runs vite preview); uses /opt/pw-browsers/chromium
```

`tests/e2e/screens.spec.ts` writes screenshots of every theme on a phone and a
desktop to `test-results/screens/`.

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
