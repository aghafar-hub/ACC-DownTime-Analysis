// In-memory implementation of the whole Api interface. It behaves like the
// server (docs/wire-protocol.md): same access rules per action, same
// normalisation, edit and void semantics, user administration and temporary
// passwords. Data lives in memory only: a page reload starts again.
import type {
  Access, AccessLevel, ActiveUser, AdminUser, Api, Area, AuditEntry, AuditGroup, DeviceKind, ClassificationCode, Equipment, EquipmentAlias, EventChanges,
  EventRow, NewTask, Notification, NotificationCheckResult, NotificationPrefs, NotificationState, Reason, Session, SessionUser, TaskStatus,
  TabId, UploadBatch, UploadRow,
} from './types';
import {
  cleanSavedReports, notificationCandidates, oneLine, parseNotifSettings, uploadDoneCandidate, userEventCandidate, type Candidate,
} from './mockNotifications';
import { buildIndex, canonicalFlags, deriveEventFields, findArea, isKnownFlag, pruneAcceptedFlags, splitFlags, DERIVED_FLAGS, type MasterIndex } from '../calc';
import { ApiError, AUDIT_GROUPS, NOTIFICATION_CATEGORY_OF, NOTIFICATION_TYPES, TAB_IDS } from './types';
import { AUDIT_GROUP_ACTIONS, auditGroupOf } from './auditGroups';
import { createActionStore } from './mockActions';
import { buildSyntheticDb, fmtTs, type MockUser, type SyntheticDb } from '../mock/synthetic';
import { codeKey, eventIdOf, fingerprintOf, isValidDate, matchKey, parseTs } from '../util/normalize';
import { THEME_NAMES } from '../theme/themes';
import { store } from '../storagePrefix';

const LEVEL_RANK: Record<AccessLevel, number> = { Hidden: 0, View: 1, Edit: 2 };
const CLASS_CODES: ClassificationCode[] = ['PRO', 'MEC', 'ELE', 'AUT', 'PL', 'CIR'];
const TEXT_MAX = 1000;
const ACCEPT_NOTE_MIN = 3;
const PRUNE_NOTE = 'Removed automatically: the record no longer has this problem.';
const SAVED_VIEW_PAGES = ['overview', 'pareto', 'repeats', 'reliability', 'events'];
const FINGERPRINT_HINT_MAX = 20;
const EDITABLE: string[] = [
  'event_date', 'line_id', 'area_id', 'code_raw', 'stop_ts', 'start_ts', 'freq', 'classification', 'criticality', 'is_failure', 'reason_raw', 'description',
];
const DASHBOARD_TABS: TabId[] = ['overview', 'pareto', 'repeats', 'reliability', 'reports', 'events'];

const BAD_LOGIN = 'Email or password is not correct.';

function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

function randomTempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

/** Same rules as cleanSavedViews_ in backend/apps-script/Notifications.js. */
function cleanSavedViews(text: string): string {
  const bad = (m: string) => new ApiError(m, 'bad_request');
  if (text === '') return '';
  if (text.length > 20000) throw bad('Saved views are too long.');
  let list: unknown;
  try { list = JSON.parse(text); } catch { throw bad('Saved views are not readable.'); }
  if (!Array.isArray(list)) throw bad('Saved views must be a list.');
  if (list.length > 20) throw bad('You can save at most 20 views.');
  const seen = new Set<string>();
  for (const v of list) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('Each saved view must be an object.');
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!['id', 'name', 'page', 'query'].includes(k)) throw bad(`A saved view has an unknown field: ${oneLine(k, 40)}.`);
    if (typeof o.id !== 'string' || !o.id || o.id.length > 40) throw bad('A saved view needs an id of 1 to 40 characters.');
    if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 60) throw bad('A saved view needs a name of 1 to 60 characters.');
    if (typeof o.page !== 'string' || !SAVED_VIEW_PAGES.includes(o.page)) throw bad(`A saved view page must be one of: ${SAVED_VIEW_PAGES.join(', ')}.`);
    if (typeof o.query !== 'string' || o.query.length > 1500) throw bad('A saved view query must be text of at most 1500 characters.');
    if (seen.has(o.id)) throw bad('Two saved views have the same id.');
    seen.add(o.id);
  }
  return text;
}

// demo mode only: the saved theme of each demo account, kept in this browser (see createMockApi)
const KEPT_THEMES_KEY = 'mock_account_themes';
function readKeptThemes(): Record<string, string> {
  try {
    const v = JSON.parse(store.get(KEPT_THEMES_KEY) ?? '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string' && THEME_NAMES.includes(e[1])));
  } catch {
    return {};
  }
}
function writeKeptTheme(userId: string, theme: string): void {
  const all = readKeptThemes();
  if (theme) all[userId] = theme; else delete all[userId];
  store.set(KEPT_THEMES_KEY, JSON.stringify(all));
}

export interface MockApi extends Api {
  /** Test helpers: the live data and a clock override. Not part of Api. */
  __db(): SyntheticDb;
  __setNow(fn: () => number): void;
}

/**
 * `demoActions` (the app's demo mode) fills the Actions page on first use: area targets, auto drafts moved along the board,
 * a manual action and comments. Tests leave it off so their scenarios start from an empty action list, like the server.
 */
/**
 * `keepAccountThemes` (the app's demo mode) keeps each demo account's saved theme in this browser's storage, so it
 * outlives a reload and a fresh sign-in like on a real server (everything else in the mock starts again on a reload).
 */
