import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_GROUP_ACTIONS, auditGroupOf } from '../../api/auditGroups';
import { AUDIT_GROUPS, type AuditEntry } from '../../api/types';
import { actorName, agoText, auditSentence, changesText, pageNameOf } from './activityText';

const e = (action: string, entity_id: string, detail: string, user_id = 'U-1'): AuditEntry => ({
  at: '2026-10-14 10:00:00.000', user_id, action, entity: '', entity_id, detail, group: auditGroupOf(action),
});
const names = new Map([['U-1', 'Mona Engineer'], ['U-2', 'Sami Viewer']]);
const name = (id: string) => actorName(id, names);

describe('activity log sentences', () => {
  it('turns the stored details into plain English', () => {
    expect(auditSentence(e('save_setting', 'availability_target_pct', '85 -> 88'), name)).toBe('Changed setting availability_target_pct from 85 to 88');
    expect(auditSentence(e('save_setting', 'target_mttr_h', '(none) -> 4'), name)).toBe('Changed setting target_mttr_h from (not set) to 4');
    expect(auditSentence(e('edit_event', 'EV-1', 'reason_raw: Belt -> Belt torn; freq: 1 -> 0. Note: from the shift report'), name))
      .toBe('Edited event EV-1: reason Belt → Belt torn, freq 1 → 0. Note: from the shift report');
    expect(auditSentence(e('edit_event', 'EV-2', 'Changed reason_raw. Note: older server'), name)).toBe('Edited event EV-2 (reason). Note: older server');
    expect(auditSentence(e('upload_finish', 'B-1', 'File July_2026.xlsx. Read 2606, added 2594, identical 12, skipped 0, warnings 31'), name))
      .toBe('Uploaded July_2026.xlsx: +2,594 rows (read 2,606, 12 already stored, 0 skipped, 31 warnings)');
    expect(auditSentence(e('upload_finish', 'B-1', 'Read 5, added 5, identical 0, skipped 0, warnings 0'), name)).toBe('Finished upload B-1: +5 rows (read 5, 0 already stored, 0 skipped, 0 warnings)');
    expect(auditSentence(e('update_user', 'U-2', 'role_id: ROLE-VIEW -> ROLE-ENG'), name)).toBe('Changed user Sami Viewer: role Viewer → Engineer');
    expect(auditSentence(e('set_tab_access', 'U-2', 'upload: role default -> Edit'), name)).toBe('Changed the page access of Sami Viewer: upload role default → Edit');
    expect(auditSentence(e('deactivate_area', 'AFR', 'Area switched off: AFR on L.1'), name)).toBe('Switched area AFR off (its records are left out everywhere)');
    expect(auditSentence(e('comment_action', 'ACT-1', 'Seal ordered'), name)).toBe('Commented on action ACT-1: “Seal ordered”');
    expect(auditSentence(e('login_failed', 'U-1', 'Wrong password (1 of 5)'), name)).toBe('Failed sign-in (wrong password (1 of 5))');
    expect(auditSentence(e('something_new', 'X', 'detail'), name)).toBe('something new X: detail');
  });

  it('backend 1.7.0: task writes read in plain English, with before → after', () => {
    expect(auditSentence(e('create_task', 'AT-1', 'AC-202610-0012: #5 Moisture alarm (AUT, due 2026-10-20)'), name))
      .toBe('Added task 5 to action AC-202610-0012: Moisture alarm (AUT, due 2026-10-20)');
    expect(auditSentence(e('create_task', 'AT-1', 'AC-202610-0012: #1 Repair (RHI). Action status: Open -> In progress'), name))
      .toBe('Added task 1 to action AC-202610-0012: Repair (RHI). Action status Open → In progress');
    expect(auditSentence(e('update_task', 'AT-1', 'AC-202610-0012 #2: status: In progress -> Done (5-why sheet attached); due_date: 2026-10-12 -> 2026-10-15; action status: Open -> In progress'), name))
      .toBe('Changed task 2 of action AC-202610-0012: status In progress → Done (5-why sheet attached), due date 2026-10-12 → 2026-10-15, action status Open → In progress');
    expect(auditSentence(e('update_task', 'AT-1', 'AC-202610-0012 #3: note: booked for the RM.1 stop'), name))
      .toBe('Changed task 3 of action AC-202610-0012: note “booked for the RM.1 stop”');
    expect(auditSentence(e('update_task', 'AT-1', 'AC-1 #1: est_stop_h: (blank) -> 6; assignee: (blank) -> U-1'), name))
      .toBe('Changed task 1 of action AC-1: estimated stop hours (blank) → 6, person (blank) → Mona Engineer');
    expect(auditSentence(e('apply_template', 'AC-1', 'Template Planned overrun: 2 tasks added (Review planned work, Adjust allowance or plan)'), name))
      .toBe('Applied a task template to action AC-1: Planned overrun: 2 tasks added (Review planned work, Adjust allowance or plan)');
    expect(auditSentence(e('save_task_templates', 'TT-PLANNED,TT-1', 'TT-PLANNED applies_to: auto_planned_overrun -> auto_planned_overrun,manual. TT-1 added: Belt (1 tasks: Look (MEC, +3 d))'), name))
      .toBe('Saved task templates TT-PLANNED, TT-1: TT-PLANNED suggested first for auto_planned_overrun → auto_planned_overrun,manual, TT-1 added Belt (1 tasks: Look (MEC, +3 d))');
    expect(auditSentence(e('migrate_actions', '', 'Moved 2 action(s) to tasks: AC-1 (Contractor informed), AC-2 (Waiting stoppage)', 'setup'), name))
      .toBe('Moved the old action statuses Contractor informed and Waiting stoppage to tasks (version 1.7.0): Moved 2 action(s) to tasks: AC-1 (Contractor informed), AC-2 (Waiting stoppage)');
    for (const a of ['create_task', 'update_task', 'apply_template']) expect(auditGroupOf(a)).toBe('actions');
    expect(auditGroupOf('save_task_templates')).toBe('settings');
    expect(auditGroupOf('migrate_actions')).toBe('system');
  });

  it('names people, and the server itself in plain words', () => {
    expect(name('U-1')).toBe('Mona Engineer');
    expect(name('system')).toBe('System (automatic)');
    expect(name('setup')).toBe('Setup (Apps Script editor)');
    expect(name('U-unknown')).toBe('U-unknown');
    expect(changesText('active: yes -> no')).toBe('active yes → no');
  });

  it('page names and relative times', () => {
    expect(pageNameOf('/dashboard')).toBe('Dashboard');
    expect(pageNameOf('/settings/areas')).toBe('Settings › Areas');
    expect(pageNameOf('/notifications')).toBe('Notifications');
    expect(pageNameOf('')).toBe('');
    expect(agoText('2026-10-14 10:00:00.000', '2026-10-14 10:00:20.000')).toBe('just now');
    expect(agoText('2026-10-14 10:00:00.000', '2026-10-14 10:04:00.000')).toBe('4 min ago');
    expect(agoText('2026-10-14 07:00:00.000', '2026-10-14 10:04:00.000')).toBe('3 h ago');
    expect(agoText('2026-10-12 07:00:00.000', '2026-10-14 10:04:00.000')).toBe('2 days ago');
    expect(agoText('', '2026-10-14 10:04:00.000')).toBe('');
  });

  it('the kinds of change match the backend (Audit.js AUDIT_GROUPS_)', () => {
    const src = readFileSync(resolve(__dirname, '../../../backend/apps-script/Audit.js'), 'utf8');
    const block = src.slice(src.indexOf('var AUDIT_GROUPS_ = {'), src.indexOf('};', src.indexOf('var AUDIT_GROUPS_ = {')));
    const server = Object.fromEntries([...block.matchAll(/^\s+(\w+): \[([^\]]*)\]/gm)].map((m) => [m[1], [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])]));
    expect(server).toEqual(AUDIT_GROUP_ACTIONS);
    expect(Object.keys(AUDIT_GROUP_ACTIONS)).toEqual([...AUDIT_GROUPS]);
  });
});
