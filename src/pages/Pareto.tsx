import { useMemo, useState } from 'react';
import type { ParetoResult } from '../calc';
import { PageHeader, Tile } from '../components/Tile';
import { areaModel, classModel, equipmentModel, reasonForEquipmentModel, reasonModel } from '../dashboard/models';
import { DashStatus, NoData, rowsInRange, Toggle, useDrill } from '../dashboard/parts';
import ParetoCard from '../dashboard/ParetoCard';
import FilterBar from '../dashboard/FilterBar';
import { PhoneBar } from '../dashboard/PhoneBar';
import { fh, fint, rangeLabel } from '../dashboard/format';
import { useDash } from '../dashboard/useDash';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import '../components/ui.css';
import '../dashboard/dashboard.css';

type Sub = 'equipment' | 'reason' | 'area';

function Bucket({ title, note, result, testid, onOpen }: { title: string; note: string; result: ParetoResult; testid: string; onOpen: (label: string, ids: string[]) => void }) {
  const bars = result.bars.slice(0, 5);
  return (
    <section className="card" data-testid={testid}>
      <h2>{title}</h2>
      <p className="chart-sub">{note}</p>
      <p style={{ margin: '6px 0 0', fontSize: 13 }}><b data-testid={`${testid}-total`} className="mono">{fh(result.total)} h</b> · {fint(result.bars.reduce((s, b) => s + b.eventIds.length, 0))} {t('events')}</p>
      {bars.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>{t('None in this range.')}</p> : (
        <ul className="bucket-list">
          {bars.map((b) => (
            <li key={b.key}>
              <button type="button" className="row-btn mono" onClick={() => onOpen(`${title}: ${b.label}`, b.eventIds)}>{b.label}</button>
              <b>{fh(b.value)} h</b>
            </li>
          ))}
          {result.entryCount > bars.length && <li><span className="muted">{t('and {n} more', { n: result.entryCount - bars.length })}</span><span /></li>}
        </ul>
      )}
    </section>
  );
}

