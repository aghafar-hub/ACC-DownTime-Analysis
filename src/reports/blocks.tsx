// The blocks of every report section: a heading with its sentence, charts (static SVG built from the existing chart
// components and palettes), tables, notes. A block is either a "node" (never split across pages) or a "table" (split
// between rows by the paginator). Colours are the report's own fixed light theme: palettes are asked for light.
import type { ReactNode } from 'react';
import { Legend, type LegendItem } from '../charts/ChartKit';
import CartesianChart, { type CartCategory, type CartSeries } from '../charts/CartesianChart';
import HBars, { type HRow } from '../charts/HBars';
import HeatmapTable from '../charts/HeatmapTable';
import OccurrenceStrip from '../charts/OccurrenceStrip';
import ParetoChart from '../charts/ParetoChart';
import { CLASS_ORDER, STACK_COLORS, classColor } from '../charts/palette';
import QuadrantChart from '../charts/QuadrantChart';
import { dayLabel, dayShort, fh, fh2, fint, fpct, fpct0, monthAxisLabels, monthLabel, monthMissing, NOT_UPLOADED_FOOT, PARTIAL_FOOT } from '../dashboard/format';
import { statusSymbol } from '../dashboard/TargetStatus';
import { statusLine, targetNumber, type TargetStatus } from '../dashboard/targets';
import { t } from '../i18n/t';
import { changeText } from './format';
import type {
  AreaDowntimeSection, AvailabilitySection, CausesData, ClassesSection, DailySection, EventsSection, FailureRateSection, KpiCard, LongestSection, MethodologySection,
  MonthlySection, MtbfMttrSection, ParetoSection, QualitySection, QuadrantSection, ReportModel, ReportTable, RepeatsSection, SectionModel, SummarySection,
  TopEquipmentSection, TopReasonsSection, WhenSection,
} from './model';
import type { CellRenderer } from './ReportTableView';
import { SECTION_BY_ID, SECTION_GROUPS } from './sections';

/** Width of the content area of a page in CSS px (A4 minus 16 mm margins at 96 dpi). */
export const CONTENT_W = 672;
const BAR = 'var(--tk-accent)';
const LIGHT = false;

export type Block =
  | { kind: 'node'; key: string; node: ReactNode; keepNext?: boolean }
  | { kind: 'table'; key: string; table: ReportTable; caption?: string; cell?: CellRenderer; className?: string; keepNext?: boolean };

export interface SectionBlocks { id: string; title: string; blocks: Block[] }

export const anchorId = (id: string): string => `rpt-sec-${id}`;

// ---------------------------------------------------------------- shared pieces

