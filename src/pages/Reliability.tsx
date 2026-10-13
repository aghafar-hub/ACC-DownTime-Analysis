import { useMemo, useState } from 'react';
import type { Metric } from '../calc';
import { ChartCard } from '../charts/ChartKit';
import CartesianChart, { seriesTable, type CartCategory, type CartSeries } from '../charts/CartesianChart';
import { seriesColor } from '../charts/palette';
import { Tile } from '../components/Tile';
import { useIsMobile } from '../hooks/useIsMobile';
import AreasBlock from '../dashboard/AreasBlock';
import MonthCompare from '../dashboard/MonthCompare';
import DashTop from '../dashboard/DashTop';
import { fh, fh2, fint, monthLabel, monthMissing, MTBF_ALL_LABEL, MTBF_ALL_SUB, partialNote } from '../dashboard/format';
import { reliabilityTakeaway } from '../dashboard/takeaways';
import { reliabilityModel, whenFailuresStart } from '../dashboard/models';
import HeatmapTable from '../charts/HeatmapTable';
import { ACCENT } from '../charts/palette';
import { EMPTY_SCOPE_TAKEAWAY, EmptyScope, NoData, rowsInRange, Toggle, useDrill } from '../dashboard/parts';
import { useDash } from '../dashboard/useDash';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useTheme } from '../theme/ThemeContext';
import '../components/ui.css';
import '../dashboard/dashboard.css';

type YoyMetric = 'failureHours' | 'failureCount' | 'mtbf' | 'rate';

const num = (m: Metric): number | null => (m.available ? m.value : null);
const why = (m: Metric): string | undefined => (m.available ? undefined : m.code === 'no_failures' ? t('No failures this month: MTBF is not defined') : m.reason);

