import { useMemo, useState } from 'react';
import { areasOf, type AreaLevelStops, type ParetoBar, type ParetoResult } from '../calc';
import { Tile } from '../components/Tile';
import { useIsMobile } from '../hooks/useIsMobile';
import { areaModel, classModel, equipmentModel, lineModel, reasonForEquipmentModel, reasonModel, reasonMonthModel } from '../dashboard/models';
import { ChartCard } from '../charts/ChartKit';
import HeatmapTable from '../charts/HeatmapTable';
import { ACCENT } from '../charts/palette';
import { EMPTY_SCOPE_TAKEAWAY, EmptyScope, NoData, rowsInRange, Toggle, useDrill } from '../dashboard/parts';
import ParetoCard from '../dashboard/ParetoCard';
import DashTop from '../dashboard/DashTop';
import { fh, fint } from '../dashboard/format';
import { paretoTakeaway } from '../dashboard/takeaways';
import { useDash } from '../dashboard/useDash';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useCreateAction } from '../actions/ActionsContext';
import { paretoPrefill, type ParetoDim } from '../actions/prefill';
import '../components/ui.css';
import '../dashboard/dashboard.css';

type Sub = 'equipment' | 'reason' | 'area';

function Bucket({ title, note, result, testid, onOpen, detail }: { title: string; note: string; result: ParetoResult; testid: string; onOpen: (label: string, ids: string[]) => void; detail?: (b: ParetoBar) => string }) {
  const bars = result.bars.slice(0, 5);
  const blank = t('(blank code)');
  return (
    <section className="card" data-testid={testid}>
      <h2>{title}</h2>
      <p className="chart-sub">{note}</p>
      <p style={{ margin: '6px 0 0', fontSize: 13 }}><b data-testid={`${testid}-total`} className="mono">{fh(result.total)} h</b> · {fint(result.bars.reduce((s, b) => s + b.eventIds.length, 0))} {t('events')}</p>
      {bars.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>{t('None in this range.')}</p> : (
        <ul className="bucket-list">
          {bars.map((b) => (
            <li key={b.key}>
              <span>
                <button type="button" className="row-btn mono" onClick={() => onOpen(`${title}: ${b.label || blank}`, b.eventIds)}>{b.label.trim() ? b.label : blank}</button>
                {detail && <span className="muted bucket-detail" data-testid="bucket-detail"> · {detail(b)}</span>}
              </span>
              <b>{fh(b.value)} h</b>
            </li>
          ))}
          {result.entryCount > bars.length && <li><span className="muted">{t('and {n} more', { n: result.entryCount - bars.length })}</span><span /></li>}
        </ul>
      )}
    </section>
  );
}

/**
 * N/A stops of every classification. The failure buckets beside it only see N/A failures; the plant writes whole-area
 * stops as CIR with Failure NO, so without this card they would read 0 h while the areas were stopped for many hours.
 */
