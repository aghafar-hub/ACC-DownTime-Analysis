import { useMemo, useRef, useState } from 'react';
import type { RepeatGroup } from '../calc';
import { ChartCard } from '../charts/ChartKit';
import CartesianChart, { type CartCategory } from '../charts/CartesianChart';
import HeatmapTable from '../charts/HeatmapTable';
import ScatterChart from '../charts/ScatterChart';
import TimelineChart from '../charts/TimelineChart';
import { ACCENT } from '../charts/palette';
import { BottomSheet, PAGE_SIZE, ShowMore } from '../components/PhoneParts';
import { Tile } from '../components/Tile';
import DashTop from '../dashboard/DashTop';
import { dayLabel, fh, fh2, fint } from '../dashboard/format';
import { repeatsTakeaway } from '../dashboard/takeaways';
import { eventsOfEquipment, repeatsModel, rolling } from '../dashboard/models';
import { NoData, rowsInRange, Toggle, useDrill } from '../dashboard/parts';
import { useDash } from '../dashboard/useDash';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import '../components/ui.css';
import '../dashboard/dashboard.css';

type SortKey = 'equipmentId' | 'areas' | 'reason' | 'occurrences' | 'totalHours' | 'avgHours' | 'maxHours' | 'last' | 'prev';
const COLS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'equipmentId', label: 'Equipment' }, { key: 'areas', label: 'Area(s)' }, { key: 'reason', label: 'Reason' },
  { key: 'occurrences', label: 'Occurrences', num: true }, { key: 'totalHours', label: 'Total h', num: true }, { key: 'avgHours', label: 'Avg h', num: true },
  { key: 'maxHours', label: 'Max h', num: true }, { key: 'last', label: 'Last failure' }, { key: 'prev', label: 'Previous period', num: true },
];

function sortVal(g: RepeatGroup, k: SortKey): string | number {
  switch (k) {
    case 'equipmentId': return g.equipmentId;
    case 'areas': return g.areaIds.join(',');
    case 'reason': return g.reasonLabel.toLowerCase();
    case 'occurrences': return g.occurrences;
    case 'totalHours': return g.totalHours;
    case 'avgHours': return g.avgHours;
    case 'maxHours': return g.maxHours;
    case 'last': return g.lastFailureDate;
    case 'prev': return g.previousPeriodOccurrences;
  }
}

const gaps = (g: RepeatGroup): string => (g.daysBetween.length === 0 ? '-' : g.daysBetween.slice(0, 5).map((d) => (Math.round(d * 10) / 10).toString()).join(', ') + (g.daysBetween.length > 5 ? ` +${g.daysBetween.length - 5}` : ''));

