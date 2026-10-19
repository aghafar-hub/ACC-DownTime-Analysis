// Reports: build a printable report from the loaded events and master data. The setup (template, period, filters,
// sections, options) lives in the URL query, so a setup link restores it; `v=report` shows the built report instead of
// the builder. Building is a pure client calculation (src/reports/model.ts); the dashboards' filters are never touched.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ReportSectionId } from '../api/types';
import ReportExport from '../reports/ReportExport';
import { comparisonRange } from '../calc';
import { PageHeader } from '../components/Tile';
import DataStatus from '../components/DataStatus';
import { PLANT_NAME } from '../config';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import Builder from '../reports/Builder';
import { buildReport, reportContext, scopeCounts, type ReportModel } from '../reports/model';
import { usePlantCoverage } from '../data/coverage';
import { comparisonKindFor } from '../reports/period';
import ReportDocument, { type DocumentInfo } from '../reports/ReportDocument';
import { parseSetup, serializeSetup, type ReportSetup } from '../reports/setup';
import { useReportData } from '../reports/useReportData';
import '../components/ui.css';
import '../dashboard/dashboard.css';
import '../reports/reports.css';
import { useCreateAction } from '../actions/ActionsContext';
import { reportPrefill } from '../actions/prefill';
import { monthText, rangeText } from '../util/dates';
import SendEmailDialog, { type BuiltEmail } from '../email/SendEmailDialog';
import { reportEmailHtml, reportSubject } from '../email/emailHtml';
import { bytesToBase64, pagesToPdf } from '../email/pdf';
import { safeFileName, useCanSendEmail, useEmailPeople } from '../email/useCanSend';
import { buildReportWorkbook } from '../export/reportExport';
import { XLSX_MIME } from '../export/xlsx';
import ActionsReport from '../reports/actions/ActionsReport';
import { Seg } from '../dashboard/cards/DashCard';

const pad = (n: number): string => String(n).padStart(2, '0');
const nowText = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function Reports() {
  const [sp, setSp] = useSearchParams();
  const { user, canView } = useAuth();
  const key = sp.toString();
  // backend 1.9.0: Reports › Actions report (type=actions), for people who can see the Actions page
  const withActions = canView('actions');
  const type: 'downtime' | 'actions' = withActions && sp.get('type') === 'actions' ? 'actions' : 'downtime';
  // The setup is kept in state and mirrored to the URL (so quick successive clicks never lose a change to a late URL
  // update); a different URL (a pasted link, Back) replaces it.
  const [setup, setSetup] = useState<ReportSetup>(() => parseSetup(new URLSearchParams(key)));
  const written = useRef(serializeSetup(setup).toString());
  useEffect(() => {
    const incoming = parseSetup(new URLSearchParams(key));
    const k = serializeSetup(incoming).toString();
    if (k !== written.current) {
      written.current = k;
      setSetup(incoming);
    }
  }, [key]);
  const view: 'builder' | 'report' = sp.get('v') === 'report' ? 'report' : 'builder';
  const data = useReportData(setup);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const query = useCallback((next: ReportSetup, v: 'builder' | 'report'): URLSearchParams => {
    const q = serializeSetup(next);
    if (v === 'report') q.set('v', 'report');
    return q;
  }, []);
  const change = useCallback((next: ReportSetup) => {
    written.current = serializeSetup(next).toString();
    setSetup(next);
    setSp(query(next, 'builder'), { replace: true });
  }, [setSp, query]);
  const build = useCallback(() => setSp(query(setup, 'report')), [setSp, query, setup]);
  const edit = useCallback(() => setSp(query(setup, 'builder')), [setSp, query, setup]);
  const copyLink = useCallback(() => {
    const q = query(setup, view);
    const url = `${window.location.origin}${window.location.pathname}#/reports?${q.toString()}`;
    void copyText(url).then((ok) => {
      setCopied(ok);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 4000);
    });
  }, [query, setup, view]);

  // what the builder's live line and period text need: the dashboard scope of period + filters (not the sections)
  const scopeKey = JSON.stringify([setup.preset, setup.from, setup.to, setup.compare, setup.filters]);
  const live = useMemo(
    () => (data.ready && data.startup && data.asOf ? reportContext(setup, data.startup, data.rows, data.asOf) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.ready, data.startup, data.rows, data.asOf, scopeKey],
  );
  const counts = useMemo(() => (live ? scopeCounts(live.ctx) : null), [live]);
  // one data coverage on every page: the plant-wide one (all years), as the data strip shows it
  const plant = usePlantCoverage();
  const range = live?.range ?? data.range;
  const compareRange = setup.compare && range ? (live?.ctx.win.compareRange ?? comparisonRange(range, comparisonKindFor(setup.preset))) : null;

  const generatedBy = user?.display_name || user?.email || '';
  // the builder makes the model when a download is asked for (only the sections that download needs)
  const getModel = useCallback((only?: ReportSectionId[]): ReportModel | null => {
    if (!data.ready || !data.startup || !data.asOf) return null;
    return buildReport({
      setup: only ? { ...setup, sections: only } : setup, startup: data.startup, rows: data.rows, asOf: data.asOf, generatedAt: nowText(), generatedBy, plant: PLANT_NAME,
      coverage: plant?.coverage,
    });
  }, [data.ready, data.startup, data.rows, data.asOf, setup, generatedBy, plant]);

  const switchType = (next: 'downtime' | 'actions') => {
    if (next === type) return;
    setSp(next === 'actions' ? new URLSearchParams({ type: 'actions' }) : serializeSetup(setup), { replace: false });
  };
  const typeSwitch = withActions && (
    <div className="rpt-type rpt-noprint">
      <Seg value={type} onChange={switchType} label={t('Kind of report')} testid="report-type"
        options={[{ value: 'downtime', label: t('Downtime report') }, { value: 'actions', label: t('Actions report') }]} />
    </div>
  );
  if (type === 'actions') {
    return (
      <div className="page rb-page" data-testid="page-reports" data-view="actions">
        <div className="rpt-noprint">
          <PageHeader title={t('Reports')} subtitle={t('Actions of one area or of all areas, or one action, with their tasks and history. Print it, download Excel or send it by email.')} />
        </div>
        {typeSwitch}
        <ActionsReport />
      </div>
    );
  }

  const subtitle = view === 'builder'
    ? t('Choose what goes into the report, add filters and press Build. The report can be printed or saved as a PDF.')
    : t('Print or save the report as a PDF, or go back to change what it contains.');

  return (
    <div className="page rb-page" data-testid="page-reports" data-view={view}>
      <div className="rpt-noprint">
        <PageHeader title={t('Reports')} subtitle={subtitle} />
        {(data.st.error || (data.st.loading && !data.st.data)) && <DataStatus state={data.st} onRetry={data.st.reload} what={t('master data')} />}
        {!(data.st.error || (data.st.loading && !data.st.data)) && <DataStatus state={data.data.state} onRetry={data.data.reload} what={t('events')} />}
      </div>
      {view === 'builder' && typeSwitch}
      {view === 'builder' ? (
        <Builder
          setup={setup} onChange={change} startup={data.startup} range={range} compareRange={compareRange} scope={counts} coverage={plant?.coverage ?? live?.ctx.coverage ?? null}
          onBuild={build} onCopyLink={copyLink} copied={copied} getModel={getModel} dataReady={data.ready} asOf={data.asOf}
        />
      ) : (
        <Preview setup={setup} data={data} generatedBy={generatedBy} onEdit={edit} onCopyLink={copyLink} copied={copied} />
      )}
    </div>
  );
}

