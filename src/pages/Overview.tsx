import { useMemo, useState } from 'react';
import type { AreaKpis, Metric } from '../calc';
import { PhoneBar } from '../dashboard/PhoneBar';
import { ChartCard } from '../charts/ChartKit';
import CartesianChart, { seriesTable, type CartCategory, type CartSeries } from '../charts/CartesianChart';
import HBars, { type HRow } from '../charts/HBars';
import { MARKERS, STACK_COLORS, seriesColor } from '../charts/palette';
import { PageHeader, Tile } from '../components/Tile';
import { ChangeLine, dayLabel, fh, fh2, fint, fpct, metricText, monthLabel, rangeLabel } from '../dashboard/format';
import FilterBar, { MultiPick } from '../dashboard/FilterBar';
import { monthly, overviewModel } from '../dashboard/models';
import { Collapsible, DashStatus, NoData, rowsInRange, useDrill } from '../dashboard/parts';
import { useDash } from '../dashboard/useDash';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useTheme } from '../theme/ThemeContext';
import '../components/ui.css';
import '../dashboard/dashboard.css';

const BASIS_NAME = { A: 'calendar', B: 'calendar minus planned', C: 'minus planned and other' } as const;

function Kpi({ id, icon, label, value, sub, change, tone, unavailable }: {
  id: string; icon: string; label: string; value: string; sub?: React.ReactNode; change?: React.ReactNode; tone?: string; unavailable?: boolean;
}) {
  return (
    <Tile
      icon={icon} label={label} testid={`kpi-${id}`} tone={tone}
      value={<span data-testid={`kpi-${id}-value`} style={unavailable ? { fontSize: 17 } : undefined}>{value}</span>}
      sub={<>{sub && <span className="kpi-sub">{sub}</span>}{change}</>}
    />
  );
}

function sumNote(m: Metric, fmt: (n: number) => string, unit: string): string {
  const x = metricText(m, fmt, unit);
  return x.reason && x.unavailable ? x.reason : '';
}

