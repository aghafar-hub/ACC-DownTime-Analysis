import { describe, expect, it } from 'vitest';
import type { Action, ActionStatus, Contractor } from '../api/types';
import {
  actionsCsvRows, activeFilterCount, countByStatus, dedupeKeyOf, defaultDue, defaultOwnerFor, dueInfo, emptyFilters, filterActions, filterActionsExceptStatus,
  groupByStatus, initials, isOverdue, mergeTarget, newEvidence, nextStatus, noteProblem, openByAge, openByArea, openByOwner, openedVsClosed,
  overdueCount, parseActionFilters, personName, sortActions, statusOptions, summarize, watchDaysLeft, writeActionFilters,
} from './model';

const TODAY = '2026-10-14';
let n = 0;
const act = (over: Partial<Action> = {}): Action => ({
  action_id: `AC-202610-${String(++n).padStart(4, '0')}`, title: 'Belt torn', detail: '', status: 'Open', priority: 'Medium', source: 'manual', source_ref: '',
  scope_kind: 'equipment', area_id: 'K.1', line_id: 'L.1', equipment_id: '131.BC100', reason_key: 'belt torn', owner_kind: 'contractor', owner: 'RHI',
  assignee: 'U-1', due_date: '', needs_stop: false, root_cause: '', required_action: '', created_by: 'U-1', created_at: '2026-10-01 08:00:00.000',
  updated_at: '2026-10-01 08:00:00.000', updated_by: 'U-1', closed_by: '', closed_at: '', closure_note: '', effectiveness: '', effectiveness_checked_at: '',
  evidence: [], dedupe_key: 'repeat|131.BC100|belt torn', ...over,
});
const contractors: Contractor[] = [
  { contractor_id: 'RHI', name: 'RHI', areas: ['K.1', 'K.2'], kind: 'contractor', active: true, sort_order: 1, default_assignee: 'U-9' },
  { contractor_id: 'ASEC', name: 'ASEC', areas: ['CM.1'], kind: 'contractor', active: false, sort_order: 2, default_assignee: '' },
  { contractor_id: 'MEC', name: 'Mechanical', areas: [], kind: 'internal', active: true, sort_order: 3, default_assignee: '' },
];
const people = [{ user_id: 'U-1', display_name: 'A. Ghafar' }, { user_id: 'U-2', display_name: 'M. Saleh' }];
const env = { today: TODAY, me: 'U-1', people, contractors };

describe('due dates and overdue', () => {
  it('overdue = open with a due date before today; closed ones never are', () => {
    expect(isOverdue(act({ due_date: '2026-10-13' }), TODAY)).toBe(true);
    expect(isOverdue(act({ due_date: TODAY }), TODAY)).toBe(false);
    expect(isOverdue(act({ due_date: '2026-10-01', status: 'Closed' }), TODAY)).toBe(false);
    expect(isOverdue(act({ due_date: '' }), TODAY)).toBe(false);
    expect(overdueCount([act({ due_date: '2026-10-01' }), act({ due_date: '2026-10-02', status: 'Cancelled' }), act({ due_date: '2026-12-01' })], TODAY)).toBe(1);
  });
  it('words and tone of the due date', () => {
    expect(dueInfo(act({ due_date: '2026-10-02' }), TODAY)).toMatchObject({ text: '12 d overdue', tone: 'overdue', days: -12 });
    expect(dueInfo(act({ due_date: TODAY }), TODAY)).toMatchObject({ text: 'Due today', tone: 'soon' });
    expect(dueInfo(act({ due_date: '2026-10-18' }), TODAY)).toMatchObject({ text: 'Due 18 Oct', tone: 'soon' });
    expect(dueInfo(act({ due_date: '2026-11-30' }), TODAY)).toMatchObject({ tone: 'ok' });
    expect(dueInfo(act({ due_date: '' }), TODAY)).toMatchObject({ text: 'Due not set', tone: 'none' });
  });
  it('default due date by priority', () => {
    expect(defaultDue('High', TODAY)).toBe('2026-10-28');
    expect(defaultDue('Medium', TODAY)).toBe('2026-11-13');
    expect(defaultDue('Low', TODAY)).toBe('2026-12-13');
  });
});

