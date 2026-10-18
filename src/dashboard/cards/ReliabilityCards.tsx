// Cards 8-12 of the Dashboard: failures and repair time by month, the MTBF / MTTR quadrant, repeated failures, the
// availability heat map against the target and the worst days.
import { useMemo, useState, type KeyboardEvent } from 'react';
import ColumnChart, { type ColSlot } from '../../charts/ColumnChart';
import { useMeasure } from '../../charts/ChartKit';
import OccurrenceStrip from '../../charts/OccurrenceStrip';
import QuadrantChart from '../../charts/QuadrantChart';
import { typePaints } from '../../charts/palette';
import { AXIS, GRID } from '../../charts/palette';
import { linear, niceTicks } from '../../charts/scale';
import { useIsMobile } from '../../hooks/useIsMobile';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { dayText, monthShort, monthText, rangeText } from '../../util/dates';
import { num } from '../../util/format';
import { fh, fh2, fint, monthAxisLabels } from '../format';
import {
  availabilityHeat, failureIdsStarted, failuresByMonth, idsWithHours, lastDays, periodText, plannedRuns, repeatsTop, scopeText,
  type FailMonth, type HeatMetric, type HeatTone,
} from '../dashModels';
import { store } from '../../storagePrefix';
import type { DashFilters } from '../filters';
import { areaReliabilityModel, ROLLING_DAYS, type OverviewModel } from '../models';
import type { DashCtx } from '../scope';
import DashCard, { OpenLink, Seg, type OpenFn } from './DashCard';

const HALO = { stroke: 'var(--tk-card-bg)', strokeWidth: 3, paintOrder: 'stroke' } as const;

// ---------------------------------------------------------------- (8) failing more, or repairing slower?