function Heading({ s }: { s: SectionModel }) {
  const def = SECTION_BY_ID[s.id];
  const group = SECTION_GROUPS.find((g) => g.id === def.group);
  return (
    <header className="rpt-sec-head">
      <p className="rpt-eyebrow">{t(group?.label ?? '')}</p>
      <h2 id={anchorId(s.id)} className="rpt-h2">{s.title}</h2>
      {s.takeaway && <p className="rpt-take" data-testid="rpt-takeaway">{s.takeaway}</p>}
    </header>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rpt-empty" data-testid="rpt-empty" role="note">{text}</p>;
}

function Notes({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rpt-notes" data-testid="rpt-notes">
      <p className="rpt-notes-title">{t('How this is calculated')}</p>
      {items.map((n, i) => <p key={i}>{n}</p>)}
    </div>
  );
}

function ChartBox({ title, subtitle, legend, children, foot, testid, half }: { title: string; subtitle?: string; legend?: LegendItem[]; children: ReactNode; foot?: string; testid?: string; half?: boolean }) {
  return (
    <figure className={half ? 'rpt-chart rpt-chart--half' : 'rpt-chart'} data-testid={testid}>
      <figcaption>
        <b className="rpt-h3">{title}</b>
        {subtitle && <span className="rpt-sub">{subtitle}</span>}
      </figcaption>
      {legend && legend.length > 0 && <Legend items={legend} />}
      <div className="rpt-chart-svg">{children}</div>
      {foot && <p className="rpt-foot">{foot}</p>}
    </figure>
  );
}

function node(key: string, n: ReactNode, keepNext = false): Block {
  return { kind: 'node', key, node: n, keepNext };
}

/** The usual opening: heading (kept with what follows) and, when the section has nothing to show, the clear sentence. */
function opening(s: SectionModel): Block[] {
  const head = node(`${s.id}:head`, <Heading s={s} />, !s.empty);
  return s.empty ? [head, node(`${s.id}:empty`, <Empty text={s.empty} />), ...notesBlock(s)] : [head];
}

function notesBlock(s: SectionModel): Block[] {
  return s.notes.length ? [node(`${s.id}:notes`, <Notes items={s.notes} />)] : [];
}

const statLegend = (): LegendItem[] => [
  { label: t('Failure (INC)'), color: STACK_COLORS.failure },
  { label: t('Planned (PL)'), color: STACK_COLORS.planned },
  { label: t('Other (CIR)'), color: STACK_COLORS.other },
];

// ---------------------------------------------------------------- summary

function KpiCardView({ k, compare }: { k: KpiCard; compare: SummarySection['data']['compare'] }) {
  const ch = changeText(k.change, k.changeUnit, compare);
  return (
    <div className="rpt-kpi" data-testid={`rpt-kpi-${k.id}`}>
      <p className="rpt-kpi-label">{k.label}</p>
      <p className={k.unavailable ? 'rpt-kpi-value rpt-kpi-value--small' : 'rpt-kpi-value'} data-testid={`rpt-kpi-${k.id}-value`}>{k.text}</p>
      <p className="rpt-kpi-sub">{k.sub}</p>
      {ch && (
        <p className={`rpt-kpi-change rpt-tone-${ch.tone}`} data-testid={`rpt-kpi-${k.id}-change`}>
          {ch.arrow && <span aria-hidden="true">{ch.arrow} </span>}{ch.amount}{ch.words ? ` · ${ch.words}` : ''}
        </p>
      )}
      {k.status && <StatusMark status={k.status} testid={`rpt-kpi-${k.id}-status`} />}
    </div>
  );
}

function StatusMark({ status, testid }: { status: TargetStatus; testid?: string }) {
  return (
    <p className={`rpt-kpi-status rpt-status-${status.ok ? 'ok' : 'bad'}`} data-testid={testid} data-state={status.state}>
      <span aria-hidden="true">{statusSymbol(status)} </span>{statusLine(status)}
    </p>
  );
}

function summaryBlocks(s: SummarySection, m: ReportModel): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  const periodCard = (
    <div className="rpt-kpi rpt-kpi--period" data-testid="rpt-kpi-period">
      <p className="rpt-kpi-label">{t('Period')}</p>
      <p className="rpt-kpi-value rpt-kpi-value--small">{m.effective ? periodText(m.effective) : periodText(m.range)}</p>
      <p className="rpt-kpi-sub">{m.compare.on && m.compare.range ? `${m.compare.label}: ${periodText(m.compare.range)}` : t('No comparison')}</p>
    </div>
  );
  out.push(node('summary:kpis', (
    <div className="rpt-kpis" data-testid="rpt-kpis">
      {s.data.kpis.map((k) => <KpiCardView key={k.id} k={k} compare={s.data.compare} />)}
      {periodCard}
    </div>
  )));
  out.push(node('summary:bullets', (
    <div className="rpt-findings" data-testid="rpt-findings">
      <p className="rpt-h3">{t('Main findings')}</p>
      <ul>{s.data.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
    </div>
  )));
  out.push(...notesBlock(s));
  return out;
}

export const periodText = (r: { from: string; to: string }): string => (r.from === r.to ? dayLabel(r.from) : `${dayLabel(r.from)} – ${dayLabel(r.to)}`);

// ---------------------------------------------------------------- performance

function dailyBlocks(s: DailySection): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  const days = s.data.days;
  const cats: CartCategory[] = days.map((d) => ({ key: d.date, label: dayShort(d.date), note: dayLabel(d.date) }));
  const series: CartSeries[] = [
    { key: 'failure', label: t('Failure (INC)'), color: STACK_COLORS.failure, type: 'bar', stack: 'd', values: days.map((d) => (d.hasData ? d.failureHours : null)) },
    { key: 'planned', label: t('Planned (PL)'), color: STACK_COLORS.planned, type: 'bar', stack: 'd', values: days.map((d) => (d.hasData ? d.plannedHours : null)) },
    { key: 'other', label: t('Other (CIR)'), color: STACK_COLORS.other, type: 'bar', stack: 'd', values: days.map((d) => (d.hasData ? d.otherHours : null)) },
    { key: 'avg', label: t('{n}-day average (total)', { n: s.data.rollingDays }), color: 'var(--tk-text-primary)', type: 'line', values: days.map((d) => d.rollingDowntimeHours) },
  ];
  out.push(node('daily:chart', (
    <ChartBox title={t('Stopped hours per day')} subtitle={t('Area-hours, stacked by type')} testid="rpt-chart-daily"
      legend={[...statLegend(), { label: t('{n}-day average (total)', { n: s.data.rollingDays }), color: 'var(--tk-text-primary)', symbol: 'line' }]}>
      <CartesianChart static categories={cats} series={series} width={CONTENT_W} height={230} ariaLabel={t('Stacked bar chart of daily stopped hours with a rolling average line. {s}', { s: s.takeaway })} yFormat={(n) => `${n}`} />
    </ChartBox>
  ), true));
  out.push({ kind: 'table', key: 'daily:table', table: s.data.table, caption: s.data.tableKind === 'all' ? t('Hours per day') : t('The 10 days with the most stopped hours') });
  out.push(...notesBlock(s));
  return out;
}

