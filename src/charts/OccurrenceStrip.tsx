// Tiny timeline: one dot per occurrence on a time axis from the start to the end of the range. Decoration plus a
// text equivalent: the accessible name gives the count and the first and last dates.
import { t } from '../i18n/t';
import { MS_DAY, parseDate } from '../calc/time';

export const STRIP_W = 120;
const H = 22;
const PAD = 5;

export default function OccurrenceStrip({ dates, from, to, label }: { dates: string[]; from: string; to: string; label: string }) {
  const a = parseDate(from) ?? 0;
  const b = Math.max(parseDate(to) ?? a, a + MS_DAY);
  const x = (d: string): number => PAD + (Math.min(1, Math.max(0, ((parseDate(d) ?? a) - a) / (b - a))) * (STRIP_W - 2 * PAD));
  const first = dates[0];
  const last = dates[dates.length - 1];
  const name = dates.length === 0
    ? t('{l}: no occurrences', { l: label })
    : t('{l}: {n} occurrences, first {a}, last {b}', { l: label, n: dates.length, a: first!, b: last! });
  return (
    <svg className="occ-strip" width={STRIP_W} height={H} viewBox={`0 0 ${STRIP_W} ${H}`} role="img" aria-label={name} data-testid="occ-strip" data-count={dates.length}>
      <title>{name}</title>
      <line x1={PAD} x2={STRIP_W - PAD} y1={H / 2} y2={H / 2} stroke="var(--tk-border)" strokeWidth="1.5" />
      <line x1={PAD} x2={PAD} y1={H / 2 - 4} y2={H / 2 + 4} stroke="var(--tk-text-muted)" strokeWidth="1" />
      <line x1={STRIP_W - PAD} x2={STRIP_W - PAD} y1={H / 2 - 4} y2={H / 2 + 4} stroke="var(--tk-text-muted)" strokeWidth="1" />
      {dates.map((d, i) => <circle key={i} cx={x(d)} cy={H / 2} r="3.2" fill="var(--tk-danger)" fillOpacity="0.8" stroke="var(--tk-card-bg)" strokeWidth="0.75" />)}
    </svg>
  );
}
