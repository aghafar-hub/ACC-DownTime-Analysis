// (2) How is stoppage moving month to month? Stacked columns by type (or class), monthly over the year around the
// period or daily over the period. Partial months are faded and labelled, months not uploaded are empty dashed slots.
// A tap or click on a column opens the detail panel in the card: hours per type, change against the previous column
// and 'Open N records' for exactly that month (or day).
import { useEffect, useMemo, useState } from 'react';
import ColumnChart, { type ColSlot } from '../../charts/ColumnChart';
import { PaintSwatch } from '../../charts/paint';
import { classPaint, typePaints, type Paint } from '../../charts/palette';
import { useMeasure } from '../../charts/ChartKit';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { dayText, monthShort, monthText, dateText } from '../../util/dates';
import { num } from '../../util/format';
import { fh, fh2, monthAxisLabels } from '../format';
import { hasValues, idsWithHours, periodText, scopeText, slotChange, trendModel, type Grain, type SplitBy, type TrendSlot } from '../dashModels';
import type { DashCtx } from '../scope';
import type { DashFilters } from '../filters';
import DashCard, { OpenLink, Seg, type LegendMark, type OpenFn } from './DashCard';

export function paintsFor(by: SplitBy, dark: boolean, classNames: Map<string, string>): Paint[] {
  return by === 'type' ? typePaints(dark) : ['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'].map((c) => classPaint(dark, c, classNames.get(c) ?? c));
}

function slotLabel(s: TrendSlot, grain: Grain): string {
  return grain === 'month' ? monthText(s.key) : dateText(s.key);
}

function Detail({ slots, i, grain, paints, ctx, filters, onOpen, onClose }: {
  slots: TrendSlot[]; i: number; grain: Grain; paints: Paint[]; ctx: DashCtx; filters: DashFilters; onOpen: OpenFn; onClose: () => void;
}) {
  const s = slots[i]!;
  const prev = slots.slice(0, i).reverse().find((x) => hasValues(x.status));
  const prevName = prev ? (grain === 'month' ? monthShort(prev.key) : dayText(prev.key)) : '';
  const ids = useMemo(() => (s.window ? idsWithHours(ctx, s.window) : []), [ctx, s.window]);
  const scope = scopeText(s.window ?? { from: s.key, to: s.key }, filters, 'none');
  const change = (key: string) => {
    const c = slotChange(prev, s, key);
    if (!c) return <span className="muted">–</span>;
    const f = c.perDay ? fh2 : fh;
    const dir = Math.abs(c.abs) < (c.perDay ? 0.005 : 0.05) ? 0 : Math.sign(c.abs);
    const arrow = dir > 0 ? '▲' : dir < 0 ? '▼' : '■';
    return (
      <span className={`dchange dchange--${dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat'}`}>
        <span aria-hidden="true">{arrow}</span> {dir > 0 ? '+' : dir < 0 ? '−' : ''}{f(Math.abs(c.abs))} h{c.perDay ? t('/day') : ''}
        {c.pct !== null && !c.perDay && dir !== 0 ? ` (${c.pct > 0 ? '+' : '−'}${Math.abs(c.pct).toFixed(1)}%)` : ''}
      </span>
    );
  };
  return (
    <div className="ddetail" role="region" aria-label={t('Details of {m}', { m: slotLabel(s, grain) })} data-testid="trend-detail">
      <div className="ddetail-head">
        <b>{slotLabel(s, grain)}</b>
        <span className="muted">{s.status === 'partial' ? t('partial: {r}', { r: periodText(s.window!) }) : scope.split(' · ').slice(1).join(' · ')}</span>
        <button type="button" className="ddetail-close" onClick={onClose} aria-label={t('Close the details')} data-testid="trend-detail-close"><Icon name="close" size={16} /></button>
      </div>
      {!hasValues(s.status) ? (
        <p className="muted" data-testid="trend-detail-empty">{s.status === 'notUploaded' ? t('Not uploaded: no records at all for this month. Nothing is counted as 0 h.') : t('No data for this period.')}</p>
      ) : (
        <>
          <table className="ddetail-table">
            <thead><tr><th scope="col">{t('Type')}</th><th scope="col" className="num">{t('Hours')}</th><th scope="col" className="num">{prev ? t('vs {p}', { p: prevName }) : t('Change')}</th></tr></thead>
            <tbody>
              {paints.map((p) => (
                <tr key={p.key}>
                  <th scope="row"><PaintSwatch paint={p} /> {p.label}</th>
                  <td className="num">{fh(s.values[p.key] ?? 0)}</td>
                  <td className="num">{change(p.key)}</td>
                </tr>
              ))}
              <tr className="ddetail-total"><th scope="row">{t('All types')}</th><td className="num" data-testid="trend-detail-total">{fh(s.total)}</td><td className="num">{change('total')}</td></tr>
            </tbody>
          </table>
          {(s.status === 'partial' || prev?.status === 'partial') && <p className="ddetail-note">{t('A partial month is compared per day with data.')}</p>}
          <OpenLink spec={{ ids, label: t('{m}, stoppage by {g}', { m: slotLabel(s, grain), g: grain === 'month' ? t('month') : t('day') }) }} onOpen={onOpen}
            label={t('Open {n} records', { n: num(ids.length) })} testid="trend-detail-open" className="btn-primary ddetail-open" />
        </>
      )}
    </div>
  );
}

