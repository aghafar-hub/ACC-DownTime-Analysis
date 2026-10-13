import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { DiffUploadRow } from '../calc';
import { PAGE_SIZE, ShowMore } from '../components/PhoneParts';
import { t, tn } from '../i18n/t';
import { num } from '../util/format';
import {
  checkGroups, criticalityItems, criticalityLine, criticalityTitle, flagProblem, flagSummary, flagTitle, monthKey, monthLabel, undecidedCount,
  type CheckGroup, type Decision, type Decisions, type FlagCount, type Review,
} from './review';
import { fieldName, INFO_CHECK_TYPES, OTHER_CHECK_TYPES, warningHelp, warningLabel, warningSymbol, warningTone } from './warningText';
import './upload.css';

const shortTime = (ts: string): string => ts.slice(0, 16);

function Count({ n, label, hint, tone, testid }: { n: number; label: string; hint?: string; tone?: 'warning' | 'info' | 'danger' | 'success'; testid: string }) {
  const symbol = tone === 'warning' ? '▲' : tone === 'danger' ? '◆' : tone === 'success' ? '●' : tone === 'info' ? '●' : '';
  return (
    <div className={`up-count${tone && n > 0 ? ` up-count--${tone}` : ''}`} data-testid={testid}>
      <span className="up-count-n">{symbol && n > 0 && <span aria-hidden="true">{symbol} </span>}{num(n)}</span>
      <span className="up-count-label">{label}</span>
      {hint && <span className="up-count-hint">{hint}</span>}
    </div>
  );
}

function LateRowItem({ row, checks, decision, onDecide }: { row: DiffUploadRow; checks: number; decision?: Decision; onDecide: (d: Decision) => void }) {
  return (
    <li className="up-late" data-testid="late-row" data-row={row.source_row} data-decision={decision ?? 'none'}>
      <div className="up-late-info">
        <div className="up-late-top">
          <b className="mono">{t('Row {n}', { n: row.source_row })}</b>
          <span className="mono">{row.area_id} · {row.code_raw}</span>
          <span className="badge badge--class">{row.classification}</span>
          {checks > 0 && <span className="badge badge--warning"><span aria-hidden="true">▲</span> {tn(checks, '{n} data check', '{n} data checks')}</span>}
        </div>
        <div className="up-late-line mono">{shortTime(row.stop_ts)} → {shortTime(row.start_ts)}</div>
        <div className="up-late-line">{row.reason_raw || t('(blank reason)')}</div>
      </div>
      <div className="chip-row up-late-choice" role="group" aria-label={t('Row {n}: add or skip', { n: row.source_row })}>
        <button type="button" className={decision === 'add' ? 'chip chip--on' : 'chip'} aria-pressed={decision === 'add'} onClick={() => onDecide('add')} data-testid="late-add">
          <span aria-hidden="true">✓</span> {t('Add')}
        </button>
        <button type="button" className={decision === 'skip' ? 'chip chip--on' : 'chip'} aria-pressed={decision === 'skip'} onClick={() => onDecide('skip')} data-testid="late-skip">
          <span aria-hidden="true">✕</span> {t('Skip')}
        </button>
      </div>
    </li>
  );
}

function LateMonthCard({ month, rows, hours, decision, onDecide }: {
  month: string; rows: number; hours: number; decision?: Decision; onDecide: (d: Decision) => void;
}) {
  const label = monthLabel(month);
  return (
    <li className="up-late" data-testid="late-month" data-month={month} data-decision={decision ?? 'none'}>
      <div className="up-late-info">
        <div className="up-late-top"><b>{label}</b></div>
        <div className="up-late-line">{t('{label}: {rows} rows, {hours} hours, not stored yet', { label, rows: num(rows), hours: num(Math.round(hours * 10) / 10) })}</div>
      </div>
      <div className="chip-row up-late-choice" role="group" aria-label={t('{label}: add or skip the month', { label })}>
        <button type="button" className={decision === 'add' ? 'chip chip--on' : 'chip'} aria-pressed={decision === 'add'} onClick={() => onDecide('add')} data-testid="month-add">
          <span aria-hidden="true">✓</span> {t('Add month')}
        </button>
        <button type="button" className={decision === 'skip' ? 'chip chip--on' : 'chip'} aria-pressed={decision === 'skip'} onClick={() => onDecide('skip')} data-testid="month-skip">
          <span aria-hidden="true">✕</span> {t('Skip month')}
        </button>
      </div>
    </li>
  );
}

