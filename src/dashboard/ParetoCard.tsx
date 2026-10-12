import { useMemo, useState, type ReactNode } from 'react';
import type { ParetoBar, ParetoResult, TopN } from '../calc';
import { ChartCard } from '../charts/ChartKit';
import ParetoChart, { paretoSummary, paretoTable } from '../charts/ParetoChart';
import { t } from '../i18n/t';
import { num } from '../util/format';
import { cutPareto } from './models';
import { Toggle } from './parts';

const TOPS: { value: string; label: string }[] = [
  { value: '5', label: 'Top 5' }, { value: '10', label: 'Top 10' }, { value: '20', label: 'Top 20' }, { value: 'all', label: 'All' },
];

/** One Pareto: Top N toggle, chart, table view, click-through. `all` is the complete Pareto (topN 'all'). */
export default function ParetoCard({
  title, subtitle, all, what, unit, fmt, testid, onOpen, controls, footnote, labelOf,
}: {
  title: string; subtitle?: ReactNode; all: ParetoResult | null; what: string; unit: string; fmt: (n: number) => string; testid: string;
  onOpen: (label: string, eventIds: string[]) => void; controls?: ReactNode; footnote?: ReactNode;
  labelOf?: (bar: ParetoBar) => string;
}) {
  const [top, setTop] = useState<string>('10');
  const topN: TopN = top === 'all' ? 'all' : (Number(top) as TopN);
  const result = useMemo(() => (all ? cutPareto(all, topN) : null), [all, topN]);
  const summary = result ? paretoSummary(result, what, unit, fmt) : t('No data in this range.');
  return (
    <ChartCard
      title={title} subtitle={subtitle} summary={summary} testid={testid}
      legend={[{ label: t('Bar: {u}', { u: unit }), color: 'var(--tk-accent)' }, { label: t('Cumulative %'), color: 'var(--tk-text-primary)', symbol: 'line' }, { label: t('80% line'), color: 'var(--tk-text-primary)', symbol: 'dash' }, { label: t('Others (merged)'), color: 'var(--tk-accent)', symbol: 'hatch' }]}
      controls={<>{controls}<Toggle value={top} options={TOPS.map((o) => ({ value: o.value, label: t(o.label) }))} onChange={setTop} label={t('Number of bars')} testid={`${testid}-top`} /></>}
      table={result ? paretoTable(result, unit, fmt) : undefined}
      footnote={footnote ?? (result ? t('Percentages are against the complete total of {n} {u}. Click a bar to open its events. Others merges the remaining items; if it is larger than the biggest bar it is drawn no taller than that bar, with a break mark and its real value above it. The dashed step ends at the true cumulative share.', { n: fmt(result.total), u: unit }) : undefined)}
    >
      {(w) => result ? (
        <ParetoChart result={result} width={w} valueLabel={unit} format={fmt} ariaLabel={`${title}. ${summary}`}
          onBar={(b) => onOpen(labelOf ? labelOf(b) : b.isOthers ? t('Others ({n} items)', { n: b.entryCount }) : b.label, b.eventIds)}
          openLabel={(b) => t('Open {n} events', { n: num(b.eventIds.length) })} />
      ) : null}
    </ChartCard>
  );
}
