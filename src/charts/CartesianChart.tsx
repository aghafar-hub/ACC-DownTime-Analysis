// Vertical bars (grouped or stacked) and lines over one category axis. Missing values (null) are left out:
// a gap in a line, no bar. A tooltip per category lists every series with its number (mouse hover or tap).
import { useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import { HatchDefs, TipLayer, TipRows, Swatch, useChartTip, useUid, type ChartTable } from './ChartKit';
import { AXIS, GRID, INK, MARKERS, type Marker } from './palette';
import { labelEvery, linear, niceTicks, axisNum } from './scale';

export interface CartCategory { key: string; label: string; partial?: boolean; note?: string }
export interface CartSeries {
  key: string;
  label: string;
  color: string;
  type: 'bar' | 'line';
  values: (number | null)[];
  /** bars with the same stack id are stacked; without one a bar series stands next to the others */
  stack?: string;
  dash?: string;
  marker?: Marker;
  format?: (n: number) => string;
  /** reason shown in the tooltip where the value is null */
  missing?: (string | undefined)[];
  /** bar colours per category (overrides color) */
  pointColors?: string[];
  /** extra text per category in the tooltip */
  pointNotes?: (string | undefined)[];
}
export interface RefLine { value: number; label: string; color?: string; dash?: string }

export function MarkerShape({ kind, x, y, color, r = 4 }: { kind: Marker; x: number; y: number; color: string; r?: number }) {
  switch (kind) {
    case 'square': return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} fill={color} stroke="var(--tk-card-bg)" strokeWidth="1" />;
    case 'diamond': return <path d={`M${x} ${y - r - 1}L${x + r + 1} ${y}L${x} ${y + r + 1}L${x - r - 1} ${y}Z`} fill={color} stroke="var(--tk-card-bg)" strokeWidth="1" />;
    case 'triangle': return <path d={`M${x} ${y - r - 1}L${x + r + 1} ${y + r}L${x - r - 1} ${y + r}Z`} fill={color} stroke="var(--tk-card-bg)" strokeWidth="1" />;
    default: return <circle cx={x} cy={y} r={r} fill={color} stroke="var(--tk-card-bg)" strokeWidth="1" />;
  }
}

export function seriesTable(categories: CartCategory[], series: CartSeries[], firstHead: string, fmt: (s: CartSeries, n: number) => string = (s, n) => (s.format ? s.format(n) : String(n))): ChartTable {
  return {
    head: [firstHead, ...series.map((s) => s.label)],
    rows: categories.map((c, i) => [
      c.partial ? `${c.label} (${t('partial')})` : c.label,
      ...series.map((s) => (s.values[i] === null || s.values[i] === undefined ? (s.missing?.[i] ? `${t('Unavailable')}` : '-') : fmt(s, s.values[i]!))),
    ]),
  };
}