export function createMockApi(opts: { seed?: number; demoActions?: boolean; keepAccountThemes?: boolean } = {}): MockApi {
  let db: SyntheticDb | null = null;
  let now: () => number = () => Date.now();
  let counter = 0;

  const get = (): SyntheticDb => {
    if (!db) {
      db = buildSyntheticDb(opts.seed);
      seedHistory(db);
      if (opts.demoActions) seedDemoActivity(db);
      if (opts.keepAccountThemes) {
        for (const [user_id, value] of Object.entries(readKeptThemes())) notifPrefs.push({ user_id, key: 'theme', value, updated_at: '' });
      }
    }
    return db;
  };

  const p2 = (n: number, l = 2) => String(n).padStart(l, '0');
  const tsOf = (ms: number): string => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p2(d.getMilliseconds(), 3)}`;
  };
  const nowTs = (): string => tsOf(now());
  const setting = (key: string): string => get().settings.find((s) => s.key === key)?.value ?? '';
  const numSetting = (key: string, fallback: number): number => {
    const n = Number(setting(key));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const audit = (userId: string | undefined, action: string, entity: string, entityId: string, detail: string) => {
    get().audit_log.push({ at: nowTs(), user_id: userId, action, entity, entity_id: entityId, detail: String(detail ?? '').slice(0, 500) });
  };
  /** Same as auditValue_ / auditChanges_ in backend/apps-script/Audit.js: 'field: old -> new; ...' of the fields that changed. */
  const auditValue = (v: unknown, max = 60): string => {
    if (v === true) return 'yes';
    if (v === false) return 'no';
    const t = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim();
    if (!t) return '(blank)';
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  };
  const auditChanges = (before: object | null | undefined, after: object, fields: string[], max = 60): string => {
    const b = (before ?? {}) as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    return fields
      .filter((f) => a[f] !== undefined && auditValue(b[f], 500) !== auditValue(a[f], 500))
      .map((f) => `${f}: ${auditValue(b[f], max)} -> ${auditValue(a[f], max)}`)
      .join('; ');
  };

  // ------------------------------------------------------------ access
  function roleLevel(roleId: string, tab: TabId): AccessLevel {
    const row = get().tab_access.find((r) => r.subject_type === 'role' && r.subject_id === roleId && r.tab_id === tab);
    return (row?.level as AccessLevel) ?? 'Hidden';
  }
  function accessFor(u: MockUser): Access {
    const out = {} as Access;
    for (const t of TAB_IDS) out[t] = u.overrides[t] ?? roleLevel(u.role_id, t);
    return out;
  }
  const sessionUser = (u: MockUser): SessionUser => ({ user_id: u.user_id, email: u.email, display_name: u.display_name, role_id: u.role_id });
  const adminUser = (u: MockUser): AdminUser => ({
    ...sessionUser(u), active: u.active, must_change: u.must_change, last_login_at: u.last_login_at,
    overrides: Object.keys(u.overrides).length ? { ...u.overrides } : undefined,
  });

  /** Short fingerprint of the current password: changing or resetting it ends every open session (as on the real server). */
  function pwVersion(u: MockUser): string {
    let h = 5381;
    for (let i = 0; i < u.password.length; i++) h = ((h * 33) ^ u.password.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function makeSession(u: MockUser, lifetimeMs: number): Session {
    const iat = now();
    const exp = iat + lifetimeMs;
    const payload = b64urlEncode(JSON.stringify({ uid: u.user_id, role: u.role_id, iat, exp, pv: pwVersion(u) }));
    return {
      token: `${payload}.mock`, expires_at: new Date(exp).toISOString(), user: sessionUser(u),
      must_change: u.must_change, access: accessFor(u), theme: accountTheme(u.user_id),
    };
  }

  function auth(token: string, allowMustChange = false): { user: MockUser; access: Access; iat: number; exp: number } {
    const fail = () => new ApiError('Your session has ended. Please sign in again.', 'unauthenticated');
    if (!token) throw fail();
    const [payloadB64, sig] = String(token).split('.');
    if (!payloadB64 || sig !== 'mock') throw fail();
    let payload: { uid?: string; iat?: number; exp?: number; pv?: string };
    try { payload = JSON.parse(b64urlDecode(payloadB64)); } catch { throw fail(); }
    if (!payload.exp || payload.exp <= now()) throw fail();
    const user = get().users.find((u) => u.user_id === payload.uid);
    if (!user || !user.active) throw fail();
    if (payload.pv !== pwVersion(user)) throw new ApiError('Your password changed. Please sign in again.', 'unauthenticated');
    noteActivity(user.user_id); // like the server: every signed-in call counts as activity
    if (user.must_change && !allowMustChange) {
      throw new ApiError('You must set a new password before you continue.', 'forbidden', true);
    }
    return { user, access: accessFor(user), iat: payload.iat ?? 0, exp: payload.exp };
  }

  function needAdmin(token: string): { user: MockUser; access: Access } {
    const a = auth(token);
    if (a.user.role_id !== 'ROLE-ADMIN') throw new ApiError('You do not have access to do this.', 'forbidden', true);
    return a;
  }

  // ------------------------------------------------------------ who is online (backend/apps-script/Activity.js)
  const ACTIVITY_ONLINE_MS = 5 * 60_000;
  const activity = new Map<string, { s: number; p: string; d: DeviceKind | '' }>();
  /** Demo mode only: people "seen" a fixed time before now, so the Active users page always has someone online. */
  const demoSeen = new Map<string, { ago: number; p: string; d: DeviceKind }>();
  function noteActivity(userId: string, hint?: unknown): void {
    const cur = activity.get(userId) ?? { s: 0, p: '', d: '' as DeviceKind | '' };
    if (hint && typeof hint === 'object' && !Array.isArray(hint)) {
      const h = hint as Record<string, unknown>;
      if (typeof h.page === 'string' && /^\/[A-Za-z0-9/_.-]{0,79}$/.test(h.page)) cur.p = h.page;
      if (h.device === 'phone' || h.device === 'desktop') cur.d = h.device;
    }
    cur.s = now();
    activity.set(userId, cur);
  }

  /** Demo mode only: a varied activity log of the last two weeks and a few people online. */
  function seedDemoActivity(d: SyntheticDb): void {
    const MIN = 60_000, H = 60 * MIN, DAY = 24 * H;
    demoSeen.set('U-DEMO-MGR', { ago: 1 * MIN, p: '/pareto', d: 'phone' });
    demoSeen.set('U-DEMO-ENG', { ago: 3 * MIN, p: '/validate', d: 'desktop' });
    demoSeen.set('U-DEMO-VIEW', { ago: 2 * H + 10 * MIN, p: '/dashboard', d: 'phone' });
    const evs = d.events.filter((e) => !e.is_void && e.event_date >= '2026-06-01').slice(0, 400);
    const ev = (i: number) => evs[(i * 37) % Math.max(1, evs.length)]?.event_id ?? 'EV-0000000000000000';
    const eq = d.equipment.slice(0, 20);
    const code = (i: number) => eq[i % Math.max(1, eq.length)]?.equipment_id ?? '100.AA01';
    const A = 'U-DEMO-ADMIN', M = 'U-DEMO-MGR', E = 'U-DEMO-ENG', V = 'U-DEMO-VIEW';
    const rows: [number, string, string, string, string, string][] = [
      [13 * DAY + 2 * H, A, 'login', 'users', A, 'Signed in'],
      [13 * DAY + 2 * H - 5 * MIN, A, 'create_user', 'users', 'U-DEMO-VIEW', 'viewer@demo.test as ROLE-VIEW'],
      [13 * DAY + 2 * H - 9 * MIN, A, 'set_tab_access', 'users', 'U-DEMO-ENG', 'upload: role default -> Edit'],
      [12 * DAY + 5 * H, E, 'login', 'users', E, 'Signed in'],
      [12 * DAY + 5 * H - 2 * MIN, E, 'upload_start', 'upload_batches', 'B-20261002-073000-1a2b', 'July_2026.xlsx'],
      [12 * DAY + 5 * H - 3 * MIN, E, 'upload_chunk', 'upload_batches', 'B-20261002-073000-1a2b', 'Added 1000, identical 0, rejected 0'],
      [12 * DAY + 5 * H - 4 * MIN, E, 'upload_chunk', 'upload_batches', 'B-20261002-073000-1a2b', 'Added 1000, identical 0, rejected 0'],
      [12 * DAY + 5 * H - 5 * MIN, E, 'upload_chunk', 'upload_batches', 'B-20261002-073000-1a2b', 'Added 594, identical 12, rejected 0'],
      [12 * DAY + 5 * H - 6 * MIN, E, 'upload_finish', 'upload_batches', 'B-20261002-073000-1a2b', 'File July_2026.xlsx. Read 2606, added 2594, identical 12, skipped 0, warnings 31. Decisions: late_month added 18, changed_row kept_stored 4'],
      [12 * DAY + 5 * H - 6 * MIN - 2000, 'system', 'notification_check', 'notifications', '', 'Created 6, resolved 1, expired 0'],
      [11 * DAY + 3 * H, V, 'login_failed', 'users', V, 'Wrong password (1 of 5)'],
      [11 * DAY + 3 * H - 1 * MIN, V, 'login', 'users', V, 'Signed in'],
      [10 * DAY + 6 * H, M, 'login', 'users', M, 'Signed in'],
      [10 * DAY + 6 * H - 4 * MIN, M, 'save_setting', 'settings', 'availability_target_pct', '85 -> 88'],
      [10 * DAY + 6 * H - 5 * MIN, M, 'save_setting', 'settings', 'repeat_window_days', '30 -> 45'],
      [10 * DAY + 6 * H - 9 * MIN, M, 'save_area_targets', 'area_targets', '2026', 'K.1 availability_target_pct: 90 -> 92; planned_allowance_h_year: 240 -> 300'],
      [9 * DAY + 4 * H, E, 'edit_event', 'events', ev(1), 'reason_raw: Belt torn -> Belt torn at tail pulley. Note: Reason completed from the shift report'],
      [9 * DAY + 4 * H - 3 * MIN, E, 'edit_event', 'events', ev(2), 'classification: ELE -> MEC; criticality: NO_INC -> INC. Note: Wrong classification at source'],
      [9 * DAY + 4 * H - 7 * MIN, E, 'void_event', 'events', ev(3), 'Note: Duplicate of another record'],
      [9 * DAY + 4 * H - 9 * MIN, E, 'accept_event_flags', 'events', ev(4), 'Kept as entered: unlisted_reason. Note: New reason, to be added to the list'],
      [8 * DAY + 2 * H, E, 'update_equipment', 'equipment', code(1), 'description: (blank) -> Kiln main drive; criticality: (blank) -> High'],
      [8 * DAY + 2 * H - 2 * MIN, E, 'add_alias', 'equipment_aliases', `${code(2)}X`, `Points to ${code(2)}. Reason: typo in the sheet`],
      [8 * DAY + 2 * H - 4 * MIN, E, 'add_reason', 'reasons', 'R-MEC-031', 'MEC: Gearbox oil leak'],
      [8 * DAY + 2 * H - 6 * MIN, E, 'revalidate_events', 'events', '2026', 'Checked 2594, changed 37'],
      [7 * DAY + 1 * H, A, 'deactivate_area', 'areas', 'AFR', 'Area switched off: AFR on L.1'],
      [7 * DAY + 1 * H - 30 * MIN, A, 'activate_area', 'areas', 'AFR', 'Area switched on: AFR on L.1'],
      [6 * DAY + 5 * H, M, 'create_action', 'actions', 'ACT-2026-101', 'Open: Replace the kiln tail seal'],
      [6 * DAY + 5 * H - 5 * MIN, M, 'update_action', 'actions', 'ACT-2026-101', 'edit: assignee: (blank) -> Shift engineer; due_date: (blank) -> 2026-10-20'],
      [6 * DAY + 5 * H - 8 * MIN, E, 'comment_action', 'actions', 'ACT-2026-101', 'Seal ordered, delivery on Thursday'],
      [5 * DAY + 3 * H, A, 'update_user', 'users', 'U-DEMO-ENG', 'role_id: ROLE-VIEW -> ROLE-ENG'],
      [5 * DAY + 3 * H - 2 * MIN, A, 'reset_password', 'users', 'U-DEMO-VIEW', 'Temporary password issued'],
      [4 * DAY + 2 * H, M, 'save_contractors', 'contractors', 'RHI', 'RHI areas: CR, RM.1 -> CR, RM.1, RM.2'],
      [3 * DAY + 6 * H, M, 'update_action', 'actions', 'ACT-2026-101', 'status: In progress -> Closed (Seal replaced and tested)'],
      [3 * DAY + 6 * H - 1 * MIN, M, 'action_check', 'actions', '', 'Created 2, merged 1, effectiveness 0'],
      [2 * DAY + 2 * H, A, 'notification_check', 'notifications', '', 'Created 3, resolved 2, expired 1'],
      [2 * DAY + 1 * H, V, 'logout', 'users', V, 'Signed out'],
      [1 * DAY + 4 * H, E, 'login', 'users', E, 'Signed in'],
      [1 * DAY + 4 * H - 3 * MIN, E, 'edit_event', 'events', ev(5), 'start_ts: 2026-09-12 10:15:00.000 -> 2026-09-12 10:30:00.000. Note: Restart time from the control-room log'],
      [1 * DAY + 4 * H - 6 * MIN, E, 'unvoid_event', 'events', ev(3), 'Note: The stop did happen'],
      [5 * H, M, 'login', 'users', M, 'Signed in'],
      [4 * H, M, 'save_setting', 'settings', 'target_mttr_h', '(none) -> 4'],
      [2 * H + 15 * MIN, V, 'login', 'users', V, 'Signed in'],
      [50 * MIN, E, 'login', 'users', E, 'Signed in'],
      [20 * MIN, M, 'login', 'users', M, 'Signed in'],
    ];
    // the weeks before: everyone signs in on working days (so the log has more than one page)
    for (let day = 15; day <= 45; day++) {
      [A, M, E, V].forEach((u, k) => {
        if ((day + k) % 7 === 5) return;
        rows.push([day * DAY + (8 - k) * H, u, 'login', 'users', u, 'Signed in']);
        if (k === 3 && day % 4 === 0) rows.push([day * DAY + (8 - k) * H - 40 * MIN, u, 'logout', 'users', u, 'Signed out']);
      });
      if (day % 6 === 0) rows.push([day * DAY + 5 * H, E, 'edit_event', 'events', ev(day), `description: (blank) -> Checked on site. Note: Completed after the walk-round`]);
    }
    const base = now();
    rows.sort((x, y) => y[0] - x[0]).forEach(([ago, user_id, action, entity, entity_id, detail]) => {
      d.audit_log.push({ at: tsOf(base - ago), user_id, action, entity, entity_id, detail });
    });
  }

  function need(token: string, tabs: TabId[], level: 'View' | 'Edit'): { user: MockUser; access: Access } {
    const a = auth(token);
    const ok = tabs.some((t) => LEVEL_RANK[a.access[t]] >= LEVEL_RANK[level]);
    if (!ok) throw new ApiError('You do not have access to this.', 'forbidden', true);
    return a;
  }

  const clone = <T,>(x: T): T => structuredClone(x);
  const lookup = (): MasterIndex => buildIndex({ equipment: get().equipment, equipment_areas: get().equipment_areas, aliases: get().aliases, reasons: get().reasons, areas: get().areas });

  // ------------------------------------------------------------ validation shared by upload and edit (mirrors Events.js)
  interface Rec {
    event_date: string; line_id: string; area_id: string; code_raw: string; stop_ts: string; start_ts: string; freq: 0 | 1;
    classification: string; criticality: 'INC' | 'NO_INC'; is_failure: boolean; reason_raw: string; description: string;
    equipment_id?: string; is_area_level: boolean; duration_s: number; reason_id?: string; flags: string; code_key: string;
  }
  /** Only what cannot be stored at all is refused; everything else is stored as given and flagged. */
  function normalizeRecord(f: unknown, index: MasterIndex): { error: string } | { rec: Rec } {
    if (!f || typeof f !== 'object') return { error: 'Row is not readable.' };
    const x = f as Record<string, unknown>;
    if (!isValidDate(String(x.event_date ?? '')) || typeof x.event_date !== 'string') return { error: 'Unreadable date.' };
    const stopMs = typeof x.stop_ts === 'string' ? parseTs(x.stop_ts) : null;
    const startMs = typeof x.start_ts === 'string' ? parseTs(x.start_ts) : null;
    if (stopMs === null) return { error: 'Unreadable stop time.' };
    if (startMs === null) return { error: 'Unreadable start time.' };
    const freq = x.freq === 0 || x.freq === 1 ? x.freq : x.freq === '0' ? 0 : x.freq === '1' ? 1 : null;
    if (freq === null) return { error: 'Freq must be 0 or 1.' };
    if (x.criticality !== 'INC' && x.criticality !== 'NO_INC') return { error: 'Criticality must be INC or NO_INC.' };
    if (typeof x.is_failure !== 'boolean') return { error: 'Failure must be true or false.' };
    const code = x.code_raw === null || x.code_raw === undefined ? '' : x.code_raw;
    if (typeof code !== 'string' || code.length > 200) return { error: 'Equipment code is not readable.' };
    const texts: Record<string, string> = {};
    for (const [k, label, max] of [['area_id', 'Area', 40], ['line_id', 'Line', 20], ['classification', 'Classification', 20]] as const) {
      const v = x[k] === null || x[k] === undefined ? '' : x[k];
      if (typeof v !== 'string' || v.length > max) return { error: `${label} is not readable.` };
      texts[k] = v.trim();
    }
    const optional = (v: unknown, label: string): string | { error: string } => {
      if (v === null || v === undefined) return '';
      if (typeof v !== 'string') return { error: `${label} must be text.` };
      if (v.length > TEXT_MAX) return { error: `${label} is too long.` };
      return v.trim();
    };
    const reason = optional(x.reason_raw, 'Reason');
    const description = optional(x.description, 'Description');
    if (typeof reason === 'object') return reason;
    if (typeof description === 'object') return description;
    const stop = fmtTs(stopMs);
    const start = fmtTs(startMs);
    const area = findArea(index, texts.area_id);
    const cls = texts.classification.toUpperCase();
    const row = { area_id: area ? area.area_id : texts.area_id, line_id: texts.line_id, code_raw: code.trim(), classification: cls, reason_raw: reason, stop_ts: stop, start_ts: start };
    const derived = deriveEventFields(row, index);
    return {
      rec: {
        event_date: x.event_date, line_id: texts.line_id, area_id: row.area_id, code_raw: row.code_raw, stop_ts: stop, start_ts: start, freq,
        classification: cls, criticality: x.criticality, is_failure: x.is_failure, reason_raw: reason, description,
        equipment_id: derived.equipment_id, is_area_level: derived.is_area_level, duration_s: (startMs - stopMs) / 1000,
        reason_id: derived.reason_id, flags: derived.flags.join(','), code_key: codeKey(code),
      },
    };
  }
  const stored = (v: string | undefined): string | undefined => v || undefined;

  // ------------------------------------------------------------ notifications (rules: mockNotifications.ts; the server has its own port)
  const RESOLVABLE = ['long_stop', 'repeat_group', 'upload_gap', 'action_due', 'action_ready_to_close', 'task_overdue'];
  const SNOOZE_MAX_DAYS = 366;
  let notifications: Notification[] = [];
  let notifState: NotificationState[] = [];
  let notifPrefs: { user_id: string; key: string; value: string; updated_at: string }[] = [];
  let notifSeeded = false;
  let notifCounter = 0;

  const tsAt = (ms: number): string => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p2(d.getMilliseconds(), 3)}`;
  };

  function makeNotification(c: Candidate, retentionDays: number, nowMs: number): Notification {
    return {
      notification_id: `NT-${(++notifCounter).toString(16).padStart(16, '0')}`, type: c.type, severity: c.severity,
      dedupe_key: c.dedupe_key, title: c.title, detail: c.detail, area_id: c.area_id, line_id: c.line_id, source_ref: c.source_ref,
      created_at: tsAt(nowMs), expires_at: tsAt(nowMs + retentionDays * 86_400_000), status: 'open', resolved_at: '',
      recipients: c.recipients ?? '',
    };
  }

  /** Runs every rule (the "demo data" of the notification panel comes only from here), dedupes, expires and resolves. */
  function runChecks(batch?: UploadBatch): NotificationCheckResult {
    notifSeeded = true;
    const d = get();
    const st = parseNotifSettings(d.settings);
    const nowMs = now();
    const stamp = tsAt(nowMs);
    const res: NotificationCheckResult = { created: 0, resolved: 0, expired: 0 };
    for (const n of notifications) {
      if (n.status === 'open' && n.expires_at && n.expires_at <= stamp) { n.status = 'expired'; res.expired++; }
    }
    const inactive = inactiveAreas();
    const cands = notificationCandidates({
      events: d.events.filter((e) => !inactive.has(e.area_id)), areas: d.areas, index: lookup(), settings: st, today: stamp.slice(0, 10), targets: actionStore.targets(), actions: actionStore.actions(),
      tasks: actionStore.tasks(),
    });
    if (batch) cands.push(uploadDoneCandidate(batch));
    const byKey = new Map(notifications.map((n) => [n.dedupe_key, n]));
    const current = new Set<string>();
    for (const c of cands) {
      const resolvable = RESOLVABLE.includes(c.type);
      if (resolvable) current.add(c.dedupe_key);
      const ex = byKey.get(c.dedupe_key);
      if (!ex) {
        const row = makeNotification(c, st.retentionDays, nowMs);
        notifications.push(row);
        byKey.set(c.dedupe_key, row);
        res.created++;
      } else if (ex.status === 'resolved' && resolvable) {
        ex.status = 'open';
        ex.resolved_at = '';
        ex.expires_at = tsAt(nowMs + st.retentionDays * 86_400_000);
        ex.recipients = c.recipients ?? '';
        res.created++;
      } else if (ex.status === 'open' && (ex.recipients ?? '') !== (c.recipients ?? '')) {
        ex.recipients = c.recipients ?? ''; // backend 1.7.0: the alert follows a new task person or action owner
      }
    }
    for (const n of notifications) {
      if (n.status === 'open' && RESOLVABLE.includes(n.type) && !current.has(n.dedupe_key)) { n.status = 'resolved'; n.resolved_at = stamp; res.resolved++; }
    }
    return res;
  }

  /** Never throws, like the server: a notification step cannot fail the action it follows. */
  function safely(fn: () => void): void {
    try { fn(); } catch { /* best effort */ }
  }

  function userEvent(kind: 'created' | 'password_reset' | 'role_changed', actor: MockUser, target: MockUser, roleChange = ''): void {
    safely(() => {
      const st = parseNotifSettings(get().settings);
      const nowMs = now();
      notifications.push(makeNotification(userEventCandidate(kind, actor, target, roleChange, nowMs), st.retentionDays, nowMs));
    });
  }

  // ------------------------------------------------------------ actions (rules and checks: mockActions.ts; the server has its own port)
  const actionStore = createActionStore({
    db: () => get(), index: () => lookup(), nowTs: () => nowTs(), notifications: () => notifications,
    retentionDays: () => parseNotifSettings(get().settings).retentionDays,
    audit: (userId, action, entityId, detail) => audit(userId, action, 'actions', entityId, detail),
    // backend 1.7.0 (syncReadyToClose_): the ready-to-close alert follows the tasks at once
    syncReady: (actionId, al) => {
      const st = parseNotifSettings(get().settings);
      const nowMs = now();
      const stamp = tsAt(nowMs);
      const rows = notifications.filter((n) => n.type === 'action_ready_to_close' && n.source_ref === actionId);
      for (const r of rows) if (r.status === 'open' && (!al || r.dedupe_key !== al.key)) { r.status = 'resolved'; r.resolved_at = stamp; }
      if (!al) return;
      const ex = rows.find((r) => r.dedupe_key === al.key);
      if (!ex) {
        notifications.push(makeNotification({
          type: al.type, severity: 'alert', dedupe_key: al.key, title: oneLine(al.title, 200), detail: oneLine(al.detail, 500), area_id: al.area,
          line_id: al.line, source_ref: al.ref, recipients: al.recipients,
        }, st.retentionDays, nowMs));
      } else if (ex.status === 'resolved') {
        Object.assign(ex, { status: 'open', resolved_at: '', expires_at: tsAt(nowMs + st.retentionDays * 86_400_000) });
      }
    },
  });
  let demoSeeded = !opts.demoActions;

  /** Demo mode only: area targets, the checks, and a few drafts moved along the board so every column has cards. */
  function seedDemoActions(): void {
    if (demoSeeded) return;
    demoSeeded = true;
    safely(() => {
      const d = get();
      const admin = d.users.find((u) => u.role_id === 'ROLE-ADMIN')!;
      const mgr = d.users.find((u) => u.role_id === 'ROLE-MGR');
      const closers = d.settings.find((x) => x.key === 'actions_closers');
      if (closers && mgr) closers.value = mgr.user_id;
      const year = Number(nowTs().slice(0, 4));
      const contractorOf = (area: string): string => actionStore.list(admin).contractors.find((c) => c.kind === 'contractor' && c.areas.includes(area))?.contractor_id ?? '';
      actionStore.saveTargets(admin, year, [
        { area_id: 'CR', availability_target_pct: 92, planned_allowance_h_year: 240 },
        { area_id: 'RM.1', availability_target_pct: 88, planned_allowance_h_year: 300, overhaul_months: [6] },
        { area_id: 'K.1', availability_target_pct: 90, reliability_target_pct: 97, planned_allowance_h_year: 576, overhaul_months: [2],
          monthly_split: [14, 374, 14, 14, 14, 14, 14, 62, 14, 14, 14, 14] },
        { area_id: 'K.2', availability_target_pct: 90, planned_allowance_h_year: 552, overhaul_months: [11] },
        { area_id: 'CM.1', availability_target_pct: 85, planned_allowance_h_year: 120, overhaul_months: [4] },
        { area_id: 'PK.1', availability_target_pct: 80, planned_allowance_h_year: 216 },
      ]);
      runChecks();
      actionStore.runChecks();
      // the auto drafts stay in Draft with their proposed template tasks; the demo actions below fill the other columns and show
      // tasks in every state (backend 1.7.0): one action ready to close, overdue tasks, and tasks waiting for a stop in K.1, RM.1,
      // CR, AFR and CM.1 (the Shutdown list)
      const due = (days: number) => tsAt(now() + days * 86_400_000).slice(0, 10);
      const eqOf = (area: string): string => d.equipment_areas.find((r) => r.area_id === area)?.equipment_id ?? '';
      const eng = d.users.find((u) => u.role_id === 'ROLE-ENG');
      type DemoTask = NewTask & { status?: TaskStatus; note?: string };
      const demo = (area: string, problem: string, extra: Record<string, unknown>, list: DemoTask[], opts2: { template?: string; comment?: string; close?: string } = {}): string => {
        const eq = eqOf(area);
        const created = actionStore.create(admin, {
          title: `${eq || area} - ${problem} (demo)`, status: 'Open', owner: contractorOf(area), reason_key: problem,
          ...(eq ? { scope_kind: 'equipment', equipment_id: eq } : { scope_kind: 'area', area_id: area }),
          ...(opts2.template ? { template_id: opts2.template } : { tasks: list.map(({ status: _s, note: _n, ...t }) => t) }), ...extra,
        }, { merge: false });
        const id = created.action.action_id;
        (created.tasks ?? []).forEach((t, i) => {
          const want = list[i];
          if (!want) return;
          const changes: Record<string, unknown> = {};
          if (opts2.template) Object.assign(changes, Object.fromEntries(Object.entries(want).filter(([k]) => !['status', 'note', 'title', 'template_step'].includes(k))));
          if (want.status && want.status !== 'Open') Object.assign(changes, { status: want.status, note: want.note ?? '' });
          else if (want.note) changes.note = want.note;
          if (Object.keys(changes).length) actionStore.updateTask(admin, t.task_id, changes);
        });
        if (opts2.template) list.slice((created.tasks ?? []).length).forEach(({ status, note, ...t }) => {
          const added = actionStore.addTask(admin, id, t).task!;
          if (status && status !== 'Open') actionStore.updateTask(admin, added.task_id, { status, note: note ?? '' });
        });
        if (opts2.comment) actionStore.comment(admin, id, opts2.comment);
        if (opts2.close) actionStore.update(admin, id, { status: 'Closed', closure_note: opts2.close });
        return id;
      };
      const each = (fn: () => void) => safely(fn);
      each(() => demo('K.2', 'Hydraulic pressure low', { source: 'pareto', priority: 'High', assignee: mgr?.user_id ?? '' }, [], { template: 'TT-REPEAT', comment: 'Owner asked for the last three shift reports.' }));
      each(() => demo('RM.1', 'Chute blockage', { source: 'report', priority: 'High', assignee: mgr?.user_id ?? '' }, [
        { title: 'Repair', status: 'Done', note: 'Flap linkage pin replaced, actuator set to full stroke in the RM.1 stop.', est_stop_h: 4, needs_stop: true },
        { title: 'Root cause (5-why)', status: 'In progress', note: 'Wet clay build-up after rain; flap stroke too short.', due_date: due(-2), assignee: eng?.user_id ?? '' },
        { title: 'Corrective action', status: 'Waiting stoppage', note: 'Booked for the next RM.1 stop.', due_date: due(10), est_stop_h: 6 },
        { title: 'Spare parts', status: 'Done', note: 'Liner plates and air blaster delivered to store 7.' },
        { title: 'Moisture alarm at the clay feeder (8.5 % limit)', owner: 'AUT', due_date: due(5) },
      ], { template: 'TT-REPEAT', comment: 'Planning confirmed the RM.1 stop. RHI will bring 4 fitters for the liner and the air blaster.' }));
      each(() => demo('K.1', 'Inlet seal worn', { source: 'event' }, [
        { title: 'Replace inlet seal plates (8 of 24)', owner: 'RHI', needs_stop: true, est_stop_h: 8, due_date: due(6), status: 'Waiting stoppage' },
        { title: 'Burner tip inspection and swap', owner: 'MEC', needs_stop: true, est_stop_h: 3, due_date: due(16), status: 'Waiting stoppage' },
        { title: 'Clean cyclone 4 cone, check the flap valve', owner: 'RHI', needs_stop: true, est_stop_h: 2, due_date: due(5), status: 'Contractor informed', note: 'Told the RHI supervisor at the morning meeting.' },
      ]));
      each(() => demo('CR', 'Reclaimer chain break', { source: 'notification', priority: 'High' }, [
        { title: 'Replace chain links (12 pcs)', owner: 'RHI', needs_stop: true, est_stop_h: 8, due_date: due(-3), assignee: eng?.user_id ?? '', status: 'Contractor informed', note: 'RHI informed by phone.' },
        { title: 'Root cause (5-why)', owner: 'MEC', due_date: due(-1) },
      ]));
      each(() => demo('AFR', 'Rotary feeder wear', { source: 'manual', scope_kind: 'area', area_id: 'AFR', equipment_id: undefined }, [
        { title: 'Replace rotor tips', owner: 'RHI', needs_stop: true, est_stop_h: 2.5, due_date: due(-2), status: 'Waiting stoppage' },
        { title: 'Fit an inspection door on the chute', owner: 'RHI', needs_stop: true, due_date: due(18), status: 'Waiting stoppage' },
      ]));
      each(() => demo('CM.1', 'Feed belt misalignment', { source: 'report' }, [
        { title: 'Fit self-aligning idlers (3)', owner: 'ASEC', needs_stop: true, est_stop_h: 1.5, due_date: due(5), status: 'Contractor informed', note: 'ASEC site office informed.' },
        { title: 'Belt scale re-calibration after the idlers', owner: 'ELE', due_date: due(9) },
        { title: 'Order idlers', owner: 'MEC', status: 'Done', note: 'Three idlers in store 2.' },
      ]));
      each(() => demo('FM.1', 'Liner worn', { source: 'notification', root_cause: 'MEC' }, [
        { title: 'Replace the worn liner', owner: 'RHI', needs_stop: true, est_stop_h: 5, status: 'Done', note: 'Liner replaced in the FM.1 stop.' },
        { title: 'Check the alignment', owner: 'MEC', status: 'Done', note: 'Alignment within 0.05 mm.' },
        { title: 'Spare liner on stock', owner: 'MEC', status: 'Not needed', note: 'One spare liner already in store 4.' },
      ], { comment: 'All work done - waiting for a closer.' }));
      each(() => demo('CM.2', 'Belt torn', { source: 'pareto' }, [
        { title: 'Replace the belt', owner: 'ASEC', needs_stop: true, est_stop_h: 10, status: 'Done', note: 'Belt replaced.' },
        { title: 'Check the alignment', owner: 'MEC', status: 'Done', note: 'Alignment checked.' },
      ], { close: 'Belt replaced and alignment checked; watching for repeats.' }));
      each(() => {
        const id = demo('PK.1', 'Spout wear', { source: 'manual' }, [{ title: 'Inform ASEC: spout wear', owner: 'ASEC', due_date: due(-1) }]);
        actionStore.update(admin, id, { status: 'Cancelled', closure_note: 'Duplicate of an older action.' });
      });
      each(() => actionStore.create(admin, {
        title: 'Diaphragm slots clogged - inspect and clean', scope_kind: 'area', area_id: 'CM.3', status: 'Open', priority: 'Low',
        owner: 'MEC', due_date: due(7), detail: 'Seen at the last inspection round (demo).',
      }, undefined));
      runChecks();
    });
  }

  /** backend 1.7.0 (notifForUser_): blank recipients = everyone; else one of the user ids, or @closers for the closers and Admins. */
  const forUser = (n: Notification, user: MockUser): boolean => {
    const list = String(n.recipients ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!list.length) return true;
    const closer = actionStore.isCloser(user);
    return list.some((r) => (r === '@closers' ? closer : r === user.user_id));
  };
  const notifVisible = (n: Notification, access: Access, stamp: string, user: MockUser): boolean =>
    n.status === 'open' && !(n.expires_at && n.expires_at <= stamp) && !(n.type === 'user_event' && access.users === 'Hidden') && forUser(n, user);

  /** The theme saved with the account, '' when none (accountTheme_ in Notifications.js). */
  const accountTheme = (userId: string): string => {
    const v = notifPrefs.find((r) => r.user_id === userId && r.key === 'theme')?.value ?? '';
    return THEME_NAMES.includes(v) ? v : '';
  };
  /** Areas switched off (backend 1.5.0): their records are left out of every rule, as on the server. */
  const inactiveAreas = (): Set<string> => new Set(get().areas.filter((x) => !x.active).map((x) => x.area_id));
  /** An alert about an area that is switched off is not shown (overdue actions are). */
  const ofInactiveArea = (n: Notification, inactive: Set<string>): boolean => !!n.area_id && inactive.has(n.area_id) && NOTIFICATION_CATEGORY_OF[n.type] !== 'Actions';

  const prefsOf = (userId: string): NotificationPrefs => {
    const out: NotificationPrefs = {};
    for (const r of notifPrefs) if (r.user_id === userId) out[r.key] = r.value;
    return out;
  };
  const editText = (v: unknown): string => (v === true ? 'TRUE' : v === false ? 'FALSE' : v === null || v === undefined ? '' : String(v));

  // ------------------------------------------------------------ editing
  function applyEdit(userId: string, eventId: string, changes: EventChanges, note: string, at: string): EventRow {
    const d = get();
    const why = String(note ?? '').trim();
    if (!why) throw new ApiError('Please write a short note saying why you are changing this event.', 'bad_request');
    const incoming = (changes ?? {}) as Record<string, unknown>;
    const fields = Object.keys(incoming);
    if (!fields.length) throw new ApiError('No changes to save.', 'bad_request');
    for (const k of fields) {
      if (!EDITABLE.includes(k)) throw new ApiError(`The field "${k}" cannot be edited.`, 'bad_request');
    }
    const ev = d.events.find((e) => e.event_id === eventId);
    if (!ev) throw new ApiError('Event not found.', 'not_found');
    if (ev.is_void) throw new ApiError('This event is void. Restore it before editing.', 'conflict');
    const bad = (m: string) => new ApiError(m, 'bad_request');
    const index = lookup();
    const cand: Record<string, unknown> = {};
    for (const f of EDITABLE) cand[f] = (ev as unknown as Record<string, unknown>)[f];
    for (const f of fields) cand[f] = incoming[f];
    if ('classification' in incoming) {
      const c = typeof incoming.classification === 'string' ? incoming.classification.trim().toUpperCase() : '';
      if (!CLASS_CODES.includes(c as ClassificationCode)) throw bad(`Classification must be one of ${CLASS_CODES.join(', ')}.`);
      cand.classification = c;
    }
    if ('area_id' in incoming) {
      const a = findArea(index, typeof incoming.area_id === 'string' ? incoming.area_id : '');
      if (!a) throw bad(`Area "${String(incoming.area_id).slice(0, 40)}" is not in the list of areas.`);
      cand.area_id = a.area_id;
      if (!('line_id' in incoming)) cand.line_id = a.line_id;
    }
    if ('line_id' in incoming) {
      const ln = typeof incoming.line_id === 'string' ? incoming.line_id.trim() : '';
      if (!d.lines.some((l) => l.line_id === ln)) throw bad(`Line "${String(incoming.line_id).slice(0, 20)}" is not in the list of lines.`);
      cand.line_id = ln;
    }
    const norm = normalizeRecord(cand, index);
    if ('error' in norm) throw bad(norm.error);
    const rec = norm.rec;
    // criticality follows a changed classification, unless the old one was blank or unknown (then the sheet's value stays)
    if ('classification' in incoming && !('criticality' in incoming) && CLASS_CODES.includes(ev.classification) && rec.classification !== ev.classification) {
      rec.criticality = d.classifications.find((c) => c.code === rec.classification)!.is_incident ? 'INC' : 'NO_INC';
    }
    if (!('is_failure' in incoming) && (rec.criticality !== ev.criticality || rec.freq !== ev.freq)) {
      rec.is_failure = rec.criticality === 'INC' && rec.freq === 1;
    }
    const accOld = canonicalFlags(splitFlags(ev.accepted_flags));
    const accNew = pruneAcceptedFlags(ev.accepted_flags, rec.flags);
    const order = EDITABLE.filter((f) => editText((rec as unknown as Record<string, unknown>)[f]) !== editText((ev as unknown as Record<string, unknown>)[f]));
    if (!order.length) throw bad('Nothing was changed.');
    const before = { ...ev } as unknown as Record<string, unknown>;
    const pruned = accNew.length !== accOld.length;
    Object.assign(ev, {
      event_date: rec.event_date, line_id: rec.line_id, area_id: rec.area_id, code_raw: rec.code_raw, stop_ts: rec.stop_ts, start_ts: rec.start_ts,
      freq: rec.freq, classification: rec.classification, criticality: rec.criticality, is_failure: rec.is_failure,
      reason_raw: stored(rec.reason_raw), description: stored(rec.description), equipment_id: rec.equipment_id, is_area_level: rec.is_area_level,
      duration_s: rec.duration_s, reason_id: rec.reason_id, flags: stored(rec.flags), edited: true,
    });
    if (pruned) {
      // accepted flags the record no longer carries are dropped, and the history says so
      ev.accepted_flags = stored(accNew.join(','));
      if (!accNew.length) { ev.accepted_by = undefined; ev.accepted_at = undefined; }
    }
    order.forEach((f) => {
      d.event_edits.push({
        edit_id: `ED-${at.replace(/\D/g, '').slice(0, 14)}-${++counter}`, event_id: ev.event_id, edited_at: at, edited_by: userId,
        field: f, old_value: stored(editText(before[f])), new_value: stored(editText(ev[f as keyof EventRow])), note: why,
      });
    });
    if (pruned) {
      d.event_edits.push({
        edit_id: `ED-${at.replace(/\D/g, '').slice(0, 14)}-${++counter}`, event_id: ev.event_id, edited_at: at, edited_by: userId,
        field: 'accepted_flags', old_value: stored(accOld.join(',')), new_value: stored(accNew.join(',')), note: PRUNE_NOTE,
      });
    }
    const pairs = order.map((f) => `${f}: ${auditValue(before[f], 40)} -> ${auditValue(ev[f as keyof EventRow], 40)}`);
    if (pruned) pairs.push(`accepted_flags: ${auditValue(accOld.join(','), 40)} -> ${auditValue(accNew.join(','), 40)}`);
    d.audit_log.push({ at, user_id: userId, action: 'edit_event', entity: 'events', entity_id: ev.event_id, detail: `${pairs.join('; ')}. Note: ${why}`.slice(0, 500) });
    return ev;
  }

  function applyAccept(userId: string, eventId: string, flags: unknown, note: string, at: string): EventRow {
    const d = get();
    const why = typeof note === 'string' ? note.trim() : '';
    if (!why) throw new ApiError('A note explaining why is required.', 'bad_request');
    if (why.length < ACCEPT_NOTE_MIN) throw new ApiError(`The note must be at least ${ACCEPT_NOTE_MIN} characters.`, 'bad_request');
    if (why.length > 500) throw new ApiError('A note explaining why is too long.', 'bad_request');
    if (!Array.isArray(flags)) throw new ApiError('Flags must be a list.', 'bad_request');
    if (flags.length > 40) throw new ApiError('Too many flags.', 'bad_request');
    for (const f of flags) {
      if (typeof f !== 'string' || !isKnownFlag(f)) throw new ApiError(`Unknown flag: ${String(f).slice(0, 40)}.`, 'bad_request');
    }
    const wanted = canonicalFlags(flags as string[]);
    const ev = d.events.find((e) => e.event_id === eventId);
    if (!ev) throw new ApiError('Event not found.', 'not_found');
    if (ev.is_void) throw new ApiError('This event is void. Restore it before changing it.', 'conflict');
    const current = canonicalFlags(splitFlags(ev.accepted_flags));
    const storedFlags = canonicalFlags(splitFlags(ev.flags));
    for (const f of wanted) {
      if (!current.includes(f) && !storedFlags.includes(f) && !(DERIVED_FLAGS as readonly string[]).includes(f)) {
        throw new ApiError(`This record does not have the problem "${f}".`, 'bad_request');
      }
    }
    if (wanted.join(',') === current.join(',')) throw new ApiError('Nothing was changed.', 'bad_request');
    if (wanted.length) {
      ev.accepted_flags = wanted.join(',');
      ev.accepted_by = userId;
      ev.accepted_at = at;
    } else {
      ev.accepted_flags = undefined;
      ev.accepted_by = undefined;
      ev.accepted_at = undefined;
    }
    d.event_edits.push({
      edit_id: `ED-${at.replace(/\D/g, '').slice(0, 14)}-${++counter}`, event_id: ev.event_id, edited_at: at, edited_by: userId,
      field: 'accepted_flags', old_value: stored(current.join(',')), new_value: stored(wanted.join(',')), note: why,
    });
    d.audit_log.push({
      at, user_id: userId, action: 'accept_event_flags', entity: 'events', entity_id: ev.event_id,
      detail: `${wanted.length ? `Kept as entered: ${wanted.join(', ')}` : `Undid keep as entered (was: ${current.join(', ')})`}. Note: ${why}`,
    });
    return ev;
  }

  function applyVoid(userId: string, eventId: string, isVoid: boolean, note: string, at: string): EventRow {
    const d = get();
    const ev = d.events.find((e) => e.event_id === eventId);
    if (!ev) throw new ApiError('That event was not found.', 'not_found');
    if (!String(note ?? '').trim()) throw new ApiError('Please write a short note saying why.', 'bad_request');
    if (typeof isVoid !== 'boolean') throw new ApiError('Void must be yes or no.', 'bad_request');
    if (ev.is_void === isVoid) throw new ApiError(isVoid ? 'This event is already voided.' : 'This event is not voided.', 'conflict');
    ev.is_void = isVoid;
    d.event_edits.push({
      edit_id: `ED-${at.replace(/\D/g, '').slice(0, 14)}-${++counter}`, event_id: ev.event_id, edited_at: at, edited_by: userId,
      field: 'is_void', old_value: isVoid ? 'FALSE' : 'TRUE', new_value: isVoid ? 'TRUE' : 'FALSE', note: String(note).trim(),
    });
    d.audit_log.push({ at, user_id: userId, action: isVoid ? 'void_event' : 'unvoid_event', entity: 'events', entity_id: ev.event_id, detail: `Note: ${String(note).trim()}` });
    return ev;
  }

  /** A few edited and voided rows, as a long-running installation would have. */
  function seedHistory(d: SyntheticDb) {
    const eng = 'U-DEMO-ENG';
    const clean = d.events.filter((e) => e.event_date >= '2026-03-01' && !e.flags && e.freq === 1 && !e.is_area_level && e.classification !== 'PL');
    const at = (n: number) => `2026-10-0${n} 0${6 + n}:20:00.000`;
    const step = Math.floor(clean.length / 10);
    const pickAt = (i: number) => clean[step * (i + 1)];
    applyEdit(eng, pickAt(0).event_id, { description: 'Corrected after the shift report' }, 'Description corrected from the shift report (synthetic).', at(1));
    const e1 = pickAt(1);
    applyEdit(eng, e1.event_id, { classification: e1.classification === 'ELE' ? 'MEC' : 'ELE', reason_raw: e1.classification === 'ELE' ? 'Belt torn' : 'Cable fault' }, 'Wrong classification entered at source (synthetic).', at(2));
    const e2 = pickAt(2);
    applyEdit(eng, e2.event_id, { start_ts: fmtTs((parseTs(e2.start_ts) ?? 0) + 15 * 60_000) }, 'Restart time corrected from the control-room log (synthetic).', at(3));
    applyVoid(eng, pickAt(3).event_id, true, 'Duplicate of another record (synthetic).', at(4));
    applyVoid(eng, pickAt(4).event_id, true, 'Entered in the wrong area (synthetic).', at(4));
    const e5 = pickAt(5);
    applyVoid(eng, e5.event_id, true, 'Voided by mistake (synthetic).', at(5));
    applyVoid(eng, e5.event_id, false, 'Restored, the stop did happen (synthetic).', at(6));
    d.audit_log.length = 0; // history above is only for the explorer's demo
  }

  // ------------------------------------------------------------ the Api
  const api: MockApi = {
    __db: () => get(),
    __setNow: (fn) => { now = fn; },

    // --- auth
    async login(email, password, keepSignedIn) {
      const d = get();
      const user = d.users.find((u) => u.email === String(email ?? '').trim().toLowerCase());
      if (!user || !user.active) throw new ApiError(BAD_LOGIN, 'bad_credentials');
      if (user.locked_until && user.locked_until > now()) {
        const mins = Math.max(1, Math.ceil((user.locked_until - now()) / 60_000));
        throw new ApiError(`Too many wrong passwords. This account is locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 'locked');
      }
      if (user.password !== password) {
        user.failed_attempts += 1;
        const limit = numSetting('lockout_attempts', 5);
        if (user.failed_attempts >= limit) {
          audit(user.user_id, 'login_locked', 'users', user.user_id, `Account locked after ${user.failed_attempts} wrong passwords`);
          user.locked_until = now() + numSetting('lockout_minutes', 15) * 60_000;
          user.failed_attempts = 0;
        } else {
          audit(user.user_id, 'login_failed', 'users', user.user_id, `Wrong password (${user.failed_attempts} of ${limit})`);
        }
        throw new ApiError(BAD_LOGIN, 'bad_credentials');
      }
      user.failed_attempts = 0;
      user.locked_until = undefined;
      user.last_login_at = nowTs();
      audit(user.user_id, 'login', 'users', user.user_id, 'Signed in');
      noteActivity(user.user_id);
      const hours = keepSignedIn ? numSetting('session_hours_keep', 720) : numSetting('session_hours', 12);
      return clone(makeSession(user, hours * 3_600_000));
    },
    async changePassword(token, current, next) {
      const a = auth(token, true);
      if (a.user.password !== current) throw new ApiError('Your current password is not correct.', 'bad_credentials');
      const min = numSetting('min_password_length', 10);
      if (String(next ?? '').length < min) throw new ApiError(`Use at least ${min} characters.`, 'bad_request');
      if (next === current) throw new ApiError('The new password must be different from the current one.', 'bad_request');
      a.user.password = next;
      a.user.must_change = false;
      audit(a.user.user_id, 'change_password', 'users', a.user.user_id, 'Password changed by the user');
      return clone(makeSession(a.user, a.exp - a.iat));
    },
    async logout(token) {
      const a = auth(token, true);
      audit(a.user.user_id, 'logout', 'users', a.user.user_id, 'Signed out');
    },
    async getMyAccess(token, activityHint) {
      const a = auth(token, true);
      noteActivity(a.user.user_id, activityHint);
      return clone({ user: sessionUser(a.user), access: a.access, must_change: a.user.must_change, theme: accountTheme(a.user.user_id) });
    },

    // --- reads
    async getStartup(token) {
      const a = auth(token);
      if (!TAB_IDS.some((t) => LEVEL_RANK[a.access[t]] > 0)) throw new ApiError('You do not have access to this.', 'forbidden', true);
      const d = get();
      const years = [...new Set(d.events.map((e) => Number(e.event_date.slice(0, 4))))].sort((x, y) => y - x);
      return clone({
        lines: d.lines, areas: d.areas, equipment: d.equipment, equipment_areas: d.equipment_areas, aliases: d.aliases,
        classifications: d.classifications, reasons: d.reasons, settings: d.settings, years,
      });
    },
    async getEvents(token, year) {
      need(token, DASHBOARD_TABS, 'View');
      if (!Number.isInteger(year) || year < 1990 || year > 2200) throw new ApiError('Please give a year such as 2026.', 'bad_request');
      const prefix = `${year}-`;
      return clone(get().events.filter((e) => e.event_date.startsWith(prefix)).sort((x, y) => x.stop_ts.localeCompare(y.stop_ts) || x.area_id.localeCompare(y.area_id)));
    },
    async getEventEdits(token, eventId) {
      need(token, ['events'], 'View');
      return clone(get().event_edits.filter((e) => e.event_id === eventId).sort((x, y) => x.edited_at.localeCompare(y.edited_at)));
    },
    async getUploadHistory(token) {
      need(token, ['upload'], 'View');
      return clone([...get().upload_batches].sort((x, y) => y.uploaded_at.localeCompare(x.uploaded_at)));
    },
    async getUploadWarnings(token, batchId) {
      need(token, ['upload'], 'View');
      if (!get().upload_batches.some((b) => b.batch_id === batchId)) throw new ApiError('That upload was not found.', 'not_found');
      return clone(get().upload_warnings.filter((w) => w.batch_id === batchId));
    },

    // --- upload
    async uploadStart(token, fileName, fileHash) {
      const a = need(token, ['upload'], 'Edit');
      const t = nowTs();
      const id = `B-${t.slice(0, 10).replace(/-/g, '')}-${t.slice(11, 19).replace(/:/g, '')}-${(0x1000 + (++counter % 0xefff)).toString(16)}`;
      get().upload_batches.push({
        batch_id: id, uploaded_by: a.user.user_id, uploaded_at: t, file_name: String(fileName ?? ''), file_hash: String(fileHash ?? ''),
        rows_read: 0, rows_added: 0, rows_identical: 0, rows_skipped: 0, warning_count: 0, status: 'Started',
      });
      audit(a.user.user_id, 'upload_start', 'upload_batches', id, String(fileName ?? ''));
      return { batch_id: id };
    },
    async uploadChunk(token, batchId, rows) {
      const a = need(token, ['upload'], 'Edit');
      const d = get();
      const batch = d.upload_batches.find((b) => b.batch_id === batchId);
      if (!batch) throw new ApiError('That upload was not found.', 'not_found');
      if (batch.status !== 'Started') throw new ApiError('This upload is already finished.', 'conflict');
      if (!Array.isArray(rows)) throw new ApiError('No rows were sent.', 'bad_request');
      const known = new Set(d.events.map((e) => e.fingerprint));
      const inBatch = new Map<string, number | undefined>();
      for (const e of d.events) if (e.batch_id === batch.batch_id) inBatch.set(e.fingerprint, e.source_row);
      const index = lookup();
      const rejected: { source_row: number; reason: string }[] = [];
      const base = new Map<string, (number | undefined)[]>();
      const extra = new Map<string, number>();
      let added = 0, identical = 0;
      for (const r of rows as UploadRow[]) {
        const norm = normalizeRecord(r, index);
        if ('error' in norm) { rejected.push({ source_row: Number((r as Partial<UploadRow> | null)?.source_row) || 0, reason: norm.error }); continue; }
        const rec = norm.rec;
        const key = `${rec.area_id}|${rec.code_key}|${rec.stop_ts}|${rec.start_ts}`;
        const srcRow = Number.isFinite(Number(r.source_row)) && String(r.source_row ?? '') !== '' ? Math.trunc(Number(r.source_row)) : undefined;
        const fpOf = (n: number) => fingerprintOf(rec.area_id, rec.code_key, rec.stop_ts, rec.start_ts, n);
        // the occurrence number the browser used counts only when its fingerprint verifies
        let n = 0;
        if (/^[0-9a-f]{64}$/.test(String(r.fingerprint ?? ''))) {
          for (let k = 1; k <= FINGERPRINT_HINT_MAX; k++) if (fpOf(k) === r.fingerprint) { n = k; break; }
        }
        if (!n) {
          let list = base.get(key);
          if (!list) {
            list = [];
            while (inBatch.has(fpOf(list.length + 1))) list.push(inBatch.get(fpOf(list.length + 1)));
            base.set(key, list);
          }
          const at = srcRow === undefined ? -1 : list.indexOf(srcRow);
          if (at >= 0) n = at + 1; // the same file row sent again (a retry)
          else { extra.set(key, (extra.get(key) ?? 0) + 1); n = list.length + (extra.get(key) as number); }
        }
        const fp = fpOf(n);
        if (known.has(fp)) { identical++; continue; }
        known.add(fp);
        d.events.push({
          event_id: eventIdOf(fp), batch_id: batchId, event_date: rec.event_date, line_id: rec.line_id, area_id: rec.area_id,
          code_raw: rec.code_raw, equipment_id: rec.equipment_id, is_area_level: rec.is_area_level, stop_ts: rec.stop_ts, start_ts: rec.start_ts,
          duration_s: rec.duration_s, freq: rec.freq, classification: rec.classification as ClassificationCode, criticality: rec.criticality,
          is_failure: rec.is_failure, reason_raw: stored(rec.reason_raw), reason_id: rec.reason_id, description: stored(rec.description),
          source_file: batch.file_name, source_row: srcRow, fingerprint: fp, flags: stored(rec.flags), edited: false, is_void: false, created_at: nowTs(),
        });
        added++;
      }
      batch.rows_added += added;
      batch.rows_identical += identical;
      audit(a.user.user_id, 'upload_chunk', 'upload_batches', batch.batch_id, `Added ${added}, identical ${identical}, rejected ${rejected.length}`);
      return { added, identical, rejected };
    },
    async uploadFinish(token, batchId, summary, warnings) {
      const a = need(token, ['upload'], 'Edit');
      const d = get();
      const batch = d.upload_batches.find((b) => b.batch_id === batchId);
      if (!batch) throw new ApiError('That upload was not found.', 'not_found');
      if (batch.status === 'Completed') return clone(batch);
      let n = 0;
      for (const w of warnings ?? []) {
        d.upload_warnings.push({ ...w, warning_id: `W-${batchId}-${++n}`, batch_id: batchId });
      }
      batch.rows_read = Number(summary?.rows_read) || 0;
      batch.rows_skipped = Number(summary?.rows_skipped) || 0;
      batch.warning_count = n;
      batch.status = 'Completed';
      const decided = new Map<string, number>();
      for (const w of warnings ?? []) if (w.resolution) decided.set(`${w.type} ${w.resolution}`, (decided.get(`${w.type} ${w.resolution}`) ?? 0) + 1);
      const decisions = [...decided.keys()].sort().map((k) => `${k} ${decided.get(k)}`).join(', ');
      audit(a.user.user_id, 'upload_finish', 'upload_batches', batchId, `File ${auditValue(batch.file_name, 120)}. Read ${batch.rows_read}, added ${batch.rows_added}, identical ${batch.rows_identical}, skipped ${batch.rows_skipped}, warnings ${n}${decisions ? `. Decisions: ${decisions}` : ''}`);
      safely(() => { runChecks(batch); });
      safely(() => { actionStore.runChecks(); }); // after the alerts, so a new long stop already has its notification
      return clone(batch);
    },

    // --- data checks
    async revalidateEvents(token, year) {
      const a = need(token, ['events'], 'Edit');
      if (year !== undefined && year !== null && (!Number.isInteger(year) || year < 1990 || year > 2200)) throw new ApiError('Year is not valid.', 'bad_request');
      const index = lookup();
      const at = nowTs();
      let checked = 0, changed = 0;
      for (const ev of get().events) {
        if (ev.is_void) continue;
        if (year !== undefined && year !== null && !ev.event_date.startsWith(`${year}-`)) continue;
        checked++;
        const norm = normalizeRecord(ev, index);
        if ('error' in norm) continue;
        const rec = norm.rec;
        const accOld = canonicalFlags(splitFlags(ev.accepted_flags));
        const accNew = pruneAcceptedFlags(ev.accepted_flags, rec.flags);
        const pruned = accNew.length !== accOld.length;
        if (!pruned && rec.flags === (ev.flags ?? '') && (rec.equipment_id ?? '') === (ev.equipment_id ?? '') && (rec.reason_id ?? '') === (ev.reason_id ?? '')
          && rec.is_area_level === ev.is_area_level && rec.duration_s === ev.duration_s) continue;
        if (pruned) {
          ev.accepted_flags = stored(accNew.join(','));
          if (!accNew.length) { ev.accepted_by = undefined; ev.accepted_at = undefined; }
          get().event_edits.push({
            edit_id: `ED-${at.replace(/\D/g, '').slice(0, 14)}-R${++counter}`, event_id: ev.event_id, edited_at: at, edited_by: a.user.user_id,
            field: 'accepted_flags', old_value: stored(accOld.join(',')), new_value: stored(accNew.join(',')), note: PRUNE_NOTE,
          });
        }
        ev.flags = stored(rec.flags);
        ev.equipment_id = rec.equipment_id;
        ev.reason_id = rec.reason_id;
        ev.is_area_level = rec.is_area_level;
        ev.duration_s = rec.duration_s;
        changed++;
      }
      audit(a.user.user_id, 'revalidate_events', 'events', year === undefined || year === null ? 'all' : String(year), `Checked ${checked}, changed ${changed}`);
      return { checked, changed };
    },

    // --- event correction
    async editEvent(token, eventId, changes, note) {
      const a = need(token, ['events'], 'Edit');
      return clone(applyEdit(a.user.user_id, eventId, changes, note, nowTs()));
    },
    async voidEvent(token, eventId, isVoid, note) {
      const a = need(token, ['events'], 'Edit');
      return clone(applyVoid(a.user.user_id, eventId, isVoid, note, nowTs()));
    },

    async acceptEventFlags(token, eventId, flags, note) {
      const a = need(token, ['events'], 'Edit');
      return clone(applyAccept(a.user.user_id, eventId, flags, note, nowTs()));
    },

    // --- master data
    async saveEquipment(token, row, areaIds) {
      const a = need(token, ['master'], 'Edit');
      const d = get();
      const id = codeKey(row?.equipment_id);
      if (!id) throw new ApiError('The equipment code cannot be empty.', 'bad_request');
      if (id === 'N/A' || id === 'NA') throw new ApiError('N/A is reserved for "the whole area stopped". Use a real equipment code.', 'bad_request');
      if (row.status !== 'Active' && row.status !== 'Retired') throw new ApiError('Status must be Active or Retired.', 'bad_request');
      for (const ar of areaIds ?? []) if (!d.areas.some((x) => x.area_id === ar)) throw new ApiError(`The area "${ar}" does not exist.`, 'bad_request');
      const at = d.equipment.findIndex((e) => e.equipment_id === id);
      const beforeEq = at >= 0 ? { ...d.equipment[at], areas: d.equipment_areas.filter((x) => x.equipment_id === id).map((x) => x.area_id).sort().join(', ') || '(none)' } : null;
      const description = String(row.description ?? '').trim() || undefined;
      const criticality = String(row.criticality ?? '').trim() || undefined;
      const missing: string[] = [];
      if (!description) missing.push('description');
      if (!criticality) missing.push('criticality');
      if (!(areaIds ?? []).length) missing.push('area');
      const next: Equipment = {
        ...row, equipment_id: id, description, criticality, updated_at: nowTs(), updated_by: a.user.user_id,
        needs_review: missing.length > 0, review_note: missing.length ? `Missing: ${missing.join(', ')}` : undefined,
        origin: at >= 0 ? (d.equipment[at]?.origin ?? row.origin) : 'User',
      };
      if (at >= 0) d.equipment[at] = { ...d.equipment[at], ...next };
      else d.equipment.push({ ...next, created_at: nowTs() });
      d.equipment_areas = d.equipment_areas.filter((x) => x.equipment_id !== id);
      for (const ar of new Set(areaIds ?? [])) d.equipment_areas.push({ equipment_id: id, area_id: ar });
      const areasText = [...new Set(areaIds ?? [])].sort().join(', ') || '(none)';
      audit(a.user.user_id, beforeEq ? 'update_equipment' : 'add_equipment', 'equipment', id, beforeEq
        ? auditChanges(beforeEq, { description: description ?? '', equipment_type: row.equipment_type, criticality: criticality ?? '', parent_id: row.parent_id, status: row.status, areas: areasText },
          ['description', 'equipment_type', 'criticality', 'parent_id', 'status', 'areas']) || 'No change'
        : `${description ?? '(no description)'}. Areas: ${areasText}`);
    },
    async saveArea(token, row) {
      const a = need(token, ['master'], 'Edit');
      const d = get();
      const id = String(row?.area_id ?? '').trim();
      if (!id) throw new ApiError('The area code cannot be empty.', 'bad_request');
      if (!String(row.name ?? '').trim()) throw new ApiError('The area needs a name.', 'bad_request');
      if (!d.lines.some((l) => l.line_id === row.line_id)) throw new ApiError(`The line "${row.line_id}" does not exist.`, 'bad_request');
      const next: Area = { ...row, area_id: id, name: row.name.trim(), active: row.active === true };
      const at = d.areas.findIndex((x) => x.area_id === id);
      const wasActive = at >= 0 ? d.areas[at]!.active : true;
      if (next.active !== wasActive && a.user.role_id !== 'ROLE-ADMIN') {
        throw new ApiError('Only an Admin can switch an area on or off (Settings > Areas).', 'forbidden', true);
      }
      const beforeArea = at >= 0 ? { ...d.areas[at] } : null;
      if (at >= 0) d.areas[at] = { ...d.areas[at], ...next };
      else d.areas.push(next);
      audit(a.user.user_id, beforeArea ? 'update_area' : 'add_area', 'areas', id, beforeArea
        ? auditChanges(beforeArea, next, ['name', 'line_id', 'sort_order', 'active', 'in_downtime_sheet', 'notes']) || 'No change'
        : `${next.name} on ${next.line_id}`);
    },
    async setAreaActive(token, areaId, active) {
      const a = auth(token);
      if (a.user.role_id !== 'ROLE-ADMIN') throw new ApiError('You do not have access to this.', 'forbidden', true);
      const id = typeof areaId === 'string' ? areaId.trim() : '';
      if (!id) throw new ApiError('Area code is required.', 'bad_request');
      if (typeof active !== 'boolean') throw new ApiError('Active must be true or false.', 'bad_request');
      const area = get().areas.find((x) => x.area_id === id);
      if (!area) throw new ApiError(`Unknown area: ${oneLine(id, 60)}.`, 'not_found');
      if (area.active !== active) {
        area.active = active;
        audit(a.user.user_id, active ? 'activate_area' : 'deactivate_area', 'areas', id, `${active ? 'Area switched on' : 'Area switched off'}: ${area.name} on ${area.line_id}`);
      }
      return clone(area);
    },
    async saveReason(token, row) {
      const a = need(token, ['master'], 'Edit');
      const d = get();
      if (!CLASS_CODES.includes(row?.classification)) throw new ApiError('Classification must be one of PRO, MEC, ELE, AUT, PL or CIR.', 'bad_request');
      if (!String(row.text_as_listed ?? '').trim()) throw new ApiError('The reason text cannot be empty.', 'bad_request');
      const mk = matchKey(row.text_as_listed);
      const clash = d.reasons.find((r) => r.classification === row.classification && r.match_key === mk && r.reason_id !== row.reason_id);
      if (clash) throw new ApiError(`That reason is already listed as ${clash.reason_id}.`, 'conflict');
      let id = row.reason_id;
      if (!id) {
        const order = Math.max(0, ...d.reasons.filter((r) => r.classification === row.classification).map((r) => r.order_no)) + 1;
        id = `R-${row.classification}-${String(order).padStart(3, '0')}`;
        row = { ...row, order_no: order };
      }
      const next: Reason = { ...row, reason_id: id, match_key: mk };
      const at = d.reasons.findIndex((r) => r.reason_id === id);
      const beforeReason = at >= 0 ? { ...d.reasons[at] } : null;
      if (at >= 0) d.reasons[at] = next; else d.reasons.push(next);
      audit(a.user.user_id, beforeReason ? 'update_reason' : 'add_reason', 'reasons', id, beforeReason
        ? auditChanges(beforeReason, next, ['classification', 'text_as_listed', 'order_no', 'active']) || 'No change'
        : `${next.classification}: ${auditValue(next.text_as_listed, 120)}`);
    },
    async saveAlias(token, row) {
      const a = need(token, ['master'], 'Edit');
      const d = get();
      const alias = codeKey(row?.alias);
      if (!alias) throw new ApiError('The alias cannot be empty.', 'bad_request');
      if (!d.equipment.some((e) => e.equipment_id === row.equipment_id)) throw new ApiError(`The equipment code "${row.equipment_id}" does not exist.`, 'bad_request');
      if (d.equipment.some((e) => e.equipment_id === alias)) throw new ApiError('That alias is already a real equipment code.', 'conflict');
      const next: EquipmentAlias = { alias, equipment_id: row.equipment_id, reason: row.reason };
      const at = d.aliases.findIndex((x) => codeKey(x.alias) === alias);
      const was = at >= 0 ? d.aliases[at]!.equipment_id : '';
      if (at >= 0) d.aliases[at] = next; else d.aliases.push(next);
      audit(a.user.user_id, at >= 0 ? 'update_alias' : 'add_alias', 'equipment_aliases', alias,
        `Points to ${row.equipment_id}${was && was !== row.equipment_id ? ` (was ${was})` : ''}${next.reason ? `. Reason: ${auditValue(next.reason, 80)}` : ''}`);
    },
    async deleteAlias(token, alias) {
      const a = need(token, ['master'], 'Edit');
      const d = get();
      const k = codeKey(alias);
      const at = d.aliases.findIndex((x) => codeKey(x.alias) === k);
      if (at < 0) throw new ApiError('That alias was not found.', 'not_found');
      const gone = d.aliases.splice(at, 1)[0]!;
      audit(a.user.user_id, 'delete_alias', 'equipment_aliases', k, `Was pointing to ${gone.equipment_id}`);
    },
    async saveSettings(token, changes) {
      const a = need(token, ['settings'], 'Edit');
      const d = get();
      // the same ranges as backend/apps-script/Settings.js
      const ranges: Record<string, [number, number]> = {
        scheduled_hours_per_day: [1, 24], scheduled_days_per_week: [1, 7], repeat_min_events: [2, 100], repeat_window_days: [1, 3650],
        duration_short_max_min: [1, 10000], duration_long_min_min: [1, 100000], lockout_attempts: [1, 100], lockout_minutes: [1, 1440],
        session_hours: [1, 168], session_hours_keep: [1, 8760], min_password_length: [8, 128],
        notif_long_stop_hours: [1, 720], notif_spike_pct: [1, 1000], notif_upload_gap_days: [1, 3650], notif_retention_days: [1, 3650],
        actions_repeat_n: [2, 100], actions_repeat_days: [1, 3650], actions_chronic_top: [1, 100], actions_chronic_months: [1, 24], actions_effect_days: [1, 3650],
      };
      for (const [k, v] of Object.entries(changes ?? {})) {
        if (!d.settings.some((s) => s.key === k)) throw new ApiError(`There is no setting called "${k}".`, 'bad_request');
        const val = String(v ?? '').trim();
        const range = ranges[k];
        if (range) {
          const n = Number(val);
          if (val === '' || !Number.isInteger(n) || n < range[0] || n > range[1]) {
            throw new ApiError(`"${k}" must be a whole number between ${range[0]} and ${range[1]}.`, 'bad_request');
          }
        }
        if (k === 'availability_basis' && !['A', 'B', 'C'].includes(val)) throw new ApiError('Availability basis must be A, B or C.', 'bad_request');
        if (k === 'default_comparison' && !['previous_period', 'same_period_last_year'].includes(val)) throw new ApiError('Comparison must be previous_period or same_period_last_year.', 'bad_request');
        if (k === 'notif_repeat_alert' && !['true', 'false'].includes(val)) throw new ApiError('Repeat alerts must be true or false.', 'bad_request');
        if (k === 'app_url' && val !== '' && (val.length > 300 || !/^https?:\/\/[^\s<>"']+$/i.test(val))) throw new ApiError('The app address must start with http:// or https://, or be blank.', 'bad_request');
        if ((k === 'target_mtbf_h' || k === 'target_mttr_h') && val !== '' && !(Number.isFinite(Number(val)) && Number(val) > 0 && Number(val) <= 100000)) throw new ApiError('The target must be above 0 and at most 100000 hours, or blank.', 'bad_request');
        if (k === 'utilization_target_pct' && val !== '' && !(Number.isFinite(Number(val)) && Number(val) >= 0 && Number(val) <= 100)) throw new ApiError('The utilization factor target must be between 0 and 100, or blank.', 'bad_request');
        if (k === 'reliability_target_pct' && val !== '' && !(Number.isFinite(Number(val)) && Number(val) >= 0 && Number(val) <= 100)) throw new ApiError('The reliability factor target must be between 0 and 100, or blank.', 'bad_request');
        if (k === 'availability_target_pct' && val !== '' && !(Number.isFinite(Number(val)) && Number(val) >= 0 && Number(val) <= 100)) throw new ApiError('The availability target must be between 0 and 100, or blank.', 'bad_request');
        if (k === 'actions_auto_draft' && !['true', 'false'].includes(val)) throw new ApiError('Auto drafts must be true or false.', 'bad_request');
        if (k === 'actions_closers') actionStore.cleanClosers(val);
      }
      for (const [k, v] of Object.entries(changes ?? {})) {
        const s = d.settings.find((x) => x.key === k)!;
        const value = k === 'actions_closers' ? actionStore.cleanClosers(String(v ?? '')) : String(v ?? '').trim();
        if (value === s.value) continue; // like the server: an unchanged value is not written or logged
        audit(a.user.user_id, 'save_setting', 'settings', k, `${s.value} -> ${value}`);
        s.value = value;
        s.updated_by = a.user.user_id;
        s.updated_at = nowTs();
      }
    },

    // --- users
    async listUsers(token) {
      need(token, ['users'], 'View');
      return clone(get().users.map(adminUser));
    },
    async createUser(token, u) {
      const a = need(token, ['users'], 'Edit');
      const d = get();
      const email = String(u?.email ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('Please enter a valid email address.', 'bad_request');
      if (d.users.some((x) => x.email === email)) throw new ApiError('Someone already has that email address.', 'conflict');
      if (!String(u.display_name ?? '').trim()) throw new ApiError('Please enter a name.', 'bad_request');
      if (!d.roles.some((r) => r.role_id === u.role_id)) throw new ApiError('Please choose a role.', 'bad_request');
      const temp = randomTempPassword();
      const user: MockUser = {
        user_id: `U-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, email, display_name: u.display_name.trim(), role_id: u.role_id,
        password: temp, must_change: true, active: true, failed_attempts: 0, created_at: nowTs(), overrides: {},
      };
      d.users.push(user);
      audit(a.user.user_id, 'create_user', 'users', user.user_id, `${email} as ${user.role_id}`);
      userEvent('created', a.user, user);
      return clone({ user: adminUser(user), temp_password: temp });
    },
    async updateUser(token, userId, changes) {
      const a = need(token, ['users'], 'Edit');
      const d = get();
      const user = d.users.find((x) => x.user_id === userId);
      if (!user) throw new ApiError('That user was not found.', 'not_found');
      if (user.user_id === a.user.user_id && (changes.active === false || (changes.role_id && changes.role_id !== user.role_id))) {
        throw new ApiError('You cannot deactivate yourself or change your own role.', 'conflict');
      }
      const beforeUser = { display_name: user.display_name, role_id: user.role_id, active: user.active };
      if (changes.display_name !== undefined) {
        if (!String(changes.display_name).trim()) throw new ApiError('Please enter a name.', 'bad_request');
        user.display_name = String(changes.display_name).trim();
      }
      if (changes.role_id !== undefined) {
        if (!d.roles.some((r) => r.role_id === changes.role_id)) throw new ApiError('Please choose a role.', 'bad_request');
        if (changes.role_id !== user.role_id) userEvent('role_changed', a.user, user, `from ${user.role_id} to ${changes.role_id}`);
        user.role_id = changes.role_id;
      }
      if (changes.active !== undefined) user.active = !!changes.active;
      audit(a.user.user_id, 'update_user', 'users', userId, auditChanges(beforeUser, { display_name: user.display_name, role_id: user.role_id, active: user.active }, ['display_name', 'role_id', 'active']) || 'No change');
      return clone(adminUser(user));
    },
    async resetPassword(token, userId) {
      const a = need(token, ['users'], 'Edit');
      const user = get().users.find((x) => x.user_id === userId);
      if (!user) throw new ApiError('That user was not found.', 'not_found');
      const temp = randomTempPassword();
      user.password = temp;
      user.must_change = true;
      user.failed_attempts = 0;
      user.locked_until = undefined;
      audit(a.user.user_id, 'reset_password', 'users', userId, 'Temporary password issued');
      userEvent('password_reset', a.user, user);
      return { temp_password: temp };
    },
    async setUserTabAccess(token, userId, overrides) {
      const a = need(token, ['users'], 'Edit');
      const user = get().users.find((x) => x.user_id === userId);
      if (!user) throw new ApiError('That user was not found.', 'not_found');
      const clean: Partial<Access> = {};
      for (const [k, v] of Object.entries(overrides ?? {})) {
        if (!TAB_IDS.includes(k as TabId)) throw new ApiError(`There is no tab called "${k}".`, 'bad_request');
        if (v !== 'Hidden' && v !== 'View' && v !== 'Edit') throw new ApiError('Access must be Hidden, View or Edit.', 'bad_request');
        clean[k as TabId] = v;
      }
      if (user.user_id === a.user.user_id && (clean.users ?? roleLevel(user.role_id, 'users')) !== 'Edit') {
        throw new ApiError('You cannot take away your own access to Users.', 'conflict');
      }
      const was = user.overrides;
      user.overrides = clean;
      audit(a.user.user_id, 'set_tab_access', 'users', userId, TAB_IDS.filter((t) => was[t] !== clean[t])
        .map((t) => `${t}: ${was[t] ?? 'role default'} -> ${clean[t] ?? 'role default'}`).join('; ') || 'No change');
      return clone(adminUser(user));
    },

    // --- notifications
    async getNotifications(token) {
      const a = auth(token);
      seedDemoActions();
      if (!notifSeeded) runChecks();
      const stamp = nowTs();
      const inactive = inactiveAreas();
      const items = notifications.filter((n) => notifVisible(n, a.access, stamp, a.user) && !ofInactiveArea(n, inactive))
        .sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : x.notification_id < y.notification_id ? -1 : 1));
      const ids = new Set(items.map((n) => n.notification_id));
      return clone({
        items: items.map((n) => ({ ...n, category: NOTIFICATION_CATEGORY_OF[n.type] })),
        state: notifState.filter((s) => s.user_id === a.user.user_id && ids.has(s.notification_id)), prefs: prefsOf(a.user.user_id),
      });
    },
    async setNotificationState(token, notificationId, state, snoozeUntil) {
      const a = auth(token);
      if (!notifSeeded) runChecks();
      const id = String(notificationId ?? '').trim();
      if (!id) throw new ApiError('Notification is required.', 'bad_request');
      if (state !== 'seen' && state !== 'snoozed' && state !== 'dismissed') throw new ApiError('State must be seen, snoozed or dismissed.', 'bad_request');
      let until = '';
      if (state === 'snoozed') {
        if (typeof snoozeUntil !== 'string' || !snoozeUntil.trim()) throw new ApiError('Choose how long to snooze.', 'bad_request');
        const raw = snoozeUntil.trim();
        const full = isValidDate(raw) ? `${raw} 00:00:00.000` : raw;
        const ms = parseTs(full);
        if (ms === null) throw new ApiError('The snooze time is not valid.', 'bad_request');
        until = fmtTs(ms);
        if (until <= tsAt(now())) throw new ApiError('The snooze time must be in the future.', 'bad_request');
        if (until > tsAt(now() + SNOOZE_MAX_DAYS * 86_400_000)) throw new ApiError('The snooze time is too far ahead.', 'bad_request');
      }
      const n = notifications.find((x) => x.notification_id === id);
      if (!n || !notifVisible(n, a.access, nowTs(), a.user)) throw new ApiError('Notification not found.', 'not_found');
      const rec: NotificationState = { user_id: a.user.user_id, notification_id: id, state, snooze_until: until, updated_at: nowTs() };
      const at = notifState.findIndex((s) => s.user_id === rec.user_id && s.notification_id === id);
      if (at >= 0) notifState[at] = rec; else notifState.push(rec);
      return clone(rec);
    },
    async saveNotificationPrefs(token, prefs) {
      const a = auth(token);
      if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) throw new ApiError('Preferences are missing.', 'bad_request');
      const keys = Object.keys(prefs);
      if (!keys.length) throw new ApiError('No changes to save.', 'bad_request');
      const csv = (v: string): string[] => v.split(',').map((x) => x.trim()).filter(Boolean);
      const clean: Record<string, string> = {};
      for (const k of keys) {
        const raw = (prefs as Record<string, unknown>)[k];
        if (!['alert_types', 'watch_areas', 'digest', 'last_seen_at', 'saved_views', 'saved_reports', 'theme'].includes(k)) throw new ApiError(`Unknown preference: ${oneLine(k, 40)}.`, 'bad_request');
        if (typeof raw !== 'string') throw new ApiError(`Preference ${k} must be text.`, 'bad_request');
        const v = raw.trim();
        if (k === 'digest') {
          if (!['none', 'daily', 'weekly'].includes(v)) throw new ApiError('Digest must be none, daily or weekly.', 'bad_request');
          clean[k] = v;
        } else if (k === 'alert_types') {
          const picked: string[] = [];
          for (const t of csv(v)) {
            if (!(NOTIFICATION_TYPES as string[]).includes(t)) throw new ApiError(`Unknown alert type: ${oneLine(t, 40)}.`, 'bad_request');
            if (!picked.includes(t)) picked.push(t);
          }
          clean[k] = picked.join(',');
        } else if (k === 'watch_areas') {
          const chosen: string[] = [];
          for (const ar of csv(v)) {
            const real = get().areas.find((x) => x.area_id.toLowerCase() === ar.toLowerCase());
            if (!real) throw new ApiError(`Area "${oneLine(ar, 40)}" is not in the list of areas.`, 'bad_request');
            if (!chosen.includes(real.area_id)) chosen.push(real.area_id);
          }
          clean[k] = chosen.join(',');
        } else if (k === 'theme') {
          if (v !== '' && !THEME_NAMES.includes(v)) throw new ApiError(`Theme must be one of: ${THEME_NAMES.join(', ')}.`, 'bad_request');
          clean[k] = v;
        } else if (k === 'saved_views') {
          clean[k] = cleanSavedViews(v);
        } else if (k === 'saved_reports') {
          clean[k] = cleanSavedReports(v);
        } else {
          const ms = parseTs(v);
          if (ms === null) throw new ApiError('Last seen must be a time like 2026-03-05 10:00:00.000.', 'bad_request');
          clean[k] = fmtTs(ms);
        }
      }
      if (opts.keepAccountThemes && clean.theme !== undefined) writeKeptTheme(a.user.user_id, clean.theme);
      for (const [k, value] of Object.entries(clean)) {
        const rec = { user_id: a.user.user_id, key: k, value, updated_at: nowTs() };
        const at = notifPrefs.findIndex((r) => r.user_id === rec.user_id && r.key === k);
        if (at >= 0) notifPrefs[at] = rec; else notifPrefs.push(rec);
      }
      return prefsOf(a.user.user_id);
    },
    async runNotificationChecks(token) {
      const a = need(token, ['settings'], 'Edit');
      const res = runChecks();
      safely(() => { actionStore.runChecks(); });
      audit(a.user.user_id, 'notification_check', 'notifications', '', `Created ${res.created}, resolved ${res.resolved}, expired ${res.expired}`);
      return res;
    },

    // --- actions
    async listActions(token) {
      const a = need(token, ['actions'], 'View');
      seedDemoActions();
      return actionStore.list(a.user);
    },
    async createAction(token, input, options) {
      const a = need(token, ['actions'], 'Edit');
      return actionStore.create(a.user, input, options);
    },
    async updateAction(token, actionId, changes) {
      const a = need(token, ['actions'], 'Edit');
      return actionStore.update(a.user, actionId, changes);
    },
    async addActionComment(token, actionId, text) {
      const a = need(token, ['actions'], 'Edit');
      return actionStore.comment(a.user, actionId, text);
    },
    async saveContractors(token, rows) {
      const a = need(token, ['settings'], 'Edit');
      return actionStore.saveContractors(a.user, rows);
    },
    async getAreaTargets(token, year) {
      auth(token);
      seedDemoActions();
      return actionStore.getTargets(year);
    },
    async saveAreaTargets(token, year, rows) {
      const a = need(token, ['settings'], 'Edit');
      return actionStore.saveTargets(a.user, year, rows);
    },
    async runActionChecks(token) {
      const a = need(token, ['settings'], 'Edit');
      const res = actionStore.runChecks();
      audit(a.user.user_id, 'action_check', 'actions', '', `Created ${res.created}, merged ${res.merged}, effectiveness ${res.effectiveness}`);
      return res;
    },
    // --- tasks inside actions (backend 1.7.0)
    async addTask(token, actionId, task) {
      const a = need(token, ['actions'], 'Edit');
      return actionStore.addTask(a.user, actionId, task);
    },
    async updateTask(token, taskId, changes) {
      const a = need(token, ['actions'], 'Edit');
      return actionStore.updateTask(a.user, taskId, changes);
    },
    async applyTemplate(token, actionId, templateId) {
      const a = need(token, ['actions'], 'Edit');
      return actionStore.applyTemplate(a.user, actionId, templateId);
    },
    async listTasks(token, filter) {
      const a = need(token, ['actions'], 'View');
      seedDemoActions();
      return actionStore.listTasks(a.user, filter ?? {});
    },
    async listTaskTemplates(token) {
      auth(token);
      return actionStore.listTemplates();
    },
    async saveTaskTemplates(token, templates) {
      const a = need(token, ['settings'], 'Edit');
      return actionStore.saveTemplates(a.user, templates);
    },

    // --- admin only (backend 1.6.0)
    async listActiveUsers(token) {
      needAdmin(token);
      const nowMs = now();
      const nowText = tsOf(nowMs);
      const pNow = parseTs(nowText) ?? 0;
      const today = nowText.slice(0, 10);
      const users: ActiveUser[] = get().users.map((u) => {
        const act = activity.get(u.user_id);
        const demo = demoSeen.get(u.user_id);
        let seenMs = act?.s ?? 0;
        let page = act?.p ?? '';
        let device: DeviceKind | '' = act?.d ?? '';
        if (demo && nowMs - demo.ago > seenMs) { seenMs = nowMs - demo.ago; page = demo.p; device = demo.d; }
        let seen = seenMs ? tsOf(seenMs) : '';
        if (u.last_login_at && u.last_login_at > seen) seen = u.last_login_at;
        const t = seen ? parseTs(seen) : null;
        return {
          user_id: u.user_id, display_name: u.display_name, role_id: u.role_id, active: u.active,
          last_seen_at: seen, last_page: page, device,
          online: u.active && t !== null && pNow - t <= ACTIVITY_ONLINE_MS && pNow - t >= -60_000,
          today: u.active && seen.slice(0, 10) === today,
        };
      }).sort((x, y) => (x.online !== y.online ? (x.online ? -1 : 1)
        : x.last_seen_at !== y.last_seen_at ? (x.last_seen_at < y.last_seen_at ? 1 : -1) : x.display_name.localeCompare(y.display_name)));
      return clone({
        now: nowText, online_minutes: ACTIVITY_ONLINE_MS / 60_000, users,
        online_count: users.filter((u) => u.online).length, today_count: users.filter((u) => u.today).length,
      });
    },
    async listAuditLog(token, filter, cursor) {
      needAdmin(token);
      const bad = (m: string) => new ApiError(m, 'bad_request');
      const f = (filter ?? {}) as Record<string, unknown>;
      if (typeof f !== 'object' || Array.isArray(f)) throw bad('Filter is missing.');
      for (const k of Object.keys(f)) if (!['user_id', 'group', 'from', 'to', 'q', 'limit'].includes(k)) throw bad(`Filter has an unknown field: ${oneLine(k, 40)}.`);
      const userId = typeof f.user_id === 'string' ? f.user_id.trim() : '';
      const group = f.group === undefined || f.group === null || f.group === '' ? '' : String(f.group);
      if (group && !(AUDIT_GROUPS as readonly string[]).includes(group)) throw bad('Unknown kind of change.');
      const from = f.from ? String(f.from) : '';
      const to = f.to ? String(f.to) : '';
      if ((from && !isValidDate(from)) || (to && !isValidDate(to))) throw bad('Dates must look like 2026-10-14.');
      if (from && to && from > to) throw bad('The start date is after the end date.');
      const q = typeof f.q === 'string' ? f.q.trim().toLowerCase() : '';
      if (q.length > 100) throw bad('Search text is too long.');
      const limit = f.limit === undefined || f.limit === null ? 100 : f.limit;
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 200) throw bad('Page size must be a whole number from 1 to 200.');
      let start: number | null = null;
      if (cursor !== undefined && cursor !== null && cursor !== '') {
        const m = /^r(\d{1,9})$/.exec(String(cursor));
        if (!m) throw bad('The page marker is not valid. Start again from the top.');
        start = Number(m[1]) - 2;
      }
      const log = get().audit_log;
      const names = new Map(get().users.map((u) => [u.user_id, u.display_name.toLowerCase()]));
      const minAt = from ? `${from} 00:00:00.000` : '';
      const maxAt = to ? `${to} 23:59:59.999` : '';
      const actions = group && group !== 'system' ? AUDIT_GROUP_ACTIONS[group as AuditGroup] : null;
      const entries: AuditEntry[] = [];
      let i = start === null ? log.length - 1 : Math.min(start, log.length - 1);
      let scanned = 0;
      for (; i >= 0 && entries.length < limit && scanned < 20_000; i--) {
        const e = log[i]!;
        scanned++;
        if (minAt && e.at < minAt) { i = -1; break; }
        if (maxAt && e.at > maxAt) continue;
        if (userId && e.user_id !== userId) continue;
        if (group === 'system' ? auditGroupOf(e.action) !== 'system' : actions && !actions.includes(e.action)) continue;
        if (q && ![e.action, e.entity, e.entity_id, e.detail, e.user_id, names.get(e.user_id ?? '') ?? ''].join(' ').toLowerCase().includes(q)) continue;
        entries.push({
          at: e.at, user_id: e.user_id ?? '', action: e.action, entity: e.entity ?? '', entity_id: e.entity_id ?? '', detail: e.detail ?? '',
          group: auditGroupOf(e.action),
        });
      }
      return clone({
        entries, next_cursor: i >= 0 ? `r${i + 2}` : null, scanned,
        users: get().users.map((u) => ({ user_id: u.user_id, display_name: u.display_name })),
      });
    },
  };
  return api;
}

export const mockApi: MockApi = createMockApi({ demoActions: true, keepAccountThemes: true });
