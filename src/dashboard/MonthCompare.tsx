// "Month vs month": two calendar months side by side, with a comparison table and a grouped bar chart per area.
// Same section on Overview and Reliability. The month pair lives in the address (?mvm=YYYY-MM,YYYY-MM), so a view can be
// shared; the other dashboard filters apply, the date range and the comparison do not.
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
import { dataRangeOf } from '../calc';
import { ChangeLine, fh, fh2, fint, fpct, metricText } from './format';
import type { CompareId, CompareRow } from './monthCompare';
import { defaultMonthPair, MONTH_PAIR_PARAM, monthCompareModel, monthPairText, monthsWithData, parseMonthPair, type MonthPair } from './monthCompare';
import type { Dash } from './useDash';
import './dashboard.css';

const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-03" -> "Mar 2026" */
export const monthLong = (key: string): string => {
  const [y, m] = key.split('-');
  return `${NAMES[Number(m) - 1] ?? m} ${y}`;
};

function rowLabel(id: CompareId, basis: string): string {
  switch (id) {
    case 'stoppage': return t('Stoppage hours');
    case 'failureHours': return t('Failure hours');
    case 'planned': return t('Planned hours');
    case 'other': return t('Other hours');
    case 'failureCount': return t('Failure count');
    case 'operating': return t('Operating hours');
    case 'availability': return t('Availability (basis {b})', { b: basis });
    case 'mttr': return t('MTTR');
    case 'mtbf': return t('MTBF, all areas (area-hours)');
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

export default function MonthCompare({ dash, page }: { dash: Dash; page: 'overview' | 'reliability' }) {
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

  const model = useMemo(
    () => (open && ready && pair && dash.startup ? monthCompareModel(rows, dash.startup, dash.filters, pair) : null),
    [open, ready, pair?.a, pair?.b, rows, dash.startup, dash.filters], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const choose = (patch: Partial<MonthPair>) => {
    if (!pair) return;
    const next = { ...pair, ...patch };
    setSp((cur) => { const n = new URLSearchParams(cur); n.set(MONTH_PAIR_PARAM, monthPairText(next)); return n; }, { replace: true });
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
  const series = (pick: (k: NonNullable<(typeof areas)[number]['a']>) => number, fmt: (n: number) => string, unit: string): CartSeries[] => [
    { key: 'a', label: `${t('Month A')}: ${la}`, color: seriesColor(dark, 0), type: 'bar', values: areas.map((a) => (a.a ? pick(a.a) : null)), format: (n) => `${fmt(n)}${unit}` },
    { key: 'b', label: `${t('Month B')}: ${lb}`, color: seriesColor(dark, 1), type: 'bar', values: areas.map((a) => (a.b ? pick(a.b) : null)), format: (n) => `${fmt(n)}${unit}`, hatch: true },
  ];
  const hoursSeries = series((k) => k.downtimeHours, fh, ' h');
  const countSeries = series((k) => k.failureCount, fint, '');
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

  const toggle = (
    <button type="button" className="more-head" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((x) => !x)} data-testid={`${id}-toggle`}>
      <span>{t('Month vs month')} {pair && <small>{la} {t('and')} {lb}</small>}</span>
      <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
    </button>
  );

  return (
    <section className="more-figures" data-testid={id} data-open={open ? 'yes' : 'no'}>
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
                    {options.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`${id}-b`}>{t('Month B')}</label>
                  <select id={`${id}-b`} className="select" value={pair.b} onChange={(e) => choose({ b: e.target.value })} data-testid={`${id}-b`}>
                    {options.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
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
                      title={t('Stoppage hours by area')} subtitle={t('Month A (solid) against month B (striped), hours stopped per area')} testid="chart-mvm-hours"
                      summary={sumOf(hoursSeries, fh, ' h')} legend={legend} table={tableOf(hoursSeries, fh, 1)}
                    >
                      {(w) => <CartesianChart categories={cats} series={hoursSeries} width={w} ariaLabel={t('Grouped bars of stoppage hours by area, month A against month B. {s}', { s: sumOf(hoursSeries, fh, ' h') })} yFormat={(n) => `${n}`} rotateLabels maxBarWidth={18} />}
                    </ChartCard>
                    <ChartCard
                      title={t('Failure count by area')} subtitle={t('Month A (solid) against month B (striped), failures per area')} testid="chart-mvm-count"
                      summary={sumOf(countSeries, fint, '')} legend={legend} table={tableOf(countSeries, fint, 0)}
                    >
                      {(w) => <CartesianChart categories={cats} series={countSeries} width={w} ariaLabel={t('Grouped bars of failure count by area, month A against month B. {s}', { s: sumOf(countSeries, fint, '') })} yFormat={(n) => `${n}`} rotateLabels maxBarWidth={18} />}
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
