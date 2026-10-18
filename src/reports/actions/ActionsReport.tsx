// Reports › Actions report: all actions of one area (or all areas), filtered by status and creation date, or one action
// (also opened from an action's detail with "Report / send"), with its tasks and history. Print / Save as PDF, Excel, and
// Send by email (backend 1.9.0). The filters live in the URL (type=actions&aarea=…&ast=…&afrom=…&ato=…&aid=…&adet=0).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useActionsOptional } from '../../actions/ActionsContext';
import { todayLocal } from '../../actions/model';
import { ACTION_STATUSES } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { PLANT_NAME } from '../../config';
import { useStartup } from '../../data/useStartup';
import SendEmailDialog, { type BuiltEmail } from '../../email/SendEmailDialog';
import { actionsEmailHtml } from '../../email/emailHtml';
import { bytesToBase64, documentToPdf } from '../../email/pdf';
import { safeFileName, useCanSendEmail, useEmailPeople } from '../../email/useCanSend';
import { deliverFile, deliveredText } from '../../export/deliverFile';
import { buildXlsx, XLSX_MIME } from '../../export/xlsx';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import {
  ACTION_HEAD, actionCells, actionsFileBase, actionsSheets, buildActionsReport, parseActionsFilters, TASK_HEAD, taskCells, writeActionsFilters,
  type ActionsReportFilters, type ActionsReportModel,
} from './model';
import './actionsReport.css';

