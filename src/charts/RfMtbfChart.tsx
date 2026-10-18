// Reliability factor (y, %) against MTBF (x, log scale) per area. A dashed line marks the RF target and another the
// median MTBF. On target = green circle, below = red triangle (shape and colour, never colour alone); the size of a
// mark grows with the MTTR. Points are labelled clear of the others (a crowded one on target may go without a label);
// tap or hover a point for its numbers.
import { useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import { TipLayer, TipRows, useChartTip } from './ChartKit';
import { AXIS, GRID } from './palette';
import { axisNum, linear, niceTicks } from './scale';

export interface RfPt {
  key: string; label: string;
  /** MTBF, hours (> 0) */
  x: number;
  /** RF, percent */
  y: number;
  /** MTTR, hours (size of the mark); null = smallest mark */
  mttr: number | null;
  /** true on target, false below, null without a target */
  ok: boolean | null;
  details: { label: string; value: string }[];
}

const GOOD = 'var(--tk-success)';
const BAD = 'var(--tk-danger)';
const NEUTRAL = 'var(--tk-accent)';

/** Radius from MTTR: 4 + √MTTR × 3, capped so one slow area cannot cover the plot. */
export const rfMarkRadius = (mttr: number | null): number => Math.min(16, 4 + Math.sqrt(Math.max(0, mttr ?? 0)) * 3);

/** 1-2-5 ticks of a log axis that cover [lo, hi]. */
export function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= lo * 0.999 && v <= hi * 1.001) out.push(Number(v.toPrecision(6)));
    }
  }
  return out;
}

