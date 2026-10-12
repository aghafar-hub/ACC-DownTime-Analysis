// Heat map as a table: the number is in every cell, the shade (one accent hue, light to strong) only helps the eye.
import { useState } from 'react';
import type { Heatmap } from '../calc';
import { t } from '../i18n/t';

export default function HeatmapTable({
  map: limited, full, format, caption, rowHead, shortCol, colTotals,
}: {
  map: Heatmap; /** the same map with every row; enables the Show all rows button */ full?: Heatmap; format: (n: number) => string; caption: string; rowHead: string; shortCol?: (label: string) => string; /** add a bottom row with the total of every column */ colTotals?: boolean;
}) {
  const [all, setAll] = useState(false);
  const canExpand = !!full && full.rows.length > limited.rows.length;
  const map = all && canExpand ? full! : limited;
  let max = 0;
  for (const r of map.values) for (const v of r) if (v > max) max = v;
  if (map.rows.length === 0) return <p className="muted" data-testid="heatmap-empty">{t('Nothing to show for these filters.')}</p>;
  return (
    <div>
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
        {colTotals && (
          <tfoot>
            <tr>
              <th scope="row" className="heat-row heat-total">{t('Total')}</th>
              {map.cols.map((c) => <td key={c.key} className="heat-cell heat-total" data-testid="heat-col-total">{format(c.total)}</td>)}
              <td className="heat-cell heat-total" data-testid="heat-grand-total">{format(map.total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
      {(map.omittedRows > 0 || map.omittedCols > 0) && (
        <p className="chart-foot">
          {t('Showing the largest; {r} more rows and {c} more columns are not shown. Total of every cell: {total}.', { r: map.omittedRows, c: map.omittedCols, total: format(map.total) })}
        </p>
      )}
      {canExpand && (
        <button type="button" className="btn btn-sm heat-toggle" style={{ minHeight: 44, minWidth: 44, marginTop: 8 }} aria-expanded={all} onClick={() => setAll((v) => !v)} data-testid="heat-toggle">
          {all ? t('Show fewer') : t('Show all rows ({n})', { n: full!.rows.length })}
        </button>
      )}
    </div>
  );
}