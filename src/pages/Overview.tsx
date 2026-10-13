import { useMemo, useState, type ReactNode } from 'react';
import type { Metric } from '../calc';
import { ChartCard } from '../charts/ChartKit';
import CartesianChart, { seriesTable, type CartCategory, type CartSeries } from '../charts/CartesianChart';
import HBars, { type HRow } from '../charts/HBars';
import { CLASS_ORDER, STACK_COLORS, classColor } from '../charts/palette';
import { Tile } from '../components/Tile';
import { useIsMobile } from '../hooks/useIsMobile';
import DashTop from '../dashboard/DashTop';
import { ChangeLine, dayLabel, dayShort, fh, fh2, fint, fpct, fpct0, metricText, monthLabel } from '../dashboard/format';
import { HeroKpi } from '../dashboard/HeroKpi';
import MonthCompare from '../dashboard/MonthCompare';
import { TargetLine } from '../dashboard/TargetStatus';
import { targetNumber } from '../dashboard/targets';
import { kpiInfo } from '../dashboard/kpiInfo';
import { zoomFloor } from '../charts/scale';
import { overviewModel, ROLLING_DAYS, sparkSeries, windowDays } from '../dashboard/models';
import { Collapsible, NoData, rowsInRange, useDrill } from '../dashboard/parts';
import { overviewTakeaway } from '../dashboard/takeaways';
import { useDash } from '../dashboard/useDash';
import { t } from '../i18n/t';
import SinceLastVisit from '../notifications/SinceLastVisit';
import { QualityCard } from '../validate/Quality';
import { Icon } from '../icons';
import { useTheme } from '../theme/ThemeContext';
import '../components/ui.css';
import '../dashboard/dashboard.css';

const BASIS_NAME = { A: 'calendar', B: 'calendar minus planned', C: 'minus planned and other' } as const;

function Kpi({ id, icon, label, value, sub, change, status, tone, unavailable, compact }: {
  id: string; icon: string; label: string; value: string; sub?: ReactNode; change?: ReactNode; status?: ReactNode; tone?: string; unavailable?: boolean; compact?: boolean;
}) {
  return (
    <Tile
      icon={icon} label={label} testid={`kpi-${id}`} tone={tone} compact={compact}
      value={<span data-testid={`kpi-${id}-value`} style={unavailable ? { fontSize: 17 } : undefined}>{value}</span>}
      sub={<>{status}{sub && <span className="kpi-sub">{sub}</span>}{change}</>}
    />
  );
}

function sumNote(m: Metric, fmt: (n: number) => string, unit: string): string {
  const x = metricText(m, fmt, unit);
  return x.reason && x.unavailable ? x.reason : '';
}

/** The secondary figures: open on a desktop, folded away on a phone. */
function MoreFigures({ children, count }: { children: ReactNode; count: number }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? !mobile;
  return (
    <section className="more-figures" data-testid="more-figures">
      <button type="button" className="more-head" aria-expanded={isOpen} aria-controls="more-figures-body" onClick={() => setOpen(!isOpen)} data-testid="more-figures-toggle">
        <span>{t('More figures')} <small>{t('{n} figures', { n: count })}</small></span>
        <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={16} />
      </button>
      {isOpen && <div className="more-grid" id="more-figures-body" data-testid="kpi-grid">{children}</div>}
    </section>
  );
}

