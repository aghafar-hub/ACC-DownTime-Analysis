// Frequency (x) against average duration (y), one point per equipment code. Point size = total hours.
// Only the biggest points are labelled (nudged clear of each other); tap or hover any point for the numbers.
import { useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import { TipLayer, TipRows, useChartTip } from './ChartKit';
import { ACCENT, AXIS, GRID } from './palette';
import { axisNum, linear, niceTicks } from './scale';

export interface ScatterPt { key: string; label: string; x: number; y: number; size: number; details: { label: string; value: string }[] }

export default function ScatterChart({
  points, width, height = 300, xTitle, yTitle, ariaLabel, onPoint, openLabel, selected, static: isStatic = false, highlight, jitter = false,
}: {
  points: ScatterPt[]; width: number; height?: number; xTitle: string; yTitle: string; ariaLabel: string;
  onPoint?: (p: ScatterPt) => void; openLabel?: string; selected?: string | null;
  /** keys drawn as filled diamonds and labelled first (for example the codes with a repeated failure) */
  highlight?: ReadonlySet<string>;
  /** spread points that share an x value (whole counts) a little sideways so they do not hide each other */
  jitter?: boolean;
  /** report mode: no tooltips and no hit areas, only the drawing (for print and PDF) */
  static?: boolean;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const { tip, bind, hide } = useChartTip({ current: box } as React.RefObject<HTMLDivElement | null>);
  if (points.length === 0) return <p className="muted">{t('Nothing to show for these filters.')}</p>;
  const m = { l: 48, r: 14, t: 12, b: 44 };
  const pw = Math.max(60, width - m.l - m.r);
  const ph = height - m.t - m.b;
  const xs = niceTicks(0, Math.max(...points.map((p) => p.x)) + 0.5, 5);
  const ys = niceTicks(0, Math.max(...points.map((p) => p.y)), 5);
  const xRaw = linear(xs.min, xs.max, m.l, m.l + pw);
  const y = linear(ys.min, ys.max, m.t + ph, m.t);
  // points that share an x value are spread over up to 70% of one unit, in a fixed order (by y), so none hides another
  const offset = new Map<string, number>();
  if (jitter) {
    const byX = new Map<number, ScatterPt[]>();
    for (const p of points) (byX.get(p.x) ?? byX.set(p.x, []).get(p.x)!).push(p);
    const unit = Math.abs(xRaw(1) - xRaw(0));
    for (const list of byX.values()) {
      if (list.length < 2) continue;
      const sorted = [...list].sort((a, b) => a.y - b.y || (a.key < b.key ? -1 : 1));
      const spread = Math.min(unit * 0.7, 26);
      sorted.forEach((p, i) => offset.set(p.key, (i / (sorted.length - 1) - 0.5) * spread));
    }
  }
  const xOf = (p: ScatterPt): number => xRaw(p.x) + (offset.get(p.key) ?? 0);
  const x = xRaw;
  const maxSize = Math.max(...points.map((p) => p.size), 1e-9);
  const r = (p: ScatterPt): number => 3.5 + 6 * Math.sqrt(p.size / maxSize);

  // Labels only for the biggest points (the rest answer to tap / hover). Each label tries right, left, above and
  // below its point and takes the first spot that is inside the plot and clear of the labels already placed.
  const MAX_LABELS = 8;
  const order = [...points].sort((a, b) => Number(!!highlight?.has(b.key)) - Number(!!highlight?.has(a.key)) || b.size - a.size);
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const labelAt = new Map<string, { x: number; y: number; anchor: 'start' | 'end' | 'middle' }>();
  const hits = (b: { x0: number; x1: number; y0: number; y1: number }): boolean =>
    b.x0 < m.l || b.x1 > m.l + pw + m.r || b.y0 < m.t - 4 || b.y1 > m.t + ph || boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  for (const p of order) {
    if (labelAt.size >= MAX_LABELS) break;
    const w = p.label.length * 6.6;
    const px = xOf(p);
    const py = y(p.y);
    const rr = r(p) + 3;
    const tries = [
      { x: px + rr, y: py + 4, anchor: 'start' as const, b: { x0: px + rr, x1: px + rr + w, y0: py - 7, y1: py + 7 } },
      { x: px - rr, y: py + 4, anchor: 'end' as const, b: { x0: px - rr - w, x1: px - rr, y0: py - 7, y1: py + 7 } },
      { x: px, y: py - rr - 2, anchor: 'middle' as const, b: { x0: px - w / 2, x1: px + w / 2, y0: py - rr - 14, y1: py - rr } },
      { x: px, y: py + rr + 11, anchor: 'middle' as const, b: { x0: px - w / 2, x1: px + w / 2, y0: py + rr, y1: py + rr + 14 } },
    ];
    const ok = tries.find((c) => !hits(c.b));
    if (!ok) continue;
    boxes.push(ok.b);
    labelAt.set(p.key, { x: ok.x, y: ok.y, anchor: ok.anchor });
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
        {[...points].sort((a, b) => Number(!!highlight?.has(a.key)) - Number(!!highlight?.has(b.key)) || Number(a.key === selected) - Number(b.key === selected)).map((p) => {
          const hl = !!highlight?.has(p.key);
          const cx = xOf(p);
          const cy = y(p.y);
          const rr = r(p);
          return (
            <g key={p.key} data-highlight={hl ? 'yes' : undefined}>
              {hl
                ? <path d={`M${cx} ${cy - rr - 1.5}L${cx + rr + 1.5} ${cy}L${cx} ${cy + rr + 1.5}L${cx - rr - 1.5} ${cy}Z`} fill="var(--tk-danger)" fillOpacity={selected === p.key ? 1 : 0.8} stroke={selected === p.key ? 'var(--tk-text-primary)' : 'var(--tk-card-bg)'} strokeWidth={selected === p.key ? 2.5 : 1} />
                : <circle cx={cx} cy={cy} r={rr} fill={ACCENT} fillOpacity={selected === p.key ? 0.95 : highlight ? 0.14 : 0.3} stroke={ACCENT} strokeOpacity={highlight ? 0.7 : 1} strokeWidth={selected === p.key ? 3 : 1.25} />}
              {!isStatic && <circle cx={cx} cy={cy} r={Math.max(rr, 12)} fill="transparent" className="chart-hit" data-testid="scatter-point" data-key={p.key} {...bind(node(p))} />}
            </g>
          );
        })}
        {/* labels last, with a halo in the card colour, so neighbouring points never cover them */}
        <g pointerEvents="none">
          {points.map((p) => {
            const at = labelAt.get(p.key);
            return at ? <text key={p.key} x={at.x} y={at.y} textAnchor={at.anchor} className="chart-ink" stroke="var(--tk-card-bg)" strokeWidth={3} paintOrder="stroke">{p.label}</text> : null;
          })}
        </g>
      </svg>
      {!isStatic && <TipLayer tip={tip} width={width} />}
    </div>
  );
}