function AreaLevelCard({ data, onOpen }: { data: AreaLevelStops; onOpen: (label: string, ids: string[]) => void }) {
  const title = t('Area-level stops (N/A)');
  const bars = data.byArea.bars.slice(0, 5);
  const all = data.byArea.bars.flatMap((b) => b.eventIds);
  return (
    <section className="card" data-testid="bucket-area">
      <h2>{title}</h2>
      <p className="chart-sub">{t('The whole area stopped; no equipment code. Every classification is counted here.')}</p>
      <p style={{ margin: '6px 0 0', fontSize: 13 }}>
        <b data-testid="bucket-area-total" className="mono">{fh(data.byArea.total)} h</b> · <span data-testid="bucket-area-count">{fint(data.events)}</span> {t('stops')}
        {data.classes.length > 0 && <span className="muted" data-testid="bucket-area-classes"> · {data.classes.map((c) => `${c.code} ${fh(c.hours)} h`).join(', ')}</span>}
      </p>
      {data.events > 0 && (
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }} data-testid="bucket-area-failures">
          {data.failures === 0
            ? t('None of them is a failure, so they are not in the failure Pareto above.')
            : t('{n} of them are failures; those are also in "Not counted as own".', { n: fint(data.failures) })}
        </p>
      )}
      {bars.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>{t('None in this range.')}</p> : (
        <ul className="bucket-list">
          {bars.map((b) => (
            <li key={b.key}>
              <span>
                <button type="button" className="row-btn mono" onClick={() => onOpen(`${title}: ${b.label}`, b.eventIds)}>{b.label}</button>
                <span className="muted bucket-detail"> · {t('{n} stops', { n: fint(b.eventIds.length) })}</span>
              </span>
              <b>{fh(b.value)} h</b>
            </li>
          ))}
          {data.byArea.entryCount > bars.length && <li><span className="muted">{t('and {n} more areas', { n: data.byArea.entryCount - bars.length })}</span><span /></li>}
        </ul>
      )}
      {all.length > 0 && (
        <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => onOpen(title, all)} data-testid="bucket-area-open">
          {t('Open {n} records', { n: fint(all.length) })}
        </button>
      )}
    </section>
  );
}