export default function Overview() {
  const dash = useDash();
  const { ctx } = dash;
  const { T, dark } = useTheme();
  const drill = useDrill(dash, 'Overview');
  const model = useMemo(() => (ctx ? overviewModel(ctx) : null), [ctx]);
  const rows = useMemo(() => (ctx ? rowsInRange(ctx.scope, ctx.win.range) : null), [ctx]);
  const kpi = model?.kpi ?? null;
  const settings = ctx?.master.settings;
  const basis = settings?.availabilityBasis ?? 'B';
  const cmpLabel = ctx ? (ctx.win.compare === 'same_period_last_year' ? t('vs same period last year') : t('vs previous period')) : '';

  const subtitle = !ctx || !model
    ? t('Loading…')
    : kpi
      ? t('{hours} area-hours stopped · {failures} failures · availability {a} (basis {b}) · {range}', {
        hours: fh(kpi.total.downtimeHours), failures: fint(kpi.total.failureCount),
        a: metricText(kpi.total.availabilityHeadline, fpct).text, b: basis, range: rangeLabel(kpi.window),
      })
      : model.noDataReason ?? '';

  // ---- charts data
  const months = model?.monthly ?? [];
  const cats: CartCategory[] = months.map((m) => ({ key: m.month, label: monthLabel(m.month), partial: m.partial, note: m.partial && m.window ? t('Partial month: data to {d}', { d: dayLabel(m.window.to) }) : undefined }));
  const missing = months.map((m) => (m.hasData ? undefined : t('No data for this month')));
  const stackSeries: CartSeries[] = [
    { key: 'failure', label: t('Failure (INC)'), color: STACK_COLORS.failure, type: 'bar', stack: 's', values: months.map((m) => (m.hasData ? m.failureHours : null)), format: (n) => `${fh(n)} h`, missing },
    { key: 'planned', label: t('Planned (PL)'), color: STACK_COLORS.planned, type: 'bar', stack: 's', values: months.map((m) => (m.hasData ? m.plannedHours : null)), format: (n) => `${fh(n)} h`, missing },
    { key: 'other', label: t('Other (CIR)'), color: STACK_COLORS.other, type: 'bar', stack: 's', values: months.map((m) => (m.hasData ? m.otherHours : null)), format: (n) => `${fh(n)} h`, missing },
  ];
  const failHours: CartSeries = { key: 'fh', label: t('Failure hours'), color: STACK_COLORS.failure, type: 'bar', values: months.map((m) => (m.hasData ? m.failureHours : null)), format: (n) => `${fh(n)} h`, missing };
  const failCount: CartSeries = { key: 'fc', label: t('Failure count'), color: 'var(--tk-text-primary)', type: 'bar', values: months.map((m) => (m.hasData ? m.failureCount : null)), format: (n) => fint(n), missing };
  const peak = months.reduce((b, m) => (m.hasData && m.failureHours + m.plannedHours + m.otherHours > b.v ? { v: m.failureHours + m.plannedHours + m.otherHours, m: m.month } : b), { v: -1, m: '' });
  const stackSummary = months.some((m) => m.hasData)
    ? t('{n} months. Highest month {m}: {v} h stopped. Failure {f} h, planned {p} h, other {o} h in total.', {
      n: months.length, m: peak.m ? monthLabel(peak.m) : '-', v: fh(Math.max(0, peak.v)),
      f: fh(months.reduce((s, m) => s + m.failureHours, 0)), p: fh(months.reduce((s, m) => s + m.plannedHours, 0)), o: fh(months.reduce((s, m) => s + m.otherHours, 0)),
    })
    : t('No monthly data in this range.');

  const legendStack = [
    { label: t('Failure (INC)'), color: STACK_COLORS.failure },
    { label: t('Planned (PL)'), color: STACK_COLORS.planned },
    { label: t('Other (CIR)'), color: STACK_COLORS.other },
  ];

  const perArea = model?.perArea ?? [];
  const opRows: HRow[] = perArea.map((a) => ({
    key: a.area_id, label: a.area_id,
    segments: [
      { key: 'op', label: t('Operating'), color: STACK_COLORS.operating, value: a.operatingHours.available ? a.operatingHours.value : 0 },
      { key: 'pl', label: t('Planned'), color: STACK_COLORS.planned, value: a.plannedHours },
      { key: 'inc', label: t('Failure'), color: STACK_COLORS.failure, value: a.failureHours },
      { key: 'cir', label: t('Other'), color: STACK_COLORS.other, value: a.otherHours },
    ],
    note: t('Scheduled {h} h in the window', { h: fh(a.scheduledHours) }),
  }));
  const downRows: HRow[] = [...perArea]
    .sort((a, b) => b.downtimeHours - a.downtimeHours)
    .map((a) => ({
      key: a.area_id, label: a.area_id,
      segments: [
        { key: 'inc', label: t('Failure'), color: STACK_COLORS.failure, value: a.failureHours },
        { key: 'pl', label: t('Planned'), color: STACK_COLORS.planned, value: a.plannedHours },
        { key: 'cir', label: t('Other'), color: STACK_COLORS.other, value: a.otherHours },
      ],
    }));

  // ---- availability trend per area
  const areaOrder = ctx?.base.areaIds ?? [];
  const lowest = useMemo(
    () => [...perArea].filter((a) => a.availabilityHeadline.available).sort((a, b) => (a.availabilityHeadline as { value: number }).value - (b.availabilityHeadline as { value: number }).value).slice(0, 5).map((a) => a.area_id),
    [perArea],
  );
  const [picked, setPicked] = useState<string[] | null>(null);
  const trendAreas = (picked ?? (areaOrder.length <= 6 ? areaOrder : lowest)).filter((a) => areaOrder.includes(a)).sort((a, b) => areaOrder.indexOf(a) - areaOrder.indexOf(b)).slice(0, 8);
  const trend = useMemo(() => (ctx ? trendAreas.map((a) => ({ area: a, pts: monthly(ctx, a) })) : []), [ctx, trendAreas.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const trendSeries: CartSeries[] = trend.map((x, i) => ({
    key: x.area, label: x.area, color: seriesColor(dark, i), type: 'line', marker: MARKERS[i % MARKERS.length],
    values: x.pts.map((p) => (p.availability.available ? p.availability.value * 100 : null)),
    missing: x.pts.map((p) => (p.availability.available ? undefined : p.availability.reason)),
    format: (n) => `${n.toFixed(1)}%`,
  }));
  const target = settings?.availabilityTargetPct ?? null;
  const unavailMonths = trend.reduce((s, x) => s + x.pts.filter((p) => !p.availability.available).length, 0);

  const eventCount = rows ? rows.length : null;
  const openEvents = () => rows && drill(t('the Overview filters'), { rowIds: rows.map((r) => r.event_id) });

  // ---- KPI tiles
  const ch = model?.changes ?? null;
  const tot = kpi?.total;
  const redIf = (v: number | undefined): string | undefined => (v ? T.danger : undefined);
  const mtbfOne = perArea.length === 1;
  const mtbf = tot ? (mtbfOne ? metricText(perArea[0]!.mtbfHours, fh, ' h') : null) : null;
  const mttr = tot ? metricText(tot.mttrHours, fh2, ' h') : null;
  const avText = tot ? metricText(tot.availabilityHeadline, fpct) : null;

  const tiles = (
    <div className="kpi-grid" data-testid="kpi-grid">
      {!model || !ctx ? null : !kpi || !tot ? (
        <NoData reason={model.noDataReason ?? t('No data')} />
      ) : (
        <>
          <Kpi id="total-hours" icon="clock" label={t('Total stoppage hours')} value={`${fh(tot.downtimeHours)} h`} sub={t('area-hours: summed over {n} areas', { n: perArea.length })}
            change={<ChangeLine change={model.downtimeChange} fmt={fh} unit=" h" label={cmpLabel} />} />
          <Kpi id="failure-hours" icon="alert" label={t('Failure (INC) hours')} value={`${fh(tot.failureHours)} h`} sub={t('area-hours')} tone={redIf(tot.failureHours)}
            change={<ChangeLine change={ch?.failureHours ?? null} fmt={fh} unit=" h" label={cmpLabel} />} />
          <Kpi id="planned-hours" icon="calendar" label={t('Planned (PL) hours')} value={`${fh(tot.plannedHours)} h`} sub={t('area-hours')}
            change={<ChangeLine change={ch?.plannedHours ?? null} fmt={fh} unit=" h" label={cmpLabel} />} />
          <Kpi id="other-hours" icon="info" label={t('Other (CIR) hours')} value={`${fh(tot.otherHours)} h`} sub={t('circumstantial, area-hours')}
            change={<ChangeLine change={model.otherChange} fmt={fh} unit=" h" label={cmpLabel} />} />
          <Kpi id="failure-count" icon="tool" label={t('Failure count')} value={tot.failureCount === 0 ? t('None recorded') : fint(tot.failureCount)} unavailable={tot.failureCount === 0}
            sub={t('{n} failure events started in the window', { n: fint(tot.failureEventCount) })} change={<ChangeLine change={ch?.failureCount ?? null} fmt={fint} label={cmpLabel} />} />
          <Kpi id="operating-hours" icon="clock" label={t('Operating hours')} value={metricText(tot.operatingHours, fh, ' h').text} unavailable={!tot.operatingHours.available}
            sub={sumNote(tot.operatingHours, fh, ' h') || t('scheduled minus all stops, area-hours')} change={<ChangeLine change={ch?.operatingHours ?? null} fmt={fh} unit=" h" label={cmpLabel} />} />
          <Kpi id="availability" icon="compliance" label={t('Availability (basis {b})', { b: basis })} value={avText!.text} unavailable={avText!.unavailable}
            sub={<span data-testid="kpi-availability-abc">A {metricText(tot.availability.A, fpct).text} · B {metricText(tot.availability.B, fpct).text} · C {metricText(tot.availability.C, fpct).text}<br />{t(BASIS_NAME[basis])}</span>}
            change={<ChangeLine change={ch?.availability ?? null} fmt={(n) => (n * 100).toFixed(1)} unit=" pts" label={cmpLabel} />} />
          <Kpi id="mtbf" icon="trend" label={t('MTBF (area level)')} value={mtbf ? mtbf.text : t('Select one area')} unavailable={!mtbf || mtbf.unavailable || perArea.length !== 1}
            sub={mtbf ? mtbf.reason ?? t('operating hours per failure') : t('Per-area table below; the aggregate is not an MTBF')}
            change={mtbf ? <ChangeLine change={ch?.mtbfHours ?? null} fmt={fh} unit=" h" label={cmpLabel} /> : undefined} />
          <Kpi id="mttr" icon="repeat" label={t('Mean restoration time')} value={mttr!.text} unavailable={mttr!.unavailable}
            sub={mttr!.reason ?? t('mean duration of failure events')} change={<ChangeLine change={ch?.mttrHours ?? null} fmt={fh2} unit=" h" label={cmpLabel} />} />
          <Kpi id="repeated" icon="repeat" label={t('Repeated failures')} value={kpi.repeatedFailureCount === 0 ? t('None recorded') : fint(kpi.repeatedFailureCount)} unavailable={kpi.repeatedFailureCount === 0}
            sub={t('{g} groups; recurrence events after the first', { g: fint(kpi.repeatGroups) })} tone={redIf(kpi.repeatedFailureCount)} change={<ChangeLine change={model.repeatedChange} fmt={fint} label={cmpLabel} />} />
          <Kpi id="top-area" icon="limits" label={t('Highest downtime contributor')}
            value={kpi.topArea.available ? (kpi.topArea.areaId ?? '-') : t('None recorded')} unavailable={!kpi.topArea.available}
            sub={kpi.topArea.available
              ? <>{fh(kpi.topArea.value)} h failure · {fpct((kpi.topArea.sharePct ?? 0) / 100)} of failure hours{kpi.topEquipmentByHours.available && <><br />{t('Equipment')} {kpi.topEquipmentByHours.code}: {fh(kpi.topEquipmentByHours.value)} h</>}</>
              : kpi.topArea.reason} />
          <Kpi id="top-equipment" icon="equipment" label={t('Most frequent failing equipment')}
            value={kpi.mostFrequentEquipment.available ? (kpi.mostFrequentEquipment.code ?? '-') : t('None recorded')} unavailable={!kpi.mostFrequentEquipment.available}
            sub={kpi.mostFrequentEquipment.available ? t('{n} failures (own-stop rule)', { n: fint(kpi.mostFrequentEquipment.count ?? 0) }) : kpi.mostFrequentEquipment.reason} />
        </>
      )}
    </div>
  );

  const areaTable = kpi && (
    <section className="card" data-testid="area-table-card">
      <h2>{t('By area')}</h2>
      <p className="chart-sub" style={{ marginBottom: 8 }}>{t('MTBF is an area-level figure; the aggregate above is shown in area-hours and never averaged.')}</p>
      <div className="table-wrap">
        <table className="data-table" data-testid="area-table">
          <thead>
            <tr>
              <th scope="col">{t('Area')}</th><th scope="col" className="num">{t('Stopped h')}</th><th scope="col" className="num">{t('Failures')}</th>
              <th scope="col" className="num">{t('Operating h')}</th><th scope="col" className="num">{t('Avail. {b}', { b: basis })}</th>
              <th scope="col" className="num">{t('MTBF h')}</th><th scope="col" className="num">{t('MTTR h')}</th>
            </tr>
          </thead>
          <tbody>
            {perArea.map((a: AreaKpis) => (
              <tr key={a.area_id} data-testid="area-row" data-area={a.area_id}>
                <th scope="row" className="mono" style={{ textAlign: 'left' }}>{a.area_id}</th>
                <td className="num">{fh(a.downtimeHours)}</td>
                <td className="num">{fint(a.failureCount)}</td>
                <td className="num">{metricText(a.operatingHours, fh).text}</td>
                <td className="num">{metricText(a.availabilityHeadline, fpct).text}</td>
                <td className="num" title={metricText(a.mtbfHours, fh).reason}>{metricText(a.mtbfHours, fh).text}</td>
                <td className="num" title={metricText(a.mttrHours, fh2).reason}>{metricText(a.mttrHours, fh2).text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="page dash-page" data-testid="page-overview">
      <PageHeader
        title={t('Overview')}
        subtitle={subtitle}
        right={(
          <>
            {rows && rows.length > 0 && <button type="button" className="btn btn-sm" onClick={openEvents} data-testid="open-events"><Icon name="list" size={14} /> {t('Open {n} events', { n: fint(rows.length) })}</button>}
            <button type="button" className="btn btn-sm" onClick={dash.reload} disabled={dash.data.state.refreshing || dash.data.state.loading} data-testid="refresh"><Icon name="sync" size={14} /> {dash.data.state.refreshing ? t('Refreshing…') : t('Refresh')}</button>
          </>
        )}
      />
      <DashStatus dash={dash} />
      <PhoneBar>
        {kpi && tot ? (
          <>
            <b>{fh(tot.downtimeHours)} h</b> {t('stopped')}
            <span><span aria-hidden="true">◆</span> {tot.failureCount === 0 ? t('no failures') : t('{n} failures', { n: fint(tot.failureCount) })}</span>
            <span><span aria-hidden="true">●</span> {metricText(tot.availabilityHeadline, fpct).text}</span>
          </>
        ) : <>{subtitle}</>}
      </PhoneBar>
      <FilterBar dash={dash} eventCount={eventCount} />
      {ctx && model && !kpi && <NoData reason={model.noDataReason ?? t('No data')} />}
      {kpi && (
        <>
          <Collapsible title={t('Key figures')} defaultOpen testid="sec-kpis">{tiles}</Collapsible>
          <Collapsible title={t('Monthly stoppage hours')} defaultOpen testid="sec-monthly">
            <div className="chart-grid">
              <ChartCard
                title={t('Monthly stoppage hours')} subtitle={t('Failure, planned and other hours per month, summed over areas (area-hours). * partial month')}
                summary={stackSummary} legend={legendStack} testid="chart-monthly-stack"
                table={seriesTable(cats, stackSeries, t('Month'), (_s, n) => `${fh(n)}`)}
                footnote={months.some((m) => m.partial) ? t('Months with * are only partly covered by data; they are outlined with a dashed line.') : undefined}
              >
                {(w) => <CartesianChart categories={cats} series={stackSeries} width={w} ariaLabel={t('Stacked bar chart of monthly stoppage hours. {s}', { s: stackSummary })} yFormat={(n) => `${n}`} />}
              </ChartCard>
              <ChartCard
                title={t('Failure hours and failure count by month')} subtitle={t('Two charts with the same months, one above the other')}
                summary={t('{h} failure hours and {c} failures across {n} months.', { h: fh(months.reduce((s, m) => s + m.failureHours, 0)), c: fint(months.reduce((s, m) => s + m.failureCount, 0)), n: months.length })}
                legend={[{ label: t('Failure hours'), color: STACK_COLORS.failure }, { label: t('Failure count'), color: 'var(--tk-text-primary)' }]} testid="chart-monthly-aligned"
                table={seriesTable(cats, [failHours, failCount], t('Month'), (s, n) => (s.key === 'fh' ? fh(n) : fint(n)))}
              >
                {(w) => (
                  <>
                    <CartesianChart categories={cats} series={[failHours]} width={w} height={170} marginLeft={52} ariaLabel={t('Bar chart of monthly failure hours')} />
                    <CartesianChart categories={cats} series={[failCount]} width={w} height={170} marginLeft={52} ariaLabel={t('Bar chart of monthly failure count')} />
                  </>
                )}
              </ChartCard>
            </div>
          </Collapsible>
          <Collapsible title={t('Areas')} testid="sec-areas">
            <div className="chart-grid">
              <ChartCard
                title={t('Operating and stopped hours per area')} subtitle={t('Scheduled time in the window, split into operating and stopped hours (area-hours per area)')}
                summary={t('{n} areas. Operating {o} h, stopped {s} h in total.', { n: perArea.length, o: fh(perArea.reduce((s, a) => s + (a.operatingHours.available ? a.operatingHours.value : 0), 0)), s: fh(perArea.reduce((s, a) => s + a.downtimeHours, 0)) })}
                legend={[{ label: t('Operating'), color: STACK_COLORS.operating }, { label: t('Planned'), color: STACK_COLORS.planned }, { label: t('Failure'), color: STACK_COLORS.failure }, { label: t('Other'), color: STACK_COLORS.other }]}
                table={{ head: [t('Area'), t('Operating h'), t('Planned h'), t('Failure h'), t('Other h')], rows: opRows.map((r) => [r.label, ...r.segments.map((s) => fh(s.value))]) }} testid="chart-operating"
              >
                {(w) => <HBars rows={opRows} width={w} format={(n) => `${fh(n)} h`} ariaLabel={t('Stacked bars of operating and stopped hours per area')} />}
              </ChartCard>
              <ChartCard
                title={t('Downtime by area')} subtitle={t('Stopped hours per area, largest first')}
                summary={downRows.length ? t('Largest: {a} with {h} h stopped.', { a: downRows[0]!.label, h: fh(downRows[0]!.segments.reduce((s, x) => s + x.value, 0)) }) : t('No downtime in this range.')}
                legend={legendStack}
                table={{ head: [t('Area'), t('Failure h'), t('Planned h'), t('Other h')], rows: downRows.map((r) => [r.label, ...r.segments.map((s) => fh(s.value))]) }} testid="chart-downtime-area"
              >
                {(w) => <HBars rows={downRows} width={w} format={(n) => `${fh(n)} h`} ariaLabel={t('Stacked bars of downtime hours by area')} />}
              </ChartCard>
            </div>
          </Collapsible>
          <Collapsible title={t('Availability trend')} testid="sec-trend">
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
            {areaTable}
          </Collapsible>
        </>
      )}
    </div>
  );
}
