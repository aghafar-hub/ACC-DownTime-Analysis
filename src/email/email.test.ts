import { describe, expect, it } from 'vitest';
import type { Action, ActionLog, ActionTask } from '../api/types';
import { buildActionsReport, defaultActionsFilters } from '../reports/actions/model';
import { buildReport } from '../reports/model';
import { parseSetup } from '../reports/setup';
import { buildSyntheticDb, DEMO_PASSWORD } from '../mock/synthetic';
import { createMockApi } from '../api/mockApi';
import { validateSettings } from '../admin/settingsSchema';
import { actionsEmailHtml, dataTable, esc, messageHtml, parseAddresses, reportEmailHtml, reportSubject } from './emailHtml';
import { bytesToBase64, pageStarts, pixelRatioFor, textToBase64, woff2Face } from './pdf';

describe('the mock server sends like the real one (backend 1.9.0)', () => {
  it('Reports Edit or Admin may send; recipients and files are checked; picked people are looked up; the log has a line', async () => {
    const api = createMockApi();
    const s = async (r: string) => (await api.login(`${r}@demo.test`, DEMO_PASSWORD, true)).token;
    const viewer = await s('viewer');
    const admin = await s('admin');
    await expect(api.sendReport(viewer, { to: ['a@b.org'], subject: 'x', html: '' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(api.sendReport(admin, { to: [], subject: 'x', html: '' })).rejects.toThrow(/at least one recipient/);
    await expect(api.sendReport(admin, { to: ['a@b.org'], subject: 'x', html: '', attachments: [{ name: 'x.exe', mimeType: 'text/csv', base64: 'AA==' }, { name: 'a', mimeType: 'text/csv', base64: 'AA==' }, { name: 'b', mimeType: 'text/csv', base64: 'AA==' }, { name: 'c', mimeType: 'text/csv', base64: 'AA==' }] }))
      .rejects.toThrow(/At most 3/);
    const r = await api.sendReport(admin, { to: ['A@b.org'], users: ['U-DEMO-ENG'], cc: ['a@b.org', 'c@d.org'], subject: 'Report', html: '<p>x</p>', kind: 'report' });
    expect(r).toMatchObject({ via: 'mailapp', recipients: 3 });
    expect(api.__sentMail().at(-1)).toMatchObject({ to: ['a@b.org', 'engineer@demo.test'], cc: ['c@d.org'], subject: 'Report' });
    await api.saveSettings(admin, { system_email: 'Downtime@ACC.com', system_email_name: 'ACC' });
    expect((await api.sendTestEmail(admin)).from).toBe('"ACC" <downtime@acc.com>');
    await expect(api.saveSettings(admin, { system_email: 'nope' })).rejects.toThrow(/email address/);
    const log = await api.listAuditLog(admin, { group: 'notifications' });
    expect(log.entries.map((e) => e.action)).toEqual(expect.arrayContaining(['send_report', 'send_test_email']));
  });
});

describe('email pieces', () => {
  it('escapes text and keeps the person\'s message as plain paragraphs', () => {
    expect(esc('<b>"a" & b</b>')).toBe('&lt;b&gt;&quot;a&quot; &amp; b&lt;/b&gt;');
    expect(messageHtml('Hello <script>\n\nSee below\nthanks')).toBe('<p style="margin:0 0 10px">Hello &lt;script&gt;</p><p style="margin:0 0 10px">See below<br>thanks</p>');
    expect(messageHtml('   ')).toBe('');
  });
  it('Settings: the system email is one address or blank; the sender name has no < > or quotes', () => {
    expect(validateSettings({ system_email: 'not an email' }).system_email).toMatch(/one email address/);
    expect(validateSettings({ system_email: '' }).system_email).toBeUndefined();
    expect(validateSettings({ system_email: 'downtime@acc.com' }).system_email).toBeUndefined();
    expect(validateSettings({ system_email_name: 'ACC <x>' }).system_email_name).toMatch(/Do not use/);
  });
  it('splits typed recipients and reports the parts that are not addresses', () => {
    expect(parseAddresses('A@x.com; b@y.org, <c@z.net>  a@x.com nope')).toEqual({ ok: ['a@x.com', 'b@y.org', 'c@z.net'], bad: ['nope'] });
    expect(parseAddresses('x@y')).toEqual({ ok: [], bad: ['x@y'] });
  });
  it('tables colour a cell only together with its words', () => {
    const html = dataTable(['A', 'B'], [['1', { text: '✔ On target', tone: 'good' }]], [false, true]);
    expect(html).toContain('text-align:right');
    expect(html).toMatch(/color:#1e7b34;font-weight:bold">✔ On target</);
  });
});

describe('PDF helpers', () => {
  it('pixel ratio for about 150 dpi on A4, between 1 and 4', () => {
    expect(pixelRatioFor(794)).toBeCloseTo(1240.2 / 794, 2);
    expect(pixelRatioFor(0)).toBe(1);
    expect(pixelRatioFor(100)).toBe(4);
  });
  it('base64 of bytes and text (large inputs too)', () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2, 250]))).toBe('AAEC+g==');
    expect(textToBase64('été')).toBe('w6l0w6k=');
    const big = new Uint8Array(200_000).fill(65);
    expect(atob(bytesToBase64(big)).length).toBe(200_000);
  });
  it('keeps the woff2 source of a bundled latin font face, absolute against its style sheet; skips latin-ext', () => {
    const latin = '@font-face { font-family: "IBM Plex Sans"; font-weight: 400; src: url("ibm-plex-sans-latin-400-normal.woff2") format("woff2"), url("x.woff") format("woff"); }';
    const f = woff2Face(latin, 'https://acc.test/app/assets/index.css')!;
    expect(f.url).toBe('https://acc.test/app/assets/ibm-plex-sans-latin-400-normal.woff2');
    expect(f.css).toContain(`src: url(${f.url}) format('woff2');`);
    expect(f.css).not.toContain('.woff"');
    expect(woff2Face('@font-face { src: url("a-latin-ext-400.woff2") format("woff2"); unicode-range: U+0100-02BA; }', 'https://x/')).toBeNull();
    expect(woff2Face('.x { color: red }', 'https://x/')).toBeNull();
  });
  it('page breaks fall at the end of the last block that fits; a block taller than a page is cut', () => {
    expect(pageStarts([300, 700, 1000], 1000, 800)).toEqual([0, 700]);
    expect(pageStarts([100, 2000], 2000, 800)).toEqual([0, 100, 900, 1700]);
    expect(pageStarts([], 500, 800)).toEqual([0]);
  });
});