export default function Overview() {
  const dash = useDash();
  const { ctx } = dash;
  const { T, dark } = useTheme();
  const mobile = useIsMobile();
  const drill = useDrill(dash, 'Overview');
  const model = useMemo(() => (ctx ? overviewModel(ctx) : null), [ctx]);
  const rows = useMemo(() => (ctx ? rowsInRange(ctx.scope, ctx.win.range) : null), [ctx]);
  const kpi = model?.kpi ?? null;
  const settings = ctx?.master.settings;
  const basis = settings?.availabilityBasis ?? 'B';
  const cmpMode = model?.compare ?? 'none';
  const cmpLabel = ctx ? (ctx.win.compare === 'same_period_last_year' ? t('vs same period last year') : t('vs previous period')) : '';

  const takeaway = !ctx || !model
    ? t('Loading…')
    : overviewTakeaway({
      kpi: kpi ? { downtimeHours: kpi.total.downtimeHours, topArea: kpi.topArea } : null,
      noDataReason: model.noDataReason, downtimeChange: model.downtimeChange, compare: cmpMode,
    });

  // ---- chart data
  const months = model?.monthly ?? [];
  const cats: CartCategory[] = months.map((m) => ({ key: m.month, label: monthLabel(m.month), partial: m.partial, note: m.partial && m.window ? t('Partial month: data to {d}', { d: dayLabel(m.window.to) }) : undefined }));
  const missing = months.map((m) => (m.hasData ? undefined : t('No data for this month')));
  const hfmt = (n: number) => `${fh(n)} h`;
  const stackSeries: CartSeries[] = [
    { key: 'failure', label: t('Failure (INC)'), color: STACK_COLORS.failure, type: 'bar', stack: 's', values: months.map((m) => (m.hasData ? m.failureHours : null)), format: hfmt, missing },
    { key: 'planned', label: t('Planned (PL)'), color: STACK_COLORS.planned, type: 'bar', stack: 's', values: months.map((m) => (m.hasData ? m.plannedHours : null)), format: hfmt, missing },
    { key: 'other', label: t('Other (CIR)'), color: STACK_COLORS.other, type: 'bar', stack: 's', values: months.map((m) => (m.hasData ? m.otherHours : null)), format: hfmt, missing },
  ];
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

  // (1) daily hours with the rolling average
  const days = model?.daily ?? [];
  const dcats: CartCategory[] = days.map((d) => ({ key: d.date, label: dayShort(d.date), note: dayLabel(d.date) }));
  const dmissing = days.map((d) => (d.hasData ? undefined : t('No data for this day')));
  const dailySeries: CartSeries[] = [
    { key: 'failure', label: t('Failure (INC)'), color: STACK_COLORS.failure, type: 'bar', stack: 'd', values: days.map((d) => (d.hasData ? d.failureHours : null)), format: hfmt, missing: dmissing },
    { key: 'planned', label: t('Planned (PL)'), color: STACK_COLORS.planned, type: 'bar', stack: 'd', values: days.map((d) => (d.hasData ? d.plannedHours : null)), format: hfmt, missing: dmissing },
    { key: 'other', label: t('Other (CIR)'), color: STACK_COLORS.other, type: 'bar', stack: 'd', values: days.map((d) => (d.hasData ? d.otherHours : null)), format: hfmt, missing: dmissing },
    { key: 'avg', label: t('{n}-day average (total)', { n: ROLLING_DAYS }), color: 'var(--tk-text-primary)', type: 'line', values: days.map((d) => d.rollingDowntimeHours), format: hfmt, missing: dmissing },
  ];
  const dataDays = days.filter((d) => d.hasData);
  const peakDay = dataDays.reduce<(typeof days)[number] | null>((b, d) => (!b || d.downtimeHours > b.downtimeHours ? d : b), null);
  const dailyTotal = dataDays.reduce((s, d) => s + d.downtimeHours, 0);
  const lastAvg = [...days].reverse().find((d) => d.rollingDowntimeHours !== null)?.rollingDowntimeHours ?? null;
  const dailySummary = peakDay
    ? t('{n} days. Highest day {d}: {v} h stopped. Average {a} h per day; the {k}-day average ends at {r} h.', {
      n: days.length, d: dayLabel(peakDay.date), v: fh(peakDay.downtimeHours), a: fh(dailyTotal / dataDays.length), k: ROLLING_DAYS, r: lastAvg === null ? '-' : fh(lastAvg),
    })
    : t('No daily data in this range.');

  // (3) monthly hours by classification
  const byClass = model?.byClass ?? [];
  const ccats: CartCategory[] = byClass.map((m) => ({ key: m.month, label: monthLabel(m.month), partial: m.partial, note: m.partial && m.window ? t('Partial month: data to {d}', { d: dayLabel(m.window.to) }) : undefined }));
  const cmissing = byClass.map((m) => (m.hasData ? undefined : t('No data for this month')));
  const classSeries: CartSeries[] = CLASS_ORDER.map((code) => ({
    key: code, label: code, color: classColor(dark, code), type: 'bar', stack: 'c', values: byClass.map((m) => (m.hasData ? m.hours[code] : null)), format: hfmt, missing: cmissing,
  }));
  const classTotals = CLASS_ORDER.map((code) => ({ code, h: byClass.reduce((s, m) => s + m.hours[code], 0) }));
  const classAll = classTotals.reduce((s, c) => s + c.h, 0);
  const topClass = [...classTotals].sort((a, b) => b.h - a.h)[0];
  const classNames = new Map((dash.startup?.classifications ?? []).map((c) => [c.code, c.name]));
  const classSummary = classAll > 0 && topClass
    ? t('{c} is the largest class: {v} h of {a} h stopped ({p}).', { c: topClass.code, v: fh(topClass.h), a: fh(classAll), p: fpct0((topClass.h / classAll) * 100) })
    : t('No stopped hours in this range.');

  // (4) downtime by area
  const perArea = model?.perArea ?? [];
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

  // (5) top 10 equipment by failure hours (own-stop rule)
  const top = model?.topEquipment ?? { bars: [], total: 0 };
  const blank = t('(blank code)');
  const eqRows: HRow[] = top.bars.map((b) => ({
    key: b.key, label: b.label.trim() ? b.label : blank,
    segments: [{ key: 'inc', label: t('Failure hours'), color: STACK_COLORS.failure, value: b.value }],
    note: t('{p} of the {h} h on own equipment', { p: fpct0(b.sharePct), h: fh(top.total) }),
  }));
  const eqShare = new Map(top.bars.map((b) => [b.key, b.sharePct]));
  const eqIds = new Map(top.bars.map((b) => [b.key, b.eventIds]));

  // (6) availability per area
  const av = model?.availability ?? null;
  const avAreas = av?.areas ?? [];
  const targets = model?.targets ?? { availabilityPct: null, mtbfH: null, mttrH: null };
  const belowIds = new Set(model?.belowTarget?.below ?? []);
  const avRows: HRow[] = avAreas.flatMap((a) => (a.availability.available
    ? [{
      key: a.area_id, label: a.area_id,
      segments: [{
        key: 'av', label: t('Availability (basis {b})', { b: basis }), value: a.availability.value * 100,
        // below the target: striped red bar (and a ▼ after the number); otherwise the plain bar
        color: belowIds.has(a.area_id) ? 'var(--tk-danger)' : 'var(--tk-accent)', hatch: belowIds.has(a.area_id),
      }],
    }]
    : []));
  const overall = av?.overall.available ? av.overall.value : null;
  // zoomed axis: from one point below the lowest value (areas and all-area line) up to 100%
  const avFloor = zoomFloor(Math.min(...avRows.map((r) => r.segments[0]!.value), ...(overall !== null ? [overall * 100] : []), ...(targets.availabilityPct !== null ? [targets.availabilityPct] : [])));
  const avNote = t('Axis starts at {n}%', { n: avFloor });
  const belowText = model?.belowTarget
    ? t('{n} of {m} areas below target ({x}%).', { n: model.belowTarget.below.length, m: model.belowTarget.total, x: targetNumber(targets.availabilityPct!) })
    : '';
  const avSummary = avRows.length
    ? t('{n} areas, lowest first. Lowest: {a} at {p}.{o}{b} {z}.', {
      n: avRows.length, a: avRows[0]!.label, p: `${avRows[0]!.segments[0]!.value.toFixed(1)}%`, o: overall !== null ? ` ${t('All areas together: {p}.', { p: fpct(overall) })}` : '', b: belowText ? ` ${belowText}` : '', z: avNote,
    })
    : t('No availability can be calculated for these areas.');

  const eventCount = rows ? rows.length : null;
  const openEvents = () => rows && drill(t('the Overview filters'), { rowIds: rows.map((r) => r.event_id) });

  // ---- KPIs
  const ch = model?.changes ?? null;
  const tot = kpi?.total;
  const redIf = (v: number | undefined): string | undefined => (v ? T.danger : undefined);
  const mtbfOne = perArea.length === 1;
  const mtbf = tot ? (mtbfOne ? metricText(perArea[0]!.mtbfHours, fh, ' h') : null) : null;
  const mttr = tot ? metricText(tot.mttrHours, fh2, ' h') : null;
  const avText = tot ? metricText(tot.availabilityHeadline, fpct) : null;
  const spark = ctx && model ? sparkSeries(model.daily, model.monthly, windowDays(ctx)) : null;
  const sparkOf = (values: (number | null)[], format: (n: number) => string) => ({ values, format, mode: spark?.mode ?? 'daily' });

  const hero = model && kpi && tot && spark && (
    <div className="hero-grid" data-testid="hero-kpis">
      <HeroKpi id="total-hours" label={t('Total stoppage hours')} shortLabel={t('Stoppage hours')} value={`${fh(tot.downtimeHours)} h`} sub={t('area-hours: summed over {n} areas', { n: perArea.length })}
        change={<ChangeLine change={model.downtimeChange} fmt={fh} unit=" h" label={cmpLabel} compare={cmpMode} />} info={kpiInfo('total-hours', basis)}
        spark={sparkOf(spark.downtimeHours, hfmt)} />
      <HeroKpi id="failure-count" label={t('Failure count')} shortLabel={t('Failures')} value={tot.failureCount === 0 ? t('None recorded') : fint(tot.failureCount)} unavailable={tot.failureCount === 0}
        sub={t('{n} failure events started in the window', { n: fint(tot.failureEventCount) })} change={<ChangeLine change={ch?.failureCount ?? null} fmt={fint} label={cmpLabel} compare={cmpMode} />}
        info={kpiInfo('failure-count', basis)} spark={sparkOf(spark.failureCount, fint)} />
      <HeroKpi id="availability" label={t('Availability (basis {b})', { b: basis })} shortLabel={t('Availability {b}', { b: basis })} value={avText!.text} unavailable={avText!.unavailable}
        sub={<span data-testid="kpi-availability-abc">A {metricText(tot.availability.A, fpct).text} · B {metricText(tot.availability.B, fpct).text} · C {metricText(tot.availability.C, fpct).text}<br />{t(BASIS_NAME[basis])}</span>}
        change={<ChangeLine change={ch?.availability ?? null} fmt={(n) => (n * 100).toFixed(1)} unit=" pts" label={cmpLabel} compare={cmpMode} />}
        info={kpiInfo('availability', basis, targets)} spark={sparkOf(spark.availability, fpct)}
        status={<TargetLine status={model.status.availability} testid="kpi-availability-target" />} />
      <HeroKpi id="mttr" label={t('Mean restoration time')} shortLabel={t('Restoration time')} value={mttr!.text} unavailable={mttr!.unavailable}
        sub={mttr!.reason ?? t('mean duration of failure events')} change={<ChangeLine change={ch?.mttrHours ?? null} fmt={fh2} unit=" h" label={cmpLabel} compare={cmpMode} />}
        info={kpiInfo('mttr', basis, targets)} spark={sparkOf(spark.mttrHours, (n) => `${fh2(n)} h`)}
        status={<TargetLine status={model.status.mttr} testid="kpi-mttr-target" />} />
    </div>
  );

  const more = model && kpi && tot && (
    <MoreFigures count={8}>
      <Kpi compact={mobile} id="failure-hours" icon="alert" label={t('Failure (INC) hours')} value={`${fh(tot.failureHours)} h`} sub={t('area-hours')} tone={redIf(tot.failureHours)}
        change={<ChangeLine change={ch?.failureHours ?? null} fmt={fh} unit=" h" label={cmpLabel} compare={cmpMode} />} />
      <Kpi compact={mobile} id="planned-hours" icon="calendar" label={t('Planned (PL) hours')} value={`${fh(tot.plannedHours)} h`} sub={t('area-hours')}
        change={<ChangeLine change={ch?.plannedHours ?? null} fmt={fh} unit=" h" label={cmpLabel} compare={cmpMode} />} />
      <Kpi compact={mobile} id="other-hours" icon="info" label={t('Other (CIR) hours')} value={`${fh(tot.otherHours)} h`} sub={t('circumstantial, area-hours')}
        change={<ChangeLine change={model.otherChange} fmt={fh} unit=" h" label={cmpLabel} compare={cmpMode} />} />
      <Kpi compact={mobile} id="operating-hours" icon="clock" label={t('Operating hours')} value={metricText(tot.operatingHours, fh, ' h').text} unavailable={!tot.operatingHours.available}
        sub={sumNote(tot.operatingHours, fh, ' h') || t('scheduled minus all stops, area-hours')} change={<ChangeLine change={ch?.operatingHours ?? null} fmt={fh} unit=" h" label={cmpLabel} compare={cmpMode} />} />
      <Kpi compact={mobile} id="mtbf" icon="trend" label={t('MTBF (area level)')} status={<TargetLine status={model.status.mtbf} testid="kpi-mtbf-target" />} value={mtbf ? mtbf.text : t('Select one area')} unavailable={!mtbf || mtbf.unavailable || perArea.length !== 1}
        sub={mtbf ? mtbf.reason ?? t('operating hours per failure') : t('Per-area MTBF is on the Reliability page; the aggregate is not an MTBF')}
        change={mtbf ? <ChangeLine change={ch?.mtbfHours ?? null} fmt={fh} unit=" h" label={cmpLabel} compare={cmpMode} /> : undefined} />
      <Kpi compact={mobile} id="repeated" icon="repeat" label={t('Repeated failures')} value={kpi.repeatedFailureCount === 0 ? t('None recorded') : fint(kpi.repeatedFailureCount)} unavailable={kpi.repeatedFailureCount === 0}
        sub={t('{g} groups; recurrence events after the first', { g: fint(kpi.repeatGroups) })} tone={redIf(kpi.repeatedFailureCount)} change={<ChangeLine change={model.repeatedChange} fmt={fint} label={cmpLabel} compare={cmpMode} />} />
      <Kpi compact={mobile} id="top-area" icon="limits" label={t('Highest downtime contributor')}
        value={kpi.topArea.available ? (kpi.topArea.areaId ?? '-') : t('None recorded')} unavailable={!kpi.topArea.available}
        sub={kpi.topArea.available
          ? <>{fh(kpi.topArea.value)} h failure · {fpct((kpi.topArea.sharePct ?? 0) / 100)} of failure hours{kpi.topEquipmentByHours.available && <><br />{t('Equipment')} {kpi.topEquipmentByHours.code}: {fh(kpi.topEquipmentByHours.value)} h</>}</>
          : kpi.topArea.reason} />
      <Kpi compact={mobile} id="top-equipment" icon="equipment" label={t('Most frequent failing equipment')}
        value={kpi.mostFrequentEquipment.available ? (kpi.mostFrequentEquipment.code ?? '-') : t('None recorded')} unavailable={!kpi.mostFrequentEquipment.available}
        sub={kpi.mostFrequentEquipment.available ? t('{n} failures (own-stop rule)', { n: fint(kpi.mostFrequentEquipment.count ?? 0) }) : kpi.mostFrequentEquipment.reason} />
    </MoreFigures>
  );

  return (
    <div className="page dash-page" data-testid="page-overview">
      <DashTop
        title={t('Overview')} takeaway={takeaway} dash={dash} eventCount={eventCount} belowTakeaway={<SinceLastVisit />}
        right={(
          <>
            {rows && rows.length > 0 && <button type="button" className="btn btn-sm" onClick={openEvents} data-testid="open-events"><Icon name="list" size={14} /> {t('Open {n} events', { n: fint(rows.length) })}</button>}
            <button type="button" className="btn btn-sm" onClick={dash.reload} disabled={dash.data.state.refreshing || dash.data.state.loading} data-testid="refresh"><Icon name="sync" size={14} /> {dash.data.state.refreshing ? t('Refreshing…') : t('Refresh')}</button>
          </>
        )}
      />
      {ctx && model && !kpi && <NoData reason={model.noDataReason ?? t('No data')} />}
      {kpi && (
        <>
          {hero}
          {more}
          <QualityCard />
          <MonthCompare dash={dash} page="overview" />
          <Collapsible title={t('Stoppage over time')} defaultOpen testid="sec-time">
            <div className="chart-grid">
              <div className="chart-wide">
                <ChartCard
                  title={t('Daily stopped hours')} subtitle={t('Failure, planned and other hours per day (area-hours), with the {n}-day average of the total as a line', { n: ROLLING_DAYS })}
                  summary={dailySummary} legend={[...legendStack, { label: t('{n}-day average (total)', { n: ROLLING_DAYS }), color: 'var(--tk-text-primary)', symbol: 'line' }]} testid="chart-daily"
                  table={{
                    head: [t('Day'), t('Failure h'), t('Planned h'), t('Other h'), t('Total h'), t('{n}-day average h', { n: ROLLING_DAYS })],
                    rows: days.map((d) => (d.hasData
                      ? [d.date, fh(d.failureHours), fh(d.plannedHours), fh(d.otherHours), fh(d.downtimeHours), d.rollingDowntimeHours === null ? '-' : fh(d.rollingDowntimeHours)]
                      : [d.date, '-', '-', '-', '-', '-'])),
                  }}
                  footnote={t('Days without a stop show no bar. The average covers up to {n} days, fewer at the start of the range.', { n: ROLLING_DAYS })}
                >
                  {(w) => <CartesianChart categories={dcats} series={dailySeries} width={w} ariaLabel={t('Stacked bar chart of daily stopped hours with a rolling average line. {s}', { s: dailySummary })} yFormat={(n) => `${n}`} />}
                </ChartCard>
              </div>
              <ChartCard
                title={t('Monthly stoppage hours')} subtitle={t('Failure, planned and other hours per month, summed over areas (area-hours). * partial month')}
                summary={stackSummary} legend={legendStack} testid="chart-monthly-stack"
                table={seriesTable(cats, stackSeries, t('Month'), (_s, n) => `${fh(n)}`)}
                footnote={months.some((m) => m.partial) ? t('Months with * are only partly covered by data; they are outlined with a dashed line.') : undefined}
              >
                {(w) => <CartesianChart categories={cats} series={stackSeries} width={w} ariaLabel={t('Stacked bar chart of monthly stoppage hours. {s}', { s: stackSummary })} yFormat={(n) => `${n}`} />}
              </ChartCard>
              <ChartCard
                title={t('Downtime by classification')} subtitle={t('Stopped hours per month by classification (area-hours)')}
                summary={classSummary} legend={CLASS_ORDER.map((code) => ({ label: code, color: classColor(dark, code), note: classNames.get(code) }))} testid="chart-class-month"
                table={{
                  head: [t('Month'), ...CLASS_ORDER, t('Total h')],
                  rows: byClass.map((m) => [m.partial ? `${monthLabel(m.month)} (${t('partial')})` : monthLabel(m.month), ...CLASS_ORDER.map((c) => (m.hasData ? fh(m.hours[c]) : '-')), m.hasData ? fh(m.total) : '-']),
                }}
                footnote={byClass.some((m) => m.partial) ? t('Months with * are only partly covered by data; they are outlined with a dashed line.') : undefined}
              >
                {(w) => <CartesianChart categories={ccats} series={classSeries} width={w} ariaLabel={t('Stacked bar chart of monthly stopped hours by classification. {s}', { s: classSummary })} yFormat={(n) => `${n}`} />}
              </ChartCard>
            </div>
          </Collapsible>
          <Collapsible title={t('Where the hours are')} testid="sec-where">
            <div className="chart-grid">
              <ChartCard
                title={t('Downtime by area')} subtitle={t('Stopped hours per area, largest first')}
                summary={downRows.length ? t('Largest: {a} with {h} h stopped.', { a: downRows[0]!.label, h: fh(downRows[0]!.segments.reduce((s, x) => s + x.value, 0)) }) : t('No downtime in this range.')}
                legend={legendStack}
                table={{ head: [t('Area'), t('Failure h'), t('Planned h'), t('Other h')], rows: downRows.map((r) => [r.label, ...r.segments.map((s) => fh(s.value))]) }} testid="chart-downtime-area"
              >
                {(w) => <HBars rows={downRows} width={w} format={(n) => `${fh(n)} h`} ariaLabel={t('Stacked bars of downtime hours by area')} />}
              </ChartCard>
              <ChartCard
                title={t('Top 10 equipment by failure hours')} subtitle={t('Own-stop rule: only codes that belong to the stopped area. Click a bar to open its events.')}
                summary={top.bars.length ? t('{c} has the most failure hours: {v} h ({p} of {a} h on own equipment).', { c: eqRows[0]!.label, v: fh(top.bars[0]!.value), p: fpct0(top.bars[0]!.sharePct), a: fh(top.total) }) : t('No failures on own equipment in this range.')}
                legend={[{ label: t('Failure hours'), color: STACK_COLORS.failure }]} testid="chart-top-equipment"
                table={{ head: [t('Equipment'), t('Failure h'), t('Share')], rows: eqRows.map((r) => [r.label, fh(r.segments[0]!.value), fpct0(eqShare.get(r.key) ?? 0)]) }}
              >
                {(w) => (
                  <HBars
                    rows={eqRows} width={w} format={(n) => `${fh(n)} h`} ariaLabel={t('Bars of the ten equipment codes with most failure hours')}
                    totalLabel={(r, v) => `${fh(v)} h · ${fpct0(eqShare.get(r.key) ?? 0)}`} openLabel={t('Open events')}
                    onRow={(r) => drill(`${t('the top equipment bar')} ${r.label}`, { eventIds: eqIds.get(r.key) ?? [] })}
                  />
                )}
              </ChartCard>
              <ChartCard
                title={t('Availability per area (basis {b})', { b: basis })} subtitle={targets.availabilityPct !== null ? t('Lowest first. The solid line is all areas together, the dashed line is the target. Striped bars are below the target.') : t('Lowest first. The dashed line is the availability of all areas together.')}
                summary={avSummary}
                legend={[
                  { label: targets.availabilityPct !== null ? t('On target') : t('Area availability'), color: 'var(--tk-accent)' },
                  ...(targets.availabilityPct !== null ? [{ label: t('Below target'), color: 'var(--tk-danger)', symbol: 'hatch' as const }, { label: t('Target {x}%', { x: targetNumber(targets.availabilityPct) }), color: 'var(--tk-text-primary)', symbol: 'dash' as const }] : []),
                  ...(overall !== null ? [{ label: t('All areas together'), color: 'var(--tk-text-primary)', symbol: (targets.availabilityPct !== null ? 'line' : 'dash') as 'line' | 'dash' }] : []),
                ]}
                testid="chart-area-availability"
                table={{
                  head: targets.availabilityPct !== null ? [t('Area'), t('Availability'), t('Status')] : [t('Area'), t('Availability')],
                  rows: [
                    ...avAreas.map((a) => [a.area_id, metricText(a.availability, fpct).text, ...(targets.availabilityPct !== null ? [!a.availability.available ? '-' : belowIds.has(a.area_id) ? t('Below target') : t('On target')] : [])]),
                    ...(av ? [[t('All areas together'), metricText(av.overall, fpct).text, ...(targets.availabilityPct !== null ? ['-'] : [])]] : []),
                  ],
                }}
                footnote={model?.belowTarget ? <span data-testid="below-target-count"><b>{t('{n} of {m} areas below target', { n: model.belowTarget.below.length, m: model.belowTarget.total })}</b>{model.belowTarget.below.length ? `: ${model.belowTarget.below.join(', ')}` : ''}</span> : undefined}
              >
                {(w) => (
                  avRows.length === 0 ? <p className="muted">{t('No availability can be calculated for these areas.')}</p> : (
                    <HBars
                      rows={avRows} width={w} format={(n) => `${n.toFixed(1)}%`} xMax={100} xMin={avFloor} axisNote={avNote} axisFormat={(n) => `${n}%`}
                      totalLabel={(r, v) => `${v.toFixed(1)}%${belowIds.has(r.key) ? ' ▼' : ''}`}
                      refLine={overall !== null ? { value: overall * 100, label: `${t('All areas')} ${fpct(overall)}`, dash: targets.availabilityPct !== null ? 'none' : undefined } : undefined}
                      extraRefs={targets.availabilityPct !== null ? [{ value: targets.availabilityPct, label: t('Target {x}%', { x: targetNumber(targets.availabilityPct) }) }] : []}
                      ariaLabel={t('Bars of availability per area with a line at the availability of all areas. {s}', { s: avSummary })}
                    />
                  )
                )}
              </ChartCard>
            </div>
          </Collapsible>
        </>
      )}
    </div>
  );
}