export default function Pareto() {
  const dash = useDash();
  const { ctx } = dash;
  const drill = useDrill(dash, 'Pareto');
  const [sub, setSub] = useState<Sub>('equipment');
  const [split, setSplit] = useState(false);
  const [eqCode, setEqCode] = useState('');
  const [eqMeasure, setEqMeasure] = useState<'hours' | 'count'>('hours');
  const [classAll, setClassAll] = useState(true);

  const eq = useMemo(() => (ctx ? equipmentModel(ctx) : null), [ctx]);
  const reasons = useMemo(() => (ctx && sub === 'reason' ? reasonModel(ctx, split) : null), [ctx, sub, split]);
  const codes = useMemo(() => (eq ? eq.count.own.bars.map((b) => b.key).sort() : []), [eq]);
  const code = eqCode && codes.includes(eqCode) ? eqCode : (eq?.hours.own.bars[0]?.key ?? '');
  const reasonEq = useMemo(() => (ctx && sub === 'reason' && code ? reasonForEquipmentModel(ctx, code, split, eqMeasure) : null), [ctx, sub, code, split, eqMeasure]);
  const areaH = useMemo(() => (ctx && sub === 'area' ? areaModel(ctx, 'hours') : null), [ctx, sub]);
  const areaC = useMemo(() => (ctx && sub === 'area' ? areaModel(ctx, 'count') : null), [ctx, sub]);
  const cls = useMemo(() => (ctx && sub === 'area' ? classModel(ctx, 'hours', !classAll) : null), [ctx, sub, classAll]);
  const rows = useMemo(() => (ctx ? rowsInRange(ctx.scope, ctx.win.range) : null), [ctx]);

  const open = (prefix: string) => (label: string, ids: string[]) => drill(`${prefix} ${label}`, { eventIds: ids });
  const win = ctx?.win.effective;
  const hoursTot = eq?.hours.own.total ?? 0;
  const subtitle = !ctx ? t('Loading…') : eq && win
    ? t('{h} failure hours on own equipment · {n} failure events · {r}', { h: fh(hoursTot), n: fint(eq.count.own.total), r: rangeLabel(win) })
    : t('No data for this range');

  const bucketTotal = (r: ParetoResult) => r.total;
  const tabs: { id: Sub; label: string }[] = [{ id: 'equipment', label: t('Equipment') }, { id: 'reason', label: t('Reasons') }, { id: 'area', label: t('Areas and classes') }];

  return (
    <div className="page dash-page" data-testid="page-pareto">
      <PageHeader title={t('Pareto & Contributors')} subtitle={subtitle} right={
        <button type="button" className="btn btn-sm" onClick={dash.reload} data-testid="refresh"><Icon name="sync" size={14} /> {t('Refresh')}</button>
      } />
      <DashStatus dash={dash} />
      <PhoneBar>{eq ? <><b>{fh(hoursTot)} h</b> {t('failure')}<span><span aria-hidden="true">◆</span> {fint(eq.count.own.total)} {t('events')}</span></> : subtitle}</PhoneBar>
      {eq && (
        <div className="kpi-grid" data-testid="pareto-tiles">
          <Tile icon="clock" label={t('Failure hours (own equipment)')} value={<span data-testid="pt-hours">{fh(eq.hours.own.total)} h</span>} sub={t('equipment code belongs to the stopped area')} />
          <Tile icon="alert" label={t('Failure events (own equipment)')} value={<span data-testid="pt-count">{fint(eq.count.own.total)}</span>} sub={t('{n} different codes', { n: fint(eq.count.own.entryCount) })} />
          <Tile icon="limits" label={t('Top equipment')} value={eq.hours.own.bars[0]?.label ?? t('None recorded')} sub={eq.hours.own.bars[0] ? `${fh(eq.hours.own.bars[0].value)} h · ${eq.hours.own.bars[0].sharePct.toFixed(1)}%` : undefined} />
          <Tile icon="info" label={t('Not counted as own')} value={fh(bucketTotal(eq.hours.otherAreas) + bucketTotal(eq.hours.areaLevel) + bucketTotal(eq.hours.unknown) + bucketTotal(eq.hours.unassigned)) + ' h'} sub={t('other areas, area-level, unknown codes')} />
        </div>
      )}
      <FilterBar dash={dash} eventCount={rows ? rows.length : null} hideCompare />
      {ctx && !eq && <NoData reason={t('No data covers the selected period.')} />}
      {eq && (
        <>
          <div role="group" className="chip-row" aria-label={t('Pareto view')} style={{ marginBottom: 12 }}>
            {tabs.map((x) => <button key={x.id} type="button" className={sub === x.id ? 'chip chip--on' : 'chip'} aria-pressed={sub === x.id} onClick={() => setSub(x.id)} data-testid={`sub-${x.id}`}>{x.label}</button>)}
          </div>
          {sub === 'equipment' && (
            <>
              <div className="chart-grid">
                <ParetoCard title={t('Equipment by failure hours')} subtitle={t('Own-stop rule: only codes that belong to the stopped area')} all={eq.hours.own} what={t('failure hours')} unit="h" fmt={fh} testid="pareto-eq-hours" onOpen={open(t('the Pareto bar'))} />
                <ParetoCard title={t('Equipment by failure frequency')} subtitle={t('Failure events that started in the range')} all={eq.count.own} what={t('failures')} unit={t('events')} fmt={fint} testid="pareto-eq-count" onOpen={open(t('the Pareto bar'))} />
              </div>
              <div className="bucket-grid" data-testid="buckets">
                <Bucket title={t('Stopped by other areas')} note={t('The code belongs to another area only; not counted above so a cause is never counted twice.')} result={eq.hours.otherAreas} testid="bucket-other" onOpen={open(t('the bucket'))} />
                <Bucket title={t('Area-level (N/A)')} note={t('The whole area stopped; no equipment code.')} result={eq.hours.areaLevel} testid="bucket-area" onOpen={open(t('the bucket'))} />
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
                <ParetoCard title={t('Reasons by failure hours')} all={reasons?.hours ?? null} what={t('failure hours')} unit="h" fmt={fh} testid="pareto-reason-hours" onOpen={open(t('the Pareto bar'))} />
                <ParetoCard title={t('Reasons by failure frequency')} all={reasons?.count ?? null} what={t('failures')} unit={t('events')} fmt={fint} testid="pareto-reason-count" onOpen={open(t('the Pareto bar'))} />
              </div>
              <ParetoCard
                title={t('Reasons for one equipment code')} subtitle={t('Why does {c} fail?', { c: code || '-' })} all={reasonEq} what={t('failures')} unit={eqMeasure === 'hours' ? 'h' : t('events')} fmt={eqMeasure === 'hours' ? fh : fint}
                testid="pareto-reason-equipment" onOpen={open(t('the Pareto bar'))}
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
            </>
          )}
          {sub === 'area' && (
            <div className="chart-grid">
              <ParetoCard title={t('Areas by failure hours')} subtitle={t('Failure events by stopped area (area-hours)')} all={areaH} what={t('failure hours')} unit="h" fmt={fh} testid="pareto-area-hours" onOpen={open(t('the Pareto bar'))} />
              <ParetoCard title={t('Areas by failure frequency')} all={areaC} what={t('failures')} unit={t('events')} fmt={fint} testid="pareto-area-count" onOpen={open(t('the Pareto bar'))} />
              <ParetoCard
                title={t('Classifications by hours')} subtitle={classAll ? t('All events, including planned (PL) and other (CIR)') : t('Failure events only')} all={cls} what={t('hours')} unit="h" fmt={fh}
                testid="pareto-class" onOpen={open(t('the Pareto bar'))}
                controls={<Toggle value={classAll ? 'all' : 'fail'} options={[{ value: 'all', label: t('All events') }, { value: 'fail', label: t('Failures only') }]} onChange={(v) => setClassAll(v === 'all')} label={t('Classification scope')} testid="class-scope" />}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
