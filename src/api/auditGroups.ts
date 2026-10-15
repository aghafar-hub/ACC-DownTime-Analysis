// The kinds of change in the activity log (backend 1.6.0). Mirror of AUDIT_GROUPS_ in backend/apps-script/Audit.js; a
// test checks the two lists match. An action not listed belongs to 'system'.
import type { AuditGroup } from './types';

export const AUDIT_GROUP_ACTIONS: Record<AuditGroup, readonly string[]> = {
  signin: ['login', 'login_failed', 'login_locked', 'logout', 'change_password'],
  users: ['create_user', 'update_user', 'reset_password', 'set_tab_access', 'create_first_admin'],
  settings: ['save_setting', 'save_contractors', 'save_area_targets', 'save_task_templates'],
  master: ['add_equipment', 'update_equipment', 'add_area', 'update_area', 'add_reason', 'update_reason', 'add_alias', 'update_alias', 'delete_alias'],
  events: ['edit_event', 'void_event', 'unvoid_event', 'accept_event_flags', 'revalidate_events'],
  upload: ['upload_start', 'upload_chunk', 'upload_finish'],
  actions: ['create_action', 'merge_action', 'update_action', 'comment_action', 'action_check', 'create_task', 'update_task', 'apply_template'],
  areas: ['activate_area', 'deactivate_area'],
  notifications: ['notification_check', 'notification_failed', 'digest_sent', 'digest_failed'],
  system: ['seed_defaults', 'migrate_actions'],
};

export function auditGroupOf(action: string): AuditGroup {
  for (const [g, list] of Object.entries(AUDIT_GROUP_ACTIONS) as [AuditGroup, readonly string[]][]) if (list.includes(action)) return g;
  return 'system';
}