describe('filters', () => {
  const list = [
    act({ action_id: 'AC-1', status: 'Draft', area_id: 'K.1', assignee: '', priority: 'High', source: 'auto_repeat' }),
    act({ action_id: 'AC-2', status: 'Open', area_id: 'K.2', due_date: '2026-10-01', title: 'Chute blockage', equipment_id: '141.VL170' }),
    act({ action_id: 'AC-3', status: 'Closed', area_id: 'CM.1', owner: 'MEC', assignee: 'U-2', created_by: 'U-2' }),
    act({ action_id: 'AC-4', status: 'Cancelled', area_id: 'K.1' }),
    act({ action_id: 'AC-5', status: 'In progress', scope_kind: 'plant', area_id: '', line_id: '', owner: '' }),
  ];
  const ids = (l: Action[]) => l.map((a) => a.action_id);
  it('active hides cancelled unless asked; open keeps only open statuses; one status', () => {
    const f = emptyFilters();
    expect(ids(filterActions(list, f, env))).toEqual(['AC-1', 'AC-2', 'AC-3', 'AC-5']);
    expect(ids(filterActions(list, { ...f, cancelled: true }, env))).toContain('AC-4');
    expect(ids(filterActions(list, { ...f, status: 'open' }, env))).toEqual(['AC-1', 'AC-2', 'AC-5']);
    expect(ids(filterActions(list, { ...f, status: 'all' }, env))).toHaveLength(5);
    expect(ids(filterActions(list, { ...f, status: 'Closed' }, env))).toEqual(['AC-3']);
  });
  it('area, owner (contractor), person, priority, source, overdue, mine; "-" = nobody', () => {
    const f = { ...emptyFilters(), status: 'all' as const };
    expect(ids(filterActions(list, { ...f, areas: ['K.1'] }, env))).toEqual(['AC-1', 'AC-4']);
    expect(ids(filterActions(list, { ...f, areas: ['-'] }, env))).toEqual(['AC-5']);
    expect(ids(filterActions(list, { ...f, owners: ['MEC'] }, env))).toEqual(['AC-3']);
    expect(ids(filterActions(list, { ...f, owners: ['-'] }, env))).toEqual(['AC-5']);
    expect(ids(filterActions(list, { ...f, assignees: ['-'] }, env))).toEqual(['AC-1']);
    expect(ids(filterActions(list, { ...f, priorities: ['High'] }, env))).toEqual(['AC-1']);
    expect(ids(filterActions(list, { ...f, sources: ['auto_repeat'] }, env))).toEqual(['AC-1']);
    expect(ids(filterActions(list, { ...f, overdue: true }, env))).toEqual(['AC-2']);
    expect(ids(filterActions(list, { ...f, mine: true }, env))).toEqual(['AC-1', 'AC-2', 'AC-4', 'AC-5']); // assigned to me or created by me
  });
  it('search: id, equipment, title, contractor and person names, every word', () => {
    const f = { ...emptyFilters(), status: 'all' as const };
    expect(ids(filterActions(list, { ...f, q: 'vl170 chute' }, env))).toEqual(['AC-2']);
    expect(ids(filterActions(list, { ...f, q: 'ac-3' }, env))).toEqual(['AC-3']);
    expect(ids(filterActions(list, { ...f, q: 'saleh' }, env))).toEqual(['AC-3']);
    expect(ids(filterActions(list, { ...f, q: 'mechanical' }, env))).toEqual(['AC-3']);
  });
  it('the counts per status ignore the status filter', () => {
    const c = countByStatus(filterActionsExceptStatus(list, { ...emptyFilters(), status: 'Closed' }, env));
    expect(c).toMatchObject({ Draft: 1, Open: 1, Closed: 1, Cancelled: 1, 'In progress': 1, 'Waiting stoppage': 0 });
  });
  it('round trip through the address', () => {
    const f = { ...emptyFilters(), q: 'belt', status: 'Open' as const, areas: ['K.1', 'K.2'], owners: ['RHI'], mine: true, overdue: true, priorities: ['High' as const], sources: ['report' as const] };
    const sp = writeActionFilters(new URLSearchParams('view=list&id=AC-1'), f);
    expect(sp.get('view')).toBe('list');
    expect(sp.get('id')).toBe('AC-1');
    expect(parseActionFilters(sp)).toEqual(f);
    expect(activeFilterCount(f)).toBe(6);
    expect(parseActionFilters(new URLSearchParams('st=nonsense&pri=Huge&src=bad'))).toEqual(emptyFilters());
  });
});

