// Plain-English text for Settings > Active users and Settings > Activity log (backend 1.6.0). Pure functions, tested in
// activityText.test.ts. The audit log keeps short technical details ("field: old -> new; ..."); this turns them into
// sentences such as "Changed setting availability_target_pct from 85 to 88".
import type { AuditEntry, AuditGroup } from '../../api/types';
import { t } from '../../i18n/t';
import { NOTIFICATIONS_PATH, pageForPath, pageLabel, ROLE_LABELS, settingsSubFromPath, settingsSubLabel } from '../../navigation';
import { num } from '../../util/format';
import { parseTs } from '../../util/normalize';

export const AUDIT_GROUP_LABELS: Record<AuditGroup, string> = {
  signin: 'Sign-in',
  users: 'Users & access',
  settings: 'Settings',
  master: 'Master data',
  events: 'Events & Validate',
  upload: 'Upload',
  actions: 'Actions',
  areas: 'Areas',
  notifications: 'Notifications',
  system: 'System',
};
export const auditGroupLabel = (g: AuditGroup): string => t(AUDIT_GROUP_LABELS[g] ?? g);

/** Who did it: the person's name, or a plain word for the server's own entries. */
export function actorName(userId: string, names: ReadonlyMap<string, string>): string {
  if (!userId || userId === 'system') return t('System (automatic)');
  if (userId === 'setup') return t('Setup (Apps Script editor)');
  return names.get(userId) ?? userId;
}

/** Action sources (task templates' "suggested first for") in words. */
const SOURCE_WORDS: Record<string, string> = {
  auto_repeat: 'repeated failure drafts', auto_chronic: 'chronic equipment drafts', auto_long_stop: 'long stop drafts',
  auto_planned_overrun: 'planned overrun drafts', notification: 'notifications', report: 'reports', pareto: 'Causes', event: 'events', manual: 'new actions',
};
const roleText = (s: string): string => s
  .replace(/\bROLE-[A-Z]+\b/g, (r) => ROLE_LABELS[r] ?? r)
  .replace(/\b(auto_repeat|auto_chronic|auto_long_stop|auto_planned_overrun)\b/g, (x) => SOURCE_WORDS[x] ?? x);

/** Column names in words (anything else: underscores become spaces). */
const FIELD_WORDS: Record<string, string> = {
  role_id: 'role', display_name: 'name', reason_raw: 'reason', code_raw: 'code', stop_ts: 'stop', start_ts: 'start', is_failure: 'failure',
  accepted_flags: 'kept as entered', line_id: 'line', area_id: 'area', event_date: 'date', text_as_listed: 'text', order_no: 'order',
  equipment_type: 'type', parent_id: 'parent', in_downtime_sheet: 'in the downtime sheet', sort_order: 'order', is_void: 'void',
  planned_allowance_h_year: 'planned hours a year', availability_target_pct: 'availability target %', overhaul_months: 'overhaul months',
  default_assignee: 'default assignee', due_date: 'due date', needs_stop: 'needs a stop', root_cause: 'root cause', required_action: 'required action',
  // backend 1.7.0: tasks and task templates
  est_stop_h: 'estimated stop hours', assignee: 'person', action_status: 'action status', applies_to: 'suggested first for', tasks: 'tasks',
};
export const fieldWord = (f: string): string => t(FIELD_WORDS[f] ?? f.replace(/_/g, ' '));

/** 'a: x -> y; b: p -> q' -> 'a x → y, b p → q' (role ids as names). */
export function changesText(detail: string): string {
  return roleText(String(detail ?? ''))
    .split(/;\s*/)
    .filter(Boolean)
    .map((part) => part.replace(/^([a-z_]+): /, (_m, f: string) => `${fieldWord(f)} `).replace(/ -> /g, ' → '))
    .join(', ');
}

const fmtNum = (s: string): string => num(Number(s));

