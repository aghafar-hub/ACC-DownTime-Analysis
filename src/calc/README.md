# calc: the pure calculation layer

Pure TypeScript. No DOM, UI, network or global state; runs in the browser and in Node. Import from `src/calc/index.ts`.
Row types come from `src/api/types.ts`. Tests sit next to the code (`*.test.ts`); `fixtures.ts` holds small synthetic data.

Conventions
- Timestamps are plant-local text `YYYY-MM-DD HH:MM:SS.mmm`, parsed as UTC numbers (no machine time zone).
- A **window** is an inclusive `DateRange {from, to}` of calendar days. Hours are clipped to it; events are counted where they start.
- Unavailable values are `Metric` objects (`{available:false, code, reason}`), never 0, NaN or Infinity.
- Build lookups once (`buildIndex(master)`) and pass the `MasterIndex`; nothing is cached inside the functions.
- Voided rows (`is_void`) are ignored everywhere except `applyFilters({includeVoid})`, `buildFailureEvents({includeVoid})`, and as fingerprint matches in `compareUpload`.
- **Blocked rows** (a blocking flag, see flags.ts: `missing_classification`, `invalid_classification`, `unknown_area`, `end_before_start`) are kept out of every calculation like voided ones, unless `includeInvalid` is set (`applyFilters`, `buildFailureEvents`). `computeKpis`, `dataRangeOf`, `monthlySeries` and the chain-based entry points (Pareto, repeats, trends) also drop blocked rows and chains with a blocked head (`isAnalysable`, `analysableChains` in events.ts), so a chain passed in directly is guarded too.

## attribution.ts (P1: overlapping stops count once)
- `attributeRows(rows)` -> `Attribution` (`pieces`: event_id -> owned intervals). Per area, the downtime is the UNION of the rows; time covered by several rows goes to ONE row: `classPrecedence` PL (0) > incidental (1) > CIR (2), then the row that started first, then the longer, then the lower event id. Areas are independent, so a subset of areas keeps the same attribution.
- `attributedHours(row, window, attr)`, `piecesOf(row, attr)` (a row the attribution has not seen keeps its whole span), `piecesHours`.
- `duplicateKey(row)` = area | code key | stop | restart | class: exact duplicates own no time and are dropped from the chains.
- Every hour figure uses it: `computeKpis`, `monthlySeries`, `dailySeries`, `monthlyHoursByClassification`, Pareto (`ChainParetoOptions.attribution`, default: the rows of the chains passed in) and the heat maps. Pass the SCOPE's attribution (dashboards: `scope.attribution`) so Pareto totals equal the KPI hours. Event-level figures (MTTR, `durationS`, histogram, longest events, repeats hours, long-stop alert) use the event's own length.

## metric.ts / settings.ts
- `avail(v)`, `unavail(code, reason)`, `ratio(n, d, code, reason)`: `Metric` helpers.
- `parseSettings(Setting[] | record)` -> `CalcSettings` (defaults in `DEFAULT_SETTINGS`; invalid values fall back; `repeatMinEvents` is at least 2).

## time.ts
- `parseTs`, `parseDate`, `formatTs`, `formatDate`, `durationSeconds(stop, start)` (negative if restart precedes stop; null if unreadable).
- `clipInterval`, `clippedHours`, `splitByDay`, `splitByMonth` on half-open ms intervals.
- `monthKey`, `monthRange`, `monthsBetween`, `monthsOfRange`, `addDays`, `addMonthsClamped`, `daysInRange`, `rangeToInterval`, `intersectRanges`.
- `scheduledHours(range, settings)`: days x `scheduled_hours_per_day`; with `scheduled_days_per_week` = N the first N days of a Monday-based week are scheduled.
- `comparisonRange(range, kind)`, `previousPeriod`, `sameLastYear`: whole months -> whole months; month-aligned partial (1st to day N) -> elapsed-equivalent period (clamped); other windows -> same length before / same dates a year earlier. `elapsedEquivalent(month, asOf, otherMonth)`, `isPartialMonth`.