describe('sorting and grouping', () => {
  const list = [
    act({ action_id: 'A', due_date: '', priority: 'High', created_at: '2026-10-05 00:00:00.000', updated_at: '2026-10-09 00:00:00.000' }),
    act({ action_id: 'B', due_date: '2026-10-20', priority: 'Low', created_at: '2026-10-02 00:00:00.000', updated_at: '2026-10-11 00:00:00.000' }),
    act({ action_id: 'C', due_date: '2026-10-10', priority: 'Medium', created_at: '2026-10-08 00:00:00.000', updated_at: '2026-10-03 00:00:00.000' }),
  ];
  const ids = (l: Action[]) => l.map((a) => a.action_id);
  it('due date: nearest (overdue) first, no due date last', () => expect(ids(sortActions(list, 'due'))).toEqual(['C', 'B', 'A']));
  it('priority, newest, oldest, last changed', () => {
    expect(ids(sortActions(list, 'priority'))).toEqual(['A', 'C', 'B']);
    expect(ids(sortActions(list, 'newest'))).toEqual(['C', 'A', 'B']);
    expect(ids(sortActions(list, 'oldest'))).toEqual(['B', 'A', 'C']);
    expect(ids(sortActions(list, 'updated'))).toEqual(['B', 'A', 'C']);
  });
  it('groups every status, empty ones included', () => {
    const g = groupByStatus([act({ status: 'Draft' }), act({ status: 'Draft' }), act({ status: 'Closed' })]);
    expect(Object.keys(g)).toEqual(['Draft', 'Open', 'Contractor informed', 'Waiting stoppage', 'In progress', 'Closed', 'Cancelled']);
    expect(g.Draft).toHaveLength(2);
    expect(g.Open).toHaveLength(0);
  });
});

describe('status changes', () => {
  it('next status follows the board; waiting stoppage only when a stop is needed; closing only for closers', () => {
    expect(nextStatus(act({ status: 'Draft' }), false)).toBe('Open');
    expect(nextStatus(act({ status: 'Contractor informed' }), false)).toBe('In progress');
    expect(nextStatus(act({ status: 'Contractor informed', needs_stop: true }), false)).toBe('Waiting stoppage');
    expect(nextStatus(act({ status: 'In progress' }), false)).toBeNull();
    expect(nextStatus(act({ status: 'In progress' }), true)).toBe('Closed');
    expect(nextStatus(act({ status: 'Closed' }), true)).toBeNull();
  });
  it('options: any open status freely; Closed / Cancelled only for closers; a closed action only reopens to Open', () => {
    const allowed = (s: ActionStatus, close: boolean) => statusOptions(act({ status: s }), close).filter((o) => o.allowed).map((o) => o.status);
    expect(allowed('Open', false)).toEqual(['Draft', 'Contractor informed', 'Waiting stoppage', 'In progress']);
    expect(allowed('Open', true)).toEqual(['Draft', 'Contractor informed', 'Waiting stoppage', 'In progress', 'Closed', 'Cancelled']);
    expect(allowed('Closed', true)).toEqual(['Open']);
    expect(allowed('Closed', false)).toEqual([]);
    expect(statusOptions(act({ status: 'Open' }), true).find((o) => o.next)?.status).toBe('Contractor informed');
  });
  it('closing and cancelling need a note of at least 3 characters', () => {
    expect(noteProblem('Closed', '  ok ')).not.toBeNull();
    expect(noteProblem('Closed', 'Done')).toBeNull();
    expect(noteProblem('Cancelled', '')).toMatch(/cancelled/);
    expect(noteProblem('In progress', '')).toBeNull();
  });
});