describe('report email body', () => {
  it('holds the six KPI with target status and the key findings, numbers equal to the report', () => {
    const db = buildSyntheticDb();
    const startup = { ...db, years: [2026] } as unknown as Parameters<typeof buildReport>[0]['startup'];
    const rows = db.events;
    const setup = { ...parseSetup(new URLSearchParams('tpl=custom&p=lastmonth&cmp=1')), sections: ['summary' as const] };
    const summary = buildReport({ setup, startup, rows, asOf: '2026-10-12', generatedAt: '2026-10-12 08:00', generatedBy: 'Demo', plant: 'Plant X' });
    const html = reportEmailHtml({ summary, message: 'Monthly numbers', attached: ['r.pdf'] });
    const sec = summary.sections.find((s) => s.id === 'summary');
    expect(sec).toBeTruthy();
    for (const label of ['Total stoppage', 'Failures', 'Reliability factor (RF)', 'Mean restoration time', 'Utilization factor (UF)']) expect(html).toContain(label);
    const kpis = (sec as Extract<typeof sec, { id: 'summary' }>)!.data.kpis;
    for (const id of ['stoppage', 'reliability', 'utilization'] as const) expect(html).toContain(esc(kpis.find((k) => k.id === id)!.text));
    expect(html).toContain('Monthly numbers');
    expect(html).toContain('Attached: r.pdf.');
    expect(html).not.toMatch(/<script|onclick|href=/i);
    expect(reportSubject(summary)).toMatch(/Plant X$/);
  });
});

