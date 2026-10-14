// Pareto: bars descending in ONE colour (accent), cumulative % line, 80% reference line. The "Others" bar is
// hatched and outlined. Mouse: hover for the numbers, click to open the events. Touch: tap for the numbers and
// a button to open the events. Keyboard: bars are buttons.
// Phones (600 px and narrower) get the same Pareto drawn sideways: one row per item, the name on the left, the bar
// and its value, then the cumulative share with the 80% line as a dashed mark (no rotated labels, no sideways scroll).
import { useState, type ReactNode } from 'react';
import type { ParetoBar, ParetoResult } from '../calc';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { t } from '../i18n/t';
import { num } from '../util/format';
import { HatchDefs, TipLayer, TipRows, useChartTip, useUid, type ChartTable } from './ChartKit';
import { ACCENT, AXIS, GRID, INK } from './palette';
import { linear, niceTicks, axisNum } from './scale';

const SLOT = 34;
/** the sideways (rows) Pareto on phones */
export const PHONE_QUERY = '(max-width: 600px)';
const ROW = 30;
const HEAD = 20;
/** a card-coloured outline so a value label stays readable where a line crosses it */
const HALO = { stroke: 'var(--tk-card-bg)', strokeWidth: 3, paintOrder: 'stroke' } as const;

export function paretoTable(result: ParetoResult, valueHead: string, fmt: (n: number) => string): ChartTable {
  return {
    head: [t('Item'), valueHead, t('Share %'), t('Cumulative %')],
    rows: result.bars.map((b) => [b.isOthers ? `${b.label} (${b.entryCount})` : b.label, fmt(b.value), `${b.sharePct.toFixed(1)}`, `${b.cumulativePct.toFixed(1)}`]),
  };
}

/**
 * The first sentence of a Pareto's summary: items, total and the largest one. The share of the shown items and the
 * items needed for 80% are added by the caller from the complete Pareto (see paretoHonestText), never 'the first N
 * bars reach 80%' counted on a cut chart.
 */
export function paretoSummary(result: ParetoResult, what: string, unit: string, fmt: (n: number) => string): string {
  if (result.bars.length === 0) return t('No {what} in the selected scope.', { what });
  const top = result.bars[0]!;
  return t('{n} items, {total} {unit} in total. Largest: {label}, {value} {unit} ({share}%).', {
    n: result.entryCount, total: fmt(result.total), unit, label: top.label, value: fmt(top.value), share: top.sharePct.toFixed(1),
  });
}

function short(label: string, max = 16): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

