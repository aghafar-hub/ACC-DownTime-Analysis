// Horizontal stacked bars, one row per label (areas). Segment values come with their own colour and symbol in
// the legend; the row total is printed at the end of the bar so nothing depends on colour alone.
import { useState, type ReactNode } from 'react';
import { TipLayer, TipRows, Swatch, useChartTip } from './ChartKit';
import { AXIS } from './palette';
import { linear, niceTicks, axisNum } from './scale';

export interface HSeg { key: string; label: string; color: string; value: number }
export interface HRow { key: string; label: string; segments: HSeg[]; note?: string }

export interface HRef { value: number; label: string }

export default function HBars({
  rows, width, format, ariaLabel, totalLabel, onRow, openLabel, xMax, xMin = 0, axisNote, axisFormat = axisNum, refLine,
}: {
  rows: HRow[]; width: number; format: (n: number) => string; ariaLabel: string; totalLabel?: (r: HRow, total: number) => string;
  /** a mouse click on a row (or the button in a tapped row's tooltip) opens something, e.g. the events behind it */
  onRow?: (r: HRow) => void; openLabel?: string;
  /** fix the end of the value axis (e.g. 100 for percentages) instead of the largest bar */
  xMax?: number;
  /** start of a zoomed value axis (needs xMax); bars begin here and `axisNote` says so in the chart */
  xMin?: number;
  axisNote?: string;
  axisFormat?: (n: number) => string;
  /** a vertical reference line across all rows, labelled above the plot */
  refLine?: HRef;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const { tip, bind, hide } = useChartTip({ current: box } as React.RefObject<HTMLDivElement | null>);
  const labelW = Math.min(96, Math.max(52, Math.max(0, ...rows.map((r) => r.label.length)) * 7 + 8));
  const totals = rows.map((r) => r.segments.reduce((s, x) => s + Math.max(0, x.value), 0));
  const valueW = Math.max(...rows.map((r, i) => (totalLabel ? totalLabel(r, totals[i]!) : format(totals[i]!)).length * 7 + 10), 40);
  const m = { l: labelW, r: valueW, t: refLine ? 24 : 6, b: axisNote ? 40 : 24 };
  const rowH = 28;
  const height = m.t + rows.length * rowH + m.b;
  const pw = Math.max(60, width - m.l - m.r);
  const lo = xMax !== undefined ? xMin : 0;
  const scale = xMax !== undefined ? { ...niceTicks(lo, xMax, 4), min: lo, max: xMax } : niceTicks(0, Math.max(0, ...totals), 4);
  const x = linear(scale.min, scale.max, m.l, m.l + pw);

  const node = (r: HRow, total: number): ReactNode => (
    <>
      <TipRows
        title={r.label}
        rows={[
          ...r.segments.map((s) => ({ swatch: <Swatch color={s.color} />, label: s.label, value: format(s.value) })),
          { label: 'Total', value: format(total) },
        ]}
      />
      {r.note && <div className="chart-tip-note">{r.note}</div>}
      {onRow && <button type="button" className="btn btn-sm" onClick={(e) => { e.stopPropagation(); hide(); onRow(r); }}>{openLabel}</button>}
    </>
  );

  return (
    <div ref={setBox} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onClick={hide}>
        <title>{ariaLabel}</title>
        {scale.ticks.filter((v) => v <= scale.max && v >= scale.min).map((v) => (
          <g key={v}>
            <line x1={x(v)} x2={x(v)} y1={m.t} y2={height - m.b} stroke="var(--tk-border2)" />
            <text x={x(v)} y={height - m.b + 16} textAnchor="middle">{axisFormat(v)}</text>
          </g>
        ))}
        <line x1={m.l} x2={m.l} y1={m.t} y2={height - m.b} stroke={AXIS} />
        {rows.map((r, i) => {
          const top = m.t + i * rowH;
          let acc = 0;
          return (
            <g key={r.key}>
              <text x={m.l - 8} y={top + rowH / 2 + 4} textAnchor="end" className="chart-ink">{r.label}</text>
              {r.segments.map((s) => {
                if (!(s.value > 0)) return null;
                const x0 = x(Math.max(acc, scale.min));
                acc += s.value;
                return <rect key={s.key} x={x0} y={top + 4} width={Math.max(1, x(Math.max(acc, scale.min)) - x0)} height={rowH - 8} fill={s.color} stroke="var(--tk-card-bg)" strokeWidth="0.75" />;
              })}
              <text x={(xMax !== undefined ? m.l + pw : x(totals[i]!)) + 6} y={top + rowH / 2 + 4} className="chart-ink">{totalLabel ? totalLabel(r, totals[i]!) : format(totals[i]!)}</text>
              <rect className="chart-hit" x={0} y={top} width={width} height={rowH} {...bind(node(r, totals[i]!), onRow ? () => onRow(r) : undefined)} />
            </g>
          );
        })}
        {refLine && (
          <g data-testid="hbars-ref">
            <line x1={x(refLine.value)} x2={x(refLine.value)} y1={m.t - 6} y2={height - m.b} stroke="var(--tk-text-primary)" strokeWidth="1.75" strokeDasharray="6 4" />
            <text x={x(refLine.value)} y={m.t - 10} textAnchor={x(refLine.value) > m.l + pw / 2 ? 'end' : 'start'} className="chart-ink">{refLine.label}</text>
          </g>
        )}
      {axisNote && <text x={m.l} y={height - 6} className="chart-ink" data-testid="hbars-axis-note">{axisNote}</text>}
      </svg>
      <TipLayer tip={tip} width={width} />
    </div>
  );
}
