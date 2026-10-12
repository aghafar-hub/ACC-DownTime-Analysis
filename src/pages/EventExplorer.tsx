import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { ClassificationCode, EventRow, Startup } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import DataNotes from '../components/DataNotes';
import { BottomSheet, ChipRow, CountChip, FiltersPill, PAGE_SIZE, ShowMore } from '../components/PhoneParts';
import { PageHeader, Tile } from '../components/Tile';
import YearSwitch from '../components/YearSwitch';
import { buildFailureEvents } from '../calc';
import { readDrill } from '../dashboard/drill';
import { useEventsForYears } from '../dashboard/useDash';
import { useYearData } from '../data/useYearData';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useTheme } from '../theme/ThemeContext';
import { duration, hours, num, shortTs } from '../util/format';
import EventBadges from './events/EventBadges';
import EventDetail from './events/EventDetail';
import '../components/ui.css';

type Show = 'all' | 'issues' | 'edited' | 'void';
type Sort = 'stop_desc' | 'stop_asc' | 'dur_desc';
interface Filters {
  q: string; line: string; area: string; classes: ClassificationCode[]; crit: '' | 'INC' | 'NO_INC';
  failureOnly: boolean; from: string; to: string; show: Show; sort: Sort;
}
const EMPTY: Filters = { q: '', line: '', area: '', classes: [], crit: '', failureOnly: false, from: '', to: '', show: 'all', sort: 'stop_desc' };

/** How many filters are active (the search box and the sort order are not counted). */
function activeCount(f: Filters, includeFailure = true): number {
  return [f.line, f.area, f.classes.length > 0, f.crit, includeFailure && f.failureOnly, f.from, f.to, f.show !== 'all'].filter(Boolean).length;
}

