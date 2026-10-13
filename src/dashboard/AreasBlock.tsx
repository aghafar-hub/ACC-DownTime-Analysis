// "Areas": the availability trend per area and the by-area table. Shown at the top of the Reliability page.
import { useMemo, useState } from 'react';
import type { AreaKpis } from '../calc';
import { ChartCard } from '../charts/ChartKit';
import CartesianChart, { seriesTable, type CartCategory, type CartSeries } from '../charts/CartesianChart';
import { MARKERS, seriesColor } from '../charts/palette';
import { t } from '../i18n/t';
import { useTheme } from '../theme/ThemeContext';
import { MultiPick } from './FilterBar';
import { dayLabel, fh, fh2, fint, fpct, metricText, monthLabel } from './format';
import { monthly } from './models';
import AreaReliabilityCharts from './AreaReliabilityCharts';
import { TargetCell } from './TargetStatus';
import { anyTarget, areaTargetStatuses, getTargets } from './targets';
import type { DashCtx } from './scope';

export default function AreasBlock({ ctx, onOpen }: { ctx: DashCtx; onOpen?: (label: string, eventIds: string[]) => void }) {
  const { dark } = useTheme();
  const kpi = ctx.kpis.current.status === 'ok' ? ctx.kpis.current : null;
  const perArea: AreaKpis[] = kpi?.areas ?? [];
  const settings = ctx.master.settings;
  const basis = settings.availabilityBasis;
  const target = settings.availabilityTargetPct ?? null;
  const areaOrder = ctx.base.areaIds;
  const targets = getTargets(settings);
  const statuses = useMemo(() => areaTargetStatuses(perArea, targets), [perArea, targets.availabilityPct, targets.mtbfH, targets.mttrH]); // eslint-disable-line react-hooks/exhaustive-deps

  const months = useMemo(() => monthly(ctx), [ctx]);
  const cats: CartCategory[] = months.map((m) => ({ key: m.month, label: monthLabel(m.month), partial: m.partial, note: m.partial && m.window ? t('Partial month: data to {d}', { d: dayLabel(m.window.to) }) : undefined }));

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
    <section data-testid="areas-block" aria-labelledby="areas-heading">
      <h2 className="dash-section-title" id="areas-heading">{t('Areas')}</h2>
      <ChartCard
        title={t('Availability trend per area (basis {b})', { b: basis })} subtitle={t('Monthly availability, up to 8 areas; months without data are gaps')}
        summary={trendSeries.length ? t('{n} areas shown.{u}{tg}', { n: trendSeries.length, u: unavailMonths ? ` ${t('{m} area-months unavailable (gaps).', { m: unavailMonths })}` : '', tg: target !== null ? ` ${t('Target {x}%.', { x: target })}` : '' }) : t('No area selected.')}
        legend={[...trendSeries.map((s, i) => ({ label: s.label, color: s.color, symbol: MARKERS[i % MARKERS.length]! })), ...(target !== null ? [{ label: t('Target {x}%', { x: target }), color: 'var(--tk-text-primary)', symbol: 'dash' as const }] : [])]}
        controls={<div style={{ minWidth: 190 }}><MultiPick id="trend-areas" label={t('Areas in the chart')} testid="trend-areas" allLabel={t('Default areas')} options={areaOrder.map((a) => ({ value: a, label: a }))} value={picked ?? []} onChange={(v) => setPicked(v.length ? v : null)} /></div>}
        table={seriesTable(cats, trendSeries, t('Month'), (_s, n) => `${n.toFixed(1)}%`)} testid="chart-availability"
      >
        {(w) => (
          <CartesianChart
            categories={cats} series={trendSeries} width={w} height={280} zeroBased={false} yMax={100} yFormat={(n) => `${n}%`}
            refLines={target !== null ? [{ value: target, label: t('Target {x}%', { x: target }) }] : []}
            ariaLabel={t('Line chart of monthly availability per area')}
          />
        )}
      </ChartCard>
      {kpi && (
        <section className="card" data-testid="area-table-card">
          <h2>{t('By area')}</h2>
          <p className="chart-sub" style={{ marginBottom: 8 }}>{t('MTBF is an area-level figure; the aggregate is shown in area-hours and never averaged.')}{anyTarget(targets) ? ` ${t('Status columns compare each area with the targets set in Settings; an area without a figure has no status.')}` : ''}</p>
          <div className="table-wrap">
            <table className="data-table" data-testid="area-table">
              <thead>
                <tr>
                  <th scope="col">{t('Area')}</th><th scope="col" className="num">{t('Stopped h')}</th><th scope="col" className="num">{t('Failures')}</th>
                  <th scope="col" className="num">{t('Operating h')}</th><th scope="col" className="num">{t('Avail. {b}', { b: basis })}</th>
                  {targets.availabilityPct !== null && <th scope="col">{t('Availability status')}</th>}
                  <th scope="col" className="num">{t('MTBF h')}</th>
                  {targets.mtbfH !== null && <th scope="col">{t('MTBF status')}</th>}
                  <th scope="col" className="num">{t('MTTR h')}</th>
                  {targets.mttrH !== null && <th scope="col">{t('MTTR status')}</th>}
                </tr>
              </thead>
              <tbody>
                {perArea.map((a) => (
                  <tr key={a.area_id} data-testid="area-row" data-area={a.area_id}>
                    <th scope="row" className="mono" style={{ textAlign: 'left' }}>{a.area_id}</th>
                    <td className="num">{fh(a.downtimeHours)}</td>
                    <td className="num">{fint(a.failureCount)}</td>
                    <td className="num">{metricText(a.operatingHours, fh).text}</td>
                    <td className="num">{metricText(a.availabilityHeadline, fpct).text}</td>
                    {targets.availabilityPct !== null && <td><TargetCell status={statuses.get(a.area_id)?.availability} testid="status-availability" /></td>}
                    <td className="num" title={metricText(a.mtbfHours, fh).reason}>{metricText(a.mtbfHours, fh).text}</td>
                    {targets.mtbfH !== null && <td><TargetCell status={statuses.get(a.area_id)?.mtbf} testid="status-mtbf" /></td>}
                    <td className="num" title={metricText(a.mttrHours, fh2).reason}>{metricText(a.mttrHours, fh2).text}</td>
                    {targets.mttrH !== null && <td><TargetCell status={statuses.get(a.area_id)?.mttr} testid="status-mttr" /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {kpi && <AreaReliabilityCharts ctx={ctx} onOpen={onOpen} />}
    </section>
  );
}
