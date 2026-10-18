// (1) The KPI row: total stoppage with its type split, failures, the reliability factor against its target, the
// all-area MTBF, MTTR, the utilization factor and the running hours, each with a monthly sparkline from January to the period (gaps for months not uploaded, a dashed
// last step for a month in progress).
import type { ReactNode } from 'react';
import { PaintSwatch, paintCss } from '../../charts/paint';
import { typePaints } from '../../charts/palette';
import { t } from '../../i18n/t';
import { monthShort, monthText } from '../../util/dates';
import { ChangeLine, fh, fh2, fint, fpct, metricText, MTBF_ALL_LABEL } from '../format';
import { InfoButton } from '../HeroKpi';
import { kpiInfo } from '../kpiInfo';
import type { OverviewModel } from '../models';
import { statusSymbol } from '../TargetStatus';
import type { TargetStatus } from '../targets';
import type { KpiSparks, Slot } from '../dashModels';

/** '▼ 9.4 pt below target', '✔ On target (+1.2 pt)', '▲ 0.31 h above target'. */
export function targetChipText(s: TargetStatus): string {
  const d = s.metric === 'mttr' ? 2 : 1;
  const unit = s.unit === '%' ? t('pt') : 'h';
  const gap = Math.abs(s.gap).toFixed(d);
  if (s.ok) return `${t('On target')} (${s.gap > 0 ? '+' : s.gap < 0 ? '−' : ''}${gap} ${unit})`;
  return s.state === 'below' ? t('{g} {u} below target', { g: gap, u: unit }) : t('{g} {u} above target', { g: gap, u: unit });
}

export function TargetChip({ status, testid }: { status: TargetStatus | null; testid: string }) {
  if (!status) return null;
  return (
    <span className={`tchip tchip--${status.ok ? 'ok' : 'bad'}`} data-testid={testid} data-state={status.state}>
      <span className="target-sym" aria-hidden="true">{statusSymbol(status)}</span> {targetChipText(status)}
    </span>
  );
}

/** 'Jan–Aug' (or 'Nov 2025–Aug 2026' across years). */
export function sparkSpan(slots: Slot[]): string {
  if (!slots.length) return '';
  const a = slots[0]!.key;
  const b = slots[slots.length - 1]!.key;
  if (a === b) return monthText(a);
  return a.slice(0, 4) === b.slice(0, 4) ? `${monthShort(a)}–${monthShort(b)}` : `${monthText(a)}–${monthText(b)}`;
}

