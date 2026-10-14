// Cards 3-7 of the Dashboard: what kind of stoppage (donut), where the time went (Pareto), planned or incidental per
// line, downtime by area and availability by area against the target. Bars are HTML so labels wrap or end in an
// ellipsis instead of being clipped; every value is printed next to its bar.
import { useMemo, useState, type CSSProperties } from 'react';
import Donut from '../../charts/Donut';
import { PaintSwatch, paintCss } from '../../charts/paint';
import { classPaint, typePaints, type Paint } from '../../charts/palette';
import { niceTicks } from '../../charts/scale';
import { codeKey } from '../../calc';
import { useIsMobile } from '../../hooks/useIsMobile';
import { t } from '../../i18n/t';
import { num } from '../../util/format';
import { fh, fint } from '../format';
import {
  areaAvailability, areaSplit, classHours, idsWithHours, idsWithHoursByArea, lineSplit, lossModel, paretoNeed, scopeText,
  type LossDim, type TypeSplit,
} from '../dashModels';
import type { DashFilters } from '../filters';
import type { DashCtx } from '../scope';
import DashCard, { Seg, type OpenFn } from './DashCard';
import { useAreaTargetMap } from '../useAreaTargetMap';

const pct1 = (v: number, total: number): string => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '–');
const pct0 = (v: number, total: number): number => (total > 0 ? Math.round((v / total) * 100) : 0);

/** Axis ticks under HTML bars (0 to the nice maximum). */
function BarAxis({ max, unit, format = (n: number) => String(n) }: { max: number; unit: string; format?: (n: number) => string }) {
  const ticks = niceTicks(0, max || 1, 5).ticks.filter((v) => v <= max + 1e-9);
  return (
    <div className="hb-axis" aria-hidden="true">
      {ticks.map((v, i) => <span key={v} style={{ left: `${(v / max) * 100}%` }}>{format(v)}{i === ticks.length - 1 ? ` ${unit}` : ''}</span>)}
    </div>
  );
}

// ---------------------------------------------------------------- (3) what kind of stoppage

export function ClassCard({ ctx, filters, dark, classNames, onOpen }: { ctx: DashCtx; filters: DashFilters; dark: boolean; classNames: Map<string, string>; onOpen: OpenFn }) {
  const mobile = useIsMobile();
  const eff = ctx.win.effective!;
  const m = useMemo(() => classHours(ctx), [ctx]);
  const ids = useMemo(() => idsWithHours(ctx, eff), [ctx, eff]);
  if (!m) return null;
  const paint = (c: string): Paint => classPaint(dark, c, classNames.get(c) ?? c);
  const inc = ['PRO', 'MEC', 'ELE', 'AUT'];
  const incTotal = inc.reduce((s, c) => s + m.hours[c]!, 0);
  const top2 = [...inc].sort((a, b) => m.hours[b]! - m.hours[a]!).slice(0, 2).filter((c) => m.hours[c]! > 0);
  const top2Share = pct0(top2.reduce((s, c) => s + m.hours[c]!, 0), incTotal);
  const name = (c: string) => classNames.get(c) ?? c;
  const topCls = ['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'].reduce<string | null>((b, c) => (m.hours[c]! > (b ? m.hours[b]! : 0) ? c : b), null);
  const summary = m.total > 0
    ? t('{t} h stopped. Incidental {i} h: {c}. Planned {p} h, other {o} h.', { t: fh(m.total), i: fh(incTotal), c: inc.map((c) => `${c} ${fh(m.hours[c]!)} h`).join(', '), p: fh(m.hours.PL!), o: fh(m.hours.CIR!) })
    : t('No stopped hours in this period.');
  const row = (c: string) => (
    <tr key={c} data-testid="class-row" data-code={c}>
      <th scope="row"><PaintSwatch paint={paint(c)} /> <b>{c}</b> <span className="muted cls-name">{name(c)}</span></th>
      <td className="num">{fh(m.hours[c]!)}</td>
      <td className="num">{pct1(m.hours[c]!, m.total)}</td>
    </tr>
  );
  return (
    <DashCard
      id="class" testid="chart-class" span="narrow" title={t('What kind of stoppage was it?')}
      help={{ id: 'class', vars: topCls && m.total > 0 ? { c: topCls, h: fh(m.hours[topCls]!), t: fh(m.total), p: pct1(m.hours[topCls]!, m.total) } : {} }}
      subtitle={t('Stoppage by classification · area-hours (h)')}
      summary={summary} scope={scopeText(eff, filters, 'none')} open={{ ids, label: t('Stoppage by classification') }} onOpen={onOpen}
    >
      <div className="class-wrap">
        <Donut size={mobile ? 132 : 172} slices={['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'].map((c) => ({ paint: paint(c), value: m.hours[c]! }))} centre={fh(m.total)} centreSub={t('h total')} ariaLabel={summary} />
        <table className="class-table" data-testid="class-table">
          <thead><tr><th scope="col">{t('Class')}</th><th scope="col" className="num">h</th><th scope="col" className="num">%</th></tr></thead>
          <tbody>
            <tr className="class-group"><th scope="rowgroup" colSpan={3}>{t('Incidental (INC) · {h} h', { h: fh(incTotal) })}</th></tr>
            {inc.map(row)}
            <tr className="class-group"><th scope="rowgroup" colSpan={3}>{t('Planned and other')}</th></tr>
            {['PL', 'CIR'].map(row)}
          </tbody>
        </table>
      </div>
      {top2.length > 0 && incTotal > 0 && (
        <p className="class-note" data-testid="class-note">
          <span className="pill">{t('Incidental {h} h', { h: fh(incTotal) })}</span>
          <span><b>{top2.map(name).join(' + ')}</b> = {top2Share}% {t('of it')}</span>
        </p>
      )}
    </DashCard>
  );
}

