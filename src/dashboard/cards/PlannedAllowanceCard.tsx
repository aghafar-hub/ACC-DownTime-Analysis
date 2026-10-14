// "Planned hours vs allowance (year to date)": for each area in the scope that has a planned-stop allowance for the year
// (Settings › Actions & targets), the planned (PL) hours used from January to the newest data against the allowance of
// those months, and one small bar per month (over the month's allowance = red hatched, overhaul months marked). The PL
// hours follow P1 like the server's Planned overrun rule. Nothing is drawn when no area in the scope has an allowance.
import { useMemo, type CSSProperties } from 'react';
import { useAreaTargets } from '../../actions/ActionsContext';
import { fmtH, plannedYtd } from '../../actions/targets';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { MONTHS } from '../../util/dates';
import { num } from '../../util/format';
import type { DashFilters } from '../filters';
import type { DashCtx } from '../scope';
import { ctxYear } from '../useAreaTargetMap';
import DashCard from './DashCard';
import './plannedAllowance.css';

export default function PlannedAllowanceCard({ ctx, filters, onOpenRows }: { ctx: DashCtx; filters: DashFilters; onOpenRows: (label: string, rowIds: string[]) => void }) {
  const { targets } = useAreaTargets();
  const year = ctxYear(ctx);
  const dataEnd = ctx.coverage?.to ?? '';
  const areas = useMemo(
    () => (year === null ? [] : plannedYtd({ rows: ctx.base.rows, targets, year, dataEnd, areaIds: ctx.base.areaIds })),
    [ctx.base, targets, year, dataEnd],
  );
  if (!areas.length || year === null) return null;
  const through = areas[0]!.through;
  const span = through <= 1 ? MONTHS[0]! : `${MONTHS[0]}–${MONTHS[through - 1]}`;
  const over = areas.filter((a) => a.ytdUsed > a.ytdAllowed + 1e-9);
  const allIds = areas.flatMap((a) => a.rowIds);
  const summary = t('{n} areas with a planned-stop allowance for {y}. {o} over their allowance for {s}: {list}.', {
    n: areas.length, y: year, o: over.length, s: span, list: areas.map((a) => `${a.area_id} ${fmtH(a.ytdUsed)} of ${fmtH(a.ytdAllowed)} h`).join(', '),
  });
  const lines = filters.lineIds.length ? filters.lineIds.join(', ') : t('All lines');
  return (
    <DashCard
      id="planned-allowance" testid="chart-planned-allowance" span="full" help={{ id: 'planned-allowance' }}
      title={t('Planned hours vs allowance (year to date)')}
      subtitle={t('Planned stop hours used {s} {y} against the allowance of those months, per area (Settings › Actions & targets)', { s: span, y: year })}
      legend={[
        { kind: 'box', className: 'pa-lg-in', label: t('Within allowance') },
        { kind: 'box', className: 'pa-lg-over', label: t('Over allowance') },
        { kind: 'box', className: 'pa-lg-oh', label: t('Overhaul month') },
      ]}
      summary={summary} scope={`${span} ${year} · ${lines} · ${t('Planned (PL)')}`}
      open={{ ids: allIds, label: t('Planned stops {s} {y}', { s: span, y: year }) }} onOpen={(spec) => onOpenRows(spec.label, spec.ids)}
      footExtra={<span className="sr-only" data-testid="planned-over-count">{t('{n} areas over the allowance', { n: over.length })}</span>}
    >
      <ul className="pa-list" data-testid="pa-list">
        {areas.map((a) => {
          const pct = a.ytdAllowed > 0 ? Math.min(100, (a.ytdUsed / a.ytdAllowed) * 100) : a.ytdUsed > 0 ? 100 : 0;
          const isOver = a.ytdUsed > a.ytdAllowed + 1e-9;
          const max = Math.max(1, ...a.months.map((m) => Math.max(m.used ?? 0, m.allowed)));
          return (
            <li key={a.area_id} className="pa-row" data-testid="pa-row" data-area={a.area_id} data-over={isOver || undefined}>
              <div className="pa-head">
                <b>{a.area_id}</b>
                <span className="pa-ytd" data-testid="pa-ytd">{t('{u} of {al} h', { u: fmtH(a.ytdUsed), al: fmtH(a.ytdAllowed) })}{isOver && <span className="pa-over"> · {t('{h} h over', { h: fmtH(a.ytdUsed - a.ytdAllowed) })}</span>}</span>
                <span className="muted pa-year">{t('{h} h allowed in {y}', { h: fmtH(a.allowance), y: year })}</span>
                <button type="button" className="dcard-open pa-open" onClick={() => onOpenRows(t('Planned stops of {a} {s} {y}', { a: a.area_id, s: span, y: year }), a.rowIds)} disabled={!a.rowIds.length}
                  aria-label={t('Open {n} records: planned stops of {a}', { n: num(a.rowIds.length), a: a.area_id })} data-testid="pa-open">
                  {t('Open records')} <span aria-hidden="true">›</span>
                </button>
              </div>
              <span className={isOver ? 'pa-meter pa-meter--over' : 'pa-meter'} aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
              <div className="pa-months" role="img" aria-label={a.months.map((m) => `${MONTHS[m.month - 1]}: ${m.used === null ? t('no data') : `${fmtH(m.used)} h`} ${t('of {h} h', { h: fmtH(m.allowed) })}${m.overhaul ? ` (${t('overhaul')})` : ''}`).join('; ')}>
                {a.months.map((m) => (
                  <span key={m.month} className={`pa-m${m.overhaul ? ' pa-m--oh' : ''}`} title={`${MONTHS[m.month - 1]}: ${m.used === null ? '–' : fmtH(m.used)} / ${fmtH(m.allowed)} h`}>
                    <span className="pa-m-bars" style={{ '--allowed': `${(m.allowed / max) * 100}%` } as CSSProperties}>
                      {m.used !== null && <span className={m.over ? 'pa-m-used pa-m-used--over' : 'pa-m-used'} style={{ height: `${Math.max(2, (m.used / max) * 100)}%` }} />}
                      <span className="pa-m-line" />
                    </span>
                    <small>{MONTHS[m.month - 1]}{m.overhaul && <Icon name="tool" size={11} />}</small>
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </DashCard>
  );
}
