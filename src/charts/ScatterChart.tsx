// Frequency (x) against average duration (y), one point per equipment code. Point size = total hours.
// Labels are drawn largest first and skipped when they would overlap; tap or hover for the numbers.
import { useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import { TipLayer, TipRows, useChartTip } from './ChartKit';
import { ACCENT, AXIS, GRID } from './palette';
import { axisNum, linear, niceTicks } from './scale';

export interface ScatterPt { key: string; label: string; x: number; y: number; size: number; details: { label: string; value: string }[] }

export default function ScatterChart({
  points, width, height = 300, xTitle, yTitle, ariaLabel, onPoint, openLabel, selected,
}: {
  points: ScatterPt[]; width: number; height?: number; xTitle: string; yTitle: string; ariaLabel: string;
  onPoint?: (p: ScatterPt) => void; openLabel?: string; selected?: string | null;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const { tip, bind, hide } = useChartTip({ current: box } as React.RefObject<HTMLDivElement | null>);
  if (points.length === 0) return <p className="muted">{t('Nothing to show for these filters.')}</p>;
  const m = { l: 48, r: 14, t: 12, b: 44 };
  const pw = Math.max(60, width - m.l - m.r);
  const ph = height - m.t - m.b;
  const xs = niceTicks(0, Math.max(...points.map((p) => p.x)) + 0.5, 5);
  const ys = niceTicks(0, Math.max(...points.map((p) => p.y)), 5);
  const x = linear(xs.min, xs.max, m.l, m.l + pw);
  const y = linear(ys.min, ys.max, m.t + ph, m.t);
  const maxSize = Math.max(...points.map((p) => p.size), 1e-9);
  const r = (p: ScatterPt): number => 4 + 6 * Math.sqrt(p.size / maxSize);

  const order = [...points].sort((a, b) => b.size - a.size);
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const labelled = new Set<string>();
  for (const p of order) {
    const w = p.label.length * 6.6;
    const b = { x0: x(p.x) + r(p) + 2, x1: x(p.x) + r(p) + 2 + w, y0: y(p.y) - 7, y1: y(p.y) + 7 };
    if (b.x1 > m.l + pw + m.r || boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)) continue;
    boxes.push(b);
    labelled.add(p.key);
  }
  const node = (p: ScatterPt): ReactNode => (
    <>
      <TipRows title={p.label} rows={p.details} />
      {onPoint && <button type="button" className="btn btn-sm" onClick={(e) => { e.stopPropagation(); hide(); onPoint(p); }}>{openLabel}</button>}
    </>
  );
  return (
    <div ref={setBox} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onClick={hide} data-testid="scatter">
        <title>{ariaLabel}</title>
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
        <line x1={m.l} x2={m.l + pw} y1={m.t + ph} y2={m.t + ph} stroke={AXIS} />
        <line x1={m.l} x2={m.l} y1={m.t} y2={m.t + ph} stroke={AXIS} />
        <text x={m.l + pw / 2} y={height - 4} textAnchor="middle">{xTitle}</text>
        <text transform={`translate(12 ${m.t + ph / 2}) rotate(-90)`} textAnchor="middle">{yTitle}</text>
        {points.map((p) => (
          <g key={p.key}>
            <circle cx={x(p.x)} cy={y(p.y)} r={r(p)} fill={ACCENT} fillOpacity={selected === p.key ? 0.95 : 0.5} stroke={ACCENT} strokeWidth={selected === p.key ? 3 : 1.5} />
            {labelled.has(p.key) && <text x={x(p.x) + r(p) + 2} y={y(p.y) + 4} className="chart-ink">{p.label}</text>}
            <circle cx={x(p.x)} cy={y(p.y)} r={Math.max(r(p), 14)} fill="transparent" className="chart-hit" data-testid="scatter-point" data-key={p.key} {...bind(node(p))} />
          </g>
        ))}
      </svg>
      <TipLayer tip={tip} width={width} />
    </div>
  );
}