export default function TrendCard({ ctx, filters, dark, classNames, onOpen }: { ctx: DashCtx; filters: DashFilters; dark: boolean; classNames: Map<string, string>; onOpen: OpenFn }) {
  const [grain, setGrain] = useState<Grain>('month');
  const [by, setBy] = useState<SplitBy>('type');
  const [sel, setSel] = useState<number | null>(null);
  const model = useMemo(() => trendModel(ctx, grain, by), [ctx, grain, by]);
  useEffect(() => setSel(null), [ctx, grain]);
  const [boxRef, width] = useMeasure<HTMLDivElement>();
  const paints = paintsFor(by, dark, classNames);
  const slots = model?.slots ?? [];
  const axis = grain === 'month' ? monthAxisLabels(slots.map((s) => s.key)) : slots.map((s, i) => (i === 0 || s.key.endsWith('-01') ? dayText(s.key) : String(Number(s.key.slice(8)))));
  const cols: ColSlot[] = slots.map((s, i) => ({
    key: s.key, label: axis[i]!, full: slotLabel(s, grain), status: s.status, highlight: grain === 'month' && s.inPeriod, values: paints.map((p) => s.values[p.key] ?? 0),
  }));
  const ids = useMemo(() => (model ? idsWithHours(ctx, model.range) : []), [ctx, model]);
  const partial = slots.filter((s) => s.status === 'partial');
  const nu = slots.filter((s) => s.status === 'notUploaded');
  const withData = slots.filter((s) => hasValues(s.status));
  const peak = withData.reduce<TrendSlot | null>((b, s) => (!b || s.total > b.total ? s : b), null);
  const summary = peak
    ? t('{n} {u}. Highest: {m}, {v} h stopped.{p}{x}', {
      n: slots.length, u: grain === 'month' ? t('months') : t('days'), m: slotLabel(peak, grain), v: fh(peak.total),
      p: partial.length ? ` ${t('Partial')}: ${partial.map((s) => slotLabel(s, grain)).join(', ')}.` : '',
      x: nu.length ? ` ${t('Not uploaded')}: ${nu.map((s) => slotLabel(s, grain)).join(', ')}.` : '',
    })
    : t('No stoppage data in this range.');
  const legend: LegendMark[] = [
    ...paints.map((p) => ({ kind: 'paint' as const, paint: p, label: by === 'type' ? p.label : p.short })),
    ...(grain === 'month' ? [{ kind: 'partial' as const, label: t('Partial month') }, { kind: 'notUploaded' as const, label: t('Not uploaded') }] : []),
  ];
  const last = slots[slots.length - 1];
  const sub = grain === 'month'
    ? `${t('Trend by month · stopped hours (h) by {b}', { b: by === 'type' ? t('type') : t('class') })}${last?.status === 'partial' && last.window ? ` · ${t('{m} has data to {d}', { m: monthShort(last.key), d: dayText(last.window.to) })}` : ''}`
    : t('Stopped hours (h) per day of the period, by {b}', { b: by === 'type' ? t('type') : t('class') });
  return (
    <DashCard
      id="trend" testid="chart-monthly-stack" span="wide" title={t('How is stoppage moving month to month?')} subtitle={sub}
      help={{ id: 'trend', vars: peak ? { slot: slotLabel(peak, grain), h: fh(peak.total) } : {} }}
      controls={(
        <>
          <Seg value={grain} options={[{ value: 'day', label: t('Daily') }, { value: 'month', label: t('Monthly') }]} onChange={setGrain} label={t('Daily or monthly')} testid="trend-grain" />
          <Seg value={by} options={[{ value: 'type', label: t('By type') }, { value: 'class', label: t('By class') }]} onChange={setBy} label={t('By type or class')} testid="trend-by" />
        </>
      )}
      legend={legend} summary={summary}
      scope={model ? scopeText(model.range, filters, 'none') : ''}
      open={model ? { ids, label: t('Stoppage {p}', { p: periodText(model.range) }) } : null} onOpen={onOpen}
      footExtra={sel === null ? <span className="dcard-hint"><Icon name="info" size={14} /> {grain === 'month' ? t('Tap a month for details') : t('Tap a day for details')}</span> : undefined}
    >
      <div ref={boxRef} className="dcard-chart">
        {width > 0 && model && (
          <ColumnChart
            slots={cols} paints={paints} width={width} height={width < 520 ? 230 : 270} format={fh} selected={sel} onSelect={setSel}
            ariaLabel={t('Stacked columns of stopped hours. {s}', { s: summary })} labelMode={grain === 'day' ? 'peak' : 'auto'} unitLabel="h"
            maxBar={grain === 'day' ? 22 : 58}
          />
        )}
      </div>
      {sel !== null && model && slots[sel] && (
        <Detail slots={slots} i={sel} grain={grain} paints={paints} ctx={ctx} filters={filters} onOpen={onOpen} onClose={() => setSel(null)} />
      )}
    </DashCard>
  );
}
