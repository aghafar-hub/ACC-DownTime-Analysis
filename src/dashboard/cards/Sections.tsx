// The compact sections under the Dashboard cards: data quality (the scorecard folded into one line) and the areas
// table (top 5 by stopped hours, Show all). Month vs month is MonthCompare in its compact form.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { FLAG_INFO, type EventFlag } from '../../calc';
import { useIsMobile } from '../../hooks/useIsMobile';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { num } from '../../util/format';
import { QualityTable } from '../../validate/Quality';
import { buildScorecard, showQualityCard } from '../../validate/scorecard';
import { useValidationOptional } from '../../validate/ValidationContext';
import { fh, fh2, fint, metricText } from '../format';
import { areaName, idsWithHoursByArea, scopeText } from '../dashModels';
import type { DashFilters } from '../filters';
import type { DashCtx } from '../scope';
import { getTargets, targetsOfArea, targetStatus } from '../targets';
import { useAreaTargetMap } from '../useAreaTargetMap';
import { OpenLink, type OpenFn } from './DashCard';

const pct1 = (n: number): string => `${(Math.round(n * 10) / 10).toFixed(1)}%`;

/** 'Data quality: 98.6% clean, 70 to check' with the three most common problems; expands to the month table. */
export function QualitySection() {
  const v = useValidationOptional();
  const { canView } = useAuth();
  const navigate = useNavigate();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const sc = useMemo(() => (v && v.ready ? buildScorecard(v.rows, v.list) : null), [v]);
  if (!sc || !v) return null;
  const toCheck = v.list.summary.total;
  if (!showQualityCard(canView('events'), sc, toCheck) || sc.total.cleanPct === null) return null;
  const top = Object.entries(v.list.summary.byFlag).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const flagLabel = (f: string) => (FLAG_INFO[f as EventFlag]?.label ?? f).toLowerCase();
  return (
    <section className="card dsec" data-testid="quality-mini" data-open={open ? 'yes' : 'no'}>
      <div className="dsec-row">
        <button type="button" className="dsec-head" aria-expanded={open} aria-controls="dash-quality-body" onClick={() => setOpen((x) => !x)} data-testid="quality-toggle">
          <span className="dsec-chev" aria-hidden="true"><Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} /></span>
          <span className="dsec-text">
            <b className="dsec-title" data-testid="quality-mini-text">{t('Data quality')}: {t('{p} clean, {n} to check', { p: pct1(sc.total.cleanPct), n: num(toCheck) })}</b>
            <span className="dsec-sum">
              {mobile ? <><b className="dsec-warn">{t('{n} to check', { n: num(toCheck) })}</b> · {t('of {n} records', { n: num(sc.total.records) })}</> : t('{n} records', { n: num(sc.total.records) })}
              {!mobile && top.map(([f, n]) => <span key={f}> · <b>{num(n)}</b> {flagLabel(f)}</span>)}
            </span>
          </span>
          {!mobile && <span className="dsec-more" aria-hidden="true">{open ? t('Collapse') : t('Expand')}</span>}
        </button>
        <a href="#/validate" className="btn dsec-btn" data-testid="quality-mini-open" onClick={(e) => { e.preventDefault(); navigate('/validate'); }}>
          {mobile ? t('Review') : t('Review {n}', { n: num(toCheck) })} <span aria-hidden="true">›</span>
        </a>
      </div>
      {open && <div id="dash-quality-body" className="dsec-body"><QualityTable /></div>}
    </section>
  );
}