## normalize.ts / masters.ts
- `codeKey`, `isAreaLevelCode`, `matchKey`, `normalizeClassification`.
- `resolveCode(code, lookup)` -> `area_level | equipment | unknown` (N/A, then alias, then equipment table). `rowCode(row, lookup?)` uses the stored flags first.
- `resolveReason(classification, text, reasonLookup)` -> `blank | listed | unlisted` (same classification and match key, lowest `order_no`).
- `fingerprint({area_id, code, stop_ts, start_ts, occurrence})` (async SHA-256 hex), `eventIdFromFingerprint`, `assignOccurrences(rows)` (1, 2, ... per identical key in file order).
- `buildIndex(master)` -> `MasterIndex`; `areasOf(index, equipmentId)`.

## flags.ts / overlaps.ts / validate.ts
- `BLOCKING_FLAGS`, `WARNING_FLAGS`, `FLAG_INFO` (label, problem, fix), `splitFlags`, `isBlocked(event)`, `isBlockingFlag`, `blockingFlagsOf`, `flagLabel`.
- `findOverlaps(events, toleranceS = 1)` -> `{ids, partners, pairs}`: events of one area covering the same time (voided and blocked ignored). `overlap_in_area` is derived, never stored, and is INFORMATION (counted once by attribution.ts; `isInfoFlag`).
- `failure_flag_mismatch` (derived WARNING, `hasFailureFlagMismatch(row)`): Failure = YES on a PL / CIR or Freq = 0 row. It may be kept as entered (`DERIVED_FLAGS`).
- `computeEventFlags(row, index)` -> flag list in the server's order (the same rule as `backend/apps-script/Events.js`, see docs/wire-protocol.md 4a); `deriveEventFields(row, index)` -> `{equipment_id, is_area_level, reason_id, flags}`; `findArea(index, id)` (case-insensitive). The mock API, the upload review and the Validate page use these.

