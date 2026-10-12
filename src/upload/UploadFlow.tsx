import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ConfirmDialog from '../admin/ConfirmDialog';
import { t, tn } from '../i18n/t';
import { Icon } from '../icons';
import { num } from '../util/format';
import ReviewPanel from './ReviewPanel';
import { buildPlan, decisionsComplete, downloadText, reviewCsv, undecidedCount } from './review';
import { useUploadFlow } from './useUploadFlow';
import './upload.css';

const ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function FileChooser({ onFile, busy }: { onFile: (f: File) => void; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={over ? 'up-drop up-drop--over' : 'up-drop'}
      data-testid="drop-zone"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f && !busy) onFile(f);
      }}
    >
      <Icon name="upload" size={28} />
      <p><b>{t('Choose the monthly downtime workbook')}</b></p>
      <p>{t('An Excel file (.xlsx) with a sheet called "Downtime". You will see what it contains before anything is saved.')}</p>
      <input
        ref={input} id="up-file" className="up-file" type="file" accept={ACCEPT} data-testid="file-input" aria-label={t('Workbook file')}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
      <button type="button" className="btn-primary" onClick={() => input.current?.click()} disabled={busy} data-testid="choose-file">
        <Icon name="upload" size={15} /> {t('Choose file')}
      </button>
    </div>
  );
}