export default function RfMtbfChart({
  points, width, height = 360, target, medianX, targetLabel, medianLabel, xTitle, yTitle, ariaLabel, onPoint, openLabel, static: isStatic = false,
}: {
  points: RfPt[]; width: number; height?: number;
  /** RF target, percent (null = off) */
  target: number | null;
  medianX: number | null;
  targetLabel?: string; medianLabel?: string;
  xTitle: string; yTitle: string; ariaLabel: string;
  onPoint?: (p: RfPt) => void; openLabel?: string;
  static?: boolean;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const { tip, bind, hide } = useChartTip({ current: box } as React.RefObject<HTMLDivElement | null>);
  const pts = points.filter((p) => p.x > 0 && Number.isFinite(p.y));
  if (pts.length === 0) return <p className="muted">{t('Nothing to show for these filters.')}</p>;
  const m = { l: 48, r: 16, t: 14, b: 44 };
  const pw = Math.max(60, width - m.l - m.r);
  const ph = height - m.t - m.b;

  // x: log10, whole 1-2-5 steps around the data and the median
  const xs = pts.map((p) => p.x).concat(medianX !== null && medianX > 0 ? [medianX] : []);
  const lxLo = Math.log10(Math.min(...xs));
  const lxHi = Math.log10(Math.max(...xs));
  const pad = Math.max(0.12, (lxHi - lxLo) * 0.06);
  const xl0 = lxLo - pad;
  const xl1 = lxHi + pad;
  const xTicks = logTicks(10 ** xl0, 10 ** xl1);
  const xl = linear(xl0, xl1, m.l, m.l + pw);
  const x = (v: number): number => xl(Math.log10(Math.max(v, 1e-9)));

  // y: percent, from a nice step under the lowest RF (and the target) up to 100
  const lo = Math.min(...pts.map((p) => p.y), target ?? 100);
  const ys = niceTicks(Math.max(0, lo - Math.max(1, (100 - lo) * 0.08)), 100, 5);
  const yMax = Math.min(100, ys.max);
  const y = linear(ys.min, yMax, m.t + ph, m.t);
  const yTicks = ys.ticks.filter((v) => v <= yMax);

  // labels: eight spots around each mark, the first clear of marks and labels already placed, else the least crowded
  type Box = { x0: number; x1: number; y0: number; y1: number };
  const boxes: Box[] = pts.map((p) => { const r = rfMarkRadius(p.mttr); return { x0: x(p.x) - r, x1: x(p.x) + r, y0: y(p.y) - r * 1.15, y1: y(p.y) + r * 0.8 }; });
  if (target !== null && targetLabel) boxes.push({ x0: m.l + pw - targetLabel.length * 6.8 - 6, x1: m.l + pw, y0: y(target) - 18, y1: y(target) - 2 });
  if (medianX !== null && medianLabel) boxes.push({ x0: x(medianX) + 2, x1: x(medianX) + 6 + medianLabel.length * 6.8, y0: m.t + ph - 20, y1: m.t + ph - 2 });
  const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const outside = (b: Box): number => Math.max(0, m.l - b.x0) + Math.max(0, b.x1 - (m.l + pw)) + Math.max(0, m.t - b.y0) + Math.max(0, b.y1 - (m.t + ph));
  const labelAt = new Map<string, { x: number; y: number; anchor: 'start' | 'end' | 'middle' }>();
  [...pts].sort((a, b) => a.x - b.x).forEach((p) => {
    const w = p.label.length * 6.8 + 2;
    const px = x(p.x);
    const py = y(p.y);
    const g = rfMarkRadius(p.mttr) + 3;
    const tries: { x: number; y: number; anchor: 'start' | 'end' | 'middle'; b: Box }[] = [
      { x: px + g, y: py + 4, anchor: 'start', b: { x0: px + g, x1: px + g + w, y0: py - 8, y1: py + 8 } },
      { x: px - g, y: py + 4, anchor: 'end', b: { x0: px - g - w, x1: px - g, y0: py - 8, y1: py + 8 } },
      { x: px, y: py - g - 2, anchor: 'middle', b: { x0: px - w / 2, x1: px + w / 2, y0: py - g - 14, y1: py - g } },
      { x: px, y: py + g + 11, anchor: 'middle', b: { x0: px - w / 2, x1: px + w / 2, y0: py + g, y1: py + g + 14 } },
      { x: px + g, y: py - g, anchor: 'start', b: { x0: px + g, x1: px + g + w, y0: py - g - 14, y1: py - g } },
      { x: px - g, y: py - g, anchor: 'end', b: { x0: px - g - w, x1: px - g, y0: py - g - 14, y1: py - g } },
      { x: px + g, y: py + g + 10, anchor: 'start', b: { x0: px + g, x1: px + g + w, y0: py + g, y1: py + g + 14 } },
      { x: px - g, y: py + g + 10, anchor: 'end', b: { x0: px - g - w, x1: px - g, y0: py + g, y1: py + g + 14 } },
    ];
    const cost = (b: Box): number => boxes.reduce((s, o) => s + overlap(b, o), 0) + outside(b) * 40;
    const best = tries.reduce((a, c) => (cost(c.b) < cost(a.b) ? c : a));
    // no clear spot in a crowded cluster: leave the label out (the tooltip and the table have it), except for an area
    // below the target, which always keeps its name
    if (cost(best.b) > 12 && p.ok !== false) return;
    boxes.push(best.b);
    labelAt.set(p.key, { x: best.x, y: best.y, anchor: best.anchor });
  });

  const mark = (p: RfPt): ReactNode => {
    const cx = x(p.x);
    const cy = y(p.y);
    const r = rfMarkRadius(p.mttr);
    if (p.ok === false) return <path d={`M${cx} ${cy - r * 1.15} L${cx + r} ${cy + r * 0.75} L${cx - r} ${cy + r * 0.75} Z`} fill={BAD} fillOpacity={0.85} stroke="var(--tk-card-bg)" strokeWidth="1.5" data-testid="rf-point-below" />;
    return <circle cx={cx} cy={cy} r={r} fill={p.ok ? GOOD : NEUTRAL} fillOpacity={0.85} stroke="var(--tk-card-bg)" strokeWidth="1.5" data-testid={p.ok ? 'rf-point-on' : 'rf-point'} />;
  };
  const node = (p: RfPt): ReactNode => (
    <>
      <TipRows title={p.label} rows={p.details} />
      {onPoint && <button type="button" className="btn btn-sm" onClick={(e) => { e.stopPropagation(); hide(); onPoint(p); }}>{openLabel}</button>}
    </>
  );
  // the slowest repairs are drawn first so a small mark is never hidden under a big one
  const order = [...pts].sort((a, b) => rfMarkRadius(b.mttr) - rfMarkRadius(a.mttr));
  const showEvery = pw < 360 ? xTicks.filter((v) => /^[15]/.test(String(v))) : xTicks;
  return (
    <div ref={setBox} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onClick={hide} data-testid="rf-mtbf">
        <title>{ariaLabel}</title>
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={m.l} x2={m.l + pw} y1={y(v)} y2={y(v)} stroke={GRID} />
            <text x={m.l - 6} y={y(v) + 4} textAnchor="end">{axisNum(v)}%</text>
          </g>
        ))}
        {showEvery.map((v) => (
          <g key={`x${v}`}>
            <line x1={x(v)} x2={x(v)} y1={m.t} y2={m.t + ph} stroke={GRID} />
            <text x={x(v)} y={m.t + ph + 16} textAnchor="middle">{axisNum(v)}</text>
          </g>
        ))}
        <line x1={m.l} x2={m.l + pw} y1={m.t + ph} y2={m.t + ph} stroke={AXIS} />
        <line x1={m.l} x2={m.l} y1={m.t} y2={m.t + ph} stroke={AXIS} />
        <text x={m.l + pw / 2} y={height - 4} textAnchor="middle">{xTitle}</text>
        <text transform={`translate(12 ${m.t + ph / 2}) rotate(-90)`} textAnchor="middle">{yTitle}</text>
        {medianX !== null && (
          <g data-testid="rf-median">
            <line x1={x(medianX)} x2={x(medianX)} y1={m.t} y2={m.t + ph} stroke="var(--tk-text-secondary)" strokeWidth="1.5" strokeDasharray="4 4" />
            {medianLabel && <text x={x(medianX) + 4} y={m.t + ph - 6} className="chart-ink" stroke="var(--tk-card-bg)" strokeWidth={3} paintOrder="stroke">{medianLabel}</text>}
          </g>
        )}
        {target !== null && (
          <g data-testid="rf-target">
            <line x1={m.l} x2={m.l + pw} y1={y(target)} y2={y(target)} stroke="var(--tk-text-primary)" strokeWidth="2" strokeDasharray="6 5" />
            {targetLabel && <text x={m.l + pw - 4} y={y(target) - 5} textAnchor="end" className="chart-ink" fontWeight={700} stroke="var(--tk-card-bg)" strokeWidth={3} paintOrder="stroke">{targetLabel}</text>}
          </g>
        )}
        {order.map((p) => (
          <g key={p.key}>
            {mark(p)}
            {!isStatic && <circle cx={x(p.x)} cy={y(p.y)} r={Math.max(11, rfMarkRadius(p.mttr))} fill="transparent" className="chart-hit" data-testid="rf-hit" data-key={p.key} {...bind(node(p))} />}
          </g>
        ))}
        <g pointerEvents="none">
          {pts.map((p) => {
            const at = labelAt.get(p.key);
            if (!at) return null;
            return <text key={p.key} x={at.x} y={at.y} textAnchor={at.anchor} className="chart-ink" fontWeight={600} stroke="var(--tk-card-bg)" strokeWidth={3} paintOrder="stroke" data-testid="rf-label">{p.label}</text>;
          })}
        </g>
      </svg>
      {!isStatic && <TipLayer tip={tip} width={width} />}
    </div>
  );
}