function monthlyBlocks(s: MonthlySection): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  const months = s.data.months;
  const cats: CartCategory[] = months.map((m, i, all) => { const ax = monthAxisLabels(all.map((x) => x.month))[i]!; return { key: m.month, label: m.notUploaded ? `${ax} n/u` : ax, full: monthLabel(m.month), partial: m.partial }; });
  const miss = months.map(monthMissing);
  const series: CartSeries[] = [
    { key: 'failure', label: t('Failure (INC)'), color: STACK_COLORS.failure, type: 'bar', stack: 's', values: months.map((m) => (m.hasData ? m.failureHours : null)), missing: miss },
    { key: 'planned', label: t('Planned (PL)'), color: STACK_COLORS.planned, type: 'bar', stack: 's', values: months.map((m) => (m.hasData ? m.plannedHours : null)), missing: miss },
    { key: 'other', label: t('Other (CIR)'), color: STACK_COLORS.other, type: 'bar', stack: 's', values: months.map((m) => (m.hasData ? m.otherHours : null)), missing: miss },
  ];
  out.push(node('monthly:chart', (
    <ChartBox title={t('Stopped hours per month')} subtitle={t('Area-hours, stacked by type')} testid="rpt-chart-monthly" legend={statLegend()}
      foot={[months.some((m) => m.partial) ? t(PARTIAL_FOOT) : '', months.some((m) => m.notUploaded) ? `n/u: ${t(NOT_UPLOADED_FOOT)}` : ''].filter(Boolean).join(' ') || undefined}>
      <CartesianChart static categories={cats} series={series} width={CONTENT_W} height={250} maxBarWidth={64} ariaLabel={t('Stacked bar chart of monthly stoppage hours. {s}', { s: s.takeaway })} yFormat={(n) => `${n}`} />
    </ChartBox>
  ), true));
  out.push({ kind: 'table', key: 'monthly:table', table: s.data.table, caption: t('Hours per month') });
  out.push(...notesBlock(s));
  return out;
}

