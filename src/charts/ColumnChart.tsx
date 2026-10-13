// Stacked columns for the Dashboard: colour + pattern per segment, partial periods faded and outlined with a dashed
// line ('partial' under the label), periods not uploaded as an empty dashed slot ('Not uploaded'), and an optional
// line on top (a rolling average). Tapping or clicking a column selects it: the card shows the numbers in its own
// detail panel (no hover-only information). Columns are buttons for the keyboard.
import type { KeyboardEvent } from 'react';
import { PaintDefs, paintId } from './paint';
import type { Paint } from './palette';
import { AXIS, GRID } from './palette';
import { axisNum, labelEvery, linear, niceTicks } from './scale';
import { useUid } from './ChartKit';

export type ColStatus = 'full' | 'partial' | 'notUploaded' | 'noData';
export interface ColSlot {
  key: string;
  /** axis label */
  label: string;
  /** spoken / long label ('Aug 2026') */
  full: string;
  status: ColStatus;
  /** the selected period (light band behind the column) */
  highlight?: boolean;
  /** one value per paint, in paint order */
  values: number[];
}
export interface ColLine { label: string; color: string; values: (number | null)[]; format: (n: number) => string; endLabel?: string }

const HALO = { stroke: 'var(--tk-card-bg)', strokeWidth: 3, paintOrder: 'stroke' } as const;