function FlagBlock({ f }: { f: FlagCount }) {
  const [all, setAll] = useState(false);
  const shown = all ? f.rows : f.rows.slice(0, 12);
  return (
    <details className="up-group" data-testid={`flag-${f.flag}`} data-blocking={f.blocking ? 'yes' : 'no'}>
      <summary>
        <span className={`badge badge--${f.blocking ? 'danger' : 'warning'}`}><span aria-hidden="true">{f.blocking ? '◆' : '▲'}</span> {num(f.count)}</span>
        <span className="up-group-title">{flagTitle(f.flag)}</span>
        {f.blocking && <span className="adm-muted-sm"> {t('left out of the numbers until fixed')}</span>}
      </summary>
      <p className="adm-note">{flagProblem(f.flag)}</p>
      <p className="adm-muted-sm">{t('Sheet rows')}: <span className="mono">{shown.join(', ')}{!all && f.rows.length > shown.length ? ', …' : ''}</span></p>
      {!all && f.rows.length > shown.length && (
        <button type="button" className="btn btn-sm" onClick={() => setAll(true)}>{t('Show all {n}', { n: f.rows.length })}</button>
      )}
    </details>
  );
}

function CheckBlock({ g }: { g: CheckGroup }) {
  const [all, setAll] = useState(false);
  const shown = all ? g.items : g.items.slice(0, 8);
  const tone = warningTone(g.type);
  return (
    <details className="up-group" data-testid={`check-${g.type}`}>
      <summary>
        <span className={`badge badge--${tone}`}><span aria-hidden="true">{warningSymbol(g.type)}</span> {g.items.length}</span>
        <span className="up-group-title">{warningLabel(g.type)}</span>
      </summary>
      <p className="adm-note">{warningHelp(g.type)}</p>
      <ul className="up-list">
        {shown.map((it, i) => (
          <li key={`${it.source_row}-${i}`}><b className="mono">{t('Row {n}', { n: it.source_row ?? '?' })}</b> <span className="adm-wrap">{it.detail}</span></li>
        ))}
      </ul>
      {!all && g.items.length > shown.length && (
        <button type="button" className="btn btn-sm" onClick={() => setAll(true)}>{t('Show all {n}', { n: g.items.length })}</button>
      )}
    </details>
  );
}

