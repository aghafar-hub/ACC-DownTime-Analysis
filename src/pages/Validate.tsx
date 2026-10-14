import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { monthText, tsText } from '../util/dates';
import { useLocation } from 'react-router-dom';
import { api, describeError } from '../api';
import type { EventRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { FLAG_INFO } from '../calc/flags';
import DataStatus from '../components/DataStatus';
import { BottomSheet, ChipRow, CountChip, FiltersPill, PAGE_SIZE, ShowMore } from '../components/PhoneParts';
import { SAVE_BLOCKED_EVENT } from '../components/SaveBlockedToast';
import { PageHeader, Tile } from '../components/Tile';
import RowMenu from '../components/RowMenu';
import { MenuItem } from '../components/PopMenu';
import { useIsMobile } from '../hooks/useIsMobile';
import { t, tn } from '../i18n/t';
import { inactiveAreas } from '../data/activeAreas';
import { Icon } from '../icons';
import { pageById, pageLabel } from '../navigation';
import { useTheme } from '../theme/ThemeContext';
import { useOnlineStatus } from '../useOnlineStatus';
import { duration, hours, num, shortTs } from '../util/format';
import BulkModal, { BULK_NOTE } from '../validate/BulkModal';
import KeepModal, { type KeepTarget } from '../validate/KeepModal';
import {
  applyKeptFilter, applyValidateFilter, areasOf, BULK_CAP, EMPTY_FILTER, filterCount, filterFromParams, firstFixHint, flagCounts, monthsOf,
  type BulkResult, type KeptRecord, type ValidateFilter, type ValidationRecord,
} from '../validate/model';
import { QualityTable } from '../validate/Quality';
import { useKeepNotes, useUserNames } from '../validate/useKeepInfo';
import { useValidation } from '../validate/ValidationContext';
import { flagLabel } from './events/eventLabels';
import EventDetail from './events/EventDetail';
import '../components/ui.css';
import '../validate/validate.css';
import StickyTableWrap from '../components/StickyTableWrap';

const monthName = (key: string): string => monthText(key);

type OpenState = { id: string; mode: 'view' | 'edit' | 'void' } | null;
type View = 'open' | 'kept' | 'overlaps';
type KeepState = { mode: 'keep' | 'undo'; targets: KeepTarget[] } | null;

/** One problem as a badge: ◆ for a problem that leaves the record out of the numbers, ▲ for one that is only to review. */
function ProblemBadge({ flag }: { flag: string }) {
  const blocking = (FLAG_INFO as Record<string, { blocking: boolean } | undefined>)[flag]?.blocking ?? false;
  return (
    <span className={blocking ? 'badge badge--danger' : 'badge badge--warning'} data-testid="v-flag" data-flag={flag}>
      <span aria-hidden="true">{blocking ? '◆' : '▲'}</span> {flagLabel(flag)}
    </span>
  );
}

function Problems({ r }: { r: ValidationRecord }) {
  const hint = firstFixHint(r);
  return (
    <>
      <div className="v-problems">
        {r.problems.map((f) => <ProblemBadge key={f} flag={f} />)}
        {r.info.map((f) => (
          <span key={f} className="badge" data-testid="v-info-flag" data-flag={f} title={t('Information: counted once, nothing to fix')}>
            <span aria-hidden="true">ℹ</span> {flagLabel(f)}
          </span>
        ))}
      </div>
      {hint && <p className="v-fix" data-testid="v-fix">{t(hint)}</p>}
      {r.kept.length > 0 && <p className="v-kept-also" data-testid="v-also-kept">{t('Also kept as entered: {list}', { list: r.kept.map(flagLabel).join(', ') })}</p>}
    </>
  );
}

/** The desktop row: the problems on one line, what to do as a second short column (full text in the tooltip). */
function ProblemsLine({ r }: { r: ValidationRecord }) {
  return (
    <div className="v-problems v-problems--line">
      {r.problems.slice(0, 1).map((f) => <ProblemBadge key={f} flag={f} />)}
      {r.problems.length > 1 && (
        <span className="badge" data-testid="v-flag-more" title={r.problems.slice(1).map(flagLabel).join(', ')}>+{r.problems.length - 1}</span>
      )}
      {r.info.map((f) => (
        <span key={f} className="badge" data-testid="v-info-flag" data-flag={f} title={t('Information: counted once, nothing to fix')}>
          <span aria-hidden="true">ℹ</span> {flagLabel(f)}
        </span>
      ))}
      {r.kept.length > 0 && (
        <span className="badge" data-testid="v-also-kept" title={t('Also kept as entered: {list}', { list: r.kept.map(flagLabel).join(', ') })}>
          <span aria-hidden="true">✓</span> {t('{n} kept', { n: r.kept.length })}
        </span>
      )}
    </div>
  );
}

/** Who kept a kept-as-entered record, when and why, and which problems it covers. */
function KeptInfo({ k, userName, note }: { k: KeptRecord; userName: (id: string | undefined) => string; note: string | undefined }) {
  const e = k.event;
  return (
    <>
      <div className="v-problems">
        {k.flags.map((f) => (
          <span key={f} className="badge" data-testid="v-kept-flag" data-flag={f}><span aria-hidden="true">✓</span> {flagLabel(f)}</span>
        ))}
      </div>
      <p className="v-kept-note" data-testid="v-kept-by">
        {t('Kept as entered by {name} on {date}', { name: userName(e.accepted_by), date: tsText(e.accepted_at ?? '') })}
        {note ? <>{': '}<span data-testid="v-kept-note">{note}</span></> : null}
      </p>
      {k.leftOut && <p className="v-kept-also" data-testid="v-kept-leftout">{t('Still left out of the numbers: it cannot be calculated.')}</p>}
    </>
  );
}

export default function Validate() {
  const v = useValidation();
  const { token, canEdit } = useAuth();
  const { T } = useTheme();
  const mobile = useIsMobile();
  const online = useOnlineStatus();
  const editor = canEdit('events');
  const { list, rows, ready, st, loadAll } = v;
  // this page needs every year's records: no waiting for idle time
  useEffect(() => loadAll(), [loadAll]);
  const startup = st.startup;
  const { summary } = list;

  const location = useLocation();
  // a link from a notification names its filter in the address (?flag=unknown_code&q=AFR2)
  const [f, setF] = useState<ValidateFilter>(() => filterFromParams(new URLSearchParams(location.search)) ?? EMPTY_FILTER);
  useEffect(() => {
    const fromLink = filterFromParams(new URLSearchParams(location.search));
    if (fromLink) setF(fromLink);
  }, [location.search]);
  const [sheet, setSheet] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<OpenState>(null);
  const [bulkIds, setBulkIds] = useState<string[] | null>(null);
  const [view, setView] = useState<View>('open');
  const [keep, setKeep] = useState<KeepState>(null);
  const [fixed, setFixed] = useState<{ n: number; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const q = useDeferredValue(f.q);
  const set = (p: Partial<ValidateFilter>) => setF((cur) => ({ ...cur, ...p }));
  const reset = () => setF(EMPTY_FILTER);

  // the Overlaps view lists every overlapping record as INFORMATION (problem chips and 'blocking only' do not apply there)
  const filtered = useMemo(
    () => (view === 'overlaps' ? applyValidateFilter(list.overlapRecords, { ...f, flags: [], blockingOnly: false, q }) : applyValidateFilter(list.records, { ...f, q })),
    [list.records, list.overlapRecords, f, q, view],
  );
  const filteredKept = useMemo(() => applyKeptFilter(list.keptRecords, { ...f, q }), [list.keptRecords, f, q]);
  useEffect(() => setShown(PAGE_SIZE), [f, q, view]);
  const visible = filtered.slice(0, shown);
  const visibleKept = filteredKept.slice(0, shown);
  const userName = useUserNames();
  const keptNote = useKeepNotes(useMemo(() => (view === 'kept' ? visibleKept.map((k) => k.event) : []), [view, visibleKept]));
  const flags = useMemo(() => flagCounts(list.records), [list.records]);
  const both = useMemo(() => [...list.records, ...list.keptRecords], [list.records, list.keptRecords]);
  const areas = useMemo(() => areasOf(both), [both]);
  const months = useMemo(() => monthsOf(both), [both]);
  const areaName = useMemo(() => new Map(startup?.areas.map((a) => [a.area_id, a.name]) ?? []), [startup]);
  const recordById = useMemo(() => new Map(list.records.map((r) => [r.event.event_id, r])), [list.records]);
  const infoById = useMemo(() => new Map(list.overlapRecords.map((r) => [r.event.event_id, r])), [list.overlapRecords]);
  const tickable = editor && view === 'open';

  // ticked rows that are still in the list (a fixed row drops out of the selection by itself)
  const selIds = useMemo(() => list.records.filter((r) => sel.has(r.event.event_id)).map((r) => r.event.event_id), [list.records, sel]);
  const toggle = (id: string) => setSel((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const allVisibleTicked = visible.length > 0 && visible.every((r) => sel.has(r.event.event_id));
  const toggleVisible = () => setSel((cur) => {
    const next = new Set(cur);
    for (const r of visible) {
      if (allVisibleTicked) next.delete(r.event.event_id);
      else next.add(r.event.event_id);
    }
    return next;
  });
  const selectAllMatching = () => setSel(new Set(filtered.slice(0, BULK_CAP).map((r) => r.event.event_id)));

  const keepFor = (ids: string[]) => {
    const targets = ids.map((id) => recordById.get(id)).filter((r): r is ValidationRecord => !!r).map((r) => ({ event: r.event, problems: r.problems, kept: r.kept }));
    if (targets.length) setKeep({ mode: 'keep', targets });
  };
  const undoFor = (k: KeptRecord) => setKeep({ mode: 'undo', targets: [{ event: k.event, problems: [], kept: k.flags }] });
  const onKeepFinished = (res: BulkResult) => {
    // records that were kept leave the selection; refused ones stay ticked
    setSel(new Set(res.failed.map((x) => x.id)));
    if (res.done.length) {
      setFixed({ n: Date.now(), text: keep?.mode === 'undo' ? tn(res.done.length, 'Undone: {n} record is listed under Open again.', 'Undone: {n} records are listed under Open again.').replace('{n}', num(res.done.length)) : tn(res.done.length, 'Kept as entered: {n} record. It is no longer listed under Open.', 'Kept as entered: {n} records. They are no longer listed under Open.').replace('{n}', num(res.done.length)) });
    }
  };

  const openEvent = useMemo(() => (open ? rows.find((e) => e.event_id === open.id) ?? null : null), [open, rows]);
  const openRecord = open ? recordById.get(open.id) ?? infoById.get(open.id) : undefined;
  const byId = useCallback((id: string) => rows.find((e) => e.event_id === id), [rows]);
  const overlaps = useMemo(
    () => (openRecord ? openRecord.partners.map((id) => rows.find((e) => e.event_id === id)).filter((e): e is EventRow => !!e) : []),
    [openRecord, rows],
  );

  const editBlocked = () => window.dispatchEvent(new CustomEvent(SAVE_BLOCKED_EVENT, { detail: { message: t('Editing needs a connection.') } }));
  const openFor = (id: string, mode: 'view' | 'edit' | 'void') => {
    if (mode !== 'view' && !online) return editBlocked();
    setOpen({ id, mode });
  };

  async function recheckAll() {
    if (!token) return;
    if (!online) return editBlocked();
    setChecking(true);
    setCheckMsg(null);
    try {
      const r = await api.revalidateEvents(token);
      setCheckMsg({ ok: true, text: t('Checked {n}, changed {m}', { n: num(r.checked), m: num(r.changed) }) });
      v.reload();
    } catch (err) {
      setCheckMsg({ ok: false, text: describeError(err) });
    } finally {
      setChecking(false);
    }
  }

  const onBulkFinished = (res: BulkResult) => {
    // ticked records that were saved leave the selection; refused ones stay ticked
    setSel(new Set(res.failed.map((x) => x.id)));
  };

  const where = (e: EventRow) => `${e.area_id} · ${e.code_raw || 'N/A'}`;
  const dataReady = ready;
  const keptNote0 = summary.kept.count > 0 ? ` · ${t('{n} kept as entered', { n: num(summary.kept.count) })}` : '';
  const subtitle = !dataReady
    ? t('Loading…')
    : summary.total === 0
      ? `${t('Nothing needs checking.')}${keptNote0}`
      : `${tn(summary.total, '{n} record needs checking', '{n} records need checking')}, ${t('{m} of them left out of the numbers ({h} h)', { m: num(summary.blocked.count), h: hours(summary.blocked.hours * 3600) })}${keptNote0}`;

  const hintText = `${t('Records marked ◆ are left out of every chart and total until they are fixed. Records marked ▲ are counted as they are; check them when you can.')} ${t('Stops that overlap in the same area (ℹ) are information only: the shared time is counted once.')} ${
    editor
      ? `${t('If a record is correct as entered, use Keep as entered: nothing in it changes and it stops being listed.')} ${t('Use Re-check after you add equipment codes, aliases or reasons in Master Data: it checks every record again.')}`
      : t('You can read this list. Someone with Edit access to Event Explorer fixes the records.')
  }`;
  const filtersOn = filterCount(f);
  const sheetCount = [f.area, f.month].filter(Boolean).length + f.flags.length;

  const areaSelect = (id: string) => (
    <div className="field">
      <label htmlFor={`${id}-area`}>{t('Area')}</label>
      <select id={`${id}-area`} className="select" value={f.area} onChange={(e) => set({ area: e.target.value })} data-testid={`${id}-area`}>
        <option value="">{t('All areas')}</option>
        {areas.map((a) => <option key={a} value={a}>{a}{areaName.get(a) ? ` · ${areaName.get(a)}` : ''}</option>)}
      </select>
    </div>
  );
  const monthSelect = (id: string) => (
    <div className="field">
      <label htmlFor={`${id}-month`}>{t('Month')}</label>
      <select id={`${id}-month`} className="select" value={f.month} onChange={(e) => set({ month: e.target.value })} data-testid={`${id}-month`}>
        <option value="">{t('All months')}</option>
        {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
      </select>
    </div>
  );
  const searchBox = (
    <div className="field" style={{ flex: '1 1 240px', minWidth: 0 }}>
      <label htmlFor="v-search">{t('Search')}</label>
      <input id="v-search" className="input" type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder={t('Code, reason or description')} autoComplete="off" data-testid="v-search" />
    </div>
  );
  const blockingChip = (
    <CountChip on={f.blockingOnly} onClick={() => set({ blockingOnly: !f.blockingOnly })} testid="v-blocking-only" count={num(summary.blocked.count)}>
      <span className="v-sym v-sym--blocking" aria-hidden="true">◆</span> {t('Blocking only')}
    </CountChip>
  );
  const flagChips = flags.filter(({ flag }) => !mobile || f.flags.includes(flag)).map(({ flag, count, blocking }) => {
    const on = f.flags.includes(flag);
    return (
      <button
        key={flag} type="button" aria-pressed={on} data-testid={`v-chip-${flag}`}
        className={`chip ${blocking ? 'v-chip--blocking' : 'v-chip--warning'}${on ? ' chip--on' : ''}`}
        onClick={() => set({ flags: on ? f.flags.filter((x) => x !== flag) : [...f.flags, flag] })}
      >
        <span className={`v-sym ${blocking ? 'v-sym--blocking' : 'v-sym--warning'}`} aria-hidden="true">{blocking ? '◆' : '▲'}</span> {flagLabel(flag)} <b>{num(count)}</b>
      </button>
    );
  });

  // desktop: Fix is the one visible button; Fix, Keep as entered and Void are in the row's menu
  const rowMenu = (r: ValidationRecord) => (
    <div className="v-actions-in v-actions-line">
      <button type="button" className="btn-primary btn-sm" onClick={() => openFor(r.event.event_id, 'edit')} data-testid="v-fix-btn" aria-label={t('Fix {what}', { what: where(r.event) })}>
        <Icon name="edit" size={14} /> {t('Fix')}
      </button>
      <RowMenu label={t('More actions for {what}', { what: where(r.event) })} testid="v-more">
        {(close) => (
          <>
            <MenuItem onClick={() => { close(); openFor(r.event.event_id, 'edit'); }} testid="v-menu-fix">{t('Fix')}</MenuItem>
            {r.problems.length > 0 && (
              <MenuItem onClick={() => { close(); if (online) keepFor([r.event.event_id]); else editBlocked(); }} sub={t('Nothing changes; it stops being listed')} testid="v-keep-btn">{t('Keep as entered')}</MenuItem>
            )}
            <MenuItem onClick={() => { close(); openFor(r.event.event_id, 'void'); }} sub={t('Left out of every number, with a note')} testid="v-void-btn">{t('Void')}</MenuItem>
          </>
        )}
      </RowMenu>
    </div>
  );
  const rowActions = (r: ValidationRecord, cls = '') => (
    <div className={cls}>
      <button type="button" className="btn-primary" onClick={() => openFor(r.event.event_id, 'edit')} data-testid="v-fix-btn" aria-label={t('Fix {what}', { what: where(r.event) })}>
        <Icon name="edit" size={15} /> {t('Fix')}
      </button>
      <button type="button" className="btn-danger" onClick={() => openFor(r.event.event_id, 'void')} data-testid="v-void-btn" aria-label={t('Void {what}', { what: where(r.event) })}>
        <Icon name="ban" size={15} /> {t('Void')}
      </button>
      {r.problems.length > 0 && (
        <button type="button" className="btn" onClick={() => (online ? keepFor([r.event.event_id]) : editBlocked())} data-testid="v-keep-btn" aria-label={t('Keep {what} as entered', { what: where(r.event) })}>
          <Icon name="check" size={15} /> {t('Keep as entered')}
        </button>
      )}
    </div>
  );

  return (
    <div className="page" data-testid="page-validate">
      <PageHeader
        title={pageLabel(pageById('validate'))}
        subtitle={subtitle}
        right={
          <>
            <button type="button" className="btn btn-sm" onClick={() => v.reload()} disabled={v.data.state.refreshing || v.data.state.loading} data-testid="v-refresh">
              <Icon name="sync" size={14} /> {v.data.state.refreshing ? t('Refreshing…') : t('Refresh')}
            </button>
            {editor && (
              <button type="button" className="btn btn-sm" onClick={recheckAll} disabled={checking || !ready} data-testid="v-recheck">
                <Icon name="compliance" size={14} /> {checking ? t('Checking…') : t('Re-check all records')}
              </button>
            )}
          </>
        }
      />
      {st.error || (st.loading && !st.data)
        ? <DataStatus state={st} onRetry={st.reload} what={t('master data')} />
        : <DataStatus state={v.data.state} onRetry={v.data.reload} what={t('events')} />}

      {ready && v.hiddenInactive > 0 && (
        <p className="v-inactive-note muted" role="note" data-testid="v-inactive-hidden">
          <Icon name="info" size={14} /> {tn(v.hiddenInactive, '{n} record of inactive areas hidden', '{n} records of inactive areas hidden')}
          {' '}({inactiveAreas(startup).map((a) => a.area_id).join(', ')}). {t('They come back when an Admin switches the area on again.')}
        </p>
      )}
      <details className="v-help" data-testid="v-hint">
        <summary>{t('What do ◆ and ▲ mean?')}</summary>
        <p>{hintText}</p>
      </details>
      {checkMsg && (
        <div className={checkMsg.ok ? 'callout callout--success' : 'callout callout--danger'} role={checkMsg.ok ? 'status' : 'alert'} data-testid="v-recheck-result">
          <Icon name={checkMsg.ok ? 'check' : 'alert'} size={16} />
          <span>{checkMsg.text}</span>
        </div>
      )}
      {fixed && (
        <div className="callout callout--success v-fixed" role="status" data-testid="v-fixed" key={fixed.n}>
          <Icon name="check" size={16} />
          <span>{fixed.text}</span>
          <button type="button" className="btn btn-sm" onClick={() => setFixed(null)} aria-label={t('Hide this note')}><Icon name="close" size={14} /></button>
        </div>
      )}

      {dataReady && (!mobile ? (
        <div className="tiles" data-testid="v-tiles">
          <Tile icon="alert" label={`◆ ${t('Left out of the numbers')}`} value={<span data-testid="v-count-blocked">{num(summary.blocked.count)}</span>}
            sub={t('{h} h not counted until fixed', { h: hours(summary.blocked.hours * 3600) })} tone={summary.blocked.count ? T.danger : undefined} testid="tile-blocked" compact />
          <Tile icon="info" label={`▲ ${t('To review')}`} value={<span data-testid="v-count-review">{num(summary.review.count)}</span>}
            sub={t('counted as they are')} tone={summary.review.count ? T.warning : undefined} testid="tile-review" compact />
          <Tile icon="clock" label={`ℹ ${t('Overlapping (information)')}`} value={<span data-testid="v-count-overlap">{num(summary.overlapping)}</span>}
            sub={t('shared time counted once; nothing to fix')} testid="tile-overlap" compact />
          <Tile icon="check" label={`✓ ${t('Kept as entered')}`} value={<span data-testid="v-count-kept">{num(summary.kept.count)}</span>}
            sub={<><span data-testid="v-kept-hours">{hours(summary.kept.leftOut.hours * 3600)}</span> {t('h kept as entered, left out of the numbers')}</>} testid="tile-kept" compact />
        </div>
      ) : (
        <div className="phone-summary" data-testid="v-phone-summary">
          <span><span className="v-sym v-sym--blocking" aria-hidden="true">◆</span> <b data-testid="v-count-blocked">{num(summary.blocked.count)}</b> {t('left out')} ({hours(summary.blocked.hours * 3600)} h)</span>
          <span><span className="v-sym v-sym--warning" aria-hidden="true">▲</span> <b data-testid="v-count-review">{num(summary.review.count)}</b> {t('to review')}</span>
          <span><span aria-hidden="true">ℹ</span> <b data-testid="v-count-overlap">{num(summary.overlapping)}</b> {t('overlapping (counted once)')}</span>
          <span><span aria-hidden="true">✓</span> <b data-testid="v-count-kept">{num(summary.kept.count)}</b> {t('kept as entered')} (<span data-testid="v-kept-hours">{hours(summary.kept.leftOut.hours * 3600)}</span> h {t('left out')})</span>
        </div>
      ))}

      {dataReady && <QualityTable onPickMonth={(m) => { setF({ ...EMPTY_FILTER, month: m }); setView('open'); }} />}

      {dataReady && (summary.total > 0 || summary.kept.count > 0 || summary.overlapping > 0) && (
        <div className="v-seg" role="group" aria-label={t('Which records')} data-testid="v-view">
          <button type="button" className="v-seg-btn" aria-pressed={view === 'open'} onClick={() => setView('open')} data-testid="v-view-open">
            {t('Open')} <b>{num(summary.total)}</b>
          </button>
          <button type="button" className="v-seg-btn" aria-pressed={view === 'kept'} onClick={() => setView('kept')} data-testid="v-view-kept">
            {t('Kept as entered')} <b>{num(summary.kept.count)}</b>
          </button>
          {summary.overlapping > 0 && (
            <button type="button" className="v-seg-btn" aria-pressed={view === 'overlaps'} onClick={() => setView('overlaps')} data-testid="v-view-overlaps">
              {t('Overlaps (information)')} <b>{num(summary.overlapping)}</b>
            </button>
          )}
        </div>
      )}

      {dataReady && (view === 'open' ? summary.total > 0 : view === 'kept' ? summary.kept.count > 0 : summary.overlapping > 0) && (!mobile ? (
        <section className="card" aria-label={t('Filters')} data-testid="v-filters">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {searchBox}
            {areaSelect('d')}
            {monthSelect('d')}
            <button type="button" className="btn" onClick={reset} disabled={filtersOn === 0} data-testid="v-reset" style={{ minHeight: 40 }}>{t('Reset filters')}</button>
          </div>
          {view === 'open' && (
            <div className="v-chip-row">
              <ChipRow label={t('Problems')}>
                {blockingChip}
                {flagChips}
              </ChipRow>
            </div>
          )}
        </section>
      ) : (
        <>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="v-search" className="field-label">{t('Search')}</label>
            <input id="v-search" className="input" type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder={t('Code, reason or description')} autoComplete="off" data-testid="v-search" />
          </div>
          <ChipRow label={t('Problems')}>
            {view === 'open' && blockingChip}
            {view === 'open' && flagChips}
            <FiltersPill count={sheetCount} onClick={() => setSheet(true)} testid="v-filters-pill" />
            {filtersOn > 0 && <button type="button" className="chip" onClick={reset} data-testid="v-reset">{t('Reset')}</button>}
          </ChipRow>
          {sheet && (
            <BottomSheet
              title={t('Filters')} onClose={() => setSheet(false)} testid="v-filters-sheet"
              footer={
                <>
                  <button type="button" className="btn" onClick={reset}>{t('Reset')}</button>
                  <button type="button" className="btn-primary" onClick={() => setSheet(false)} data-testid="v-sheet-apply">{t('Show {n} records', { n: num(view === 'open' ? filtered.length : filteredKept.length) })}</button>
                </>
              }
            >
              {areaSelect('s')}
              {monthSelect('s')}
              {view === 'open' && <div className="field">
                <span className="field-label">{t('Problems')}</span>
                <div className="chip-row" role="group" aria-label={t('Problems')}>
                  {flags.map(({ flag, count, blocking }) => {
                    const on = f.flags.includes(flag);
                    return (
                      <button
                        key={flag} type="button" aria-pressed={on} data-testid={`v-sheet-chip-${flag}`}
                        className={`chip ${blocking ? 'v-chip--blocking' : 'v-chip--warning'}${on ? ' chip--on' : ''}`}
                        onClick={() => set({ flags: on ? f.flags.filter((x) => x !== flag) : [...f.flags, flag] })}
                      >
                        <span className={`v-sym ${blocking ? 'v-sym--blocking' : 'v-sym--warning'}`} aria-hidden="true">{blocking ? '◆' : '▲'}</span> {flagLabel(flag)} <b>{num(count)}</b>
                      </button>
                    );
                  })}
                </div>
              </div>}
            </BottomSheet>
          )}
        </>
      ))}

      {dataReady && view === 'open' && summary.total === 0 && (
        <div className="callout callout--success" role="status" data-testid="v-empty">
          <Icon name="check" size={16} />
          <span>{t('Nothing needs checking. Every record passes the data checks.')}</span>
        </div>
      )}

      {dataReady && view === 'kept' && summary.kept.count > 0 && (
        <div style={{ marginTop: 12 }} data-testid="v-kept-list">
          <p className="v-hint" data-testid="v-kept-hint">
            {t('Checked and kept exactly as entered. Nothing in these records was changed.')}
          </p>
          {filteredKept.length === 0 ? (
            <div className="callout" role="status" data-testid="v-no-results">
              <Icon name="info" size={16} />
              <span>{t('No records match these filters.')}</span>
              <button type="button" className="btn btn-sm" onClick={reset}>{t('Reset filters')}</button>
            </div>
          ) : !mobile ? (
            <StickyTableWrap className="v-table" testid="v-kept-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('Stopped at')}</th>
                    <th scope="col">{t('Area')}</th>
                    <th scope="col">{t('Code')}</th>
                    <th scope="col">{t('Class')}</th>
                    <th scope="col" className="num">{t('Duration')}</th>
                    <th scope="col">{t('Kept as entered')}</th>
                    {editor && <th scope="col">{t('Actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleKept.map((k) => {
                    const e = k.event;
                    return (
                      <tr key={e.event_id} data-testid="v-kept-row" data-event-id={e.event_id} data-left-out={k.leftOut ? 'yes' : 'no'}>
                        <td className="nowrap">
                          <button type="button" className="row-link" onClick={() => openFor(e.event_id, 'view')} aria-label={t('Open record {id}', { id: e.event_id })}>{shortTs(e.stop_ts)}</button>
                        </td>
                        <td className="nowrap">{e.area_id}<div className="muted" style={{ fontSize: 12 }}>{areaName.get(e.area_id)}</div></td>
                        <td className="mono nowrap">{e.code_raw || '-'}</td>
                        <td>{e.classification ? <span className="badge badge--class">{e.classification}</span> : <span className="muted">{t('(none)')}</span>}</td>
                        <td className="num">{duration(e.duration_s)}</td>
                        <td><KeptInfo k={k} userName={userName} note={keptNote(e)} /></td>
                        {editor && (
                          <td className="v-actions">
                            <div className="v-actions-in">
                              <button type="button" className="btn" onClick={() => (online ? undoFor(k) : editBlocked())} data-testid="v-undo-btn" aria-label={t('Undo keep as entered for {what}', { what: where(e) })}>
                                <Icon name="history" size={15} /> {t('Undo')}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </StickyTableWrap>
          ) : (
            <div className="event-cards" data-testid="v-kept-cards">
              {visibleKept.map((k) => {
                const e = k.event;
                return (
                  <div key={e.event_id} className="v-card v-card--kept" data-testid="v-kept-card" data-event-id={e.event_id} data-left-out={k.leftOut ? 'yes' : 'no'}>
                    <button type="button" className="v-card-main" onClick={() => openFor(e.event_id, 'view')} aria-label={t('Open record {id}', { id: e.event_id })}>
                      <span className="v-card-top">
                        <span className="v-card-code">{where(e)}</span>
                        {e.classification ? <span className="badge badge--class">{e.classification}</span> : <span className="muted">{t('(none)')}</span>}
                      </span>
                      <span className="event-card-line mono" style={{ display: 'block' }}>{shortTs(e.stop_ts)} · {duration(e.duration_s)}</span>
                    </button>
                    <div style={{ marginTop: 6 }}><KeptInfo k={k} userName={userName} note={keptNote(e)} /></div>
                    {editor && (
                      <div className="v-card-actions">
                        <button type="button" className="btn" onClick={() => (online ? undoFor(k) : editBlocked())} data-testid="v-undo-btn" aria-label={t('Undo keep as entered for {what}', { what: where(e) })}>
                          <Icon name="history" size={15} /> {t('Undo')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <ShowMore shown={visibleKept.length} total={filteredKept.length} onMore={() => setShown((n) => n + PAGE_SIZE)} />
          {filteredKept.length > 0 && (
            <p className="status-line" style={{ marginTop: 8 }} data-testid="v-list-count">
              {t('Showing {a} of {b} matching records.', { a: num(visibleKept.length), b: num(filteredKept.length) })}
            </p>
          )}
        </div>
      )}

      {dataReady && view === 'overlaps' && summary.overlapping > 0 && (
        <p className="v-hint" data-testid="v-overlap-hint">
          {t('Information only: these records overlap another record of the same area. The shared time is counted once: planned (PL) before incidental before CIR; between records of the same kind, the one that started first. Nothing needs fixing unless a time was entered wrongly.')}
        </p>
      )}

      {dataReady && ((view === 'open' && summary.total > 0) || (view === 'overlaps' && summary.overlapping > 0)) && (
        <div style={{ marginTop: 12 }}>
          {tickable && filtered.length > 0 && (
            <div className="v-toolbar" data-testid="v-toolbar">
              <button type="button" className="btn" onClick={selectAllMatching} data-testid="v-select-all">
                {filtered.length > BULK_CAP
                  ? t('Select the first {cap} of {n} matching', { cap: BULK_CAP, n: num(filtered.length) })
                  : t('Select all {n} matching', { n: num(filtered.length) })}
              </button>
              {selIds.length > 0 && <button type="button" className="btn" onClick={() => setSel(new Set())} data-testid="v-clear">{t('Clear selection')}</button>}
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="callout" role="status" data-testid="v-no-results">
              <Icon name="info" size={16} />
              <span>{t('No records match these filters.')}</span>
              <button type="button" className="btn btn-sm" onClick={reset}>{t('Reset filters')}</button>
            </div>
          ) : !mobile ? (
            <StickyTableWrap className="v-table" testid="v-table">
              <table className="data-table">
                <thead>
                  <tr>
                    {tickable && (
                      <th scope="col">
                        <label className="v-check"><input type="checkbox" checked={allVisibleTicked} onChange={toggleVisible} aria-label={t('Tick every row shown')} data-testid="v-tick-visible" /></label>
                      </th>
                    )}
                    <th scope="col">{t('Started')}</th>
                    <th scope="col">{t('Area')}</th>
                    <th scope="col">{t('Code')}</th>
                    <th scope="col">{t('Class')}</th>
                    <th scope="col" className="num">{t('Hours')}</th>
                    <th scope="col">{t('Reason')}</th>
                    <th scope="col">{t('Problems')}</th>
                    <th scope="col">{t('What to do')}</th>
                    {editor && <th scope="col"><span className="sr-only">{t('Actions')}</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const e = r.event;
                    return (
                      <tr key={e.event_id} data-testid="v-row" data-event-id={e.event_id} data-blocking={r.blocking ? 'yes' : 'no'}>
                        {tickable && (
                          <td>
                            <label className="v-check">
                              <input type="checkbox" checked={sel.has(e.event_id)} onChange={() => toggle(e.event_id)} aria-label={t('Tick {what}', { what: where(e) })} data-testid="v-tick" />
                            </label>
                          </td>
                        )}
                        <td className="nowrap">
                          <button type="button" className="row-link v-when" onClick={() => openFor(e.event_id, 'view')} aria-label={t('Open record {id}', { id: e.event_id })}>{shortTs(e.stop_ts)}</button>
                        </td>
                        <td className="nowrap" title={areaName.get(e.area_id)}>{e.area_id}</td>
                        <td className="mono nowrap">{e.code_raw || '-'}</td>
                        <td className="nowrap">{e.classification ? <span className="badge badge--class">{e.classification}</span> : <span className="muted">{t('(none)')}</span>}</td>
                        <td className="num" title={duration(e.duration_s)}>{(e.duration_s / 3600).toFixed(1)} h</td>
                        <td className="v-clip-cell"><div className="v-clip" title={e.reason_raw || undefined}>{e.reason_raw || <span className="muted">{t('(blank)')}</span>}</div></td>
                        <td><ProblemsLine r={r} /></td>
                        <td className="v-clip-cell v-clip-cell--hint">{firstFixHint(r) ? <div className="v-clip v-fix" title={t(firstFixHint(r)!)} data-testid="v-fix">{t(firstFixHint(r)!)}</div> : <span className="muted">–</span>}</td>
                        {editor && <td className="v-actions">{rowMenu(r)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </StickyTableWrap>
          ) : (
            <div className="event-cards" data-testid="v-cards">
              {visible.map((r) => {
                const e = r.event;
                return (
                  <div key={e.event_id} className={`v-card ${r.blocking ? 'v-card--blocking' : 'v-card--warning'}`} data-testid="v-card" data-event-id={e.event_id} data-blocking={r.blocking ? 'yes' : 'no'}>
                    <div className="v-card-top">
                      {tickable && (
                        <label className="v-check">
                          <input type="checkbox" checked={sel.has(e.event_id)} onChange={() => toggle(e.event_id)} aria-label={t('Tick {what}', { what: where(e) })} data-testid="v-tick" />
                        </label>
                      )}
                      <button type="button" className="v-card-main" onClick={() => openFor(e.event_id, 'view')} aria-label={t('Open record {id}', { id: e.event_id })}>
                        <span className="v-card-top">
                          <span className="v-card-code">{where(e)}</span>
                          {e.classification ? <span className="badge badge--class">{e.classification}</span> : <span className="muted">{t('(none)')}</span>}
                        </span>
                        <span className="event-card-line mono" style={{ display: 'block' }}>{shortTs(e.stop_ts)} · {duration(e.duration_s)}</span>
                        <span className="event-card-line" style={{ display: 'block' }}>{e.reason_raw || t('(blank)')}</span>
                      </button>
                    </div>
                    <div style={{ marginTop: 6 }}><Problems r={r} /></div>
                    {editor && rowActions(r, 'v-card-actions')}
                  </div>
                );
              })}
            </div>
          )}
          <ShowMore shown={visible.length} total={filtered.length} onMore={() => setShown((n) => n + PAGE_SIZE)} />
          {filtered.length > 0 && (
            <p className="status-line" style={{ marginTop: 8 }} data-testid="v-list-count">
              {t('Showing {a} of {b} matching records.', { a: num(visible.length), b: num(filtered.length) })}
            </p>
          )}
        </div>
      )}

      {editor && view === 'open' && selIds.length > 0 && (
        <div className="v-bulkbar" role="region" aria-label={t('Selected records')} data-testid="v-bulkbar">
          <b data-testid="v-selected">{tn(selIds.length, '{n} record ticked', '{n} records ticked')}</b>
          <button type="button" className="btn" onClick={() => setSel(new Set())}>{t('Clear')}</button>
          <button type="button" className="btn" onClick={() => (online ? keepFor(selIds.slice(0, BULK_CAP)) : editBlocked())} data-testid="v-keep-open">
            <Icon name="check" size={15} /> {t('Keep as entered')}
          </button>
          <button type="button" className="btn-primary" onClick={() => (online ? setBulkIds(selIds) : editBlocked())} data-testid="v-bulk-open">
            <Icon name="edit" size={15} /> {t('Set for {n} records', { n: num(Math.min(selIds.length, BULK_CAP)) })}
          </button>
        </div>
      )}

      {open && openEvent && (
        <EventDetail
          key={openEvent.event_id}
          row={openEvent}
          startup={startup}
          canEdit={editor}
          onClose={() => setOpen(null)}
          onChanged={v.replaceEvent}
          assist={{
            overlaps,
            onOpenOther: (id) => setOpen({ id, mode: 'view' }),
            suggestion: openRecord?.problems.some((p) => p === 'missing_classification' || p === 'invalid_classification')
              ? v.suggest(openEvent.area_id, openEvent.code_raw)
              : null,
            defaultNote: t(BULK_NOTE),
            initialMode: open.mode,
            afterKeep: (updated) => {
              if (v.recheck(updated) !== null) return false;
              setSel((cur) => {
                const next = new Set(cur);
                next.delete(updated.event_id);
                return next;
              });
              setFixed({ n: Date.now(), text: t('Kept as entered: {what}. It is no longer listed under Open.', { what: where(updated) }) });
              return true;
            },
            autoClose: (updated) => {
              if (v.recheck(updated) !== null) return false;
              setSel((cur) => {
                const next = new Set(cur);
                next.delete(updated.event_id);
                return next;
              });
              setFixed({
                n: Date.now(),
                text: updated.is_void
                  ? t('Voided: {what}. It is no longer counted.', { what: where(updated) })
                  : t('Fixed: {what} no longer needs checking.', { what: where(updated) }),
              });
              return true;
            },
          }}
        />
      )}

      {keep && (
        <KeepModal
          mode={keep.mode}
          targets={keep.targets}
          onClose={() => setKeep(null)}
          onSaved={v.replaceEvent}
          onFinished={onKeepFinished}
        />
      )}

      {bulkIds && (
        <BulkModal
          ids={bulkIds}
          byId={byId}
          startup={startup}
          onClose={() => setBulkIds(null)}
          onSaved={v.replaceEvent}
          onFinished={onBulkFinished}
        />
      )}
    </div>
  );
}