export default function ColumnChart({
  slots, paints, width, height = 260, yFormat = axisNum, format, selected, onSelect, line, ariaLabel, labelMode = 'auto', maxBar = 56, testid = 'col-chart', unitLabel,
}: {
  slots: ColSlot[];
  paints: Paint[];
  width: number;
  height?: number;
  yFormat?: (n: number) => string;
  /** the total above a column */
  format: (n: number) => string;
  selected: number | null;
  onSelect?: (i: number | null) => void;
  line?: ColLine;
  ariaLabel: string;
  /** 'auto': totals above the selected, the highest, highlighted and partial columns when there is room; 'peak': only the highest and the selected */
  labelMode?: 'auto' | 'peak';
  maxBar?: number;
  testid?: string;
  /** unit printed after the top tick ('h') */
  unitLabel?: string;
}) {
  const uid = useUid();
  const n = slots.length;
  const totals = slots.map((s) => (s.status === 'full' || s.status === 'partial' ? s.values.reduce((a, b) => a + Math.max(0, b), 0) : null));
  const maxV = Math.max(0, ...totals.map((v) => v ?? 0), ...(line ? line.values.map((v) => v ?? 0) : []));
  const ticks = niceTicks(0, maxV || 1, height < 220 ? 3 : 4);
  const labelW = Math.max(...ticks.ticks.map((v) => yFormat(v).length)) * 7 + 10 + (unitLabel ? 14 : 0);
  const m = { l: Math.max(30, labelW), r: line?.endLabel ? 8 : 6, t: 22, b: 40 };
  const pw = Math.max(40, width - m.l - m.r);
  const ph = height - m.t - m.b;
  const y = linear(0, ticks.max, m.t + ph, m.t);
  const band = pw / Math.max(1, n);
  const bw = Math.max(3, Math.min(maxBar, band * 0.62));
  const cx = (i: number) => m.l + band * (i + 0.5);
  const every = labelEvery(n, pw, 30);
  const peak = totals.reduce<number>((b, v, i) => (v !== null && (b < 0 || v > totals[b]!) ? i : b), -1);
  const roomy = band >= 34;
  const showTotal = (i: number): boolean => {
    if (totals[i] === null || totals[i]! <= 0) return false;
    if (i === selected || i === peak) return true;
    if (labelMode === 'peak' || !roomy) return false;
    return !!slots[i]!.highlight || slots[i]!.status === 'partial';
  };
  const select = (i: number) => onSelect?.(selected === i ? null : i);
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = Math.min(n - 1, Math.max(0, i + (e.key === 'ArrowRight' ? 1 : -1)));
      onSelect?.(next);
      (e.currentTarget.parentNode?.querySelectorAll<SVGElement>('[data-col]')[next] as SVGElement & { focus?: () => void })?.focus?.();
    }
  };
  const highlightAll = slots.length > 0 && slots.every((s) => s.highlight);

  return (
    <svg width={width} height={height} role="group" aria-label={ariaLabel} data-testid={testid} className="col-chart">
      <PaintDefs uid={uid} paints={paints} />
      {ticks.ticks.map((v, k) => (
        <g key={v}>
          <line x1={m.l} x2={m.l + pw} y1={y(v)} y2={y(v)} stroke={GRID} />
          <text x={m.l - 6} y={y(v) + 4} textAnchor="end">{yFormat(v)}{unitLabel && k === ticks.ticks.length - 1 ? ` ${unitLabel}` : ''}</text>
        </g>
      ))}
      {!highlightAll && slots.map((s, i) => (s.highlight || i === selected
        ? <rect key={`hl${s.key}`} x={m.l + band * i + 1} y={m.t - 18} width={band - 2} height={ph + 18 + 34} rx={6} fill={i === selected ? 'var(--tk-nav-active)' : 'var(--tk-info-bar-bg)'} opacity={i === selected ? 1 : 0.7} />
        : null))}
      {highlightAll && selected !== null && <rect x={m.l + band * selected + 1} y={m.t - 18} width={band - 2} height={ph + 18 + 34} rx={6} fill="var(--tk-nav-active)" />}
      <line x1={m.l} x2={m.l + pw} y1={y(0)} y2={y(0)} stroke={AXIS} />
      {slots.map((s, i) => {
        const x0 = cx(i) - bw / 2;
        if (s.status === 'notUploaded') {
          const top = y(ticks.max * 0.62);
          return (
            <g key={s.key} data-testid="col-not-uploaded" data-key={s.key}>
              <rect x={x0} y={top} width={bw} height={y(0) - top} rx={3} fill="none" stroke="var(--tk-text-muted)" strokeWidth={1.25} strokeDasharray="4 3" />
              {bw >= 50 && (
                <text x={cx(i)} y={(top + y(0)) / 2} textAnchor="middle" className="col-nu-text">
                  <tspan x={cx(i)} dy="-0.2em">{'not'}</tspan><tspan x={cx(i)} dy="1.2em">{'uploaded'}</tspan>
                </text>
              )}
            </g>
          );
        }
        if (s.status === 'noData') return null;
        let acc = 0;
        const faded = s.status === 'partial';
        const segs = s.values.map((v, k) => {
          if (!(v > 0)) return null;
          const yy = y(acc + v);
          const hh = y(acc) - yy;
          acc += v;
          return <rect key={paints[k]!.key} x={x0} y={yy} width={bw} height={Math.max(0.5, hh)} fill={`url(#${paintId(uid, paints[k]!.key)})`} opacity={faded ? 0.45 : 1} stroke="var(--tk-card-bg)" strokeWidth={0.75} />;
        });
        const top = y(acc);
        return (
          <g key={s.key} data-testid={faded ? 'col-partial' : 'col'} data-key={s.key}>
            {segs}
            {faded && acc > 0 && <rect x={x0 - 0.5} y={top - 0.5} width={bw + 1} height={y(0) - top + 1} rx={2} fill="none" stroke="var(--tk-text-secondary)" strokeWidth={1.25} strokeDasharray="4 2" />}
          </g>
        );
      })}
      {line && (() => {
        const segs: string[] = [];
        let cur = '';
        line.values.forEach((v, i) => {
          if (v === null) { if (cur) segs.push(cur); cur = ''; return; }
          cur += `${cur ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(v).toFixed(1)}`;
        });
        if (cur) segs.push(cur);
        const lastI = line.values.reduce<number>((b, v, i) => (v !== null ? i : b), -1);
        return (
          <g pointerEvents="none" data-testid="col-line">
            {segs.map((d, k) => <path key={k} d={d} fill="none" stroke={line.color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />)}
            {lastI >= 0 && <circle cx={cx(lastI)} cy={y(line.values[lastI]!)} r={4} fill="var(--tk-card-bg)" stroke={line.color} strokeWidth={2} />}
            {lastI >= 0 && line.endLabel && (
              <text x={Math.min(cx(lastI), m.l + pw)} y={Math.max(12, y(line.values[lastI]!) - 10)} textAnchor="end" className="chart-ink" fontWeight={700} {...HALO}>{line.endLabel}</text>
            )}
          </g>
        );
      })()}
      {slots.map((s, i) => (showTotal(i)
        ? <text key={`t${s.key}`} x={cx(i)} y={y(totals[i]!) - 6} textAnchor="middle" className="chart-ink" fontWeight={i === selected ? 700 : 600} {...HALO} data-testid="col-total">{format(totals[i]!)}</text>
        : null))}
      {slots.map((s, i) => {
        const show = i % every === 0 || i === selected || (s.status !== 'full' && every <= 2);
        if (!show) return null;
        const sub = s.status === 'partial' ? 'partial' : s.status === 'notUploaded' && bw < 50 ? 'n/u' : '';
        return (
          <g key={`l${s.key}`}>
            <text x={cx(i)} y={m.t + ph + 16} textAnchor="middle" className={i === selected || (s.highlight && !highlightAll) ? 'chart-ink' : undefined} fontWeight={i === selected || (s.highlight && !highlightAll) ? 700 : 400}>{s.label}</text>
            {sub && <text x={cx(i)} y={m.t + ph + 31} textAnchor="middle" className="col-sub">{sub}</text>}
          </g>
        );
      })}
      {slots.map((s, i) => {
        const tot = totals[i];
        const what = s.status === 'notUploaded' ? 'not uploaded' : s.status === 'noData' ? 'no data' : `${format(tot ?? 0)}${s.status === 'partial' ? ', partial' : ''}`;
        return (
          <rect
            key={`hit${s.key}`} className="chart-hit chart-focusable" x={m.l + band * i} y={m.t - 18} width={band} height={ph + 18 + 34}
            role="button" tabIndex={i === (selected ?? 0) ? 0 : -1} aria-pressed={i === selected} aria-label={`${s.full}: ${what}`}
            data-col={i} data-testid="col-hit" data-key={s.key} data-status={s.status}
            onClick={(e) => { e.stopPropagation(); select(i); }} onKeyDown={(e) => onKey(e, i)}
          />
        );
      })}
    </svg>
  );
}
