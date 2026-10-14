// Shared chart plumbing: measuring, tooltips that work with mouse and touch, the card with its legend and
// "View as table" toggle. Charts are small SVG components; colours are theme tokens only.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { t } from '../i18n/t';
import './charts.css';

// ---------------------------------------------------------------- measuring

/** Width of an element, kept up to date (ResizeObserver). 0 until measured. */
export function useMeasure<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.floor(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      setW((cur) => (Math.abs(cur - next) >= 1 ? next : cur));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ---------------------------------------------------------------- tooltip

export interface TipState { x: number; y: number; node: ReactNode; pinned: boolean }
export interface TipHandlers {
  onPointerEnter: (e: RPointerEvent) => void;
  onPointerMove: (e: RPointerEvent) => void;
  onPointerLeave: (e: RPointerEvent) => void;
  onClick: (e: React.MouseEvent) => void;
}

/** Hover (mouse) shows a tooltip; a tap or click pins it until the next tap, Escape or a tap elsewhere. */
export function useChartTip(boxRef: React.RefObject<HTMLElement | null>) {
  const [tip, setTip] = useState<TipState | null>(null);
  const pointerType = useRef<string>('mouse');
  const place = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const r = boxRef.current?.getBoundingClientRect();
      return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
    },
    [boxRef],
  );
  useEffect(() => {
    if (!tip?.pinned) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTip(null);
    const onDoc = (e: Event) => {
      const box = boxRef.current;
      if (box && e.target instanceof Node && !box.contains(e.target)) setTip(null);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDoc);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDoc);
    };
  }, [tip?.pinned, boxRef]);

  const bind = useCallback(
    (node: ReactNode, onActivate?: () => void): TipHandlers => ({
      onPointerEnter: (e) => {
        pointerType.current = e.pointerType;
        if (e.pointerType === 'mouse') setTip((cur) => (cur?.pinned ? cur : { ...place(e), node, pinned: false }));
      },
      onPointerMove: (e) => {
        pointerType.current = e.pointerType;
        if (e.pointerType === 'mouse') setTip((cur) => (cur?.pinned ? cur : { ...place(e), node, pinned: false }));
      },
      onPointerLeave: (e) => {
        if (e.pointerType === 'mouse') setTip((cur) => (cur?.pinned ? cur : null));
      },
      onClick: (e) => {
        e.stopPropagation();
        // with a mouse the click does the mark's action (drill-through); a tap shows the tooltip first
        if (onActivate && pointerType.current === 'mouse') {
          setTip(null);
          onActivate();
          return;
        }
        setTip((cur) => (cur?.pinned && cur.node === node ? null : { ...place(e), node, pinned: true }));
      },
    }),
    [place],
  );
  const hide = useCallback(() => setTip(null), []);
  return { tip, bind, hide };
}

export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * How far to move a tooltip so it stays on the screen: inside the left and right edges, under the sticky top bar and
 * above the phone's bottom bar. Too tall for the room: its top edge wins (the start of the text stays readable).
 */
export function clampTipShift(tip: Box, view: Box, margin = 8): { dx: number; dy: number } {
  let dx = 0;
  if (tip.right > view.right - margin) dx = view.right - margin - tip.right;
  if (tip.left + dx < view.left + margin) dx = view.left + margin - tip.left;
  let dy = 0;
  if (tip.bottom > view.bottom - margin) dy = view.bottom - margin - tip.bottom;
  if (tip.top + dy < view.top + margin) dy = view.top + margin - tip.top;
  return { dx: Math.round(dx), dy: Math.round(dy) };
}

/** The part of the window a tooltip may use: below the sticky bars at the top, above the bottom bar. */
function tipRoom(): Box {
  let top = 0;
  let bottom = window.innerHeight;
  for (const el of document.querySelectorAll<HTMLElement>('.update-banner, .shell-topbar, .scope-slot')) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.top <= top + 1 && getComputedStyle(el).position !== 'static') top = Math.max(top, r.bottom);
  }
  const nav = document.querySelector<HTMLElement>('.bottom-nav');
  if (nav) {
    const r = nav.getBoundingClientRect();
    if (r.height > 0 && r.top < bottom) bottom = r.top;
  }
  return { left: 0, top, right: document.documentElement.clientWidth || window.innerWidth, bottom };
}

export function TipLayer({ tip, width }: { tip: TipState | null; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // after it is drawn, nudge it back on screen (never under the bottom bar or past a screen edge)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.translate = '';
    const s = clampTipShift(el.getBoundingClientRect(), tipRoom());
    if (s.dx || s.dy) el.style.translate = `${s.dx}px ${s.dy}px`;
  }, [tip]);
  if (!tip) return null;
  const right = tip.x > width / 2;
  const style: React.CSSProperties = {
    top: Math.max(8, tip.y),
    ...(right ? { right: Math.max(0, width - tip.x + 12) } : { left: Math.max(0, tip.x + 12) }),
    pointerEvents: tip.pinned ? 'auto' : 'none',
  };
  return (
    <div ref={ref} className={tip.pinned ? 'chart-tip chart-tip--pinned' : 'chart-tip'} style={style} role="status" data-testid="chart-tip">
      {tip.node}
    </div>
  );
}