export default function Pareto() {
  const dash = useDash();
  const { ctx } = dash;
  const mobile = useIsMobile();
  const drill = useDrill(dash, 'Pareto');
  const [sub, setSub] = useState<Sub>('equipment');
  const [split, setSplit] = useState(false);
  const [eqCode, setEqCode] = useState('');
  const [eqMeasure, setEqMeasure] = useState<'hours' | 'count'>('hours');
  const [classAll, setClassAll] = useState(true);

  const eq = useMemo(() => (ctx ? equipmentModel(ctx) : null), [ctx]);
  const reasons = useMemo(() => (ctx && sub === 'reason' ? reasonModel(ctx, split) : null), [ctx, sub, split]);
  // "Stopped by other areas": next to each code, the area(s) it is listed under and the area(s) that stopped because of it
  const otherDetail = useMemo(() => {
    if (!ctx) return undefined;
    const areaOfEvent = new Map(ctx.scope.failureChains.map((c) => [c.id, c.area_id]));
    return (b: ParetoBar): string => {
      const owners = [...areasOf(ctx.master.index, b.key)].sort();
      const stopped = [...new Set(b.eventIds.map((id) => areaOfEvent.get(id)).filter((a): a is string => !!a))].sort();
      return `${t('listed under {areas}', { areas: owners.join(', ') || '-' })} · ${t('stopped {areas}', { areas: stopped.join(', ') || '-' })}`;
    };
  }, [ctx]);
  const codes = useMemo(() => (eq ? eq.count.own.bars.map((b) => b.key).sort() : []), [eq]);
  const code = eqCode && codes.includes(eqCode) ? eqCode : (eq?.hours.own.bars[0]?.key ?? '');
  const reasonEq = useMemo(() => (ctx && sub === 'reason' && code ? reasonForEquipmentModel(ctx, code, split, eqMeasure) : null), [ctx, sub, code, split, eqMeasure]);
  const areaH = useMemo(() => (ctx && sub === 'area' ? areaModel(ctx, 'hours') : null), [ctx, sub]);
  const areaC = useMemo(() => (ctx && sub === 'area' ? areaModel(ctx, 'count') : null), [ctx, sub]);
  const cls = useMemo(() => (ctx && sub === 'area' ? classModel(ctx, 'hours', !classAll) : null), [ctx, sub, classAll]);
  const clsCount = useMemo(() => (ctx && sub === 'area' ? classModel(ctx, 'count', !classAll) : null), [ctx, sub, classAll]);
  const lineH = useMemo(() => (ctx && sub === 'area' ? lineModel(ctx, 'hours') : null), [ctx, sub]);
  const lineC = useMemo(() => (ctx && sub === 'area' ? lineModel(ctx, 'count') : null), [ctx, sub]);
  const reasonMonth = useMemo(() => (ctx && sub === 'reason' ? reasonMonthModel(ctx) : null), [ctx, sub]);
  const [rmMeasure, setRmMeasure] = useState<'hours' | 'count'>('hours');
  const rows = useMemo(() => (ctx ? rowsInRange(ctx.scope, ctx.win.range) : null), [ctx]);

  const open = (prefix: string) => (label: string, ids: string[]) => drill(`${prefix} ${label}`, { eventIds: ids });
  // "Create action" in a bar's tooltip, for people who may create actions
  const createAction = useCreateAction();
  const act = (dim: ParetoDim, chart: string, equipment?: string) => (createAction
    ? (b: ParetoBar) => createAction(paretoPrefill({ dim, key: b.key, label: b.label, eventIds: b.eventIds, hours: chart.includes(t('hours')) ? b.value : undefined, chart, equipment }))
    : undefined);
  const win = ctx?.win.effective;
  const hoursTot = eq?.hours.own.total ?? 0;
  const empty = !!eq && rows !== null && rows.length === 0;
  const takeaway = !ctx ? t('Loading…') : empty ? t(EMPTY_SCOPE_TAKEAWAY) : eq && win
    ? paretoTakeaway({
      totalHours: hoursTot, codeCount: eq.hours.own.entryCount,
      top: eq.hours.own.bars.filter((b) => !b.isOthers).slice(0, 3).map((b) => ({ label: b.label, value: b.value, sharePct: b.sharePct })),
    })
    : paretoTakeaway(null);

  const bucketTotal = (r: ParetoResult) => r.total;
  const tabs: { id: Sub; label: string }[] = [{ id: 'equipment', label: t('Equipment') }, { id: 'reason', label: t('Reasons') }, { id: 'area', label: t('Lines, areas and classes') }];

  return (
    <div className="page dash-page" data-testid="page-pareto">
      <DashTop
        title={t('Pareto & Contributors')} takeaway={takeaway} dash={dash} eventCount={rows ? rows.length : null} hideCompare
        right={<button type="button" className="btn btn-sm" onClick={dash.reload} data-testid="refresh"><Icon name="sync" size={14} /> {t('Refresh')}</button>}
      />
      {empty && <EmptyScope dash={dash} />}
      {eq && !empty && (
        <div className="kpi-grid" data-testid="pareto-tiles">
          <Tile compact={mobile} icon="clock" label={t('Failure hours (own equipment)')} value={<span data-testid="pt-hours">{fh(eq.hours.own.total)} h</span>} sub={t('equipment code belongs to the stopped area')} />
          <Tile compact={mobile} icon="alert" label={t('Failure events (own equipment)')} value={<span data-testid="pt-count">{fint(eq.count.own.total)}</span>} sub={t('{n} different codes', { n: fint(eq.count.own.entryCount) })} />
          <Tile compact={mobile} icon="limits" label={t('Top equipment')} value={eq.hours.own.bars[0]?.label ?? t('None recorded')} sub={eq.hours.own.bars[0] ? `${fh(eq.hours.own.bars[0].value)} h · ${eq.hours.own.bars[0].sharePct.toFixed(1)}%` : undefined} />
          <Tile compact={mobile} icon="info" label={t('Not counted as own')} value={fh(bucketTotal(eq.hours.otherAreas) + bucketTotal(eq.hours.areaLevel) + bucketTotal(eq.hours.unknown) + bucketTotal(eq.hours.unassigned)) + ' h'} sub={t('other areas, area-level, unknown codes')} />
        </div>
      )}
      {ctx && !eq && <NoData reason={t('No data covers the selected period.')} />}
      {eq && !empty && (
        <>
          <div role="group" className="chip-row" aria-label={t('Pareto view')} style={{ marginBottom: 12 }}>
            {tabs.map((x) => <button key={x.id} type="button" className={sub === x.id ? 'chip chip--on' : 'chip'} aria-pressed={sub === x.id} onClick={() => setSub(x.id)} data-testid={`sub-${x.id}`}>{x.label}</button>)}
          </div>
          {sub === 'equipment' && (
            <>
              <div className="chart-grid">
                <ParetoCard title={t('Equipment by failure hours')} subtitle={t('Own-stop rule: only codes that belong to the stopped area')} all={eq.hours.own} what={t('failure hours')} unit="h" fmt={fh} testid="pareto-eq-hours" onOpen={open(t('the Pareto bar'))} onAction={act('equipment', t('Equipment by failure hours'))} />
                <ParetoCard title={t('Equipment by failure frequency')} subtitle={t('Failure events that started in the range')} all={eq.count.own} what={t('failures')} unit={t('events')} fmt={fint} testid="pareto-eq-count" onOpen={open(t('the Pareto bar'))} onAction={act('equipment', t('Equipment by failure frequency'))} />
              </div>
              <div className="bucket-grid" data-testid="buckets">
                <Bucket title={t('Stopped by other areas')} note={t('The code belongs to another area only; not counted above so a cause is never counted twice.')} result={eq.hours.otherAreas} testid="bucket-other" onOpen={open(t('the bucket'))} detail={otherDetail} />
                <AreaLevelCard data={eq.areaLevel} onOpen={open(t('the bucket'))} />
                <Bucket title={t('Unknown code')} note={t('The code is not in the equipment master.')} result={eq.hours.unknown} testid="bucket-unknown" onOpen={open(t('the bucket'))} />
                <Bucket title={t('Code in no area')} note={t('The code exists but is not assigned to any area.')} result={eq.hours.unassigned} testid="bucket-unassigned" onOpen={open(t('the bucket'))} />
              </div>
            </>
          )}
          {sub === 'reason' && (
            <>
              <div style={{ marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="field-label">{t('Same reason text under different classifications')}</span>
                <Toggle value={split ? 'split' : 'merge'} options={[{ value: 'merge', label: t('Merge') }, { value: 'split', label: t('Split by classification') }]} onChange={(v) => setSplit(v === 'split')} label={t('Reason grouping')} testid="reason-split" />
              </div>
              <div className="chart-grid">
                <ParetoCard title={t('Reasons by failure hours')} all={reasons?.hours ?? null} what={t('failure hours')} unit="h" fmt={fh} testid="pareto-reason-hours" onOpen={open(t('the Pareto bar'))} onAction={act('reason', t('Reasons by failure hours'))} />
                <ParetoCard title={t('Reasons by failure frequency')} all={reasons?.count ?? null} what={t('failures')} unit={t('events')} fmt={fint} testid="pareto-reason-count" onOpen={open(t('the Pareto bar'))} onAction={act('reason', t('Reasons by failure frequency'))} />
              </div>
              <ParetoCard
                title={t('Reasons for one equipment code')} subtitle={t('Why does {c} fail?', { c: code || '-' })} all={reasonEq} what={t('failures')} unit={eqMeasure === 'hours' ? 'h' : t('events')} fmt={eqMeasure === 'hours' ? fh : fint}
                testid="pareto-reason-equipment" onOpen={open(t('the Pareto bar'))} onAction={act('reason', t('Reasons for {c}', { c: code }), code)}
                controls={(
                  <>
                    <div className="field" style={{ minWidth: 150 }}>
                      <label htmlFor="eq-code">{t('Equipment code')}</label>
                      <select id="eq-code" className="select" value={code} onChange={(e) => setEqCode(e.target.value)} data-testid="eq-code">
                        {codes.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <Toggle value={eqMeasure} options={[{ value: 'hours', label: t('Hours') }, { value: 'count', label: t('Frequency') }]} onChange={setEqMeasure} label={t('Measure')} testid="eq-measure" />
                  </>
                )}
              />
              {reasonMonth && (() => {
                const heat = rmMeasure === 'hours' ? reasonMonth.hours : reasonMonth.count;
                const heatAll = rmMeasure === 'hours' ? reasonMonth.hoursAll : reasonMonth.countAll;
                const f = rmMeasure === 'hours' ? fh : fint;
                const u = rmMeasure === 'hours' ? 'h' : t('events');
                return (
                  <ChartCard
                    title={t('Reasons by month')} subtitle={t('Failure events by the reason of the event; the largest 12 reasons against the months of the range')} testid="chart-heat-reason-month"
                    summary={heat.rows.length ? t('{n} of {m} reasons shown, {t} {u} in total across {c} months.', { n: heat.rows.length, m: heatAll.rows.length, t: f(heat.total), u, c: heat.cols.length }) : t('No failure events in this range.')}
                    controls={<Toggle value={rmMeasure} options={[{ value: 'hours', label: t('Hours') }, { value: 'count', label: t('Count') }]} onChange={setRmMeasure} label={t('Measure')} testid="heat-reason-month-measure" />}
                    legend={[{ label: t('Darker = more'), color: ACCENT }]}
                    table={{ head: [t('Reason'), ...heatAll.cols.map((c) => c.label), t('Total')], rows: heatAll.rows.map((r, i) => [r.label, ...heatAll.values[i]!.map((v) => (v > 0 ? f(v) : '-')), f(r.total)]) }}
                    footnote={rmMeasure === 'hours' ? t('Hours of an event that crosses a month end are split between the two months; the same reason text under different classifications is merged.') : t('An event is counted in the month it started.')}
                  >
                    {() => <HeatmapTable map={heat} full={heatAll} format={f} caption={t('Reasons by month')} rowHead={t('Reason')} shortCol={(l) => l.slice(2).replace('-', '/')} />}
                  </ChartCard>
                );
              })()}
            </>
          )}
          {sub === 'area' && (
            <div className="chart-grid">
              <ParetoCard title={t('Lines by failure hours')} subtitle={t('Failure events by the line of the stopped area (area-hours)')} all={lineH} what={t('failure hours')} unit="h" fmt={fh} testid="pareto-line-hours" onOpen={open(t('the Pareto bar'))} onAction={act('line', t('Lines by failure hours'))} />
              <ParetoCard title={t('Lines by failure frequency')} all={lineC} what={t('failures')} unit={t('events')} fmt={fint} testid="pareto-line-count" onOpen={open(t('the Pareto bar'))} />
              <ParetoCard title={t('Areas by failure hours')} subtitle={t('Failure events by stopped area (area-hours)')} all={areaH} what={t('failure hours')} unit="h" fmt={fh} testid="pareto-area-hours" onOpen={open(t('the Pareto bar'))} onAction={act('area', t('Areas by failure hours'))} />
              <ParetoCard title={t('Areas by failure frequency')} all={areaC} what={t('failures')} unit={t('events')} fmt={fint} testid="pareto-area-count" onOpen={open(t('the Pareto bar'))} />
              <ParetoCard
                title={t('Classifications by hours')} subtitle={classAll ? t('All events, including planned (PL) and other (CIR)') : t('Failure events only')} all={cls} what={t('hours')} unit="h" fmt={fh}
                testid="pareto-class" onOpen={open(t('the Pareto bar'))}
                controls={<Toggle value={classAll ? 'all' : 'fail'} options={[{ value: 'all', label: t('All events') }, { value: 'fail', label: t('Failures only') }]} onChange={(v) => setClassAll(v === 'all')} label={t('Classification scope')} testid="class-scope" />}
              />
              <ParetoCard
                title={t('Classifications by frequency')} subtitle={classAll ? t('All events, including planned (PL) and other (CIR)') : t('Failure events only')} all={clsCount} what={t('events')} unit={t('events')} fmt={fint}
                testid="pareto-class-count" onOpen={open(t('the Pareto bar'))}
                controls={<Toggle value={classAll ? 'all' : 'fail'} options={[{ value: 'all', label: t('All events') }, { value: 'fail', label: t('Failures only') }]} onChange={(v) => setClassAll(v === 'all')} label={t('Classification scope')} testid="class-count-scope" />}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