function FailMttrChart({ months, width, selected, onSelect, ariaLabel }: { months: FailMonth[]; width: number; selected: number | null; onSelect: (i: number | null) => void; ariaLabel: string }) {
  const n = months.length;
  const labels = monthAxisLabels(months.map((m) => m.key));
  const m = { l: 40, r: 8 };
  const pw = Math.max(40, width - m.l - m.r);
  const band = pw / Math.max(1, n);
  const cx = (i: number) => m.l + band * (i + 0.5);
  const bw = Math.max(4, Math.min(52, band * 0.55));
  const top = { t: 26, h: 150 };
  const mid = top.t + top.h + 34;
  const low = { t: mid + 22, h: 90 };
  const H = low.t + low.h + 40;
  const fMax = niceTicks(0, Math.max(1, ...months.map((x) => x.failures ?? 0)), 3);
  const yF = linear(0, fMax.max, top.t + top.h, top.t);
  const mt = months.map((x) => x.mttr).filter((v): v is number => v !== null);
  const lo = mt.length ? Math.min(...mt) : 0;
  const hi = mt.length ? Math.max(...mt) : 1;
  const pad = (hi - lo) * 0.25 || hi * 0.1 || 0.5;
  const mScale = niceTicks(Math.max(0, lo - pad), hi + pad, 2);
  const yM = linear(mScale.min, mScale.max, low.t + low.h, low.t);
  const roomy = band >= 40;
  const line: string[] = [];
  let cur = '';
  months.forEach((x, i) => {
    if (x.mttr === null) { if (cur) line.push(cur); cur = ''; return; }
    cur += `${cur ? 'L' : 'M'}${cx(i).toFixed(1)} ${yM(x.mttr).toFixed(1)}`;
  });
  if (cur) line.push(cur);
  const onKey = (e: KeyboardEvent, i: number) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(selected === i ? null : i); } };
  const showVal = (i: number) => roomy || i === selected || i === n - 1 || i % 2 === 1;
  return (
    <svg width={width} height={H} role="group" aria-label={ariaLabel} data-testid="fail-mttr-chart" className="col-chart">
      {months.map((x, i) => ((x.inPeriod && months.some((y) => !y.inPeriod)) || i === selected
        ? <rect key={`hl${x.key}`} x={m.l + band * i + 1} y={top.t - 20} width={band - 2} height={H - top.t + 20 - 6} rx={6} fill={i === selected ? 'var(--tk-nav-active)' : 'var(--tk-info-bar-bg)'} />
        : null))}
      <text x={2} y={top.t - 12} className="chart-ink panel-title">{t('Failures (count)')}</text>
      {fMax.ticks.map((v) => (
        <g key={`f${v}`}><line x1={m.l} x2={m.l + pw} y1={yF(v)} y2={yF(v)} stroke={GRID} /><text x={m.l - 6} y={yF(v) + 4} textAnchor="end">{v}</text></g>
      ))}
      <line x1={m.l} x2={m.l + pw} y1={yF(0)} y2={yF(0)} stroke={AXIS} />
      {months.map((x, i) => {
        if (x.status === 'notUploaded') {
          const y0 = yF(fMax.max * 0.6);
          return <rect key={x.key} x={cx(i) - bw / 2} y={y0} width={bw} height={yF(0) - y0} rx={3} fill="none" stroke="var(--tk-text-muted)" strokeDasharray="4 3" data-testid="col-not-uploaded" />;
        }
        if (x.failures === null) return null;
        const yy = yF(x.failures);
        return (
          <g key={x.key}>
            <rect x={cx(i) - bw / 2} y={yy} width={bw} height={Math.max(0.5, yF(0) - yy)} rx={2} fill="var(--dt-inc)" opacity={x.status === 'partial' ? 0.45 : 1} stroke={x.status === 'partial' ? 'var(--tk-text-secondary)' : 'none'} strokeDasharray={x.status === 'partial' ? '4 2' : undefined} />
            {showVal(i) && <text x={cx(i)} y={yy - 6} textAnchor="middle" className="chart-ink" fontWeight={i === selected ? 700 : 500} {...HALO}>{fint(x.failures)}</text>}
          </g>
        );
      })}
      <text x={2} y={mid} className="chart-ink panel-title">{t('MTTR (h per failure)')}</text>
      {mScale.ticks.map((v) => (
        <g key={`m${v}`}><line x1={m.l} x2={m.l + pw} y1={yM(v)} y2={yM(v)} stroke={GRID} /><text x={m.l - 6} y={yM(v) + 4} textAnchor="end">{v.toFixed(1)}</text></g>
      ))}
      {line.map((d, k) => <path key={k} d={d} fill="none" stroke="var(--dt-pl)" strokeWidth={2.25} strokeLinejoin="round" />)}
      {months.map((x, i) => (x.mttr === null ? null : (
        <g key={`p${x.key}`}>
          <circle cx={cx(i)} cy={yM(x.mttr)} r={4} fill="var(--tk-card-bg)" stroke="var(--dt-pl)" strokeWidth={2} />
          {showVal(i) && <text x={cx(i)} y={yM(x.mttr) - 9} textAnchor="middle" className="chart-ink" fontWeight={i === selected ? 700 : 500} {...HALO}>{fh2(x.mttr)}</text>}
        </g>
      )))}
      {months.map((x, i) => (!(band < 34 && i % 2 !== (n - 1) % 2) || i === selected) ? (
        <g key={`l${x.key}`}>
          <text x={cx(i)} y={low.t + low.h + 18} textAnchor="middle" className={i === selected ? 'chart-ink' : undefined} fontWeight={i === selected ? 700 : 400}>{labels[i]}</text>
          {x.status !== 'full' && <text x={cx(i)} y={low.t + low.h + 33} textAnchor="middle" className="col-sub">{x.status === 'partial' ? 'partial' : x.status === 'notUploaded' ? 'n/u' : ''}</text>}
        </g>
      ) : null)}
      {months.map((x, i) => (
        <rect key={`h${x.key}`} className="chart-hit chart-focusable" x={m.l + band * i} y={top.t - 20} width={band} height={H - top.t + 14} role="button" tabIndex={i === (selected ?? 0) ? 0 : -1}
          aria-pressed={i === selected} aria-label={`${monthText(x.key)}: ${x.failures === null ? (x.status === 'notUploaded' ? t('not uploaded') : t('no data')) : t('{f} failures, MTTR {m}', { f: fint(x.failures), m: x.mttr === null ? '–' : `${fh2(x.mttr)} h` })}`}
          data-testid="col-hit" onClick={(e) => { e.stopPropagation(); onSelect(selected === i ? null : i); }} onKeyDown={(e) => onKey(e, i)} />
      ))}
    </svg>
  );
}

