// Pareto: bars descending in ONE colour (accent), cumulative % line, 80% reference line. The "Others" bar is
// hatched and outlined. Mouse: hover for the numbers, click to open the events. Touch: tap for the numbers and
// a button to open the events. Keyboard: bars are buttons.
import { useState, type ReactNode } from 'react';
import type { ParetoBar, ParetoResult } from '../calc';
import { t } from '../i18n/t';
import { num } from '../util/format';
import { HatchDefs, TipLayer, TipRows, useChartTip, useUid, type ChartTable } from './ChartKit';
import { ACCENT, AXIS, GRID, INK } from './palette';
import { linear, niceTicks, axisNum } from './scale';

const SLOT = 34;

export function paretoTable(result: ParetoResult, valueHead: string, fmt: (n: number) => string): ChartTable {
  return {
    head: [t('Item'), valueHead, t('Share %'), t('Cumulative %')],
    rows: result.bars.map((b) => [b.isOthers ? `${b.label} (${b.entryCount})` : b.label, fmt(b.value), `${b.sharePct.toFixed(1)}`, `${b.cumulativePct.toFixed(1)}`]),
  };
}

export function paretoSummary(result: ParetoResult, what: string, unit: string, fmt: (n: number) => string): string {
  if (result.bars.length === 0) return t('No {what} in the selected scope.', { what });
  const top = result.bars[0]!;
  const ref = result.referenceIndex;
  const refText = ref === null ? '' : ref === 0 ? t(' The first bar alone reaches {p}%.', { p: result.referencePct }) : t(' The first {n} bars reach {p}%.', { n: ref + 1, p: result.referencePct });
  return t('{n} items, {total} {unit} in total. Largest: {label}, {value} {unit} ({share}%).', {
    n: result.entryCount, total: fmt(result.total), unit, label: top.label, value: fmt(top.value), share: top.sharePct.toFixed(1),
  }) + refText;
}

