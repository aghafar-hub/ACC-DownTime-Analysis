// Actions › Tasks (docs/actions-mockups/tasks/08-tasks-list.png): every task of every action in one table. Quick filters My
// tasks / All open / Overdue / Needs stoppage / Done · 90 d with their counts, then search, owner, person, status, area, line
// and a Needs stoppage switch; every column sorts; overdue first by default. A click on a status changes it (Edit on Actions),
// a click on a row opens the action at that task. The filters live in the address. Phone: chips, a Filters sheet and cards.
import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isTaskOpen, isTerminalStatus, TASK_STATUSES, type TaskStatus, type TaskView } from '../api/types';
import AccessBadge from '../components/AccessBadge';
import { BottomSheet, ShowMore } from '../components/PhoneParts';
import RowMenu from '../components/RowMenu';
import { MenuItem } from '../components/PopMenu';
import { PageHeader } from '../components/Tile';
import { useAuth } from '../auth/AuthContext';
import { useStartup } from '../data/useStartup';
import { deliverFile, deliveredText } from '../export/deliverFile';
import { exportFileName } from '../export/files';
import { tableToSheet } from '../export/table';
import { buildXlsx, XLSX_MIME } from '../export/xlsx';
import ChartInfo from '../help/ChartInfo';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import ActionDetail from './ActionDetail';
import { useActions } from './ActionsContext';
import ActionsTabs, { useActionOpener } from './ActionsTabs';
import { personName, statusKey, todayLocal } from './model';
import { OwnerChip, StopTag, TaskDue, TaskStatusChip } from './parts';
import TaskStatusDialog from './TaskStatusDialog';
import {
  buildTaskViews, filterTasks, filterTasksExceptQuick, parseTaskFilters, quickCounts, sortTaskViews, TASK_QUICK_LABEL, TASK_QUICKS, tasksTable,
  titleWithoutCode, writeTaskFilters, type TaskListFilters, type TaskSortKey,
} from './tasks';
import '../components/ui.css';
import './actions.css';

const PAGE = 50;
const COLS: { key: TaskSortKey; label: string }[] = [
  { key: 'task', label: 'Task' }, { key: 'action', label: 'Action · equipment' }, { key: 'area', label: 'Area' }, { key: 'owner', label: 'Owner · person' },
  { key: 'status', label: 'Status' }, { key: 'due', label: 'Due' }, { key: 'stop', label: 'Stop' },
];

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

