// Data quality: the month-by-month scorecard (Validate page) and the compact card on the Dashboard.
import { monthText } from '../util/dates';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { hours, num } from '../util/format';
import { useValidationOptional } from './ValidationContext';
import { buildScorecard, showQualityCard, type MonthQuality } from './scorecard';
import './validate.css';

export const qualityMonth = (key: string): string => monthText(key);
const pct1 = (n: number): string => `${(Math.round(n * 10) / 10).toFixed(1)}%`;

/** Share of clean records as a bar and as text (the text carries the value; the bar only helps the eye). */
function CleanBar({ q }: { q: MonthQuality }) {
  if (q.cleanPct === null) return <span className="muted">–</span>;
  const label = t('{p} clean', { p: pct1(q.cleanPct) });
  return (
    <span className="q-clean">
      <span className="q-bar" role="img" aria-label={label} title={label}><span style={{ width: `${Math.max(0, Math.min(100, q.cleanPct))}%` }} /></span>
      <b data-testid="q-clean">{pct1(q.cleanPct)}</b>
    </span>
  );
}

/** "Data quality by month": one row per month, a link to the Validate list for that month. */
export function QualityTable({ onPickMonth }: { onPickMonth?: (month: string) => void }) {
  const v = useValidationOptional();
  const mobile = useIsMobile();
  const sc = useMemo(() => (v && v.ready ? buildScorecard(v.rows, v.list) : null), [v]);
  if (!sc || sc.months.length === 0) return null;
  const rowLink = (m: string, label: string) => (
    <Link to={`/validate?month=${m}`} className="row-link" onClick={() => onPickMonth?.(m)} data-testid="q-link" aria-label={t('Show the records of {m} that need checking', { m: qualityMonth(m) })}>{label}</Link>
  );
  const all = sc.total;
  const hrs = (h: number): string => (h > 0 && h < 0.05 ? '<0.1' : hours(h * 3600));
  const list = (
    <ul className="q-list" data-testid="quality-list">
      {sc.months.map((q) => (
        <li key={q.month} className="q-item" data-testid="quality-row" data-month={q.month}>
          <div className="q-item-top">
            {rowLink(q.month, qualityMonth(q.month))}
            <span className="q-item-open"><b data-testid="q-open">{num(q.openProblems)}</b> {t('to check')}</span>
          </div>
          <CleanBar q={q} />
          <div className="muted q-sub">
            {t('{n} records', { n: num(q.records) })} · {t('{n} left out ({h} h)', { n: num(q.leftOut.count), h: hrs(q.leftOut.hours) })} · {t('{n} kept as entered', { n: num(q.keptAsEntered) })}
          </div>
        </li>
      ))}
      <li className="q-item q-item--total" data-testid="quality-total">
        <div className="q-item-top"><b>{t('All months')}</b><span className="q-item-open"><b>{num(all.openProblems)}</b> {t('to check')}</span></div>
        <CleanBar q={all} />
        <div className="muted q-sub">{t('{n} records', { n: num(all.records) })} · {t('{n} left out ({h} h)', { n: num(all.leftOut.count), h: hrs(all.leftOut.hours) })} · {t('{n} kept as entered', { n: num(all.keptAsEntered) })}</div>
      </li>
    </ul>
  );
  const body = mobile ? list : (
    <div className="table-wrap" data-testid="quality-table-wrap">
      <table className="data-table" data-testid="quality-table">
        <caption className="sr-only">{t('Data quality by month')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('Month')}</th><th scope="col" className="num">{t('Records')}</th><th scope="col" className="num">{t('To check')}</th>
            <th scope="col" className="num">{t('Left out of the numbers')}</th><th scope="col" className="num">{t('Kept as entered')}</th><th scope="col">{t('Clean')}</th>
          </tr>
        </thead>
        <tbody>
          {sc.months.map((q) => (
            <tr key={q.month} data-testid="quality-row" data-month={q.month}>
              <th scope="row">
                {rowLink(q.month, qualityMonth(q.month))}
              </th>
              <td className="num" data-testid="q-records">{num(q.records)}</td>
              <td className="num" data-testid="q-open">{num(q.openProblems)}</td>
              <td className="num" data-testid="q-leftout">{num(q.leftOut.count)} <span className="muted">({hrs(q.leftOut.hours)} h)</span></td>
              <td className="num" data-testid="q-kept">{num(q.keptAsEntered)}</td>
              <td><CleanBar q={q} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-testid="quality-total">
            <th scope="row">{t('All months')}</th>
            <td className="num">{num(all.records)}</td>
            <td className="num">{num(all.openProblems)}</td>
            <td className="num">{num(all.leftOut.count)} <span className="muted">({hrs(all.leftOut.hours)} h)</span></td>
            <td className="num">{num(all.keptAsEntered)}</td>
            <td><CleanBar q={all} /></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
  const intro = <p className="v-hint" style={{ marginTop: 0 }}>{t('Clean means no open problem. A record kept as entered counts as clean. Records with a blocking problem stay out of the numbers even when kept as entered. Choose a month to see its records.')}</p>;
  // collapsed by default: the summary line says how clean the data is; the month table opens under it
  return (
    <section className={mobile ? 'q-card' : 'card q-card q-card--line'} aria-labelledby="q-title" data-testid="quality-card">
      <details className="v-help q-details" data-testid="quality-details">
        <summary id="q-title">
          <b>{t('Data quality by month')}</b>
          <small data-testid="quality-summary">
            {[
              all.cleanPct === null ? '' : t('{p} clean', { p: pct1(all.cleanPct) }),
              t('{n} to check', { n: num(all.openProblems) }),
              t('{n} left out ({h} h)', { n: num(all.leftOut.count), h: hrs(all.leftOut.hours) }),
              sc.months.length === 1 ? t('1 month') : t('{n} months', { n: sc.months.length }),
            ].filter(Boolean).join(' · ')}
          </small>
        </summary>
        {intro}
        {body}
      </details>
    </section>
  );
}

/** Dashboard: "Data quality: 97.3% clean, 114 to check" with a link to Validate. Only for a person who can open Validate, and only while something is open. */
export function QualityCard() {
  const v = useValidationOptional();
  const { canView } = useAuth();
  const navigate = useNavigate();
  const sc = useMemo(() => (v && v.ready ? buildScorecard(v.rows, v.list) : null), [v]);
  if (!sc || !v) return null;
  const toCheck = v.list.summary.total;
  if (!showQualityCard(canView('events'), sc, toCheck) || sc.total.cleanPct === null) return null;
  return (
    <section className="q-mini" data-testid="quality-mini">
      <Icon name="compliance" size={16} />
      <span className="q-mini-text" data-testid="quality-mini-text">
        <b>{t('Data quality')}:</b> {t('{p} clean, {n} to check', { p: pct1(sc.total.cleanPct), n: num(toCheck) })}
      </span>
      <a href="#/validate" className="q-mini-link" data-testid="quality-mini-open" onClick={(e) => { e.preventDefault(); navigate('/validate'); }}>{t('Open Validate')}</a>
    </section>
  );
}