/** One sentence for one audit entry. `name` turns a user id into a name. */
export function auditSentence(e: AuditEntry, name: (id: string) => string): string {
  const id = e.entity_id;
  const d = String(e.detail ?? '');
  const withNote = (head: string, rest: string) => (rest ? `${head}: ${rest}` : head);
  switch (e.action) {
    case 'login': return t('Signed in');
    case 'login_failed': return t('Failed sign-in ({detail})', { detail: d.replace(/^Wrong password/, t('wrong password')) });
    case 'login_locked': return t('Account locked: {detail}', { detail: d });
    case 'logout': return t('Signed out');
    case 'change_password': return t('Changed their own password');
    case 'create_first_admin': return t('Created the first Admin ({detail})', { detail: d });
    case 'create_user': return t('Added user {who} ({detail})', { who: name(id), detail: roleText(d).replace(' as ', t(' as ')) });
    case 'update_user': return withNote(t('Changed user {who}', { who: name(id) }), d === 'No change' ? '' : changesText(d));
    case 'reset_password': return t('Reset the password of {who} (a temporary password was issued)', { who: name(id) });
    case 'set_tab_access': return withNote(t('Changed the page access of {who}', { who: name(id) }), d === 'No change' ? '' : changesText(d));
    case 'save_setting': {
      const m = /^(.*) -> (.*)$/.exec(d);
      if (!m) return t('Changed setting {key}', { key: id });
      const from = m[1] === '(none)' || m[1] === '' ? t('(not set)') : m[1];
      const to = m[2] === '' ? t('(blank)') : m[2];
      return t('Changed setting {key} from {from} to {to}', { key: id, from, to });
    }
    case 'save_contractors': return withNote(t('Saved contractors {ids}', { ids: id.replace(/,/g, ', ') }), d === 'No change' || /contractor row\(s\) saved$/.test(d) ? '' : changesText(d.replace(/\. /g, '; ')));
    case 'save_area_targets': return withNote(t('Saved the area targets for {year}', { year: id }), d === 'No change' || /^[A-Z0-9.,\s]+$/.test(d) ? '' : changesText(d.replace(/\. /g, '; ')));
    case 'add_equipment': return withNote(t('Added equipment {id}', { id }), d.replace(/^Areas: /, t('areas ')));
    case 'update_equipment': return withNote(t('Edited equipment {id}', { id }), d === 'No change' ? '' : d.startsWith('Areas: ') ? d.replace(/^Areas: /, t('areas ')) : changesText(d));
    case 'add_area': return withNote(t('Added area {id}', { id }), d);
    case 'update_area': return withNote(t('Edited area {id}', { id }), d === 'No change' || / on [A-Z0-9.]+$/.test(d) ? '' : changesText(d));
    case 'add_reason': return withNote(t('Added reason {id}', { id }), d);
    case 'update_reason': return withNote(t('Edited reason {id}', { id }), d === 'No change' || /^[A-Z]{2,3}: /.test(d) ? '' : changesText(d));
    case 'add_alias': return withNote(t('Added alias {id}', { id }), d.replace(/^Points to/, t('points to')));
    case 'update_alias': return withNote(t('Changed alias {id}', { id }), d.replace(/^Points to/, t('points to')));
    case 'delete_alias': return withNote(t('Deleted alias {id}', { id }), d.replace(/^Was pointing to/, t('was pointing to')));
    case 'edit_event': {
      const at = d.lastIndexOf('. Note: ');
      const body = at >= 0 ? d.slice(0, at) : d;
      const note = at >= 0 ? d.slice(at + 8) : '';
      const old = /^Changed (.*)$/.exec(body);
      const what = old ? ` (${old[1].split(/,\s*/).map(fieldWord).join(', ')})` : `: ${changesText(body)}`;
      return `${t('Edited event {id}', { id })}${what}${note ? `. ${t('Note: {note}', { note })}` : ''}`;
    }
    case 'void_event': return `${t('Voided event {id}', { id })}${d ? `. ${d}` : ''}`;
    case 'unvoid_event': return `${t('Restored voided event {id}', { id })}${d ? `. ${d}` : ''}`;
    case 'accept_event_flags': return `${t('Event {id}', { id })}: ${d.replace(/^Kept as entered: /, t('kept as entered: ')).replace(/^Undid keep as entered/, t('undid keep as entered'))}`;
    case 'revalidate_events': {
      const m = /^Checked (\d+), changed (\d+)$/.exec(d);
      const scope = id === 'all' || !id ? t('every year') : id;
      return m ? t('Re-checked the records of {scope}: {checked} checked, {changed} changed', { scope, checked: fmtNum(m[1]), changed: fmtNum(m[2]) }) : t('Re-checked the records of {scope}', { scope });
    }
    case 'upload_start': return t('Started uploading {file}', { file: d || id });
    case 'upload_chunk': {
      const m = /^Added (\d+), identical (\d+), rejected (\d+)$/.exec(d);
      return m ? t('Upload {id}: sent rows, +{added} new, {same} already stored, {bad} refused', { id, added: fmtNum(m[1]), same: fmtNum(m[2]), bad: fmtNum(m[3]) }) : withNote(t('Upload {id}: sent rows', { id }), d);
    }
    case 'upload_finish': {
      const m = /^(?:File (.*?)\. )?Read (\d+), added (\d+), identical (\d+), skipped (\d+), warnings (\d+)(?:\. Decisions: (.*))?$/.exec(d);
      if (!m) return withNote(t('Finished upload {id}', { id }), d);
      const head = m[1] ? t('Uploaded {file}: +{n} rows', { file: m[1], n: fmtNum(m[3]) }) : t('Finished upload {id}: +{n} rows', { id, n: fmtNum(m[3]) });
      const tail = t('(read {read}, {same} already stored, {skipped} skipped, {w} warnings)', { read: fmtNum(m[2]), same: fmtNum(m[4]), skipped: fmtNum(m[5]), w: fmtNum(m[6]) });
      return `${head} ${tail}${m[7] ? `. ${t('Decisions: {list}', { list: m[7].replace(/_/g, ' ') })}` : ''}`;
    }
    case 'create_action': return withNote(t('Created action {id}', { id }), d);
    case 'merge_action': return withNote(t('Added evidence to action {id}', { id }), d);
    case 'update_action': return withNote(t('Changed action {id}', { id }), changesText(d.replace(/\. (?=[a-z]+: )/g, '; ')));
    case 'comment_action': return t('Commented on action {id}: “{text}”', { id, text: d });
    case 'action_check': return withNote(t('Ran the action checks'), d.toLowerCase());
    // backend 1.7.0: tasks inside actions
    case 'create_task': {
      const m = /^(\S+): #(\d+) (.*)$/.exec(d);
      return m ? t('Added task {n} to action {action}: {what}', { n: m[2]!, action: m[1]!, what: m[3]!.replace(/\. Action status: (.*) -> (.*)$/, `. ${t('Action status')} $1 → $2`) })
        : withNote(t('Added task {id}', { id }), d);
    }
    case 'update_task': {
      const m = /^(\S+) #(\d+): (.*)$/.exec(d);
      if (!m) return withNote(t('Changed task {id}', { id }), d);
      // person fields hold user ids: show the names
      const what = changesText(m[3]!.replace(/\bU-[A-Za-z0-9_-]+/g, (u) => name(u)).replace(/(^|; )action status: /, '$1action_status: ').replace(/(^|; )note: (.*?)(?=; [a-z_]+: |$)/, (_x, p: string, n: string) => `${p}note: “${n}”`));
      return t('Changed task {n} of action {action}: {what}', { n: m[2]!, action: m[1]!, what });
    }
    case 'apply_template': return withNote(t('Applied a task template to action {id}', { id }), d.replace(/^Template /, ''));
    case 'save_task_templates': return withNote(t('Saved task templates {ids}', { ids: id.replace(/,/g, ', ') }), d === 'No change' ? ''
      : changesText(d.replace(/\. (?=TT-)/g, '; ').replace(/(TT-\S+) ([a-z_]+): /g, (_x, tid: string, f: string) => `${tid} ${fieldWord(f)} `)));
    case 'migrate_actions': return withNote(t('Version 1.7.0: the action statuses Contractor informed and Waiting stoppage now live on tasks'), d);
    case 'activate_area': return t('Switched area {id} on (its records count again)', { id });
    case 'deactivate_area': return t('Switched area {id} off (its records are left out everywhere)', { id });
    case 'notification_check': return withNote(t('Ran the alert checks'), d.toLowerCase());
    case 'notification_failed': return withNote(t('A check could not finish'), d);
    case 'digest_sent': return withNote(t('Sent the e-mail digest to {who}', { who: name(e.user_id) }), d);
    case 'digest_failed': return withNote(t('The e-mail digest to {who} failed', { who: name(e.user_id) }), d);
    case 'seed_defaults': return withNote(t('Added the starting data'), d);
    default: return withNote(`${e.action.replace(/_/g, ' ')}${id ? ` ${id}` : ''}`, d);
  }
}

/** The page someone has open, in words ('Dashboard', 'Settings › Areas', 'Notifications'). '' when unknown. */
export function pageNameOf(path: string): string {
  if (!path) return '';
  if (path === '/') return t('Start page');
  const sub = settingsSubFromPath(path);
  if (sub) return `${t('Settings')} › ${settingsSubLabel(sub)}`;
  if (path === '/settings') return t('Settings');
  if (path === NOTIFICATIONS_PATH || path.startsWith(`${NOTIFICATIONS_PATH}/`)) return t('Notifications');
  if (path === '/change-password') return t('Change password');
  const p = pageForPath(path);
  return p ? pageLabel(p) : path;
}

/** 'just now', '4 min ago', '3 h ago', '2 days ago' between two plant-local timestamps. '' when either is missing. */
export function agoText(ts: string, nowTs: string, extraMs = 0): string {
  const a = parseTs(ts);
  const b = parseTs(nowTs);
  if (a === null || b === null) return '';
  const ms = Math.max(0, b - a + extraMs);
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t('just now');
  if (min < 60) return t('{n} min ago', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('{n} h ago', { n: h });
  const days = Math.floor(h / 24);
  return days === 1 ? t('1 day ago') : t('{n} days ago', { n: days });
}