/** Monthly sparkline: gaps stay gaps; a partial last month is drawn dashed with a hollow end point. */
export function MonthSpark({ slots, values, label, format, target }: { slots: Slot[]; values: (number | null)[]; label: string; format: (n: number) => string; target?: number | null }) {
  const W = 132;
  const H = 34;
  const pad = 5;
  const pts = values.map((v, i) => (v === null ? null : { v, i })).filter((p): p is { v: number; i: number } => p !== null);
  const span = sparkSpan(slots);
  if (pts.length < 2) {
    return (
      <svg className="mspark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('{l}: not enough months for a monthly trend', { l: label })} data-testid="spark">
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke="var(--tk-border)" strokeWidth="1.5" strokeDasharray="3 3" />
      </svg>
    );
  }
  const vals = [...pts.map((p) => p.v), ...(target != null ? [target] : [])];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const n = values.length;
  const x = (i: number) => pad + (n <= 1 ? 0 : (i / (n - 1)) * (W - 2 * pad));
  const y = (v: number) => (hi === lo ? H / 2 : H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad));
  const segs: { d: string; dashed: boolean }[] = [];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1]!;
    const b = pts[k]!;
    if (b.i !== a.i + 1) continue; // a month without a value is a gap
    segs.push({ d: `M${x(a.i).toFixed(1)} ${y(a.v).toFixed(1)}L${x(b.i).toFixed(1)} ${y(b.v).toFixed(1)}`, dashed: slots[b.i]?.status === 'partial' || slots[a.i]?.status === 'partial' });
  }
  const last = pts[pts.length - 1]!;
  const gaps = slots.filter((s) => s.status === 'notUploaded').map((s) => monthText(s.key));
  const name = t('{l}, monthly trend {s}: from {a} to {b}, lowest {lo}, highest {hi}', { l: label, s: span, a: format(pts[0]!.v), b: format(last.v), lo: format(Math.min(...pts.map((p) => p.v))), hi: format(Math.max(...pts.map((p) => p.v))) })
    + (gaps.length ? `. ${t('Not uploaded')}: ${gaps.join(', ')}` : '');
  return (
    <svg className="mspark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={name} data-testid="spark">
      <title>{name}</title>
      {target != null && <line x1={pad} x2={W - pad} y1={y(target)} y2={y(target)} stroke="var(--tk-text-secondary)" strokeWidth="1.2" strokeDasharray="3 3" />}
      {segs.map((s, k) => <path key={k} d={s.d} fill="none" stroke="var(--tk-text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeDasharray={s.dashed ? '3 3' : undefined} />)}
      {pts.filter((p) => !segs.length || ((values[p.i - 1] ?? null) === null && (values[p.i + 1] ?? null) === null)).map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r="1.8" fill="var(--tk-text-secondary)" />)}
      <circle cx={x(last.i)} cy={y(last.v)} r="3.4" fill="var(--tk-card-bg)" stroke="var(--tk-text-primary)" strokeWidth="1.8" />
    </svg>
  );
}

function Tile({ id, label, info, value, unit, after, extra, change, sub, children, spark, wide }: {
  id: string; label: string; info: ReactNode; value: string;
  /** part of the value ('h', '%'): the figure reads '374.5 h' as everywhere else */
  unit?: string;
  /** words after the value ('events') */
  after?: string;
  extra?: ReactNode; change?: ReactNode; sub?: ReactNode; children?: ReactNode;
  spark: ReactNode; wide?: boolean;
}) {
  return (
    <div className={wide ? 'ktile ktile--wide' : 'ktile'} data-testid={`kpi-${id}`}>
      <div className="ktile-head"><span className="ktile-label">{label}</span>{info}</div>
      <div className="ktile-value-row">
        <span className="ktile-value"><span data-testid={`kpi-${id}-value`}>{value}{unit && <small>{unit === '%' ? '%' : ` ${unit}`}</small>}</span>{after && <small>{` ${after}`}</small>}</span>
        {extra}
      </div>
      {change}
      {sub && <span className="ktile-sub">{sub}</span>}
      {children}
      <div className="ktile-spark">{spark}</div>
    </div>
  );
}