export function FailMttrCard({ ctx, filters, onOpen }: { ctx: DashCtx; filters: DashFilters; onOpen: OpenFn }) {
  const m = useMemo(() => failuresByMonth(ctx), [ctx]);
  const ids = useMemo(() => (m ? failureIdsStarted(ctx, m.range) : []), [ctx, m]);
  const [sel, setSel] = useState<number | null>(null);
  const [boxRef, width] = useMeasure<HTMLDivElement>();
  const s = sel !== null ? m?.months[sel] : undefined;
  const selIds = useMemo(() => (s?.window ? failureIdsStarted(ctx, s.window) : []), [ctx, s]);
  if (!m) return null;
  const withData = m.months.filter((x) => x.failures !== null);
  const lastFail = [...withData].reverse().find((x) => x.mttr !== null) ?? null;
  const summary = withData.length
    ? t('{n} months. Failures from {a} to {b} per month; MTTR from {c} to {d} h.', {
      n: m.months.length, a: fint(Math.min(...withData.map((x) => x.failures!))), b: fint(Math.max(...withData.map((x) => x.failures!))),
      c: fh2(Math.min(...withData.filter((x) => x.mttr !== null).map((x) => x.mttr!))), d: fh2(Math.max(...withData.filter((x) => x.mttr !== null).map((x) => x.mttr!))),
    })
    : t('No failures in this range.');
  return (
    <DashCard
      id="fail-mttr" testid="chart-fail-mttr" title={t('Are we failing more, or repairing slower?')}
      help={{ id: 'fail-mttr', vars: lastFail && lastFail.failures && lastFail.mttr !== null ? { m: monthText(lastFail.key), h: fh(lastFail.mttr * lastFail.failures), n: fint(lastFail.failures), mttr: fh2(lastFail.mttr) } : {} }}
      subtitle={t('Failures and repair time by month · shared months, separate scales')}
      legend={[{ kind: 'paint', paint: { color: 'var(--dt-inc)', pattern: 'solid' }, label: t('Failures (count)') }, { kind: 'line', color: 'var(--dt-pl)', label: t('MTTR (h)'), marker: true }]}
      summary={summary} scope={scopeText(m.range, filters, 'failures')} open={{ ids, label: t('Failures by month') }} onOpen={onOpen}
    >
      <div ref={boxRef} className="dcard-chart">
        {width > 0 && <FailMttrChart months={m.months} width={width} selected={sel} onSelect={setSel} ariaLabel={summary} />}
      </div>
      {s && (
        <div className="ddetail ddetail--row" data-testid="fail-detail" role="region" aria-label={monthText(s.key)}>
          <b>{monthText(s.key)}{s.status === 'partial' ? ` (${t('partial')})` : ''}</b>
          <span>{s.failures === null ? (s.status === 'notUploaded' ? t('Not uploaded') : t('No data')) : t('{f} failures · MTTR {m}', { f: fint(s.failures), m: s.mttr === null ? '–' : `${fh2(s.mttr)} h` })}</span>
          {s.failures !== null && <OpenLink spec={{ ids: selIds, label: t('Failures of {m}', { m: monthText(s.key) }) }} onOpen={onOpen} label={t('Open {n} records', { n: num(selIds.length) })} testid="fail-detail-open" />}
          <button type="button" className="ddetail-close" onClick={() => setSel(null)} aria-label={t('Close the details')}><Icon name="close" size={16} /></button>
        </div>
      )}
    </DashCard>
  );
}

// ---------------------------------------------------------------- (9) which areas need attention?