function applyFilters(rows: EventRow[], f: Filters, startup: Startup | null, q: string): EventRow[] {
  const needle = q.trim().toLowerCase();
  const reasonText = new Map(startup?.reasons.map((r) => [r.reason_id, r.text_as_listed.trim().toLowerCase()]) ?? []);
  // the area decides the line (the sheet's own line can be wrong)
  const lineOfArea = new Map(startup?.areas.map((a) => [a.area_id, a.line_id]) ?? []);
  const out = rows.filter((e) => {
    if (f.line && (lineOfArea.get(e.area_id) ?? e.line_id) !== f.line) return false;
    if (f.area && e.area_id !== f.area) return false;
    if (f.classes.length && !f.classes.includes(e.classification)) return false;
    if (f.crit && e.criticality !== f.crit) return false;
    if (f.failureOnly && !(e.is_failure && !e.is_void)) return false;
    if (f.from && e.event_date < f.from) return false;
    if (f.to && e.event_date > f.to) return false;
    if (f.show === 'issues' && !e.flags) return false;
    if (f.show === 'edited' && !e.edited) return false;
    if (f.show === 'void' && !e.is_void) return false;
    if (needle) {
      const hay = `${e.code_raw} ${e.equipment_id ?? ''} ${e.reason_raw ?? ''} ${e.reason_id ? reasonText.get(e.reason_id) ?? '' : ''} ${e.description ?? ''} ${e.event_id}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  if (f.sort === 'stop_desc') out.sort((a, b) => b.stop_ts.localeCompare(a.stop_ts) || a.area_id.localeCompare(b.area_id));
  else if (f.sort === 'stop_asc') out.sort((a, b) => a.stop_ts.localeCompare(b.stop_ts) || a.area_id.localeCompare(b.area_id));
  else out.sort((a, b) => b.duration_s - a.duration_s);
  return out;
}

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

function FilterFields({ f, set, startup, stacked }: { f: Filters; set: (p: Partial<Filters>) => void; startup: Startup | null; stacked?: boolean }) {
  const areas = (startup?.areas ?? []).filter((a) => !f.line || a.line_id === f.line);
  const toggleClass = (c: ClassificationCode) => set({ classes: f.classes.includes(c) ? f.classes.filter((x) => x !== c) : [...f.classes, c] });
  const id = stacked ? 's' : 'd';
  return (
    <>
      <div className={stacked ? 'bottom-sheet-body' : 'filter-grid'} style={stacked ? { padding: 0 } : undefined}>
        <div className="field">
          <label htmlFor={`${id}-line`}>{t('Line')}</label>
          <select id={`${id}-line`} className="select" value={f.line} onChange={(e) => set({ line: e.target.value, area: '' })} data-testid="filter-line">
            <option value="">{t('All lines')}</option>
            {startup?.lines.map((l) => <option key={l.line_id} value={l.line_id}>{l.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-area`}>{t('Area')}</label>
          <select id={`${id}-area`} className="select" value={f.area} onChange={(e) => set({ area: e.target.value })} data-testid="filter-area">
            <option value="">{t('All areas')}</option>
            {areas.map((a) => <option key={a.area_id} value={a.area_id}>{a.area_id} · {a.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-crit`}>{t('Criticality')}</label>
          <select id={`${id}-crit`} className="select" value={f.crit} onChange={(e) => set({ crit: e.target.value as Filters['crit'] })} data-testid="filter-crit">
            <option value="">{t('All')}</option>
            <option value="INC">INC ({t('incident')})</option>
            <option value="NO_INC">NO_INC</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-from`}>{t('From date')}</label>
          <input id={`${id}-from`} className="input mono" type="date" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} data-testid="filter-from" />
        </div>
        <div className="field">
          <label htmlFor={`${id}-to`}>{t('To date')}</label>
          <input id={`${id}-to`} className="input mono" type="date" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} data-testid="filter-to" />
        </div>
        <div className="field">
          <label htmlFor={`${id}-show`}>{t('Show')}</label>
          <select id={`${id}-show`} className="select" value={f.show} onChange={(e) => set({ show: e.target.value as Show })} data-testid="filter-show">
            <option value="all">{t('All rows')}</option>
            <option value="issues">{t('Only rows with data issues')}</option>
            <option value="edited">{t('Only edited rows')}</option>
            <option value="void">{t('Only voided rows')}</option>
          </select>
        </div>
        {stacked && <SortField f={f} set={set} id={id} />}
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <span className="field-label">{t('Classification')}</span>
        <ChipRow label={t('Classification')}>
          {(startup?.classifications ?? []).map((c) => (
            <CountChip key={c.code} on={f.classes.includes(c.code)} onClick={() => toggleClass(c.code)} testid={`class-${c.code}`}>{c.code} · {c.name}</CountChip>
          ))}
        </ChipRow>
      </div>
    </>
  );
}

export default function EventExplorer() {
  const { st, startup, year, ev, facts } = useYearData();
  const { canEdit } = useAuth();
  const { T } = useTheme();
  const mobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
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
  const sourceRows = drill ? drillRows ?? [] : ev.events;
  const [f, setF] = useState<Filters>(EMPTY);
  const [sheet, setSheet] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openId, setOpenId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const set = (p: Partial<Filters>) => setF((cur) => ({ ...cur, ...p }));
  const q = useDeferredValue(f.q);

  // the top bar's search shortcut lands here with the box focused
  const focusKey = (location.state as { focusSearch?: number } | null)?.focusSearch;
  useEffect(() => {
    if (focusKey) searchRef.current?.focus();
  }, [focusKey]);

  const filtered = useMemo(() => applyFilters(sourceRows, f, startup, q), [sourceRows, f, startup, q]);
  useEffect(() => setShown(PAGE_SIZE), [f, q, year, drill?.label]);

  const stats = useMemo(() => {
    let sec = 0, failures = 0, issues = 0;
    for (const e of filtered) {
      if (e.flags) issues++;
      if (e.is_void) continue;
      if (e.duration_s > 0) sec += e.duration_s;
      if (e.is_failure) failures++;
    }
    return { sec, failures, issues };
  }, [filtered]);

  const areaName = useMemo(() => new Map(startup?.areas.map((a) => [a.area_id, a.name]) ?? []), [startup]);
  const open = openId ? sourceRows.find((e) => e.event_id === openId) ?? null : null;
  const visible = filtered.slice(0, shown);
  const total = sourceRows.length;
  const dataReady = drill ? multi.ready : !!ev.data;
  const filtersOn = activeCount(f) + (f.q.trim() ? 1 : 0);
  const reset = () => setF(EMPTY);

  const searchBox = (
    <div className="field" style={{ flex: '1 1 260px', minWidth: 0 }}>
      <label htmlFor="ev-search">{t('Search')}</label>
      <input
        id="ev-search" ref={searchRef} className="input" type="search" value={f.q} onChange={(e) => set({ q: e.target.value })}
        placeholder={t('Code, reason or description')} autoComplete="off" data-testid="event-search"
      />
    </div>
  );

  return (
    <div className="page" data-testid="page-events">
      <PageHeader
        title={t('Event Explorer')}
        subtitle={dataReady ? t('{shown} of {total} events in {year} · {hours} stoppage hours · {failures} failures', { shown: num(filtered.length), total: num(total), year: year ?? '', hours: hours(stats.sec), failures: num(stats.failures) }) : t('Loading…')}
        right={
          <>
            <YearSwitch />
            <button type="button" className="btn btn-sm" onClick={() => { st.reload(); ev.reload(); }} disabled={ev.refreshing || ev.loading} data-testid="refresh">
              <Icon name="sync" size={14} /> {ev.refreshing ? t('Refreshing…') : t('Refresh')}
            </button>
          </>
        }
      />
      <DataNotes st={st} ev={ev} />
      {drill && (
        <div className="callout" role="status" data-testid="drill-chip">
          <Icon name="filter" size={16} />
          <span data-testid="drill-text">{t('Showing {n} events from {label}', { n: num(drill.eventIds?.length ?? drill.rowIds?.length ?? 0), label: drill.label })}</span>
          <button type="button" className="btn btn-sm" onClick={() => navigate(location.pathname, { replace: true, state: null })} data-testid="drill-remove" aria-label={t('Remove the filter: {label}', { label: drill.label })}>
            <Icon name="close" size={14} /> {t('Remove')}
          </button>
        </div>
      )}

      {!mobile ? (
        <>
          <div className="tiles" data-testid="event-tiles">
            <Tile icon="list" label={t('Events shown')} value={num(filtered.length)} sub={drill ? t('of {n} in the opened events', { n: num(total) }) : t('of {n} in {year}', { n: num(total), year: year ?? '' })} testid="tile-shown" />
            <Tile icon="clock" label={t('Stoppage hours shown')} value={hours(stats.sec)} sub={t('area-hours, not voided')} testid="tile-hours" />
            <Tile icon="alert" label={t('Failures shown')} value={num(stats.failures)} tone={stats.failures ? T.danger : undefined} sub={t('not voided')} testid="tile-failures" />
            <Tile icon="info" label={t('Rows with data issues')} value={num(stats.issues)} tone={stats.issues ? T.warning : undefined} sub={t('{n} edited · {v} voided in {year}', { n: facts.edited, v: facts.voided, year: year ?? '' })} testid="tile-issues" />
          </div>
          <section className="card" aria-label={t('Filters')} data-testid="filters">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
              {searchBox}
              <SortField f={f} set={set} id="top" />
              <div className="field">
                <span className="field-label">{t('Failures')}</span>
                <CountChip on={f.failureOnly} onClick={() => set({ failureOnly: !f.failureOnly })} testid="failure-only">{t('Failures only')}</CountChip>
              </div>
              <button type="button" className="btn" onClick={reset} disabled={filtersOn === 0} data-testid="reset-filters">{t('Reset filters')}</button>
            </div>
            <FilterFields f={f} set={set} startup={startup} />
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
            <input id="ev-search" ref={searchRef} className="input" type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder={t('Code, reason or description')} autoComplete="off" data-testid="event-search" />
          </div>
          <ChipRow label={t('Quick filters')}>
            <CountChip on={f.failureOnly} onClick={() => set({ failureOnly: !f.failureOnly })} testid="failure-only">{t('Failures only')}</CountChip>
            <FiltersPill count={activeCount(f, false)} onClick={() => setSheet(true)} testid="filters-pill" />
            {filtersOn > 0 && <button type="button" className="chip" onClick={reset}>{t('Reset')}</button>}
          </ChipRow>
          {sheet && (
            <BottomSheet
              title={t('Filters')}
              onClose={() => setSheet(false)}
              testid="filters-sheet"
              footer={
                <>
                  <button type="button" className="btn" onClick={reset}>{t('Reset')}</button>
                  <button type="button" className="btn-primary" onClick={() => setSheet(false)} data-testid="sheet-apply">{t('Show {n} events', { n: num(filtered.length) })}</button>
                </>
              }
            >
              <FilterFields f={f} set={set} startup={startup} stacked />
            </BottomSheet>
          )}
        </>
      )}

      {dataReady && (
        <div style={{ marginTop: 12 }}>
          {filtered.length === 0 ? (
            <div className="callout" role="status" data-testid="no-results">
              <Icon name="info" size={16} />
              <span>{t('No events match these filters.')}</span>
              <button type="button" className="btn btn-sm" onClick={reset}>{t('Reset filters')}</button>
            </div>
          ) : !mobile ? (
            <div className="table-wrap" data-testid="event-table">
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
                      <td><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}><EventBadges row={e} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                  <div className="event-card-badges"><EventBadges row={e} maxFlags={2} /></div>
                </button>
              ))}
            </div>
          )}
          <ShowMore shown={visible.length} total={filtered.length} onMore={() => setShown((n) => n + PAGE_SIZE)} />
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
          onChanged={ev.replaceEvent}
        />
      )}
    </div>
  );
}