/** The whole upload, from choosing the file to the result. Needs Edit access to the Upload page. */
export default function UploadFlow({ onDone }: { onDone: () => void }) {
  const f = useUploadFlow(onDone);
  const [confirm, setConfirm] = useState(false);
  const { review } = f;
  const complete = review ? decisionsComplete(review, f.decisions) : false;
  const open = review ? undecidedCount(review, f.decisions) : 0;
  const plan = review && complete ? buildPlan(review, f.decisions) : null;

  if (f.phase === 'reading') {
    return (
      <section className="card" data-testid="upload-reading" aria-live="polite">
        <h2>{f.fileName}</h2>
        <p role="status" data-testid="upload-stage">{f.stage || t('Working…')}</p>
        <div className="up-progress" aria-hidden="true"><span style={{ width: '40%' }} /></div>
      </section>
    );
  }

  if (f.phase === 'sending') {
    const p = f.progress;
    const pct = p && p.totalRows > 0 ? Math.round((p.rowsSent / p.totalRows) * 100) : 0;
    return (
      <section className="card" data-testid="upload-sending" aria-live="polite">
        <h2>{t('Sending {file}', { file: f.fileName })}</h2>
        {!f.stopped ? (
          <>
            <p role="status" data-testid="send-status">
              {p && p.totalRows > 0 ? t('Sent {sent} of {total} rows…', { sent: num(p.rowsSent), total: num(p.totalRows) }) : t('Starting the upload…')}
            </p>
            <div className="up-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('Upload progress')}><span style={{ width: `${pct}%` }} /></div>
            <p className="adm-muted-sm">{t('Keep this page open. If the connection drops the app tries again by itself.')}</p>
          </>
        ) : (
          <>
            <div className="callout callout--danger" role="alert" data-testid="send-error">
              <Icon name="alert" size={16} />
              <span>
                <b>{t('The upload stopped.')}</b> {f.stopped.message}{' '}
                {t('Nothing is lost: rows already sent are safe, and sending again does no harm.')}
              </span>
            </div>
            <div className="chip-row">
              <button type="button" className="btn-primary" onClick={() => void f.send(f.stopped?.progress)} data-testid="send-retry">{t('Try again')}</button>
              <button type="button" className="btn" onClick={f.reset}>{t('Cancel')}</button>
            </div>
          </>
        )}
      </section>
    );
  }

  if (f.phase === 'done' && f.result) {
    const r = f.result;
    const b = r.batch;
    const expected = r.plan.willAdd;
    return (
      <section className="card" data-testid="upload-result">
        <h2><span aria-hidden="true">✓ </span>{b.rows_added > 0 ? t('Upload complete') : t('Upload complete: nothing new to add')}</h2>
        <p className="adm-note" data-testid="result-text">
          {tn(b.rows_added, '{n} new row was added.', '{n} new rows were added.')} {tn(b.rows_identical, '{n} row was already stored.', '{n} rows were already stored.')}
        </p>
        <div className="up-result">
          <div className="up-count" data-testid="result-read"><span className="up-count-n">{num(b.rows_read)}</span><span className="up-count-label">{t('Rows read')}</span></div>
          <div className="up-count up-count--info" data-testid="result-added"><span className="up-count-n">{num(b.rows_added)}</span><span className="up-count-label">{t('Added')}</span></div>
          <div className="up-count up-count--success" data-testid="result-identical"><span className="up-count-n">{num(b.rows_identical)}</span><span className="up-count-label">{t('Already stored')}</span></div>
          <div className="up-count" data-testid="result-skipped"><span className="up-count-n">{num(b.rows_skipped)}</span><span className="up-count-label">{t('Skipped or left out')}</span></div>
          <div className={b.warning_count ? 'up-count up-count--warning' : 'up-count'} data-testid="result-warnings"><span className="up-count-n">{num(b.warning_count)}</span><span className="up-count-label">{t('Warnings recorded')}</span></div>
        </div>
        <p className="up-id">{t('Upload number')}: <span data-testid="result-batch">{b.batch_id}</span></p>
        {b.rows_added !== expected && (
          <div className="callout callout--warning" role="status" data-testid="result-mismatch"><Icon name="info" size={16} /><span>{t('The review expected {a} new rows but the server added {b}. Another upload may have run at the same time. Check Event Explorer.', { a: expected, b: b.rows_added })}</span></div>
        )}
        {r.plan.flagged.total > 0 && (
          <div className="callout callout--warning" role="status" data-testid="result-needs-checking">
            <Icon name="alert" size={16} />
            <span>
              <b>{tn(r.plan.flagged.total, '{n} record needs checking.', '{n} records need checking.')}</b>{' '}
              {r.plan.flagged.blockedRows > 0 && <span data-testid="result-blocking">{tn(r.plan.flagged.blockedRows, '{n} has a blocking problem and is left out of the numbers until fixed.', '{n} have a blocking problem and are left out of the numbers until fixed.')} </span>}
              {r.plan.flagged.warningRows > 0 && <span data-testid="result-warning-rows">{tn(r.plan.flagged.warningRows, '{n} has warnings only.', '{n} have warnings only.')} </span>}
              {t('Nothing was dropped: every row is stored.')}
            </span>
            <Link className="btn" to="/validate" data-testid="result-validate-link">{t('Open the Validate page')}</Link>
          </div>
        )}
        {r.progress.rejected.length > 0 && (
          <div className="callout callout--warning" role="status" data-testid="result-rejected">
            <Icon name="alert" size={16} />
            <span>
              <b>{tn(r.progress.rejected.length, '{n} row was refused by the server and not stored.', '{n} rows were refused by the server and not stored.')}</b>
              <ul className="up-list" style={{ marginTop: 6 }}>{r.progress.rejected.slice(0, 20).map((x) => <li key={x.source_row}><b className="mono">{t('Row {n}', { n: x.source_row })}</b> {x.reason}</li>)}</ul>
            </span>
          </div>
        )}
        <div className="chip-row">
          <Link className="btn-primary" to="/events" data-testid="open-events"><Icon name="list" size={15} /> {t('Open Event Explorer')}</Link>
          {review && <button type="button" className="btn" onClick={() => downloadText(`warnings-${b.batch_id}.csv`, reviewCsv(review, f.decisions))} data-testid="download-warnings"><Icon name="download" size={15} /> {t('Download warnings (CSV)')}</button>}
          <button type="button" className="btn" onClick={f.reset} data-testid="upload-another">{t('Upload another file')}</button>
        </div>
      </section>
    );
  }

  if (f.phase === 'review' && review) {
    return (
      <>
        <section className="card" data-testid="upload-file-card">
          <div className="up-head">
            <h2><Icon name="registry" size={16} style={{ verticalAlign: '-2px', marginInlineEnd: 6 }} />{f.fileName}</h2>
            <button type="button" className="btn btn-sm" onClick={f.reset} data-testid="choose-another">{t('Choose another file')}</button>
          </div>
        </section>
        <ReviewPanel review={review} decisions={f.decisions} onDecide={f.decide} onDecideAll={f.decideEvery} />
        <div className="adm-actionbar" data-testid="upload-bar">
          <div className="adm-actionbar-text" role="status" data-testid="upload-bar-text">
            {!complete
              ? <><span aria-hidden="true">▲ </span>{tn(open, 'Choose Add or Skip for the {n} late entry or month to continue.', 'Choose Add or Skip for the {n} late entries and months to continue.')}</>
              : plan && plan.willAdd > 0
                ? tn(plan.willAdd, 'Ready: {n} row will be added.', 'Ready: {n} rows will be added.')
                : t('Ready: there is nothing new to add. The upload will only be recorded.')}
          </div>
          <div className="adm-actionbar-buttons">
            <button type="button" className="btn" onClick={() => downloadText(`warnings-${f.fileName.replace(/\.xlsx$/i, '')}.csv`, reviewCsv(review, f.decisions))} data-testid="download-warnings"><Icon name="download" size={15} /> {t('Download warnings (CSV)')}</button>
            <button type="button" className="btn-primary" disabled={!complete} onClick={() => setConfirm(true)} data-testid="upload-confirm">
              <Icon name="upload" size={15} /> {plan && plan.willAdd > 0 ? tn(plan.willAdd, 'Upload {n} row', 'Upload {n} rows') : plan ? t('Record upload') : t('Upload')}
            </button>
          </div>
        </div>
        {confirm && plan && (
          <ConfirmDialog
            title={t('Upload this file?')}
            icon="upload"
            confirmLabel={t('Upload')}
            onCancel={() => setConfirm(false)}
            onConfirm={() => { setConfirm(false); void f.send(); }}
            testid="upload-confirm-dialog"
          >
            <ul className="up-list">
              <li>{tn(plan.willAdd, '{n} row will be added.', '{n} rows will be added.')}</li>
              <li>{tn(review.counts.identical, '{n} row is already stored and is skipped.', '{n} rows are already stored and are skipped.')}</li>
              {plan.skippedLate > 0 && <li>{tn(plan.skippedLate, '{n} late row you chose to skip is not added.', '{n} late rows you chose to skip are not added.')}</li>}
              {plan.flagged.total > 0 && <li>{tn(plan.flagged.total, '{n} of them will need checking on the Validate page.', '{n} of them will need checking on the Validate page.')}</li>}
            </ul>
            <p style={{ margin: '8px 0 0' }}>{t('Stored rows are never changed by an upload. A wrong row can be corrected or voided later in Event Explorer or on the Validate page.')}</p>
          </ConfirmDialog>
        )}
      </>
    );
  }

  // idle: choose a file
  return (
    <section className="card" data-testid="upload-choose">
      <h2>{t('Add the monthly workbook')}</h2>
      {f.refusal && (
        <div className="callout callout--danger" role="alert" data-testid="upload-refused">
          <Icon name="alert" size={16} />
          <span>
            <b>{t('This file cannot be uploaded.')}</b>
            {f.refusal.problems.map((p) => <span key={p.code} style={{ display: 'block', marginTop: 4 }} data-testid={`problem-${p.code}`}>{p.message}</span>)}
          </span>
        </div>
      )}
      {f.error && (
        <div className="callout callout--danger" role="alert" data-testid="upload-error"><Icon name="alert" size={16} /><span>{f.error}</span></div>
      )}
      <FileChooser onFile={(file) => void f.chooseFile(file)} busy={false} />
    </section>
  );
}
