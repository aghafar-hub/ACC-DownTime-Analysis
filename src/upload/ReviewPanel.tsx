import { useState } from 'react';
import type { DiffUploadRow } from '../calc';
import { PAGE_SIZE, ShowMore } from '../components/PhoneParts';
import { t, tn } from '../i18n/t';
import { num } from '../util/format';
import {
  checkGroups, undecidedCount, type CheckGroup, type Decision, type Decisions, type Review,
} from './review';
import { fieldName, warningHelp, warningLabel, warningSymbol, warningTone } from './warningText';
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
  const [lateShown, setLateShown] = useState(PAGE_SIZE);
  const [changedShown, setChangedShown] = useState(10);
  const groups = checkGroups(review, decisions);
  const lateChecks = new Map(review.late.map((l) => [l.fingerprint, l.warnings.length]));
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
          <Count n={c.late} label={t('Late entries')} hint={t('you choose')} tone="warning" testid="count-late" />
          <Count n={c.changed} label={t('Differ from stored')} hint={t('stored kept')} tone="warning" testid="count-changed" />
          <Count n={c.missing} label={t('Missing from file')} hint={t('information')} tone="info" testid="count-missing" />
          <Count n={c.rejected} label={t('Left out')} hint={t('cannot be uploaded')} tone="danger" testid="count-rejected" />
        </div>
      </section>

      {review.late.length > 0 && (
        <section className="card" aria-label={t('Late entries')} data-testid="late-section">
          <div className="up-head">
            <h2>{warningLabel('late_row')}</h2>
            <div className="chip-row">
              <button type="button" className="btn btn-sm" onClick={() => onDecideAll('add')} data-testid="add-all">{t('Add all')}</button>
              <button type="button" className="btn btn-sm" onClick={() => onDecideAll('skip')} data-testid="skip-all">{t('Skip all')}</button>
            </div>
          </div>
          <p className="adm-note">{warningHelp('late_row')}</p>
          <p className={open ? 'up-decided up-decided--open' : 'up-decided'} data-testid="late-progress" role="status">
            {open
              ? <><span aria-hidden="true">▲ </span>{t('{done} of {total} decided. {open} still to choose.', { done: review.late.length - open, total: review.late.length, open })}</>
              : <><span aria-hidden="true">✓ </span>{t('All {n} late entries decided.', { n: review.late.length })}</>}
          </p>
          <ul className="up-list up-list--rows">
            {review.late.slice(0, lateShown).map((l) => (
              <LateRowItem key={l.fingerprint} row={l.row} checks={lateChecks.get(l.fingerprint) ?? 0} decision={decisions[l.fingerprint]} onDecide={(d) => onDecide(l.fingerprint, d)} />
            ))}
          </ul>
          <ShowMore shown={Math.min(lateShown, review.late.length)} total={review.late.length} onMore={() => setLateShown((n) => n + PAGE_SIZE)} testid="late-more" />
        </section>
      )}

      {groups.length > 0 && (
        <section className="card" aria-label={t('Data checks')} data-testid="checks-section">
          <h2>{t('Data checks on rows that will be added')}</h2>
          <p className="adm-note">{t('These rows are added and flagged in Event Explorer. Nothing is blocked. Download the list to fix the workbook itself.')}</p>
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

      {(review.edited.length > 0 || review.missing.length > 0 || review.parsed.caseFixes.length > 0) && (
        <section className="card" aria-label={t('For your information')} data-testid="info-section">
          <h2><span aria-hidden="true">● </span>{t('For your information')}</h2>
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
          {review.parsed.caseFixes.length > 0 && (
            <details className="up-group" data-testid="info-case">
              <summary><span className="badge badge--info"><span aria-hidden="true">●</span> {review.parsed.caseFixes.length}</span><span className="up-group-title">{t('Classification written in other letters')}</span></summary>
              <p className="adm-note">{t('For example "Aut" is read as "AUT". Nothing to do.')}</p>
            </details>
          )}
        </section>
      )}

      {review.rejects.length > 0 && (
        <section className="card" aria-label={t('Rows left out')} data-testid="rejects-section">
          <h2><span aria-hidden="true">◆ </span>{t('Rows left out')}</h2>
          <p className="adm-note">{t('These rows cannot be uploaded and are not sent. Fix them in the workbook and upload it again.')}</p>
          <ul className="up-list">
            {review.rejects.slice(0, 50).map((r) => <li key={r.source_row} data-testid="reject-row"><b className="mono">{t('Row {n}', { n: r.source_row })}</b> <span className="adm-wrap">{r.reason}</span></li>)}
          </ul>
          {review.rejects.length > 50 && <p className="adm-muted-sm">{t('and {n} more (they are in the downloadable list)', { n: review.rejects.length - 50 })}</p>}
        </section>
      )}
    </div>
  );
}
