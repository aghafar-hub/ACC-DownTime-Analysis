import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { api, describeError } from '../api';
import type { EventRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { FLAG_INFO } from '../calc/flags';
import DataStatus from '../components/DataStatus';
import { BottomSheet, ChipRow, CountChip, FiltersPill, PAGE_SIZE, ShowMore } from '../components/PhoneParts';
import { SAVE_BLOCKED_EVENT } from '../components/SaveBlockedToast';
import { PageHeader, Tile } from '../components/Tile';
import { useIsMobile } from '../hooks/useIsMobile';
import { t, tn } from '../i18n/t';
import { Icon } from '../icons';
import { pageById, pageLabel } from '../navigation';
import { useTheme } from '../theme/ThemeContext';
import { useOnlineStatus } from '../useOnlineStatus';
import { duration, hours, num, shortTs } from '../util/format';
import BulkModal, { BULK_NOTE } from '../validate/BulkModal';
import {
  applyValidateFilter, areasOf, BULK_CAP, EMPTY_FILTER, filterCount, firstFixHint, flagCounts, monthsOf,
  type BulkResult, type ValidateFilter, type ValidationRecord,
} from '../validate/model';
import { useValidation } from '../validate/ValidationContext';
import { flagLabel } from './events/eventLabels';
import EventDetail from './events/EventDetail';
import '../components/ui.css';
import '../validate/validate.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (key: string): string => {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
};

