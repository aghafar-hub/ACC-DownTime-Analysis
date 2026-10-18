// Reliability by area: ranked MTBF and MTTR bars, the MTBF-against-MTTR quadrant, availability by area and month,
// and the failure rate per 1,000 operating hours. Shown in the Areas block under the "By area" table.
// Every figure comes from the same per-area KPIs as that table; nothing is averaged across areas.
import { useMemo } from 'react';
import type { AreaRank, Metric, Quadrant } from '../calc';
import { ChartCard } from '../charts/ChartKit';
import HBars, { type HRow } from '../charts/HBars';
import QuadrantChart from '../charts/QuadrantChart';
import RfMtbfChart from '../charts/RfMtbfChart';
import ScaleHeatmap, { type ScaleRow } from '../charts/ScaleHeatmap';
import { t } from '../i18n/t';
import AlsoOnDashboard from './AlsoOnDashboard';
import { fh, fh2, fint, fpct, monthAxisLabels, monthLabel, NOT_UPLOADED_FOOT, partialNote } from './format';
import { areaReliabilityModel } from './models';
import { targetNumber, type TargetStatus } from './targets';
import { stateWords } from './targets';
import type { DashCtx } from './scope';
import { useAreaOwnTargets } from './useAreaTargetMap';

const BAR = 'var(--tk-accent)';
const AVAIL_MIN = 90;
const AVAIL_MAX = 100;

const quadrantWords = (q: Quadrant): string => {
  switch (q) {
    case 'worst': return t('Low MTBF, high MTTR (worst)');
    case 'frequent_quick': return t('Low MTBF, low MTTR');
    case 'rare_long': return t('High MTBF, high MTTR');
    case 'best': return t('High MTBF, low MTTR (best)');
    case 'on_median': return t('On a median line');
  }
};