export default function TasksView() {
  const acts = useActions();
  const { user } = useAuth();
  const { startup } = useStartup();
  const mobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const { openId, taskId, open, close } = useActionOpener();
  const today = todayLocal();
  const f = useMemo(() => parseTaskFilters(sp), [sp]);
  const p = acts.payload;
  const people = useMemo(() => p?.people ?? [], [p]);
  const contractors = useMemo(() => p?.contractors ?? [], [p]);
  const env = useMemo(() => ({ today, me: user?.user_id ?? '', people, contractors }), [today, user, people, contractors]);
  const all = useMemo(() => (p ? buildTaskViews(p.actions, p.tasks ?? [], p.logs, today) : []), [p, today]);
  const base = useMemo(() => filterTasksExceptQuick(all, f, env), [all, f, env]);
  const shown = useMemo(() => sortTaskViews(filterTasks(all, f, env), f.sort, f.dir, env), [all, f, env]);
  const counts = useMemo(() => quickCounts(base, env), [base, env]);
  const totals = useMemo(() => quickCounts(all, env), [all, env]);
  const [limit, setLimit] = useState(PAGE);
  const [sheet, setSheet] = useState(false);
  const [statusFor, setStatusFor] = useState<TaskView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const areas = useMemo(() => (startup?.areas ?? []).slice().sort((a, b) => a.sort_order - b.sort_order), [startup]);
  const lines = useMemo(() => (startup?.lines ?? []).slice().sort((a, b) => a.sort_order - b.sort_order), [startup]);
  const persons = useMemo(() => [...new Set(all.map((v) => v.assignee).filter(Boolean))].map((id) => ({ value: id, label: personName(people, id) })).sort((a, b) => a.label.localeCompare(b.label)), [all, people]);

  const set = (patch: Partial<TaskListFilters>) => {
    setLimit(PAGE);
    setSp((cur) => writeTaskFilters(cur, { ...parseTaskFilters(cur), ...patch }), { replace: true });
  };
  const sortBy = (k: TaskSortKey) => set(f.sort === k ? { dir: f.dir === 'asc' ? 'desc' : 'asc' } : { sort: k, dir: 'asc' });
  const canChange = (v: TaskView) => acts.canEdit && !acts.blockedReason && !isTerminalStatus(v.action_status);
  const nOn = [f.owner, f.person, f.status, f.area, f.line].filter(Boolean).length + (f.stop ? 1 : 0);
  const reset = () => setSp((cur) => writeTaskFilters(cur, parseTaskFilters(new URLSearchParams())), { replace: true });

  const exportXlsx = async () => {
    const name = exportFileName({ base: 'tasks', period: today }, 'xlsx');
    const r = await deliverFile(name, buildXlsx([tableToSheet(tasksTable(shown, { people, contractors, today }))], { title: t('Tasks') }), XLSX_MIME);
    setNote(deliveredText(r, t('Downloaded {n} tasks.', { n: shown.length }), name) || null);
  };

  const header = (
    <PageHeader
      title={t('Tasks')}
      subtitle={p ? (
        <span data-testid="tasks-subtitle">
          <b>{t('{n} open tasks', { n: totals.open })}</b> {t('in {n} actions', { n: new Set(all.filter(isTaskOpen).map((v) => v.action_id)).size })}
          {' · '}<b className={totals.overdue ? 'as-od' : undefined}>{t('{n} overdue', { n: totals.overdue })}</b>
          {' · '}<b>{totals.stop}</b> {t('need a stop')} · <b>{totals.mine}</b> {t('are yours')}
        </span>
      ) : t('Every task of every action in one list.')}
      right={<><AccessBadge edit={acts.canEdit} />{p && !mobile && <button type="button" className="btn btn-sm" onClick={() => void exportXlsx()} data-testid="tasks-excel"><Icon name="download" size={14} /> {t('Excel')}</button>}</>}
    />
  );

  const statusCell = (v: TaskView) => (canChange(v)
    ? <button type="button" className={`tk-status-btn tk-status--${statusKey(v.status)}`} onClick={(e) => { e.stopPropagation(); setStatusFor(v); }} aria-label={t('Change the status of {t}: {s}', { t: v.title, s: t(v.status) })} data-testid="task-status-btn">
      <TaskStatusChip status={v.status} /><Icon name="chevronDown" size={13} />
    </button>
    : <TaskStatusChip status={v.status} />);

  const quick = (
    <div className={mobile ? 'chip-row act-chiprow tl-quick' : 'dseg tl-quick'} role="group" aria-label={t('Quick filters')} data-testid="tasks-quick">
      {TASK_QUICKS.map((q) => (
        <button key={q} type="button" className={mobile ? (f.quick === q ? 'chip chip--on' : 'chip') : 'dseg-btn'} aria-pressed={f.quick === q} onClick={() => set({ quick: q })} data-testid={`tq-${q}`}>
          {q === 'mine' && <Icon name="users" size={14} />}{q === 'overdue' && <Icon name="alert" size={14} />}{q === 'stop' && <Icon name="clock" size={14} />}
          {t(TASK_QUICK_LABEL[q])} <b className="tl-q-n" data-testid="tq-count">{counts[q]}</b>
        </button>
      ))}
    </div>
  );
  const search = (
    <label className="af-search">
      <Icon name="search" size={15} />
      <input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder={t('Search task, equipment…')} aria-label={t('Search tasks')} data-testid="tasks-search" />
    </label>
  );
  const picks = (
    <>
      <Pick label={t('Owner')} value={f.owner} onChange={(v) => set({ owner: v })} testid="tf-owner" options={[{ value: '-', label: t('Nobody yet') }, ...contractors.map((c) => ({ value: c.contractor_id, label: c.name }))]} />
      <Pick label={t('Person')} value={f.person} onChange={(v) => set({ person: v })} testid="tf-person" options={[{ value: '-', label: t('Nobody') }, ...persons]} />
      <Pick label={t('Status')} value={f.status} onChange={(v) => set({ status: v as TaskStatus | '' })} testid="tf-status" options={TASK_STATUSES.map((s) => ({ value: s, label: t(s) }))} />
      <Pick label={t('Area')} value={f.area} onChange={(v) => set({ area: v })} testid="tf-area" options={areas.map((a) => ({ value: a.area_id, label: `${a.area_id} · ${a.name}` }))} />
      <Pick label={t('Line')} value={f.line} onChange={(v) => set({ line: v })} testid="tf-line" options={lines.map((l) => ({ value: l.line_id, label: l.line_id }))} />
      <label className="act-switch af-toggle">
        <input type="checkbox" checked={f.stop} onChange={(e) => set({ stop: e.target.checked })} data-testid="tf-stop" />
        <span className="act-switch-ui" aria-hidden="true" /><span>{t('Needs stoppage')}</span>
      </label>
    </>
  );
  const status = (
    <>
      {acts.fromCache && p && <div className="callout callout--warning" role="status"><Icon name="wifiOff" size={16} /><span>{t('Showing the copy saved on this device. Changes need a connection.')}</span></div>}
      {note && <p className="act-note" role="status" data-testid="tasks-note"><span>{note}</span><button type="button" className="act-note-x" onClick={() => setNote(null)} aria-label={t('Dismiss')}><Icon name="close" size={14} /></button></p>}
    </>
  );
  const dialogs = (
    <>
      {statusFor && p && (
        <TaskStatusDialog task={statusFor} action={statusFor} contractors={contractors} people={people} today={today}
          onClose={() => setStatusFor(null)} onDone={(text) => { setStatusFor(null); setNote(text); }} />
      )}
      {openId && <ActionDetail id={openId} taskId={taskId} onClose={close} />}
    </>
  );

  if (!p) {
    return (
      <div className="page act-page" data-testid="page-tasks">
        <ActionsTabs />
        {header}
        <p className="callout" role="status">{acts.error ?? t('Loading the actions…')}</p>
      </div>
    );
  }

  const vis = shown.slice(0, limit);
  if (mobile) {
    return (
      <div className="page act-page act-page--phone" data-testid="page-tasks">
        <ActionsTabs />
        {status}
        <div className="act-phone-filters">
          {search}
          <div className="chip-row act-chiprow">
            <button type="button" className={nOn ? 'chip chip--filters chip--on' : 'chip chip--filters'} onClick={() => setSheet(true)} aria-haspopup="dialog" data-testid="tasks-filters">
              <Icon name="filter" size={14} /> {t('Filters')}{nOn ? ` · ${nOn}` : ''}
            </button>
          </div>
          {quick}
        </div>
        <p className="act-phone-sum"><span data-testid="tasks-count">{t('{n} tasks', { n: shown.length })}</span></p>
        <ul className="tk-cards tl-cards" data-testid="tasks-list">
          {vis.map((v) => (
            <li key={v.task_id} className={`tk-card tk-card--${statusKey(v.status)}${v.overdue ? ' tk-card--overdue' : ''}`} data-testid="tl-row" data-task-id={v.task_id} data-status={v.status} data-overdue={v.overdue || undefined}>
              <div className="tk-card-top">{statusCell(v)}<TaskDue task={v} today={today} /></div>
              <button type="button" className="tk-card-main" onClick={() => open(v.action_id, v.task_id)} data-testid="tl-open">
                <span className="tk-card-title">{v.title}</span>
                <span className="tk-card-sub"><span className="mono act-card-id">{v.action_id}</span> {v.equipment_id && <b className="mono">{v.equipment_id}</b>} {v.area_id}</span>
                <span className="tk-card-who"><OwnerChip owner={v.owner} contractors={contractors} /><span>{personName(people, v.assignee)}</span>{v.needs_stop && <StopTag task={v} />}</span>
              </button>
            </li>
          ))}
        </ul>
        {shown.length === 0 && <p className="muted act-empty" data-testid="tasks-empty">{t('No tasks match these filters.')}</p>}
        <ShowMore shown={vis.length} total={shown.length} onMore={() => setLimit((n) => n + PAGE)} testid="tasks-more" />
        {sheet && (
          <BottomSheet title={t('Filters')} onClose={() => setSheet(false)} testid="tasks-filter-sheet" withClose
            footer={<div className="st-foot">{nOn > 0 && <button type="button" className="btn" onClick={reset}>{t('Reset')}</button>}<button type="button" className="btn-primary" onClick={() => setSheet(false)} data-testid="tasks-filters-done">{t('Show {n} tasks', { n: shown.length })}</button></div>}>
            <div className="af-sheet">{picks}</div>
          </BottomSheet>
        )}
        {dialogs}
      </div>
    );
  }

  const grouped = f.sort === 'due' && f.dir === 'asc';
  const nOver = vis.filter((v) => v.overdue).length;
  return (
    <div className="page act-page" data-testid="page-tasks">
      <ActionsTabs />
      {header}
      {status}
      <section className="card af-bar" aria-label={t('Filters')} data-testid="tasks-filters">
        <div className="af-row">{quick}{search}</div>
        <div className="af-row">{picks}{(nOn > 0 || f.q || f.quick !== 'open') && <button type="button" className="btn btn-sm" onClick={reset} data-testid="tasks-reset">{t('Reset')}</button>}</div>
        <p className="af-info"><Icon name="info" size={14} /><span>{t('Every task from every action in one list · sorted by due date, overdue first · click a status to change it, click a row to open the action at that task.')}</span></p>
      </section>
      <div className="card al-card tl-card">
        <div className="tl-card-head"><h2 className="tl-h2">{t('{n} tasks', { n: shown.length })}</h2><ChartInfo help={{ id: 'tasks-list', vars: { n: shown.length, o: shown.filter((v) => v.overdue).length } }} title={t('Tasks')} /></div>
        <div className="table-wrap">
          <table className="data-table tl-table" data-testid="tasks-table">
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} scope="col" aria-sort={f.sort === c.key ? (f.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button type="button" className="th-sort" onClick={() => sortBy(c.key)} data-testid={`tl-sort-${c.key}`}>
                      {t(c.label)}{f.sort === c.key && <Icon name={f.dir === 'asc' ? 'chevronUp' : 'chevronDown'} size={13} />}
                    </button>
                  </th>
                ))}
                <th scope="col"><span className="sr-only">{t('More')}</span></th>
              </tr>
            </thead>
            <tbody>
              {vis.map((v, i) => (
                <Fragment key={v.task_id}>
                  {grouped && i === 0 && nOver > 0 && <tr key="g-over" className="tl-group tl-group--over"><th colSpan={8} scope="rowgroup">{t('Overdue · {n}', { n: shown.filter((x) => x.overdue).length })}</th></tr>}
                  {grouped && !v.overdue && (i === 0 || vis[i - 1]!.overdue) && <tr key="g-later" className="tl-group"><th colSpan={8} scope="rowgroup">{t('Due later · {n}', { n: shown.filter((x) => !x.overdue).length })}</th></tr>}
                  <tr className={v.overdue ? 'tl-row tl-row--over' : 'tl-row'} data-testid="tl-row" data-task-id={v.task_id} data-status={v.status} data-overdue={v.overdue || undefined}
                    onClick={() => open(v.action_id, v.task_id)}>
                    <td className="tl-task"><button type="button" className="row-btn" onClick={(e) => { e.stopPropagation(); open(v.action_id, v.task_id); }} data-testid="tl-open">
                      <b className={v.status === 'Not needed' ? 'tk-struck' : undefined}>{v.title}</b></button></td>
                    <td><span className="mono act-card-id">{v.action_id}</span><br /><small>{v.equipment_id && <b className="mono">{v.equipment_id} </b>}<span className="muted">{titleWithoutCode(v)}</span></small></td>
                    <td className="mono nowrap">{v.area_id || t('Plant')}</td>
                    <td><span className="tk-who"><OwnerChip owner={v.owner} contractors={contractors} /><span>{personName(people, v.assignee)}</span></span></td>
                    <td onClick={(e) => e.stopPropagation()}>{statusCell(v)}</td>
                    <td className="nowrap"><TaskDue task={v} today={today} /></td>
                    <td className="nowrap"><StopTag task={v} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <RowMenu label={t('More for {t}', { t: v.title })} testid="tl-menu">
                        {(closeMenu) => (
                          <>
                            <MenuItem onClick={() => { closeMenu(); open(v.action_id, v.task_id); }} testid="tl-menu-open">{t('Open {id} at this task', { id: v.action_id })}</MenuItem>
                            {canChange(v) && <MenuItem onClick={() => { closeMenu(); setStatusFor(v); }} testid="tl-menu-status">{t('Change status')}</MenuItem>}
                          </>
                        )}
                      </RowMenu>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="muted act-empty" data-testid="tasks-empty">{t('No tasks match these filters.')}</p>}
        </div>
        {shown.length > vis.length && (
          <p className="tl-foot"><span>{t('Showing {n} of {m} tasks', { n: vis.length, m: shown.length })}</span>
            <button type="button" className="af-link" onClick={() => setLimit(shown.length)} data-testid="tasks-show-all">{t('Show all {n}', { n: shown.length })}</button></p>
        )}
      </div>
      {dialogs}
    </div>
  );
}