export function AttentionCard({ ctx, filters, onOpen }: { ctx: DashCtx; filters: DashFilters; onOpen: OpenFn }) {
  const mobile = useIsMobile();
  const eff = ctx.win.effective!;
  const m = useMemo(() => areaReliabilityModel(ctx), [ctx]);
  const ids = useMemo(() => failureIdsStarted(ctx, eff), [ctx, eff]);
  const [boxRef, width] = useMeasure<HTMLDivElement>();
  if (!m) return null;
  const q = m.quadrant;
  const summary = q.points.length === 0
    ? t('No area has both an MTBF and an MTTR in this range.')
    : `${t('{n} areas plotted.', { n: q.points.length })} ${q.medianMtbf !== null && q.medianMttr !== null ? t('Median MTBF {a} h, median MTTR {b} h.', { a: fh(q.medianMtbf), b: fh2(q.medianMttr) }) : ''} ${q.worst.length ? t('Fails often, slow to fix: {a}.', { a: q.worst.join(', ') }) : t('No area fails often and is slow to fix.')}`;
  return (
    <DashCard
      id="attention" testid="chart-quadrant" title={t('Which areas need attention?')}
      help={{ id: 'attention', vars: q.medianMtbf !== null && q.medianMttr !== null ? { mb: fh(q.medianMtbf), mr: fh2(q.medianMttr) } : {} }}
      subtitle={t('MTBF vs MTTR by area · dashed lines = median of {n} areas', { n: q.points.length })}
      legend={[{ kind: 'dot', color: 'var(--tk-danger)', label: t('Needs attention') }, { kind: 'dot', color: 'var(--tk-accent)', hollow: true, label: t('Other areas') }]}
      summary={summary} scope={scopeText(eff, filters, 'failures')} open={{ ids, label: t('Failures of all areas') }} onOpen={onOpen}
    >
      <div ref={boxRef} className="dcard-chart">
        {width > 0 && (
          <QuadrantChart
            width={width} height={mobile ? 330 : 360} xTitle={mobile ? t('MTBF (h, log) · fails less often →') : t('← fails more often · MTBF (h, log scale) · fails less often →')} yTitle={t('MTTR (h) · slower ↑')}
            medianX={q.medianMtbf} medianY={q.medianMttr}
            medianXLabel={q.medianMtbf !== null ? t('median {v} h', { v: fh(q.medianMtbf) }) : undefined} medianYLabel={q.medianMttr !== null ? t('median {v} h', { v: fh2(q.medianMttr) }) : undefined}
            worstLabel={t('Fails often, slow to fix')} ariaLabel={summary} xLog variant="dashboard"
            cornerLabels={mobile ? [t('Rare, slow'), t('Often, quick'), t('Rare, quick')] : [t('Rare, slow to fix'), t('Fails often, quick to fix'), t('Rare, quick to fix')]}
            points={q.points.map((p) => ({
              key: p.area_id, label: p.area_id, x: p.mtbf, y: p.mttr, worst: p.quadrant === 'worst',
              details: [{ label: t('MTBF'), value: `${fh(p.mtbf)} h` }, { label: t('MTTR'), value: `${fh2(p.mttr)} h` }, { label: t('Failure events'), value: fint(p.failureEvents) }],
            }))}
            openLabel={t('Open records')} onPoint={(p) => onOpen({ ids: m.failureIds.get(p.key) ?? [], label: t('Failures of {a}', { a: p.label }) })}
          />
        )}
      </div>
      {q.excluded.length > 0 && <p className="dcard-note">{t('Not plotted (no failures): {a}.', { a: q.excluded.map((x) => x.area_id).join(', ') })}</p>}
    </DashCard>
  );
}

// ---------------------------------------------------------------- (10) what keeps failing again?