function Preview({ setup, data, generatedBy, onEdit, onCopyLink, copied }: {
  setup: ReportSetup; data: ReturnType<typeof useReportData>; generatedBy: string; onEdit: () => void; onCopyLink: () => void; copied: boolean;
}) {
  const generatedAt = useRef(nowText());
  const createAction = useCreateAction();
  const plant = usePlantCoverage();
  const [model, setModel] = useState<ReportModel | null>(null);
  const [info, setInfo] = useState<DocumentInfo | null>(null);
  const setupKey = serializeSetup(setup).toString();

  useEffect(() => {
    if (!data.ready || !data.startup || !data.asOf) return undefined;
    setModel(null);
    setInfo(null);
    const startup = data.startup;
    const asOf = data.asOf;
    const rows = data.rows;
    const handle = window.setTimeout(() => {
      setModel(buildReport({ setup, startup, rows, asOf, generatedAt: generatedAt.current, generatedBy, plant: PLANT_NAME, coverage: plant?.coverage }));
    }, 30);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.ready, data.startup, data.rows, data.asOf, setupKey, generatedBy, plant]);

  // the print stylesheet only applies while a report is on screen; the file name of "Save as PDF" is the page title
  useEffect(() => {
    document.body.classList.add('report-printing');
    return () => document.body.classList.remove('report-printing');
  }, []);
  useEffect(() => {
    if (!model) return undefined;
    const before = document.title;
    // the printed PDF's suggested name comes from the title: the app's dates ('Aug 2026', '1 Jan – 31 Aug 2026')
    const period = model.range.from.slice(0, 7) === model.range.to.slice(0, 7) ? monthText(model.range.from) : rangeText(model.range);
    document.title = `${model.title} ${period} - ${model.plant}`;
    return () => { document.title = before; };
  }, [model]);

  const onLayout = useCallback((i: DocumentInfo) => setInfo(i), []);
  const canSend = useCanSendEmail();
  const people = useEmailPeople();
  const [sending, setSending] = useState(false);
  const [sentNote, setSentNote] = useState('');
  const viewRef = useRef<HTMLDivElement>(null);

  // the email: a summary of the same setup (the KPI block and key findings), the pages on screen as a PDF, Excel if ticked
  const buildEmail = useCallback(async ({ message, attachExcel, progress }: { message: string; attachExcel: boolean; progress: (s: string) => void }): Promise<BuiltEmail> => {
    if (!model || !data.startup || !data.asOf) throw new Error(t('The report is not ready yet.'));
    const pages = [...(viewRef.current?.querySelectorAll<HTMLElement>('[data-testid="rpt-page"]') ?? [])];
    if (!pages.length) throw new Error(t('The report pages are not laid out yet. Try again in a moment.'));
    const base = safeFileName(`${model.title} ${model.range.from === model.range.to ? model.range.from : `${model.range.from} to ${model.range.to}`}`);
    const pdf = await pagesToPdf(pages, (i, n) => progress(t('Making the PDF: page {i} of {n}…', { i, n })));
    const attachments: BuiltEmail['attachments'] = [{ name: `${base}.pdf`, mimeType: 'application/pdf', base64: bytesToBase64(pdf) }];
    if (attachExcel) {
      progress(t('Making the Excel file…'));
      const wb = buildReportWorkbook(model);
      attachments.push({ name: wb.fileName, mimeType: XLSX_MIME as 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: bytesToBase64(wb.bytes) });
    }
    const summary = buildReport({ setup: { ...setup, sections: ['summary'] }, startup: data.startup, rows: data.rows, asOf: data.asOf, generatedAt: generatedAt.current, generatedBy, plant: PLANT_NAME });
    return { html: reportEmailHtml({ summary, message, attached: attachments.map((a) => a.name) }), attachments };
  }, [model, data.startup, data.asOf, data.rows, setup, generatedBy]);

  return (
    <div className="rpt-view" data-testid="report-view" ref={viewRef}>
      <div className="card rpt-toolbar rpt-noprint" role="toolbar" aria-label={t('Report actions')} data-testid="report-toolbar">
        <button type="button" className="btn" onClick={onEdit} data-testid="report-edit"><Icon name="chevronRight" size={16} style={{ transform: 'rotate(180deg)' }} /> {t('Edit setup')}</button>
        <button type="button" className="btn" onClick={onCopyLink} data-testid="report-copy-link"><Icon name="share" size={16} /> {t('Copy link')}</button>
        <ReportExport
          sections={setup.sections} ready={!!model} testid="rp"
          getModel={(only) => (model ? (only ? { ...model, sections: model.sections.filter((s) => only.includes(s.id)) } : model) : null)}
        />
        {createAction && (
          <button type="button" className="btn" disabled={!model} data-testid="report-create-action"
            onClick={() => model && createAction(reportPrefill({
              title: model.title, period: model.range.from.slice(0, 7) === model.range.to.slice(0, 7) ? monthText(model.range.from) : rangeText(model.range),
              equipmentIds: setup.filters.equipmentIds, areaIds: setup.filters.areaIds, lineIds: setup.filters.lineIds,
            }))}>
            <Icon name="plus" size={16} /> {t('Create action')}
          </button>
        )}
        {canSend && (
          <button type="button" className="btn" onClick={() => { setSentNote(''); setSending(true); }} disabled={!info || !model || setup.sections.length === 0} data-testid="report-send">
            <Icon name="mail" size={16} /> {t('Send by email')}
          </button>
        )}
        <button type="button" className="btn-primary" onClick={() => window.print()} disabled={!info} data-testid="report-print"><Icon name="download" size={16} /> {t('Print / Save as PDF')}</button>
        <span className="rpt-toolbar-info" data-testid="report-info" role="status">
          {info ? t('{p} pages · {s} sections', { p: info.pages, s: info.sections }) : model ? t('Laying out the pages…') : ''}
        </span>
        <span className="rb-copied" role="status" aria-live="polite" data-testid="report-copied">{copied ? t('Link copied. It opens this report.') : ''}</span>
        {sentNote && <span className="rb-copied" role="status" data-testid="report-sent">{sentNote}</span>}
      </div>
      {sending && model && (
        <SendEmailDialog
          title={t('Send the report by email')} kind="report" defaultSubject={reportSubject(model)} people={people} excel
          build={buildEmail} onClose={() => setSending(false)}
          onSent={(r, n) => { setSending(false); setSentNote(n === 1 ? t('Sent to 1 recipient from {f}.', { f: r.from }) : t('Sent to {n} recipients from {f}.', { n, f: r.from })); }}
        />
      )}
      {!data.ready && <p className="callout rpt-noprint" role="status" data-testid="report-loading">{t('Loading the data for the report…')}</p>}
      {data.ready && !model && <p className="callout rpt-noprint" role="status" data-testid="report-building">{t('Building the report…')}</p>}
      {model && <ReportDocument model={model} onLayout={onLayout} />}
      {model && setup.sections.length === 0 && <p className="callout rpt-noprint" data-testid="report-none">{t('No sections were chosen. Use Edit setup to choose what goes into the report.')}</p>}
    </div>
  );
}