function classesBlocks(s: ClassesSection): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  const months = s.data.months;
  const cats: CartCategory[] = months.map((m, i, all) => { const ax = monthAxisLabels(all.map((x) => x.month))[i]!; return { key: m.month, label: m.notUploaded ? `${ax} n/u` : ax, full: monthLabel(m.month), partial: m.partial }; });
  const series: CartSeries[] = CLASS_ORDER.map((code) => ({
    key: code, label: code, color: classColor(LIGHT, code), type: 'bar', stack: 'c', values: months.map((m) => (m.hasData ? m.hours[code] : null)),
  }));
  const names = new Map(s.data.totals.map((c) => [c.code, c.name]));
  out.push(node('classes:chart', (
    <ChartBox title={t('Stopped hours by classification')} subtitle={t('Area-hours per month')} testid="rpt-chart-classes"
      legend={CLASS_ORDER.map((code) => ({ label: `${code} ${names.get(code) ?? ''}`.trim(), color: classColor(LIGHT, code) }))}>
      <CartesianChart static categories={cats} series={series} width={CONTENT_W} height={250} maxBarWidth={64} ariaLabel={t('Stacked bar chart of monthly stopped hours by classification. {s}', { s: s.takeaway })} yFormat={(n) => `${n}`} />
    </ChartBox>
  ), true));
  out.push({ kind: 'table', key: 'classes:table', table: s.data.table, caption: t('Hours by classification in the period') });
  out.push(...notesBlock(s));
  return out;
}

function areaDowntimeBlocks(s: AreaDowntimeSection): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  const rows: HRow[] = s.data.rows.map((r) => ({
    key: r.areaId, label: r.areaId,
    segments: [
      { key: 'inc', label: t('Failure'), color: STACK_COLORS.failure, value: r.failureHours },
      { key: 'pl', label: t('Planned'), color: STACK_COLORS.planned, value: r.plannedHours },
      { key: 'cir', label: t('Other'), color: STACK_COLORS.other, value: r.otherHours },
    ],
  }));
  out.push(node('area_downtime:chart', (
    <ChartBox title={t('Stopped hours by area')} subtitle={t('Area-hours, largest first')} testid="rpt-chart-area-downtime" legend={statLegend()}>
      <HBars static rows={rows} width={CONTENT_W} format={(n) => `${fh(n)} h`} ariaLabel={t('Stacked bars of downtime hours by area')} />
    </ChartBox>
  ), true));
  out.push({ kind: 'table', key: 'area_downtime:table', table: s.data.table, caption: t('Hours by area') });
  out.push(...notesBlock(s));
  return out;
}

function availabilityBlocks(s: AvailabilitySection): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  const d = s.data;
  const below = new Set(d.below);
  const rows: HRow[] = d.areas.flatMap((a) => (a.availability.available
    ? [{
      key: a.area_id, label: a.area_id,
      segments: [{ key: 'av', label: t('Availability (basis {b})', { b: d.basis }), value: a.availability.value * 100, color: below.has(a.area_id) ? 'var(--tk-danger)' : BAR, hatch: below.has(a.area_id) }],
    }]
    : []));
  const overall = d.overall.available ? d.overall.value : null;
  const tg = d.targets.availabilityPct;
  const legend: LegendItem[] = [
    { label: tg !== null ? t('On target') : t('Area availability'), color: BAR },
    ...(tg !== null ? [{ label: t('Below target'), color: 'var(--tk-danger)', symbol: 'hatch' as const }, { label: t('Target {x}%', { x: targetNumber(tg) }), color: 'var(--tk-text-primary)', symbol: 'dash' as const }] : []),
    ...(overall !== null ? [{ label: t('All areas together'), color: 'var(--tk-text-primary)', symbol: (tg !== null ? 'line' : 'dash') as 'line' | 'dash' }] : []),
  ];
  out.push(node('availability:chart', (
    <ChartBox title={t('Availability by area (basis {b})', { b: d.basis })} subtitle={t('Lowest first')} testid="rpt-chart-availability" legend={legend} foot={t('The axis starts at {n}%.', { n: d.floor })}>
      <HBars
        static rows={rows} width={CONTENT_W} format={(n) => `${n.toFixed(1)}%`} xMax={100} xMin={d.floor} axisFormat={(n) => `${n}%`}
        totalLabel={(r, v) => `${v.toFixed(1)}%${below.has(r.key) ? ' ▼' : ''}`}
        refLine={overall !== null ? { value: overall * 100, label: `${t('All areas')} ${fpct(overall)}`, dash: tg !== null ? 'none' : undefined } : undefined}
        extraRefs={tg !== null ? [{ value: tg, label: t('Target {x}%', { x: targetNumber(tg) }) }] : []}
        ariaLabel={t('Bars of availability per area with a line at the availability of all areas. {s}', { s: s.takeaway })}
      />
    </ChartBox>
  ), true));
  out.push({ kind: 'table', key: 'availability:table', table: d.table, caption: t('Availability (basis {b}) by area', { b: d.basis }) });
  out.push(...notesBlock(s));
  return out;
}

