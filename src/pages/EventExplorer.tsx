import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { EventRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import DataStatus from '../components/DataStatus';
import { BottomSheet, ChipRow, CountChip, FiltersPill, PAGE_SIZE, ShowMore } from '../components/PhoneParts';
import { PageHeader, Tile } from '../components/Tile';
import { buildFailureEvents, comparisonRange, isBlocked, isFailureHead, parseSettings, type DateRange } from '../calc';
import { readDrill } from '../dashboard/drill';
import { defaultFilters, nonFilterParams, parseFilters, serializeFilters, type CompareMode, type DashFilters } from '../dashboard/filters';
import ScopeBar from '../dashboard/ScopeBar';
import { rememberQuery } from '../dashboard/sharedFilters';
import { useEventsForYears, useRecordsScope } from '../dashboard/useDash';
import { eventsResource } from '../data/stores';
import { useYear } from '../data/useStartup';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { ValidationBanner } from '../validate/ValidationBanner';
import { Icon } from '../icons';
import { useTheme } from '../theme/ThemeContext';
import { duration, hours, num, shortTs } from '../util/format';
import { rangeText } from '../util/dates';
import { useValidationOptional } from '../validate/ValidationContext';
import EventBadges from './events/EventBadges';
import { buildOwnerLookup } from './events/crossArea';
import { hasOpenProblemFlags } from '../calc/flags';
import {
  activeCount, applyFilters, describeExplorerFilters, EMPTY, parseExplorerFilters, scopeRows, serializeExplorerFilters, totalActive, EXPLORER_KEYS, SHOWN_PARAM,
  type Filters, type Show, type Sort,
} from './events/explorerFilters';
import ExportMenu from '../components/ExportMenu';
import ViewsMenu from '../views/ViewsMenu';
import { VIEW_PAGE_PATH, type SavedView } from '../views/savedViews';
import { buildEventsWorkbook, eventsCsv, eventsFileName, eventsTable, EVENTS_EXPORT_CAP } from '../export/eventsExport';
import { downloadFile, stampNow } from '../export/files';
import { XLSX_MIME } from '../export/xlsx';
import { CSV_MIME } from '../export/csv';
import EventDetail from './events/EventDetail';
import TimelineView from './events/TimelineView';
import './events/timeline.css';
import '../components/ui.css';
import StickyTableWrap from '../components/StickyTableWrap';

function SortField({ f, set, id }: { f: Filters; set: (p: Partial<Filters>) => void; id: string }) {
  return (
    <div className="field">
      <label htmlFor={`${id}-sort`}>{t('Sort')}</label>
      <select id={`${id}-sort`} className="select" value={f.sort} onChange={(e) => set({ sort: e.target.value as Sort })} data-testid="filter-sort">
        <option value="stop_desc">{t('Newest first')}</option>
        <option value="stop_asc">{t('Oldest first')}</option>
        <option value="dur_desc">{t('Longest first')}</option>
      </select>
    </div>
  );
}

function ShowField({ f, set, id }: { f: Filters; set: (p: Partial<Filters>) => void; id: string }) {
  return (
    <div className="field">
      <label htmlFor={`${id}-show`}>{t('Show')}</label>
      <select id={`${id}-show`} className="select" value={f.show} onChange={(e) => set({ show: e.target.value as Show })} data-testid="filter-show">
        <option value="all">{t('All rows')}</option>
        <option value="issues">{t('Only rows with data issues')}</option>
        <option value="edited">{t('Only edited rows')}</option>
        <option value="void">{t('Only voided rows')}</option>
      </select>
    </div>
  );
}

/** The years as chips: a shortcut that sets the shared period to that whole year. */
function YearChips({ filters, setFilters, years }: { filters: DashFilters; setFilters: (p: Partial<DashFilters>) => void; years: number[] }) {
  const [, setYear] = useYear();
  if (years.length === 0) return null;
  return (
    <ChipRow label={t('Year')}>
      {years.map((y) => (
        <CountChip key={y} on={filters.preset === 'year' && filters.year === y} onClick={() => { setYear(y); setFilters({ preset: 'year', year: y }); }} testid={`year-${y}`}>{y}</CountChip>
      ))}
    </ChipRow>
  );
}

/** File name part of an export: the year, the month, or the two ISO dates. */
function exportLabel(f: DashFilters, range: DateRange | null): string {
  if (!range) return '';
  if (f.preset === 'year') return range.from.slice(0, 4);
  if (range.from.slice(0, 7) === range.to.slice(0, 7) && range.from.endsWith('-01') && (f.preset === 'month' || f.preset === 'prevmonth' || f.preset === 'thismonth' || f.preset === 'custom')) return range.from.slice(0, 7);
  return `${range.from}_${range.to}`;
}

export default function EventExplorer() {
  const sc = useRecordsScope();
  const { st, startup } = sc;
  const validation = useValidationOptional();
  const { canEdit, user } = useAuth();
  const { T } = useTheme();
  const mobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // List | Timeline: kept in the address (?view=timeline) so it survives a reload; List is the default
  const view: 'list' | 'timeline' = params.get('view') === 'timeline' ? 'timeline' : 'list';
  const setView = (v: 'list' | 'timeline') =>
    setParams((cur) => {
      const p = new URLSearchParams(cur);
      if (v === 'timeline') p.set('view', 'timeline'); else { p.delete('view'); p.delete('span'); p.delete('date'); }
      return p;
    }, { replace: true, state: location.state });
  // drill-through from a dashboard: show exactly these events (all years they live in), until the chip is removed
  const drill = readDrill(location.state);
  const multi = useEventsForYears(drill ? drill.years : []);
  const drillRows = useMemo(() => {
    if (!drill || !multi.ready) return null;
    const want = new Set(drill.rowIds ?? []);
    if (drill.eventIds?.length) {
      const ids = new Set(drill.eventIds);
      for (const c of buildFailureEvents(multi.rows, { includeVoid: true }).chains) if (ids.has(c.id)) for (const r of c.rows) want.add(r.event_id);
    }
    return multi.rows.filter((r) => want.has(r.event_id));
  }, [drill, multi.ready, multi.rows]);
  const sourceRows = drill ? drillRows ?? [] : sc.rows;
  // The scope (period, line, area, equipment, type) is the dashboards' shared filter set, read from the same query keys.
  // The page's own search, Show and order, and the shown count, live in their own keys (?q=belt&show=issues&n=100), so
  // Back, a tab switch or a reload brings the same list back and ScrollKeeper can restore the scroll into it.
  const shared = useMemo(() => ({ filters: sc.filters, range: sc.range }), [sc.filters, sc.range]);
  const filterKey = EXPLORER_KEYS.map((k) => params.getAll(k).join('\u0001')).join('\u0002');
  const f = useMemo(() => parseExplorerFilters(params), [filterKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Location updates render in a transition, so two quick changes could both start from the same rendered query and the
  // second would drop the first. Each change therefore starts from the address as it is now (the hash is written at once).
  const liveParams = (): URLSearchParams => {
    const h = window.location.hash;
    const i = h.indexOf('?');
    return h.startsWith('#/') ? new URLSearchParams(i < 0 ? '' : h.slice(i + 1)) : new URLSearchParams(params);
  };
  const writeParams = (edit: (p: URLSearchParams) => void) => {
    const p = liveParams();
    edit(p);
    setParams(p, { replace: true, state: location.state });
  };
  const liveFilters = (): Filters => parseExplorerFilters(liveParams());
  const setF = (next: Filters) =>
    writeParams((p) => {
      EXPLORER_KEYS.forEach((k) => p.delete(k));
      p.delete(SHOWN_PARAM); // a new filter starts at the first page again
      serializeExplorerFilters(next).forEach((v, k) => p.append(k, v));
      // the search is kept as typed while typing ('belt ' before 'belt c'); a saved view stores it trimmed
      if (next.q.trim()) p.set('q', next.q);
    });
  const [sheet, setSheet] = useState(false);
  const shownParam = Number(params.get(SHOWN_PARAM));
  const shown = Number.isInteger(shownParam) && shownParam > PAGE_SIZE ? shownParam : PAGE_SIZE;
  const setShown = (n: number) => writeParams((p) => { if (n > PAGE_SIZE) p.set(SHOWN_PARAM, String(n)); else p.delete(SHOWN_PARAM); });
  const [openId, setOpenId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<Filters>) => setF({ ...liveFilters(), ...p });
  // the search box answers each key at once (its text is local); the address follows. A change that did not come
  // from typing here (Back, Reset, a saved view) is copied into the box.
  const [qText, setQText] = useState(f.q);
  useEffect(() => {
    const live = liveParams().get('q') ?? '';
    if (live !== qText) setQText(live);
  }, [f.q]); // eslint-disable-line react-hooks/exhaustive-deps
  const typeSearch = (v: string) => {
    setQText(v);
    set({ q: v });
  };
  const q = useDeferredValue(qText);

  // the top bar's search shortcut lands here with the box focused
  const focusKey = (location.state as { focusSearch?: number } | null)?.focusSearch;
  useEffect(() => {
    if (focusKey) searchRef.current?.focus();
  }, [focusKey]);

  // the rows of the period (before the narrowing filters), the rows of the whole scope, then the page's own choices.
  // A drill-through shows exactly the events it was opened with: the scope already picked them.
  const periodRows = useMemo(() => (drill || !sc.range ? sourceRows : scopeRows(sourceRows, { filters: defaultFilters(), range: sc.range }, startup)), [drill, sourceRows, sc.range, startup]);
  const inScope = useMemo(() => (drill ? sourceRows : scopeRows(sourceRows, shared, startup)), [drill, sourceRows, shared, startup]);
  const filtered = useMemo(() => applyFilters(inScope, f, startup, q), [inScope, f, startup, q]);
  // the timeline has its own day / week window: the scope without the period
  const timelineRows = useMemo(
    () => (view !== 'timeline' ? [] : applyFilters(drill ? sourceRows : scopeRows(sourceRows, shared, startup, false), f, startup, q)),
    [view, drill, sourceRows, shared, startup, f, q],
  );
  // another scope or another drill-through starts at the first page again (not on the first render: the address may hold n)
  const pageKey = `${serializeFilters(sc.filters).toString()}|${drill?.label ?? ''}`;
  const lastPageKey = useRef(pageKey);
  useEffect(() => {
    if (lastPageKey.current === pageKey) return;
    lastPageKey.current = pageKey;
    if (params.has(SHOWN_PARAM)) setShown(PAGE_SIZE);
  }, [pageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    let sec = 0, failures = 0, issues = 0;
    for (const e of filtered) {
      if (hasOpenProblemFlags(e)) issues++;
      if (e.is_void || isBlocked(e)) continue; // left out of the numbers like everywhere else, but still listed below
      if (e.duration_s > 0) sec += e.duration_s;
      if (isFailureHead(e)) failures++; // P2: a failure = the first row of a failure event (Freq 1, Failure YES, not PL / CIR)
    }
    return { sec, failures, issues };
  }, [filtered]);
  const facts = useMemo(() => {
    let edited = 0, voided = 0;
    for (const e of periodRows) {
      if (e.is_void) voided++;
      else if (e.edited) edited++;
    }
    return { edited, voided };
  }, [periodRows]);

  const owners = useMemo(() => buildOwnerLookup(startup?.equipment_areas), [startup]);
  const areaName = useMemo(() => new Map(startup?.areas.map((a) => [a.area_id, a.name]) ?? []), [startup]);
  const open = openId ? sourceRows.find((e) => e.event_id === openId) ?? null : null;
  const visible = filtered.slice(0, shown);
  const total = periodRows.length;
  const dataReady = drill ? multi.ready : sc.ready;
  const periodName = sc.range ? rangeText(sc.range) : '';
  const ownOn = activeCount(f) + (qText.trim() ? 1 : 0);
  const filtersOn = totalActive(f, shared) + (qText.trim() ? 1 : 0);
  // Reset: the page's own choices and the shared scope
  const reset = () => {
    setQText('');
    writeParams((p) => { EXPLORER_KEYS.forEach((k) => p.delete(k)); p.delete(SHOWN_PARAM); });
    sc.reset();
  };
  const replaceEvent = (row: EventRow) => {
    if (validation) validation.replaceEvent(row);
    else for (const y of sc.years) eventsResource(y).patch((l) => l.map((e) => (e.event_id === row.event_id ? row : e)));
  };

  // ---- export: exactly the rows of the list (same filters, same order), capped at EVENTS_EXPORT_CAP
  const [exportNote, setExportNote] = useState<{ text: string; capped: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);
  const runExport = async (kind: 'xlsx' | 'csv') => {
    if (exporting || filtered.length === 0) return;
    setExporting(true);
    setExportNote({ text: t('Preparing the file…'), capped: false });
    await new Promise((r) => window.setTimeout(r, 30)); // let the note paint before the heavy work
    try {
      const ex = eventsTable(filtered, startup);
      const label = drill ? 'selection' : exportLabel(sc.filters, sc.range);
      const name = eventsFileName(label, kind);
      const ok = kind === 'xlsx'
        ? downloadFile(name, buildEventsWorkbook(ex, {
          filters: describeExplorerFilters(f, startup, drill ? null : shared), by: user?.display_name || user?.email || '', on: stampNow(),
          scope: drill ? t('Events opened from {label}', { label: drill.label }) : t('Events from {a} to {b}', { a: sc.range?.from ?? '', b: sc.range?.to ?? '' }),
        }), XLSX_MIME)
        : downloadFile(name, eventsCsv(ex), CSV_MIME);
      if (!ok) setExportNote({ text: t('The browser did not start the download. Try again.'), capped: false });
      else if (ex.capped) setExportNote({ text: t('{name}: the list has {n} events; the file holds the first {k}. Narrow the filters to export the rest.', { name, n: num(ex.matching), k: num(EVENTS_EXPORT_CAP) }), capped: true });
      else setExportNote({ text: t('{name}: {n} events exported.', { name, n: num(ex.exported) }), capped: false });
    } catch {
      setExportNote({ text: t('The file could not be made. Try again, or narrow the filters.'), capped: false });
    } finally {
      setExporting(false);
    }
  };
  const exportMenu = (
    <ExportMenu onExcel={() => void runExport('xlsx')} onCsv={() => void runExport('csv')} disabled={!dataReady || filtered.length === 0 || exporting} testid="export-btn" />
  );
  const applyView = (v: SavedView) => {
    // the shared filters follow the view (an empty set means the defaults), the page's own keys come with it
    const sp = new URLSearchParams(v.query);
    const sharedQ = serializeFilters(parseFilters(sp)).toString();
    rememberQuery(sharedQ);
    const own = nonFilterParams(sp);
    const query = [sharedQ, own.toString()].filter(Boolean).join('&');
    navigate({ pathname: VIEW_PAGE_PATH.events, search: query ? `?${query}` : '' });
  };
  const currentViewQuery = (): string => {
    const out = serializeFilters(sc.filters);
    serializeExplorerFilters(f).forEach((v, k) => out.append(k, v));
    if (view === 'timeline') out.set('view', 'timeline');
    return out.toString();
  };
  const viewsMenu = <ViewsMenu page="events" currentQuery={currentViewQuery} onApply={applyView} />;

  const searchBox = (
    <div className="field" style={{ flex: '1 1 260px', minWidth: 0 }}>
      <label htmlFor="ev-search">{t('Search')}</label>
      <input
        id="ev-search" ref={searchRef} className="input" type="search" value={qText} onChange={(e) => typeSearch(e.target.value)}
        placeholder={t('Code, reason or description')} autoComplete="off" data-testid="event-search"
      />
    </div>
  );
  // the shared Compare chip shows here too (it is one setting for every page); the list itself has no comparison
  const settings = useMemo(() => (startup ? parseSettings(startup.settings) : null), [startup]);
  const cmpMode: CompareMode = sc.filters.compare ?? settings?.defaultComparison ?? 'previous_period';
  const failureChip = (
    <CountChip on={sc.filters.failureOnly} onClick={() => sc.setFilters({ failureOnly: !sc.filters.failureOnly })} testid="failure-only">{t('Failures only')}</CountChip>
  );

  return (
    <div className="page" data-testid="page-events">
      <ScopeBar
        src={{
          filters: sc.filters, setFilters: sc.setFilters, reset, startup, range: sc.range, compareMode: cmpMode,
          compareRange: sc.range && cmpMode !== 'none' ? comparisonRange(sc.range, cmpMode) : null, settings, rows: sc.rows,
        }}
        eventCount={dataReady ? filtered.length : null} views={viewsMenu} exportMenu={exportMenu}
      />
      <PageHeader
        title={t('Event Explorer')}
        subtitle={dataReady
          ? (drill
            ? t('{shown} of {total} opened events · {hours} stoppage hours · {failures} failures', { shown: num(filtered.length), total: num(total), hours: hours(stats.sec), failures: num(stats.failures) })
            : t('{shown} of {total} events in {period} · {hours} stoppage hours · {failures} failures', { shown: num(filtered.length), total: num(total), period: periodName, hours: hours(stats.sec), failures: num(stats.failures) }))
          : t('Loading…')}
        right={
          <>
            <YearChips filters={sc.filters} setFilters={sc.setFilters} years={startup?.years ?? []} />
            <button type="button" className="btn btn-sm" onClick={sc.reload} disabled={sc.state.refreshing || sc.state.loading} data-testid="refresh">
              <Icon name="sync" size={14} /> {sc.state.refreshing ? t('Refreshing…') : t('Refresh')}
            </button>
          </>
        }
      />
      <ValidationBanner />
      {st.error || (st.loading && !st.data) ? <DataStatus state={st} onRetry={st.reload} what={t('master data')} /> : <DataStatus state={sc.state} onRetry={sc.reload} what={t('events')} />}
      {drill && (
        <div className="callout" role="status" data-testid="drill-chip">
          <Icon name="filter" size={16} />
          <span data-testid="drill-text">{t('Showing {n} events from {label}', { n: num(drill.eventIds?.length ?? drill.rowIds?.length ?? 0), label: drill.label })}</span>
          <button type="button" className="btn btn-sm" onClick={() => navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })} data-testid="drill-remove" aria-label={t('Remove the filter: {label}', { label: drill.label })}>
            <Icon name="close" size={14} /> {t('Remove')}
          </button>
        </div>
      )}

      {exportNote && (
        <div className="callout" role="status" data-testid="export-note">
          <Icon name={exportNote.capped ? 'alert' : 'download'} size={16} />
          <span data-testid="export-note-text">{exportNote.text}</span>
          <button type="button" className="btn btn-sm" onClick={() => setExportNote(null)} aria-label={t('Dismiss this note')}><Icon name="close" size={14} /></button>
        </div>
      )}

      <div className="seg view-switch" role="group" aria-label={t('Event view')} data-testid="view-switch">
        <button type="button" className="seg-btn" aria-pressed={view === 'list'} onClick={() => setView('list')} data-testid="view-list">{t('List')}</button>
        <button type="button" className="seg-btn" aria-pressed={view === 'timeline'} onClick={() => setView('timeline')} data-testid="view-timeline">{t('Timeline')}</button>
      </div>

      {!mobile ? (
        <>
          {view === 'list' && (
          <div className="tiles" data-testid="event-tiles">
            <Tile icon="list" label={t('Events shown')} value={num(filtered.length)} sub={drill ? t('of {n} in the opened events', { n: num(total) }) : t('of {n} in {period}', { n: num(total), period: periodName })} testid="tile-shown" />
            <Tile icon="clock" label={t('Stoppage hours shown')} value={hours(stats.sec)} sub={t('area-hours, not voided or left out')} testid="tile-hours" />
            <Tile icon="alert" label={t('Failures shown')} value={num(stats.failures)} tone={stats.failures ? T.danger : undefined} sub={t('not voided or left out')} testid="tile-failures" />
            <Tile icon="info" label={t('Rows with data issues')} value={num(stats.issues)} tone={stats.issues ? T.warning : undefined} sub={t('{n} edited · {v} voided in this period', { n: facts.edited, v: facts.voided })} testid="tile-issues" />
          </div>
          )}
          <section className="card ev-tools-card" aria-label={t('Find in these records')} data-testid="filters">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {searchBox}
              <ShowField f={f} set={set} id="top" />
              <SortField f={f} set={set} id="top" />
              <div className="field">
                <span className="field-label">{t('Failures')}</span>
                {failureChip}
              </div>
              <button type="button" className="btn" onClick={reset} disabled={filtersOn === 0} data-testid="reset-filters">{t('Reset filters')}</button>
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="phone-summary" data-testid="phone-summary">
            <b>{num(filtered.length)}</b> {t('events')}
            <span><span aria-hidden="true">◆</span> {num(stats.failures)} {t('failures')}</span>
            <span><span aria-hidden="true">▲</span> {num(stats.issues)} {t('with issues')}</span>
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="ev-search" className="field-label">{t('Search')}</label>
            <input id="ev-search" ref={searchRef} className="input" type="search" value={qText} onChange={(e) => typeSearch(e.target.value)} placeholder={t('Code, reason or description')} autoComplete="off" data-testid="event-search" />
          </div>
          <ChipRow label={t('Quick filters')}>
            {failureChip}
            <FiltersPill count={activeCount(f)} label={t('Show and order')} onClick={() => setSheet(true)} testid="filters-pill" />
            {filtersOn > 0 && <button type="button" className="chip" onClick={reset} data-testid="reset-filters">{t('Reset')}</button>}
          </ChipRow>
          {sheet && (
            <BottomSheet
              title={t('Show and order')}
              onClose={() => setSheet(false)}
              testid="filters-sheet"
              footer={
                <>
                  <button type="button" className="btn" onClick={() => setF({ ...EMPTY, q: liveFilters().q })}>{t('Reset')}</button>
                  <button type="button" className="btn-brand" onClick={() => setSheet(false)} data-testid="sheet-apply">{t('Show {n} events', { n: num(filtered.length) })}</button>
                </>
              }
            >
              <div className="bottom-sheet-body" style={{ padding: 0 }}>
                <ShowField f={f} set={set} id="s" />
                <SortField f={f} set={set} id="s" />
              </div>
              {ownOn > 0 && <p className="field-hint">{t('The period, line, area, equipment and type are under Filters at the top: they are shared with the dashboards.')}</p>}
            </BottomSheet>
          )}
        </>
      )}

      {dataReady && view === 'timeline' && (
        <div style={{ marginTop: 12 }}>
          <TimelineView sourceRows={sourceRows} filteredRows={timelineRows} startup={startup} year={drill ? '' : periodName} mobile={mobile} onOpen={setOpenId} />
        </div>
      )}
      {dataReady && view === 'list' && (
        <div style={{ marginTop: 12 }}>
          {filtered.length === 0 ? (
            <div className="callout" role="status" data-testid="no-results">
              <Icon name="info" size={16} />
              <span>{t('No events match these filters.')}</span>
              <button type="button" className="btn btn-sm" onClick={reset}>{t('Reset filters')}</button>
            </div>
          ) : !mobile ? (
            <StickyTableWrap testid="event-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('Stopped at')}</th>
                    <th scope="col">{t('Area')}</th>
                    <th scope="col">{t('Code')}</th>
                    <th scope="col">{t('Class')}</th>
                    <th scope="col" className="num">{t('Duration')}</th>
                    <th scope="col">{t('Reason')}</th>
                    <th scope="col">{t('Status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr key={e.event_id} className={e.is_void ? 'row--void' : undefined} data-testid="event-row" data-event-id={e.event_id}>
                      <td className="nowrap">
                        <button type="button" className="row-link" onClick={() => setOpenId(e.event_id)} aria-label={t('Open event {id}', { id: e.event_id })}>{shortTs(e.stop_ts)}</button>
                      </td>
                      <td className="nowrap">{e.area_id}<div className="muted" style={{ fontSize: 12 }}>{areaName.get(e.area_id)}</div></td>
                      <td className="mono nowrap">{e.code_raw || '-'}</td>
                      <td><span className="badge badge--class">{e.classification}</span></td>
                      <td className="num">{duration(e.duration_s)}</td>
                      <td>{e.reason_raw || <span className="muted">{t('(blank)')}</span>}{e.description && <div className="muted" style={{ fontSize: 12.5 }}>{e.description}</div>}</td>
                      <td><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}><EventBadges row={e} owners={owners} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </StickyTableWrap>
          ) : (
            <div className="event-cards" data-testid="event-cards">
              {visible.map((e) => (
                <button key={e.event_id} type="button" className={e.is_void ? 'event-card event-card--void' : 'event-card'} onClick={() => setOpenId(e.event_id)} data-testid="event-card" data-event-id={e.event_id}>
                  <div className="event-card-top">
                    <span className="event-card-code">{e.area_id} · {e.code_raw || 'N/A'}</span>
                    <span className="badge badge--class">{e.classification}</span>
                  </div>
                  <div className="event-card-line mono">{shortTs(e.stop_ts)} · {duration(e.duration_s)}</div>
                  <div className="event-card-line">{e.reason_raw || t('(blank)')}</div>
                  <div className="event-card-badges"><EventBadges row={e} maxFlags={2} owners={owners} /></div>
                </button>
              ))}
            </div>
          )}
          <ShowMore shown={visible.length} total={filtered.length} onMore={() => setShown(shown + PAGE_SIZE)} />
          {filtered.length > 0 && (
            <p className="status-line" style={{ marginTop: 8 }} data-testid="list-count">
              {t('Showing {a} of {b} matching events.', { a: num(visible.length), b: num(filtered.length) })}
            </p>
          )}
        </div>
      )}

      {open && (
        <EventDetail
          key={open.event_id}
          row={open}
          startup={startup}
          canEdit={canEdit('events')}
          onClose={() => setOpenId(null)}
          onChanged={replaceEvent}
        />
      )}
    </div>
  );
}