export default function AreaReliabilityCharts({ ctx, onOpen }: { ctx: DashCtx; onOpen?: (label: string, eventIds: string[]) => void }) {
  const ownTargets = useAreaOwnTargets(ctx);
  const m = useMemo(() => areaReliabilityModel(ctx, ownTargets), [ctx, ownTargets]);
  if (!m) return null;
  const basis = m.basis;
  const none = (r: AreaRank): string | undefined => (r.value !== null ? undefined : r.code === 'no_failures' ? t('no failures') : t('unavailable'));
  const open = (r: { key: string; label: string }) => onOpen?.(`${t('the bar of area')} ${r.label}`, m.failureIds.get(r.key) ?? []);
  const rowsOf = (ranks: AreaRank[], label: string): HRow[] => ranks.map((r) => ({
    key: r.area_id, label: r.area_id, unavailable: none(r), note: r.reason ?? undefined,
    segments: r.value === null ? [] : [{ key: 'v', label, color: BAR, value: r.value }],
  }));
  const tableOf = (ranks: AreaRank[], f: (n: number) => string) => ranks.map((r) => [r.area_id, r.value === null ? none(r)! : f(r.value)]);
  const ranked = (ranks: AreaRank[]) => ranks.filter((r) => r.value !== null);
  const noFail = (ranks: AreaRank[]) => ranks.length - ranked(ranks).length;

  // targets: a dashed line in the chart, a count in the summary, a Status column in the table
  const tg = m.targets;
  const stOf = (id: string, k: 'mtbf' | 'mttr'): TargetStatus | null => m.status.get(id)?.[k] ?? null;
  const targetSummary = (ranks: AreaRank[], k: 'mtbf' | 'mttr'): string => {
    const target = k === 'mtbf' ? tg.mtbfH : tg.mttrH;
    if (target === null) return '';
    const judged = ranks.map((r) => stOf(r.area_id, k)).filter((s): s is TargetStatus => !!s);
    const off = judged.filter((s) => !s.ok).length;
    return ` ${k === 'mtbf' ? t('{n} of {m} areas below the target of {x} h.', { n: off, m: judged.length, x: targetNumber(target) }) : t('{n} of {m} areas above the target of {x} h.', { n: off, m: judged.length, x: targetNumber(target) })}`;
  };
  const statusCol = (ranks: AreaRank[], k: 'mtbf' | 'mttr', target: number | null) => (target === null ? undefined : ranks.map((r) => { const s = stOf(r.area_id, k); return s ? stateWords(s) : '-'; }));
  const withStatus = (head: string[], rows: (string | number)[][], col: string[] | undefined, label: string) => (col ? { head: [...head, label], rows: rows.map((r, i) => [...r, col[i]!]) } : { head, rows });

  // (d) MTBF and MTTR
  const mtbfRows = rowsOf(m.mtbf, t('MTBF'));
  const mttrRows = rowsOf(m.mttr, t('MTTR'));
  const barSummary = (ranks: AreaRank[], what: string): string => {
    const r = ranked(ranks);
    return r.length
      ? `${t('{a} has the {w}: {v} h.', { a: r[0]!.area_id, w: what, v: fh2(r[0]!.value!) })} ${t('{n} of {m} areas have failures.', { n: r.length, m: ranks.length })}${noFail(ranks) ? ` ${t('{k} areas with no failures are listed last.', { k: noFail(ranks) })}` : ''}`
      : t('No area has failures in this range, so there is nothing to rank.');
  };

  // (e) quadrant
  const q = m.quadrant;
  const worstLabel = t('Worst: low MTBF, high MTTR');
  const quadSummary = q.points.length === 0
    ? t('No area has both an MTBF and an MTTR in this range.')
    : `${t('{n} areas plotted.', { n: q.points.length })} ${q.medianMtbf !== null && q.medianMttr !== null
      ? t('Median MTBF {a} h, median MTTR {b} h.', { a: fh(q.medianMtbf), b: fh2(q.medianMttr) })
      : t('At least two areas are needed for the median lines.')} ${q.medianMtbf !== null ? (q.worst.length ? t('Worst quadrant (low MTBF, high MTTR): {a}.', { a: q.worst.join(', ') }) : t('No area is in the worst quadrant (low MTBF, high MTTR).')) : ''}`;

  // (e2) reliability factor against MTBF
  const rf = m.rfMtbf;
  const rfTarget = tg.reliabilityPct ?? null;
  const rfEx = rf.points[0] ?? null;
  const rfSub = rfTarget !== null
    ? t('One point per area. Below the dashed target line = not reliable enough; left of the median = fails more often than most areas.')
    : t('One point per area. Left of the median = fails more often than most areas.');
  const rfSummary = rf.points.length === 0
    ? t('No area has both a reliability factor and an MTBF in this range.')
    : `${t('{n} areas plotted.', { n: rf.points.length })}${rfTarget !== null ? ` ${rf.below.length ? t('Below the RF target of {x}%: {a}.', { x: targetNumber(rfTarget), a: rf.below.join(', ') }) : t('Every area plotted meets the RF target of {x}%.', { x: targetNumber(rfTarget) })}` : ''}`;

  // (f) availability by area and month
  const av = m.monthAvailability;
  const fmtAv = (x: Metric) => (x.available ? fpct(x.value) : x.code === 'not_uploaded' ? t('Not uploaded') : '-');
  const partialAny = av.months.some((x) => x.partial);
  const axis = monthAxisLabels(av.months.map((x) => x.month));
  const colLabel = (i: number): string => `${axis[i]}${av.months[i]!.partial ? '*' : ''}`;
  const colFull = (i: number): string => `${monthLabel(av.months[i]!.month)}${av.months[i]!.partial ? '*' : ''}`;
  const avRows: ScaleRow[] = av.areas.map((a) => ({
    key: a.area_id, label: a.area_id,
    cells: a.values.map((v, i) => (v.available
      ? { text: fpct(v.value), value: v.value * 100, title: `${a.area_id}, ${monthLabel(av.months[i]!.month)}: ${fpct(v.value)}${av.months[i]!.partial ? ` (${t('partial month')})` : ''}` }
      : av.months[i]!.notUploaded
        ? { text: t('n/u'), value: null, title: `${a.area_id}, ${monthLabel(av.months[i]!.month)}: ${t('Not uploaded: no records for this month')}` }
        : { text: '–', value: null, title: `${a.area_id}, ${monthLabel(av.months[i]!.month)}: ${t('no data')}` })),
    summary: (() => {
      const o = m.overallAvailability.get(a.area_id);
      return o && o.available ? { text: fpct(o.value), value: o.value * 100, title: `${a.area_id}: ${fpct(o.value)}` } : { text: '–', value: null, title: `${a.area_id}: ${t('unavailable')}` };
    })(),
  }));
  let lowest: { area: string; month: string; v: number } | null = null;
  let below = 0;
  let gaps = 0;
  for (const a of av.areas) {
    a.values.forEach((v, i) => {
      if (!v.available) { if (!av.months[i]!.notUploaded) gaps++; return; }
      if (v.value * 100 < AVAIL_MIN) below++;
      if (!lowest || v.value < lowest.v) lowest = { area: a.area_id, month: av.months[i]!.month, v: v.value };
    });
  }
  const lo = lowest as { area: string; month: string; v: number } | null;
  const avSummary = lo
    ? `${t('Lowest: {a} in {m}, {v}.', { a: lo.area, m: monthLabel(lo.month), v: fpct(lo.v) })} ${t('{n} area-months are below {x}%.', { n: below, x: AVAIL_MIN })}${gaps ? ` ${t('{n} area-months have no data (gaps).', { n: gaps })}` : ''}${av.months.some((x) => x.notUploaded) ? ` ${t('Not uploaded')}: ${av.months.filter((x) => x.notUploaded).map((x) => monthLabel(x.month)).join(', ')}.` : ''}`
    : t('No availability can be calculated for these areas.');

  // (g) failure rate
  const rateRows = rowsOf(m.rate.rows, t('Failures per 1,000 h'));
  const overall = m.rate.overall.available ? m.rate.overall.value : null;
  const rateMax = Math.max(0, ...ranked(m.rate.rows).map((r) => r.value!), overall ?? 0);
  const topRate = ranked(m.rate.rows)[0];
  const rateSummary = topRate
    ? `${t('{a} has the highest rate: {v} failures per 1,000 operating hours.', { a: topRate.area_id, v: fh2(topRate.value!) })}${overall !== null ? ` ${t('All areas together: {v}.', { v: fh2(overall) })}` : ''}`
    : t('No failure rate can be calculated for these areas.');

  return (
    <>
      <div className="chart-grid chart-grid--even" data-testid="area-rank-grid">
        <ChartCard
          title={t('MTBF by area')} subtitle={t('Operating hours per failure. Lowest first: the area that fails most often relative to its running time is on top.')} testid="chart-area-mtbf" help={{ id: 'area-mtbf', vars: ranked(m.mtbf)[0] ? { a: ranked(m.mtbf)[0]!.area_id, v: fh(ranked(m.mtbf)[0]!.value!) } : {} }}
          summary={`${barSummary(m.mtbf, t('lowest MTBF'))}${targetSummary(m.mtbf, 'mtbf')}`} legend={[{ label: t('MTBF (h)'), color: BAR }, ...(tg.mtbfH !== null ? [{ label: t('Target {x} h', { x: targetNumber(tg.mtbfH) }), color: 'var(--tk-text-primary)', symbol: 'dash' as const }] : [])]}
          table={withStatus([t('Area'), t('MTBF h')], tableOf(m.mtbf, fh), statusCol(m.mtbf, 'mtbf', tg.mtbfH), t('Status'))}
        >
          {(w) => <HBars rows={mtbfRows} width={w} format={(n) => `${fh(n)} h`} refLine={tg.mtbfH !== null ? { value: tg.mtbfH, label: t('Target {x} h', { x: targetNumber(tg.mtbfH) }) } : undefined} ariaLabel={t('Bars of MTBF by area, lowest first. {s}', { s: barSummary(m.mtbf, t('lowest MTBF')) })} openLabel={t('Open events')} onRow={open} />}
        </ChartCard>
        <ChartCard
          title={t('MTTR by area')} subtitle={t('Mean restoration time of failure events. Highest first: the slowest area to recover is on top.')} testid="chart-area-mttr" help={{ id: 'area-mttr', vars: ranked(m.mttr)[0] ? { a: ranked(m.mttr)[0]!.area_id, v: fh2(ranked(m.mttr)[0]!.value!) } : {} }}
          summary={`${barSummary(m.mttr, t('highest MTTR'))}${targetSummary(m.mttr, 'mttr')}`} legend={[{ label: t('MTTR (h)'), color: BAR }, ...(tg.mttrH !== null ? [{ label: t('Target {x} h', { x: targetNumber(tg.mttrH) }), color: 'var(--tk-text-primary)', symbol: 'dash' as const }] : [])]}
          table={withStatus([t('Area'), t('MTTR h')], tableOf(m.mttr, fh2), statusCol(m.mttr, 'mttr', tg.mttrH), t('Status'))}
        >
          {(w) => <HBars rows={mttrRows} width={w} format={(n) => `${fh2(n)} h`} refLine={tg.mttrH !== null ? { value: tg.mttrH, label: t('Target {x} h', { x: targetNumber(tg.mttrH) }) } : undefined} ariaLabel={t('Bars of MTTR by area, highest first. {s}', { s: barSummary(m.mttr, t('highest MTTR')) })} openLabel={t('Open events')} onRow={open} />}
        </ChartCard>
      </div>

      <ChartCard
        title={t('Failures per 1,000 operating hours by area')} subtitle={t('Failure rate adjusted for running time, highest first. The dashed line is all areas together (total failures over total operating hours, not an average of the bars).')} testid="chart-area-rate" help={{ id: 'area-rate', vars: topRate ? { a: topRate.area_id, v: fh2(topRate.value!) } : {} }}
        summary={rateSummary}
        legend={[{ label: t('Area'), color: BAR }, ...(overall !== null ? [{ label: t('All areas together'), color: 'var(--tk-text-primary)', symbol: 'dash' as const }] : [])]}
        table={{ head: [t('Area'), t('Failures per 1,000 h')], rows: [...tableOf(m.rate.rows, fh2), ...(overall !== null ? [[t('All areas together'), fh2(overall)]] : [])] }}
      >
        {(w) => (
          rateMax > 0 ? (
            <HBars
              rows={rateRows} width={w} format={(n) => fh2(n)} xMax={rateMax * 1.1} ariaLabel={t('Bars of failures per 1,000 operating hours by area. {s}', { s: rateSummary })}
              refLine={overall !== null ? { value: overall, label: `${t('All areas')} ${fh2(overall)}` } : undefined} openLabel={t('Open events')} onRow={open}
            />
          ) : <p className="muted">{t('No failure rate can be calculated for these areas.')}</p>
        )}
      </ChartCard>
      <ChartCard
          title={t('MTBF against MTTR by area')} subtitle={t('One point per area. The dashed lines are the medians of the areas shown and split the plot into four quadrants.')} testid="chart-area-quadrant" help={{ id: 'area-quadrant' }}
          summary={quadSummary}
          legend={[{ label: t('Area'), color: BAR, symbol: 'circle' }, { label: t('Worst quadrant (low MTBF, high MTTR)'), color: 'var(--tk-danger)', symbol: 'diamond' }, { label: t('Median'), color: 'var(--tk-text-primary)', symbol: 'dash' }]}
          table={{ head: [t('Area'), t('MTBF h'), t('MTTR h'), t('Quadrant')], rows: q.points.map((p) => [p.area_id, fh(p.mtbf), fh2(p.mttr), quadrantWords(p.quadrant)]) }}
          footnote={`${t('The axes start near the smallest value, not at zero.')}${q.excluded.length ? ` ${t('Not plotted (no failures, so MTBF and MTTR are not defined): {a}.', { a: q.excluded.map((x) => x.area_id).join(', ') })}` : ''}`}
        >
          {(w) => (
            <QuadrantChart
              width={w} height={w < 480 ? 340 : 380} xTitle={t('MTBF (hours)')} yTitle={t('MTTR (hours)')}
              medianX={q.medianMtbf} medianY={q.medianMttr}
              medianXLabel={q.medianMtbf !== null ? t('median {v} h', { v: fh(q.medianMtbf) }) : undefined} medianYLabel={q.medianMttr !== null ? t('median {v} h', { v: fh2(q.medianMttr) }) : undefined}
              worstLabel={worstLabel} ariaLabel={`${t('Scatter chart of MTBF against MTTR per area with median lines.')} ${quadSummary}`}
              points={q.points.map((p) => ({
                key: p.area_id, label: p.area_id, x: p.mtbf, y: p.mttr, worst: p.quadrant === 'worst',
                details: [{ label: t('MTBF'), value: `${fh(p.mtbf)} h` }, { label: t('MTTR'), value: `${fh2(p.mttr)} h` }, { label: t('Failure events'), value: fint(p.failureEvents) }, { label: t('Quadrant'), value: quadrantWords(p.quadrant) }],
              }))}
              openLabel={t('Open events')} onPoint={onOpen ? (p) => onOpen(`${t('the point of area')} ${p.label}`, m.failureIds.get(p.key) ?? []) : undefined}
            />
          )}
        </ChartCard>
      <AlsoOnDashboard title={t('Reliability factor against MTBF by area')} testid="dup-rf-mtbf">
      <ChartCard
        title={t('Reliability factor against MTBF by area')} subtitle={rfSub} testid="chart-rf-mtbf"
        help={{ id: 'rf-mtbf', vars: rfEx ? { a: rfEx.area_id, r: fpct(rfEx.rf), m: fh(rfEx.mtbf), n: rfEx.mttr !== null ? fh2(rfEx.mttr) : '–' } : {} }}
        summary={rfSummary}
        legend={[
          ...(rfTarget !== null ? [{ label: t('RF at or above target'), color: 'var(--tk-success)', symbol: 'circle' as const }, { label: t('RF below target'), color: 'var(--tk-danger)', symbol: 'triangle' as const }] : [{ label: t('Area'), color: BAR, symbol: 'circle' as const }]),
          ...(rfTarget !== null ? [{ label: t('RF target {x}%', { x: targetNumber(rfTarget) }), color: 'var(--tk-text-primary)', symbol: 'dash' as const }] : []),
          ...(rf.medianMtbf !== null ? [{ label: t('Median MTBF'), color: 'var(--tk-text-secondary)', symbol: 'dash' as const }] : []),
          { label: t('Bigger mark = longer MTTR'), color: 'var(--tk-text-secondary)', symbol: 'circle' as const },
        ]}
        table={{
          head: [t('Area'), t('RF'), t('MTBF h'), t('MTTR h'), t('INC h'), t('Failures'), ...(rfTarget !== null ? [t('Status')] : [])],
          rows: rf.points.map((p) => [p.area_id, fpct(p.rf), fh(p.mtbf), p.mttr !== null ? fh2(p.mttr) : '–', fh(p.incHours), fint(p.failures), ...(rfTarget !== null ? [p.onTarget ? t('On target') : t('Below target')] : [])]),
        }}
        footnote={`${t('MTBF on a log scale: each step is ×2 or ×2.5.')}${rf.excluded.length ? ` ${t('Not shown (no RF or no MTBF): {a}.', { a: rf.excluded.map((x) => x.area_id).join(', ') })}` : ''}`}
      >
        {(w) => (
          <RfMtbfChart
            width={w} height={w < 480 ? 340 : 380} target={rfTarget} medianX={rf.medianMtbf}
            targetLabel={rfTarget !== null ? t('RF target {x}%', { x: targetNumber(rfTarget) }) : undefined}
            medianLabel={rf.medianMtbf !== null ? t('median MTBF {v} h', { v: fh(rf.medianMtbf) }) : undefined}
            xTitle={t('MTBF (hours, log scale) → fails less often')} yTitle={t('Reliability factor RF (%)')}
            ariaLabel={`${t('Scatter chart of the reliability factor against MTBF per area.')} ${rfSummary}`}
            points={rf.points.map((p) => ({
              key: p.area_id, label: p.area_id, x: p.mtbf, y: p.rf * 100, mttr: p.mttr, ok: p.onTarget,
              details: [
                { label: t('RF'), value: fpct(p.rf) }, { label: t('MTBF'), value: `${fh(p.mtbf)} h` }, { label: t('MTTR'), value: p.mttr !== null ? `${fh2(p.mttr)} h` : '–' },
                { label: t('INC hours'), value: `${fh(p.incHours)} h` }, { label: t('Failure events'), value: fint(p.failures) },
                ...(p.onTarget !== null ? [{ label: t('Status'), value: p.onTarget ? t('On target') : t('Below target') }] : []),
              ],
            }))}
            openLabel={t('Open events')} onPoint={onOpen ? (p) => onOpen(`${t('the point of area')} ${p.label}`, m.failureIds.get(p.key) ?? []) : undefined}
          />
        )}
      </ChartCard>
      </AlsoOnDashboard>
      <AlsoOnDashboard title={t('Availability by area and month (basis {b})', { b: basis })} testid="dup-area-month-heat">
        <ChartCard
          title={t('Availability by area and month (basis {b})', { b: basis })} subtitle={t('Each cell is the availability of one area in one month. Fixed scale {a} to {b} %; the last column is the whole range.', { a: AVAIL_MIN, b: AVAIL_MAX })} testid="chart-area-month-heat" help={{ id: 'area-month-heat', vars: { b: basis } }}
          summary={avSummary}
          table={{ head: [t('Area'), ...av.months.map((_x, i) => colFull(i)), t('Range')], rows: av.areas.map((a) => [a.area_id, ...a.values.map(fmtAv), fmtAv(m.overallAvailability.get(a.area_id) ?? { available: false, code: 'no_data', reason: '' })]) }}
          footnote={[partialAny ? av.months.filter((x) => x.partial).map((x) => `* ${partialNote(x)}.`).join(' ') : '', av.months.some((x) => x.notUploaded) ? `${t('n/u')} = ${t(NOT_UPLOADED_FOOT)}` : ''].filter(Boolean).join(' ') || undefined}
        >
          {() => (
            <ScaleHeatmap
              cols={av.months.map((x, i) => ({ key: x.month, label: colLabel(i), title: x.notUploaded ? `${monthLabel(x.month)} (${t('Not uploaded')})` : x.partial ? `${monthLabel(x.month)} (${t('partial month')})` : monthLabel(x.month) }))}
              rows={avRows} min={AVAIL_MIN} max={AVAIL_MAX} caption={t('Availability by area and month')} rowHead={t('Area')} summaryHead={t('Range')}
              legendFormat={(n) => `${n}%`} below={t('under {x}% (strongest shade)', { x: AVAIL_MIN })}
            />
          )}
        </ChartCard>
      </AlsoOnDashboard>
    </>
  );
}
