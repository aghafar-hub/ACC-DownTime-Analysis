# Actions and notifications - owner decisions (2026-10-13)

To be built AFTER the redesign (R1-R5) is finished. Mockups first.

- New 'Actions' tab: actions generated from downtime (auto drafts from rules and notifications), from Reports
  (area / line / equipment scope), Pareto bars, Repeated-failure rows, event records, notifications, or manual.
- Statuses: Draft, Open, Contractor informed, Waiting stoppage, In progress, Closed, Cancelled.
  No 'Closure requested': communication with contractors happens outside the app; an authorised user closes.
- Who can close: a list of users kept in Settings.
- Contractors: RHI = CR to Kiln incl. AFR, coal (FM), raw mills (RM), hydrogen (HY) [CR, RM.1, RM.2, K.1, K.2,
  HD, AFR, AFR new, SHR, FM.1, FM.2, HY.1, HY.2 - to confirm HD/SHR]; ASEC = cement mills (CM.1-CM.4), gypsum
  crusher, packing (PK.1, PK.2); plus internal teams.
- Thresholds (agreed): repeated failure 3+ in 30 days; chronic equipment = top 10 Pareto 3 months in a row;
  effectiveness watch 60 days after closing.
- Dedup: an open action for the same equipment + reason receives new evidence instead of a new draft.
- Effectiveness check after closing (before/after failures, hours, MTBF; Effective / Not effective / Watching).
- Notifications split into categories: Reliability, Availability & planned, Data quality, Actions, System;
  a Notifications page (inbox) opened from the bell popup.
- NEW: per-area availability target and planned-stop allowance (e.g. 8 h per week); notify (and optionally draft an
  action) when planned hours exceed the allowance.