function ranksToRows(ranks: { area_id: string; value: number | null; code: string | null; reason: string | null }[], label: string): HRow[] {
  return ranks.map((r) => ({
    key: r.area_id, label: r.area_id,
    unavailable: r.value !== null ? undefined : r.code === 'no_failures' ? t('no failures') : t('unavailable'),
    segments: r.value === null ? [] : [{ key: 'v', label, color: BAR, value: r.value }],
  }));
}

function mtbfMttrBlocks(s: MtbfMttrSection): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  const d = s.data;
  const tg = d.targets;
  out.push(node('mtbf_mttr:charts', (
    <div className="rpt-pair">
      <ChartBox half title={t('MTBF by area')} subtitle={t('Operating hours per failure, lowest first')} testid="rpt-chart-mtbf"
        legend={[{ label: t('MTBF (h)'), color: BAR }, ...(tg.mtbfH !== null ? [{ label: t('Target {x} h', { x: targetNumber(tg.mtbfH) }), color: 'var(--tk-text-primary)', symbol: 'dash' as const }] : [])]}>
        <HBars static rows={ranksToRows(d.mtbf, t('MTBF'))} width={(CONTENT_W - 24) / 2} format={(n) => `${fh(n)} h`} ariaLabel={t('Bars of MTBF by area, lowest first.')}
          refLine={tg.mtbfH !== null ? { value: tg.mtbfH, label: t('Target {x} h', { x: targetNumber(tg.mtbfH) }) } : undefined} />
      </ChartBox>
      <ChartBox half title={t('MTTR by area')} subtitle={t('Mean restoration time, highest first')} testid="rpt-chart-mttr"
        legend={[{ label: t('MTTR (h)'), color: BAR }, ...(tg.mttrH !== null ? [{ label: t('Target {x} h', { x: targetNumber(tg.mttrH) }), color: 'var(--tk-text-primary)', symbol: 'dash' as const }] : [])]}>
        <HBars static rows={ranksToRows(d.mttr, t('MTTR'))} width={(CONTENT_W - 24) / 2} format={(n) => `${fh2(n)} h`} ariaLabel={t('Bars of MTTR by area, highest first.')}
          refLine={tg.mttrH !== null ? { value: tg.mttrH, label: t('Target {x} h', { x: targetNumber(tg.mttrH) }) } : undefined} />
      </ChartBox>
    </div>
  ), true));
  out.push({ kind: 'table', key: 'mtbf_mttr:table', table: d.table, caption: t('MTBF and MTTR by area') });
  out.push(...notesBlock(s));
  return out;
}

