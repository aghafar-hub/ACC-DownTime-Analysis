# Redesign (approved 2026-10-13)

Source: full read-only inspection (analysis/data, desktop, mobile/PWA) and the mockups in this folder
(illustrative numbers). The owner approved the design and the plan order R0 -> R5. Calculations, data
sources, permissions and working features are preserved. The analytical changes P1-P7 are NOT approved
yet: do not implement them until the owner says so.

Mockups: desktop-dashboard.png (full page), desktop-drilldown.png, mobile-dashboard-1..11.png (phone,
same page scrolled), mobile-filters.png, mobile-records.png, mobile-chart-tap.png.
Owner decisions: 'Overview' is renamed 'Dashboard' (route /dashboard; /overview redirects; access tab id
stays `overview` internally). The dashboard gets MORE graphs (12 cards, list below). Logo sits directly on the
navy side bar (transparent PNG, never on a white plate).

## R0 - correctness and safety (no change to definitions)
1. Drill-through ids (src/calc/pareto.ts mergeEntries ~47-57, 93-95): a bar/bucket only carries the chains that
   contribute to it in the window (value > 0 for hours, started in window for counts). Used by Overview Top 10,
   Pareto bars/buckets, Repeats scatter. Test: drill count == bar count.
2. Data range end (src/calc/kpis.ts dataRangeOf ~86-89; useDash asOf; reports/useReportData): a restart at
   00:00:00.000 must not extend coverage to that day (use the latest timestamp minus 1 ms / stop date). Year end case.
3. Partial months: a month is partial when its requested window is shorter than the calendar month (range cut or
   current month), not only when data ends early (src/calc/trends.ts ~74-109); `kpi.partial` for this-month.
4. Month vs month (MonthCompare.tsx, monthCompare.ts): default to the last two COMPLETE months; when either month is
   partial show per-day rates and no better/worse verdict.
5. Empty scope: when filters leave 0 events show an explicit 'No records match these filters' state with Reset
   (no 100% availability, no 'no failures' takeaway); warn when chips are mutually exclusive (e.g. PL + Failures only).
6. 'No change' (0.0) is neutral, never 'better'.
7. Name the measure: 'largest contributor' says 'by failure hours'; Downtime by area says 'by total hours'.
8. Install banner (InstallGuide.tsx/.css) must not cover content: reserve its height (CSS var) or render as a card.
9. Event Explorer keeps filters/search/shown-count in the URL so Back/tab switch restores them; ScrollKeeper then
   restores into the same list.
10. PopMenu (Views/Export) closes with Back (useBackClose).
11. API timeout in src/api/sheetsApi.ts (AbortController, 45 s normal, 180 s uploads) -> ApiError('network') with a
    retry message.
12. Sticky table headers relative to the page (src/components/ui.css ~303) for Event Explorer, Repeats, Master, Validate.
13. Repeats table: only groups with >= 2 occurrences in the list; N/A excluded from the heatmap as the text says.

## R1 - navigation, scope, branding
Pinned labelled navy rail at >= 1280 (collapsible to icons; expanding overlays, never pushes); logo on navy;
fix hover contrast. One sticky scope bar (Period, Compare, Line, Area, Equipment, Type, Reset, Views, Export) +
'Shared by Dashboard, Losses, Repeated failures, Reliability, Event records' note; Event records joins the shared
filters (keeps its own search and year switch as needed); Reports builder gets 'Use current dashboard filters'.
Data status strip (coverage, months not uploaded as information only (no number changes), records to check).
ACC orange as secondary accent (primary CTAs, active filter pill). One date format: months 'Aug 2026',
days '26 Aug', timestamps '26 Aug 2026 14:05'. Filter dependencies (equipment list incl. cross-area codes;
prune out-of-scope equipment; reasons narrowed). Rename Overview -> Dashboard.

## R2 - Dashboard and analysis pages
Dashboard cards in order: KPI row with Jan-Aug sparklines; Trend by month (Daily|Monthly, By type|By class,
partial/no-data markers); Stoppage by classification donut; Biggest losses Pareto (Equipment|Reasons|Areas|Lines,
Hours|Count, honest 'Top 10 = X%, 80% needs N items'); Planned vs incidental by line; Downtime by area; Availability
by area vs target; Failures and repair time by month (two panels on a shared month axis); MTBF vs MTTR quadrant;
Repeated failures top 5; Availability heatmap area x month (target-based colours); Daily stopped hours; then
Month vs month, Data quality and Areas table as compact sections. Every card: question title, scope footer,
'Open records' (exact records). Pareto page text fix; Reliability sub-tabs (Areas / Timing / Trends / Longest);
Repeats tidy (bursts shown separately).

## R3 - Records and Validate
Records table: sortable headers, sticky header, drill context banner 'From: Losses > 141.VL170 . Aug 2026 . 9 events,
15.7 h (matches the bar)', detail drawer. Validate: one-line rows with an actions menu, month table collapsed.
Upload history names and wrapping; Settings clean-up ('Your access...' text, tiles); breadcrumb 'Reports > Reports'.

## R4 - Phone and PWA
Landscape compact chrome; one-line update banner on phones; report preview Fit/100% (+ zoom there, pending owner
decision on global pinch zoom); share-sheet fallback for PDF/Excel; 44 px on touch tablets (pointer: coarse); safe-area
left/right; Pareto as horizontal bars on phones and tooltip clamped above the bottom nav; offline banner time.

## R5 - performance
Route-level code splitting; lazy older years (Validate counts); memo/caching of heavy models.

## Analytical changes awaiting approval (do not implement yet)
P1 overlaps counted once per area; P2 failures = failure events; P3 event-level filters; P4 one MTBF rule;
P5 repeats across areas merged / own-stop; P6 'Not uploaded' months instead of 0 h / 100 %; P7 suppress totals change
when the comparison period is not fully covered.