const pad = (n: number): string => String(n).padStart(2, '0');
const nowText = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function Document({ m }: { m: ActionsReportModel }) {
  return (
    <>
      <header className="arp-head" data-pdf-block>
        <p className="arp-plant">{m.plant}</p>
        <h2 className="arp-title" data-testid="arp-title">{m.title}</h2>
        <p className="arp-scope" data-testid="arp-scope">{m.scope}</p>
        <p className="arp-meta">{t('Prepared by {who} · {when}', { who: m.generatedBy, when: m.generatedAt })}</p>
        <dl className="arp-counts" data-testid="arp-counts">
          <div><dt>{t('Actions')}</dt><dd>{m.counts.total}</dd></div>
          {m.counts.byStatus.map(([s, n]) => <div key={s}><dt>{s}</dt><dd>{n}</dd></div>)}
          <div><dt>{t('Overdue')}</dt><dd className={m.counts.overdue ? 'arp-bad' : undefined}>{m.counts.overdue}</dd></div>
          <div><dt>{t('Tasks open / done')}</dt><dd>{m.counts.tasksOpen} / {m.counts.tasksDone}</dd></div>
        </dl>
      </header>
      {!m.single && (
        <section className="arp-sec" data-pdf-block>
          <h3 className="arp-h">{t('Actions')}</h3>
          {m.rows.length === 0 ? <p className="arp-none" data-testid="arp-none">{t('No action matches these filters.')}</p> : (
            <div className="arp-table-wrap">
              <table className="arp-table" data-testid="arp-list">
                <thead><tr>{ACTION_HEAD().map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>
                  {m.rows.map((r) => (
                    <tr key={r.id} data-testid="arp-row">
                      {actionCells(r).map((c, i) => <td key={i} className={i === 8 && r.overdue ? 'arp-bad' : undefined}>{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {m.rows.some((r) => r.overdue) && <p className="arp-note">{t('! = past the due date.')}</p>}
        </section>
      )}
      {m.details.map((d) => (
        <section key={d.row.id} className="arp-sec arp-action" data-pdf-block data-testid="arp-action">
          <h3 className="arp-h">{d.row.id} · {d.row.title}</h3>
          <dl className="arp-facts">
            {d.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          {d.detail && <p className="arp-p"><b>{t('Problem')}:</b> {d.detail}</p>}
          {d.required && <p className="arp-p"><b>{t('Required action')}:</b> {d.required}</p>}
          {d.evidence.length > 0 && (
            <>
              <h4 className="arp-h4">{t('Evidence')}</h4>
              <ul className="arp-list">{d.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </>
          )}
          <h4 className="arp-h4">{t('Tasks')}</h4>
          {d.tasks.length === 0 ? <p className="arp-none">{t('No tasks.')}</p> : (
            <div className="arp-table-wrap">
              <table className="arp-table" data-testid="arp-tasks">
                <thead><tr>{TASK_HEAD().map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>{d.tasks.map((x) => <tr key={x.seq}>{taskCells(x).map((c, i) => <td key={i} className={i === 4 && x.overdue ? 'arp-bad' : undefined}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          {d.history.length > 0 && (
            <>
              <h4 className="arp-h4">{t('History')}</h4>
              <ul className="arp-history" data-testid="arp-history">
                {d.history.map((h, i) => <li key={i}><span className="arp-when">{h.at} · {h.by}</span> {h.what}</li>)}
              </ul>
            </>
          )}
        </section>
      ))}
    </>
  );
}

export default function ActionsReport() {
  const [sp, setSp] = useSearchParams();
  const f = parseActionsFilters(sp);
  const acts = useActionsOptional();
  const { startup } = useStartup();
  const { user } = useAuth();
  const canSend = useCanSendEmail();
  const people = useEmailPeople();
  const docRef = useRef<HTMLDivElement>(null);
  const generatedAt = useRef(nowText());
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState('');
  // the print style sheet keeps only the page content (the report) while this is on screen
  useEffect(() => {
    document.body.classList.add('report-printing');
    return () => document.body.classList.remove('report-printing');
  }, []);
  const set = (patch: Partial<ActionsReportFilters>) => setSp(writeActionsFilters(sp, { ...f, ...patch }), { replace: true });

  const areas = useMemo(() => (startup?.areas ?? []).slice().sort((a, b) => a.sort_order - b.sort_order), [startup]);
  const areaNames = useMemo(() => new Map(areas.map((a) => [a.area_id, a.name])), [areas]);
  const p = acts?.payload ?? null;
  const model = useMemo(() => (p ? buildActionsReport({
    actions: p.actions, tasks: p.tasks ?? [], logs: p.logs, people: p.people, contractors: p.contractors, filters: f, today: todayLocal(),
    plant: PLANT_NAME, generatedAt: generatedAt.current, generatedBy: user?.display_name || user?.email || '', areaNames,
  }) : null), [p, f.area, f.status, f.from, f.to, f.id, f.details, user, areaNames]); // eslint-disable-line react-hooks/exhaustive-deps
  const choices = useMemo(() => (p?.actions ?? []).filter((a) => !f.area || a.area_id === f.area).slice().sort((a, b) => b.action_id.localeCompare(a.action_id)), [p, f.area]);

  const excel = useCallback(async () => {
    if (!model) return;
    const name = `${safeFileName(actionsFileBase(model))}.xlsx`;
    const bytes = buildXlsx(actionsSheets(model), { title: model.title, creator: model.generatedBy });
    setNote(deliveredText(await deliverFile(name, bytes, XLSX_MIME), t('{name} downloaded.', { name }), name));
  }, [model]);

  const buildEmail = useCallback(async ({ message, attachExcel, progress }: { message: string; attachExcel: boolean; progress: (s: string) => void }): Promise<BuiltEmail> => {
    if (!model || !docRef.current) throw new Error(t('The report is not ready yet.'));
    const base = safeFileName(actionsFileBase(model));
    progress(t('Making the PDF…'));
    const pdf = await documentToPdf(docRef.current);
    const attachments: BuiltEmail['attachments'] = [{ name: `${base}.pdf`, mimeType: 'application/pdf', base64: bytesToBase64(pdf) }];
    if (attachExcel) {
      progress(t('Making the Excel file…'));
      attachments.push({ name: `${base}.xlsx`, mimeType: XLSX_MIME as 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: bytesToBase64(buildXlsx(actionsSheets(model), { title: model.title, creator: model.generatedBy })) });
    }
    return { html: actionsEmailHtml({ model, message, attached: attachments.map((a) => a.name) }), attachments };
  }, [model]);

  if (!acts || !acts.canView) {
    return <p className="callout" data-testid="arp-no-access">{t('The actions report needs access to the Actions page.')}</p>;
  }
  const subject = model ? `${model.title}: ${model.scope} - ${PLANT_NAME}`.slice(0, 200) : '';

  return (
    <div className="arp" data-testid="actions-report">
      <div className="card arp-filters rpt-noprint" role="group" aria-label={t('What goes into the actions report')} data-testid="arp-filters">
        <label className="field">
          <span className="field-label">{t('Area')}</span>
          <select className="input" value={f.area} onChange={(e) => set({ area: e.target.value, id: '' })} data-testid="arp-area">
            <option value="">{t('All areas')}</option>
            {areas.map((a) => <option key={a.area_id} value={a.area_id}>{a.area_id}{a.name ? ` · ${a.name}` : ''}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('Action')}</span>
          <select className="input" value={f.id} onChange={(e) => set({ id: e.target.value })} data-testid="arp-action-pick">
            <option value="">{t('All actions that match')}</option>
            {choices.map((a) => <option key={a.action_id} value={a.action_id}>{a.action_id} · {a.title.slice(0, 60)}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('Status')}</span>
          <select className="input" value={f.status} onChange={(e) => set({ status: e.target.value as ActionsReportFilters['status'] })} disabled={!!f.id} data-testid="arp-status">
            <option value="open">{t('Open (not closed or cancelled)')}</option>
            <option value="all">{t('All')}</option>
            {ACTION_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('Created from')}</span>
          <input className="input" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} disabled={!!f.id} data-testid="arp-from" />
        </label>
        <label className="field">
          <span className="field-label">{t('Created to')}</span>
          <input className="input" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} disabled={!!f.id} data-testid="arp-to" />
        </label>
        <label className="arp-check">
          <input type="checkbox" checked={f.details || !!f.id} onChange={(e) => set({ details: e.target.checked })} disabled={!!f.id} data-testid="arp-details" />
          {t("Each action's tasks and history")}
        </label>
      </div>
      <div className="card rpt-toolbar rpt-noprint" role="toolbar" aria-label={t('Report actions')} data-testid="arp-toolbar">
        <button type="button" className="btn" onClick={() => void excel()} disabled={!model} data-testid="arp-excel"><Icon name="download" size={16} /> {t('Download Excel')}</button>
        {canSend && <button type="button" className="btn" onClick={() => { setNote(''); setSending(true); }} disabled={!model} data-testid="arp-send"><Icon name="mail" size={16} /> {t('Send by email')}</button>}
        <button type="button" className="btn-primary" onClick={() => window.print()} disabled={!model} data-testid="arp-print"><Icon name="download" size={16} /> {t('Print / Save as PDF')}</button>
        <span className="rpt-toolbar-info" role="status" data-testid="arp-note">{note}</span>
      </div>
      {!model && <p className="callout" role="status" data-testid="arp-loading">{acts.error ? acts.error : t('Loading the actions…')}</p>}
      {model && <div className="arp-doc" ref={docRef} data-testid="arp-doc"><Document m={model} /></div>}
      {sending && model && (
        <SendEmailDialog
          title={t('Send the actions report by email')} kind="actions" defaultSubject={subject} people={people} excel
          build={buildEmail} onClose={() => setSending(false)}
          onSent={(r, n) => { setSending(false); setNote(n === 1 ? t('Sent to 1 recipient from {f}.', { f: r.from }) : t('Sent to {n} recipients from {f}.', { n, f: r.from })); }}
        />
      )}
    </div>
  );
}