export default function CartesianChart({
  categories, series, width, height = 240, ariaLabel, yFormat = axisNum, zeroBased = true, refLines = [], yMax, yMin, onCategory, maxBarWidth = 44, marginLeft,
}: {
  categories: CartCategory[];
  series: CartSeries[];
  width: number;
  height?: number;
  ariaLabel: string;
  yFormat?: (n: number) => string;
  zeroBased?: boolean;
  refLines?: RefLine[];
  yMax?: number;
  yMin?: number;
  /** tap on a category opens something (tooltip button) */
  onCategory?: (index: number) => ReactNode;
  maxBarWidth?: number;
  /** fixed left margin, so stacked charts line up */
  marginLeft?: number;
}) {
  const uid = useUid();
  const [boxRef, setBox] = useState<HTMLDivElement | null>(null);
  const ref = { current: boxRef } as React.RefObject<HTMLDivElement | null>;
  const { tip, bind, hide } = useChartTip(ref);
  const [active, setActive] = useState<number | null>(null);

  const n = categories.length;
  const stacks = new Map<string, CartSeries[]>();
  for (const s of series) if (s.type === 'bar') (stacks.get(s.stack ?? `solo:${s.key}`) ?? stacks.set(s.stack ?? `solo:${s.key}`, []).get(s.stack ?? `solo:${s.key}`)!).push(s);
  const slots = [...stacks.values()];

  // y domain
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    for (const group of slots) {
      let sum = 0;
      for (const s of group) sum += s.values[i] ?? 0;
      if (group.some((s) => s.values[i] != null)) { hi = Math.max(hi, sum); lo = Math.min(lo, 0); }
    }
    for (const s of series) if (s.type === 'line' && s.values[i] != null) { hi = Math.max(hi, s.values[i]!); lo = Math.min(lo, s.values[i]!); }
  }
  for (const r of refLines) { hi = Math.max(hi, r.value); lo = Math.min(lo, r.value); }
  if (!Number.isFinite(hi)) { hi = 1; lo = 0; }
  if (zeroBased) lo = Math.min(0, lo);
  if (yMax !== undefined) hi = yMax;
  if (yMin !== undefined) lo = yMin;
  const scale = niceTicks(lo, hi, height < 200 ? 3 : 5);
  const yTop = yMax !== undefined ? yMax : scale.max;
  const yBot = yMin !== undefined ? yMin : scale.min;

  const labelW = Math.max(...scale.ticks.map((v) => yFormat(v).length)) * 7 + 10;
  const m = { l: marginLeft ?? Math.max(34, labelW), r: 12, t: 12, b: 28 };
  const pw = Math.max(40, width - m.l - m.r);
  const ph = height - m.t - m.b;
  const y = linear(yBot, yTop, m.t + ph, m.t);
  const band = pw / Math.max(1, n);
  const cx = (i: number): number => m.l + band * (i + 0.5);
  const every = labelEvery(n, pw, 46);

  const groupW = Math.min(band * 0.78, maxBarWidth * Math.max(1, slots.length));
  const slotW = slots.length ? groupW / slots.length : 0;

  const tipNode = (i: number): ReactNode => (
    <>
      <TipRows
        title={categories[i]!.partial ? `${categories[i]!.label} (${t('partial')})` : categories[i]!.label}
        rows={series.map((s) => {
          const v = s.values[i];
          const fmt = s.format ?? yFormat;
          return {
            swatch: <Swatch color={s.pointColors?.[i] ?? s.color} symbol={s.type === 'line' ? 'line' : 'bar'} />,
            label: s.label,
            value: v === null || v === undefined ? s.missing?.[i] ?? t('Unavailable') : fmt(v),
          };
        })}
      />
      {categories[i]!.note && <div className="chart-tip-note">{categories[i]!.note}</div>}
      {series.map((s) => s.pointNotes?.[i] ? <div key={s.key} className="chart-tip-note">{s.pointNotes[i]}</div> : null)}
      {onCategory?.(i)}
    </>
  );

  return (
    <div ref={setBox} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} onClick={() => { hide(); setActive(null); }}>
        <title>{ariaLabel}</title>
        <HatchDefs id={`h-${uid}`} color="var(--tk-text-primary)" />
        {scale.ticks.filter((v) => v >= yBot && v <= yTop).map((v) => (
          <g key={v}>
            <line x1={m.l} x2={m.l + pw} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth="1" />
            <text x={m.l - 6} y={y(v) + 4} textAnchor="end">{yFormat(v)}</text>
          </g>
        ))}
        <line x1={m.l} x2={m.l + pw} y1={y(Math.max(0, yBot))} y2={y(Math.max(0, yBot))} stroke={AXIS} strokeWidth="1" />
        {categories.map((c, i) => (i % every === 0 ? (
          <text key={c.key} x={cx(i)} y={height - 8} textAnchor="middle">{c.label}{c.partial ? '*' : ''}</text>
        ) : null))}

        {active !== null && tip && <rect x={m.l + band * active} y={m.t} width={band} height={ph} fill="var(--tk-nav-active)" />}

        {slots.map((group, gi) => categories.map((c, i) => {
          let acc = 0;
          const x0 = cx(i) - groupW / 2 + gi * slotW + (slotW - Math.min(slotW - 2, maxBarWidth)) / 2;
          const w = Math.max(2, Math.min(slotW - 2, maxBarWidth));
          return group.map((s) => {
            const v = s.values[i];
            if (v === null || v === undefined || v <= 0) return null;
            const yy = y(acc + v);
            const hh = y(acc) - yy;
            acc += v;
            return (
              <rect key={`${s.key}-${i}`} x={x0} y={yy} width={w} height={Math.max(0, hh)} fill={s.pointColors?.[i] ?? s.color}
                stroke={c.partial ? INK : 'var(--tk-card-bg)'} strokeWidth={c.partial ? 1.5 : 0.75} strokeDasharray={c.partial ? '4 2' : undefined} />
            );
          });
        }))}

        {refLines.map((r) => (
          <g key={r.label}>
            <line x1={m.l} x2={m.l + pw} y1={y(r.value)} y2={y(r.value)} stroke={r.color ?? 'var(--tk-text-primary)'} strokeWidth="1.5" strokeDasharray={r.dash ?? '6 4'} />
            <text x={m.l + pw} y={y(r.value) - 4} textAnchor="end" className="chart-ink">{r.label}</text>
          </g>
        ))}

        {series.filter((s) => s.type === 'line').map((s, si) => {
          const segs: string[] = [];
          let cur = '';
          s.values.forEach((v, i) => {
            if (v === null || v === undefined) { if (cur) segs.push(cur); cur = ''; return; }
            cur += `${cur ? 'L' : 'M'}${cx(i).toFixed(1)} ${y(v).toFixed(1)}`;
          });
          if (cur) segs.push(cur);
          const kind = s.marker ?? MARKERS[si % MARKERS.length]!;
          const dots = n <= 40;
          return (
            <g key={s.key}>
              {segs.map((d, k) => <path key={k} d={d} fill="none" stroke={s.color} strokeWidth="2.25" strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />)}
              {s.values.map((v, i) => (v === null || v === undefined ? null : dots || isLone(s.values, i) ? <MarkerShape key={i} kind={kind} x={cx(i)} y={y(v)} color={s.color} /> : null))}
            </g>
          );
        })}

        {categories.map((c, i) => (
          <rect key={`hit-${c.key}`} className="chart-hit" x={m.l + band * i} y={m.t} width={band} height={ph}
            {...wrap(bind(tipNode(i)), () => setActive(i))} />
        ))}
      </svg>
      <TipLayer tip={tip} width={width} />
    </div>
  );
}

function isLone(values: (number | null)[], i: number): boolean {
  return (values[i - 1] ?? null) === null && (values[i + 1] ?? null) === null;
}

/** Run an extra action when a tooltip opens (marks the active category). */
function wrap(h: ReturnType<ReturnType<typeof useChartTip>['bind']> extends infer R ? R : never, on: () => void) {
  const handlers = h as unknown as Record<string, (e: never) => void>;
  return {
    ...handlers,
    onPointerEnter: (e: never) => { on(); handlers.onPointerEnter!(e); },
    onClick: (e: never) => { on(); handlers.onClick!(e); },
  };
}
