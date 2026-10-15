# Actions and notifications - owner decisions (2026-10-13)

To be built AFTER the redesign (R1-R5) is finished. Mockups first.

- New 'Actions' tab: actions generated from downtime (auto drafts from rules and notifications), from Reports
  (area / line / equipment scope), Pareto bars, Repeated-failure rows, event records, notifications, or manual.
- Statuses: Draft, Open, Contractor informed, Waiting stoppage, In progress, Closed, Cancelled.
  No 'Closure requested': communication with contractors happens outside the app; an authorised user closes.
- Who can close: a list of users kept in Settings.
- Contractors: RHI = CR to Kiln incl. AFR, coal (FM), raw mills (RM), hydrogen (HY) [CR, RM.1, RM.2, K.1, K.2,
  HD, AFR, AFR new, SHR, FM.1, FM.2, HY.1, HY.2 - HD and SHR confirmed]; ASEC = cement area (CM.1-CM.4, gypsum
  crusher is inside the cement area codes), packing (PK.1, PK.2); plus internal teams.
- Thresholds (agreed): repeated failure 3+ in 30 days; chronic equipment = top 10 Pareto 3 months in a row;
  effectiveness watch 60 days after closing.
- Dedup: an open action for the same equipment + reason receives new evidence instead of a new draft.
- Effectiveness check after closing (before/after failures, hours, MTBF; Effective / Not effective / Watching).
- Notifications split into categories: Reliability, Availability & planned, Data quality, Actions, System;
  a Notifications page (inbox) opened from the bell popup.
- NEW: per-area availability target and planned-stop allowance PER YEAR (hours/year per area), split into months
  (evenly by default, editable) with planned overhaul shutdowns assigned to their month; notify (and optionally draft an
  action) when a month's planned hours exceed that month's allowance and show YTD used vs YTD allowance.

## Tasks inside actions (owner decision, backend 1.7.0)

Mockups: `docs/actions-mockups/tasks/`. An action is the problem; it holds tasks (two levels only). Action statuses: Draft, Open,
In progress, Closed, Cancelled (Contractor informed and Waiting stoppage are task statuses now). Task statuses: Open, Contractor
informed (external contractors only), Waiting stoppage, In progress, Done (needs a note), Not needed (needs a reason); tasks are never
deleted. The action follows its tasks, closes only when every task is Done or Not needed, and the closers get "ready to close". Task
templates fill new actions and the auto drafts; "check after 60 days" stays the effectiveness check on close. The calls, the
migration of the old statuses and the alerts are in `docs/wire-protocol.md` section 13; owner steps in `backend/apps-script/README.md`
section 16. The screens (Tasks and Shutdown list tabs, task rows in the detail, template picker, Settings › Task templates) are built
separately on top of that API.

## Implementation notes (backend and API, version 1.4.0)

The server and API side is built: tables `actions`, `action_log`, `contractors`, `area_targets`, the `actions` access tab, the settings
`actions_*`, the draft rules, the effectiveness check, the alerts `planned_overrun` and `action_due` and a category on every notification.
The exact formulas, the choices these decisions left open and the calls are in `docs/wire-protocol.md` section 10; owner setup steps are in
`backend/apps-script/README.md` section 13.

## Frontend (built)

- **Navigation.** New rail section *Act* (after Reports) with *Actions* (`/actions`, access tab `actions`) and *Notifications*
  (`/notifications`, every signed-in person, no tab id). The phone bottom bar is Dashboard, Causes, Actions, Events, More
  (as in `mobile-actions.png`); the More sheet has the Act group. The Actions item carries the number of overdue open actions
  (not Closed / Cancelled, due date before today).
- **Data.** `src/actions/ActionsContext.tsx` keeps one copy of `listActions` for the shell (device cache through `src/data/stores.ts`,
  so the page reads offline; every change needs a connection and is disabled with the reason) and opens the create dialog from any
  page. Pure helpers: `src/actions/model.ts` (filters, search, sort, grouping, summary cards, status rules, dedupe key, CSV),
  `src/actions/targets.ts` (month split check within 0.1 h, year-to-date allowance, PL hours with P1), `src/actions/prefill.ts`
  (what each entry point fills in); unit tests beside them.
- **Actions page** (`src/pages/Actions.tsx`): summary cards, one filter row (status, area, line, contractor, owner, source, priority,
  My actions, Overdue only, search, sort) kept in the address, Board (a column per status, drag a card to another column) or List;
  Export CSV. Phone: status tabs, Filters sheet, Mine / Overdue chips, cards, New button. **Detail** (`src/actions/ActionDetail.tsx`,
  `?id=AC-…`): wide panel on a desktop, full screen on a phone; stepper, *Move to next*, *Change status* (`StatusDialog`: closing
  and cancelling only for people on `actions_closers` or Admins, with a note of 3+ characters; a closed action reopens only to Open),
  problem, evidence linked to Event records, root cause, required action, comments, assignment (owner = person, contractor =
  `owner`, default from the area), effectiveness, history. View only = everything read-only with the *View only* badge.