type OpenState = { id: string; mode: 'view' | 'edit' | 'void' } | null;

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
      <div className="v-problems">{r.problems.map((f) => <ProblemBadge key={f} flag={f} />)}</div>
      {hint && <p className="v-fix" data-testid="v-fix">{t(hint)}</p>}
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
  const { list, rows, ready, st } = v;
  const startup = st.startup;
  const { summary } = list;

  const [f, setF] = useState<ValidateFilter>(EMPTY_FILTER);
  const [sheet, setSheet] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<OpenState>(null);
  const [bulkIds, setBulkIds] = useState<string[] | null>(null);
  const [fixed, setFixed] = useState<{ n: number; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const q = useDeferredValue(f.q);
  const set = (p: Partial<ValidateFilter>) => setF((cur) => ({ ...cur, ...p }));
  const reset = () => setF(EMPTY_FILTER);

  const filtered = useMemo(() => applyValidateFilter(list.records, { ...f, q }), [list.records, f, q]);
  useEffect(() => setShown(PAGE_SIZE), [f, q]);
  const visible = filtered.slice(0, shown);
  const flags = useMemo(() => flagCounts(list.records), [list.records]);
  const areas = useMemo(() => areasOf(list.records), [list.records]);
  const months = useMemo(() => monthsOf(list.records), [list.records]);
  const areaName = useMemo(() => new Map(startup?.areas.map((a) => [a.area_id, a.name]) ?? []), [startup]);
  const recordById = useMemo(() => new Map(list.records.map((r) => [r.event.event_id, r])), [list.records]);

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

  const openEvent = useMemo(() => (open ? rows.find((e) => e.event_id === open.id) ?? null : null), [open, rows]);
  const openRecord = open ? recordById.get(open.id) : undefined;
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
  const subtitle = !dataReady
    ? t('Loading…')
    : summary.total === 0
      ? t('Nothing needs checking.')
      : `${tn(summary.total, '{n} record needs checking', '{n} records need checking')}, ${t('{m} of them left out of the numbers ({h} h)', { m: num(summary.blocked.count), h: hours(summary.blocked.hours * 3600) })}`;

  const hintText = `${t('Records marked ◆ are left out of every chart and total until they are fixed. Records marked ▲ are counted as they are; check them when you can.')} ${
    editor
      ? t('Use Re-check after you add equipment codes, aliases or reasons in Master Data: it checks every record again.')
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

  const rowActions = (r: ValidationRecord, cls = '') => (
    <div className={cls}>
      <button type="button" className="btn-primary" onClick={() => openFor(r.event.event_id, 'edit')} data-testid="v-fix-btn" aria-label={t('Fix {what}', { what: where(r.event) })}>
        <Icon name="edit" size={15} /> {t('Fix')}
      </button>
      <button type="button" className="btn-danger" onClick={() => openFor(r.event.event_id, 'void')} data-testid="v-void-btn" aria-label={t('Void {what}', { what: where(r.event) })}>
        <Icon name="ban" size={15} /> {t('Void')}
      </button>
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

      {mobile ? (
        <details className="v-help" data-testid="v-hint">
          <summary>{t('What do ◆ and ▲ mean?')}</summary>
          <p>{hintText}</p>
        </details>
      ) : (
        <p className="v-hint" data-testid="v-hint">{hintText}</p>
      )}
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
            sub={t('{h} h not counted until fixed', { h: hours(summary.blocked.hours * 3600) })} tone={summary.blocked.count ? T.danger : undefined} testid="tile-blocked" />
          <Tile icon="info" label={`▲ ${t('To review')}`} value={<span data-testid="v-count-review">{num(summary.review.count)}</span>}
            sub={t('counted as they are')} tone={summary.review.count ? T.warning : undefined} testid="tile-review" />
          <Tile icon="clock" label={`▲ ${t('Overlapping')}`} value={<span data-testid="v-count-overlap">{num(summary.overlapping)}</span>}
            sub={t('hours may be counted twice')} tone={summary.overlapping ? T.warning : undefined} testid="tile-overlap" />
        </div>
      ) : (
        <div className="phone-summary" data-testid="v-phone-summary">
          <span><span className="v-sym v-sym--blocking" aria-hidden="true">◆</span> <b data-testid="v-count-blocked">{num(summary.blocked.count)}</b> {t('left out')} ({hours(summary.blocked.hours * 3600)} h)</span>
          <span><span className="v-sym v-sym--warning" aria-hidden="true">▲</span> <b data-testid="v-count-review">{num(summary.review.count)}</b> {t('to review')}</span>
          <span><span className="v-sym v-sym--warning" aria-hidden="true">▲</span> <b data-testid="v-count-overlap">{num(summary.overlapping)}</b> {t('overlapping')}</span>
        </div>
      ))}

      {dataReady && summary.total > 0 && (!mobile ? (
        <section className="card" aria-label={t('Filters')} data-testid="v-filters">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {searchBox}
            {areaSelect('d')}
            {monthSelect('d')}
            <button type="button" className="btn" onClick={reset} disabled={filtersOn === 0} data-testid="v-reset" style={{ minHeight: 40 }}>{t('Reset filters')}</button>
          </div>
          <div className="v-chip-row">
            <ChipRow label={t('Problems')}>
              {blockingChip}
              {flagChips}
            </ChipRow>
          </div>
        </section>
      ) : (
        <>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="v-search" className="field-label">{t('Search')}</label>
            <input id="v-search" className="input" type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder={t('Code, reason or description')} autoComplete="off" data-testid="v-search" />
          </div>
          <ChipRow label={t('Problems')}>
            {blockingChip}
            {flagChips}
            <FiltersPill count={sheetCount} onClick={() => setSheet(true)} testid="v-filters-pill" />
            {filtersOn > 0 && <button type="button" className="chip" onClick={reset} data-testid="v-reset">{t('Reset')}</button>}
          </ChipRow>
          {sheet && (
            <BottomSheet
              title={t('Filters')} onClose={() => setSheet(false)} testid="v-filters-sheet"
              footer={
                <>
                  <button type="button" className="btn" onClick={reset}>{t('Reset')}</button>
                  <button type="button" className="btn-primary" onClick={() => setSheet(false)} data-testid="v-sheet-apply">{t('Show {n} records', { n: num(filtered.length) })}</button>
                </>
              }
            >
              {areaSelect('s')}
              {monthSelect('s')}
              <div className="field">
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
              </div>
            </BottomSheet>
          )}
        </>
      ))}

      {dataReady && summary.total === 0 && (
        <div className="callout callout--success" role="status" data-testid="v-empty">
          <Icon name="check" size={16} />
          <span>{t('Nothing needs checking. Every record passes the data checks.')}</span>
        </div>
      )}

      {dataReady && summary.total > 0 && (
        <div style={{ marginTop: 12 }}>
          {editor && filtered.length > 0 && (
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
            <div className="table-wrap v-table" data-testid="v-table">
              <table className="data-table">
                <thead>
                  <tr>
                    {editor && (
                      <th scope="col">
                        <label className="v-check"><input type="checkbox" checked={allVisibleTicked} onChange={toggleVisible} aria-label={t('Tick every row shown')} data-testid="v-tick-visible" /></label>
                      </th>
                    )}
                    <th scope="col">{t('Stopped at')}</th>
                    <th scope="col">{t('Area')}</th>
                    <th scope="col">{t('Code')}</th>
                    <th scope="col">{t('Class')}</th>
                    <th scope="col" className="num">{t('Duration')}</th>
                    <th scope="col">{t('Reason')}</th>
                    <th scope="col">{t('Problems')}</th>
                    {editor && <th scope="col">{t('Actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const e = r.event;
                    return (
                      <tr key={e.event_id} data-testid="v-row" data-event-id={e.event_id} data-blocking={r.blocking ? 'yes' : 'no'}>
                        {editor && (
                          <td>
                            <label className="v-check">
                              <input type="checkbox" checked={sel.has(e.event_id)} onChange={() => toggle(e.event_id)} aria-label={t('Tick {what}', { what: where(e) })} data-testid="v-tick" />
                            </label>
                          </td>
                        )}
                        <td className="nowrap">
                          <button type="button" className="row-link" onClick={() => openFor(e.event_id, 'view')} aria-label={t('Open record {id}', { id: e.event_id })}>{shortTs(e.stop_ts)}</button>
                        </td>
                        <td className="nowrap">{e.area_id}<div className="muted" style={{ fontSize: 12 }}>{areaName.get(e.area_id)}</div></td>
                        <td className="mono nowrap">{e.code_raw || '-'}</td>
                        <td>{e.classification ? <span className="badge badge--class">{e.classification}</span> : <span className="muted">{t('(none)')}</span>}</td>
                        <td className="num">{duration(e.duration_s)}</td>
                        <td>{e.reason_raw || <span className="muted">{t('(blank)')}</span>}</td>
                        <td><Problems r={r} /></td>
                        {editor && <td className="v-actions">{rowActions(r, 'v-actions-in')}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="event-cards" data-testid="v-cards">
              {visible.map((r) => {
                const e = r.event;
                return (
                  <div key={e.event_id} className={`v-card ${r.blocking ? 'v-card--blocking' : 'v-card--warning'}`} data-testid="v-card" data-event-id={e.event_id} data-blocking={r.blocking ? 'yes' : 'no'}>
                    <div className="v-card-top">
                      {editor && (
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

      {editor && selIds.length > 0 && (
        <div className="v-bulkbar" role="region" aria-label={t('Selected records')} data-testid="v-bulkbar">
          <b data-testid="v-selected">{tn(selIds.length, '{n} record ticked', '{n} records ticked')}</b>
          <button type="button" className="btn" onClick={() => setSel(new Set())}>{t('Clear')}</button>
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
