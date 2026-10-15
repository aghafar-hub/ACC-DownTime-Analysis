// The cards over the Actions board (docs/actions-mockups/desktop-actions-board.png, tasks/01-actions-board.png): where the open
// actions are (status donut), the open tasks by task status with the stop work, tasks overdue and actions ready to close
// (backend 1.7.0), then open actions by area (stacked bars; a click filters the board), the no-owner tile, effectiveness of
// the recently closed, open actions by contractor, opened against closed per month and open actions by age.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { isTaskOpen, isTerminalStatus, TASK_STATUSES, type Action, type ActionStatus, type ActionTask, type Contractor, type TaskStatus } from '../api/types';
import Donut from '../charts/Donut';
import type { Paint } from '../charts/palette';
import { t } from '../i18n/t';
import ChartInfo from '../help/ChartInfo';
import { Icon } from '../icons';
import { contractorName, openByAge, openByArea, openByOwner, openedVsClosed, OPEN_STATUSES, statusKey, summarize } from './model';
import { StatusDot } from './parts';
import { taskSummary } from './tasks';

const PATTERN: Record<string, Paint['pattern']> = { Draft: 'dots' };
export const statusPaint = (s: ActionStatus): Paint => ({ key: statusKey(s), label: s, short: s, color: `var(--act-${statusKey(s)})`, pattern: PATTERN[s] ?? 'solid' });
const pct = (n: number, total: number): string => (total > 0 ? `${Math.round((n / total) * 100)}%` : '0%');

/** The open task statuses, in order (the Open tasks bar). */
const OPEN_TASK_STATUSES = TASK_STATUSES.filter((s) => isTaskOpen({ status: s }));