/** Areas: top 5 by stopped hours (Show all), with failures, availability against the target, MTBF, MTTR and their records. */
export function AreasSection({ ctx, filters, onOpen }: { ctx: DashCtx; filters: DashFilters; onOpen: OpenFn }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const eff = ctx.win.effective!;
  const k = ctx.kpis.current;
  const byArea = useMemo(() => idsWithHoursByArea(ctx, eff), [ctx, eff]);
  const perArea = useAreaTargetMap(ctx);
  if (k.status !== 'ok') return null;
  const targets = getTargets(ctx.master.settings);
  const basis = ctx.master.settings.availabilityBasis;
  const sorted = [...k.areas].sort((a, b) => b.downtimeHours - a.downtimeHours || a.area_id.localeCompare(b.area_id));
  const shown = all ? sorted : sorted.slice(0, 5);
  const max = Math.max(1, ...sorted.map((a) => a.downtimeHours));
  const allIds = [...byArea.values()].flat();
  const sub = `${t('Top {n} of {m} by stopped hours', { n: Math.min(5, sorted.length), m: sorted.length })}${targets.availabilityPct !== null ? ` · ${t('availability target {x}% (basis {b})', { x: targets.availabilityPct, b: basis })}` : ''}`;
  const status = (a: (typeof sorted)[number]) => {
    const m = a.availabilityHeadline;
    const s = m.available ? targetStatus('availability', m.value, targetsOfArea(targets, perArea, a.area_id)) : null;
    if (!s) return null;
    const g = `${Math.abs(s.gap).toFixed(1)} ${t('pt')}`;
    return s.ok
      ? <span className="tchip tchip--ok" data-state="on"><span aria-hidden="true">✔</span> {mobile ? g : t('on target (+{g})', { g })}</span>
      : <span className="tchip tchip--bad" data-state="below"><span aria-hidden="true">▼</span> {mobile ? g : t('below (−{g})', { g })}</span>;
  };
  const showAll = sorted.length > 5 && (
    <button type="button" className="dcard-link" onClick={() => { setAll((v) => !v); setOpen(true); }} aria-expanded={all} data-testid="areas-show-all">
      {all ? t('Top 5') : mobile ? t('All {n}', { n: sorted.length }) : t('Show all {n} areas', { n: sorted.length })} <span aria-hidden="true">›</span>
    </button>
  );
  return (
    <section className="card dsec dsec--areas" data-testid="dash-areas" data-open={open ? 'yes' : 'no'}>
      <div className="dsec-row">
        <button type="button" className="dsec-head" aria-expanded={open} aria-controls="dash-areas-body" onClick={() => setOpen((x) => !x)} data-testid="dash-areas-toggle">
          <span className="dsec-chev" aria-hidden="true"><Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} /></span>
          <span className="dsec-text"><b className="dsec-title">{t('Areas')}</b><span className="dsec-sum">{sub}</span></span>
        </button>
        {showAll}
      </div>
      {open && (
        <div id="dash-areas-body" className="dsec-body">
          {mobile ? (
            <ul className="area-cards">
              {shown.map((a) => {
                const ids = byArea.get(a.area_id) ?? [];
                const n = areaName(ctx, a.area_id);
                return (
                  <li key={a.area_id}>
                    <button type="button" className="area-card" data-testid="dash-area-row" data-count={ids.length} onClick={() => onOpen({ ids, label: t('the area {a}', { a: a.area_id }) })}
                      aria-label={t('{a}: {h} h, {f} failures. Open {n} records', { a: a.area_id, h: fh(a.downtimeHours), f: fint(a.failureCount), n: num(ids.length) })}>
                      <span className="area-card-text">
                        <span><b>{a.area_id}</b>{n && <span className="muted"> {n}</span>}</span>
                        <span><b>{fh(a.downtimeHours)}</b> h · {fint(a.failureCount)} {t('failures')} · <b>{metricText(a.availabilityHeadline, (x) => `${(x * 100).toFixed(1)}%`).text}</b></span>
                      </span>
                      {status(a)}
                      <Icon name="chevronRight" size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="table-wrap">
              <table className="data-table areas-table" data-testid="dash-areas-table">
                <thead>
                  <tr>
                    <th scope="col">{t('Area')}</th><th scope="col" aria-hidden="true" /><th scope="col" className="num">{t('Stopped h')}</th><th scope="col" className="num">{t('Failures')}</th>
                    <th scope="col">{perArea ? t('Availability {b} vs area target', { b: basis }) : targets.availabilityPct !== null ? t('Availability {b} vs target {x}%', { b: basis, x: targets.availabilityPct }) : t('Availability {b}', { b: basis })}</th>
                    <th scope="col" className="num">{t('MTBF')}</th><th scope="col" className="num">{t('MTTR')}</th><th scope="col"><span className="sr-only">{t('Records')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((a) => {
                    const ids = byArea.get(a.area_id) ?? [];
                    const n = areaName(ctx, a.area_id);
                    return (
                      <tr key={a.area_id} data-testid="dash-area-row" data-area={a.area_id}>
                        <th scope="row"><b>{a.area_id}</b>{n && <span className="muted"> {n}</span>}</th>
                        <td className="areas-bar-cell"><span className="areas-bar" style={{ width: `${(a.downtimeHours / max) * 100}%` }} /></td>
                        <td className="num">{fh(a.downtimeHours)}</td>
                        <td className="num">{fint(a.failureCount)}</td>
                        <td><span className="areas-av"><b>{metricText(a.availabilityHeadline, (x) => `${(x * 100).toFixed(1)}%`).text}</b> {status(a)}</span></td>
                        <td className="num">{metricText(a.mtbfHours, fh, ' h').text}</td>
                        <td className="num">{metricText(a.mttrHours, fh2, ' h').text}</td>
                        <td className="num"><OpenLink spec={{ ids, label: t('the area {a}', { a: a.area_id }) }} onOpen={onOpen} testid="dash-area-open" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <footer className="dcard-foot">
            <span className="dcard-scope"><Icon name="calendar" size={14} /> <span>{scopeText(eff, filters, 'all')}</span></span>
            <OpenLink spec={{ ids: allIds, label: t('Areas') }} onOpen={onOpen} />
          </footer>
        </div>
      )}
    </section>
  );
}
