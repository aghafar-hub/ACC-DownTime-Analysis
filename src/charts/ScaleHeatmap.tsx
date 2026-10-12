// Heat map on a FIXED colour scale (for example availability 90 to 100 %). The value is printed in every cell; the
// shade only helps the eye. Months without data are dashed gaps with a dash instead of a number, never a zero.
import { t } from '../i18n/t';

export interface ScaleCell { text: string; /** null: no value (a gap) */ value: number | null; title: string }
export interface ScaleRow { key: string; label: string; cells: ScaleCell[]; /** a figure for the whole range, shown in the last column */ summary?: ScaleCell }

/** Low values are the strong shade: 0 at `max` and above, 1 at `min` and below. */
export function lowIsStrong(value: number, min: number, max: number): number {
  return Math.min(1, Math.max(0, (max - value) / (max - min)));
}

export default function ScaleHeatmap({
  cols, rows, min, max, caption, rowHead, summaryHead, legendFormat, below,
}: {
  cols: { key: string; label: string; title?: string }[]; rows: ScaleRow[]; min: number; max: number; caption: string; rowHead: string; summaryHead?: string;
  legendFormat: (n: number) => string;
  /** words for values under `min` (they take the strongest shade) */
  below: string;
}) {
  const shade = (v: number): string => `color-mix(in srgb, var(--tk-danger) ${Math.round(8 + lowIsStrong(v, min, max) * 50)}%, var(--tk-card-bg))`;
  const cell = (c: ScaleCell, key: string | number, extra?: string) => (
    c.value === null
      ? <td key={key} className={`heat-cell heat-gap${extra ? ` ${extra}` : ''}`} title={c.title} data-testid="scale-gap">{c.text}</td>
      : <td key={key} className={`heat-cell${extra ? ` ${extra}` : ''}`} style={{ background: shade(c.value) }} title={c.title} data-testid="scale-cell">{c.value < min ? <span aria-hidden="true">▾ </span> : null}{c.text}</td>
  );
  return (
    <div>
      <ul className="scale-legend" data-testid="scale-legend" aria-label={t('Colour scale')}>
        <li className="scale-legend-end">{legendFormat(min)}</li>
        <li className="scale-legend-bar" aria-hidden="true" style={{ background: `linear-gradient(to right, ${shade(min)}, ${shade((min + max) / 2)}, ${shade(max)})` }} />
        <li className="scale-legend-end">{legendFormat(max)}</li>
        <li className="scale-legend-note"><span aria-hidden="true">▾ </span>{below}</li>
        <li className="scale-legend-note"><span className="scale-legend-gap" aria-hidden="true" />{t('Dashed = no data')}</li>
      </ul>
      <div className="heat-wrap" tabIndex={0} role="region" aria-label={caption}>
        <table className="heat" data-testid="scale-heatmap">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="heat-corner">{rowHead}</th>
              {cols.map((c) => <th key={c.key} scope="col" className="heat-col" title={c.title ?? c.label}>{c.label}</th>)}
              {summaryHead && <th scope="col" className="heat-col heat-total">{summaryHead}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-area={r.key}>
                <th scope="row" className="heat-row">{r.label}</th>
                {r.cells.map((c, i) => cell(c, i))}
                {r.summary && cell(r.summary, 'sum', 'heat-total')}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
