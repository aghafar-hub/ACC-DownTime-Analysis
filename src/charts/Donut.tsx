// A donut of shares (colour + pattern per slice) with the total in the centre. Decoration plus text: the card
// next to it has the table with every value, so the slices carry no information of their own.
import { PaintDefs, paintId } from './paint';
import type { Paint } from './palette';
import { useUid } from './ChartKit';

export default function Donut({ slices, size = 180, centre, centreSub, ariaLabel }: {
  slices: { paint: Paint; value: number }[];
  size?: number;
  centre: string;
  centreSub: string;
  ariaLabel: string;
}) {
  const uid = useUid();
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = size / 2 - 2;
  const r0 = r * 0.62;
  const c = size / 2;
  let a0 = -Math.PI / 2;
  const arcs = total > 0 ? slices.filter((s) => s.value > 0).map((s) => {
    const a1 = a0 + (s.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${(c + rad * Math.cos(a)).toFixed(2)} ${(c + rad * Math.sin(a)).toFixed(2)}`;
    // a full circle cannot be one arc: draw it in two halves
    const d = s.value >= total
      ? `M${p(r, a0)}A${r} ${r} 0 1 1 ${p(r, a0 + Math.PI)}A${r} ${r} 0 1 1 ${p(r, a0)}M${p(r0, a0)}A${r0} ${r0} 0 1 0 ${p(r0, a0 + Math.PI)}A${r0} ${r0} 0 1 0 ${p(r0, a0)}Z`
      : `M${p(r, a0)}A${r} ${r} 0 ${large} 1 ${p(r, a1)}L${p(r0, a1)}A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
    a0 = a1;
    return { key: s.paint.key, d };
  }) : [];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel} className="donut" data-testid="donut">
      <title>{ariaLabel}</title>
      <PaintDefs uid={uid} paints={slices.map((s) => s.paint)} />
      {total <= 0 && <circle cx={c} cy={c} r={(r + r0) / 2} fill="none" stroke="var(--tk-border)" strokeWidth={r - r0} />}
      {arcs.map((a) => <path key={a.key} d={a.d} fill={`url(#${paintId(uid, a.key)})`} stroke="var(--tk-card-bg)" strokeWidth={1.5} fillRule="evenodd" />)}
      <text x={c} y={c + 2} textAnchor="middle" className="donut-total">{centre}</text>
      <text x={c} y={c + 20} textAnchor="middle" className="donut-sub">{centreSub}</text>
    </svg>
  );
}