export default function SummaryCards({ actions, tasks, contractors, today, onArea, onStatus, onReady, onNoOwner }: {
  actions: readonly Action[]; tasks: readonly ActionTask[]; contractors: readonly Contractor[]; today: string;
  onArea: (area: string) => void; onStatus: (s: ActionStatus) => void; onReady: () => void; onNoOwner: () => void;
}) {
  const sum = useMemo(() => summarize(actions, today), [actions, today]);
  const ts = useMemo(() => taskSummary(actions, tasks, today), [actions, tasks, today]);
  const kindOf = (id: string) => contractors.find((c) => c.contractor_id === id)?.kind ?? 'internal';
  const overdueExt = ts.overdueBy.filter((r) => r.owner && kindOf(r.owner) === 'contractor');
  const overdueInt = ts.overdueBy.filter((r) => !r.owner || kindOf(r.owner) !== 'contractor').reduce((n, r) => n + r.n, 0);
  const taskMax = Math.max(1, ts.open);
  const byArea = useMemo(() => openByArea(actions), [actions]);
  const byOwner = useMemo(() => openByOwner(actions, today), [actions, today]);
  const ovc = useMemo(() => openedVsClosed(actions, today), [actions, today]);
  const age = useMemo(() => openByAge(actions, today), [actions, today]);
  const counts = OPEN_STATUSES.map((s) => ({ s, n: actions.filter((a) => a.status === s).length }));
  const areaMax = Math.max(1, ...byArea.map((r) => r.total));
  const shownAreas = byArea.slice(0, 6);
  const restAreas = byArea.slice(6);
  const judged = sum.effective + sum.notEffective;
  const ovMax = Math.max(1, ...ovc.flatMap((m) => [m.opened, m.closed]));
  const ageMax = Math.max(1, ...age.buckets.map((b) => b.count));
  const ownerTotal = byOwner.reduce((s, r) => s + r.total, 0);
  const openTotal = sum.open;

  return (
    <div className="as-grid" data-testid="actions-summary">
      <section className="card as-card as-status" aria-labelledby="as-status-h">
        <header className="as-head"><div className="card-title-row"><h2 id="as-status-h">{t('Where the open actions are')}</h2><ChartInfo help={{ id: 'as-status' }} title={t('Where the open actions are')} /></div><span className="muted">{t('by status')}</span></header>
        <div className="as-donut-row">
          <Donut slices={counts.map((c) => ({ paint: statusPaint(c.s), value: c.n }))} size={150} centre={String(openTotal)} centreSub={t('open')}
            ariaLabel={t('{n} open actions: {list}', { n: openTotal, list: counts.map((c) => `${t(c.s)} ${c.n}`).join(', ') })} />
          <ul className="as-legend">
            {counts.map((c) => (
              <li key={c.s}>
                <button type="button" className="as-legend-btn" onClick={() => onStatus(c.s)} data-testid={`as-status-${statusKey(c.s)}`}>
                  <StatusDot status={c.s} /><span>{t(c.s)}</span><b>{c.n}</b><small>{pct(c.n, openTotal)}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <p className="as-foot">{t('+ {n} closed in the last 90 days · cancelled hidden', { n: sum.closedRecent })}</p>
      </section>

      <section className="card as-card as-tasks" aria-labelledby="as-tasks-h" data-testid="as-tasks">
        <header className="as-head"><div className="card-title-row"><h2 id="as-tasks-h">{t('Open tasks')}</h2><ChartInfo help={{ id: 'as-tasks', vars: { n: ts.open, a: ts.openActions, h: ts.stopHours, s: ts.needsStop } }} title={t('Open tasks')} /></div><span className="muted">{t('in the {n} open actions', { n: ts.openActions })}</span></header>
        <p className="as-big"><b data-testid="as-tasks-open">{ts.open}</b> <span className="muted">{t('open tasks · {n} done or not needed', { n: ts.closed })}</span></p>
        <div className="as-stack as-task-stack" role="img" aria-label={OPEN_TASK_STATUSES.map((s) => `${t(s)} ${ts.byStatus[s as TaskStatus]}`).join(', ')}>
          {OPEN_TASK_STATUSES.filter((s) => ts.byStatus[s as TaskStatus]).map((s) => (
            <span key={s} className={`act-fill--${statusKey(s)}`} style={{ flexGrow: ts.byStatus[s as TaskStatus] / taskMax }}>{ts.byStatus[s as TaskStatus]}</span>
          ))}
        </div>
        <ul className="as-mini-legend as-task-legend" data-testid="as-task-legend">
          {OPEN_TASK_STATUSES.map((s) => <li key={s}><StatusDot status={s} />{t(s)} <b>{ts.byStatus[s as TaskStatus]}</b></li>)}
        </ul>
        <p className="as-foot as-stopline"><Icon name="clock" size={13} /> <b>{ts.needsStop === 1 ? t('1 task needs a stop') : t('{n} tasks need a stop', { n: ts.needsStop })}</b>{ts.stopHours ? ` · ${t('{h} h estimated', { h: ts.stopHours })}` : ''} — <Link to="/actions/shutdown" data-testid="as-shutdown-link">{t('Shutdown list')} ›</Link></p>
      </section>

      <div className="as-tiles as-tiles--row">
        <Link to="/actions/tasks?tq=overdue" className="card as-tile as-tile--danger" data-testid="as-overdue">
          <span className="as-tile-label"><Icon name="alert" size={15} />{t('Tasks overdue')}</span>
          <b className="as-tile-num">{ts.overdue}</b>
          <span className="as-tile-sub">{t('in {n} actions · due date passed', { n: ts.overdueActions })}</span>
          {ts.overdue > 0 && <span className="as-tile-sub">{[...overdueExt.map((r) => t('{n} with {c}', { n: r.n, c: contractorName(contractors, r.owner) })), overdueInt ? t('{n} internal teams', { n: overdueInt }) : ''].filter(Boolean).join(' · ')}</span>}
          <span className="as-tile-link">{t('Show in Tasks')} ›</span>
        </Link>
        <button type="button" className="card as-tile as-tile--ok" onClick={onReady} data-testid="as-ready">
          <span className="as-tile-label"><Icon name="check" size={15} />{t('Ready to close')}</span>
          <b className="as-tile-num">{ts.ready}</b>
          <span className="as-tile-sub">{t('all tasks done · waiting for a person on the Who can close list')}</span>
          <span className="as-tile-link">{t('Show them')} ›</span>
        </button>
      </div>

      <section className="card as-card as-area" aria-labelledby="as-area-h">
        <header className="as-head"><div className="card-title-row"><h2 id="as-area-h">{t('Open actions by area')}</h2><ChartInfo help={{ id: 'as-area' }} title={t('Open actions by area')} /></div><span className="muted">{t('click an area to filter the board')}</span></header>
        <ul className="as-mini-legend" aria-hidden="true">{OPEN_STATUSES.map((s) => <li key={s}><StatusDot status={s} />{t(s)}</li>)}</ul>
        {shownAreas.length === 0 ? <p className="muted">{t('No open actions.')}</p> : (
          <ul className="as-bars" data-testid="as-area-bars">
            {shownAreas.map((r) => (
              <li key={r.area || '-'}>
                <button type="button" className="as-bar-row" onClick={() => onArea(r.area || '-')} data-testid="as-area" data-area={r.area}
                  aria-label={t('{a}: {n} open actions. {list}. Filter the board.', { a: r.area || t('Plant / line'), n: r.total, list: OPEN_STATUSES.filter((s) => r.byStatus[s]).map((s) => `${t(s)} ${r.byStatus[s]}`).join(', ') })}>
                  <span className="as-bar-label">{r.area || t('Plant / line')}</span>
                  <span className="as-bar-track" style={{ width: `${(r.total / areaMax) * 100}%` }}>
                    {OPEN_STATUSES.filter((s) => r.byStatus[s]).map((s) => (
                      <span key={s} className={`as-seg act-fill--${statusKey(s)}`} style={{ flexGrow: r.byStatus[s] }}>{r.byStatus[s]}</span>
                    ))}
                  </span>
                  <b className="as-bar-total">{r.total}</b>
                </button>
              </li>
            ))}
          </ul>
        )}
        {restAreas.length > 0 && <p className="as-foot">+ {restAreas.map((r) => `${r.area || t('Plant / line')} ${r.total}`).join(' · ')}</p>}
      </section>

      <div className="as-tiles as-tiles--one">
        <button type="button" className="card as-tile as-tile--warn" onClick={onNoOwner} data-testid="as-noowner">
          <span className="as-tile-label"><Icon name="users" size={15} />{t('No owner')}</span>
          <b className="as-tile-num">{sum.noOwner}</b>
          <span className="as-tile-sub">{t('open, nobody follows it up')} · {t('{n} drafts', { n: sum.noOwnerDrafts })}</span>
        </button>
      </div>

      <section className="card as-card" aria-labelledby="as-eff-h" data-testid="as-effect">
        <header className="as-head"><div className="card-title-row"><h2 id="as-eff-h">{t('Effectiveness')}</h2><ChartInfo help={{ id: 'as-effect' }} title={t('Effectiveness')} /></div><span className="muted">{t('closed in the last 90 days')}</span></header>
        <p className="as-big">{judged ? `${Math.round((sum.effective / judged) * 100)}%` : '–'} <span className="muted">{judged ? t('effective · {e} of {j} judged', { e: sum.effective, j: judged }) : t('nothing judged yet')}</span></p>
        <div className="as-stack" aria-hidden="true">
          {sum.effective > 0 && <span className="act-fill--closed" style={{ flexGrow: sum.effective }}>{sum.effective}</span>}
          {sum.notEffective > 0 && <span className="as-fill-bad" style={{ flexGrow: sum.notEffective }}>{sum.notEffective}</span>}
          {sum.watching > 0 && <span className="as-fill-watch" style={{ flexGrow: sum.watching }}>{sum.watching}</span>}
        </div>
        <ul className="as-list">
          <li><Icon name="check" size={14} />{t('Effective')}<b>{sum.effective}</b></li>
          <li><Icon name="ban" size={14} />{t('Not effective · failure returned')}<b>{sum.notEffective}</b></li>
          <li><Icon name="clock" size={14} />{t('Watching')}<b>{sum.watching}</b></li>
        </ul>
      </section>

      <section className="card as-card" aria-labelledby="as-own-h" data-testid="as-owners">
        <header className="as-head"><div className="card-title-row"><h2 id="as-own-h">{t('Open actions by contractor')}</h2><ChartInfo help={{ id: 'as-owners' }} title={t('Open actions by contractor')} /></div></header>
        <ul className="as-list as-list--owners">
          {byOwner.slice(0, 6).map((r) => (
            <li key={r.owner || '-'}>
              <span className="as-own-name">{r.owner ? contractorName(contractors, r.owner) : t('Nobody yet')}</span>
              <span className="as-own-bar"><span style={{ width: pct(r.total, ownerTotal) }} /></span>
              <b>{r.total}</b>
              <small className={r.overdue ? 'as-od' : 'muted'}>{t('{n} overdue', { n: r.overdue })}</small>
            </li>
          ))}
          {byOwner.length === 0 && <li className="muted">{t('No open actions.')}</li>}
        </ul>
      </section>

      <section className="card as-card" aria-labelledby="as-ovc-h" data-testid="as-ovc">
        <header className="as-head"><div className="card-title-row"><h2 id="as-ovc-h">{t('Opened vs closed')}</h2><ChartInfo help={{ id: 'as-ovc' }} title={t('Opened vs closed')} /></div><span className="muted">{t('last 6 months')}</span></header>
        <ul className="as-mini-legend"><li><span className="as-sw as-sw--opened" aria-hidden="true" />{t('Opened {n}', { n: ovc.reduce((s, m) => s + m.opened, 0) })}</li><li><span className="as-sw as-sw--closed" aria-hidden="true" />{t('Closed {n}', { n: ovc.reduce((s, m) => s + m.closed, 0) })}</li></ul>
        <div className="as-cols" role="img" aria-label={ovc.map((m) => t('{m}: {o} opened, {c} closed', { m: m.label, o: m.opened, c: m.closed })).join('; ')}>
          {ovc.map((m) => (
            <span key={m.month} className="as-col">
              <span className="as-col-bars">
                <span className="as-col-bar as-col-bar--opened" style={{ height: `${(m.opened / ovMax) * 100}%` }} title={`${m.opened}`} />
                <span className="as-col-bar as-col-bar--closed" style={{ height: `${(m.closed / ovMax) * 100}%` }} title={`${m.closed}`} />
              </span>
              <small>{m.label}</small>
            </span>
          ))}
        </div>
      </section>

      <section className="card as-card" aria-labelledby="as-age-h" data-testid="as-age">
        <header className="as-head"><div className="card-title-row"><h2 id="as-age-h">{t('Open actions by age')}</h2><ChartInfo help={{ id: 'as-age' }} title={t('Open actions by age')} /></div></header>
        <p className="muted as-sub">{t('days since opened')}{age.oldest ? ` · ${t('oldest {id} ({n} d)', { id: age.oldest.id, n: age.oldest.days })}` : ''}</p>
        <div className="as-cols as-cols--age" role="img" aria-label={age.buckets.map((b) => `${b.label}: ${b.count}`).join('; ')}>
          {age.buckets.map((b, i) => (
            <span key={b.id} className="as-col">
              <b>{b.count}</b>
              <span className="as-col-bars"><span className={`as-col-bar as-age-${i}`} style={{ height: `${(b.count / ageMax) * 100}%` }} /></span>
              <small>{b.label}</small>
            </span>
          ))}
        </div>
        <p className="as-foot">{t('{n} actions older than 30 days', { n: age.over30 })}</p>
      </section>
    </div>
  );
}

export const openCount = (list: readonly Action[]): number => list.filter((a) => !isTerminalStatus(a.status)).length;