/** What the file would do, before anything is sent. */
export default function ReviewPanel({ review, decisions, onDecide, onDecideAll }: {
  review: Review; decisions: Decisions; onDecide: (fp: string, d: Decision) => void; onDecideAll: (d: Decision) => void;
}) {
  const c = review.counts;
  const open = undecidedCount(review, decisions);
  const totalLate = review.late.length + review.lateMonths.length;
  const [lateShown, setLateShown] = useState(PAGE_SIZE);
  const [changedShown, setChangedShown] = useState(10);
  const critItems = criticalityItems(review, decisions);
  const critConflicts = critItems.filter((i) => i.conflict).length;
  const groups = checkGroups(review, decisions, OTHER_CHECK_TYPES);
  const flags = flagSummary(review, decisions);
  const infoGroups = checkGroups(review, decisions, INFO_CHECK_TYPES);
  const lateChecks = new Map(review.late.map((l) => [l.fingerprint, l.warnings.filter((w) => !INFO_CHECK_TYPES.includes(w.type)).length]));
  return (
    <div data-testid="review">
      <section className="card" aria-label={t('What the file contains')}>
        <h2>{t('What the file contains')}</h2>
        <p className="adm-note">
          {t('{rows} rows with data, dated {from} to {to}.', { rows: num(c.rowsRead), from: review.parsed.dateFrom || '-', to: review.parsed.dateTo || '-' })}{' '}
          {t('Nothing has been saved yet. Rows already stored are never changed by an upload.')}
        </p>
        <div className="up-counts">
          <Count n={c.rowsRead} label={t('Rows read')} testid="count-read" />
          <Count n={c.identical} label={t('Already stored')} hint={t('skipped')} tone="success" testid="count-identical" />
          <Count n={c.new} label={t('New')} hint={t('will be added')} tone="info" testid="count-new" />
          <Count n={c.lateMonths} label={t('Late months')} hint={t('{n} rows, you choose', { n: num(c.lateMonthRows) })} tone="warning" testid="count-late-months" />
          <Count n={c.late} label={t('Late entries')} hint={t('you choose')} tone="warning" testid="count-late" />
          <Count n={c.changed} label={t('Differ from stored')} hint={t('stored kept')} tone="warning" testid="count-changed" />
          <Count n={c.missing} label={t('Missing from file')} hint={t('information')} tone="info" testid="count-missing" />
        </div>
      </section>

      {(review.late.length > 0 || review.lateMonths.length > 0) && (
        <section className="card" aria-label={t('Late entries')} data-testid="late-section">
          <div className="up-head">
            <h2>{review.lateMonths.length > 0 ? t('Late months and entries') : warningLabel('late_row')}</h2>
            <div className="chip-row">
              <button type="button" className="btn btn-sm" onClick={() => onDecideAll('add')} data-testid="add-all">{t('Add all')}</button>
              <button type="button" className="btn btn-sm" onClick={() => onDecideAll('skip')} data-testid="skip-all">{t('Skip all')}</button>
            </div>
          </div>
          <p className="adm-note">{review.lateMonths.length > 0 ? warningHelp('late_month') : ''} {review.late.length > 0 ? warningHelp('late_row') : ''}</p>
          <p className={open ? 'up-decided up-decided--open' : 'up-decided'} data-testid="late-progress" role="status">
            {open
              ? <><span aria-hidden="true">▲ </span>{t('{done} of {total} decided. {open} still to choose.', { done: totalLate - open, total: totalLate, open })}</>
              : <><span aria-hidden="true">✓ </span>{t('All {n} late decisions made.', { n: totalLate })}</>}
          </p>
          {review.lateMonths.length > 0 && (
            <ul className="up-list up-list--rows" data-testid="late-months">
              {review.lateMonths.map((m) => (
                <LateMonthCard key={m.month} month={m.month} rows={m.rows} hours={m.hours} decision={decisions[monthKey(m.month)]} onDecide={(d) => onDecide(monthKey(m.month), d)} />
              ))}
            </ul>
          )}
          {review.late.length > 0 && review.lateMonths.length > 0 && <h3 className="up-sub">{t('Single late rows in months that already have stored rows')}</h3>}
          <ul className="up-list up-list--rows">
            {review.late.slice(0, lateShown).map((l) => (
              <LateRowItem key={l.fingerprint} row={l.row} checks={lateChecks.get(l.fingerprint) ?? 0} decision={decisions[l.fingerprint]} onDecide={(d) => onDecide(l.fingerprint, d)} />
            ))}
          </ul>
          <ShowMore shown={Math.min(lateShown, review.late.length)} total={review.late.length} onMore={() => setLateShown((n) => n + PAGE_SIZE)} testid="late-more" />
        </section>
      )}

      <section className="card" aria-label={t('Records that will need checking')} data-testid="flags-section">
        <h2>{t('Records that will need checking')}</h2>
        <p className="adm-note" data-testid="nothing-dropped">
          {t('Nothing is dropped: every row is stored. These records wait on the Validate page.')}
        </p>
        <div className="chip-row" style={{ marginBottom: 10 }}>
          <Link className="btn" to="/validate" data-testid="open-validate">{t('Open the Validate page')}</Link>
        </div>
        {flags.total === 0 ? (
          <p className="up-decided" data-testid="flags-none"><span aria-hidden="true">✓ </span>{t('No record has a data problem.')}</p>
        ) : (
          <>
            <p className="adm-note" data-testid="flags-total">
              {tn(flags.total, '{n} record will need checking', '{n} records will need checking')}
              {flags.blockedRows > 0 && <>{': '}<b>{tn(flags.blockedRows, '{n} is left out of the numbers until fixed', '{n} are left out of the numbers until fixed')}</b></>}
              {flags.warningRows > 0 && <>{flags.blockedRows > 0 ? ', ' : ': '}{tn(flags.warningRows, '{n} has warnings only', '{n} have warnings only')}</>}.
            </p>
            {flags.flags.map((f) => <FlagBlock key={f.flag} f={f} />)}
          </>
        )}
      </section>

      {groups.length > 0 && (
        <section className="card" aria-label={t('Data checks')} data-testid="checks-section">
          <h2>{t('Other checks on rows that will be added')}</h2>
          <p className="adm-note">{t('These rows are added and flagged. Nothing is blocked. Download the list to fix the workbook itself.')}</p>
          {groups.map((g) => <CheckBlock key={g.type} g={g} />)}
        </section>
      )}

      {review.changed.length > 0 && (
        <section className="card" aria-label={t('Rows that differ')} data-testid="changed-section">
          <h2><span aria-hidden="true">▲ </span>{warningLabel('changed_row')}</h2>
          <p className="adm-note">{warningHelp('changed_row')}</p>
          <ul className="up-list">
            {review.changed.slice(0, changedShown).map((r) => (
              <li key={r.fingerprint} data-testid="changed-row">
                <b className="mono">{t('Row {n}', { n: r.source_row })}</b> <span className="adm-muted-sm">{r.storedEventId}</span>
                <table className="up-diff">
                  <thead><tr><th scope="col">{t('Field')}</th><th scope="col">{t('Stored')}</th><th scope="col">{t('In the file')}</th></tr></thead>
                  <tbody>
                    {r.changes.map((ch) => (
                      <tr key={ch.field}><th scope="row">{fieldName(ch.field)}</th><td>{ch.stored || t('(blank)')}</td><td>{ch.uploaded || t('(blank)')}</td></tr>
                    ))}
                  </tbody>
                </table>
              </li>
            ))}
          </ul>
          <ShowMore shown={Math.min(changedShown, review.changed.length)} total={review.changed.length} onMore={() => setChangedShown((n) => n + 10)} testid="changed-more" />
        </section>
      )}

      {(infoGroups.length > 0 || review.edited.length > 0 || review.missing.length > 0 || review.parsed.caseFixes.length > 0 || critItems.length > 0) && (
        <section className="card" aria-label={t('Information')} data-testid="info-section">
          <h2><span aria-hidden="true">● </span>{t('Information')}</h2>
          <p className="adm-note">{t('Nothing here needs a decision or a fix, and nothing blocks Add.')}</p>
          {infoGroups.map((g) => <CheckBlock key={g.type} g={g} />)}
          {review.edited.length > 0 && (
            <details className="up-group" data-testid="info-edited">
              <summary><span className="badge badge--info"><span aria-hidden="true">●</span> {review.edited.length}</span><span className="up-group-title">{warningLabel('edited_in_app')}</span></summary>
              <p className="adm-note">{warningHelp('edited_in_app')}</p>
              <ul className="up-list">{review.edited.slice(0, 20).map((w, i) => <li key={i}><b className="mono">{t('Row {n}', { n: w.source_row ?? '?' })}</b> <span className="adm-wrap">{w.detail}</span></li>)}</ul>
            </details>
          )}
          {review.missing.length > 0 && (
            <details className="up-group" data-testid="info-missing">
              <summary><span className="badge badge--info"><span aria-hidden="true">●</span> {review.missing.length}</span><span className="up-group-title">{warningLabel('missing_row')}</span></summary>
              <p className="adm-note">{warningHelp('missing_row')}</p>
              <ul className="up-list">{review.missing.slice(0, 20).map((w, i) => <li key={i}><span className="adm-wrap">{w.detail}</span></li>)}</ul>
              {review.missing.length > 20 && <p className="adm-muted-sm">{t('and {n} more (they are in the downloadable list)', { n: review.missing.length - 20 })}</p>}
            </details>
          )}
          {critItems.length > 0 && (
            <details className="up-group" data-testid="info-criticality">
              <summary>
                <span className="badge badge--info"><span aria-hidden="true">●</span> {critItems.length}</span>
                <span className="up-group-title">{criticalityTitle(critItems)}</span>
                {critConflicts > 0 && <span className="adm-muted-sm"> {t('{n} to check', { n: critConflicts })}</span>}
              </summary>
              <p className="adm-note">{t('The text is read as INC or NO_INC and the row is added. The workbook is not changed. Rows tagged "Check this row" disagree with the sheet rule (CIR and PL are NO_INC, any other classification is INC).')}</p>
              <ul className="up-list">
                {critItems.slice(0, 50).map((i) => (
                  <li key={i.source_row} data-testid="info-criticality-row" data-conflict={i.conflict ? 'yes' : 'no'}>
                    <b className="mono">{t('Row {n}', { n: i.source_row })}</b>{' '}
                    <span className="adm-wrap">{criticalityLine({ ...i, conflict: false })}</span>
                    {i.conflict && <> <span className="badge badge--warning"><span aria-hidden="true">▲</span> {t('Check this row')}</span></>}
                  </li>
                ))}
              </ul>
              {critItems.length > 50 && <p className="adm-muted-sm">{t('and {n} more (they are in the downloadable list)', { n: critItems.length - 50 })}</p>}
            </details>
          )}
          {review.parsed.caseFixes.length > 0 && (
            <details className="up-group" data-testid="info-case">
              <summary><span className="badge badge--info"><span aria-hidden="true">●</span> {review.parsed.caseFixes.length}</span><span className="up-group-title">{t('Classification written in other letters')}</span></summary>
              <p className="adm-note">{t('For example "Aut" is read as "AUT". Nothing to do.')}</p>
            </details>
          )}
        </section>
      )}

    </div>
  );
}