- **Create action** (`src/actions/CreateActionDialog.tsx`): manual (New action), from a built report (toolbar), Pareto bars (the
  card's *Create action* bar menu and the tooltip button on a tap), Repeated failures rows, the Event records detail, and alert
  notifications (panel and page). When an open action has the same equipment + reason the dialog offers *Add evidence to AC-…*
  or *Keep creating a new action*; a merged result shows "Added to existing action AC-…" with a link.
- **Notifications page** (`src/pages/Notifications.tsx`, *See all notifications* in the bell panel): tabs per category with counts,
  area / line filters, day groups, the chosen item beside the list, Snooze / Dismiss / Create action / Mark all read; the derived
  items are under Data quality. `action_due` opens the action, `planned_overrun` the Dashboard of the area.
- **Settings › Actions & targets** (`src/admin/settings/ActionsTargets.tsx`): who can close (people picker → `actions_closers`),
  contractors (`saveContractors`, one active external contractor per area checked live), the `action-rules` group and *Run checks
  now* (`runActionChecks`), area targets per year (`getAreaTargets` / `saveAreaTargets`: target %, allowance, 12 months with Even
  split and the live sum check, overhaul months, planned hours used year to date). Edit on Settings to change, View read-only.
- **Dashboard / Reliability.** Availability by area, the Areas section and the Reliability areas use the area's own target of the
  year when it has one (else the plant-wide target; nothing changes when no area has one). New Dashboard card *Planned hours vs
  allowance (year to date)* after Availability by area, per area with an allowance: used vs allowance, month bars, overhaul months,
  Open records.
- Left out on purpose: the mockups' per-week failure chart inside the detail, attachments on comments, @mentions, saved Views for
  the Actions page, the History switch on the Notifications page, "Import from Excel" for targets and per-rule Notify switches (the
  backend has no setting for them). The Repeated-failures entry point uses source `pareto` (the API has no own source for it).

## Tasks (built)

Frontend of "tasks inside actions" on backend 1.7.0, built to `docs/actions-mockups/tasks/01–13`.

- **Page tabs** Actions · Tasks · Shutdown list (`/actions`, `/actions/tasks`, `/actions/shutdown`; `src/actions/ActionsTabs.tsx`), with
  the open-action count, open tasks (+ overdue) and stop tasks. The open action (`?id=…&task=…`) opens over whichever tab it came from.
- **Board**: columns Draft / Open / In progress / Closed (Cancelled behind *Show cancelled*); cards show the task progress bar
  (`x / y tasks done`), the next task with owner and due, *Open tasks with* chips, the stop need, *tasks proposed* on drafts and
  *ready to close*. A card with tasks cannot be dragged between Open and In progress (`dropRule` in `model.ts`); accepting a draft,
  closing (no open task) and cancelling stay manual. Summary: status donut, **Open tasks** by task status with the stop hours,
  **Tasks overdue**, **Ready to close**; filters *Task owner*, *Has overdue tasks*, *Ready to close*; sort *Next task due* (default).
  The rail / bottom-bar badge counts overdue tasks of accepted open actions.
- **Detail** (`TasksSection.tsx`): Tasks is the first section (table on a desktop, cards on a phone; a row opens to notes, *Add note*,
  the task history and *Change status* / *Edit task* / *Open in Shutdown list*); *Add task* (`TaskDialog.tsx`, area contractor by
  default, quick +3/+7/+14/+30 d, needs stoppage + est. hours) and *Apply template*. Status changes in `TaskStatusDialog.tsx` (sheet on
  a phone): Done needs a note, Not needed a reason, Contractor informed only for external contractors. Stepper Draft → Open → In
  progress → Closed; *Close action* locked with "N tasks still open"; when all are done a green **ready to close** banner takes the
  closing note (closers only; others read who can close). Due date and stoppage of an action with tasks are read from the tasks.
  Actions without tasks keep the 1.4.0 behaviour (status by hand).
- **Create action**: template picker (suggested by the entry point: Repeats and repeated-group alerts → Repeated failure, Pareto
  equipment → Chronic equipment's template, long-stop alerts → Long stop, planned-overrun alerts → Planned overrun) and an editable,
  tickable task list; "Area contractor" resolves from the area. Every entry point (Pareto, Repeats, Events, notifications, Reports,
  New action) uses the same dialog.
- **Tasks tab** (`TasksView.tsx`) and **Shutdown list** (`ShutdownView.tsx`) compute from the `listActions` payload (`buildTaskViews`
  in `tasks.ts`, the same rules as `listTasks`), so they work from the device copy offline and follow every change at once. Excel via
  `src/export` + `deliverFile`; Print uses the browser dialog with print CSS (one area or all).
- **Notifications**: `task_overdue` → *Open task* (the action at that task), `action_ready_to_close` → *Open action*; own icons.
- **Settings › Actions & targets › (c) Task templates** (`src/admin/settings/TaskTemplates.tsx`): list + editor (name, suggested
  rules, offered, steps with default owner incl. Area contractor, due after, needs stop, est. h; move / remove), `saveTaskTemplates`;
  read-only without Edit on Settings. Rules and targets are now (d) and (e).
- Help texts: `as-tasks`, `tasks-list`, `shutdown-list` in `src/help/chartHelp.ts`. Tests: `src/actions/tasks.test.ts`,
  `tests/e2e/action-tasks.spec.ts`.
- Left out: drag handles to reorder tasks in the create dialog and the detail (the server keeps creation order), a planned-stop
  calendar for the Shutdown list (no stop dates exist), attachments on the Done note, and "used N times" counts only actions the
  person can see.