export default function KpiRow({ model, sparks, basis, cmpLabel, prevLabel, dark }: {
  model: OverviewModel; sparks: KpiSparks | null; basis: 'A' | 'B' | 'C'; cmpLabel: string;
  /** 'Jul' (the comparison period in one word) or '' */
  prevLabel: string;
  dark: boolean;
}) {
  const kpi = model.kpi!;
  const tot = kpi.total;
  const prev = model.prev?.total ?? null;
  const ch = model.changes;
  const cmp = model.compare;
  const paints = typePaints(dark);
  const split = [tot.failureHours, tot.plannedHours, tot.otherHours];
  const splitSum = split.reduce((a, b) => a + b, 0);
  const slots = sparks?.slots ?? [];
  const spanText = sparkSpan(slots);
  const sparkFoot = (s: ReactNode) => (
    <>
      {s}
      <span className="ktile-spark-note">{spanText}<br /><span className="ksn-by">{t('by month')}</span></span>
    </>
  );
  const mttr = metricText(tot.mttrHours, fh2, '');
  const mtbf = metricText(tot.mtbfHours, fh, '');
  const pctText = (m: typeof tot.reliabilityFactor) => metricText(m, (n) => (n * 100).toFixed(1), '');
  const rf = pctText(tot.reliabilityFactor);
  const uf = pctText(tot.utilizationFactor);
  const rfPct = tot.reliabilityFactor.available ? tot.reliabilityFactor.value * 100 : null;
  const rfTarget = model.targets.reliabilityPct ?? null;
  const prevRf = prev && prev.reliabilityFactor.available ? fpct(prev.reliabilityFactor.value) : null;
  const pre = prevLabel ? `${prevLabel} ` : `${t('Before')} `;
  const run = model.running;
  const runText = run ? metricText(run.value, fh, '') : { text: '', unavailable: true, reason: undefined };

  return (
    <div className="krow" data-testid="hero-kpis">
      <Tile
        id="total-hours" label={t('Total stoppage')} info={<InfoButton info={kpiInfo('total-hours', basis)} testid="kpi-total-hours-info" />}
        value={fh(tot.downtimeHours)} unit="h" wide
        change={<ChangeLine change={model.downtimeChange} fmt={fh} unit=" h" label={cmpLabel} compare={cmp} />}
        spark={sparkFoot(sparks && <MonthSpark slots={slots} values={sparks.downtimeHours} label={t('Total stoppage')} format={(n) => `${fh(n)} h`} />)}
      >
        <div className="ksplit" role="img" aria-label={t('Incidental {a} h, planned {b} h, CIR {c} h', { a: fh(split[0]!), b: fh(split[1]!), c: fh(split[2]!) })} data-testid="kpi-split">
          {split.map((v, i) => (v > 0 ? <span key={i} style={{ ...paintCss(paints[i]!), flexGrow: v / (splitSum || 1) }} /> : null))}
        </div>
        <ul className="ksplit-legend">
          {paints.map((p, i) => <li key={p.key}><PaintSwatch paint={p} /> {p.short} <b>{fh(split[i]!)}</b></li>)}
        </ul>
      </Tile>
      <Tile
        id="failure-count" label={t('Failures')} info={<InfoButton info={kpiInfo('failure-count', basis)} testid="kpi-failure-count-info" />}
        value={tot.failureCount === 0 ? t('None recorded') : fint(tot.failureCount)} after={tot.failureCount === 0 ? undefined : t('events')}
        change={<ChangeLine change={ch?.failureCount ?? null} fmt={fint} label={cmpLabel} compare={cmp} />}
        sub={`${prev ? `${pre}${fint(prev.failureCount)} · ` : ''}${t('{h} h lost', { h: fh(tot.failureHours) })}`}
        spark={sparkFoot(sparks && <MonthSpark slots={slots} values={sparks.failureCount} label={t('Failures')} format={fint} />)}
      />
      <Tile
        id="reliability" label={t('Reliability (RF)')} info={<InfoButton info={kpiInfo('reliability', basis, model.targets)} testid="kpi-reliability-info" />}
        value={rf.text} unit={rf.unavailable ? undefined : '%'}
        extra={<TargetChip status={model.status.reliability ?? null} testid="kpi-reliability-target" />}
        sub={<>{rfTarget !== null ? <>{t('Target')} <b>{rfTarget}%</b>{prevRf ? ' · ' : ''}</> : null}{prevRf ? `${pre}${prevRf}` : null}{rfTarget === null && !prevRf ? (rf.reason ?? t('Running ÷ (running + INC)')) : null}</>}
        change={rfTarget === null ? <ChangeLine change={ch?.reliabilityFactor ?? null} fmt={(n) => (n * 100).toFixed(1)} unit=" pts" label={cmpLabel} compare={cmp} /> : undefined}
        spark={sparkFoot(sparks && <MonthSpark slots={slots} values={sparks.reliability.map((v) => (v === null ? null : v * 100))} label={t('Reliability (RF)')} format={(n) => `${n.toFixed(1)}%`} target={rfTarget} />)}
      >
        {rfPct !== null && (
          <div className="kmeter" aria-hidden="true">
            <span className="kmeter-fill" style={{ width: `${Math.max(0, Math.min(100, rfPct))}%` }} />
            {rfTarget !== null && <span className="kmeter-target" style={{ left: `${Math.max(0, Math.min(100, rfTarget))}%` }} />}
          </div>
        )}
      </Tile>
      <Tile
        id="mtbf" label={t(MTBF_ALL_LABEL)} info={<InfoButton info={kpiInfo('mtbf', basis, model.targets)} testid="kpi-mtbf-info" />}
        value={mtbf.text} unit={mtbf.unavailable || !tot.mtbfHours.available ? undefined : 'h'}
        extra={<TargetChip status={model.status.mtbf} testid="kpi-mtbf-target" />}
        change={<ChangeLine change={ch?.mtbfHours ?? null} fmt={fh} unit=" h" label={cmpLabel} compare={cmp} />}
        sub={mtbf.reason ?? t('Run area-hours ÷ failures')}
        spark={sparkFoot(sparks && <MonthSpark slots={slots} values={sparks.mtbfHours} label={t(MTBF_ALL_LABEL)} format={(n) => `${fh(n)} h`} />)}
      />
      <Tile
        id="mttr" label={t('MTTR')} info={<InfoButton info={kpiInfo('mttr', basis, model.targets)} testid="kpi-mttr-info" />}
        value={mttr.text} unit={mttr.unavailable || !tot.mttrHours.available ? undefined : 'h'}
        extra={<TargetChip status={model.status.mttr} testid="kpi-mttr-target" />}
        change={<ChangeLine change={ch?.mttrHours ?? null} fmt={fh2} unit=" h" label={cmpLabel} compare={cmp} />}
        sub={mttr.reason ?? t('Avg repair per failure')}
        spark={sparkFoot(sparks && <MonthSpark slots={slots} values={sparks.mttrHours} label={t('MTTR')} format={(n) => `${fh2(n)} h`} />)}
      />
      <Tile
        id="utilization" label={t('Utilization (UF)')} info={<InfoButton info={kpiInfo('utilization', basis, model.targets)} testid="kpi-utilization-info" />}
        value={uf.text} unit={uf.unavailable ? undefined : '%'}
        change={<ChangeLine change={ch?.utilizationFactor ?? null} fmt={(n) => (n * 100).toFixed(1)} unit=" pts" label={cmpLabel} compare={cmp} />}
        sub={uf.reason ?? t('Running ÷ calendar hours')}
        spark={sparkFoot(sparks && <MonthSpark slots={slots} values={sparks.utilization.map((v) => (v === null ? null : v * 100))} label={t('Utilization (UF)')} format={(n) => `${n.toFixed(1)}%`} />)}
      />
      {run && (
        <Tile
          id="running-hours" label={t('Running hours')}
          info={<InfoButton info={kpiInfo('running-hours', basis, model.targets, run.value.available ? {
            perDay: fh(run.days > 0 && run.areas > 0 ? run.scheduledHours / (run.days * run.areas) : 0), scheduled: fh(run.scheduledHours), stopped: fh(run.stoppedHours),
            running: fh(run.value.value), days: run.days, areas: run.areas, notUploaded: run.notUploaded.map(monthText),
          } : undefined)} testid="kpi-running-hours-info" />}
          value={runText.text} unit={runText.unavailable || !run.value.available ? undefined : 'h'}
          change={<ChangeLine change={run.change} fmt={fh} unit=" h" label={cmpLabel} compare={cmp} />}
          sub={runText.reason ?? t('Scheduled − stopped, area-hours')}
          spark={sparkFoot(sparks && <MonthSpark slots={slots} values={sparks.operatingHours} label={t('Running hours')} format={(n) => `${fh(n)} h`} />)}
        />
      )}
    </div>
  );
}