/** Rows of "label  value" for a tooltip. */
export function TipRows({ title, rows }: { title?: ReactNode; rows: { label: ReactNode; value: ReactNode; swatch?: ReactNode }[] }) {
  return (
    <>
      {title && <b className="chart-tip-title">{title}</b>}
      {rows.map((r, i) => (
        <div className="chart-tip-row" key={i}>
          <span>{r.swatch}{r.label}</span>
          <b>{r.value}</b>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- patterns

/** Diagonal hatch fill (for "Others" bars and partial periods). Returns the id to use as fill="url(#id)". */
export function HatchDefs({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--tk-card-bg)" />
        <rect width="2.5" height="6" fill={color} />
      </pattern>
    </defs>
  );
}

export function useUid(): string {
  return useId().replace(/:/g, '');
}

// ---------------------------------------------------------------- legend and card

export interface LegendItem { label: string; color: string; symbol?: 'bar' | 'line' | 'dash' | 'hatch' | 'circle' | 'square' | 'diamond' | 'triangle'; note?: string }

export function Swatch({ color, symbol = 'bar' }: { color: string; symbol?: LegendItem['symbol'] }) {
  const common = { width: 18, height: 12, viewBox: '0 0 18 12', 'aria-hidden': true as const, focusable: false };
  switch (symbol) {
    case 'line': return <svg {...common}><path d="M1 6h16" stroke={color} strokeWidth="2.5" /></svg>;
    case 'dash': return <svg {...common}><path d="M1 6h16" stroke={color} strokeWidth="2" strokeDasharray="4 3" /></svg>;
    case 'hatch': return <svg {...common}><rect x="1" y="1" width="16" height="10" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="3 2" /><path d="M4 11 9 1M9 11l5-10" stroke={color} strokeWidth="1.5" /></svg>;
    case 'circle': return <svg {...common}><circle cx="9" cy="6" r="4.5" fill={color} /></svg>;
    case 'square': return <svg {...common}><rect x="4.5" y="1.5" width="9" height="9" fill={color} /></svg>;
    case 'diamond': return <svg {...common}><path d="M9 0.5 14.5 6 9 11.5 3.5 6z" fill={color} /></svg>;
    case 'triangle': return <svg {...common}><path d="M9 1 14.5 11h-11z" fill={color} /></svg>;
    default: return <svg {...common}><rect x="2" y="1" width="14" height="10" rx="2" fill={color} /></svg>;
  }
}

export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="chart-legend" data-testid="chart-legend">
      {items.map((it) => (
        <li key={it.label}>
          <Swatch color={it.color} symbol={it.symbol} />
          <span>{it.label}</span>
          {it.note && <span className="chart-legend-note">{it.note}</span>}
        </li>
      ))}
    </ul>
  );
}

export interface ChartTable { head: string[]; rows: (string | number)[][] }

export function DataTable({ table, caption }: { table: ChartTable; caption: string }) {
  return (
    <div className="table-wrap chart-table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="data-table chart-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{table.head.map((h, i) => <th key={i} scope="col" className={i > 0 ? 'num' : undefined}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => (ci === 0 ? <th key={ci} scope="row">{c}</th> : <td key={ci} className="num">{c}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Card around a chart: title, optional subtitle and controls, legend, a text summary (also the SVG's accessible
 * name) and a "View as table" toggle. The chart is a render prop that receives the measured width.
 */
export function ChartCard({
  title, subtitle, summary, legend, table, controls, children, footnote, testid, minHeight,
}: {
  title: string;
  subtitle?: ReactNode;
  summary: string;
  legend?: LegendItem[];
  table?: ChartTable;
  controls?: ReactNode;
  footnote?: ReactNode;
  testid?: string;
  minHeight?: number;
  children: (width: number, ctx: { boxRef: React.RefObject<HTMLDivElement | null>; summary: string; title: string }) => ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const [boxRef, width] = useMeasure<HTMLDivElement>();
  const titleId = useUid();
  return (
    <section className="card chart-card" aria-labelledby={`t-${titleId}`} data-testid={testid}>
      <header className="chart-head">
        <div className="chart-head-text">
          <h2 id={`t-${titleId}`}>{title}</h2>
          {subtitle && <p className="chart-sub">{subtitle}</p>}
        </div>
        <div className="chart-head-controls">
          {controls}
          {table && (
            <button type="button" className="btn btn-sm" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} data-testid="view-table">
              {asTable ? t('View as chart') : t('View as table')}
            </button>
          )}
        </div>
      </header>
      <p className="chart-summary" data-testid="chart-summary">{summary}</p>
      {!asTable && legend && <Legend items={legend} />}
      <div className="chart-box" ref={boxRef} style={minHeight ? { minHeight } : undefined}>
        {asTable && table ? <DataTable table={table} caption={title} /> : width > 0 ? children(width, { boxRef, summary, title }) : null}
      </div>
      {footnote && <p className="chart-foot">{footnote}</p>}
    </section>
  );
}
