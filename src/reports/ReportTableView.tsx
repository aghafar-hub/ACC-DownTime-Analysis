// A report table: a plain, print-safe table that can show any slice of its rows (the paginator splits long tables
// between pages) with fixed column widths so every page of the table lines up.
import type { ReactNode } from 'react';
import { t } from '../i18n/t';
import { cellText, type Cell, type ReportTable } from './model';

const NUMERIC = new Set(['hours', 'hours2', 'count', 'pct']);

export type CellRenderer = (rowIndex: number, colIndex: number, value: Cell) => ReactNode | undefined;

export default function ReportTableView({
  table, rows, widths, caption, continued, cell, className, testid,
}: {
  table: ReportTable;
  /** [from, to) of the body rows (the total row, when there is one, is the row after the last data row); default all */
  rows?: [number, number];
  /** column widths in px; without them the browser sizes the columns */
  widths?: number[];
  caption?: ReactNode;
  continued?: boolean;
  /** replace the content of some cells */
  cell?: CellRenderer;
  className?: string;
  testid?: string;
}) {
  const body = table.rows;
  const all: Cell[][] = table.total ? [...body, table.total] : body;
  const [from, to] = rows ?? [0, all.length];
  const columns = table.columns;
  return (
    <div className="rpt-tableblock" data-testid={testid}>
      {caption && !continued && <p className="rpt-tcap">{caption}</p>}
      {caption && continued && <p className="rpt-tcap rpt-tcap--cont">{caption} <span>({t('continued')})</span></p>}
      <table className={className ? `rpt-table ${className}` : 'rpt-table'} style={widths ? { tableLayout: 'fixed', width: widths.reduce((a, b) => a + b, 0) } : undefined}>
        {widths && <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>}
        <thead>
          <tr>{columns.map((c, i) => <th key={i} scope="col" className={NUMERIC.has(c.kind) ? 'num' : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {all.slice(from, to).map((r, k) => {
            const ri = from + k;
            const isTotal = !!table.total && ri === body.length;
            return (
              <tr key={ri} data-r={ri} className={isTotal ? 'rpt-total' : undefined}>
                {r.map((v, ci) => {
                  const col = columns[ci]!;
                  const custom = cell?.(ri, ci, v);
                  return <td key={ci} className={NUMERIC.has(col.kind) ? 'num' : undefined}>{custom !== undefined ? custom : cellText(col.kind, v)}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