function failureRateBlocks(s: FailureRateSection): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  const d = s.data;
  const overall = d.overall.available ? d.overall.value : null;
  const max = Math.max(0, ...d.rows.map((r) => r.value ?? 0), overall ?? 0);
  out.push(node('failure_rate:chart', (
    <ChartBox title={t('Failures per 1,000 operating hours')} subtitle={t('Highest first')} testid="rpt-chart-failure-rate"
      legend={[{ label: t('Area'), color: BAR }, ...(overall !== null ? [{ label: t('All areas together'), color: 'var(--tk-text-primary)', symbol: 'dash' as const }] : [])]}>
      <HBars static rows={ranksToRows(d.rows, t('Failures per 1,000 h'))} width={CONTENT_W} format={(n) => fh2(n)} xMax={max * 1.1 || 1}
        refLine={overall !== null ? { value: overall, label: `${t('All areas')} ${fh2(overall)}` } : undefined} ariaLabel={t('Bars of failures per 1,000 operating hours by area. {s}', { s: s.takeaway })} />
    </ChartBox>
  ), true));
  out.push({ kind: 'table', key: 'failure_rate:table', table: d.table, caption: t('Failure rate by area') });
  out.push(...notesBlock(s));
  return out;
}

// ---------------------------------------------------------------- causes

function causesBlocks(s: TopEquipmentSection | TopReasonsSection, what: 'equipment' | 'reason'): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  const d: CausesData = s.data;
  const blank = t('(blank code)');
  const fmt = d.measure === 'hours' ? fh : fint;
  const unit = d.measure === 'hours' ? ' h' : '';
  const rows: HRow[] = d.bars.map((b) => ({
    key: b.key, label: b.label.trim() ? b.label : blank,
    segments: [{ key: 'v', label: d.measure === 'hours' ? t('Failure hours') : t('Failures'), color: STACK_COLORS.failure, value: b.value }],
  }));
  const share = new Map(d.bars.map((b) => [b.key, b.sharePct]));
  const n = Math.min(d.top, d.bars.length);
  const title = what === 'equipment'
    ? (d.measure === 'hours' ? t('Top {n} equipment by failure hours', { n }) : t('Top {n} equipment by failures', { n }))
    : (d.measure === 'hours' ? t('Top {n} reasons by failure hours', { n }) : t('Top {n} reasons by failures', { n }));
  out.push(node(`${s.id}:chart`, (
    <ChartBox title={title} subtitle={what === 'equipment' ? t('Own-stop rule: only codes that belong to the stopped area') : t('Reason of the failure event')} testid={`rpt-chart-${s.id}`}
      legend={[{ label: d.measure === 'hours' ? t('Failure hours') : t('Failures'), color: STACK_COLORS.failure }]}>
      <HBars static labelMax={200} rows={rows} width={CONTENT_W} format={(n) => `${fmt(n)}${unit}`} totalLabel={(r, v) => `${fmt(v)}${unit} · ${fpct0(share.get(r.key) ?? 0)}`} ariaLabel={title} />
    </ChartBox>
  ), true));
  out.push({ kind: 'table', key: `${s.id}:table`, table: d.table, caption: title });
  out.push(...notesBlock(s));
  return out;
}

function paretoBlocks(s: ParetoSection): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  const fmt = s.data.measure === 'hours' ? fh : fint;
  out.push(...notesBlock(s));
  for (const p of s.data.parts) {
    out.push(node(`pareto:${p.key}:chart`, (
      <ChartBox title={p.title} testid={`rpt-chart-pareto-${p.key}`}
        legend={[{ label: s.data.measure === 'hours' ? t('Bar: hours') : t('Bar: failures'), color: BAR }, { label: t('Cumulative %'), color: 'var(--tk-text-primary)', symbol: 'line' }, { label: t('80% line'), color: 'var(--tk-text-primary)', symbol: 'dash' }, { label: t('Others'), color: BAR, symbol: 'hatch' }]}>
        <ParetoChart static result={p.result} width={CONTENT_W} height={270} valueLabel={s.data.measure === 'hours' ? 'h' : t('failures')} format={fmt} ariaLabel={p.title} />
      </ChartBox>
    ), true));
    out.push({ kind: 'table', key: `pareto:${p.key}:table`, table: p.table, caption: p.title });
  }
  return out;
}