export function RepeatsCard({ ctx, filters, onOpen, onAll }: { ctx: DashCtx; filters: DashFilters; onOpen: OpenFn; onAll: () => void }) {
  const mobile = useIsMobile();
  const m = useMemo(() => repeatsTop(ctx, 5), [ctx]);
  if (!m) return null;
  const s = ctx.master.settings;
  const groups = mobile ? m.groups.slice(0, 3) : m.groups;
  const share = m.failureHours > 0 ? (m.hours / m.failureHours) * 100 : 0;
  const summary = m.listed
    ? t('{n} repeated failures. Most: {c} {r}, {k} events.', { n: m.listed, c: m.groups[0]!.equipmentId, r: m.groups[0]!.reasonLabel, k: m.groups[0]!.occurrences })
    : t('No repeated failures in this period.');
  return (
    <DashCard
      id="repeats" testid="chart-repeats" title={t('What keeps failing again?')}
      help={{ id: 'repeats', vars: { n: s.repeatMinEvents, d: s.repeatWindowDays, ...(m.failureHours > 0 ? { h: fh(m.hours), t: fh(m.failureHours), p: `${share.toFixed(1)}%` } : {}) } }}
      subtitle={t('Repeated failures · same code + reason, {n}+ times in {d} days', { n: s.repeatMinEvents, d: s.repeatWindowDays })}
      headLink={<button type="button" className="dcard-link" onClick={onAll} data-testid="repeats-all">{t('All {n}', { n: m.listed })} <span aria-hidden="true">›</span></button>}
      summary={summary} scope={scopeText(m.window, filters, 'failures')} open={{ ids: m.ids, label: t('Repeated failures') }} onOpen={onOpen}
    >
      {groups.length === 0 ? <p className="muted">{t('No repeated failures in this period.')}</p> : (
        <ul className="rep-list">
          {groups.map((g) => (
            <li key={g.key} className="rep-row" data-testid="rep-row">
              <span className="rep-what">
                <span className="rep-title"><b>{g.equipmentId}</b> {g.reasonLabel}</span>
                <span className="rep-sub"><b>{g.occurrences}</b> {t('events')} · <b>{fh(g.totalHours)}</b> h{g.burstCount ? ` · ${t('{n} bursts', { n: g.burstCount })}` : ''}</span>
              </span>
              <span className="rep-strip"><OccurrenceStrip dates={g.occurrenceDates} from={m.window.from} to={m.window.to} label={`${g.equipmentId}, ${g.reasonLabel}`} /></span>
              <OpenLink spec={{ ids: g.eventIds, label: `${g.equipmentId} ${g.reasonLabel}` }} onOpen={onOpen} label={mobile ? '' : t('Open {n} records', { n: num(g.eventIds.length) })} testid="rep-open" className="rep-open" />
            </li>
          ))}
          {!mobile && <li className="rep-axis" aria-hidden="true"><span /><span className="rep-strip rep-strip-axis"><span>{dayText(m.window.from)}</span><span>{dayText(m.window.to)}</span></span><span /></li>}
        </ul>
      )}
      {m.listed > 0 && (
        <div className="rep-total" data-testid="rep-total">
          <p><b>{t('{n} repeat events · {h} h', { n: fint(m.events), h: fh(m.hours) })}</b> = {t('{p}% of all failure hours ({t} h)', { p: share.toFixed(1), t: fh(m.failureHours) })}</p>
          <span className="rep-bar"><span style={{ width: `${Math.min(100, share)}%` }} /></span>
          {m.bursts > 0 && <p className="dcard-note">{t('{n} of the occurrences are bursts (less than 1 h after the previous one in the same area): counted, and shown apart on Repeated failures.', { n: m.bursts })}</p>}
        </div>
      )}
    </DashCard>
  );
}

// ---------------------------------------------------------------- (11) is any area slipping over time?

const TONE_CLASS: Record<HeatTone, string> = { ok: 'hm-ok', near: 'hm-near', below: 'hm-below' };

const HEAT_KEY = 'heat_metric';
const HEAT_METRICS: HeatMetric[] = ['availability', 'reliability', 'utilization'];
const readHeatMetric = (): HeatMetric => {
  const v = store.get(HEAT_KEY);
  return HEAT_METRICS.includes(v as HeatMetric) ? (v as HeatMetric) : 'availability';
};

