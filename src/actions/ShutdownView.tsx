// Actions › Shutdown list (docs/actions-mockups/tasks/07-shutdown-work-list.png, 13-phone-shutdown-list.png): every open task
// that can only be done with the area stopped, grouped by area (its name, line and contractor) with the totals of each area
// (tasks, estimated stop hours, longest waiting), to check before a planned stop. Filters for area, line, contractor, owner and
// status, an Overdue switch, "Jump to area" chips, Print (one area or all, the browser's print dialog) and Excel. The app has
// no planned-stop dates, so there is no stop calendar.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isTaskOpen, TASK_STATUSES, type TaskStatus, type TaskView } from '../api/types';
import AccessBadge from '../components/AccessBadge';
import { BottomSheet } from '../components/PhoneParts';
import { PageHeader } from '../components/Tile';
import { useStartup } from '../data/useStartup';
import { deliverFile, deliveredText } from '../export/deliverFile';
import { exportFileName } from '../export/files';
import { tableToSheet } from '../export/table';
import { buildXlsx, XLSX_MIME } from '../export/xlsx';
import ChartInfo from '../help/ChartInfo';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { dayText } from '../util/dates';
import ActionDetail from './ActionDetail';
import { useActions } from './ActionsContext';
import ActionsTabs, { useActionOpener } from './ActionsTabs';
import { contractorName, personName, todayLocal } from './model';
import { OwnerChip, TaskDue, TaskStatusChip } from './parts';
import { buildTaskViews, titleWithoutCode, shutdownGroups, shutdownTable, shutdownTotals, waitingDays, type ShutdownGroup } from './tasks';
import '../components/ui.css';
import './actions.css';

const OPEN_TASK_STATUSES = TASK_STATUSES.filter((s) => isTaskOpen({ status: s }));
const KEYS = ['q', 'area', 'line', 'ctr', 'owner', 'sst', 'od'];

function Pick({ label, value, options, onChange, testid }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; testid: string }) {
  return (
    <label className={value ? 'af-pill af-pill--on' : 'af-pill'}>
      <span className="af-pill-label">{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} data-testid={testid}>
        <option value="">{t('All')}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chevronDown" size={14} />
    </label>
  );
}