## filters.ts
- `Filter`, `emptyFilter()`, `applyFilters(events, filter, {settings, index?})`. Empty list/null/false = no restriction. Voided rows are always dropped unless `includeVoid`; blocked rows unless `includeInvalid`.
- The line filter resolves **area -> line through the master** (`index.areaById`), never `event.line_id` (the sheet's line can be wrong); an area the master does not know belongs to no line. Without an `index` it falls back to `line_id`, so always pass the index.
- `blockedSummary(events)` -> `{total: {count, hours}, byFlag: {<blocking flag>: {count, hours}}}` for the records kept out of the numbers (voided ignored; a record with two blocking flags counts under both, once in the total).
- Date range keeps rows that overlap the days (matched on stop/restart, so a row crossing the edge is kept; use clipped hours). Duration band is the row's own duration (short <= `duration_short_max_min`, long >= `duration_long_min_min`).
- Row-level: filtering by classification/reason can remove continuation rows. The dashboards use `filterChains` instead.
- `filterChains(chains, filter, ctx)` (P3): EVENT-level. Keeps whole chains: Failures only = `isFailure`, duration band = the WHOLE event's duration, classification / criticality / reason / equipment from the head row, line / area from the stopped area. KPI rows = the rows of the kept chains.

## events.ts
- `buildFailureEvents(rows, {toleranceMs=1000, includeVoid})` -> `{chains, failureEvents, orphans, unreadable}`.
  Per area, sorted by stop. A Freq=1 row starts a chain; a Freq=0 row joins the chain whose last restart is within the tolerance of its stop (any reason/classification). No match = orphan chain (kept in `chains` and `orphans`). Exact duplicates (`duplicateKey`) are left out (`duplicates`; `keepDuplicates` keeps them).
  `failureEvents` = non-orphan chains whose head is a failure head (`isFailureHead`: Freq = 1, Failure = YES, not PL and not CIR; P2). `durationS` = sum of the rows; `startDate` = date of the head's stop.
- `rowSpan`, `rowSeconds`, `rowHours(row, window)`, `chainHours(chain, window?, attribution?)`, `startedIn(chain, window)`, `exactDuplicates(rows)`.

## kpis.ts
- `computeKpis({rows, chains?, window, dataRange?, areaIds?, settings, index?, attribution?, notUploaded?})` -> `{status:'no_data'}` or `{status:'ok', areas[], total, window, partial, topArea, topEquipmentByHours, mostFrequentEquipment, repeatGroups, repeatedFailureCount, orphanCount, notUploaded, coveredDays}`.
  - The window is clipped to the data range (default: first stop to last restart in `rows`; pass the full coverage when `rows` are filtered). `partial` = the window was shortened.
  - Hours (P1): attributed time (attribution.ts), so overlaps in one area count once: PL-owned = planned, CIR-owned = other, the rest = INC/failure (continuations included). `failureCount` = `failureEventCount` = failure EVENTS that started in the window (P2).
  - T = scheduled hours of the (clipped) window per area, minus the days of months not uploaded (P6; `notUploaded`: plant-wide `notUploadedMonths(rows, coverage)`, defaulted from `rows` only when `dataRange` is defaulted too); a window that is wholly not uploaded is `no_data`. The aggregate sums areas ("area-hours") and derives ratios from summed hours.
  - A = (T - down) / T; B = (T - PL - (INC + CIR)) / (T - PL); C = (T - PL - CIR - INC) / (T - PL - CIR); results clamped to 0..1. `availabilityHeadline` follows `availability_basis`.
  - Operating hours = T - down. MTBF = operating / failure events (unavailable: `no_failures` or `no_exposure`); the aggregate is 'MTBF · all areas (area-hours)' (P4). Rate = failure events / operating x 1000. MTTR = mean full duration of failure events that started in the window.
- `notUploadedMonths(rows, range?)` (P6): months inside the coverage with no non-void record starting or running in them. `notUploadedDays`, `scheduledHoursUploaded`, `resolveNotUploaded`.
  - Default area set = areas present in `rows`; pass `areaIds` to fix it.
- `computeKpisWithComparison(input, kind?)` -> current, previous, `changes` (`abs`, `pct` (null if previous is 0), `direction`, `assessment` good/bad/neutral), `previousCoverage`, `scaling`. The comparison window derives from the current *effective* window.
  - P7: `periodCoverage(requested, dataRange, notUploaded)`; below `MIN_COMPARISON_COVERAGE` (0.9) `totalsScaling` makes the totals (hours, counts, operating hours) per-day rates: `compareTotal` returns a neutral change with `perDay: true` and `note` 'per day (previous period only partly covered: N of M days)'. Ratios (availability, MTBF, MTTR, rate) are compared as they are.
- `composeKpis`, `compareValues`, `dataRangeOf`.

## pareto.ts
- `buildPareto(entries, topN)` / `pareto(items, spec, topN)`: descending, `sharePct` and `cumulativePct` against the complete total, `Others` bar (`isOthers`), 80% `referenceIndex`, `eventIds` per bar. `topN`: 5 | 10 | 20 | 'all'. Zero values are dropped; ties sort by label.
- Event-based builders (input: chains; only `isFailure` chains are used, except `classificationPareto`). Cause = the head row. Measure `hours` = all rows of the chain clipped to the window; `count` = events that started in the window.
  - `equipmentPareto(chains, index, opts)` -> `{own, otherAreas, unassigned, areaLevel, unknown}`. Own-stop rule: `own` holds events whose code belongs to the stopped area (any area of the code). Other areas' codes go to `otherAreas`, codes in no area to `unassigned`, N/A to `areaLevel`, codes outside the master to `unknown`.
  - `reasonPareto` (by `matchKey`; `splitByClassification`), `reasonParetoForEquipment`, `areaPareto`, `classificationPareto({failureOnly})`.

## repeats.ts
- `findRepeatedFailures(failureChains, {settings, window?, previousWindow?, lookup?, includeBlankReason?})` -> `{groups, recurrences}`.
  Groups by (equipment code, reason match key); N/A and blank reasons excluded. P5: `groupOccurrences` merges failure events of a group in DIFFERENT areas that start within `CROSS_AREA_MERGE_MINUTES` (10) of the occurrence's first event into ONE occurrence; an occurrence starting less than `BURST_GAP_MINUTES` (60) after the previous occurrence RESTARTED in the same area is a burst (`burstCount`, `RecurrenceEvent.burst`): it still counts. A cluster = occurrences inside a sliding window of `repeat_window_days` (**inclusive**: exactly N days apart qualifies) with at least `repeat_min_events`; overlapping windows merge. Occurrences = cluster occurrences (in `window`); recurrences = occurrences after the first of each cluster. Groups need at least one recurrence in the window. History before the window is used to find clusters. `previousPeriodOccurrences` counts merged occurrences the same way. Hours = the events' own lengths (area-hours).
- `findClusters(startsMs, minEvents, windowDays)`.

## trends.ts
- `monthlySeries({rows, chains?, range, dataRange?, areaIds?, settings, attribution?, notUploaded?})`: one `MonthPoint` per month (hours by class, failure count, MTBF, MTTR, rate, availability); months in progress are `partial`, months without data have `hasData:false` and unavailable metrics; a month not uploaded has `notUploaded: true` and metrics with code `not_uploaded` (P6). Equals `computeKpis` for each month. `dailySeries` and `monthlyHoursByClassification` take the same options (`DayPoint.notUploaded`, `ClassMonthPoint.notUploaded`). `yearOverYear` compares totals per day when last year's month is covered < 90 % (P7).
- `rollingFailureCounts(failureEvents, range, 30 | 90)`, `yearOverYear({rows, year, settings})`, `durationHistogram(failureEvents, settings, window?)` (bins + short/medium/long bands), `equipmentMonthHeatmap`, `equipmentReasonHeatmap`, `buildHeatmap`, `longestEvents(chains, n)` (by chained event).

## uploadDiff.ts
- `compareUpload({uploaded, stored, index, editedFields?})` -> `{rows, warnings, normalizedRows, normalisations, lateMonths, summary}`. **No row is rejected**: each new/late row carries `flags` (what it will be stored with, from `computeEventFlags`) and validation warnings.
  Status per row: `identical`, `new`, `late_row` (a new row whose date is on or before the latest stored date; `lateScope` is `'month'` when its month `YYYY-MM` has no stored non-void events at all, else `'row'`),
  `lateMonths: {month, rows, hours}[]` (oldest first, one `late_month` warning each); per-row `late_row` warnings only for scope `'row'`; `summary.late` counts both, `summary.lateMonths` / `lateMonthRows` the month ones, `changed_row` (same fingerprint, different freq/classification/criticality/is_failure/reason_raw/description/event_date/line_id; stored value kept). If the stored event was `edited` and all differences are edited fields, an `edited_in_app` info warning is given and the row counts as identical. Stored non-void rows inside the file's date range but absent from it give `missing_row` (info).
  Validation (new and late rows only): `missing_code`, `missing_classification`, `invalid_classification`, `unknown_area`, `line_mismatch`, `unknown_code`, `code_not_in_area` (information only: severity `info`), `unlisted_reason`, `blank_reason`, `end_before_start`, `duration_mismatch` (needs `sheet_duration_s`), `orphan_continuation`, `placeholder_code`, and `overlap_in_area` (uses `findOverlaps` over the file and the stored non-void rows, tolerance 1 s: one warning per affected row, so a 3-row pile-up gives 3, not 3 pairs). Classification case is normalised and reported in `normalisations`.
- `validateRow`, `compareFields`.
