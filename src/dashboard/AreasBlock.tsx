// "Areas": the By area table (running, stopped and failure hours, failures, availability, MTBF and MTTR with the
// target status; Stopped h, Failure h and Failures open their split by classification), the area charts and, folded
// because the Dashboard has them, the availability trend per area. Shown at the top of the Reliability page.
import { useMemo, useState } from 'react';
import type { AreaKpis } from '../calc';
import { ChartCard } from '../charts/ChartKit';
import CartesianChart, { seriesTable, type CartCategory, type CartSeries } from '../charts/CartesianChart';
import { MARKERS, seriesColor } from '../charts/palette';
import { t } from '../i18n/t';
import { useTheme } from '../theme/ThemeContext';
import ChartInfo from '../help/ChartInfo';
import AlsoOnDashboard from './AlsoOnDashboard';
import { areaBreakdowns } from './areaBreakdown';
import BreakdownCell from './BreakdownCell';
import { MultiPick } from './FilterBar';
import { fh, fh2, fint, fpct, metricText, monthAxisLabels, monthLabel, partialNote } from './format';
import { monthly } from './models';
import AreaReliabilityCharts from './AreaReliabilityCharts';
import { TargetCell } from './TargetStatus';
import { anyTarget, areaTargetStatuses, getTargets, type TargetStatus } from './targets';
import { useAreaTargetMap } from './useAreaTargetMap';
import type { DashCtx } from './scope';