// ---------------------------------------------------------------- (4) where did we lose the most time

const DIM_LABEL: Record<LossDim, string> = { equipment: 'Equipment', reason: 'Reasons', area: 'Areas', line: 'Lines' };

export function LossesCard({ ctx, filters, onOpen }: { ctx: DashCtx; filters: DashFilters; onOpen: OpenFn }) {
  const mobile = useIsMobile();
  const [dim, setDim] = useState<LossDim>('equipment');
  const [measure, setMeasure] = useState<'hours' | 'count'>('hours');
  const m = useMemo(() => lossModel(ctx, dim, measure, 10), [ctx, dim, measure]);
  const eff = ctx.win.effective!;
  const desc = (key: string): string => {
    if (dim === 'area') return ctx.master.index.areaById.get(key)?.name ?? '';
    if (dim === 'equipment') return ctx.master.index.equipmentByKey.get(codeKey(key))?.description?.trim() ?? '';
    return '';
  };
  const what = measure === 'hours' ? t('failure hours') : t('failures');
  const unit = measure === 'hours' ? 'h' : t('events');
  const f = measure === 'hours' ? fh : fint;
  const top = m?.top ?? [];
  const max = Math.max(0, ...top.map((b) => b.value));
  const scale = niceTicks(0, max || 1, 4);
  const rowH = mobile ? 30 : 26;
  const need = m ? paretoNeed(m.all) : null;
  const allCount = m?.all.entryCount ?? 0;
  const topLabel = allCount <= 10 ? t('All {n} = 100% of {w}', { n: allCount, w: what }) : t('Top {n} = {p}% of {w}', { n: top.length, p: Math.round(m?.topSharePct ?? 0), w: what });
  const needText = need === null ? '' : t('80% needs {n} {i}', { n: need, i: need === 1 ? t('item') : t('items') });
  const summary = m && top.length
    ? `${topLabel}${needText ? ` · ${needText}` : ''}. ${t('Largest: {l}, {v} {u}.', { l: top[0]!.label || t('(blank)'), v: f(top[0]!.value), u: unit })}`
    : t('No failures in this period.');
  const cumH = top.length * rowH;
  const cx = (p: number) => 4 + (p / 100) * 92;
  return (
    <DashCard
      id="losses" testid="chart-losses" span="wide" title={t('Where did we lose the most time?')}
      help={{ id: 'losses', vars: m && top[0] ? { top: top[0].label || t('(blank)'), v: `${f(top[0].value)} ${unit}`, t: `${f(m.all.total)} ${unit}`, p: `${top[0].sharePct.toFixed(1)}%` } : {} }}
      subtitle={t('Top 10 {d} by {w} (Incidental)', { d: t(DIM_LABEL[dim]).toLowerCase(), w: what })}
      controls={(
        <>
          <Seg value={dim} options={(Object.keys(DIM_LABEL) as LossDim[]).map((d) => ({ value: d, label: t(DIM_LABEL[d]) }))} onChange={setDim} label={t('Group by')} testid="loss-dim" wide />
          <Seg value={measure} options={[{ value: 'hours', label: t('Hours') }, { value: 'count', label: t('Count') }]} onChange={setMeasure} label={t('Measure')} testid="loss-measure" />
        </>
      )}
      summary={summary} scope={scopeText(eff, filters, 'failures')}
      open={m ? { ids: m.ids, label: t('the top {n} {d} by {w}', { n: top.length, d: t(DIM_LABEL[dim]).toLowerCase(), w: what }) } : null} onOpen={onOpen}
    >
      {top.length === 0 ? <p className="muted">{t('No failures in this period.')}</p> : (
        <>
          <p className="loss-head" data-testid="pareto-honest">
            <span className="pill pill--accent">{topLabel}</span>
            {needText && <span>{t('80% needs')} <b>{need} {need === 1 ? t('item') : t('items')}</b>{mobile ? ` · ${t('dashed = 80%')}` : ''}</span>}
          </p>
          <div className="loss-grid" style={{ '--row-h': `${rowH}px` } as CSSProperties}>
            <div className="loss-rows" role="list">
              {top.map((b) => {
                const label = b.label.trim() || t('(blank)');
                const d = desc(b.key);
                const inner = (
                  <>
                    <span className="loss-label" title={d ? `${label} ${d}` : label}><b>{label}</b>{d && !mobile && <span className="muted"> {d}</span>}</span>
                    <span className="loss-bar"><span className="loss-fill" style={{ width: `${(b.value / scale.max) * 100}%` }} /><span className="loss-val">{f(b.value)}</span></span>
                  </>
                );
                return mobile
                  ? <div key={b.key} className="loss-row" role="listitem" data-testid="loss-row">{inner}</div>
                  : (
                    <button key={b.key} type="button" className="loss-row" role="listitem" data-testid="loss-row" data-count={b.eventIds.length}
                      onClick={() => onOpen({ ids: b.eventIds, label: t('the loss bar {l}', { l: label }) })}
                      aria-label={t('{l}: {v} {u}, {p}% cumulative. Open {n} records', { l: label, v: f(b.value), u: unit, p: b.cumulativePct.toFixed(1), n: num(b.eventIds.length) })}>
                      {inner}
                    </button>
                  );
              })}
              <div className="loss-axis-row" aria-hidden="true"><span /><BarAxis max={scale.max} unit={unit} /></div>
            </div>
            {mobile ? (
              <div className="loss-cum loss-cum--list" aria-hidden="true">
                <span className="loss-cum-head">{t('Cum. %')}</span>
                {top.map((b) => (
                  <span key={b.key} className="loss-cum-item" style={{ height: rowH }}>
                    <span>{b.cumulativePct.toFixed(1)}%</span>
                    <span className="loss-cum-track"><span style={{ width: `${Math.min(100, b.cumulativePct)}%` }} /></span>
                  </span>
                ))}
              </div>
            ) : (
              <div className="loss-cum" aria-hidden="true">
                <span className="loss-cum-head">{t('Cumulative % of {t}', { t: `${f(m!.all.total)} ${unit}` })}</span>
                <svg width="100%" height={cumH} viewBox={`0 0 100 ${cumH}`} preserveAspectRatio="none" className="loss-cum-svg">
                  <rect x="0" y="0" width="100" height={cumH} fill="var(--tk-card-sub-bg)" />
                  <line x1={cx(80)} x2={cx(80)} y1={0} y2={cumH} stroke="var(--tk-text-primary)" strokeWidth="1.2" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                  <polyline points={top.map((b, i) => `${cx(b.cumulativePct)},${i * rowH + rowH / 2}`).join(' ')} fill="none" stroke="var(--tk-text-secondary)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
                </svg>
                <div className="loss-cum-labels" style={{ height: cumH }}>
                  {top.map((b, i) => (
                    <span key={b.key} style={{ top: i * rowH, left: `${Math.min(70, cx(b.cumulativePct))}%` }}><i className="loss-dot" />{b.cumulativePct.toFixed(1)}%</span>
                  ))}
                </div>
                <div className="loss-cum-axis"><span>0%</span><span>50%</span><b>80%</b></div>
              </div>
            )}
          </div>
        </>
      )}
    </DashCard>
  );
}

