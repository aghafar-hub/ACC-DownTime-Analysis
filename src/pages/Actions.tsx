// Actions (docs/actions-design.md, docs/actions-mockups/desktop-actions-board.png and mobile-actions.png): the open work that
// came out of the downtime data. Desktop: summary cards, one filter row, the board (a column per status; drag a card to
// change its status) or a sortable list. Phone: status tabs, filter chips, cards and a New button. The filters, the view
// and the open action live in the address, so Back and a shared link bring the same view back. Offline the copy saved on
// the device is shown and changes are switched off with the reason.
// Backend 1.7.0 (docs/actions-mockups/tasks/01, 07, 08): page tabs Actions · Tasks · Shutdown list (/actions, /actions/tasks,
// /actions/shutdown). The board columns are Draft, Open, In progress and Closed (Cancelled when asked for); a card shows its task
// progress, the next task and who still has open tasks. Open and In progress follow the tasks, so a card with tasks cannot be
// dragged between them: only accepting a draft (Draft -> Open), closing and cancelling stay manual.
import { useCallback, useMemo, useState, type DragEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useLiveSearchParams } from '../hooks/useLiveSearchParams';
import { ACTION_PRIORITIES, ACTION_STATUSES, actionProgress, isTerminalStatus, type Action, type ActionSource, type ActionStatus } from '../api/types';
import ActionDetail from '../actions/ActionDetail';
import { useActions } from '../actions/ActionsContext';
import {
  actionsCsvRows, activeFilterCount, BOARD_STATUSES, contractorName, countByStatus, filterActions, filterActionsExceptStatus, groupByStatus,
  dropRule, isOverdue, parseActionFilters, personName, SORT_KEYS, SORT_LABEL, sortActions, SOURCE_LABEL, statusKey, summarize, taskTally, todayLocal, writeActionFilters,
  type ActionFilters, type SortKey,
} from '../actions/model';
import { ActionCard, DueTag, InactiveAreaTag, PriorityTag, StatusChip, StatusDot, TaskProgress, scopeText, type CardEnv } from '../actions/parts';
import ActionsTabs, { useActionOpener } from '../actions/ActionsTabs';
import ShutdownView from '../actions/ShutdownView';
import TasksView from '../actions/TasksView';
import { taskSummary } from '../actions/tasks';
import { inactiveAreaIds } from '../data/activeAreas';
import StatusDialog from '../actions/StatusDialog';
import SummaryCards from '../actions/SummaryCards';
import AccessBadge from '../components/AccessBadge';
import { BottomSheet } from '../components/PhoneParts';
import { PageHeader } from '../components/Tile';
import { useStartup } from '../data/useStartup';
import { toCsv, CSV_MIME } from '../export/csv';
import { deliverFile } from '../export/deliverFile';
import { exportFileName } from '../export/files';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { whenText } from '../util/dates';
import '../components/ui.css';
import '../dashboard/cards/dashcards.css';
import '../actions/actions.css';

const COLUMN_CAP = 6;

function FilterSelect({ label, value, options, onChange, testid }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; testid: string;
}) {
  const on = value !== '';
  return (
    <label className={on ? 'af-pill af-pill--on' : 'af-pill'}>
      <span className="af-pill-label">{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} data-testid={testid}>
        <option value="">{t('All')}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chevronDown" size={14} />
    </label>
  );
}

/** The Actions page: its tab (the board, every task, the Shutdown list) follows the address. */
export default function Actions() {
  const location = useLocation();
  if (location.pathname.startsWith('/actions/tasks')) return <TasksView />;
  if (location.pathname.startsWith('/actions/shutdown')) return <ShutdownView />;
  return <Board />;
}

