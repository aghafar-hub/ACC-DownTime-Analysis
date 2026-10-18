import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { plantCoverage } from '../data/coverage';
import { coverageSegments, coverageText } from '../dashboard/scopeOptions';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { dayText, monthText, tsText } from '../util/dates';
import { num } from '../util/format';
import { useValidationOptional } from '../validate/ValidationContext';
import { inactiveAreas } from '../data/activeAreas';
import './DataStatusStrip.css';

// The data status strip under the scope bar (Analyze pages and Event records): what the data covers over every year,
// the months inside it with no record at all ("Sep 2026 not uploaded yet", information only: they never count as 0 h
// or 100 %), the records waiting in Validate (for people who can open it) and when records were last added.
// Phone: one line, "Data to 31 Aug · 70 to check ›".
export default function DataStatusStrip() {
  const v = useValidationOptional();
  const { canView } = useAuth();
  const mobile = useIsMobile();
  const rows = v?.ready ? v.rows : null;
  const facts = useMemo(() => {
    if (!rows) return null;
    const { coverage, gaps } = plantCoverage(rows);
    let added = '';
    for (const r of rows) if (r.created_at && r.created_at > added) added = r.created_at;
    return { coverage, gaps, segments: coverageSegments(coverage, gaps), added };
  }, [rows]);
  const off = inactiveAreas(v?.st.startup);
  if (!v || !v.enabled) return null;
  // areas switched off (Settings > Areas): their records are left out of every number, so say so where the numbers are
  const offNote = off.length > 0 && (
    <span className="ds-gap" data-testid="data-status-inactive"
      title={t('Switched off by an Admin (Settings > Areas): the records of these areas are left out of every number, chart, list and alert. They stay stored and come back when the area is switched on again.')}>
      {t('{a} inactive', { a: off.map((a) => a.area_id).join(', ') })}
    </span>
  );
  const offPart = offNote && <><span className="ds-sep" aria-hidden="true">·</span>{offNote}</>;
  // the latest year counts first; older years follow in the background
  const toCheck = v.earlyReady ? v.early.summary.total : 0;
  const canCheck = canView('events') && toCheck > 0;
  const checkLink = canCheck && (
    <Link to="/validate" className="ds-check" data-testid="data-status-check" data-partial={v.checkingOlder || undefined}>
      {mobile ? t('{n} to check', { n: num(toCheck) }) : t('{n} records to check', { n: num(toCheck) })}
      {v.checkingOlder && <span className="ds-muted" data-testid="data-status-checking-older"> ({t('checking older years…')})</span>}
      {' '}<span aria-hidden="true">›</span>
    </Link>
  );

  if (!facts) {
    return <div className="ds-strip" role="status" data-testid="data-status"><Icon name="database" size={15} /><span className="ds-muted">{t('Checking what the data covers…')}</span></div>;
  }
  if (!facts.coverage) {
    return <div className="ds-strip" role="status" data-testid="data-status"><Icon name="database" size={15} /><span>{t('No records uploaded yet.')}</span></div>;
  }
  if (mobile) {
    return (
      <div className="ds-strip ds-strip--phone" role="status" data-testid="data-status">
        <Icon name="database" size={15} />
        <span data-testid="data-status-covers">{t('Data to')} <b>{dayText(facts.coverage.to)}</b></span>
        {facts.gaps.length > 0 && <span className="ds-sep" aria-hidden="true">·</span>}
        {facts.gaps.length > 0 && <span className="ds-gap" data-testid="data-status-not-uploaded">{t('{m} not uploaded', { m: facts.gaps.map(monthText).join(', ') })}</span>}
        {checkLink && <span className="ds-sep" aria-hidden="true">·</span>}
        {checkLink}
        {offPart}
      </div>
    );
  }
  return (
    <div className="ds-strip" role="status" data-testid="data-status">
      <Icon name="database" size={15} />
      <span data-testid="fb-coverage">{t('Data covers')} <b data-testid="data-status-covers">{coverageText(facts.segments)}</b></span>
      {facts.gaps.length > 0 && (
        <>
          <span className="ds-sep" aria-hidden="true">·</span>
          <span className="ds-gap" data-testid="data-status-not-uploaded" title={t('These months have no records at all. They are left out of the numbers, never shown as 0 h or 100%.')}>
            <Icon name="calendar" size={14} /> {t('{m} not uploaded yet', { m: facts.gaps.map(monthText).join(', ') })}
          </span>
        </>
      )}
      {checkLink && <span className="ds-sep" aria-hidden="true">·</span>}
      {checkLink}
      {offPart}
      {facts.added && <span className="ds-upload" data-testid="data-status-upload">{t('Last upload {d}', { d: tsText(facts.added) })}</span>}
    </div>
  );
}
