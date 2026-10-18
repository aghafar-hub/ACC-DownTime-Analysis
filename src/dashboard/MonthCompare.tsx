// "Month vs month": two calendar months side by side, with a comparison table and a grouped bar chart per area.
// Same section on the Dashboard and Reliability. The month pair lives in the address (?mvm=YYYY-MM,YYYY-MM), so a view can be
// shared; the other dashboard filters apply, the date range and the comparison do not.
import { monthText } from '../util/dates';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import CartesianChart, { type CartCategory, type CartSeries } from '../charts/CartesianChart';
import { ChartCard } from '../charts/ChartKit';
import { seriesColor } from '../charts/palette';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useIsMobile } from '../hooks/useIsMobile';
import { useTheme } from '../theme/ThemeContext';
import { useValidationOptional } from '../validate/ValidationContext';
import { dataRangeOf, notUploadedMonths } from '../calc';
import { asShown, ChangeLine, fh, fh2, fint, fpct, metricText, MTBF_ALL_LABEL } from './format';
import type { CompareId, CompareRow } from './monthCompare';
import { defaultMonthPair, MONTH_PAIR_PARAM, monthCompareModel, monthPairText, monthsWithData, parseMonthPair, type MonthPair } from './monthCompare';
import type { Dash } from './useDash';
import './dashboard.css';

/** "2026-03" -> "Mar 2026" */
export const monthLong = (key: string): string => monthText(key);

function rowLabel(id: CompareId, basis: string): string {
  switch (id) {
    case 'stoppage': return t('Stoppage hours');
    case 'failureHours': return t('Failure hours');
    case 'planned': return t('Planned hours');
    case 'other': return t('CIR hours');
    case 'failureCount': return t('Failure count');
    case 'operating': return t('Operating hours');
    case 'availability': return t('Availability (basis {b})', { b: basis });
    case 'reliability': return t('Reliability factor (RF)');
    case 'utilization': return t('Utilization factor (UF)');
    case 'mttr': return t('MTTR');
    case 'mtbf': return t(MTBF_ALL_LABEL);
    case 'repeated': return t('Repeated failures');
  }
}

const fmtOf = (k: CompareRow['kind'], perDay = false): { f: (n: number) => string; unit: string; cf: (n: number) => string; cunit: string } => {
  if (perDay) {
    // a rate per day with data: two decimals so small daily figures stay readable
    const day = t('/day');
    return k === 'count' ? { f: fh2, unit: ` ${day}`, cf: fh2, cunit: ` ${day}` } : { f: fh2, unit: ` h${day}`, cf: fh2, cunit: ` h${day}` };
  }
  switch (k) {
    case 'hours': return { f: fh, unit: ' h', cf: fh, cunit: ' h' };
    case 'hours2': return { f: fh2, unit: ' h', cf: fh2, cunit: ' h' };
    case 'count': return { f: fint, unit: '', cf: fint, cunit: '' };
    case 'pct': return { f: (n) => fpct(n), unit: '', cf: (n) => (n * 100).toFixed(1), cunit: ' pts' };
  }
};

/** One change in the compact header: 'Stoppage ▲ +213.0 h'. */
function MiniChange({ label, row, f, unit }: { label: string; row: CompareRow | undefined; f: (n: number) => string; unit: string }) {
  if (!row || !row.change.available) return null;
  const c = asShown(row.change, f);
  if (!c.available) return null;
  const arrow = c.direction === 'up' ? '▲' : c.direction === 'down' ? '▼' : '■';
  const sign = c.abs > 0 ? '+' : c.abs < 0 ? '−' : '';
  return (
    <span className="mini-change">
      {label} <span className={`kpi-change--${c.assessment}`}><span aria-hidden="true">{arrow}</span> {sign}{f(Math.abs(c.abs))}{unit}</span>
    </span>
  );
}