export default function AreasBlock({ ctx, onOpen }: { ctx: DashCtx; onOpen?: (label: string, eventIds: string[]) => void }) {
  const kpi = ctx.kpis.current.status === 'ok' ? ctx.kpis.current : null;
  const perArea: AreaKpis[] = kpi?.areas ?? [];
  const settings = ctx.master.settings;
  const basis = settings.availabilityBasis;
  const targets = getTargets(settings);
  const ownTargets = useAreaTargetMap(ctx);
  const statuses = useMemo(() => areaTargetStatuses(perArea, targets, ownTargets), [perArea, ownTargets, targets.availabilityPct, targets.mtbfH, targets.mttrH]); // eslint-disable-line react-hooks/exhaustive-deps

  const breakdown = useMemo(() => (kpi ? areaBreakdowns({
    rows: ctx.scope.kpiRows, failureChains: ctx.scope.failureChains, window: kpi.window, attribution: ctx.scope.attribution, areaIds: kpi.areas.map((a) => a.area_id),
  }) : null), [ctx, kpi]);
  const exArea = perArea.find((a) => a.mtbfHours.available && a.operatingHours.available);
  const tableHelp = {
    id: 'area-table' as const,
    vars: exArea && exArea.mtbfHours.available && exArea.operatingHours.available ? {
      b: basis, a: exArea.area_id, T: fh(exArea.scheduledHours), s: fh(exArea.downtimeHours), o: fh(exArea.operatingHours.value), n: fint(exArea.failureCount), mtbf: fh(exArea.mtbfHours.value),
    } : { b: basis },
  };
  // the value and, when a target is set, its status (symbol + words, never colour alone) in one cell
  const withStatus = (text: string, on: boolean, st: TargetStatus | null | undefined, testid: string, reason?: string) => (
    <td className="num" title={reason}>
      {on ? <span className="num-status"><span>{text}</span><TargetCell status={st} testid={testid} /></span> : text}
    </td>
  );

  return (
    <section data-testid="areas-block" aria-labelledby="areas-heading">
      <h2 className="dash-section-title" id="areas-heading">{t('Areas')}</h2>
      {kpi && (
        <section className="card" data-testid="area-table-card">
          <div className="card-title-row"><h2>{t('By area')}</h2><ChartInfo help={tableHelp} title={t('By area')} /></div>
          <p className="chart-sub" style={{ marginBottom: 8 }}>{t('MTBF is an area-level figure; the aggregate is shown in area-hours and never averaged.')} {t('Point at, tap or press Enter on Stopped h, Failure h or Failures for the split by classification.')}{anyTarget(targets) ? ` ${t('Availability, MTBF and MTTR show their status against the targets set in Settings; an area without a figure has no status.')}` : ''}</p>
          <div className="table-wrap">
            <table className="data-table area-table" data-testid="area-table">
              <thead>
                <tr>
                  <th scope="col">{t('Area')}</th>
                  <th scope="col" className="num">{t('Operating h')}</th>
                  <th scope="col" className="num">{t('Stopped h')}</th>
                  <th scope="col" className="num">{t('Failure h')}</th>
                  <th scope="col" className="num">{t('Failures')}</th>
                  <th scope="col" className="num">{t('Availability ({b})', { b: basis })}</th>
                  <th scope="col" className="num">{t('MTBF h')}</th>
                  <th scope="col" className="num">{t('MTTR h')}</th>
                </tr>
              </thead>
              <tbody>
                {perArea.map((a) => {
                  const bd = breakdown?.get(a.area_id);
                  const st = statuses.get(a.area_id);
                  return (
                    <tr key={a.area_id} data-testid="area-row" data-area={a.area_id}>
                      <th scope="row" className="mono" style={{ textAlign: 'left' }}>{a.area_id}</th>
                      <td className="num" data-testid="area-operating">{metricText(a.operatingHours, fh).text}</td>
                      <td className="num">{bd ? <BreakdownCell split={bd.stoppedHours} text={fh(bd.stoppedHours.total)} decimals={1} unit="h" title={t('Stopped h of {a}', { a: a.area_id })} testid="area-stopped" /> : fh(a.downtimeHours)}</td>
                      <td className="num">{bd ? <BreakdownCell split={bd.failureHours} text={fh(bd.failureHours.total)} decimals={1} unit="h" title={t('Failure h of {a}', { a: a.area_id })} testid="area-failure-hours" /> : '–'}</td>
                      <td className="num">{bd ? <BreakdownCell split={bd.failures} text={fint(bd.failures.total)} decimals={0} unit="" title={t('Failures of {a}', { a: a.area_id })} testid="area-failures" /> : fint(a.failureCount)}</td>
                      {withStatus(metricText(a.availabilityHeadline, fpct).text, targets.availabilityPct !== null, st?.availability, 'status-availability')}
                      {withStatus(metricText(a.mtbfHours, fh).text, targets.mtbfH !== null, st?.mtbf, 'status-mtbf', metricText(a.mtbfHours, fh).reason)}
                      {withStatus(metricText(a.mttrHours, fh2).text, targets.mttrH !== null, st?.mttr, 'status-mttr', metricText(a.mttrHours, fh2).reason)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {kpi && <AreaReliabilityCharts ctx={ctx} onOpen={onOpen} />}
      <AlsoOnDashboard title={t('Availability trend per area (basis {b})', { b: basis })} testid="dup-area-trend">
        <AreaTrendChart ctx={ctx} perArea={perArea} />
      </AlsoOnDashboard>
    </section>
  );
}

/** The monthly availability of up to 8 areas (folded: the Dashboard heat map shows the same); built only when opened. */
function AreaTrendChart({ ctx, perArea }: { ctx: DashCtx; perArea: AreaKpis[] }) {
  const { dark } = useTheme();
  const settings = ctx.master.settings;
  const basis = settings.availabilityBasis;
  const target = settings.availabilityTargetPct ?? null;
  const areaOrder = ctx.base.areaIds;
  const months = useMemo(() => monthly(ctx), [ctx]);
  const cats: CartCategory[] = months.map((m, i, all) => ({ key: m.month, label: monthAxisLabels(all.map((x) => x.month))[i]!, full: monthLabel(m.month), partial: m.partial, note: partialNote(m) }));

  const lowest = useMemo(
    () => [...perArea].filter((a) => a.availabilityHeadline.available).sort((a, b) => (a.availabilityHeadline as { value: number }).value - (b.availabilityHeadline as { value: number }).value).slice(0, 5).map((a) => a.area_id),
    [perArea],
  );
  const [picked, setPicked] = useState<string[] | null>(null);
  const trendAreas = (picked ?? (areaOrder.length <= 6 ? areaOrder : lowest)).filter((a) => areaOrder.includes(a)).sort((a, b) => areaOrder.indexOf(a) - areaOrder.indexOf(b)).slice(0, 8);
  const trend = useMemo(() => trendAreas.map((a) => ({ area: a, pts: monthly(ctx, a) })), [ctx, trendAreas.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const trendSeries: CartSeries[] = trend.map((x, i) => ({
    key: x.area, label: x.area, color: seriesColor(dark, i), type: 'line', marker: MARKERS[i % MARKERS.length],
    values: x.pts.map((p) => (p.availability.available ? p.availability.value * 100 : null)),
    missing: x.pts.map((p) => (p.availability.available ? undefined : p.availability.reason)),
    format: (n) => `${n.toFixed(1)}%`,
  }));
  const unavailMonths = trend.reduce((s, x) => s + x.pts.filter((p) => !p.availability.available).length, 0);
  return (
    <ChartCard
      title={t('Availability trend per area (basis {b})', { b: basis })} subtitle={t('Monthly availability, up to 8 areas; months without data are gaps')}
      summary={trendSeries.length ? t('{n} areas shown.{u}{tg}', { n: trendSeries.length, u: unavailMonths ? ` ${t('{m} area-months unavailable (gaps).', { m: unavailMonths })}` : '', tg: target !== null ? ` ${t('Target {x}%.', { x: target })}` : '' }) : t('No area selected.')}
      legend={[...trendSeries.map((s, i) => ({ label: s.label, color: s.color, symbol: MARKERS[i % MARKERS.length]! })), ...(target !== null ? [{ label: t('Target {x}%', { x: target }), color: 'var(--tk-text-primary)', symbol: 'dash' as const }] : [])]}
      controls={<div style={{ minWidth: 190 }}><MultiPick id="trend-areas" label={t('Areas in the chart')} testid="trend-areas" allLabel={t('Default areas')} options={areaOrder.map((a) => ({ value: a, label: a }))} value={picked ?? []} onChange={(v) => setPicked(v.length ? v : null)} /></div>}
      table={seriesTable(cats, trendSeries, t('Month'), (_s, n) => `${n.toFixed(1)}%`)} testid="chart-availability" help={{ id: 'area-trend', vars: { b: basis } }}
    >
      {(w) => (
        <CartesianChart
          categories={cats} series={trendSeries} width={w} height={280} zeroBased={false} yMax={100} yFormat={(n) => `${n}%`}
          refLines={target !== null ? [{ value: target, label: t('Target {x}%', { x: target }) }] : []}
          ariaLabel={t('Line chart of monthly availability per area')}
        />
      )}
    </ChartCard>
  );
}