export default function Reliability() {
  const dash = useDash({ extraYearsBack: 1 });
  const { ctx } = dash;
  const mobile = useIsMobile();
  const { dark } = useTheme();
  const drill = useDrill(dash, 'Reliability');
  const [area, setArea] = useState('');
  const [yoyMetric, setYoyMetric] = useState<YoyMetric>('failureHours');
  const [startMeasure, setStartMeasure] = useState<'count' | 'hours'>('count');
  const areaId = area && ctx?.base.areaIds.includes(area) ? area : '';
  const model = useMemo(() => (ctx ? reliabilityModel(ctx, areaId || undefined) : null), [ctx, areaId]);
  const rows = useMemo(() => (ctx ? rowsInRange(ctx.scope, ctx.win.range) : null), [ctx]);
  const win = ctx?.win.effective ?? null;

  const months = model?.monthly ?? [];
  const cats: CartCategory[] = months.map((m) => ({ key: m.month, label: monthLabel(m.month), partial: m.partial, note: partialNote(m) }));
  const line = (key: string, label: string, pick: (m: (typeof months)[number]) => Metric, fmt: (n: number) => string, slot: number): CartSeries => ({
    key, label, color: seriesColor(dark, slot), type: 'line', values: months.map((m) => num(pick(m))), missing: months.map((m) => why(pick(m))), format: fmt,
  });
  const mtbf = line('mtbf', t('MTBF (h)'), (m) => m.mtbfHours, fh, 0);
  const mttr = line('mttr', t('Mean restoration time (h)'), (m) => m.mttrHours, fh2, 1);
  const rate = line('rate', t('Failures per 1,000 operating hours'), (m) => m.failureRatePer1000h, fh2, 2);
  const gapCount = (s: CartSeries) => s.values.filter((v) => v === null).length;
  const gapNote = (s: CartSeries) => (gapCount(s) ? t('{n} months have no value (gaps): no failures, no data or not uploaded. Hover or tap a month for the reason.', { n: gapCount(s) }) : undefined);
  const areaLabel = areaId || t('all areas (area-hours)');

  const hist = model?.histogram;
  const bandOf = (fromMin: number, toMin: number | null): 'short' | 'medium' | 'long' => {
    const s = ctx!.master.settings;
    if (toMin !== null && toMin <= s.durationShortMaxMin) return 'short';
    if (fromMin >= s.durationLongMinMin) return 'long';
    return 'medium';
  };
  const BAND_COLOR = { short: seriesColor(dark, 0), medium: seriesColor(dark, 3), long: seriesColor(dark, 7) };
  const binText = (m: number): string => (m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m}m`);
  // short axis wording ('<10m', '10–30m', '8–24h', '24h+'); the full text stays in the tooltip and the table
  const binShort = (from: number, to: number | null): string => {
    if (to === null) return `${binText(from)}+`;
    if (from === 0) return `<${binText(to)}`;
    const h = (m: number) => m >= 60 && m % 60 === 0;
    return h(from) && h(to) ? `${from / 60}–${to / 60}h` : h(to) && !h(from) ? `${from}m–${to / 60}h` : `${from}–${to}m`;
  };
  const hcats: CartCategory[] = (hist?.bins ?? []).map((b) => ({ key: b.label, label: binShort(b.fromMin, b.toMin), full: b.label }));
  const hseries: CartSeries[] = hist ? [{
    key: 'n', label: t('Failure events'), color: BAND_COLOR.medium, type: 'bar', values: hist.bins.map((b) => b.count), format: fint,
    pointColors: hist.bins.map((b) => BAND_COLOR[bandOf(b.fromMin, b.toMin)]),
    pointNotes: hist.bins.map((b) => `${t(bandOf(b.fromMin, b.toMin) === 'short' ? 'Short' : bandOf(b.fromMin, b.toMin) === 'long' ? 'Long' : 'Medium')} · ${fh(b.hours)} h`),
  }] : [];

  const yoy = model?.yoy ?? [];
  const ycats: CartCategory[] = yoy.map((y) => ({ key: String(y.monthNumber), label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][y.monthNumber - 1]!, partial: y.current.partial }));
  const pickY = (p: (typeof yoy)[number]['current']): number | null => {
    if (!p.hasData) return null;
    switch (yoyMetric) {
      case 'failureHours': return p.failureHours;
      case 'failureCount': return p.failureCount;
      case 'mtbf': return num(p.mtbfHours);
      case 'rate': return num(p.failureRatePer1000h);
    }
  };
  const yfmt = yoyMetric === 'failureCount' ? fint : yoyMetric === 'rate' ? fh2 : fh;
  const yseries: CartSeries[] = model ? [
    { key: 'prev', label: String(model.yoyYear - 1), color: seriesColor(dark, 1), type: 'bar', values: yoy.map((y) => pickY(y.previous)), format: yfmt, missing: yoy.map((y) => monthMissing(y.previous)) },
    { key: 'cur', label: String(model.yoyYear), color: seriesColor(dark, 0), type: 'bar', values: yoy.map((y) => pickY(y.current)), format: yfmt, missing: yoy.map((y) => monthMissing(y.current)) },
  ] : [];
  const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yoyNotUploaded = yoy.flatMap((y) => [y.previous, y.current]).filter((p) => p.notUploaded).map((p) => monthLabel(p.month));
  // P7: last year's month covered for less than 90 %: its totals are compared per day
  const yoyPerDay = yoy.filter((y) => y.failureHours.available && y.failureHours.perDay).map((y) => MONTHS3[y.monthNumber - 1]!);
  const yoyFoot = [
    yoyNotUploaded.length ? `${t('Not uploaded')}: ${yoyNotUploaded.join(', ')}.` : '',
    yoyPerDay.length ? t('Last year is only partly covered in {m}: compare those months per day.', { m: yoyPerDay.join(', ') }) : '',
  ].filter(Boolean).join(' ') || undefined;
  const yoyLabels: Record<YoyMetric, string> = { failureHours: t('Failure hours'), failureCount: t('Failure count'), mtbf: t('MTBF (h)'), rate: t('Failures per 1,000 h') };

  const startHeat = useMemo(() => (ctx ? whenFailuresStart(ctx, startMeasure) : null), [ctx, startMeasure]);
  const startFmt = startMeasure === 'count' ? fint : fh;
  const startSummary = (() => {
    if (!startHeat || startHeat.total <= 0) return t('No failure events started in this range.');
    let best = { r: 0, c: 0, v: -1 };
    startHeat.values.forEach((row, r) => row.forEach((v, c) => { if (v > best.v) best = { r, c, v }; }));
    const peakHour = startHeat.rows.reduce((b, r) => (r.total > b.total ? r : b), startHeat.rows[0]!);
    const peakDay = startHeat.cols.reduce((b, c) => (c.total > b.total ? c : b), startHeat.cols[0]!);
    const u = startMeasure === 'count' ? t('failure events') : 'h';
    return t('{t} {u} started in the range. Busiest hour {h} ({hv}), busiest day {d} ({dv}); the single busiest slot is {d2} at {h2} ({v}).', {
      t: startFmt(startHeat.total), u, h: peakHour.label, hv: startFmt(peakHour.total), d: t(peakDay.label), dv: startFmt(peakDay.total),
      d2: t(startHeat.cols[best.c]!.label), h2: startHeat.rows[best.r]!.label, v: startFmt(best.v),
    });
  })();
  const longest = model?.longest ?? [];
  const total = ctx && model && ctx.kpis.current.status === 'ok' ? ctx.kpis.current.total : null;
  const areaKpi = areaId && ctx && ctx.kpis.current.status === 'ok' ? ctx.kpis.current.areas.find((a) => a.area_id === areaId) ?? null : null;
  const k = areaKpi ?? total;
  const lastMonths = months.flatMap((m) => (m.mtbfHours.available ? [{ month: m.month, mtbf: m.mtbfHours.value }] : [])).slice(-2);
  const empty = !!model && rows !== null && rows.length === 0;
  const takeaway = !ctx ? t('Loading…') : empty ? t(EMPTY_SCOPE_TAKEAWAY) : model && win && k
    ? reliabilityTakeaway({ mtbf: k.mtbfHours, mttr: k.mttrHours, failureEvents: k.failureEventCount, lastMonths, areaId: areaId || null })
    : reliabilityTakeaway(null);
  const mt = (m: Metric, f: (n: number) => string) => (m.available ? `${f(m.value)} h` : m.code === 'no_failures' ? t('None recorded') : t('Unavailable'));

  return (
    <div className="page dash-page" data-testid="page-reliability">
      <DashTop
        title={t('Reliability Trends')} takeaway={takeaway} dash={dash} eventCount={rows ? rows.length : null} hideCompare
        right={<button type="button" className="btn btn-sm" onClick={dash.reload} data-testid="refresh"><Icon name="sync" size={14} /> {t('Refresh')}</button>}
      />
      {empty && <EmptyScope dash={dash} />}
      {k && !empty && (
        <div className="kpi-grid" data-testid="reliability-tiles">
          <Tile compact={mobile} icon="trend" label={areaId ? t('MTBF ({a})', { a: areaId }) : t(MTBF_ALL_LABEL)} value={<span data-testid="rt-mtbf">{mt(k.mtbfHours, fh)}</span>} sub={k.mtbfHours.available ? (areaId ? t('operating hours per failure event') : t(MTBF_ALL_SUB)) : (k.mtbfHours.reason)} />
          <Tile compact={mobile} icon="repeat" label={t('Mean restoration time')} value={<span data-testid="rt-mttr">{mt(k.mttrHours, fh2)}</span>} sub={t('failure events that started in the range')} />
          <Tile compact={mobile} icon="alert" label={t('Failures per 1,000 operating hours')} value={k.failureRatePer1000h.available ? fh2(k.failureRatePer1000h.value) : t('Unavailable')} sub={k.failureRatePer1000h.available ? undefined : k.failureRatePer1000h.reason} />
          <Tile compact={mobile} icon="clock" label={t('Failure events')} value={fint(k.failureEventCount)} sub={t('first row Freq 1, Failure YES, not PL or CIR')} />
        </div>
      )}
      {ctx && <MonthCompare dash={dash} page="reliability" />}
      {ctx && !model && <NoData reason={t('No data covers the selected period.')} />}
      {model && ctx && !empty && (
        <>
          <AreasBlock ctx={ctx} onOpen={(label, ids) => drill(label, { eventIds: ids })} />
          <section aria-labelledby="when-heading" data-testid="when-block">
            <h2 className="dash-section-title" id="when-heading">{t('When failures start')}</h2>
            <ChartCard
              title={t('Failure starts by hour and weekday')} subtitle={t('Failure events chained as failures, by the plant-local time the stop began. Each cell is one hour of one weekday over the whole range.')} testid="chart-when-heat"
              summary={startSummary}
              controls={<Toggle value={startMeasure} options={[{ value: 'count', label: t('Count') }, { value: 'hours', label: t('Hours') }]} onChange={setStartMeasure} label={t('Measure')} testid="when-measure" />}
              legend={[{ label: t('Darker = more'), color: ACCENT }]}
              table={startHeat ? { head: [t('Hour'), ...startHeat.cols.map((c) => t(c.label)), t('Total')], rows: [...startHeat.rows.map((r, i) => [r.label, ...startHeat.values[i]!.map((v) => (v > 0 ? startFmt(v) : '-')), startFmt(r.total)]), [t('Total'), ...startHeat.cols.map((c) => startFmt(c.total)), startFmt(startHeat.total)]] } : undefined}
              footnote={startMeasure === 'count' ? t('Times are plant-local as recorded; no time zone conversion. An event is counted once, at the hour and weekday its first row stopped.') : t('Times are plant-local as recorded; no time zone conversion. Hours are the whole duration of each event, placed at the hour and weekday it started.')}
            >
              {() => startHeat ? <HeatmapTable map={startHeat} format={startFmt} caption={t('Failure starts by hour and weekday')} rowHead={t('Hour')} shortCol={(l) => t(l)} colTotals /> : null}
            </ChartCard>
          </section>
          <h2 className="dash-section-title">{t('Monthly trends')}</h2>
          <div className="field" style={{ maxWidth: 280, marginBottom: 12 }}>
            <label htmlFor="rel-area">{t('Area for the monthly charts')}</label>
            <select id="rel-area" className="select" value={areaId} onChange={(e) => setArea(e.target.value)} data-testid="rel-area">
              <option value="">{t('All areas (area-hours)')}</option>
              {ctx.base.areaIds.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="chart-grid chart-grid--even">
            <ChartCard title={t('Monthly MTBF')} subtitle={t('Operating hours per failure, {a}', { a: areaLabel })} testid="chart-mtbf"
              summary={`${t('{n} of {m} months have an MTBF.', { n: months.length - gapCount(mtbf), m: months.length })}`} footnote={gapNote(mtbf)}
              table={seriesTable(cats, [mtbf], t('Month'), (_s, n) => fh(n))}>
              {(w) => <CartesianChart categories={cats} series={[mtbf]} width={w} ariaLabel={t('Line chart of monthly MTBF')} zeroBased />}
            </ChartCard>
            <ChartCard title={t('Mean restoration time')} subtitle={t('Mean duration of failure events that started in the month')} testid="chart-mttr"
              summary={t('{n} of {m} months have a value.', { n: months.length - gapCount(mttr), m: months.length })} footnote={gapNote(mttr)}
              table={seriesTable(cats, [mttr], t('Month'), (_s, n) => fh2(n))}>
              {(w) => <CartesianChart categories={cats} series={[mttr]} width={w} ariaLabel={t('Line chart of monthly mean restoration time')} yFormat={(n) => `${n}`} />}
            </ChartCard>
            <ChartCard title={t('Failures per 1,000 operating hours')} subtitle={t('Failure rate adjusted for exposure, {a}', { a: areaLabel })} testid="chart-rate"
              summary={t('{n} of {m} months have a value.', { n: months.length - gapCount(rate), m: months.length })} footnote={gapNote(rate)}
              table={seriesTable(cats, [rate], t('Month'), (_s, n) => fh2(n))}>
              {(w) => <CartesianChart categories={cats} series={[rate]} width={w} ariaLabel={t('Line chart of failures per 1,000 operating hours')} yFormat={(n) => `${n}`} />}
            </ChartCard>
            <ChartCard title={t('Failure duration distribution')} subtitle={t('Failure events by total duration; colours and labels mark short, medium and long')} testid="chart-histogram"
              summary={hist ? t('{n} failure events. Short {s}, medium {m}, long {l}.', { n: fint(hist.eventCount), s: fint(hist.bands[0]!.count), m: fint(hist.bands[1]!.count), l: fint(hist.bands[2]!.count) }) : ''}
              legend={[
                { label: t('Short (up to {m} min)', { m: ctx.master.settings.durationShortMaxMin }), color: BAND_COLOR.short },
                { label: t('Medium'), color: BAND_COLOR.medium, symbol: 'diamond' },
                { label: t('Long (from {m} min)', { m: ctx.master.settings.durationLongMinMin }), color: BAND_COLOR.long, symbol: 'triangle' },
              ]}
              table={hist ? { head: [t('Duration'), t('Events'), t('Hours'), t('Band')], rows: hist.bins.map((b) => [b.label, fint(b.count), fh(b.hours), bandOf(b.fromMin, b.toMin)]) } : undefined}
              footnote={hist ? hist.bands.map((b) => `${b.band}: ${fint(b.count)} (${b.countPct.toFixed(0)}% of events, ${b.hoursPct.toFixed(0)}% of hours)`).join(' · ') : undefined}>
              {(w) => <CartesianChart categories={hcats} series={hseries} width={w} ariaLabel={t('Histogram of failure durations')} yFormat={(n) => `${n}`} rotateLabels />}
            </ChartCard>
          </div>
          <ChartCard title={t('Year over year, by month')} subtitle={t('{a} against {b}, {m}', { a: model.yoyYear, b: model.yoyYear - 1, m: yoyLabels[yoyMetric] })} testid="chart-yoy"
            controls={<Toggle value={yoyMetric} options={(Object.keys(yoyLabels) as YoyMetric[]).map((v) => ({ value: v, label: yoyLabels[v] }))} onChange={setYoyMetric} label={t('Measure')} testid="yoy-measure" />}
            summary={t('Months without data in either year are left out.')} legend={yseries.map((s) => ({ label: s.label, color: s.color }))} footnote={yoyFoot}
            table={seriesTable(ycats, yseries, t('Month'), (_s, n) => yfmt(n))}>
            {(w) => <CartesianChart categories={ycats} series={yseries} width={w} ariaLabel={t('Grouped bars comparing each month with the same month a year earlier')} yFormat={(n) => `${n}`} maxBarWidth={26} />}
          </ChartCard>
          <section className="card" data-testid="longest-card">
            <h2>{t('Longest events')}</h2>
            <p className="chart-sub" style={{ marginBottom: 8 }}>{t('Ranked by chained event: a stop that continues over several rows counts once, with all its rows.')}</p>
            {longest.length === 0 ? <p className="muted">{t('No failure events in this range.')}</p> : (
              <div className="table-wrap">
                <table className="data-table" data-testid="longest-table">
                  <thead><tr><th scope="col">#</th><th scope="col">{t('Started')}</th><th scope="col">{t('Area')}</th><th scope="col">{t('Code')}</th><th scope="col">{t('Reason')}</th><th scope="col" className="num">{t('Hours')}</th><th scope="col" className="num">{t('Rows')}</th></tr></thead>
                  <tbody>
                    {longest.map((e, i) => (
                      <tr key={e.eventId} data-testid="longest-row">
                        <td>{i + 1}</td>
                        <td className="nowrap"><button type="button" className="row-btn mono" onClick={() => drill(t('the event {id}', { id: e.eventId }), { eventIds: [e.eventId] })} aria-label={t('Open event {id}', { id: e.eventId })}>{e.startTs.slice(0, 16)}</button></td>
                        <td>{e.area_id}</td><td className="mono">{e.code}</td><td>{e.reason || t('(blank)')}</td>
                        <td className="num">{fh2(e.hours)}</td><td className="num">{e.rowCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
