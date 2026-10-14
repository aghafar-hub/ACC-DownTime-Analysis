// The cards over the Actions board (docs/actions-mockups/desktop-actions-board.png): where the open actions are (status
// donut), open actions by area (stacked bars; a click filters the board), overdue and no-owner tiles, effectiveness of
// the recently closed, open actions by contractor, opened against closed per month and open actions by age.
import { useMemo } from 'react';
import { isTerminalStatus, type Action, type ActionStatus, type Contractor } from '../api/types';
import Donut from '../charts/Donut';
import type { Paint } from '../charts/palette';
import { t } from '../i18n/t';
import ChartInfo from '../help/ChartInfo';
import { Icon } from '../icons';
import { contractorName, openByAge, openByArea, openByOwner, openedVsClosed, OPEN_STATUSES, statusKey, summarize } from './model';
import { StatusDot } from './parts';

const PATTERN: Record<string, Paint['pattern']> = { Draft: 'dots', 'Waiting stoppage': 'hatch' };
export const statusPaint = (s: ActionStatus): Paint => ({ key: statusKey(s), label: s, short: s, color: `var(--act-${statusKey(s)})`, pattern: PATTERN[s] ?? 'solid' });
const pct = (n: number, total: number): string => (total > 0 ? `${Math.round((n / total) * 100)}%` : '0%');

export default function SummaryCards({ actions, contractors, today, onArea, onStatus, onOverdue, onNoOwner }: {
  actions: readonly Action[]; contractors: readonly Contractor[]; today: string;
  onArea: (area: string) => void; onStatus: (s: ActionStatus) => void; onOverdue: () => void; onNoOwner: () => void;
}) {
  const sum = useMemo(() => summarize(actions, today), [actions, today]);
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
  const overdueBy = [...sum.overdueBy.entries()].sort((a, b) => b[1] - a[1])[0];

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

      <div className="as-tiles">
        <button type="button" className="card as-tile as-tile--danger" onClick={onOverdue} data-testid="as-overdue">
          <span className="as-tile-label"><Icon name="alert" size={15} />{t('Overdue')}</span>
          <b className="as-tile-num">{sum.overdue}</b>
          <span className="as-tile-sub">{t('open, due date passed')}{overdueBy ? ` · ${t('{n} with {c}', { n: overdueBy[1], c: contractorName(contractors, overdueBy[0]) || t('nobody') })}` : ''}</span>
        </button>
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