export default function MonthCompare({ dash, page, compact = false }: {
  dash: Dash; page: 'overview' | 'reliability';
  /** the Dashboard's compact section: the header line already says what changed */
  compact?: boolean;
}) {
  const [sp, setSp] = useSearchParams();
  const { dark } = useTheme();
  const mobile = useIsMobile();
  const v = useValidationOptional();
  const urlPair = parseMonthPair(sp);
  const [open, setOpen] = useState(urlPair !== null);
  // a link that names the pair opens the section
  useEffect(() => { if (urlPair) setOpen(true); }, [urlPair?.a, urlPair?.b]); // eslint-disable-line react-hooks/exhaustive-deps
  // an address written as cmp=A,B is moved to its own name, so the comparison buttons keep working
  useEffect(() => {
    if (/^\d{4}-\d{2},\d{4}-\d{2}$/.test(sp.get('cmp') ?? '') && !sp.has(MONTH_PAIR_PARAM)) {
      setSp((cur) => { const n = new URLSearchParams(cur); n.set(MONTH_PAIR_PARAM, n.get('cmp')!); n.delete('cmp'); return n; }, { replace: true });
    }
  }, [sp, setSp]);

  const rows = v?.rows ?? [];
  const ready = !!v?.ready && !!dash.startup;
  const months = useMemo(() => (ready ? monthsWithData(rows) : []), [ready, rows]);
  const coverage = useMemo(() => (ready ? dataRangeOf(rows.filter((r) => !r.is_void)) : null), [ready, rows]);
  const def = useMemo(() => defaultMonthPair(months, coverage), [months, coverage]);
  const pair: MonthPair | null = urlPair ?? def;
  const options = useMemo(() => [...new Set([...months, ...(pair ? [pair.a, pair.b] : [])])].sort().reverse(), [months, pair]);
  // P6: a month inside the data with no record at all is 'Not uploaded': never offered, and marked when a link names it
  const notUploaded = useMemo(() => new Set(ready ? notUploadedMonths(rows, coverage) : []), [ready, rows, coverage]);
  const optLabel = (m: string): string => (notUploaded.has(m) ? `${monthLong(m)} (${t('Not uploaded')})` : monthLong(m));

  // the comparison ignores the date filters (period, year, month, range, comparison): changing only those
  // must not rebuild it, so it is keyed on the other filters alone (monthCompareModel resets the same fields)
  const cmpKey = JSON.stringify({ ...dash.filters, preset: 'custom', from: '', to: '', year: null, month: null, compare: 'none' });
  const cmpFilters = useMemo(() => dash.filters, [cmpKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const model = useMemo(
    () => ((open || compact) && ready && pair && dash.startup ? monthCompareModel(rows, dash.startup, cmpFilters, pair) : null),
    [open, compact, ready, pair?.a, pair?.b, rows, dash.startup, cmpFilters], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const choose = (patch: Partial<MonthPair>) => {
    if (!pair) return;
    // two quick choices (Month A, then Month B) come before a new render: start from the address as it is now
    const h = window.location.hash;
    const live = h.startsWith('#/') ? new URLSearchParams(h.includes('?') ? h.slice(h.indexOf('?') + 1) : '') : null;
    const next = { ...((live && parseMonthPair(live)) ?? pair), ...patch };
    setSp((cur) => { const n = new URLSearchParams(live ?? cur); n.set(MONTH_PAIR_PARAM, monthPairText(next)); n.delete('cmp'); return n; }, { replace: true });
  };

  const id = `${page}-mvm`;
  const la = pair ? monthLong(pair.a) : '';
  const lb = pair ? monthLong(pair.b) : '';

  // ---- chart data: areas ordered by the larger of the two months, so the biggest come first
  const areas = useMemo(() => {
    if (!model) return [];
    return [...model.areas].sort((x, y) => Math.max(y.a?.downtimeHours ?? 0, y.b?.downtimeHours ?? 0) - Math.max(x.a?.downtimeHours ?? 0, x.b?.downtimeHours ?? 0) || x.area_id.localeCompare(y.area_id));
  }, [model]);
  const cats: CartCategory[] = areas.map((a) => ({ key: a.area_id, label: a.area_id }));
  // a partial month: the bars are per day with data too, like the table
  const perDay = !!model?.perDay;
  const divA = perDay && model!.daysA > 0 ? model!.daysA : 1;
  const divB = perDay && model!.daysB > 0 ? model!.daysB : 1;
  const series = (pick: (k: NonNullable<(typeof areas)[number]['a']>) => number, fmt: (n: number) => string, unit: string): CartSeries[] => [
    { key: 'a', label: `${t('Month A')}: ${la}`, color: seriesColor(dark, 0), type: 'bar', values: areas.map((a) => (a.a ? pick(a.a) / divA : null)), format: (n) => `${fmt(n)}${unit}` },
    { key: 'b', label: `${t('Month B')}: ${lb}`, color: seriesColor(dark, 1), type: 'bar', values: areas.map((a) => (a.b ? pick(a.b) / divB : null)), format: (n) => `${fmt(n)}${unit}`, hatch: true },
  ];
  const day = t('/day');
  const hFmt = perDay ? fh2 : fh;
  const cFmt = perDay ? fh2 : fint;
  const hUnit = perDay ? ` h${day}` : ' h';
  const cUnit = perDay ? ` ${day}` : '';
  const hoursSeries = series((k) => k.downtimeHours, hFmt, hUnit);
  const countSeries = series((k) => k.failureCount, cFmt, cUnit);
  const legend = [
    { label: `${t('Month A')}: ${la}`, color: seriesColor(dark, 0) },
    { label: `${t('Month B')}: ${lb}`, color: seriesColor(dark, 1), symbol: 'hatch' as const },
  ];
  const sumOf = (s: CartSeries[], fmt: (n: number) => string, unit: string): string => {
    if (areas.length === 0) return t('No areas are in scope.');
    const a = s[0]!.values;
    const b = s[1]!.values;
    let best = -1;
    let diff = 0;
    areas.forEach((_x, i) => { const d = (b[i] ?? 0) - (a[i] ?? 0); if (Math.abs(d) > Math.abs(diff)) { diff = d; best = i; } });
    const totalA = a.reduce<number>((x, y) => x + (y ?? 0), 0);
    const totalB = b.reduce<number>((x, y) => x + (y ?? 0), 0);
    const head = t('{n} areas. {a}: {x}{u} in total; {b}: {y}{u}.', { n: areas.length, a: la, b: lb, x: fmt(totalA), y: fmt(totalB), u: unit });
    return best >= 0 && diff !== 0
      ? `${head} ${t('Biggest difference: {area}, {a} {x}{u} against {b} {y}{u}.', { area: areas[best]!.area_id, a: la, b: lb, x: fmt(a[best] ?? 0), y: fmt(b[best] ?? 0), u: unit })}`
      : `${head} ${t('No area differs between the two months.')}`;
  };
  const tableOf = (s: CartSeries[], fmt: (n: number) => string, decimals: number) => ({
    head: [t('Area'), la, lb, t('Change')],
    rows: areas.map((a, i) => {
      const x = s[0]!.values[i];
      const y = s[1]!.values[i];
      const d = x == null || y == null ? null : x - y;
      return [a.area_id, x == null ? '-' : fmt(x), y == null ? '-' : fmt(y), d === null ? '-' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(decimals)}`];
    }),
  });

  const rowOf = (rid: CompareId) => model?.rows.find((r) => r.id === rid);
  const toggle = compact ? (
    <button type="button" className="dsec-head" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((x) => !x)} data-testid={`${id}-toggle`}>
      <span className="dsec-chev" aria-hidden="true"><Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} /></span>
      <span className="dsec-text">
        <b className="dsec-title">{t('Month vs month')}{pair && !mobile ? ` (${lb} vs ${la})` : ''}</b>
        <span className="dsec-sum" data-testid={`${id}-summary`}>
          {mobile && pair ? <span>{lb.slice(0, 3)} vs {la} · </span> : null}
          {model && model.hasA && model.hasB ? (
            <>
              <MiniChange label={t('Stoppage')} row={rowOf('stoppage')} f={model.perDay ? fh2 : fh} unit={model.perDay ? ` h${t('/day')}` : ' h'} />
              {!mobile && <MiniChange label={t('Failures')} row={rowOf('failureCount')} f={model.perDay ? fh2 : fint} unit={model.perDay ? t('/day') : ''} />}
              {!mobile && <MiniChange label={t('Availability')} row={rowOf('availability')} f={(n) => (n * 100).toFixed(1)} unit={` ${t('pt')}`} />}
              {!mobile && <MiniChange label={t('MTTR')} row={rowOf('mttr')} f={fh2} unit=" h" />}
            </>
          ) : null}
        </span>
      </span>
      <span className="dsec-more" aria-hidden="true">{open ? t('Collapse') : t('Expand')}</span>
    </button>
  ) : (
    <button type="button" className="more-head" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((x) => !x)} data-testid={`${id}-toggle`}>
      <span className="dup-text"><span className="dup-title">{t('Month vs month')} {pair && <small>{la} {t('and')} {lb}</small>}</span> <small className="dup-note" data-testid={`${id}-also`}>{t('Also on the Dashboard')}</small></span>
      <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
    </button>
  );

  return (
    <section className={compact ? 'card dsec' : 'more-figures'} data-testid={id} data-open={open ? 'yes' : 'no'}>
      {toggle}
      {open && (
        <div id={`${id}-body`} className="mvm-body">
          {!ready ? <p className="muted" data-testid={`${id}-loading`}>{t('Loading…')}</p> : !pair ? <p className="muted" data-testid={`${id}-none`}>{t('There is no data to compare yet.')}</p> : (
            <>
              <p className="chart-sub" style={{ margin: '0 0 8px' }}>{t('Two calendar months side by side. The line, area, equipment, reason, classification, criticality and failures filters apply; the date range and the comparison do not.')}</p>
              <div className="mvm-pick">
                <div className="field">
                  <label htmlFor={`${id}-a`}>{t('Month A')}</label>
                  <select id={`${id}-a`} className="select" value={pair.a} onChange={(e) => choose({ a: e.target.value })} data-testid={`${id}-a`}>
                    {options.map((m) => <option key={m} value={m} disabled={notUploaded.has(m)}>{optLabel(m)}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`${id}-b`}>{t('Month B')}</label>
                  <select id={`${id}-b`} className="select" value={pair.b} onChange={(e) => choose({ b: e.target.value })} data-testid={`${id}-b`}>
                    {options.map((m) => <option key={m} value={m} disabled={notUploaded.has(m)}>{optLabel(m)}</option>)}
                  </select>
                </div>
              </div>
              {model && (
                <>
                  {mobile ? (
                    <div className="mvm-cards" data-testid={`${id}-cards`}>
                      {model.rows.map((r) => {
                        const f = fmtOf(r.kind, r.perDay);
                        return (
                          <div className="mvm-card" key={r.id} data-testid="mvm-row" data-id={r.id}>
                            <b className="mvm-card-title">{rowLabel(r.id, model.basis)}</b>
                            <div className="mvm-card-vals">
                              <span><small>{la}{model.partialA ? '*' : ''}</small><span className="mvm-val" data-testid="mvm-a">{metricText(r.a, f.f, f.unit).text}</span></span>
                              <span><small>{lb}{model.partialB ? '*' : ''}</small><span className="mvm-val" data-testid="mvm-b">{metricText(r.b, f.f, f.unit).text}</span></span>
                            </div>
                            <div data-testid="mvm-change"><ChangeLine change={r.change} fmt={f.cf} unit={f.cunit} label="" compare="previous_period" /></div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                  <div className="table-wrap">
                    <table className="data-table" data-testid={`${id}-table`}>
                      <caption className="sr-only">{t('Month A against month B')}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{t('Measure')}</th>
                          <th scope="col" className="num">{la}{model.partialA ? '*' : ''}</th>
                          <th scope="col" className="num">{lb}{model.partialB ? '*' : ''}</th>
                          <th scope="col">{t('Change, A against B')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {model.rows.map((r) => {
                          const f = fmtOf(r.kind, r.perDay);
                          return (
                            <tr key={r.id} data-testid="mvm-row" data-id={r.id}>
                              <th scope="row">{rowLabel(r.id, model.basis)}</th>
                              <td className="num" data-testid="mvm-a">{metricText(r.a, f.f, f.unit).text}</td>
                              <td className="num" data-testid="mvm-b">{metricText(r.b, f.f, f.unit).text}</td>
                              <td data-testid="mvm-change"><ChangeLine change={r.change} fmt={f.cf} unit={f.cunit} label="" compare="previous_period" /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  )}
                  {model.perDay && (
                    <p className="chart-foot" data-testid="mvm-perday">
                      {t('* Only part of this month has data ({a}: {x} days, {b}: {y} days). Hours and counts are shown per day with data, and no change is called better or worse.', { a: la, x: model.daysA, b: lb, y: model.daysB })}
                    </p>
                  )}
                  {(!model.hasA || !model.hasB) && <p className="chart-foot" data-testid="mvm-nodata">{t('A month without data shows no figures and no change.')}</p>}
                  <div className="chart-grid" style={{ marginTop: 12 }}>
                    <ChartCard
                      title={t('Stoppage hours by area')} subtitle={perDay ? t('Month A (solid) against month B (striped), hours stopped per area and day with data') : t('Month A (solid) against month B (striped), hours stopped per area')} testid="chart-mvm-hours" help={{ id: 'mvm-hours' }}
                      summary={sumOf(hoursSeries, hFmt, hUnit)} legend={legend} table={tableOf(hoursSeries, hFmt, perDay ? 2 : 1)}
                    >
                      {(w) => <CartesianChart categories={cats} series={hoursSeries} width={w} ariaLabel={t('Grouped bars of stoppage hours by area, month A against month B. {s}', { s: sumOf(hoursSeries, hFmt, hUnit) })} yFormat={(n) => `${n}`} rotateLabels maxBarWidth={18} />}
                    </ChartCard>
                    <ChartCard
                      title={t('Failure count by area')} subtitle={perDay ? t('Month A (solid) against month B (striped), failures per area and day with data') : t('Month A (solid) against month B (striped), failures per area')} testid="chart-mvm-count" help={{ id: 'mvm-count' }}
                      summary={sumOf(countSeries, cFmt, cUnit)} legend={legend} table={tableOf(countSeries, cFmt, perDay ? 2 : 0)}
                    >
                      {(w) => <CartesianChart categories={cats} series={countSeries} width={w} ariaLabel={t('Grouped bars of failure count by area, month A against month B. {s}', { s: sumOf(countSeries, cFmt, cUnit) })} yFormat={(n) => `${n}`} rotateLabels maxBarWidth={18} />}
                    </ChartCard>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
