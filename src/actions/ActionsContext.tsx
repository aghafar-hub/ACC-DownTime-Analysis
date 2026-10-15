import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError } from '../api';
import type {
  Action, ActionChanges, ActionResult, ActionsPayload, ActionSource, ActionScope, AreaTarget, CreateActionResult, NewAction, NewTask, TaskChanges, TaskResult,
  TaskTemplate, TaskTemplateInput,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { actionsResource, areaTargetsResource, type ResState } from '../data/stores';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useOnlineStatus } from '../useOnlineStatus';
import { todayLocal } from './model';
import { overdueTaskCount } from './tasks';
import './actions.css';

// One shared copy of the actions (listActions) for the shell: the Actions page, the overdue badge on its navigation item,
// the create dialog that any page can open (Reports, Pareto, Repeated failures, Event records, notifications), and the
// note that says where a new action went ("Added to existing action AC-…"). Changes are sent one at a time and patched into
// the shared copy (and the device cache) from the server's answer.

const CreateActionDialog = lazy(() => import('./CreateActionDialog'));

/** What a create dialog opened from somewhere else is filled in with. */
export interface ActionPrefill {
  source: ActionSource;
  /** 'FROM Report › Monthly management report › 262.MT120' */
  trail?: string[];
  source_ref?: string;
  scope_kind?: ActionScope;
  area_id?: string;
  line_id?: string;
  equipment_id?: string;
  reason_key?: string;
  title?: string;
  detail?: string;
  /** event ids (records) to attach as evidence */
  eventIds?: string[];
  /** hours of those records, for the summary line */
  hours?: number;
  /** backend 1.7.0: the draft rule this kind of problem matches, so its task template is offered first */
  suggest?: ActionSource;
}

export interface ActionsState extends ResState<ActionsPayload> {
  payload: ActionsPayload | null;
  actions: Action[];
  /** may this person create and change actions (Edit on the actions tab) */
  canEdit: boolean;
  canView: boolean;
  online: boolean;
  /** why changes cannot be made right now (offline), or null */
  blockedReason: string | null;
  reload: () => void;
  create: (input: NewAction, merge?: boolean) => Promise<{ ok: true; value: CreateActionResult } | { ok: false; error: string }>;
  update: (id: string, changes: ActionChanges) => Promise<{ ok: true; value: ActionResult } | { ok: false; error: string }>;
  comment: (id: string, text: string) => Promise<{ ok: true; value: ActionResult } | { ok: false; error: string }>;
  /** backend 1.7.0: tasks inside actions */
  addTask: (actionId: string, task: NewTask) => Promise<{ ok: true; value: TaskResult } | { ok: false; error: string }>;
  updateTask: (taskId: string, changes: TaskChanges) => Promise<{ ok: true; value: TaskResult } | { ok: false; error: string }>;
  applyTemplate: (actionId: string, templateId: string) => Promise<{ ok: true; value: TaskResult } | { ok: false; error: string }>;
  /** puts the templates the server returned (saveTaskTemplates) into the shared copy */
  storeTemplates: (templates: TaskTemplate[]) => void;
  saveTemplates: (templates: TaskTemplateInput[]) => Promise<{ ok: true; value: TaskTemplate[] } | { ok: false; error: string }>;
  /** opens the create dialog (manual when no prefill) */
  openCreate: (prefill?: ActionPrefill) => void;
  /** shows the "created / added to existing" note with a link */
  announce: (res: CreateActionResult) => void;
  /** open tasks past their due date (the badge on the Actions navigation item) */
  overdue: number;
}

const ctx = createContext<ActionsState | null>(null);

const NONE: ResState<ActionsPayload> = { data: null, loading: false, refreshing: false, error: null, accessDenied: false, fromCache: false, savedAt: null };
const noSub = () => () => {};
const noSnap = () => NONE;

