import type { Access, AccessLevel, TabId } from '../../api/types';

// The standard access of each role (docs/architecture-and-build-plan.md section 7.3, schema/tables.json).
// The API has no call that reads the role table, so the editor shows these as "role default".
// A test checks that this copy matches schema/tables.json.
const H: AccessLevel = 'Hidden', V: AccessLevel = 'View', E: AccessLevel = 'Edit';
export const ROLE_DEFAULTS: Record<string, Access> = {
  'ROLE-ADMIN': { overview: E, pareto: E, repeats: E, reliability: E, reports: E, events: E, upload: E, master: E, settings: E, users: E },
  'ROLE-MGR': { overview: V, pareto: V, repeats: V, reliability: V, reports: E, events: V, upload: H, master: V, settings: H, users: H },
  'ROLE-ENG': { overview: V, pareto: V, repeats: V, reliability: V, reports: V, events: E, upload: E, master: E, settings: H, users: H },
  'ROLE-VIEW': { overview: V, pareto: V, repeats: V, reliability: V, reports: V, events: V, upload: H, master: H, settings: H, users: H },
};
export const ROLE_IDS = Object.keys(ROLE_DEFAULTS);

export const roleDefault = (roleId: string, tab: TabId): AccessLevel => ROLE_DEFAULTS[roleId]?.[tab] ?? 'Hidden';