describe('summary cards', () => {
  const list = [
    act({ status: 'Draft', assignee: '', area_id: 'K.1', created_at: '2026-10-12 00:00:00.000' }),
    act({ status: 'Open', area_id: 'K.1', due_date: '2026-10-01', owner: 'RHI', created_at: '2026-08-01 00:00:00.000' }),
    act({ status: 'In progress', area_id: 'K.2', owner: '', created_at: '2026-09-01 00:00:00.000' }),
    act({ status: 'Closed', closed_at: '2026-09-20 10:00:00.000', effectiveness: 'Effective', created_at: '2026-06-01 00:00:00.000' }),
    act({ status: 'Closed', closed_at: '2026-10-02 10:00:00.000', effectiveness: 'Not effective' }),
    act({ status: 'Closed', closed_at: '2026-10-10 10:00:00.000', effectiveness: 'Watching' }),
    act({ status: 'Closed', closed_at: '2026-01-02 10:00:00.000', effectiveness: 'Effective' }),
    act({ status: 'Cancelled', closed_at: '2026-10-02 10:00:00.000' }),
  ];
  it('open, overdue, drafts, no owner and effectiveness of the last 90 days', () => {
    const s = summarize(list, TODAY);
    expect(s).toMatchObject({ open: 3, overdue: 1, drafts: 1, noOwner: 1, noOwnerDrafts: 1, closedRecent: 3, cancelled: 1, effective: 1, notEffective: 1, watching: 1 });
    expect(s.overdueBy.get('RHI')).toBe(1);
  });
  it('open by area and by owner, most first', () => {
    expect(openByArea(list).map((r) => [r.area, r.total])).toEqual([['K.1', 2], ['K.2', 1]]);
    expect(openByArea(list)[0]!.byStatus).toEqual({ Draft: 1, Open: 1 });
    expect(openByOwner(list, TODAY)).toEqual([{ owner: 'RHI', total: 2, overdue: 1 }, { owner: '', total: 1, overdue: 0 }]);
  });
  it('opened and closed per month, the last six months', () => {
    const m = openedVsClosed(list, TODAY);
    expect(m.map((x) => x.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(m.find((x) => x.month === '2026-10')).toMatchObject({ label: 'Oct', closed: 2 });
    expect(m.find((x) => x.month === '2026-09')).toMatchObject({ opened: 1, closed: 1 });
  });
  it('open by age', () => {
    const a = openByAge(list, TODAY);
    expect(a.buckets.map((b) => b.count)).toEqual([1, 0, 1, 1]);
    expect(a.over30).toBe(2);
    expect(a.oldest?.days).toBe(74);
  });
});

describe('creating, merging, people', () => {
  it('the dedupe key of an equipment action with a reason', () => {
    expect(dedupeKeyOf({ scope_kind: 'equipment', equipment_id: '131.bc100', reason_key: '  Belt   TORN ' })).toBe('repeat|131.BC100|belt torn');
    expect(dedupeKeyOf({ scope_kind: 'equipment', equipment_id: '131.BC100', reason_key: '' })).toBe('');
    expect(dedupeKeyOf({ scope_kind: 'area', equipment_id: '', reason_key: 'x' })).toBe('');
    expect(dedupeKeyOf({ scope_kind: 'area', dedupe_key: 'k' })).toBe('k');
  });
  it('the open action a new one would be merged into (the oldest open one)', () => {
    const old = act({ action_id: 'OLD', created_at: '2026-09-01 00:00:00.000' });
    const newer = act({ action_id: 'NEW', created_at: '2026-10-01 00:00:00.000' });
    const closed = act({ action_id: 'CL', status: 'Closed', created_at: '2026-08-01 00:00:00.000' });
    expect(mergeTarget([newer, closed, old], { scope_kind: 'equipment', equipment_id: '131.BC100', reason_key: 'Belt torn' })?.action_id).toBe('OLD');
    expect(mergeTarget([closed], { scope_kind: 'equipment', equipment_id: '131.BC100', reason_key: 'Belt torn' })).toBeNull();
  });
  it('the contractor of the area (active external only) and its default person', () => {
    expect(defaultOwnerFor(contractors, 'K.2')).toEqual({ owner: 'RHI', assignee: 'U-9', auto: true });
    expect(defaultOwnerFor(contractors, 'CM.1')).toEqual({ owner: '', assignee: '', auto: false });
    expect(defaultOwnerFor(contractors, '')).toMatchObject({ auto: false });
  });
  it('names and initials', () => {
    expect(personName(people, 'U-2')).toBe('M. Saleh');
    expect(personName(people, 'system')).toBe('System');
    expect(personName(people, 'Free Name')).toBe('Free Name');
    expect(initials('A. Ghafar')).toBe('AG');
    expect(initials('Demo Admin')).toBe('DA');
  });
  it('new evidence since opened, and the effectiveness watch', () => {
    const a = act({ created_at: '2026-10-01 08:00:00.000', evidence: [
      { event_id: 'EV-1', added_at: '2026-10-01 08:00:00.000', added_by: 'U-1' },
      { event_id: 'EV-2', added_at: '2026-10-05 08:00:00.000', added_by: 'system' },
      { note: 'photo', added_at: '2026-10-06 08:00:00.000', added_by: 'U-1' },
    ] });
    expect(newEvidence(a)).toBe(1);
    expect(watchDaysLeft(act({ status: 'Closed', effectiveness: 'Watching', closed_at: '2026-09-14 10:00:00.000' }), TODAY, 60)).toBe(30);
    expect(watchDaysLeft(act({ status: 'Closed', effectiveness: 'Effective', closed_at: '2026-09-14 10:00:00.000' }), TODAY, 60)).toBeNull();
  });
  it('CSV rows', () => {
    const rows = actionsCsvRows([act({ action_id: 'AC-9', due_date: '2026-10-01' })], { people, contractors, today: TODAY });
    expect(rows[0]![0]).toBe('Action');
    expect(rows[1]!.slice(0, 3)).toEqual(['AC-9', 'Open', 'Medium']);
    expect(rows[1]![rows[0]!.indexOf('Overdue')]).toBe('yes');
    expect(rows[1]![rows[0]!.indexOf('Owner')]).toBe('A. Ghafar');
  });
});
