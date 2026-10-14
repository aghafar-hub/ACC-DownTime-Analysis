import { beforeAll, describe, expect, it } from 'vitest';
import { createMockApi, type MockApi } from './mockApi';
import { parseActionSettings, plannedOverruns } from './mockActions';
import {
  ACTION_STATUSES, ApiError, contractorForArea, evenMonthlySplit, NOTIFICATION_CATEGORY_OF, NOTIFICATION_TYPES, type AreaTarget, type Contractor, type EventRow,
  type Session,
} from './types';
import { DEMO_PASSWORD } from '../mock/synthetic';
import tables from '../../schema/tables.json';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ApiError ? e.code : `other:${String(e)}`;
  }
}
const NOW = Date.parse('2026-10-14T09:00:00');

describe('action helpers', () => {
  it('even split: 2-decimal months, December takes the rest, the sum is the allowance', () => {
    expect(evenMonthlySplit(240)).toEqual(Array(12).fill(20));
    const s = evenMonthlySplit(100);
    expect(s.slice(0, 11)).toEqual(Array(11).fill(8.33));
    expect(s[11]).toBe(8.37);
    expect(Math.abs(s.reduce((a, b) => a + b, 0) - 100)).toBeLessThan(0.01);
  });
  it('the contractor of an area is the active external one', () => {
    const cs: Contractor[] = [
      { contractor_id: 'OLD', name: 'Old', areas: ['K.1'], kind: 'contractor', active: false, sort_order: 0, default_assignee: '' },
      { contractor_id: 'MEC', name: 'Mechanical', areas: ['K.1'], kind: 'internal', active: true, sort_order: 1, default_assignee: '' },
      { contractor_id: 'RHI', name: 'RHI', areas: ['K.1', 'AFR new'], kind: 'contractor', active: true, sort_order: 2, default_assignee: '' },
    ];
    expect(contractorForArea(cs, 'K.1')?.contractor_id).toBe('RHI');
    expect(contractorForArea(cs, 'AFR new')?.contractor_id).toBe('RHI');
    expect(contractorForArea(cs, 'CM.1')).toBeNull();
    expect(contractorForArea(cs, '')).toBeNull();
  });
  it('settings fall back to the schema defaults', () => {
    const defaults = (tables as unknown as { settingsDefaults: { key: string; value: string }[] }).settingsDefaults;
    expect(parseActionSettings(defaults)).toEqual({ closers: [], repeatN: 3, repeatDays: 30, chronicTop: 10, chronicMonths: 3, effectDays: 60, autoDraft: true });
    expect(parseActionSettings([{ key: 'actions_repeat_n', value: '1' }, { key: 'actions_auto_draft', value: 'false' }, { key: 'actions_closers', value: 'U-1, U-2' }]))
      .toMatchObject({ repeatN: 3, autoDraft: false, closers: ['U-1', 'U-2'] });
  });
  it('every notification type has a category', () => {
    for (const t of NOTIFICATION_TYPES) expect(NOTIFICATION_CATEGORY_OF[t]).toBeTruthy();
    expect(NOTIFICATION_CATEGORY_OF.planned_overrun).toBe('Availability & planned');
    expect(NOTIFICATION_CATEGORY_OF.action_due).toBe('Actions');
  });
  it('planned overrun: overlapping planned stops count once; only complete, recent months; blocked rows left out', () => {
    const row = (id: string, stop: string, start: string, over: Partial<EventRow> = {}): EventRow => ({
      event_id: id, batch_id: 'B', event_date: stop.slice(0, 10), line_id: 'L.1', area_id: 'K.1', code_raw: 'N/A', is_area_level: true, stop_ts: `${stop}:00.000`,
      start_ts: `${start}:00.000`, duration_s: 0, freq: 1, classification: 'PL', criticality: 'NO_INC', is_failure: false, fingerprint: id, edited: false,
      is_void: false, created_at: '', ...over,
    });
    const events = [
      row('EV-a', '2026-03-10 00:00', '2026-03-10 08:00'), row('EV-b', '2026-03-10 04:00', '2026-03-10 12:00'),
      row('EV-c', '2026-03-11 00:00', '2026-03-11 10:00', { classification: '' as never, flags: 'missing_classification' }),
    ];
    const target: AreaTarget = {
      area_id: 'K.1', year: 2026, availability_target_pct: null, planned_allowance_h_year: 120, monthly_split: evenMonthlySplit(120), overhaul_months: [],
      updated_at: '', updated_by: '',
    };
    const areas = [{ area_id: 'K.1', line_id: 'L.1' }];
    const got = plannedOverruns(events, areas, [target], '2026-04-02', '2026-03-03');
    expect(got.map((o) => [o.area, o.month, o.used, o.allowed, o.ytdAllowed, o.eventIds])).toEqual([['K.1', '2026-03', 12, 10, 30, ['EV-a', 'EV-b']]]);
    expect(plannedOverruns(events, areas, [target], '2026-03-30', '2026-03-01')).toEqual([]); // March not complete
    expect(plannedOverruns(events, areas, [target], '2026-05-20', '2026-04-20')).toEqual([]); // March not recent
  });
});