export default function Repeats() {
  const dash = useDash();
  const { ctx } = dash;
  const mobile = useIsMobile();
  const drill = useDrill(dash, 'Repeats');
  const model = useMemo(() => (ctx ? repeatsModel(ctx) : null), [ctx]);
  const rows = useMemo(() => (ctx ? rowsInRange(ctx.scope, ctx.win.range) : null), [ctx]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'occurrences', dir: -1 });
  const [shown, setShown] = useState(PAGE_SIZE);
  const [sel, setSel] = useState<string | null>(null);
  const [heatMeasure, setHeatMeasure] = useState<'hours' | 'count'>('hours');
  const [heat2Measure, setHeat2Measure] = useState<'hours' | 'count'>('count');
  const [roll, setRoll] = useState<'30' | '90'>('30');
  const [sheet, setSheet] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const gs = [...(model?.result.groups ?? [])];
    gs.sort((a, b) => {
      const x = sortVal(a, sort.key);
      const y = sortVal(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || (a.key < b.key ? -1 : 1);
    });
    return gs;
  }, [model, sort]);
  const selCode = sel ?? groups[0]?.equipmentId ?? model?.scatter[0]?.code ?? '';
  const events = useMemo(() => (ctx && selCode ? eventsOfEquipment(ctx, selCode) : []), [ctx, selCode]);
  const rollPts = useMemo(() => (ctx ? rolling(ctx, roll === '30' ? 30 : 90) : []), [ctx, roll]);

  const res = model?.result;
  const equipCount = new Set(res?.groups.map((g) => g.equipmentId)).size;
  const groupHours = res?.groups.reduce((s, g) => s + g.totalHours, 0) ?? 0;
  const win = model?.window;
  const settings = ctx?.master.settings;
  const topGroup = res?.groups.reduce<RepeatGroup | null>((b, g) => (!b || g.occurrences > b.occurrences || (g.occurrences === b.occurrences && g.totalHours > b.totalHours) ? g : b), null) ?? null;
  const takeaway = !ctx ? t('Loading…') : res && settings
    ? repeatsTakeaway({
      groups: res.groups.length, recurrences: res.recurrences.length, equipmentCount: equipCount,
      top: topGroup && { equipmentId: topGroup.equipmentId, occurrences: topGroup.occurrences, totalHours: topGroup.totalHours, reason: topGroup.reasonLabel },
      minEvents: settings.repeatMinEvents, windowDays: settings.repeatWindowDays,
    })
    : repeatsTakeaway(null);

  const select = (code: string) => {
    setSel(code);
    if (mobile) setSheet(true);
    else timelineRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const th = (c: (typeof COLS)[number]) => (
    <th key={c.key} scope="col" className={c.num ? 'num' : undefined} aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sortbtn sort-th" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (-s.dir as 1 | -1) : c.num ? -1 : 1 }))} data-testid={`sort-${c.key}`}>
        {t(c.label)} <span aria-hidden="true">{sort.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
  const visible = groups.slice(0, shown);

  const timeline = (
    <ChartCard
      title={t('Failure timeline: {c}', { c: selCode || '-' })}
      subtitle={t('Each mark is a failure event: taller = longer stop. Dashed lines show days between failures.')}
      summary={events.length ? t('{n} failure events for {c}; total {h} h.', { n: events.length, c: selCode, h: fh(events.reduce((s, e) => s + e.durationS / 3600, 0)) }) : t('No failure events for this code in the range.')}
      controls={events.length ? <button type="button" className="btn btn-sm" onClick={() => drill(t('the timeline of {c}', { c: selCode }), { eventIds: events.map((e) => e.id) })} data-testid="timeline-open">{t('Open {n} events', { n: events.length })}</button> : undefined}
      table={{ head: [t('Start'), t('Hours'), t('Reason'), t('Area')], rows: events.map((e) => [e.startDate, fh2(e.durationS / 3600), e.head.reason_raw?.trim() || t('(blank)'), e.area_id]) }}
      testid="chart-timeline"
    >
      {(w) => win && events.length > 0 ? (
        <TimelineChart events={events.map((e) => ({ id: e.id, startMs: e.startMs, endMs: e.endMs, hours: e.durationS / 3600, reason: e.head.reason_raw?.trim() ?? '', area: e.area_id }))}
          range={win} width={w} ariaLabel={t('Timeline of failures of {c}', { c: selCode })}
          onEvent={(e) => drill(t('the event {id}', { id: e.id }), { eventIds: [e.id] })} openLabel={t('Open this event')} />
      ) : <p className="muted">{t('No failure events for this code in the range.')}</p>}
    </ChartCard>
  );

  const rcats: CartCategory[] = rollPts.map((p) => ({ key: p.date, label: p.date.slice(5), note: dayLabel(p.date) }));
  const heat = heatMeasure === 'hours' ? model?.heatMonthHours : model?.heatMonthCount;
  const heatFull = heatMeasure === 'hours' ? model?.heatAll.monthHours : model?.heatAll.monthCount;
  const heat2Full = heat2Measure === 'hours' ? model?.heatAll.reasonHours : model?.heatAll.reasonCount;
  const heat2 = heat2Measure === 'hours' ? model?.heatReasonHours : model?.heatReasonCount;
  const fmtM = (m: 'hours' | 'count') => (m === 'hours' ? fh : fint);

  return (
    <div className="page dash-page" data-testid="page-repeats">
      <DashTop
        title={t('Repeated Failures')} takeaway={takeaway} dash={dash} eventCount={rows ? rows.length : null}
        right={<button type="button" className="btn btn-sm" onClick={dash.reload} data-testid="refresh"><Icon name="sync" size={14} /> {t('Refresh')}</button>}
      />
      {res && settings && (
        <div className="kpi-grid" data-testid="repeat-tiles">
          <Tile compact={mobile} icon="repeat" label={t('Qualifying groups')} value={<span data-testid="rt-groups">{fint(res.groups.length)}</span>} sub={t('same code and reason, at least {n} events within {d} days', { n: settings.repeatMinEvents, d: settings.repeatWindowDays })} />
          <Tile compact={mobile} icon="alert" label={t('Recurrence events')} value={<span data-testid="rt-recurrences">{fint(res.recurrences.length)}</span>} sub={t('occurrences after the first of each cluster')} />
          <Tile compact={mobile} icon="clock" label={t('Hours in these groups')} value={`${fh(groupHours)} h`} sub={t('all occurrences, area-hours')} />
          <Tile compact={mobile} icon="equipment" label={t('Equipment affected')} value={fint(equipCount)} sub={t('different equipment codes')} />
        </div>
      )}
      {ctx && !model && <NoData reason={t('No data covers the selected period.')} />}
      {model && res && (
        <>
          <section className="card" data-testid="repeat-table-card">
            <h2>{t('Investigation table')}</h2>
            <p className="chart-sub" style={{ marginBottom: 8 }}>{t('Select a row to see the failure timeline of that equipment. N/A and blank reasons are excluded.')}</p>
            {groups.length === 0 ? <p className="muted" data-testid="repeat-none">{t('No repeated failures in this range.')}</p> : !mobile ? (
              <div className="table-wrap">
                <table className="data-table" data-testid="repeat-table">
                  <thead><tr>{COLS.map(th)}<th scope="col">{t('Days between')}</th></tr></thead>
                  <tbody>
                    {visible.map((g) => (
                      <tr key={g.key} className={g.equipmentId === selCode ? 'tr-selected' : undefined} data-testid="repeat-row" data-equipment={g.equipmentId}>
                        <td className="nowrap"><button type="button" className="row-btn mono" onClick={() => select(g.equipmentId)} aria-label={t('Show timeline of {c}', { c: g.equipmentId })} data-testid="repeat-open">{g.equipmentId}</button></td>
                        <td>{g.areaIds.join(', ')}</td>
                        <td>{g.reasonLabel}</td>
                        <td className="num">{fint(g.occurrences)}</td>
                        <td className="num">{fh(g.totalHours)}</td>
                        <td className="num">{fh2(g.avgHours)}</td>
                        <td className="num">{fh2(g.maxHours)}</td>
                        <td className="nowrap mono">{g.lastFailureDate}</td>
                        <td className="num">{fint(g.previousPeriodOccurrences)}</td>
                        <td className="mono nowrap">{gaps(g)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="event-cards" data-testid="repeat-cards">
                <div className="chip-row" role="group" aria-label={t('Sort by')}>
                  {COLS.filter((c) => c.num || c.key === 'last').map((c) => <button key={c.key} type="button" className={sort.key === c.key ? 'chip chip--on' : 'chip'} onClick={() => setSort({ key: c.key, dir: -1 })}>{t(c.label)}</button>)}
                </div>
                {visible.map((g) => (
                  <button key={g.key} type="button" className="event-card" onClick={() => select(g.equipmentId)} data-testid="repeat-card">
                    <div className="event-card-top"><span className="event-card-code">{g.equipmentId} · {g.areaIds.join(', ')}</span><span className="badge badge--danger"><span aria-hidden="true">◆</span> {g.occurrences}×</span></div>
                    <div className="event-card-line">{g.reasonLabel}</div>
                    <div className="event-card-line mono">{fh(g.totalHours)} h total · avg {fh2(g.avgHours)} · max {fh2(g.maxHours)}</div>
                    <div className="event-card-line mono">{t('Last')} {g.lastFailureDate} · {t('previous period')} {g.previousPeriodOccurrences}</div>
                    <div className="event-card-line mono">{t('Days between')}: {gaps(g)}</div>
                  </button>
                ))}
              </div>
            )}
            <ShowMore shown={visible.length} total={groups.length} onMore={() => setShown((n) => n + PAGE_SIZE)} />
          </section>

          <div ref={timelineRef}>{!mobile && timeline}</div>
          {mobile && sheet && <BottomSheet title={t('Failure timeline: {c}', { c: selCode })} onClose={() => setSheet(false)} testid="timeline-sheet">{timeline}</BottomSheet>}
          {mobile && !sheet && selCode && <button type="button" className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={() => setSheet(true)} data-testid="timeline-show">{t('Show failure timeline: {c}', { c: selCode })}</button>}

          <div className="chart-grid">
            <ChartCard
              title={t('Equipment by month')} subtitle={t('Failure events by the equipment code of the cause; the largest 15 codes')} testid="chart-heat-month"
              summary={heat ? t('{n} codes shown, {t} {u} in total.', { n: heat.rows.length, t: fmtM(heatMeasure)(heat.total), u: heatMeasure === 'hours' ? 'h' : t('events') }) : ''}
              controls={<Toggle value={heatMeasure} options={[{ value: 'hours', label: t('Hours') }, { value: 'count', label: t('Count') }]} onChange={setHeatMeasure} label={t('Measure')} testid="heat-month-measure" />}
              legend={[{ label: t('Darker = more'), color: ACCENT }]}
            >
              {() => heat ? <HeatmapTable map={heat} full={heatFull} format={fmtM(heatMeasure)} caption={t('Equipment by month')} rowHead={t('Code')} shortCol={(l) => l.slice(2).replace('-', '/')} /> : null}
            </ChartCard>
            <ChartCard
              title={t('Equipment by reason')} subtitle={t('Top codes against top reasons')} testid="chart-heat-reason"
              summary={heat2 ? t('{n} codes and {c} reasons shown.', { n: heat2.rows.length, c: heat2.cols.length }) : ''}
              controls={<Toggle value={heat2Measure} options={[{ value: 'hours', label: t('Hours') }, { value: 'count', label: t('Count') }]} onChange={setHeat2Measure} label={t('Measure')} testid="heat-reason-measure" />}
              legend={[{ label: t('Darker = more'), color: ACCENT }]}
            >
              {() => heat2 ? <HeatmapTable map={heat2} full={heat2Full} format={fmtM(heat2Measure)} caption={t('Equipment by reason')} rowHead={t('Code')} /> : null}
            </ChartCard>
          </div>

          <ChartCard
            title={t('Frequency against average duration')} subtitle={t('One point per equipment code (own-stop rule). Bigger point = more total hours. Tap a point for details.')} testid="chart-scatter"
            summary={t('{n} equipment codes with failures.', { n: model.scatter.length })}
            table={{ head: [t('Code'), t('Failures'), t('Avg h'), t('Total h')], rows: [...model.scatter].sort((a, b) => b.count - a.count).map((p) => [p.code, fint(p.count), fh2(p.avgHours), fh(p.totalHours)]) }}
          >
            {(w) => (
              <ScatterChart
                width={w} xTitle={t('Failures (count)')} yTitle={t('Average hours per failure')} ariaLabel={t('Scatter chart of failure frequency against average duration per equipment code')}
                points={model.scatter.map((p) => ({ key: p.code, label: p.code, x: p.count, y: p.avgHours, size: p.totalHours, details: [{ label: t('Failures'), value: fint(p.count) }, { label: t('Average'), value: `${fh2(p.avgHours)} h` }, { label: t('Total'), value: `${fh(p.totalHours)} h` }] }))}
                selected={selCode} onPoint={(p) => select(p.key)} openLabel={t('Show timeline')}
              />
            )}
          </ChartCard>

          <ChartCard
            title={t('Rolling failure trend')} subtitle={t('Failure events that started in the last {n} days, for each day', { n: roll })} testid="chart-rolling"
            summary={rollPts.length ? t('Latest {n}-day count: {c}. Highest: {m}.', { n: roll, c: rollPts[rollPts.length - 1]!.count, m: Math.max(...rollPts.map((p) => p.count)) }) : t('No data.')}
            controls={<Toggle value={roll} options={[{ value: '30', label: t('30 days') }, { value: '90', label: t('90 days') }]} onChange={setRoll} label={t('Rolling window')} testid="roll-window" />}
            table={{ head: [t('Date'), t('Failures')], rows: rollPts.map((p) => [p.date, p.count]) }}
          >
            {(w) => <CartesianChart categories={rcats} series={[{ key: 'r', label: t('Failures in last {n} days', { n: roll }), color: 'var(--tk-danger)', type: 'line', values: rollPts.map((p) => p.count), format: fint }]} width={w} height={240} yFormat={(n) => `${n}`} ariaLabel={t('Line chart of the rolling {n}-day failure count', { n: roll })} />}
          </ChartCard>
        </>
      )}
    </div>
  );
}
