// The HTML body of the app's emails (backend 1.9.0): a short, self-contained summary with inline styles only (email
// programs ignore style sheets), plain tables, no pictures and no links, so the server's cleaning keeps it as it is.
// Pure: no DOM. The report summary and the actions report both build on these pieces.
import { statusLine } from '../dashboard/targets';
import { t } from '../i18n/t';
import { changeText } from '../reports/format';
import type { KpiCard, KpiId, ReportModel, SummarySection } from '../reports/model';
import { ACTION_HEAD, actionCells, shownTs, TASK_HEAD, taskCells, type ActionsReportModel } from '../reports/actions/model';

export const esc = (s: string): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const INK = '#14213d';
const MUTED = '#5b6474';
const LINE = '#dfe3ea';
const GOOD = '#1e7b34';
const BAD = '#b3261e';

/** The person's own message: plain text, paragraphs kept, nothing else. */
export function messageHtml(message: string): string {
  const m = message.trim();
  if (!m) return '';
  return m.split(/\n{2,}/).map((p) => `<p style="margin:0 0 10px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/** A heading and a list of label / value rows. */
export function factsTable(rows: [string, string][]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px">${rows.map(([k, v]) => (
    `<tr><td style="padding:2px 14px 2px 0;color:${MUTED};vertical-align:top">${esc(k)}</td><td style="padding:2px 0;color:${INK}">${esc(v)}</td></tr>`
  )).join('')}</table>`;
}

/** A cell: text, or text in the good / bad colour (always with a symbol or word too, never colour alone). */
export type MailCell = string | { text: string; tone: 'good' | 'bad' };

/** A table with a header row. */
export function dataTable(head: string[], rows: MailCell[][], numeric: boolean[] = []): string {
  const th = head.map((h, i) => `<th style="text-align:${numeric[i] ? 'right' : 'left'};padding:6px 8px;border-bottom:2px solid ${LINE};font-size:12px;color:${MUTED};text-transform:uppercase">${esc(h)}</th>`).join('');
  const cell = (c: MailCell, i: number) => {
    const text = typeof c === 'string' ? c : c.text;
    const color = typeof c === 'string' ? '' : `;color:${c.tone === 'good' ? GOOD : BAD};font-weight:bold`;
    return `<td style="text-align:${numeric[i] ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid ${LINE};vertical-align:top${color}">${esc(text)}</td>`;
  };
  const body = rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:720px;margin:0 0 16px;font-size:14px;color:${INK}"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

/** The frame every email shares: title, sub line, content and a footer saying where it came from. */
export function emailFrame(title: string, sub: string, content: string, footer: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:${INK};max-width:760px">`
    + `<h2 style="margin:0 0 2px;font-size:20px;color:${INK}">${esc(title)}</h2>`
    + `<p style="margin:0 0 14px;color:${MUTED}">${esc(sub)}</p>`
    + content
    + `<p style="margin:18px 0 0;padding-top:10px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px">${esc(footer)}</p></div>`;
}

/** The six KPI the email shows, in the order of the dashboard's KPI row. */
export const EMAIL_KPIS: KpiId[] = ['stoppage', 'failures', 'reliability', 'mtbf', 'mttr', 'utilization'];

function kpiRow(k: KpiCard, compare: SummarySection['data']['compare']): MailCell[] {
  const ch = changeText(k.change, k.changeUnit, compare);
  const changeTxt = ch ? `${ch.arrow ? `${ch.arrow} ` : ''}${ch.amount}${ch.words ? ` · ${ch.words}` : ''}` : '';
  const change: MailCell = ch && (ch.tone === 'good' || ch.tone === 'bad') ? { text: changeTxt, tone: ch.tone } : changeTxt;
  const status: MailCell = k.status ? { text: `${k.status.ok ? '✔' : k.status.state === 'below' ? '▼' : '▲'} ${statusLine(k.status)}`, tone: k.status.ok ? 'good' : 'bad' } : '';
  return [k.label, k.text, change, status];
}

/** The period in words: "2026-08-01 to 2026-08-31". */
export const periodText = (m: Pick<ReportModel, 'range'>): string => (m.range.from === m.range.to ? m.range.from : `${m.range.from} ${t('to')} ${m.range.to}`);

/** The subject a report email starts with: "Monthly report 2026-08-01 to 2026-08-31 - Arabian Cement, Sokhna". */
export const reportSubject = (m: Pick<ReportModel, 'title' | 'range' | 'plant'>): string => `${m.title} ${periodText(m)} - ${m.plant}`.slice(0, 200);

/**
 * The body of a report email. `summary` is a model of the same setup with the summary section (the KPI block and the key
 * findings); `attached` names the files.
 */
export function reportEmailHtml({ summary, message, attached }: { summary: ReportModel; message: string; attached: string[] }): string {
  const sec = summary.sections.find((s): s is SummarySection => s.id === 'summary');
  const kpis = sec ? EMAIL_KPIS.map((id) => sec.data.kpis.find((k) => k.id === id)).filter((k): k is KpiCard => !!k) : [];
  const compare = sec?.data.compare ?? 'none';
  const facts: [string, string][] = [
    [t('Period'), periodText(summary)],
    [t('Scope'), summary.filterSummary || t('All lines and areas')],
    ...(summary.compare.on && summary.compare.label ? [[t('Compared with'), summary.compare.label] as [string, string]] : []),
    [t('Prepared by'), `${summary.generatedBy} · ${shownTs(summary.generatedAt)}`],
  ];
  let content = messageHtml(message) + factsTable(facts);
  if (summary.noData || !kpis.length) {
    content += `<p style="margin:0 0 14px">${esc(summary.noData ?? t('No data for this period.'))}</p>`;
  } else {
    const head = [t('Measure'), t('Value'), ...(compare === 'none' ? [] : [sec?.data.compareLabel || t('Change')]), t('Target')];
    const rows = kpis.map((k): MailCell[] => {
      const [label, value, change, status] = kpiRow(k, compare);
      return compare === 'none' ? [label!, value!, status!] : [label!, value!, change!, status!];
    });
    content += dataTable(head, rows, head.map((_, i) => i === 1));
    const bullets = (sec?.data.bullets ?? []).slice(0, 5);
    if (bullets.length) content += `<p style="margin:0 0 4px;font-weight:bold">${esc(t('Key findings'))}</p><ul style="margin:0 0 14px;padding-left:20px">${bullets.map((b) => `<li style="margin:0 0 4px">${esc(b)}</li>`).join('')}</ul>`;
  }
  if (attached.length) content += `<p style="margin:0;color:${MUTED}">${esc(t('Attached: {f}.', { f: attached.join(', ') }))}</p>`;
  return emailFrame(`${summary.title} · ${summary.plant}`, periodText(summary), content, t('Sent from ACC Downtime Analysis. The numbers are area-hours, calculated by the app from the uploaded downtime records.'));
}

// ---------------------------------------------------------------- recipients

const ADDR = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** Splits typed text ("a@x.com; b@y.org, c@z.net") into addresses and the parts that are not valid. */
export function parseAddresses(text: string): { ok: string[]; bad: string[] } {
  const ok: string[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const a = raw.trim().replace(/^<|>$/g, '').toLowerCase();
    if (!a) continue;
    if (ADDR.test(a) && a.length <= 254) { if (!ok.includes(a)) ok.push(a); } else bad.push(raw.trim());
  }
  return { ok, bad };
}

export const isAddress = (s: string): boolean => ADDR.test(s.trim()) && s.trim().length <= 254;

// ---------------------------------------------------------------- the actions report

/** The body of an actions-report email: the counts and the list (and, for one action, its facts and tasks). */
export function actionsEmailHtml({ model, message, attached }: { model: ActionsReportModel; message: string; attached: string[] }): string {
  const facts: [string, string][] = [
    [t('Scope'), model.scope],
    [t('Actions'), model.counts.byStatus.length ? model.counts.byStatus.map(([s, n]) => `${s} ${n}`).join(' · ') : t('none')],
    [t('Overdue'), String(model.counts.overdue)],
    [t('Tasks'), t('{o} open, {d} done', { o: model.counts.tasksOpen, d: model.counts.tasksDone })],
    [t('Prepared by'), `${model.generatedBy} · ${shownTs(model.generatedAt)}`],
  ];
  let content = messageHtml(message) + factsTable(facts);
  if (model.single && model.details[0]) {
    const d = model.details[0];
    content += `<p style="margin:0 0 6px;font-weight:bold">${esc(`${d.row.id} · ${d.row.title}`)}</p>` + factsTable(d.facts);
    if (d.required) content += `<p style="margin:0 0 12px"><b>${esc(t('Required action'))}:</b> ${esc(d.required)}</p>`;
    if (d.tasks.length) {
      content += dataTable(TASK_HEAD(), d.tasks.map((x): MailCell[] => taskCells(x, true).map((c, i): MailCell => (
        i === 5 && (x.status === 'Done' || x.status === 'Not needed') ? { text: c, tone: 'good' } : i === 4 && x.overdue ? { text: c, tone: 'bad' } : c))));
    }
  } else if (model.rows.length) {
    const shown = model.rows.slice(0, 40);
    content += dataTable(ACTION_HEAD(), shown.map((r): MailCell[] => actionCells(r, true).map((c, i): MailCell => (i === 8 && r.overdue ? { text: c, tone: 'bad' } : c))));
    if (model.rows.length > shown.length) content += `<p style="margin:0 0 12px;color:${MUTED}">${esc(t('{n} more in the attached report.', { n: model.rows.length - shown.length }))}</p>`;
  } else {
    content += `<p style="margin:0 0 14px">${esc(t('No action matches these filters.'))}</p>`;
  }
  if (attached.length) content += `<p style="margin:0;color:${MUTED}">${esc(t('Attached: {f}.', { f: attached.join(', ') }))}</p>`;
  return emailFrame(`${model.title} · ${model.plant}`, model.scope, content, t('Sent from ACC Downtime Analysis.'));
}