/** Prints only the Shutdown list (one area, or every area shown) with the browser's print dialog. */
function printList(area: string | null) {
  const body = document.body;
  body.classList.add('sd-printing');
  if (area !== null) body.dataset.printArea = area || '-';
  const done = () => {
    body.classList.remove('sd-printing');
    delete body.dataset.printArea;
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  // some browsers do not fire afterprint: tidy up a moment later
  window.setTimeout(done, 1500);
}

export default function ShutdownView() {
  const acts = useActions();
  const { startup } = useStartup();
  const mobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const { openId, taskId, open, close } = useActionOpener();
  const today = todayLocal();
  const p = acts.payload;
  const people = useMemo(() => p?.people ?? [], [p]);
  const contractors = useMemo(() => p?.contractors ?? [], [p]);
  const areas = useMemo(() => (startup?.areas ?? []).slice().sort((a, b) => a.sort_order - b.sort_order), [startup]);
  const lines = useMemo(() => (startup?.lines ?? []).slice().sort((a, b) => a.sort_order - b.sort_order), [startup]);
  const [sheet, setSheet] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const f = {
    q: sp.get('q') ?? '', area: sp.get('area') ?? '', line: sp.get('line') ?? '', ctr: sp.get('ctr') ?? '', owner: sp.get('owner') ?? '',
    status: (OPEN_TASK_STATUSES as string[]).includes(sp.get('sst') ?? '') ? (sp.get('sst') as TaskStatus) : '', overdue: sp.get('od') === '1',
  };
  const set = (k: string, v: string) => setSp((cur) => {
    const n = new URLSearchParams(cur);
    if (v) n.set(k, v); else n.delete(k);
    return n;
  }, { replace: true });
  const nOn = [f.area, f.line, f.ctr, f.owner, f.status].filter(Boolean).length + (f.overdue ? 1 : 0);

  const allStop = useMemo(() => (p ? buildTaskViews(p.actions, p.tasks ?? [], p.logs, today).filter((v) => isTaskOpen(v) && v.needs_stop) : []), [p, today]);
  const allGroups = useMemo(() => shutdownGroups(allStop, areas, contractors, today), [allStop, areas, contractors, today]);
  const groups = useMemo(() => {
    const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const keep = (v: TaskView): boolean => {
      if (f.owner && (v.owner || '-') !== f.owner) return false;
      if (f.status && v.status !== f.status) return false;
      if (f.overdue && !v.overdue) return false;
      if (terms.length) {
        const text = [v.title, v.action_id, v.equipment_id, v.action_title, v.area_id, contractorName(contractors, v.owner), personName(people, v.assignee)].join(' ').toLowerCase();
        if (!terms.every((w) => text.includes(w))) return false;
      }
      return true;
    };
    const list = allStop.filter((v) => (!f.area || (v.area_id || '-') === f.area) && (!f.line || v.line_id === f.line) && keep(v));
    return shutdownGroups(list, areas, contractors, today).filter((g) => !f.ctr || g.contractor === f.ctr);
  }, [allStop, areas, contractors, today, people, f.q, f.area, f.line, f.ctr, f.owner, f.status, f.overdue]);
  const tot = useMemo(() => shutdownTotals(groups, contractors), [groups, contractors]);
  const shownTasks = groups.reduce((n, g) => n + g.tasks.length, 0);

  // a link to one area (Open in Shutdown list) scrolls to it
  useEffect(() => {
    if (!f.area) return;
    const id = window.setTimeout(() => document.getElementById(`sd-${f.area}`)?.scrollIntoView({ block: 'start' }), 80);
    return () => window.clearTimeout(id);
  }, [f.area]);

  const exportXlsx = async () => {
    const name = exportFileName({ base: 'shutdown-list', period: today }, 'xlsx');
    const r = await deliverFile(name, buildXlsx([tableToSheet(shutdownTable(groups, { people, contractors, today }))], { title: t('Shutdown list') }), XLSX_MIME);
    setNote(deliveredText(r, t('Downloaded the Shutdown list ({n} tasks).', { n: shownTasks }), name) || null);
  };

  const header = (
    <PageHeader
      title={t('Shutdown list')}
      subtitle={t('Open tasks that can only be done with the area stopped — check it before a planned stop.')}
      right={(
        <>
          <AccessBadge edit={acts.canEdit} />
          {p && <button type="button" className="btn btn-sm" onClick={() => printList(null)} data-testid="sd-print"><Icon name="registry" size={14} /> {t('Print')}</button>}
          {p && <button type="button" className="btn btn-sm" onClick={() => void exportXlsx()} data-testid="sd-excel"><Icon name="download" size={14} /> {t('Excel')}</button>}
        </>
      )}
    />
  );

  if (!p) {
    return (
      <div className="page act-page" data-testid="page-shutdown">
        <ActionsTabs />
        {header}
        <p className="callout" role="status">{acts.error ?? t('Loading the actions…')}</p>
      </div>
    );
  }

  const picks = (
    <>
      {!mobile && <Pick label={t('Area')} value={f.area} onChange={(v) => set('area', v)} testid="sd-area"
        options={[...allGroups.map((g) => ({ value: g.area || '-', label: g.area ? `${g.area}${g.areaName ? ` · ${g.areaName}` : ''}` : t('Plant / line') }))]} />}
      <Pick label={t('Line')} value={f.line} onChange={(v) => set('line', v)} testid="sd-line" options={lines.map((l) => ({ value: l.line_id, label: l.line_id }))} />
      <Pick label={t('Contractor')} value={f.ctr} onChange={(v) => set('ctr', v)} testid="sd-ctr" options={contractors.filter((c) => c.kind === 'contractor').map((c) => ({ value: c.contractor_id, label: c.name }))} />
      <Pick label={t('Owner')} value={f.owner} onChange={(v) => set('owner', v)} testid="sd-owner" options={[{ value: '-', label: t('Nobody yet') }, ...contractors.map((c) => ({ value: c.contractor_id, label: c.name }))]} />
      <Pick label={t('Status')} value={f.status} onChange={(v) => set('sst', v)} testid="sd-status" options={OPEN_TASK_STATUSES.map((s) => ({ value: s, label: t(s) }))} />
      <label className="act-switch af-toggle">
        <input type="checkbox" checked={f.overdue} onChange={(e) => set('od', e.target.checked ? '1' : '')} data-testid="sd-overdue" />
        <span className="act-switch-ui" aria-hidden="true" /><span>{t('Overdue only')}</span>
      </label>
    </>
  );
  const reset = nOn > 0 || f.q ? <button type="button" className="btn btn-sm" onClick={() => setSp((cur) => { const n = new URLSearchParams(cur); KEYS.forEach((k) => n.delete(k)); return n; }, { replace: true })} data-testid="sd-reset">{t('Reset')}</button> : null;

  const groupCard = (g: ShutdownGroup) => (
    <section key={g.area || '-'} id={`sd-${g.area || '-'}`} className="card sd-group" data-testid="sd-group" data-area={g.area || '-'} aria-labelledby={`sd-h-${g.area || '-'}`}>
      <header className="sd-group-head">
        <h2 className="sd-area mono" id={`sd-h-${g.area || '-'}`}>{g.area || t('Plant')}</h2>
        <span className="sd-area-name"><b>{[g.areaName, g.line && t('Line {l}', { l: g.line })].filter(Boolean).join(' · ') || t('Whole plant or line')}</b>
          <small>{g.contractor ? t('Area contractor {c}', { c: contractorName(contractors, g.contractor) }) : t('No area contractor')}</small></span>
        <span className="sd-totals" data-testid="sd-totals">
          <span><b data-testid="sd-total-tasks">{g.tasks.length}</b><small>{g.tasks.length === 1 ? t('task') : t('tasks')}</small></span>
          <span><b data-testid="sd-total-hours">{g.hours.toFixed(1)} h</b><small>{t('est. stop work')}</small></span>
          {!mobile && <span><b data-testid="sd-total-wait">{g.longestDays} d</b><small>{t('longest waiting')}</small></span>}
        </span>
        {!mobile && <button type="button" className="btn btn-sm sd-print-area" onClick={() => printList(g.area)} data-testid="sd-print-area"><Icon name="registry" size={14} /> {t('Print {a}', { a: g.area || t('Plant') })}</button>}
      </header>
      {mobile ? (
        <ul className="sd-cards">
          {g.tasks.map((v) => (
            <li key={v.task_id} className={v.overdue ? 'sd-card sd-card--over' : 'sd-card'} data-testid="sd-row" data-task-id={v.task_id}>
              <button type="button" className="sd-card-btn" onClick={() => open(v.action_id, v.task_id)} data-testid="sd-open">
                <span className="sd-card-top"><span className="mono act-card-id">{v.action_id}</span> {v.equipment_id && <b className="mono">{v.equipment_id}</b>}<b className="sd-card-h">{v.est_stop_h !== null ? `${v.est_stop_h.toFixed(1)} h` : '–'}</b></span>
                <span className="sd-card-title">{v.title}</span>
                <span className="sd-card-foot"><OwnerChip owner={v.owner} contractors={contractors} /><TaskDue task={v} today={today} /><TaskStatusChip status={v.status} /></span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="table-wrap">
          <table className="data-table sd-table">
            <thead><tr><th scope="col">{t('Action · equipment')}</th><th scope="col">{t('Task')}</th><th scope="col">{t('Owner')}</th><th scope="col">{t('Status')}</th><th scope="col">{t('Due')}</th><th scope="col" className="num">{t('Est. h')}</th><th scope="col">{t('Waiting since')}</th></tr></thead>
            <tbody>
              {g.tasks.map((v) => (
                <tr key={v.task_id} className={v.overdue ? 'sd-row--over' : undefined} data-testid="sd-row" data-task-id={v.task_id}>
                  <td><button type="button" className="row-btn mono act-card-id" onClick={() => open(v.action_id, v.task_id)} data-testid="sd-open">{v.action_id}</button><br /><small>{v.equipment_id && <b className="mono">{v.equipment_id} </b>}<span className="muted">{titleWithoutCode(v)}</span></small></td>
                  <td><b>{v.title}</b></td>
                  <td><span className="tk-who"><OwnerChip owner={v.owner} contractors={contractors} /><span>{personName(people, v.assignee)}</span></span></td>
                  <td><TaskStatusChip status={v.status} /></td>
                  <td className="nowrap"><TaskDue task={v} today={today} /></td>
                  <td className="num"><b>{v.est_stop_h !== null ? v.est_stop_h.toFixed(1) : '–'}</b></td>
                  <td className="nowrap" title={t('{n} days waiting', { n: waitingDays(v, today) })}>{dayText((v.waiting_since || v.created_at).slice(0, 10))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const jump = groups.length > 1 && (
    <p className="sd-jump" data-testid="sd-jump"><span className="muted">{t('Jump to area')}:</span>
      {groups.map((g) => (
        <a key={g.area || '-'} href={`#sd-${g.area || '-'}`} className="chip sd-jump-chip" data-testid="sd-jump-chip"
          onClick={(e) => { e.preventDefault(); document.getElementById(`sd-${g.area || '-'}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>
          <b className="mono">{g.area || t('Plant')}</b> {g.tasks.length} · {g.hours.toFixed(1)} h
        </a>
      ))}
    </p>
  );

  return (
    <div className={mobile ? 'page act-page act-page--phone sd-page' : 'page act-page sd-page'} data-testid="page-shutdown">
      <ActionsTabs />
      {!mobile && header}
      {note && <p className="act-note" role="status" data-testid="sd-note"><span>{note}</span><button type="button" className="act-note-x" onClick={() => setNote(null)} aria-label={t('Dismiss')}><Icon name="close" size={14} /></button></p>}
      {!mobile && (
        <div className="sd-sum" data-testid="sd-summary">
          <div className="card as-tile sd-tile"><span className="as-tile-label"><Icon name="clock" size={15} />{t('Tasks waiting for a stop')}</span><b className="as-tile-num" data-testid="sd-sum-tasks">{tot.tasks}</b><span className="as-tile-sub">{t('in {n} actions', { n: tot.actions })}</span></div>
          <div className="card as-tile sd-tile"><span className="as-tile-label"><Icon name="history" size={15} />{t('Estimated stop work')}<ChartInfo help={{ id: 'shutdown-list', vars: { n: tot.tasks, a: tot.areas, h: tot.hours.toFixed(1) } }} title={t('Shutdown list')} /></span><b className="as-tile-num" data-testid="sd-sum-hours">{tot.hours.toFixed(1)} h</b><span className="as-tile-sub">{tot.noEstimate === 1 ? t('1 task without an estimate') : t('{n} tasks without an estimate', { n: tot.noEstimate })}</span></div>
          <div className="card as-tile sd-tile"><span className="as-tile-label"><Icon name="dashboard" size={15} />{t('Areas')}</span><b className="as-tile-num" data-testid="sd-sum-areas">{tot.areas}</b><span className="as-tile-sub">{tot.top ? t('{a} has the most · {h} h', { a: tot.top.area || t('Plant'), h: tot.top.hours.toFixed(1) }) : t('none')}</span></div>
          <div className="card as-tile sd-tile as-tile--danger"><span className="as-tile-label"><Icon name="alert" size={15} />{t('Overdue')}</span><b className="as-tile-num" data-testid="sd-sum-overdue">{tot.overdue}</b><span className="as-tile-sub">{tot.overdueAreas.join(' · ') || t('none')}</span></div>
          <div className="card as-tile sd-tile"><span className="as-tile-label"><Icon name="database" size={15} />{t('By owner')}</span><b className="sd-tile-own">{tot.byContractor.map((r) => `${contractorName(contractors, r.owner)} ${r.n}`).join(' · ') || '–'}</b><span className="as-tile-sub">{t('Internal teams {n}', { n: tot.internal })}</span></div>
        </div>
      )}
      {mobile ? (
        <>
          <div className="chip-row act-chiprow sd-phone-chips">
            <label className={f.area ? 'chip chip--on sd-chip-sel' : 'chip sd-chip-sel'}>
              <span className="sr-only">{t('Area')}</span>
              <select value={f.area} onChange={(e) => set('area', e.target.value)} aria-label={t('Area')} data-testid="sd-area">
                <option value="">{t('Area: all')}</option>
                {allGroups.map((g) => <option key={g.area || '-'} value={g.area || '-'}>{t('Area: {a}', { a: g.area || t('Plant') })}</option>)}
              </select>
              <Icon name="chevronDown" size={14} />
            </label>
            <button type="button" className={nOn - (f.area ? 1 : 0) ? 'chip chip--filters chip--on' : 'chip chip--filters'} onClick={() => setSheet(true)} data-testid="sd-filters"><Icon name="filter" size={14} /> {t('Filters')}{nOn - (f.area ? 1 : 0) ? ` · ${nOn - (f.area ? 1 : 0)}` : ''}</button>
            <button type="button" className="chip" onClick={() => void exportXlsx()} data-testid="sd-excel"><Icon name="download" size={14} /> {t('Excel')}</button>
          </div>
          <p className="sd-phone-sum" data-testid="sd-phone-summary"><Icon name="clock" size={14} />
            {f.area && groups[0] ? <span><b>{groups[0].area || t('Plant')}</b> · {t('{n} tasks', { n: groups[0].tasks.length })} · <b>{groups[0].hours.toFixed(1)} h</b> {t('est.')} · {t('longest waiting {n} d', { n: groups[0].longestDays })}</span>
              : <span><b>{t('{n} tasks', { n: tot.tasks })}</b> · <b>{tot.hours.toFixed(1)} h</b> {t('est.')} · {t('{n} areas', { n: tot.areas })}</span>}
          </p>
        </>
      ) : (
        <section className="card af-bar" aria-label={t('Filters')} data-testid="sd-filters">
          <div className="af-row">
            <label className="af-search"><Icon name="search" size={15} /><input type="search" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder={t('Search equipment, task…')} aria-label={t('Search the Shutdown list')} data-testid="sd-search" /></label>
            {picks}{reset}
          </div>
          {jump}
          <p className="af-info"><Icon name="info" size={14} /><span>{t('A task appears here while it is open and marked Needs stoppage. Done or Not needed tasks drop off. Print and Excel use the filters above.')}</span></p>
        </section>
      )}
      <div className="sd-groups" data-print-root="">
        <h1 className="sd-print-title">{t('Shutdown list')} · {dayText(today)}</h1>
        {groups.map(groupCard)}
        {groups.length === 0 && <p className="muted act-empty card" data-testid="sd-empty">{allStop.length ? t('No stop tasks match these filters.') : t('No open task needs a stop.')}</p>}
      </div>
      {mobile && groups.length > 0 && <p className="sd-share"><button type="button" className="af-link" onClick={() => printList(f.area || null)} data-testid="sd-print"><Icon name="registry" size={15} /> {t('Share or print this list')}</button></p>}
      {sheet && (
        <BottomSheet title={t('Filters')} onClose={() => setSheet(false)} testid="sd-filter-sheet" withClose
          footer={<div className="st-foot">{reset}<button type="button" className="btn-primary" onClick={() => setSheet(false)} data-testid="sd-filters-done">{t('Show {n} tasks', { n: shownTasks })}</button></div>}>
          <div className="af-sheet">{picks}</div>
        </BottomSheet>
      )}
      {openId && <ActionDetail id={openId} taskId={taskId} onClose={close} />}
    </div>
  );
}