// ---------------------------------------------------------------- (5) planned or incidental

function SplitBar({ s, paints, testid }: { s: TypeSplit; paints: Paint[]; testid: string }) {
  const vals = [s.inc, s.pl, s.cir];
  return (
    <div className="split-bar" data-testid={testid} role="img" aria-label={`${s.label}: ${paints.map((p, i) => `${p.short} ${fh(vals[i]!)} h (${pct0(vals[i]!, s.total)}%)`).join(', ')}, ${t('total')} ${fh(s.total)} h`}>
      {vals.map((v, i) => {
        const p = pct0(v, s.total);
        if (!(v > 0)) return null;
        const label = p >= 24 ? `${paints[i]!.short} ${p}%` : p >= 9 ? `${p}%` : '';
        return <span key={i} className="split-seg" style={{ ...paintCss(paints[i]!), flexGrow: v }}>{label && <span className="split-txt">{label}</span>}</span>;
      })}
    </div>
  );
}

/** `wholeLines`: the page's Area / Equipment filters were dropped for this card, so every bar is a whole line. */
export function PlannedCard({ ctx, filters, dark, onOpen, wholeLines }: { ctx: DashCtx; filters: DashFilters; dark: boolean; onOpen: OpenFn; wholeLines?: boolean }) {
  const eff = ctx.win.effective!;
  const m = useMemo(() => lineSplit(ctx), [ctx]);
  const ids = useMemo(() => idsWithHours(ctx, eff), [ctx, eff]);
  const paints = typePaints(dark);
  if (!m) return null;
  const rows = [...m.lines, ...(m.lines.length > 1 ? [m.all] : [])];
  const summary = rows.map((r) => `${r.label}: ${t('incidental {a}%, planned {b}%, other {c}%, {h} h', { a: pct0(r.inc, r.total), b: pct0(r.pl, r.total), c: pct0(r.cir, r.total), h: fh(r.total) })}`).join('. ');
  return (
    <DashCard
      id="planned" testid="chart-planned-line" span="narrow" title={t('Planned or incidental?')}
      help={{ id: 'planned', vars: { i: fh(m.all.inc), p: fh(m.all.pl), o: fh(m.all.cir), t: fh(m.all.total) } }}
      subtitle={wholeLines ? t('Stopped hours by line and type · % of the line total · whole lines: the Area and Equipment filters do not apply here') : t('Stopped hours by line and type · % of the line total')}
      legend={paints.map((p) => ({ kind: 'paint' as const, paint: p, label: p.label }))}
      summary={summary} scope={scopeText(eff, filters, 'none')} open={{ ids, label: t('Planned or incidental, all lines') }} onOpen={onOpen}
    >
      <div className="split-rows">
        {rows.map((r) => (
          <div key={r.key} className={r.key === 'all' ? 'split-row split-row--all' : 'split-row'} data-testid="split-row" data-line={r.key}>
            <span className="split-label">{r.key === 'all' ? t('All') : r.label}</span>
            <SplitBar s={r} paints={paints} testid="split-bar" />
            <span className="split-total">{fh(r.total)}</span>
            <span className="split-hours" aria-hidden="true"><span>{fh(r.inc)}</span><span>{fh(r.pl)}</span><span>{fh(r.cir)}</span><b>= {fh(r.total)} h</b></span>
          </div>
        ))}
      </div>
      <table className="split-table" data-testid="split-table">
        <thead><tr><th scope="col">{t('Type (h)')}</th>{m.lines.map((l) => <th key={l.key} scope="col" className="num">{l.label}</th>)}<th scope="col" className="num">{t('Total')}</th></tr></thead>
        <tbody>
          {paints.map((p, i) => {
            const k = (['inc', 'pl', 'cir'] as const)[i]!;
            return <tr key={p.key}><th scope="row"><PaintSwatch paint={p} /> {p.label}</th>{m.lines.map((l) => <td key={l.key} className="num">{fh(l[k])}</td>)}<td className="num">{fh(m.all[k])}</td></tr>;
          })}
          <tr className="split-table-total"><th scope="row">{t('All types')}</th>{m.lines.map((l) => <td key={l.key} className="num">{fh(l.total)}</td>)}<td className="num" data-testid="split-total">{fh(m.all.total)}</td></tr>
        </tbody>
      </table>
    </DashCard>
  );
}