export default function ParetoChart({
  result, width, height = 300, valueLabel, format, onBar, ariaLabel, openLabel, static: isStatic = false, onAction,
}: {
  result: ParetoResult;
  width: number;
  height?: number;
  valueLabel: string;
  format: (n: number) => string;
  onBar?: (bar: ParetoBar) => void;
  /** a second button in the tooltip: "Create action" from this bar (not on Others) */
  onAction?: (bar: ParetoBar) => void;
  ariaLabel: string;
  openLabel?: (bar: ParetoBar) => string;
  /** report mode: no tooltips, hit areas or sideways scrolling, only the drawing fitted to `width` (for print and PDF) */
  static?: boolean;
}) {
  const uid = useUid();
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const { tip, bind, hide } = useChartTip({ current: box } as React.RefObject<HTMLDivElement | null>);
  const phone = useMediaQuery(PHONE_QUERY) && !isStatic;
  const bars = result.bars;
  const n = bars.length;
  if (n === 0) return <p className="muted" data-testid="pareto-empty">{t('Nothing to show for these filters.')}</p>;

  const maxLabel = Math.max(...bars.map((b) => Math.min(b.label.length, 16)));
  const m = { l: 46, r: 40, t: 26, b: Math.min(110, 18 + maxLabel * 6.2) };
  const innerMin = isStatic ? 0 : n * SLOT;
  const avail = width - m.l - m.r;
  const pw = Math.max(avail, innerMin);
  const svgW = pw + m.l + m.r;
  const ph = height - m.t - m.b;
  // a huge "Others" bar would flatten the named bars: it is drawn no taller than the largest named bar, as a thin
  // hatched bar with a break mark, and its real number is printed above it
  const own = bars.filter((b) => !b.isOthers).map((b) => b.value);
  const maxOwn = own.length ? Math.max(...own) : 0;
  const others = bars.find((b) => b.isOthers);
  const clipped = !!others && maxOwn > 0 && others.value > maxOwn * 1.2;
  const scale = niceTicks(0, clipped ? maxOwn * 1.2 : Math.max(...bars.map((b) => b.value)), 5);
  const yRaw = linear(0, scale.max, m.t + ph, m.t);
  const y = (v: number): number => Math.max(m.t, yRaw(v));
  const shown = (b: ParetoBar): number => (clipped && b.isOthers ? maxOwn : b.value);
  const yp = linear(0, 100, m.t + ph, m.t);
  const band = pw / n;
  const bw = Math.min(band * 0.7, 48);
  const bwOf = (b: ParetoBar): number => (b.isOthers ? Math.max(8, bw * 0.55) : bw);
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
      {onAction && !b.isOthers && (
        <button type="button" className="btn btn-sm" data-testid="tip-action" onClick={(e) => { e.stopPropagation(); hide(); onAction(b); }}>
          {t('Create action')}
        </button>
      )}
    </>
  );

  if (phone) {
    return (
      <div ref={setBox} style={{ position: 'relative' }} data-testid="pareto-chart" data-layout="rows">
        <ParetoRows result={result} width={width} format={format} valueLabel={valueLabel} ariaLabel={ariaLabel} uid={uid}
          hit={(b, i, geo) => {
            const label = `${b.label}: ${format(b.value)} ${valueLabel}, ${b.sharePct.toFixed(1)}% of total, cumulative ${b.cumulativePct.toFixed(1)}%`;
            return (
              <rect key={`hit${i}`} className="chart-hit chart-focusable" x={0} y={geo.y} width={width} height={geo.h}
                tabIndex={0} role="button" aria-label={label} data-testid="pareto-bar" data-key={b.key}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && onBar) { e.preventDefault(); onBar(b); } }}
                {...bind(node(b), onBar ? () => onBar(b) : undefined)} />
            );
          }}
          onBackground={hide} />
        <TipLayer tip={tip} width={width} />
      </div>
    );
  }

  // the cumulative line runs through the named bars; the step to the merged Others point is dashed so it does not
  // read as one more ranked item. Its end is the true cumulative share (labelled).
  const named = bars.map((b, i) => ({ b, i })).filter((x) => !x.b.isOthers);
  const line = named.map((x, k) => `${k ? 'L' : 'M'}${cx(x.i).toFixed(1)} ${yp(x.b.cumulativePct).toFixed(1)}`).join('');
  const lastNamed = named[named.length - 1];
  const othersIdx = bars.findIndex((b) => b.isOthers);
  const tail = lastNamed && othersIdx >= 0 ? `M${cx(lastNamed.i).toFixed(1)} ${yp(lastNamed.b.cumulativePct).toFixed(1)}L${cx(othersIdx).toFixed(1)} ${yp(bars[othersIdx]!.cumulativePct).toFixed(1)}` : '';
  const refIdx = result.referenceIndex;

  return (
    <div ref={setBox} style={{ position: 'relative' }} data-testid="pareto-chart">
      <div className={!isStatic && avail < innerMin ? 'chart-scroll' : undefined}>
        <svg width={svgW} height={height} role="img" aria-label={ariaLabel} onClick={hide}>
          <title>{ariaLabel}</title>
          <HatchDefs id={`o-${uid}`} color={ACCENT} />
          {scale.ticks.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={m.l + pw} y1={y(v)} y2={y(v)} stroke={GRID} />
              <text x={m.l - 6} y={y(v) + 4} textAnchor="end">{axisNum(v)}</text>
            </g>
          ))}
          {[0, 50, 100].filter((p) => Math.abs(yp(p) - yp(result.referencePct)) > 14).map((p) => <text key={p} x={m.l + pw + 6} y={yp(p) + 4}>{p}%</text>)}
          <line x1={m.l} x2={m.l + pw} y1={y(0)} y2={y(0)} stroke={AXIS} />

          {bars.map((b, i) => (
            <g key={b.key + i}>
              <rect x={cx(i) - bwOf(b) / 2} y={y(shown(b))} width={bwOf(b)} height={Math.max(1, y(0) - y(shown(b)))}
                fill={b.isOthers ? `url(#o-${uid})` : ACCENT} stroke={ACCENT} strokeWidth={b.isOthers ? 1.75 : 0} strokeDasharray={b.isOthers ? '4 2' : undefined} />
              {clipped && b.isOthers && <path d={`M${cx(i) - bwOf(b) / 2 - 2} ${y(shown(b)) + 14}l${bwOf(b) / 4 + 1} -5l${bwOf(b) / 4 + 1} 5l${bwOf(b) / 4 + 1} -5l${bwOf(b) / 4 + 1} 5`} fill="none" stroke="var(--tk-card-bg)" strokeWidth="3" />}
              {showValues && !(clipped && b.isOthers) && <text x={cx(i)} y={y(b.value) - 4} textAnchor="middle" className="chart-ink" {...HALO}>{format(b.value)}</text>}
              <text transform={`translate(${cx(i) + 4} ${y(0) + 10}) rotate(-45)`} textAnchor="end">{short(b.label)}</text>
            </g>
          ))}

          <line x1={m.l} x2={m.l + pw} y1={yp(result.referencePct)} y2={yp(result.referencePct)} stroke={INK} strokeWidth="1.25" strokeDasharray="6 4" />
          <text x={m.l + pw + 6} y={yp(result.referencePct) + 4} className="chart-ink">{result.referencePct}%</text>
          {tail && <path d={tail} fill="none" stroke={INK} strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" />}
          <path d={line} fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
          {bars.map((b, i) => (
            <circle key={`c${i}`} cx={cx(i)} cy={yp(b.cumulativePct)} r={refIdx === i ? 6 : b.isOthers ? 3 : 3.5} fill={refIdx === i ? 'var(--tk-card-bg)' : INK} stroke={INK} strokeWidth="2" />
          ))}


          {clipped && bars.map((b, i) => (b.isOthers ? <text key={`ov${i}`} x={cx(i)} y={y(shown(b)) - 8} textAnchor="middle" className="chart-ink" {...HALO}>{format(b.value)}</text> : null))}

          {!isStatic && bars.map((b, i) => {
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
      {!isStatic && <TipLayer tip={tip} width={Math.min(width, svgW)} />}
    </div>
  );
}

/**
 * The phone Pareto: one row per item (name left, bar, value right of the bar), then the cumulative share as a number
 * over a thin track, with the reference share (80%) as a dashed line down the tracks. 'Others' is hatched; when it is
 * larger than the biggest named item its bar is capped there with a break mark and its real number beside it.
 */
function ParetoRows({ result, width, format, valueLabel, ariaLabel, uid, hit, onBackground }: {
  result: ParetoResult; width: number; format: (n: number) => string; valueLabel: string; ariaLabel: string; uid: string;
  hit: (b: ParetoBar, i: number, geo: { y: number; h: number }) => ReactNode;
  onBackground: () => void;
}) {
  const bars = result.bars;
  const cumW = 62;
  const valW = Math.max(40, Math.max(...bars.map((b) => format(b.value).length)) * 7.4 + 8);
  const longest = Math.max(...bars.map((b) => b.label.length));
  const labelW = Math.round(Math.min(width * 0.36, Math.max(64, Math.min(longest, 16) * 7.2 + 8)));
  const fitChars = Math.max(4, Math.floor((labelW - 6) / 7.2));
  const barX = labelW;
  const barMax = Math.max(24, width - labelW - valW - cumW);
  const own = bars.filter((b) => !b.isOthers).map((b) => b.value);
  const maxOwn = own.length ? Math.max(...own) : 0;
  const others = bars.find((b) => b.isOthers);
  const clipped = !!others && maxOwn > 0 && others.value > maxOwn * 1.2;
  const top = clipped ? maxOwn * 1.2 : Math.max(...bars.map((b) => b.value), 0);
  const len = (b: ParetoBar): number => (top > 0 ? Math.max(1.5, (Math.min(b.value, top) / top) * barMax) : 0);
  const cumX = width - cumW + 8;
  const trackW = cumW - 12;
  const refX = cumX + (result.referencePct / 100) * trackW;
  const h = HEAD + bars.length * ROW + 4;
  const refIdx = result.referenceIndex;
  return (
    <svg width={width} height={h} role="img" aria-label={ariaLabel} onClick={onBackground} data-testid="pareto-rows">
      <title>{ariaLabel}</title>
      <HatchDefs id={`r-${uid}`} color={ACCENT} />
      <text x={0} y={13}>{t('Item')}</text>
      <text x={barX} y={13}>{valueLabel}</text>
      <text x={width} y={13} textAnchor="end">{t('Cum. %')}</text>
      {bars.map((b, i) => {
        const y = HEAD + i * ROW;
        const mid = y + ROW / 2;
        const l = len(b);
        const ref = refIdx === i;
        return (
          <g key={b.key + i}>
            <text x={0} y={mid + 4} className="chart-ink" fontWeight={ref ? 700 : undefined}>{short(b.isOthers ? t('Others') : b.label, fitChars)}</text>
            <rect x={barX} y={mid - 7} width={l} height={14} rx={2}
              fill={b.isOthers ? `url(#r-${uid})` : ACCENT} stroke={ACCENT} strokeWidth={b.isOthers ? 1.5 : 0} strokeDasharray={b.isOthers ? '4 2' : undefined} />
            {clipped && b.isOthers && <path d={`M${barX + l - 12} ${mid - 9}l4 18M${barX + l - 7} ${mid - 9}l4 18`} stroke="var(--tk-card-bg)" strokeWidth="3" />}
            <text x={barX + l + 5} y={mid + 4} className="chart-ink" {...HALO}>{format(b.value)}</text>
            <text x={cumX} y={mid + 2} fontWeight={ref ? 700 : undefined} className={ref ? 'chart-ink' : undefined}>{`${b.cumulativePct.toFixed(1)}%`}</text>
            <rect x={cumX} y={mid + 6} width={trackW} height={3} rx={1.5} fill={GRID} />
            <rect x={cumX} y={mid + 6} width={(Math.min(100, b.cumulativePct) / 100) * trackW} height={3} rx={1.5} fill={INK} />
          </g>
        );
      })}
      <line x1={refX} x2={refX} y1={HEAD - 2} y2={h - 2} stroke={INK} strokeWidth="1.25" strokeDasharray="3 3" />
      {bars.map((b, i) => hit(b, i, { y: HEAD + i * ROW, h: ROW }))}
    </svg>
  );
}
