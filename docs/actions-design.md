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

## Implementation notes (backend and API, version 1.4.0)

The server and API side is built: tables `actions`, `action_log`, `contractors`, `area_targets`, the `actions` access tab, the settings
`actions_*`, the draft rules, the effectiveness check, the alerts `planned_overrun` and `action_due` and a category on every notification.
The exact formulas, the choices these decisions left open and the calls are in `docs/wire-protocol.md` section 10; owner setup steps are in
`backend/apps-script/README.md` section 13.