// ---------------------------------------------------------------- (6) which areas stopped the longest

export function AreaDownCard({ ctx, filters, dark, onOpen }: { ctx: DashCtx; filters: DashFilters; dark: boolean; onOpen: OpenFn }) {
  const mobile = useIsMobile();
  const [all, setAll] = useState(false);
  const eff = ctx.win.effective!;
  const rows = useMemo(() => areaSplit(ctx), [ctx]);
  const byArea = useMemo(() => idsWithHoursByArea(ctx, eff), [ctx, eff]);
  const ids = useMemo(() => [...byArea.values()].flat(), [byArea]);
  const paints = typePaints(dark);
  const shown = mobile && !all ? rows.slice(0, 8) : rows;
  const max = niceTicks(0, Math.max(1, ...rows.map((r) => r.total)), 5).max;
  const summary = rows.length
    ? t('Largest by total hours: {a} with {h} h stopped. {n} areas.', { a: rows[0]!.key, h: fh(rows[0]!.total), n: rows.length })
    : t('No downtime in this period.');
  return (
    <DashCard
      id="area-down" testid="chart-downtime-area" title={t('Which areas stopped the longest?')}
      help={{ id: 'area-down', vars: rows[0] ? { a: rows[0].key, h: fh(rows[0].total), i: fh(rows[0].inc), p: fh(rows[0].pl), o: fh(rows[0].cir) } : {} }}
      subtitle={mobile && rows.length > 8 && !all ? t('Stopped hours (h) by type · top 8 of {n}', { n: rows.length }) : t('Downtime by area · stopped hours (h) by type · most first')}
      headLink={mobile && rows.length > 8 ? <button type="button" className="dcard-link" onClick={() => setAll((v) => !v)} aria-expanded={all} data-testid="area-down-all">{all ? t('Top 8') : t('All {n}', { n: rows.length })} <span aria-hidden="true">›</span></button> : undefined}
      legend={paints.map((p) => ({ kind: 'paint' as const, paint: p, label: p.label }))}
      summary={summary} scope={scopeText(eff, filters, 'none')} open={{ ids, label: t('Downtime by area') }} onOpen={onOpen}
    >
      <div className="hb-list" role="list">
        {shown.map((r) => {
          const inner = (
            <>
              <span className="hb-label"><b>{r.key}</b>{r.name && !mobile && <span className="muted"> {r.name}</span>}</span>
              <span className="hb-track">
                <span className="hb-stack" style={{ width: `${(r.total / max) * 100}%` }}>
                  {[r.inc, r.pl, r.cir].map((v, i) => (v > 0 ? <span key={i} style={{ ...paintCss(paints[i]!), flexGrow: v }} /> : null))}
                </span>
                <span className="hb-val">{fh(r.total)}</span>
              </span>
            </>
          );
          const n = byArea.get(r.key)?.length ?? 0;
          return mobile
            ? <div key={r.key} className="hb-row" role="listitem" data-testid="area-down-row">{inner}</div>
            : <button key={r.key} type="button" className="hb-row" role="listitem" data-testid="area-down-row" data-count={n} onClick={() => onOpen({ ids: byArea.get(r.key) ?? [], label: t('the area {a}', { a: r.key }) })} aria-label={t('{a}: {h} h stopped (incidental {i}, planned {p}, other {o}). Open {n} records', { a: r.key, h: fh(r.total), i: fh(r.inc), p: fh(r.pl), o: fh(r.cir), n: num(n) })}>{inner}</button>;
        })}
        <div className="hb-row hb-row--axis" aria-hidden="true"><span /><span className="hb-track"><BarAxis max={max} unit="h" /></span></div>
      </div>
    </DashCard>
  );
}