function patchPayload(p: ActionsPayload, res: ActionResult | TaskResult): ActionsPayload {
  const id = res.action.action_id;
  const at = p.actions.findIndex((a) => a.action_id === id);
  const actions = at >= 0 ? p.actions.map((a) => (a.action_id === id ? res.action : a)) : [res.action, ...p.actions];
  const logs = [...p.logs.filter((l) => l.action_id !== id), ...res.logs];
  // backend 1.7.0: the answer carries every task of the action (an older server sends none: keep what is there)
  const tasks = res.tasks ? [...(p.tasks ?? []).filter((x) => x.action_id !== id), ...res.tasks] : p.tasks;
  return { ...p, actions, logs, ...(tasks ? { tasks } : {}) };
}

export function ActionsProvider({ children }: { children: ReactNode }) {
  const { token, canView, canEdit } = useAuth();
  const view = canView('actions');
  const edit = canEdit('actions');
  const online = useOnlineStatus();
  const state = useSyncExternalStore(view ? actionsResource.subscribe : noSub, view ? actionsResource.getSnapshot : noSnap);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  useEffect(() => {
    if (token && view) void actionsResource.load(token);
  }, [token, view]);
  // the overdue count follows the day
  const [today, setToday] = useState(todayLocal);
  useEffect(() => {
    const id = window.setInterval(() => setToday(todayLocal()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const reload = useCallback(() => {
    if (tokenRef.current && view) void actionsResource.load(tokenRef.current, true);
  }, [view]);

  const blockedReason = !online ? t('You are offline. Changes need a connection.') : null;
  const guard = useCallback(async <T,>(fn: (tok: string) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> => {
    const tok = tokenRef.current;
    if (!tok) return { ok: false, error: t('Please sign in again.') };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, error: t('You are offline. Changes need a connection.') };
    try {
      return { ok: true, value: await fn(tok) };
    } catch (err) {
      return { ok: false, error: describeError(err) };
    }
  }, []);
  const apply = useCallback((res: ActionResult | TaskResult) => actionsResource.patch((p) => patchPayload(p, res)), []);
  const create = useCallback(async (input: NewAction, merge = true) => {
    const r = await guard((tok) => api.createAction(tok, input, { merge }));
    if (r.ok) apply(r.value);
    return r;
  }, [guard, apply]);
  const update = useCallback(async (id: string, changes: ActionChanges) => {
    const r = await guard((tok) => api.updateAction(tok, id, changes));
    if (r.ok) apply(r.value);
    return r;
  }, [guard, apply]);
  const comment = useCallback(async (id: string, text: string) => {
    const r = await guard((tok) => api.addActionComment(tok, id, text));
    if (r.ok) apply(r.value);
    return r;
  }, [guard, apply]);

  const addTask = useCallback(async (actionId: string, task: NewTask) => {
    const r = await guard((tok) => api.addTask(tok, actionId, task));
    if (r.ok) apply(r.value);
    return r;
  }, [guard, apply]);
  const updateTask = useCallback(async (taskId: string, changes: TaskChanges) => {
    const r = await guard((tok) => api.updateTask(tok, taskId, changes));
    if (r.ok) apply(r.value);
    return r;
  }, [guard, apply]);
  const applyTemplate = useCallback(async (actionId: string, templateId: string) => {
    const r = await guard((tok) => api.applyTemplate(tok, actionId, templateId));
    if (r.ok) apply(r.value);
    return r;
  }, [guard, apply]);
  const storeTemplates = useCallback((templates: TaskTemplate[]) => actionsResource.patch((p) => ({ ...p, templates })), []);
  const saveTemplates = useCallback(async (templates: TaskTemplateInput[]) => {
    const r = await guard((tok) => api.saveTaskTemplates(tok, templates));
    if (r.ok) storeTemplates(r.value);
    return r;
  }, [guard, storeTemplates]);

  const [dialog, setDialog] = useState<{ prefill?: ActionPrefill; key: number } | null>(null);
  const openCreate = useCallback((prefill?: ActionPrefill) => {
    if (tokenRef.current && view) void actionsResource.load(tokenRef.current);
    setDialog({ prefill, key: Date.now() });
  }, [view]);
  const [note, setNote] = useState<CreateActionResult | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const announce = useCallback((res: CreateActionResult) => {
    setNote(res);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNote(null), 12_000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const actions = state.data?.actions;
  const tasks = state.data?.tasks;
  const overdue = useMemo(() => (actions ? overdueTaskCount(actions, tasks ?? [], today) : 0), [actions, tasks, today]);
  const value = useMemo<ActionsState>(() => ({
    ...state, payload: state.data, actions: state.data?.actions ?? [], canEdit: edit, canView: view, online, blockedReason, reload,
    create, update, comment, addTask, updateTask, applyTemplate, storeTemplates, saveTemplates, openCreate, announce, overdue,
  }), [state, edit, view, online, blockedReason, reload, create, update, comment, addTask, updateTask, applyTemplate, storeTemplates, saveTemplates, openCreate, announce, overdue]);

  return (
    <ctx.Provider value={value}>
      {children}
      {dialog && edit && (
        <Suspense fallback={null}>
          <CreateActionDialog key={dialog.key} prefill={dialog.prefill} onClose={() => setDialog(null)} />
        </Suspense>
      )}
      {note && (
        <div className="act-toast" role="status" data-testid="action-created-toast" data-merged={note.merged || undefined}>
          <Icon name={note.merged ? 'link' : 'check'} size={16} />
          <span>
            {note.merged
              ? t('Added to existing action {id}', { id: note.action.action_id })
              : (note.tasks?.length ?? 0) > 0
                ? t('Created {id} ({s}) with {n} tasks', { id: note.action.action_id, s: t(note.action.status), n: note.tasks!.length })
                : t('Created {id} ({s})', { id: note.action.action_id, s: t(note.action.status) })}
          </span>
          <Link to={`/actions?id=${encodeURIComponent(note.action.action_id)}`} className="act-toast-link" onClick={() => setNote(null)} data-testid="action-created-link">
            {t('Open {id}', { id: note.action.action_id })}
          </Link>
          <button type="button" className="act-toast-x" onClick={() => setNote(null)} aria-label={t('Dismiss')}><Icon name="close" size={16} /></button>
        </div>
      )}
    </ctx.Provider>
  );
}

export function useActions(): ActionsState {
  const v = useContext(ctx);
  if (!v) throw new Error('useActions needs the ActionsProvider');
  return v;
}
export const useActionsOptional = (): ActionsState | null => useContext(ctx);

/** "Create action" from anywhere: null when the person may not create actions (or outside the shell). */
export function useCreateAction(): ((prefill?: ActionPrefill) => void) | null {
  const v = useContext(ctx);
  return v && v.canEdit ? v.openCreate : null;
}

/** The area targets of every year (any signed-in user). */
export function useAreaTargets(): ResState<AreaTarget[]> & { targets: AreaTarget[]; reload: () => void } {
  const { token } = useAuth();
  const state = useSyncExternalStore(areaTargetsResource.subscribe, areaTargetsResource.getSnapshot);
  useEffect(() => {
    if (token) void areaTargetsResource.load(token);
  }, [token]);
  const reload = useCallback(() => {
    if (token) void areaTargetsResource.load(token, true);
  }, [token]);
  return useMemo(() => ({ ...state, targets: state.data ?? [], reload }), [state, reload]);
}

/** Replaces the cached targets of one year with what the server saved. */
export function storeYearTargets(year: number, rows: AreaTarget[]): void {
  areaTargetsResource.patch((all) => [...all.filter((r) => r.year !== year), ...rows]);
}

/** The overdue-task count beside the Actions navigation item (danger colour), nothing when none are overdue. */
export function ActionsBadge({ testid = 'actions-badge' }: { testid?: string }) {
  const v = useContext(ctx);
  if (!v || v.overdue === 0) return null;
  const label = v.overdue === 1 ? t('1 task overdue') : t('{n} tasks overdue', { n: v.overdue });
  return (
    <span className="vbadge vbadge--danger" role="img" aria-label={label} title={label} data-testid={testid}>
      <span aria-hidden="true">▲</span>
      <span>{v.overdue > 99 ? '99+' : v.overdue}</span>
    </span>
  );
}

export { describeError };
