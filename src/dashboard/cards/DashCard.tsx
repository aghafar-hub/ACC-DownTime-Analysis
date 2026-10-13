// The Dashboard card: a question as the title, a short subtitle, the legend (colour + pattern + words), the chart,
// and a footer with the scope it shows (period · lines · areas · type) and 'Open records', which opens exactly the
// events behind the card. The text summary is the accessible description of the chart.
import { useId, type ReactNode } from 'react';
import { PaintSwatch } from '../../charts/paint';
import type { Paint } from '../../charts/palette';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { num } from '../../util/format';

export interface OpenSpec {
  /** chain ids (events) the link opens */
  ids: string[];
  /** where they come from, for the chip on Event records */
  label: string;
}

export type OpenFn = (spec: OpenSpec) => void;

export type LegendMark =
  | { kind: 'paint'; paint: Pick<Paint, 'color' | 'pattern'>; label: string }
  | { kind: 'partial'; label: string }
  | { kind: 'notUploaded'; label: string }
  | { kind: 'line'; color: string; label: string; marker?: boolean }
  | { kind: 'dash'; label: string }
  | { kind: 'dot'; color: string; label: string; hollow?: boolean }
  | { kind: 'box'; className: string; label: string };

export function CardLegend({ items, testid = 'chart-legend' }: { items: LegendMark[]; testid?: string }) {
  if (!items.length) return null;
  return (
    <ul className="dcard-legend" data-testid={testid}>
      {items.map((it) => (
        <li key={it.label}>
          {it.kind === 'paint' && <PaintSwatch paint={it.paint} />}
          {it.kind === 'partial' && <span className="lg-partial" aria-hidden="true" />}
          {it.kind === 'notUploaded' && <span className="lg-nu" aria-hidden="true" />}
          {it.kind === 'line' && (
            <svg width="22" height="12" aria-hidden="true"><path d="M1 6h20" stroke={it.color} strokeWidth="2.5" />{it.marker && <circle cx="11" cy="6" r="3.5" fill="var(--tk-card-bg)" stroke={it.color} strokeWidth="2" />}</svg>
          )}
          {it.kind === 'dash' && <svg width="12" height="14" aria-hidden="true"><path d="M6 1v12" stroke="var(--tk-text-primary)" strokeWidth="2" strokeDasharray="3 2" /></svg>}
          {it.kind === 'dot' && <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill={it.hollow ? 'var(--tk-card-bg)' : it.color} stroke={it.color} strokeWidth="2" /></svg>}
          {it.kind === 'box' && <span className={`lg-box ${it.className}`} aria-hidden="true" />}
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Two to four choices as one segmented control (44 px tall on a phone). */
export function Seg<T extends string>({ value, options, onChange, label, testid, wide }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; testid?: string;
  /** fill the row on a phone */
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'seg seg--wide' : 'seg'} role="group" aria-label={label} data-testid={testid}>
      {options.map((o) => (
        <button key={o.value} type="button" className="seg-btn" aria-pressed={o.value === value} onClick={() => onChange(o.value)} data-testid={testid ? `${testid}-${o.value}` : undefined}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 'Open records ›' (or a custom label) that opens the events; disabled when there are none. */
export function OpenLink({ spec, onOpen, label, testid = 'card-open', className = 'dcard-open' }: { spec: OpenSpec; onOpen: OpenFn; label?: string; testid?: string; className?: string }) {
  const n = spec.ids.length;
  return (
    <button
      type="button" className={className} onClick={() => onOpen(spec)} disabled={n === 0} data-testid={testid} data-count={n}
      aria-label={t('Open {n} records: {what}', { n: num(n), what: spec.label })}
    >
      {label ?? t('Open records')} <span aria-hidden="true">›</span>
    </button>
  );
}

export default function DashCard({
  id, title, subtitle, controls, headLink, legend, summary, scope, open, onOpen, span = 'half', children, testid, footExtra, className,
}: {
  /** the card's place in the order ('trend', 'class' ...) */
  id: string;
  title: string;
  subtitle?: ReactNode;
  controls?: ReactNode;
  /** a link in the corner ('All 5 ›') */
  headLink?: ReactNode;
  legend?: LegendMark[];
  /** what the chart shows in words (screen readers; also its accessible description) */
  summary: string;
  scope: string;
  open?: OpenSpec | null;
  onOpen: OpenFn;
  span?: 'full' | 'wide' | 'narrow' | 'half';
  children: ReactNode;
  testid?: string;
  footExtra?: ReactNode;
  className?: string;
}) {
  const hid = useId();
  return (
    <section className={`card dcard dcard--${span}${className ? ` ${className}` : ''}`} aria-labelledby={`${hid}-t`} aria-describedby={`${hid}-s`} data-testid={testid} data-dash-card={id}>
      <header className={`dcard-head${controls ? ' dcard-head--ctl' : ''}`}>
        <h2 id={`${hid}-t`} className="dcard-title">{title}</h2>
        {headLink && <div className="dcard-headlink">{headLink}</div>}
        {subtitle && <p className="dcard-sub">{subtitle}</p>}
        {controls && <div className="dcard-controls">{controls}</div>}
      </header>
      {legend && <CardLegend items={legend} />}
      <p className="sr-only" id={`${hid}-s`} data-testid="chart-summary">{summary}</p>
      <div className="dcard-body">{children}</div>
      <footer className="dcard-foot">
        <span className="dcard-scope" data-testid="card-scope"><Icon name="calendar" size={14} /> <span>{scope}</span></span>
        {footExtra}
        {open && <OpenLink spec={open} onOpen={onOpen} />}
      </footer>
    </section>
  );
}