// ---------------------------------------------------------------- (7) which areas miss the target

export function AreaTargetCard({ ctx, filters, onOpen }: { ctx: DashCtx; filters: DashFilters; onOpen: OpenFn }) {
  const mobile = useIsMobile();
  const [all, setAll] = useState(false);
  const eff = ctx.win.effective!;
  const perArea = useAreaTargetMap(ctx);
  const m = useMemo(() => areaAvailability(ctx, perArea), [ctx, perArea]);
  const ids = useMemo(() => idsWithHours(ctx, eff), [ctx, eff]);
  if (!m) return null;
  const basis = ctx.master.settings.availabilityBasis;
  // with targets per area (Settings > Actions & targets) each row has its own dashed line; m.target stays the plant-wide one
  const own = !!perArea && m.rows.some((r) => r.ownTarget);
  const tg = own ? (m.target ?? m.rows.find((r) => r.target != null)?.target ?? null) : m.target;
  const shown = mobile && !all ? m.rows.slice(0, 6) : m.rows;
  // a plant-wide target keeps the card's wording (areas with their own target use it on their row); without one, only own targets
  const title = m.target !== null ? t('Which areas miss the {x}% target?', { x: m.target }) : own ? t('Which areas miss their availability target?') : t('Which areas have the lowest availability?');
  const summary = m.rows.length
    ? `${t('{n} areas, worst first. Lowest: {a} at {p}%.', { n: m.rows.length, a: m.rows[0]!.area_id, p: m.rows[0]!.pct?.toFixed(1) ?? '–' })}${m.target !== null ? ` ${t('{n} of {m} areas below target ({x}%).', { n: m.below, m: m.judged, x: m.target })}` : own ? ` ${t('{n} of {m} areas below their own target.', { n: m.below, m: m.judged })}` : ` ${t('No availability target is set.')}`}`
    : t('No availability can be calculated for these areas.');
  const gapText = (r: (typeof m.rows)[number]) => {
    const s = r.status;
    if (!s) return null;
    const g = `${Math.abs(s.gap).toFixed(1)} ${t('pt')}`;
    return s.ok
      ? <span className="at-gap at-gap--ok" data-testid="at-gap" data-state="on"><span aria-hidden="true">✓</span> +{g}{mobile ? ` ${t('above')}` : ''}</span>
      : <span className="at-gap at-gap--bad" data-testid="at-gap" data-state="below"><span aria-hidden="true">▼</span> {mobile ? `${g} ${t('below')}` : `−${g}`}</span>;
  };
  return (
    <DashCard
      id="area-target" testid="chart-area-availability" title={title}
      help={{ id: 'area-target', vars: { b: basis, ...(m.rows[0] && m.rows[0].pct != null && (m.rows[0].target ?? tg) != null ? { a: m.rows[0].area_id, v: `${m.rows[0].pct.toFixed(1)}%`, x: `${m.rows[0].target ?? tg}%` } : {}) } }}
      subtitle={own ? t('Availability by area (basis {b}, %) · worst first · dashed line = the target of the area (Settings › Actions & targets){g}', { b: basis, g: m.target !== null ? t(', else {x}%', { x: m.target }) : '' }) : m.target !== null ? t('Availability by area (basis {b}, %) · worst first · dashed line = {x}% target', { b: basis, x: m.target }) : t('Availability by area (basis {b}, %) · worst first', { b: basis })}
      headLink={mobile && m.rows.length > 6 ? <button type="button" className="dcard-link" onClick={() => setAll((v) => !v)} aria-expanded={all} data-testid="area-target-all">{all ? t('Worst 6') : t('All {n}', { n: m.rows.length })} <span aria-hidden="true">›</span></button> : undefined}
      legend={tg !== null ? [
        { kind: 'box', className: 'lg-below', label: t('Below target ▼') },
        { kind: 'box', className: 'lg-on', label: t('On target ✓') },
        { kind: 'dash', label: m.target !== null ? t('{x}% target', { x: m.target }) : t('area target') },
      ] : undefined}
      summary={summary} scope={`${scopeText(eff, filters, 'all')}${tg !== null ? ` · ${t('{n} of {m} below target', { n: m.below, m: m.judged })}` : ''}`}
      open={{ ids, label: t('Availability by area') }} onOpen={onOpen}
      footExtra={tg !== null ? <span className="sr-only" data-testid="below-target-count">{t('{n} of {m} areas below target', { n: m.below, m: m.judged })}</span> : undefined}
    >
      {own && m.target === null && <p className="at-note" data-testid="own-target-note">{t('Only areas with their own target (Settings › Actions & targets) are marked; there is no plant-wide target for the others.')}</p>}
      {tg === null && <p className="at-note" data-testid="no-target-note">{t('No availability target is set, so no area is marked below or on target. An admin can set one in Settings › Calculations.')}</p>}
      <div className={`at-list${tg === null ? ' at-list--plain' : ''}`} style={{ '--target': tg === null ? '0%' : `${tg}%` } as CSSProperties} data-testid="at-list">
        {shown.map((r) => (
          <div key={r.area_id} className="at-row" data-testid="at-row" data-area={r.area_id} data-state={r.status?.state ?? 'none'} data-target={r.target ?? undefined}
            style={own && r.target != null ? ({ '--target': `${r.target}%` } as CSSProperties) : undefined}>
            <span className="at-label"><b>{r.area_id}</b>{r.name && <span className="muted"> {r.name}</span>}{own && r.target != null && <span className="muted at-own" data-testid="at-own-target"> · {t('target {x}%', { x: r.target })}</span>}</span>
            <span className="at-track">
              {r.pct !== null && <span className={`at-fill${r.status ? (r.status.ok ? ' at-fill--ok' : ' at-fill--bad') : ''}`} style={{ width: `${Math.max(0, Math.min(100, r.pct))}%` }} />}
              {(own ? r.target != null : tg !== null) && <span className="at-target" />}
            </span>
            <span className="at-val">{r.pct === null ? t('Unavailable') : `${r.pct.toFixed(1)}%`}</span>
            {gapText(r)}
          </div>
        ))}
        <div className="at-row at-row--axis" aria-hidden="true">
          <span />
          <span className="at-track at-track--axis">
            {(tg === null ? [0, 25, 50, 75, 100] : [0, 25, 50, 100]).filter((v) => !mobile || v === 0 || v === 50 || (tg === null && v === 100)).map((v) => <span key={v} style={{ left: `${v}%` }}>{v}%</span>)}
            {m.target !== null && mobile && <b className="at-axis-target" style={{ left: `${m.target}%`, transform: m.target > 70 ? 'translateX(-100%)' : m.target < 30 ? 'none' : 'translateX(-50%)' }} data-testid="target-line">{t('{x}% target', { x: m.target })}</b>}
          </span>
        </div>
      </div>
    </DashCard>
  );
}