// ---------------------------------------------------------------- reliability

function repeatsBlocks(s: RepeatsSection): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  const d = s.data;
  out.push(node('repeats:stats', (
    <div className="rpt-stats" data-testid="rpt-repeat-stats">
      <div><b>{fint(d.totalGroups)}</b><span>{t('qualifying groups')}</span></div>
      <div><b>{fint(d.recurrences)}</b><span>{t('recurrence events')}</span></div>
      <div><b>{fint(d.equipmentCount)}</b><span>{t('equipment affected')}</span></div>
      <div><b>{fh(d.groupHours)} h</b><span>{t('in these groups')}</span></div>
    </div>
  ), true));
  const win = d.window;
  const cell: CellRenderer = (ri, ci) => {
    const g = d.groups[ri];
    if (!g || ci !== 3 || !win) return undefined;
    return <OccurrenceStrip dates={g.occurrenceDates} from={win.from} to={win.to} label={`${g.equipmentId}, ${g.reasonLabel}`} />;
  };
  out.push({ kind: 'table', key: 'repeats:table', table: d.table, caption: t('Repeated failures, most occurrences first'), cell, className: 'rpt-table--repeats' });
  out.push(...notesBlock(s));
  return out;
}

function longestBlocks(s: LongestSection): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  out.push({ kind: 'table', key: 'longest:table', table: s.data.table, caption: s.data.events.length === 1 ? t('The longest failure event') : t('The {n} longest failure events', { n: s.data.events.length }) });
  out.push(...notesBlock(s));
  return out;
}

function quadrantBlocks(s: QuadrantSection): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  const q = s.data.result;
  const worstLabel = t('Worst: low MTBF, high MTTR');
  out.push(node('quadrant:chart', (
    <ChartBox title={t('MTBF against MTTR by area')} subtitle={t('One point per area; dashed lines are the medians')} testid="rpt-chart-quadrant"
      legend={[{ label: t('Area'), color: BAR, symbol: 'circle' }, { label: t('Worst quadrant (low MTBF, high MTTR)'), color: 'var(--tk-danger)', symbol: 'diamond' }, { label: t('Median'), color: 'var(--tk-text-primary)', symbol: 'dash' }]}>
      <QuadrantChart
        static width={CONTENT_W} height={340} xTitle={t('MTBF (hours)')} yTitle={t('MTTR (hours)')} medianX={q.medianMtbf} medianY={q.medianMttr}
        medianXLabel={q.medianMtbf !== null ? t('median {v} h', { v: fh(q.medianMtbf) }) : undefined} medianYLabel={q.medianMttr !== null ? t('median {v} h', { v: fh2(q.medianMttr) }) : undefined}
        worstLabel={worstLabel} ariaLabel={`${t('Scatter chart of MTBF against MTTR per area with median lines.')} ${s.takeaway}`}
        points={q.points.map((p) => ({ key: p.area_id, label: p.area_id, x: p.mtbf, y: p.mttr, worst: p.quadrant === 'worst', details: [] }))}
      />
    </ChartBox>
  ), true));
  out.push({ kind: 'table', key: 'quadrant:table', table: s.data.table, caption: t('MTBF and MTTR per area') });
  out.push(...notesBlock(s));
  return out;
}

function whenBlocks(s: WhenSection): Block[] {
  const out = opening(s);
  if (s.empty || !s.data.heat) return out;
  const heat = s.data.heat;
  const fmt = s.data.measure === 'count' ? fint : fh;
  out.push(node('when:chart', (
    <ChartBox title={t('Failure starts by hour and weekday')} subtitle={s.data.measure === 'count' ? t('Failure events') : t('Hours of failure events')} testid="rpt-chart-when"
      legend={[{ label: t('Darker = more'), color: BAR }]}>
      <HeatmapTable map={heat} format={fmt} caption={t('Failure starts by hour and weekday')} rowHead={t('Hour')} shortCol={(l) => t(l)} colTotals />
    </ChartBox>
  ), true));
  out.push(...notesBlock(s));
  return out;
}