function Board() {
  const acts = useActions();
  const { user } = useAuth();
  const { startup } = useStartup();
  const mobile = useIsMobile();
  const [sp, setSp] = useLiveSearchParams();
  const today = todayLocal();
  const f = useMemo(() => parseActionFilters(sp), [sp]);
  const view: 'board' | 'list' = sp.get('view') === 'list' ? 'list' : 'board';
  const sort: SortKey = (SORT_KEYS as string[]).includes(sp.get('sort') ?? '') ? (sp.get('sort') as SortKey) : 'next';
  const { openId, taskId, open, close } = useActionOpener();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState(false);
  const [drop, setDrop] = useState<{ action: Action; to: ActionStatus } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const payload = acts.payload;
  const all = useMemo(() => payload?.actions ?? [], [payload]);
  const people = useMemo(() => payload?.people ?? [], [payload]);
  const contractors = useMemo(() => payload?.contractors ?? [], [payload]);
  const tasks = useMemo(() => payload?.tasks ?? [], [payload]);
  const env = useMemo(() => ({ today, me: user?.user_id ?? '', people, contractors, tasks }), [today, user, people, contractors, tasks]);
  const effectDays = Number(startup?.settings.find((s) => s.key === 'actions_effect_days')?.value) || 60;
  const inactive = useMemo(() => new Set(inactiveAreaIds(startup)), [startup]);
  const cardEnv: CardEnv = { today, people, contractors, effectDays, inactiveAreas: inactive, tasks };

  const setFilters = useCallback((patch: Partial<ActionFilters>) => {
    setSp((cur) => writeActionFilters(cur, { ...parseActionFilters(cur), ...patch }), { replace: true });
  }, [setSp]);
  const setParam = useCallback((k: string, v: string | null) => {
    setSp((cur) => {
      const n = new URLSearchParams(cur);
      if (v === null) n.delete(k); else n.set(k, v);
      return n;
    }, { replace: true });
  }, [setSp]);

  const base = useMemo(() => filterActionsExceptStatus(all, f, env), [all, f, env]);
  const shown = useMemo(() => sortActions(filterActions(all, f, env), sort, tasks), [all, f, env, sort, tasks]);
  const groups = useMemo(() => groupByStatus(sortActions(base, sort, tasks)), [base, sort, tasks]);
  const counts = useMemo(() => countByStatus(base), [base]);
  const cancelledHidden = f.status === 'active' && !f.cancelled ? counts.Cancelled : 0;
  const sum = useMemo(() => summarize(all, today), [all, today]);
  const tsum = useMemo(() => taskSummary(all, tasks, today), [all, tasks, today]);
  const nf = activeFilterCount(f);

  const areas = useMemo(() => (startup?.areas ?? []).slice().sort((a, b) => a.sort_order - b.sort_order), [startup]);
  const lines = useMemo(() => (startup?.lines ?? []).slice().sort((a, b) => a.sort_order - b.sort_order), [startup]);
  const assignees = useMemo(() => [...new Set(all.map((a) => a.assignee).filter(Boolean))].map((id) => ({ value: id, label: personName(people, id) })).sort((a, b) => a.label.localeCompare(b.label)), [all, people]);
  const single = (l: string[]): string => (l.length === 1 ? l[0]! : '');
  const list = (v: string): string[] => (v ? [v] : []);

  const exportCsv = async () => {
    const rows = actionsCsvRows(shown, { people, contractors, today });
    const r = await deliverFile(exportFileName({ base: 'actions', period: today }, 'csv'), toCsv(rows), CSV_MIME);
    setNote(r === 'failed' ? t('The file could not be made.') : r === 'downloaded' ? t('Downloaded {n} actions.', { n: shown.length }) : null);
  };

  const onDragStart = (e: DragEvent, a: Action) => {
    e.dataTransfer.setData('text/plain', a.action_id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = async (e: DragEvent, to: ActionStatus) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/plain');
    const a = all.find((x) => x.action_id === id);
    if (!a || a.status === to || !acts.canEdit) return;
    const rule = dropRule(a, to, taskTally(a.action_id, tasks), !!payload?.can_close);
    if (rule.kind === 'refuse') {
      setNote(rule.text);
      return;
    }
    if (rule.kind === 'dialog') {
      setDrop({ action: a, to: rule.to });
      return;
    }
    const r = await acts.update(a.action_id, { status: to });
    setNote(r.ok ? t('{id} moved to {s}.', { id: a.action_id, s: t(r.value.action.status) }) : r.error);
  };

  // ---------------------------------------------------------------- states before there is a list
  const tabsRow = <ActionsTabs />;
  const header = (
    <PageHeader
      title={t('Actions')}
      subtitle={payload ? (
        <span data-testid="actions-subtitle">
          <b>{t('{n} open', { n: sum.open })}</b> · <b className={tsum.overdue ? 'as-od' : undefined}>{tsum.overdue === 1 ? t('1 task overdue') : t('{n} tasks overdue', { n: tsum.overdue })}</b>
          {' · '}<b className={tsum.ready ? 'as-ok' : undefined}>{t('{n} ready to close', { n: tsum.ready })}</b> · <b>{t('{n} drafts', { n: sum.drafts })}</b> {t('to review')}
          {sum.notEffective > 0 && ` · ${t('{n} not effective in the last 90 days', { n: sum.notEffective })}`}
        </span>
      ) : t('Work that came out of the downtime data, followed until it is closed and checked.')}
      right={(
        <>
          <AccessBadge edit={acts.canEdit} />
          {!mobile && payload && <button type="button" className="btn btn-sm" onClick={() => void exportCsv()} data-testid="actions-export"><Icon name="download" size={14} /> {t('Export CSV')}</button>}
          {!mobile && acts.canEdit && (
            <button type="button" className="btn-primary" onClick={() => acts.openCreate()} disabled={!!acts.blockedReason} title={acts.blockedReason ?? undefined} data-testid="new-action">
              <Icon name="plus" size={15} /> {t('New action')}
            </button>
          )}
        </>
      )}
    />
  );
  const status = (
    <>
      {acts.fromCache && payload && (
        <div className="callout callout--warning" role="status" data-testid="actions-cached">
          <Icon name="wifiOff" size={16} />
          <span>{t('Showing the copy saved on this device ({w}). Changes need a connection.', { w: whenText(acts.savedAt) })}</span>
        </div>
      )}
      {acts.error && payload && !acts.fromCache && <div className="callout callout--warning" role="status"><Icon name="alert" size={16} /><span>{acts.error}</span></div>}
      {note && <p className="act-note" role="status" data-testid="actions-note"><span>{note}</span><button type="button" className="act-note-x" onClick={() => setNote(null)} aria-label={t('Dismiss')}><Icon name="close" size={14} /></button></p>}
    </>
  );

  if (!payload) {
    return (
      <div className="page act-page" data-testid="page-actions">
        {tabsRow}
        {header}
        {acts.loading || (!acts.error && !acts.accessDenied) ? <p className="callout" role="status" data-testid="actions-loading">{t('Loading the actions…')}</p> : (
          <div className="callout callout--danger" role="alert" data-testid="actions-error">
            <Icon name={acts.blockedReason ? 'wifiOff' : 'alert'} size={16} />
            <span>{acts.blockedReason ? t('You are offline and no copy of the actions is saved on this device yet. Open this page once while online.') : acts.error}</span>
            <button type="button" className="btn btn-sm" onClick={acts.reload}>{t('Try again')}</button>
          </div>
        )}
        {openId && <ActionDetail id={openId} taskId={taskId} onClose={close} />}
      </div>
    );
  }

  // ---------------------------------------------------------------- filters
  const statusSelect = (
    <label className={f.status !== 'active' ? 'af-pill af-pill--on' : 'af-pill'}>
      <span className="af-pill-label">{t('Status')}:</span>
      <select value={f.status} onChange={(e) => setFilters({ status: e.target.value as ActionFilters['status'] })} aria-label={t('Status')} data-testid="filter-status">
        <option value="active">{t('Active ({n})', { n: base.filter((a) => a.status !== 'Cancelled').length })}</option>
        <option value="open">{t('Open only ({n})', { n: base.filter((a) => !isTerminalStatus(a.status)).length })}</option>
        <option value="all">{t('All, with cancelled ({n})', { n: base.length })}</option>
        {ACTION_STATUSES.map((s) => <option key={s} value={s}>{t(s)} ({counts[s]})</option>)}
      </select>
      <Icon name="chevronDown" size={14} />
    </label>
  );
  const selects = (
    <>
      <FilterSelect label={t('Area')} value={single(f.areas)} onChange={(v) => setFilters({ areas: list(v) })} testid="filter-area"
        options={[{ value: '-', label: t('Plant / line (no area)') }, ...areas.map((a) => ({ value: a.area_id, label: `${a.area_id} · ${a.name}` }))]} />
      <FilterSelect label={t('Line')} value={single(f.lines)} onChange={(v) => setFilters({ lines: list(v) })} testid="filter-line" options={lines.map((l) => ({ value: l.line_id, label: l.line_id }))} />
      <FilterSelect label={t('Contractor')} value={single(f.owners)} onChange={(v) => setFilters({ owners: list(v) })} testid="filter-owner"
        options={[{ value: '-', label: t('Nobody yet') }, ...contractors.map((c) => ({ value: c.contractor_id, label: c.name }))]} />
      <FilterSelect label={t('Task owner')} value={single(f.taskOwners)} onChange={(v) => setFilters({ taskOwners: list(v) })} testid="filter-task-owner"
        options={contractors.map((c) => ({ value: c.contractor_id, label: c.name }))} />
      <FilterSelect label={t('Owner')} value={single(f.assignees)} onChange={(v) => setFilters({ assignees: list(v) })} testid="filter-assignee"
        options={[{ value: '-', label: t('No owner') }, ...assignees]} />
      <FilterSelect label={t('Source')} value={single(f.sources)} onChange={(v) => setFilters({ sources: list(v) as ActionSource[] })} testid="filter-source"
        options={(Object.keys(SOURCE_LABEL) as ActionSource[]).map((s) => ({ value: s, label: t(SOURCE_LABEL[s]) }))} />
      <FilterSelect label={t('Priority')} value={single(f.priorities)} onChange={(v) => setFilters({ priorities: list(v) as ActionFilters['priorities'] })} testid="filter-priority"
        options={ACTION_PRIORITIES.map((p) => ({ value: p, label: t(p) }))} />
    </>
  );
  const toggles = (
    <>
      <label className="act-switch af-toggle">
        <input type="checkbox" checked={f.mine} onChange={(e) => setFilters({ mine: e.target.checked })} data-testid="filter-mine" />
        <span className="act-switch-ui" aria-hidden="true" /><span>{t('My actions')}</span>
      </label>
      <label className="act-switch af-toggle">
        <input type="checkbox" checked={f.taskOverdue} onChange={(e) => setFilters({ taskOverdue: e.target.checked, overdue: false })} data-testid="filter-task-overdue" />
        <span className="act-switch-ui" aria-hidden="true" /><span>{t('Has overdue tasks')}</span>
      </label>
      <label className="act-switch af-toggle">
        <input type="checkbox" checked={f.ready} onChange={(e) => setFilters({ ready: e.target.checked })} data-testid="filter-ready" />
        <span className="act-switch-ui" aria-hidden="true" /><span>{t('Ready to close')}</span>
      </label>
    </>
  );
  const sortSelect = (
    <label className="af-pill af-sort">
      <span className="af-pill-label">{t('Sort')}:</span>
      <select value={sort} onChange={(e) => setParam('sort', e.target.value === 'next' ? null : e.target.value)} aria-label={t('Sort by')} data-testid="actions-sort">
        {SORT_KEYS.map((k) => <option key={k} value={k}>{t(SORT_LABEL[k])}</option>)}
      </select>
      <Icon name="chevronDown" size={14} />
    </label>
  );
  const search = (
    <label className="af-search">
      <Icon name="search" size={15} />
      <input type="search" value={f.q} onChange={(e) => setFilters({ q: e.target.value })} placeholder={t('Search ID, equipment, problem…')} aria-label={t('Search actions')} data-testid="actions-search" />
    </label>
  );
  const reset = nf > 0 || f.q || f.status !== 'active'
    ? <button type="button" className="btn btn-sm" onClick={() => setSp((cur) => writeActionFilters(cur, { ...parseActionFilters(new URLSearchParams()) }), { replace: true })} data-testid="filters-reset">{t('Reset')}</button>
    : null;

  // ---------------------------------------------------------------- phone
  if (mobile) {
    const tab = f.status;
    const tabList = shown;
    const tabSum = { open: tabList.filter((a) => !isTerminalStatus(a.status)).length, overdue: tabList.filter((a) => isOverdue(a, today)).length, none: tabList.filter((a) => !a.assignee && !isTerminalStatus(a.status)).length };
    return (
      <div className="page act-page act-page--phone" data-testid="page-actions">
        {tabsRow}
        {status}
        <nav className="act-tabs" aria-label={t('Status')} data-testid="actions-tabs">
          <button type="button" className={tab === 'active' ? 'act-tab act-tab--on' : 'act-tab'} aria-pressed={tab === 'active'} onClick={() => setFilters({ status: 'active' })} data-testid="tab-active">
            {t('All')} <b>{base.filter((a) => a.status !== 'Cancelled').length}</b>
          </button>
          {ACTION_STATUSES.map((s) => (
            <button key={s} type="button" className={tab === s ? 'act-tab act-tab--on' : 'act-tab'} aria-pressed={tab === s} onClick={() => setFilters({ status: s })} data-testid={`tab-${statusKey(s)}`}>
              {t(s)} <b>{counts[s]}</b>
            </button>
          ))}
        </nav>
        <div className="act-phone-filters">
          {search}
          <div className="chip-row act-chiprow">
            <button type="button" className={nf ? 'chip chip--filters chip--on' : 'chip chip--filters'} onClick={() => setSheet(true)} aria-haspopup="dialog" data-testid="actions-filters">
              <Icon name="filter" size={14} /> {t('Filters')}{nf ? ` · ${nf}` : ''}
            </button>
            <button type="button" className={f.mine ? 'chip chip--on' : 'chip'} aria-pressed={f.mine} onClick={() => setFilters({ mine: !f.mine })} data-testid="chip-mine"><Icon name="users" size={14} /> {t('Mine')}</button>
            <button type="button" className={f.taskOverdue ? 'chip chip--on' : 'chip'} aria-pressed={f.taskOverdue} onClick={() => setFilters({ taskOverdue: !f.taskOverdue, overdue: false })} data-testid="chip-overdue"><Icon name="alert" size={14} /> {t('Overdue tasks')}</button>
            <button type="button" className={f.ready ? 'chip chip--on' : 'chip'} aria-pressed={f.ready} onClick={() => setFilters({ ready: !f.ready })} data-testid="chip-ready"><Icon name="check" size={14} /> {t('Ready to close')}</button>
          </div>
        </div>
        <div className="act-phone-sum">
          <span data-testid="actions-phone-summary">{t('{n} open', { n: tabSum.open })} · <b className={tsum.overdue ? 'as-od' : undefined}>{tsum.overdue === 1 ? t('1 task overdue') : t('{n} tasks overdue', { n: tsum.overdue })}</b> · {t('{n} no owner', { n: tabSum.none })}</span>
          {sortSelect}
        </div>
        <div className="act-phone-list" data-testid="actions-list">
          {tabList.length === 0 ? <p className="muted act-empty" data-testid="actions-empty">{t('No actions match these filters.')}</p> : tabList.map((a) => <ActionCard key={a.action_id} action={a} env={cardEnv} onOpen={open} compact />)}
        </div>
        {acts.canEdit && (
          <button type="button" className="act-fab" onClick={() => acts.openCreate()} disabled={!!acts.blockedReason} aria-label={t('New action')} data-testid="new-action">
            <Icon name="plus" size={20} /> {t('New')}
          </button>
        )}
        {sheet && (
          <BottomSheet title={t('Filters')} onClose={() => setSheet(false)} testid="actions-filter-sheet" withClose
            footer={<div className="st-foot">{reset}<button type="button" className="btn-primary" onClick={() => setSheet(false)} data-testid="filters-done">{t('Show {n} actions', { n: shown.length })}</button></div>}>
            <div className="af-sheet">{selects}{toggles}</div>
          </BottomSheet>
        )}
        {drop && <StatusDialog action={drop.action} canClose={!!payload.can_close} initial={drop.to} tally={taskTally(drop.action.action_id, tasks)} onClose={() => setDrop(null)} onDone={(text) => { setDrop(null); setNote(text); }} />}
        {openId && <ActionDetail id={openId} taskId={taskId} onClose={close} />}
      </div>
    );
  }

  // ---------------------------------------------------------------- desktop
  const columns: ActionStatus[] = [...BOARD_STATUSES, ...(f.cancelled || f.status === 'all' || f.status === 'Cancelled' ? (['Cancelled'] as ActionStatus[]) : [])]
    .filter((s) => (f.status === 'active' || f.status === 'all' ? true : f.status === 'open' ? !isTerminalStatus(s) : s === f.status));
  return (
    <div className="page act-page" data-testid="page-actions">
      {tabsRow}
      {header}
      {status}
      <SummaryCards actions={all} tasks={tasks} contractors={contractors} today={today}
        onArea={(area) => setFilters({ areas: [area] })} onStatus={(s) => setFilters({ status: s })}
        onReady={() => setFilters({ ready: true })} onNoOwner={() => setFilters({ assignees: ['-'] })} />

      <section className="card af-bar" aria-label={t('Filters')} data-testid="actions-filters">
        <div className="af-row">
          {search}
          {statusSelect}
          {selects}
        </div>
        <div className="af-row af-row--2">
          {toggles}
          {reset}
          <span className="af-spacer" />
          {sortSelect}
          <div className="dseg act-seg" role="group" aria-label={t('View')} data-testid="actions-view">
            <button type="button" className="dseg-btn" aria-pressed={view === 'board'} onClick={() => setParam('view', null)} data-testid="view-board"><Icon name="dashboard" size={14} /> {t('Board')}</button>
            <button type="button" className="dseg-btn" aria-pressed={view === 'list'} onClick={() => setParam('view', 'list')} data-testid="view-list"><Icon name="list" size={14} /> {t('List')}</button>
          </div>
        </div>
        <p className="af-info" data-testid="actions-count">
          <Icon name="info" size={14} />
          <span>
            {t('{n} actions in this view', { n: shown.length })}
            {cancelledHidden > 0 && <> · {t('Cancelled hidden ({n})', { n: cancelledHidden })} — <button type="button" className="af-link" onClick={() => setFilters({ cancelled: true })} data-testid="show-cancelled">{t('Show cancelled')}</button></>}
            {view === 'board' && ` · ${t('columns follow the tasks: a card moves to In progress when its first task starts')}`}
            {acts.canEdit && view === 'board' && ` · ${t('drag to accept a draft, close or cancel')}`}
          </span>
        </p>
      </section>

      {view === 'board' ? (
        <div className="ab-board" data-testid="actions-board">
          {columns.map((s) => {
            const items = groups[s];
            const big = expanded.has(s);
            const vis = big ? items : items.slice(0, COLUMN_CAP);
            return (
              <section
                key={s} className={`ab-col ab-col--${statusKey(s)}${dragOver === s ? ' ab-col--over' : ''}`} aria-labelledby={`ab-h-${statusKey(s)}`} data-testid={`column-${statusKey(s)}`}
                onDragOver={acts.canEdit ? (e) => { e.preventDefault(); setDragOver(s); } : undefined}
                onDragLeave={() => setDragOver((d) => (d === s ? null : d))}
                onDrop={acts.canEdit ? (e) => void onDrop(e, s) : undefined}
              >
                <header className="ab-col-head">
                  <StatusDot status={s} /><h2 id={`ab-h-${statusKey(s)}`}>{t(s)}</h2><b className="ab-count" data-testid="column-count">{items.length}</b>
                </header>
                {s === 'Draft' && items.length > 0 && <p className="ab-col-note"><Icon name="sync" size={13} />{t('{n} auto-created · review and accept', { n: items.filter((a) => a.source.startsWith('auto_')).length })}</p>}
                {s === 'Open' && <p className="ab-col-note">{t('No task started yet')}</p>}
                {s === 'In progress' && <p className="ab-col-note">{t('At least one task started')}</p>}
                {s === 'Closed' && <p className="ab-col-note">{t('Effectiveness is checked after closing')}</p>}
                <div className="ab-cards">
                  {vis.map((a) => <ActionCard key={a.action_id} action={a} env={cardEnv} onOpen={open} draggable={acts.canEdit && !acts.blockedReason} onDragStart={onDragStart} />)}
                  {items.length === 0 && <p className="ab-empty">{t('None')}</p>}
                </div>
                {items.length > COLUMN_CAP && (
                  <button type="button" className="ab-more" onClick={() => setExpanded((cur) => { const n = new Set(cur); if (n.has(s)) n.delete(s); else n.add(s); return n; })} data-testid="column-more">
                    {big ? t('Show fewer') : t('+ {n} more', { n: items.length - COLUMN_CAP })}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="card al-card">
          <div className="table-wrap">
            <table className="data-table al-table" data-testid="actions-table">
              <thead>
                <tr>
                  <th scope="col">{t('Action')}</th><th scope="col">{t('Problem')}</th><th scope="col">{t('Status')}</th><th scope="col">{t('Priority')}</th>
                  <th scope="col">{t('Tasks')}</th><th scope="col">{t('Area · line')}</th><th scope="col">{t('Contractor')}</th><th scope="col">{t('Owner')}</th><th scope="col">{t('Due')}</th><th scope="col">{t('Source')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.action_id} data-testid="action-row" data-id={a.action_id}>
                    <td className="nowrap"><button type="button" className="row-btn mono" onClick={() => open(a.action_id)} data-testid="action-open">{a.action_id}</button></td>
                    <td className="al-title">{a.equipment_id && <b className="mono">{a.equipment_id} </b>}{a.title}</td>
                    <td><StatusChip status={a.status} /></td>
                    <td><PriorityTag priority={a.priority} /></td>
                    <td className="nowrap">{actionProgress(a, tasks, today).total ? <TaskProgress actionId={a.action_id} tasks={tasks} today={today} /> : <span className="muted">{t('No tasks')}</span>}</td>
                    <td className="nowrap">{scopeText(a)}{a.area_id && inactive.has(a.area_id) && <> <InactiveAreaTag /></>}</td>
                    <td>{contractorName(contractors, a.owner) || <span className="muted">{t('Nobody yet')}</span>}</td>
                    <td>{personName(people, a.assignee) || <span className="muted">{t('No owner')}</span>}</td>
                    <td className="nowrap"><DueTag action={a} today={today} /></td>
                    <td className="nowrap">{t(SOURCE_LABEL[a.source])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="muted act-empty" data-testid="actions-empty">{t('No actions match these filters.')}</p>}
          </div>
        </div>
      )}
      {drop && <StatusDialog action={drop.action} canClose={!!payload.can_close} initial={drop.to} tally={taskTally(drop.action.action_id, tasks)} onClose={() => setDrop(null)} onDone={(text) => { setDrop(null); setNote(text); }} />}
      {openId && <ActionDetail id={openId} taskId={taskId} onClose={close} />}
    </div>
  );
}
