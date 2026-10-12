// Heat map as a table: the number is in every cell, the shade (one accent hue, light to strong) only helps the eye.
import type { Heatmap } from '../calc';
import { t } from '../i18n/t';

export default function HeatmapTable({
  map, format, caption, rowHead, shortCol,
}: {
  map: Heatmap; format: (n: number) => string; caption: string; rowHead: string; shortCol?: (label: string) => string;
}) {
  let max = 0;
  for (const r of map.values) for (const v of r) if (v > max) max = v;
  if (map.rows.length === 0) return <p className="muted" data-testid="heatmap-empty">{t('Nothing to show for these filters.')}</p>;
  return (
    <div className="heat-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="heat" data-testid="heatmap">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="heat-corner">{rowHead}</th>
            {map.cols.map((c) => <th key={c.key} scope="col" className="heat-col" title={c.label}>{shortCol ? shortCol(c.label) : c.label}</th>)}
            <th scope="col" className="heat-col heat-total">{t('Total')}</th>
          </tr>
        </thead>
        <tbody>
          {map.rows.map((r, ri) => (
            <tr key={r.key}>
              <th scope="row" className="heat-row">{r.label}</th>
              {map.values[ri]!.map((v, ci) => (
                <td key={ci} className={v > 0 ? 'heat-cell' : 'heat-cell heat-zero'} style={v > 0 ? { background: `color-mix(in srgb, var(--tk-accent) ${Math.round(10 + (v / max) * 52)}%, var(--tk-card-bg))` } : undefined}
                  title={`${r.label} / ${map.cols[ci]!.label}: ${format(v)}`}>
                  {v > 0 ? format(v) : '·'}
                </td>
              ))}
              <td className="heat-cell heat-total">{format(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(map.omittedRows > 0 || map.omittedCols > 0) && (
        <p className="chart-foot">
          {t('Showing the largest; {r} more rows and {c} more columns are not shown. Total of every cell: {total}.', { r: map.omittedRows, c: map.omittedCols, total: format(map.total) })}
        </p>
      )}
    </div>
  );
}