function short(label: string, max = 16): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export default function ParetoChart({
  result, width, height = 300, valueLabel, format, onBar, ariaLabel, openLabel,
}: {
  result: ParetoResult;
  width: number;
  height?: number;
  valueLabel: string;
  format: (n: number) => string;
  onBar?: (bar: ParetoBar) => void;
  ariaLabel: string;
  openLabel?: (bar: ParetoBar) => string;
}) {
  const uid = useUid();
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const { tip, bind, hide } = useChartTip({ current: box } as React.RefObject<HTMLDivElement | null>);
  const bars = result.bars;
  const n = bars.length;
  if (n === 0) return <p className="muted" data-testid="pareto-empty">{t('Nothing to show for these filters.')}</p>;

  const maxLabel = Math.max(...bars.map((b) => Math.min(b.label.length, 16)));
  const m = { l: 46, r: 40, t: 16, b: Math.min(110, 18 + maxLabel * 6.2) };
  const innerMin = n * SLOT;
  const avail = width - m.l - m.r;
  const pw = Math.max(avail, innerMin);
  const svgW = pw + m.l + m.r;
  const ph = height - m.t - m.b;
  // a huge "Others" bar would flatten the named bars: cut it off at the top of the plot (its number is printed)
  const own = bars.filter((b) => !b.isOthers).map((b) => b.value);
  const maxOwn = own.length ? Math.max(...own) : 0;
  const others = bars.find((b) => b.isOthers);
  const clipped = !!others && maxOwn > 0 && others.value > maxOwn * 1.6;
  const scale = niceTicks(0, clipped ? maxOwn * 1.2 : Math.max(...bars.map((b) => b.value)), 5);
  const yRaw = linear(0, scale.max, m.t + ph, m.t);
  const y = (v: number): number => Math.max(m.t, yRaw(v));
  const yp = linear(0, 100, m.t + ph, m.t);
  const band = pw / n;
  const bw = Math.min(band * 0.7, 48);
  const cx = (i: number): number => m.l + band * (i + 0.5);
  const showValues = band >= 40;

  const node = (b: ParetoBar): ReactNode => (
    <>
      <TipRows
        title={b.isOthers ? t('Others ({n} items)', { n: b.entryCount }) : b.label}
        rows={[
          { label: valueLabel, value: format(b.value) },
          { label: t('Share of total'), value: `${b.sharePct.toFixed(1)}%` },
          { label: t('Cumulative share'), value: `${b.cumulativePct.toFixed(1)}%` },
          { label: t('Events'), value: num(b.eventIds.length) },
        ]}
      />
      {onBar && (
        <button type="button" className="btn btn-sm" data-testid="tip-open" onClick={(e) => { e.stopPropagation(); hide(); onBar(b); }}>
          {openLabel ? openLabel(b) : t('Open {n} events', { n: num(b.eventIds.length) })}
        </button>
      )}
    </>
  );

  const line = bars.map((b, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)} ${yp(b.cumulativePct).toFixed(1)}`).join('');
  const refIdx = result.referenceIndex;

  return (
    <div ref={setBox} style={{ position: 'relative' }} data-testid="pareto-chart">
      <div className={avail < innerMin ? 'chart-scroll' : undefined}>
        <svg width={svgW} height={height} role="img" aria-label={ariaLabel} onClick={hide}>
          <title>{ariaLabel}</title>
          <HatchDefs id={`o-${uid}`} color={ACCENT} />
          {scale.ticks.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={m.l + pw} y1={y(v)} y2={y(v)} stroke={GRID} />
              <text x={m.l - 6} y={y(v) + 4} textAnchor="end">{axisNum(v)}</text>
            </g>
          ))}
          {[0, 50, 100].map((p) => <text key={p} x={m.l + pw + 6} y={yp(p) + 4}>{p}%</text>)}
          <line x1={m.l} x2={m.l + pw} y1={y(0)} y2={y(0)} stroke={AXIS} />

          {bars.map((b, i) => (
            <g key={b.key + i}>
              <rect x={cx(i) - bw / 2} y={y(b.value)} width={bw} height={Math.max(1, y(0) - y(b.value))}
                fill={b.isOthers ? `url(#o-${uid})` : ACCENT} stroke={ACCENT} strokeWidth={b.isOthers ? 1.75 : 0} strokeDasharray={b.isOthers ? '4 2' : undefined} />
              {clipped && b.isOthers && <path d={`M${cx(i) - bw / 2 - 2} ${m.t + 14}l${bw / 4 + 1} -5l${bw / 4 + 1} 5l${bw / 4 + 1} -5l${bw / 4 + 1} 5`} fill="none" stroke="var(--tk-card-bg)" strokeWidth="3" />}
              {clipped && b.isOthers && <text x={cx(i)} y={m.t - 3} textAnchor="middle" className="chart-ink">{format(b.value)}</text>}
              {showValues && !(clipped && b.isOthers) && <text x={cx(i)} y={y(b.value) - 4} textAnchor="middle" className="chart-ink">{format(b.value)}</text>}
              <text transform={`translate(${cx(i) + 4} ${y(0) + 10}) rotate(-45)`} textAnchor="end">{short(b.label)}</text>
            </g>
          ))}

          <line x1={m.l} x2={m.l + pw} y1={yp(result.referencePct)} y2={yp(result.referencePct)} stroke={INK} strokeWidth="1.25" strokeDasharray="6 4" />
          <text x={m.l + 4} y={yp(result.referencePct) - 4} className="chart-ink">{result.referencePct}%</text>
          <path d={line} fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
          {bars.map((b, i) => (
            <circle key={`c${i}`} cx={cx(i)} cy={yp(b.cumulativePct)} r={refIdx === i ? 6 : 3.5} fill={refIdx === i ? 'var(--tk-card-bg)' : INK} stroke={INK} strokeWidth="2" />
          ))}

          {bars.map((b, i) => {
            const label = `${b.label}: ${format(b.value)} ${valueLabel}, ${b.sharePct.toFixed(1)}% of total, cumulative ${b.cumulativePct.toFixed(1)}%`;
            const h = bind(node(b), onBar ? () => onBar(b) : undefined);
            return (
              <rect key={`hit${i}`} className="chart-hit chart-focusable" x={m.l + band * i} y={m.t} width={band} height={ph}
                tabIndex={0} role="button" aria-label={label} data-testid="pareto-bar" data-key={b.key}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && onBar) { e.preventDefault(); onBar(b); } }}
                {...h} />
            );
          })}
        </svg>
      </div>
      <TipLayer tip={tip} width={Math.min(width, svgW)} />
    </div>
  );
}