export function HeatCard({ ctx, filters, onOpen }: { ctx: DashCtx; filters: DashFilters; onOpen: OpenFn }) {
  const mobile = useIsMobile();
  const [all, setAll] = useState(false);
  const [metric, setMetricState] = useState<HeatMetric>(readHeatMetric);
  const setMetric = (v: HeatMetric) => { setMetricState(v); store.set(HEAT_KEY, v); };
  const m = useMemo(() => availabilityHeat(ctx, metric), [ctx, metric]);
  const ids = useMemo(() => (m ? idsWithHours(ctx, m.range) : []), [ctx, m]);
  if (!m) return null;
  const tg = m.target;
  const rows = mobile && !all ? m.rows.slice(0, 6) : m.rows;
  const vals = m.rows.flatMap((r) => r.cells.map((c) => c.pct)).filter((v): v is number => v !== null);
  const lo = vals.length ? Math.floor(Math.min(...vals)) : 0;
  const hi = vals.length ? Math.ceil(Math.max(...vals)) : 100;
  // no target: a neutral sequential scale (darker = lower), never red / green
  const neutral = (v: number) => {
    const k = hi > lo ? (hi - v) / (hi - lo) : 0;
    return { background: `color-mix(in srgb, var(--tk-accent) ${Math.round(8 + k * 52)}%, var(--tk-card-bg))`, color: k > 0.6 ? 'var(--tk-accent-text)' : 'var(--tk-text-primary)' };
  };
  const label = (k: string) => (mobile ? monthShort(k).slice(0, 1) : monthShort(k));
  const sortName = m.sortMonth ? monthShort(m.sortMonth) : '';
  const basis = ctx.master.settings.availabilityBasis;
  const what = metric === 'reliability' ? t('Reliability factor (RF)') : metric === 'utilization' ? t('Utilization factor (UF)') : t('Availability');
  const short = metric === 'reliability' ? 'RF' : metric === 'utilization' ? 'UF' : t('Availability');
  const summary = `${what}: ${t('{n} areas by month', { n: m.rows.length })}${sortName ? `, ${t('worst {m} first', { m: sortName })}` : ''}. ${tg !== null ? t('Green: at or above {x}%; amber: up to 5 points below; red: further below.', { x: tg }) : metric === 'utilization' ? t('No target for UF: darker = lower.') : t('No target set: darker = lower.')}`;
  const sortAt = m.months.findIndex((x) => x.key === m.sortMonth);
  // a phone shows at most 8 months: those up to the month after the sorted one
  const end = mobile ? Math.min(m.months.length, (sortAt >= 0 ? sortAt : m.months.length - 1) + 2) : m.months.length;
  const start = mobile ? Math.max(0, end - 8) : 0;
  const months = m.months.slice(start, end);
  const sortIdx = sortAt - start;
  const names = !mobile && m.months.length <= 9;
  return (
    <DashCard
      id="heat" testid="chart-avail-heat" title={t('Is any area slipping over time?')}
      help={{ id: 'heat', vars: { b: basis } }}
      subtitle={`${metric === 'availability' ? t('Availability heatmap, area × month (basis {b}, %)', { b: basis }) : t('{w} heatmap, area × month (%)', { w: what })}${sortName ? ` · ${t('worst {m} first', { m: sortName })}` : ''}`}
      controls={<Seg value={metric} options={[{ value: 'availability', label: mobile ? t('Avail.') : t('Availability') }, { value: 'reliability', label: 'RF' }, { value: 'utilization', label: 'UF' }]} onChange={setMetric} label={t('Show')} testid="heat-metric" />}
      headLink={mobile && m.rows.length > 6 ? <button type="button" className="dcard-link" onClick={() => setAll((v) => !v)} aria-expanded={all} data-testid="heat-all">{all ? t('Worst 6') : t('All {n}', { n: m.rows.length })} <span aria-hidden="true">›</span></button> : undefined}
      legend={tg !== null ? [
        { kind: 'box', className: 'hm-ok', label: mobile ? `≥ ${tg}` : t('At or above {x}%', { x: tg }) },
        { kind: 'box', className: 'hm-near', label: mobile ? `${tg - 5}–${tg}` : t('{a}–{b}% (dots)', { a: tg - 5, b: tg }) },
        { kind: 'box', className: 'hm-below', label: mobile ? `< ${tg - 5}` : t('Below {a}% (hatch)', { a: tg - 5 }) },
        { kind: 'box', className: 'hm-nodata', label: t('No data') },
      ] : [{ kind: 'box', className: 'hm-scale', label: t('Darker = lower') }, { kind: 'box', className: 'hm-nodata', label: t('No data') }]}
      summary={summary} scope={scopeText(m.range, filters, 'all')} open={{ ids, label: t('{w} by area and month', { w: what }) }} onOpen={onOpen}
    >
      {tg === null && metric !== 'utilization' && <p className="at-note" data-testid="heat-no-target">{metric === 'reliability' ? t('No RF target is set: the colours show lower and higher only (darker = lower), not on or below target.') : t('No availability target is set: the colours show lower and higher only (darker = lower), not on or below target.')}</p>}
      <div className="hm-wrap">
        <table className="hm" data-testid="heat-table">
          <caption className="sr-only">{t('{w} by area and month', { w: what })}</caption>
          <thead>
            <tr>
              <th scope="col" className="hm-corner"><span className="sr-only">{t('Area')}</span></th>
              {months.map((x, i) => <th key={x.key} scope="col" className={i === sortIdx ? 'hm-col hm-col--sel' : 'hm-col'} title={monthText(x.key)}>{label(x.key)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.area_id} data-testid="heat-row" data-area={r.area_id}>
                <th scope="row" className="hm-row"><span className="hm-rowname" title={r.name ? `${r.area_id} ${r.name}` : r.area_id}><b>{r.area_id}</b>{r.name && names && <span className="muted"> {r.name}</span>}</span></th>
                {r.cells.slice(start, end).map((c, i) => {
                  const cls = `hm-cell${i === sortIdx ? ' hm-cell--sel' : ''}${ri === 0 && i === sortIdx ? ' hm-cell--first' : ''}${ri === rows.length - 1 && i === sortIdx ? ' hm-cell--last' : ''}`;
                  if (c.pct === null) {
                    return (
                      <td key={i} className={`${cls} hm-nodata`} data-status={c.status} title={`${r.area_id}, ${monthText(months[i]!.key)}: ${c.status === 'notUploaded' ? t('Not uploaded') : t('no data')}`}>
                        {ri === Math.floor((rows.length - 1) / 2) && c.status === 'notUploaded' ? <span className="hm-nu">{t('no data')}</span> : <span className="sr-only">{t('no data')}</span>}
                      </td>
                    );
                  }
                  return (
                    <td key={i} className={`${cls} ${c.tone ? TONE_CLASS[c.tone] : 'hm-scale-cell'}`} style={c.tone ? undefined : neutral(c.pct)} data-tone={c.tone ?? 'scale'}
                      title={`${r.area_id}, ${monthText(months[i]!.key)}: ${short} ${c.pct.toFixed(1)}%${c.status === 'partial' ? ` (${t('partial month')})` : ''}`}>
                      {c.pct.toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mobile && months.length < m.months.length && <p className="dcard-note">{t('Showing {a} – {b}; a larger screen shows every month.', { a: monthText(months[0]!.key), b: monthText(months[months.length - 1]!.key) })}</p>}
      {m.months.some((x) => x.status === 'partial') && <p className="dcard-note">{t('Partial months: {m}.', { m: m.months.filter((x) => x.status === 'partial').map((x) => (x.window ? rangeText(x.window) : monthText(x.key))).join(', ') })}</p>}
    </DashCard>
  );
}

// ---------------------------------------------------------------- (12) which days were worst?

export function DailyCard({ ctx, model, filters, dark, onOpen }: { ctx: DashCtx; model: OverviewModel; filters: DashFilters; dark: boolean; onOpen: OpenFn }) {
  const mobile = useIsMobile();
  const [allDays, setAllDays] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [boxRef, width] = useMeasure<HTMLDivElement>();
  const paints = typePaints(dark);
  const days = mobile && !allDays ? lastDays(model.daily, 14) : model.daily;
  const range = days.length ? { from: days[0]!.date, to: days[days.length - 1]!.date } : ctx.win.effective!;
  const ids = useMemo(() => idsWithHours(ctx, range), [ctx, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = sel !== null ? days[sel] : undefined;
  const selIds = useMemo(() => (s?.hasData ? idsWithHours(ctx, { from: s.date, to: s.date }) : []), [ctx, s]);
  const runs = useMemo(() => plannedRuns(days), [days]);
  const lastAvg = [...days].reverse().find((d) => d.rollingDowntimeHours !== null)?.rollingDowntimeHours ?? null;
  const cols: ColSlot[] = days.map((d, i) => ({
    key: d.date, label: i === 0 ? dayText(d.date) : String(Number(d.date.slice(8))), full: dayText(d.date),
    status: d.hasData ? 'full' : d.notUploaded ? 'notUploaded' : 'noData', values: [d.failureHours, d.plannedHours, d.otherHours],
  }));
  const peak = days.reduce<(typeof days)[number] | null>((b, d) => (d.hasData && (!b || d.downtimeHours > b.downtimeHours) ? d : b), null);
  const summary = peak
    ? t('{n} days. Highest day {d}: {v} h stopped. The {k}-day average ends at {a} h per day.{r}', {
      n: days.length, d: dayText(peak.date), v: fh(peak.downtimeHours), k: ROLLING_DAYS, a: lastAvg === null ? '–' : fh(lastAvg),
      r: runs.length ? ` ${t('Mostly planned: {r}.', { r: runs.map((x) => rangeText(x)).join(', ') })}` : '',
    })
    : t('No daily data in this range.');
  const more = mobile && model.daily.length > 14;
  return (
    <DashCard
      id="daily" testid="chart-daily" span="full" title={t('Which days were worst?')}
      help={{ id: 'daily', vars: peak ? { d: dayText(peak.date), h: fh(peak.downtimeHours) } : {} }}
      subtitle={t('Daily stopped hours (area-h) by type · {p} · line = {k}-day average of all types', { p: periodText(range), k: ROLLING_DAYS })}
      legend={[...paints.map((p) => ({ kind: 'paint' as const, paint: p, label: mobile ? p.short : p.label })), { kind: 'line', color: 'var(--tk-text-primary)', label: t('{k}-day average', { k: ROLLING_DAYS }) }]}
      summary={summary} scope={scopeText(range, filters, 'none')} open={{ ids, label: t('Daily stoppage {p}', { p: periodText(range) }) }} onOpen={onOpen}
    >
      {more || (mobile && allDays) ? (
        <div className="daily-bar">
          <span className="pill">{allDays ? t('All {n} days', { n: model.daily.length }) : t('Last 14 days · {r}', { r: range.from.slice(0, 7) === range.to.slice(0, 7) ? `${Number(range.from.slice(8))}–${dayText(range.to)}` : `${dayText(range.from)} – ${dayText(range.to)}` })}</span>
          <button type="button" className="dcard-link" onClick={() => { setAllDays((v) => !v); setSel(null); }} data-testid="daily-all">{allDays ? t('Last 14 days') : t('See all {n} days', { n: model.daily.length })} <span aria-hidden="true">›</span></button>
        </div>
      ) : null}
      <div ref={boxRef} className={mobile && allDays ? 'dcard-chart dcard-chart--scroll' : 'dcard-chart'}>
        {width > 0 && (
          <ColumnChart
            slots={cols} paints={paints} width={mobile && allDays ? Math.max(width, days.length * 18) : width} height={mobile ? 240 : 280} format={fh} selected={sel} onSelect={setSel}
            labelMode="peak" maxBar={30} unitLabel="h" testid="daily-chart"
            bands={runs.map((r) => ({ from: days.findIndex((d) => d.date === r.from), to: days.findIndex((d) => d.date === r.to), label: t('Mostly planned {r}', { r: rangeText(r) }) })).filter((b) => b.from >= 0 && b.to >= b.from)}
            line={{ label: t('{k}-day average', { k: ROLLING_DAYS }), color: 'var(--tk-text-primary)', values: days.map((d) => d.rollingDowntimeHours), format: fh, endLabel: lastAvg === null ? undefined : t('avg {v} h/day', { v: fh(lastAvg) }) }}
            ariaLabel={summary}
          />
        )}
      </div>
      {s && (
        <div className="ddetail ddetail--row" data-testid="daily-detail" role="region" aria-label={dayText(s.date)}>
          <b>{dayText(s.date)}</b>
          <span>{s.hasData ? `${fh(s.downtimeHours)} h · ${paints.map((p, i) => `${p.short} ${fh([s.failureHours, s.plannedHours, s.otherHours][i]!)}`).join(' · ')}` : s.notUploaded ? t('Not uploaded') : t('No data')}</span>
          {s.hasData && <OpenLink spec={{ ids: selIds, label: dayText(s.date) }} onOpen={onOpen} label={t('Open {n} records', { n: num(selIds.length) })} testid="daily-detail-open" />}
          <button type="button" className="ddetail-close" onClick={() => setSel(null)} aria-label={t('Close the details')}><Icon name="close" size={16} /></button>
        </div>
      )}
      {!s && <p className="dcard-hint dcard-hint--block"><Icon name="info" size={14} /> {t('Tap a day for details')}</p>}
    </DashCard>
  );
}