describe('actions report and its email', () => {
  const base = (over: Partial<Action>): Action => ({
    action_id: 'AC-202610-0001', title: 'Fix seal', detail: 'Leaks', status: 'Open', priority: 'High', source: 'manual', source_ref: '', scope_kind: 'area',
    area_id: 'K.1', line_id: 'L.1', equipment_id: '', reason_key: '', owner_kind: 'internal', owner: '', assignee: 'U1', due_date: '2026-10-10',
    needs_stop: false, root_cause: '', required_action: 'Replace the seal', created_by: 'U1', created_at: '2026-10-01 08:00:00.000', updated_at: '', updated_by: '',
    closed_by: '', closed_at: '', closure_note: '', effectiveness: '', effectiveness_checked_at: '', evidence: [{ note: 'photo taken', added_at: '', added_by: 'U1' }], dedupe_key: '', ...over,
  });
  const actions = [
    base({}),
    base({ action_id: 'AC-202610-0002', title: 'Belt', area_id: 'CR', priority: 'Low', due_date: '' }),
    base({ action_id: 'AC-202609-0003', title: 'Old', status: 'Closed', created_at: '2026-09-02 08:00:00.000' }),
  ];
  const task = (seq: number, status: ActionTask['status']): ActionTask => ({
    task_id: `AT-${seq}`, action_id: 'AC-202610-0001', seq, title: `Step ${seq}`, owner_kind: 'internal', owner: '', assignee: 'U1', due_date: '2026-10-05', status,
    needs_stop: false, est_stop_h: null, notes: '', template_step: '', created_at: '', created_by: '', updated_at: '', updated_by: '', done_at: '', done_by: '', done_note: status === 'Done' ? 'ok' : '',
  });
  const tasks = [task(1, 'Done'), task(2, 'Open')];
  const logs: ActionLog[] = [{ log_id: 'L1', action_id: 'AC-202610-0001', at: '2026-10-02 09:00:00.000', by: 'U1', kind: 'task_status', from_status: 'Open', to_status: 'Done', text: 'ok', task_id: 'AT-1' }];
  const input = { actions, tasks, logs, people: [{ user_id: 'U1', display_name: 'Ali' }], contractors: [], today: '2026-10-18', plant: 'Plant X', generatedAt: '2026-10-18 10:00', generatedBy: 'Ali' };

  it('one area, open actions: the list, counts, tasks and history', () => {
    const m = buildActionsReport({ ...input, filters: { ...defaultActionsFilters(), area: 'K.1' } });
    expect(m.rows.map((r) => r.id)).toEqual(['AC-202610-0001']);
    expect(m.counts).toMatchObject({ total: 1, overdue: 1, tasksOpen: 1, tasksDone: 1 });
    expect(m.scope).toBe('Area K.1 · open actions');
    const d = m.details[0]!;
    expect(d.tasks.map((x) => [x.seq, x.status, x.overdue])).toEqual([[1, 'Done', false], [2, 'Open', true]]);
    expect(d.history[0]!.what).toBe('Task status: #1 Step 1: Open → Done · ok');
    expect(d.facts).toContainEqual(['Tasks', '1 of 2 done']);
    expect(d.evidence).toEqual(['photo taken']);
  });
  it('all areas and all statuses, sorted by status then priority; created-date filter; one action by id', () => {
    const all = buildActionsReport({ ...input, filters: { ...defaultActionsFilters(), status: 'all' } });
    expect(all.rows.map((r) => r.id)).toEqual(['AC-202610-0001', 'AC-202610-0002', 'AC-202609-0003']);
    const sept = buildActionsReport({ ...input, filters: { ...defaultActionsFilters(), status: 'all', to: '2026-09-30' } });
    expect(sept.rows.map((r) => r.id)).toEqual(['AC-202609-0003']);
    const one = buildActionsReport({ ...input, filters: { ...defaultActionsFilters(), id: 'AC-202610-0002' } });
    expect(one.single).toBe(true);
    expect(one.title).toBe('Action report');
    expect(one.details).toHaveLength(1);
  });
  it('the email holds the list (or the one action with its tasks), with overdue marked in words and colour', () => {
    const m = buildActionsReport({ ...input, filters: { ...defaultActionsFilters(), status: 'all' } });
    const html = actionsEmailHtml({ model: m, message: '', attached: ['a.pdf'] });
    expect(html).toContain('AC-202610-0002');
    expect(html).toMatch(/color:#b3261e;font-weight:bold">2026-10-10 !</);
    const one = actionsEmailHtml({ model: buildActionsReport({ ...input, filters: { ...defaultActionsFilters(), id: 'AC-202610-0001' } }), message: 'see', attached: [] });
    expect(one).toContain('Replace the seal');
    expect(one).toContain('Step 2');
  });
});