// ---------------------------------------------------------------- detail

function eventsBlocks(s: EventsSection): Block[] {
  const out = opening(s);
  if (s.empty) return out;
  out.push({ kind: 'table', key: 'events:table', table: s.data.table, caption: s.data.all ? t('All records, in time order') : t('The {n} longest records', { n: s.data.shown }), className: 'rpt-table--events' });
  out.push(...notesBlock(s));
  return out;
}

function qualityBlocks(s: QualitySection): Block[] {
  const out = opening(s);
  const d = s.data;
  out.push(node('quality:stats', (
    <div className="rpt-stats rpt-stats--wide" data-testid="rpt-quality-stats">
      <div><b data-testid="rpt-q-records">{fint(d.records)}</b><span>{t('records checked')}</span></div>
      <div><b data-testid="rpt-q-leftout">{fint(d.leftOut.count)}</b><span>{t('left out of the numbers')} ({fh(d.leftOut.hours)} h)</span></div>
      <div><b data-testid="rpt-q-kept">{fint(d.kept.count)}</b><span>{t('kept as entered')}{d.kept.leftOut ? ` (${t('{n} still left out', { n: d.kept.leftOut })})` : ''}</span></div>
      <div><b data-testid="rpt-q-open">{fint(d.open)}</b><span>{t('with problems still open')}</span></div>
      <div><b>{d.cleanPct === null ? '–' : fpct0(d.cleanPct)}</b><span>{t('without an open problem')}</span></div>
      <div><b>{fint(d.voided)}</b><span>{t('voided, ignored everywhere')}</span></div>
    </div>
  ), true));
  if (d.byFlag.length) {
    out.push({
      kind: 'table', key: 'quality:flags', caption: t('Open problems by kind'),
      table: { columns: [{ label: t('Problem'), kind: 'text' }, { label: t('Records'), kind: 'count' }], rows: d.byFlag.map((f) => [f.label, f.count]) },
    });
  }
  if (d.months.length) out.push({ kind: 'table', key: 'quality:months', table: d.table, caption: t('Data quality by month') });
  out.push(...notesBlock(s));
  return out;
}

function methodologyBlocks(s: MethodologySection): Block[] {
  const out = opening(s);
  s.data.items.forEach((it, i) => {
    out.push(node(`methodology:${i}`, (
      <div className="rpt-def">
        <p className="rpt-h3">{it.term}</p>
        {it.paragraphs.map((p, k) => <p key={k}>{p}</p>)}
      </div>
    )));
  });
  return out;
}

// ---------------------------------------------------------------- all sections

/** The blocks of one section (not the cover, which is a page of its own). */
export function sectionBlocks(s: SectionModel, m: ReportModel): SectionBlocks {
  const blocks = ((): Block[] => {
    switch (s.id) {
      case 'cover': return [];
      case 'summary': return summaryBlocks(s, m);
      case 'daily': return dailyBlocks(s);
      case 'monthly': return monthlyBlocks(s);
      case 'classes': return classesBlocks(s);
      case 'area_downtime': return areaDowntimeBlocks(s);
      case 'availability': return availabilityBlocks(s);
      case 'mtbf_mttr': return mtbfMttrBlocks(s);
      case 'failure_rate': return failureRateBlocks(s);
      case 'top_equipment': return causesBlocks(s, 'equipment');
      case 'top_reasons': return causesBlocks(s, 'reason');
      case 'pareto': return paretoBlocks(s);
      case 'repeats': return repeatsBlocks(s);
      case 'longest': return longestBlocks(s);
      case 'quadrant': return quadrantBlocks(s);
      case 'when': return whenBlocks(s);
      case 'events': return eventsBlocks(s);
      case 'quality': return qualityBlocks(s);
      case 'methodology': return methodologyBlocks(s);
    }
  })();
  return { id: s.id, title: s.title, blocks };
}

