// A tiny trend line for a KPI card. Decoration plus a text equivalent: the accessible name gives the first and
// last value, so nothing depends on seeing the line. Gaps (null) are skipped, not drawn as zero.
import { t } from '../i18n/t';

export default function Sparkline({ values, label, format, unitLabel, color = 'var(--tk-accent)' }: {
  values: (number | null)[];
  /** what the line shows, for the accessible name */
  label: string;
  format: (n: number) => string;
  /** "daily" / "monthly" */
  unitLabel: string;
  color?: string;
}) {
  const pts = values.map((v, i) => (v === null || !Number.isFinite(v) ? null : { v, i })).filter((p): p is { v: number; i: number } => p !== null);
  const W = 120;
  const H = 30;
  const pad = 3;
  if (pts.length < 2) {
    return <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('{l}: not enough data for a {u} trend', { l: label, u: unitLabel })} data-testid="spark"><line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke="var(--tk-border)" strokeWidth="1.5" strokeDasharray="3 3" /></svg>;
  }
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const n = values.length;
  const x = (i: number): number => pad + (n <= 1 ? 0 : (i / (n - 1)) * (W - 2 * pad));
  const y = (v: number): number => (hi === lo ? H / 2 : H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad));
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const name = t('{l}, {u} trend: from {a} to {b}, lowest {lo}, highest {hi}', { l: label, u: unitLabel, a: format(first.v), b: format(last.v), lo: format(lo), hi: format(hi) });
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={name} data-testid="spark">
      <title>{name}</title>
      <path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(last.i)} cy={y(last.v)} r="2.6" fill={color} stroke="var(--tk-card-bg)" strokeWidth="1" />
    </svg>
  );
}
