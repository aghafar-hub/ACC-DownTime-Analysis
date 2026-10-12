// Scatter with two dashed median lines that split the plot into four quadrants. One labelled point per item.
// The "bad" quadrant (low x, high y) is hatched, named in words, and its points are diamonds, so no meaning
// rests on colour alone. Tap or hover a point for the numbers; the tooltip has a button to open its events.
import { useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import { HatchDefs, TipLayer, TipRows, useChartTip, useUid } from './ChartKit';
import { ACCENT, AXIS, GRID } from './palette';
import { axisNum, linear, niceTicks } from './scale';

export interface QuadPt { key: string; label: string; x: number; y: number; worst: boolean; details: { label: string; value: string }[] }

export default function QuadrantChart({
  points, width, height = 320, xTitle, yTitle, medianX, medianY, medianXLabel, medianYLabel, worstLabel, ariaLabel, onPoint, openLabel,
}: {
  points: QuadPt[]; width: number; height?: number; xTitle: string; yTitle: string; ariaLabel: string;
  /** null: no median lines (fewer than two points) */
  medianX: number | null; medianY: number | null; medianXLabel?: string; medianYLabel?: string;
  /** the words printed in the bad quadrant */
  worstLabel: string;
  onPoint?: (p: QuadPt) => void; openLabel?: string;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const { tip, bind, hide } = useChartTip({ current: box } as React.RefObject<HTMLDivElement | null>);
  const uid = useUid();
  if (points.length === 0) return <p className="muted">{t('Nothing to show for these filters.')}</p>;
  const m = { l: 48, r: 14, t: 12, b: 44 };
  const pw = Math.max(60, width - m.l - m.r);
  const ph = height - m.t - m.b;
  // the axes start just below the smallest value (a scatter needs no zero baseline) so a cluster is not squeezed
  const span = (vals: number[]): [number, number] => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.08 || hi * 0.1 || 1;
    return [Math.max(0, lo - pad), hi + pad];
  };
  const [x0, x1] = span([...points.map((p) => p.x), ...(medianX !== null ? [medianX] : [])]);
  const [y0, y1] = span([...points.map((p) => p.y), ...(medianY !== null ? [medianY] : [])]);
  const xs = niceTicks(x0, x1, 5);
  const ys = niceTicks(y0, y1, 5);
  const x = linear(xs.min, xs.max, m.l, m.l + pw);
  const y = linear(ys.min, ys.max, m.t + ph, m.t);
  const R = 6;

  // Every point gets its label: try eight spots around the point and take the first that stays inside the plot and
  // clear of the labels and points already placed; when none is free take the least crowded one.
  type Box = { x0: number; x1: number; y0: number; y1: number };
  const boxes: Box[] = points.map((p) => ({ x0: x(p.x) - R - 1, x1: x(p.x) + R + 1, y0: y(p.y) - R - 1, y1: y(p.y) + R + 1 }));
  const overlap = (a: Box, b: Box): number => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const outside = (b: Box): number => Math.max(0, m.l - b.x0) + Math.max(0, b.x1 - (m.l + pw + m.r)) + Math.max(0, m.t - 4 - b.y0) + Math.max(0, b.y1 - (m.t + ph));
  const labelAt = new Map<string, { x: number; y: number; anchor: 'start' | 'end' | 'middle' }>();
  [...points].sort((a, b) => a.x - b.x).forEach((p) => {
    const w = p.label.length * 6.8 + 2;
    const px = x(p.x);
    const py = y(p.y);
    const g = R + 3;
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
    boxes.push(best.b);
    labelAt.set(p.key, { x: best.x, y: best.y, anchor: best.anchor });
  });

  // the bad quadrant: x below the median, y above it
  const wx0 = m.l;
  const wx1 = medianX !== null ? x(medianX) : m.l;
  const wy0 = m.t;
  const wy1 = medianY !== null ? y(medianY) : m.t;
  const showQuad = medianX !== null && medianY !== null && wx1 - wx0 > 8 && wy1 - wy0 > 8;
  const hatchId = `qh-${uid}`;

  const node = (p: QuadPt): ReactNode => (
    <>
      <TipRows title={p.label} rows={p.details} />
      {p.worst && <div className="chart-tip-note">{worstLabel}</div>}
      {onPoint && <button type="button" className="btn btn-sm" onClick={(e) => { e.stopPropagation(); hide(); onPoint(p); }}>{openLabel}</button>}
    </>
  );
  return (
    <div ref={setBox} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onClick={hide} data-testid="quadrant">
        <title>{ariaLabel}</title>
        <HatchDefs id={hatchId} color="var(--tk-danger)" />
        {ys.ticks.map((v) => (
          <g key={`y${v}`}>
            <line x1={m.l} x2={m.l + pw} y1={y(v)} y2={y(v)} stroke={GRID} />
            <text x={m.l - 6} y={y(v) + 4} textAnchor="end">{axisNum(v)}</text>
          </g>
        ))}
        {xs.ticks.map((v) => (
          <g key={`x${v}`}>
            <line x1={x(v)} x2={x(v)} y1={m.t} y2={m.t + ph} stroke={GRID} />
            <text x={x(v)} y={m.t + ph + 16} textAnchor="middle">{axisNum(v)}</text>
          </g>
        ))}
        {showQuad && <rect x={wx0} y={wy0} width={wx1 - wx0} height={wy1 - wy0} fill={`url(#${hatchId})`} opacity={0.28} data-testid="quadrant-worst-area" />}
        <line x1={m.l} x2={m.l + pw} y1={m.t + ph} y2={m.t + ph} stroke={AXIS} />
        <line x1={m.l} x2={m.l} y1={m.t} y2={m.t + ph} stroke={AXIS} />
        <text x={m.l + pw / 2} y={height - 4} textAnchor="middle">{xTitle}</text>
        <text transform={`translate(12 ${m.t + ph / 2}) rotate(-90)`} textAnchor="middle">{yTitle}</text>
        {medianX !== null && (
          <g data-testid="quadrant-median-x">
            <line x1={x(medianX)} x2={x(medianX)} y1={m.t} y2={m.t + ph} stroke="var(--tk-text-primary)" strokeWidth="1.5" strokeDasharray="6 4" />
            {medianXLabel && <text x={x(medianX) + (x(medianX) > m.l + pw * 0.6 ? -4 : 4)} y={m.t + ph - 6} textAnchor={x(medianX) > m.l + pw * 0.6 ? 'end' : 'start'} className="chart-ink" stroke="var(--tk-card-bg)" strokeWidth={3} paintOrder="stroke">{medianXLabel}</text>}
          </g>
        )}
        {medianY !== null && (
          <g data-testid="quadrant-median-y">
            <line x1={m.l} x2={m.l + pw} y1={y(medianY)} y2={y(medianY)} stroke="var(--tk-text-primary)" strokeWidth="1.5" strokeDasharray="6 4" />
            {medianYLabel && <text x={m.l + pw - 4} y={y(medianY) + (y(medianY) < m.t + 22 ? 14 : -5)} textAnchor="end" className="chart-ink" stroke="var(--tk-card-bg)" strokeWidth={3} paintOrder="stroke">{medianYLabel}</text>}
          </g>
        )}
        {showQuad && <text x={wx0 + 6} y={wy0 + 16} className="chart-ink" fontWeight={700} stroke="var(--tk-card-bg)" strokeWidth={3} paintOrder="stroke" data-testid="quadrant-worst-label">{worstLabel}</text>}
        {points.map((p) => (
          <g key={p.key}>
            {p.worst
              ? <path d={`M${x(p.x)} ${y(p.y) - R - 1.5} L${x(p.x) + R + 1.5} ${y(p.y)} L${x(p.x)} ${y(p.y) + R + 1.5} L${x(p.x) - R - 1.5} ${y(p.y)} Z`} fill="var(--tk-danger)" stroke="var(--tk-card-bg)" strokeWidth="1.5" />
              : <circle cx={x(p.x)} cy={y(p.y)} r={R} fill={ACCENT} fillOpacity={0.75} stroke={ACCENT} strokeWidth={1.5} />}
            <circle cx={x(p.x)} cy={y(p.y)} r={11} fill="transparent" className="chart-hit" data-testid="quadrant-point" data-key={p.key} {...bind(node(p))} />
          </g>
        ))}
        <g pointerEvents="none">
          {points.map((p) => {
            const at = labelAt.get(p.key)!;
            return <text key={p.key} x={at.x} y={at.y} textAnchor={at.anchor} className="chart-ink" stroke="var(--tk-card-bg)" strokeWidth={3} paintOrder="stroke" data-testid="quadrant-label">{p.label}</text>;
          })}
        </g>
      </svg>
      <TipLayer tip={tip} width={width} />
    </div>
  );
}