describe('mock actions API', () => {
  let api: MockApi;
  const s: Record<string, Session> = {};
  beforeAll(async () => {
    api = createMockApi();
    api.__setNow(() => NOW);
    for (const r of ['admin', 'manager', 'engineer', 'viewer']) s[r] = await api.login(`${r}@demo.test`, DEMO_PASSWORD, true);
  });

  it('follows the access table: actions View lists, Edit creates, settings Edit saves contractors and targets', async () => {
    expect(await code(api.listActions(s.viewer!.token))).toBe('ok');
    expect(await code(api.createAction(s.viewer!.token, { title: 'x', scope_kind: 'plant' }))).toBe('forbidden');
    expect(await code(api.createAction(s.manager!.token, { title: 'Manager action', scope_kind: 'plant' }))).toBe('ok');
    expect(await code(api.createAction(s.engineer!.token, { title: 'Engineer action', scope_kind: 'area', area_id: 'K.1' }))).toBe('ok');
    expect(await code(api.saveContractors(s.engineer!.token, []))).toBe('forbidden');
    expect(await code(api.saveAreaTargets(s.manager!.token, 2026, []))).toBe('forbidden');
    expect(await code(api.getAreaTargets(s.viewer!.token))).toBe('ok');
    expect(await code(api.runActionChecks(s.engineer!.token))).toBe('forbidden');
    expect(await code(api.runActionChecks(s.admin!.token))).toBe('ok');
    expect(await code(api.listActions(''))).toBe('unauthenticated');
  });

  it('settings for actions are validated like the server', async () => {
    const t = s.admin!.token;
    for (const changes of [{ actions_repeat_n: '1' }, { actions_repeat_days: '0' }, { actions_chronic_top: '101' }, { actions_chronic_months: '25' },
      { actions_effect_days: '0' }, { actions_auto_draft: 'yes' }, { actions_closers: 'U-NOBODY' }] as Record<string, string>[]) {
      expect(await code(api.saveSettings(t, changes)), JSON.stringify(changes)).toBe('bad_request');
    }
    await api.saveSettings(t, { actions_closers: ' U-DEMO-MGR , U-DEMO-MGR ' });
    expect((await api.getStartup(t)).settings.find((x) => x.key === 'actions_closers')?.value).toBe('U-DEMO-MGR');
    expect((await api.listActions(s.manager!.token)).can_close).toBe(true);
    expect((await api.listActions(s.engineer!.token)).can_close).toBe(false);
  });

  it('merges by dedupe key and keeps the history in order', async () => {
    const t = s.engineer!.token;
    const first = await api.createAction(t, { title: 'Area thing', scope_kind: 'area', area_id: 'CR', dedupe_key: 'manual|cr' });
    const again = await api.createAction(t, { title: 'Same thing', scope_kind: 'area', area_id: 'CR', dedupe_key: 'manual|cr', evidence: [{ note: 'second report' }] });
    expect(again.merged).toBe(true);
    expect(again.action.action_id).toBe(first.action.action_id);
    expect(again.logs.map((l) => l.kind)).toEqual(['status', 'evidence']);
    const c = await api.addActionComment(t, first.action.action_id, 'Called the shift lead');
    expect(c.logs.map((l) => l.kind)).toEqual(['status', 'evidence', 'comment']);
  });
});

describe('demo mode', () => {
  it('fills the board: drafts from the rules, every column, targets, categories and an overdue alert', async () => {
    const api = createMockApi({ demoActions: true });
    api.__setNow(() => NOW);
    const admin = await api.login('admin@demo.test', DEMO_PASSWORD, true);
    const list = await api.listActions(admin.token);
    expect(list.actions.length).toBeGreaterThanOrEqual(7);
    const statuses = new Set(list.actions.map((a) => a.status));
    for (const st of ACTION_STATUSES) expect(statuses.has(st), st).toBe(true);
    expect(list.actions.some((a) => a.status === 'Draft' && a.source.startsWith('auto_') && a.created_by === 'system')).toBe(true);
    expect(list.actions.some((a) => a.source === 'manual')).toBe(true);
    expect(list.actions.find((a) => a.status === 'Closed')?.closure_note).toBeTruthy();
    expect(list.actions.every((a) => /^AC-\d{6}-\d{4}$/.test(a.action_id))).toBe(true);
    expect(list.contractors.map((c) => c.contractor_id)).toEqual(['RHI', 'ASEC', 'MEC', 'ELE', 'AUT', 'PRO']);
    expect((await api.getAreaTargets(admin.token, 2026)).map((x) => x.area_id)).toEqual(['CR', 'RM.1', 'K.1', 'CM.1', 'PK.1', 'K.2']);
    const items = (await api.getNotifications(admin.token)).items;
    expect(items.every((n) => n.category === NOTIFICATION_CATEGORY_OF[n.type])).toBe(true);
    expect(items.some((n) => n.type === 'action_due')).toBe(true);
    // the plain test instance stays empty
    const plain = createMockApi();
    const t = (await plain.login('admin@demo.test', DEMO_PASSWORD, true)).token;
    expect((await plain.listActions(t)).actions).toEqual([]);
  });
});
