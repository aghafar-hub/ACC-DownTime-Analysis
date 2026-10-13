// Failure timeline of one equipment code: each event is a mark at its start, tall for long stops, with the
// gap in days between successive failures drawn underneath.
import { useState, type ReactNode } from 'react';
import { monthsOfRange, parseDate, rangeToInterval, type DateRange } from '../calc';
import { t } from '../i18n/t';
import { TipLayer, TipRows, useChartTip } from './ChartKit';
import { AXIS, GRID } from './palette';

export interface TimelineEvent { id: string; startMs: number; endMs: number; hours: number; reason: string; area: string }

export default function TimelineChart({
  events, range, width, ariaLabel, onEvent, openLabel, static: isStatic = false,
}: {
  events: TimelineEvent[]; range: DateRange; width: number; ariaLabel: string; onEvent?: (e: TimelineEvent) => void; openLabel?: string;
  /** report mode: no tooltips and no hit areas, only the drawing (for print and PDF) */
  static?: boolean;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const { tip, bind, hide } = useChartTip({ current: box } as React.RefObject<HTMLDivElement | null>);
  const iv = rangeToInterval(range);
  const m = { l: 14, r: 14, t: 22, b: 70 };
  const pw = Math.max(80, width - m.l - m.r);
  const markTop = m.t;
  const markMax = 64;
  const x = (ms: number): number => m.l + ((ms - iv.fromMs) / (iv.toMs - iv.fromMs)) * pw;
  const maxH = Math.max(...events.map((e) => e.hours), 1e-9);
  const hOf = (e: TimelineEvent): number => 14 + (markMax - 14) * Math.sqrt(e.hours / maxH);
  const base = markTop + markMax;
  const height = base + m.b;
  const months = monthsOfRange(range);
  const monthEvery = Math.max(1, Math.ceil((months.length * 48) / pw));

  // value labels: longest stops first; a label is dropped when it would sit on top of one already placed (the tooltip has every value)
  const labelled = new Set<number>();
  const placed: number[] = [];
  [...events.keys()].sort((a, b) => events[b]!.hours - events[a]!.hours).forEach((i) => {
    const e = events[i]!;
    if (!(events.length <= 14 || e.hours >= maxH * 0.6)) return;
    const cx = x(e.startMs);
    if (placed.some((p) => Math.abs(p - cx) < 40)) return;
    placed.push(cx);
    labelled.add(i);
  });

  const node = (e: TimelineEvent, gapDays: number | null): ReactNode => (
    <>
      <TipRows title={`${new Date(e.startMs).toISOString().slice(0, 16).replace('T', ' ')} · ${e.area}`} rows={[
        { label: t('Duration'), value: `${e.hours.toFixed(2)} h` },
        { label: t('Reason'), value: e.reason || t('(blank)') },
        ...(gapDays !== null ? [{ label: t('Days since previous'), value: gapDays.toFixed(1) }] : []),
      ]} />
      {onEvent && <button type="button" className="btn btn-sm" onClick={(ev) => { ev.stopPropagation(); hide(); onEvent(e); }}>{openLabel}</button>}
    </>
  );

  return (
    <div ref={setBox} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onClick={hide} data-testid="timeline">
        <title>{ariaLabel}</title>
        <line x1={m.l} x2={m.l + pw} y1={base} y2={base} stroke={AXIS} strokeWidth="1.5" />
        {months.map((mo, i) => {
          const ms = parseDate(`${mo}-01`);
          if (ms === null || ms < iv.fromMs || ms > iv.toMs) return null;
          return (
            <g key={mo}>
              <line x1={x(ms)} x2={x(ms)} y1={markTop} y2={base + 4} stroke={GRID} />
              {i % monthEvery === 0 && <text x={x(ms) + 3} y={base + 18}>{mo}</text>}
            </g>
          );
        })}
        {events.map((e, i) => {
          const prev = events[i - 1];
          const gapDays = prev ? (e.startMs - prev.startMs) / 86_400_000 : null;
          const w = Math.max(4, x(Math.max(e.endMs, e.startMs)) - x(e.startMs));
          return (
            <g key={e.id}>
              {prev && x(e.startMs) - x(prev.startMs) > 38 && (
                <g>
                  <line x1={x(prev.startMs) + 4} x2={x(e.startMs) - 4} y1={base + 38} y2={base + 38} stroke="var(--tk-text-secondary)" strokeWidth="1.25" strokeDasharray="3 3" />
                  <text x={(x(prev.startMs) + x(e.startMs)) / 2} y={base + 54} textAnchor="middle">{gapDays!.toFixed(0)} d</text>
                </g>
              )}
              <rect x={x(e.startMs)} y={base - hOf(e)} width={w} height={hOf(e)} fill="var(--tk-danger)" stroke="var(--tk-card-bg)" strokeWidth="0.75" />
              <path d={`M${x(e.startMs) + w / 2} ${base - hOf(e) - 3}l-4 -6h8z`} fill="var(--tk-danger)" />
              {labelled.has(i) && <text x={x(e.startMs) + w / 2} y={base - hOf(e) - 12} textAnchor="middle" className="chart-ink">{e.hours.toFixed(1)} h</text>}
              {!isStatic && <rect className="chart-hit" x={x(e.startMs) - 8} y={markTop - 6} width={w + 16} height={markMax + 12} data-testid="timeline-mark" {...bind(node(e, gapDays))} />}
            </g>
          );
        })}
      </svg>
      {!isStatic && <TipLayer tip={tip} width={width} />}
    </div>
  );
}
