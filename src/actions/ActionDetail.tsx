// One action (docs/actions-mockups/desktop-action-detail.png, mobile-action-detail.png): a wide panel over the page on a
// desktop, the full screen on a phone. Header with the stepper and the status buttons; the problem, the evidence (records
// linked to Event records), the root cause and the required action, the comments; on the side the assignment (person,
// contractor, due date, priority, stoppage), the effectiveness check and the history. People with View only read it all.
// Backend 1.7.0 (docs/actions-mockups/tasks/02, 03, 11): the Tasks section is the main content; the stepper is Draft -> Open
// -> In progress -> Closed, the status follows the tasks, Close waits until every task is Done or Not needed (then a green
// "ready to close" banner takes the closing note), and the due date follows the tasks.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  ACTION_PRIORITIES, ACTION_ROOT_CAUSES, actionProgress, isTerminalStatus,
  type Action, type ActionChanges, type ActionLog, type ActionPriority, type ActionRootCause, type ActionStatus, type EventRow,
} from '../api/types';
import AccessBadge from '../components/AccessBadge';
import { useStartup } from '../data/useStartup';
import { useIsMobile } from '../hooks/useIsMobile';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { tsText, dateText, dayText } from '../util/dates';
import { useValidationOptional } from '../validate/ValidationContext';
import { useActions } from './ActionsContext';
import {
  BOARD_STATUSES, contractorName, defaultOwnerFor, dueInfo, dueOf, evidenceIds, newEvidence, nextStatus, NOTE_MIN, personName, ROOT_CAUSE_LABEL, SOURCE_LABEL, statusKey,
  taskTally, todayLocal, watchDaysLeft,
} from './model';
import { Avatar, cardHead, EffectBadge, PriorityTag, SourceTag, StatusChip, scopeText } from './parts';
import StatusDialog from './StatusDialog';
import TasksSection from './TasksSection';
import { tasksOfAction } from './tasks';

const hoursOf = (r: EventRow): number => (r.duration_s ?? 0) / 3600;

function Section({ icon, title, right, children, testid }: { icon?: string; title: string; right?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <section className="ad-sec" data-testid={testid}>
      <header className="ad-sec-head">{icon && <Icon name={icon} size={16} />}<h3>{title}</h3>{right && <span className="ad-sec-right">{right}</span>}</header>
      {children}
    </section>
  );
}

/** A text box that saves when its Save button is pressed (shown once it differs from what is stored). */
function SavedText({ value, onSave, disabled, rows = 3, label, testid, max = 2000, single }: {
  value: string; onSave: (v: string) => Promise<boolean>; disabled: boolean; rows?: number; label: string; testid: string; max?: number; single?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft.trim() !== value.trim();
  const save = async () => {
    setBusy(true);
    const ok = await onSave(draft.trim());
    setBusy(false);
    if (!ok) return;
  };
  return (
    <div className="ad-text">
      {single
        ? <input className="input" aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} readOnly={disabled} maxLength={max} data-testid={testid} />
        : <textarea className="textarea" aria-label={label} rows={rows} value={draft} onChange={(e) => setDraft(e.target.value)} readOnly={disabled} maxLength={max} data-testid={testid} placeholder={disabled ? '' : t('Not written yet')} />}
      {!disabled && dirty && (
        <span className="ad-text-btns">
          <button type="button" className="btn btn-sm" onClick={() => setDraft(value)} disabled={busy}>{t('Undo')}</button>
          <button type="button" className="btn-primary btn-sm" onClick={() => void save()} disabled={busy || (single && !draft.trim())} data-testid={`${testid}-save`}>{busy ? t('Saving…') : t('Save')}</button>
        </span>
      )}
    </div>
  );
}

/**
 * The action's own history (backend 1.7.0): the task status, edit and note rows stay in each task's history; tasks added at
 * the same moment are one row ("Tasks 1–4 added").
 */
function actionHistory(logs: readonly ActionLog[]): ActionLog[] {
  const out: ActionLog[] = [];
  for (const l of logs) {
    if (l.kind === 'task_status' || l.kind === 'task_edit' || l.kind === 'task_note') continue;
    const prev = out[out.length - 1];
    if (l.kind === 'task_create' && prev?.kind === 'task_create' && prev.at === l.at && prev.by === l.by) {
      out[out.length - 1] = { ...prev, text: `${prev.text}\n${l.text}` };
      continue;
    }
    out.push(l);
  }
  return out;
}

function logText(l: ActionLog, people: Parameters<typeof personName>[0]): { head: string; body: string } {
  const who = personName(people, l.by);
  if (l.kind === 'task_create') {
    const items = l.text.split('\n');
    const nums = items.map((x) => /^#(\d+)/.exec(x)?.[1]).filter(Boolean) as string[];
    if (items.length === 1) {
      const m = /^#(\d+) (.*?)(?: \((.*)\))?$/.exec(l.text);
      return { head: m ? t('Task {n} added', { n: m[1]! }) : t('Task added'), body: m ? `${m[2]} · ${who}` : who };
    }
    return { head: t('Tasks {a}–{b} added', { a: nums[0] ?? '', b: nums[nums.length - 1] ?? '' }), body: who };
  }
  if (l.kind === 'status') {
    if (!l.from_status) return { head: t('{s} created', { s: t(l.to_status || 'Action') }), body: l.text ? `${l.text} · ${who}` : who };
    return { head: `${t(l.from_status)} → ${t(l.to_status)}`, body: l.text ? `${who} · ${l.text}` : who };
  }
  if (l.kind === 'evidence') return { head: t('Evidence'), body: `${l.text} · ${who}` };
  if (l.kind === 'edit') return { head: t('Changed'), body: `${l.text} · ${who}` };
  return { head: t('Comment'), body: `${l.text} · ${who}` };
}

export default function ActionDetail({ id, onClose, taskId }: { id: string; onClose: () => void; taskId?: string | null }) {
  const acts = useActions();
  const mobile = useIsMobile();
  const { startup } = useStartup();
  const v = useValidationOptional();
  const today = todayLocal();
  const payload = acts.payload;
  const a = payload?.actions.find((x) => x.action_id === id) ?? null;
  const people = payload?.people ?? [];
  const contractors = payload?.contractors ?? [];
  const canClose = !!payload?.can_close;
  const logs = useMemo(() => (payload?.logs ?? []).filter((l) => l.action_id === id), [payload, id]);
  const allTasks = useMemo(() => payload?.tasks ?? [], [payload]);
  const tasks = useMemo(() => tasksOfAction(id, allTasks), [id, allTasks]);
  const tally = taskTally(id, tasks);
  const [closing, setClosing] = useState('');
  const [closeShown, setCloseShown] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const effectDays = Number(startup?.settings.find((s) => s.key === 'actions_effect_days')?.value) || 60;
  const terminal = a ? isTerminalStatus(a.status) : false;
  const editable = acts.canEdit && (!terminal || canClose);
  const disabled = !editable || !!acts.blockedReason;
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [statusFor, setStatusFor] = useState<ActionStatus | null | undefined>(undefined);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [showAllEv, setShowAllEv] = useState(false);
  const [copied, setCopied] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Escape closes (unless a dialog over it handles it); focus moves in and back out
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    boxRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.sm-shade, .bottom-sheet, .pm-panel')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  const rowsById = useMemo(() => {
    const m = new Map<string, EventRow>();
    if (!a || !v?.rows) return m;
    const want = new Set(evidenceIds(a));
    for (const r of v.rows) if (want.has(r.event_id)) m.set(r.event_id, r);
    return m;
  }, [a, v?.rows]);

  const save = async (changes: ActionChanges, text = t('Saved.')): Promise<boolean> => {
    if (!a) return false;
    setMsg(null);
    const res = await acts.update(a.action_id, changes);
    setMsg(res.ok ? { ok: true, text } : { ok: false, text: res.error });
    return res.ok;
  };
  const post = async () => {
    if (!a || !comment.trim()) return;
    setPosting(true);
    const res = await acts.comment(a.action_id, comment.trim());
    setPosting(false);
    if (res.ok) {
      setComment('');
      setMsg({ ok: true, text: t('Comment posted.') });
    } else setMsg({ ok: false, text: res.error });
  };
  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}#/actions?id=${encodeURIComponent(id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
    }
  };

  let content: ReactNode;
  if (!a) {
    content = (
      <div className="ad-missing" data-testid="action-missing">
        <p>{acts.loading || !payload ? t('Loading…') : t('Action {id} was not found. It may belong to another database or the link is wrong.', { id })}</p>
        <button type="button" className="btn" onClick={onClose}>{t('Back to Actions')}</button>
      </div>
    );
  } else {
    const head = cardHead(a);
    const step = BOARD_STATUSES.indexOf(a.status);
    const next = nextStatus(a, canClose, tally);
    const withTasks = tally.total > 0;
    const prog = actionProgress(a, tasks, today);
    const ready = withTasks && a.status !== 'Draft' && !terminal && tally.open === 0;
    const lastDone = ready ? tasks.filter((x) => x.done_at).sort((x, y) => (x.done_at < y.done_at ? 1 : -1))[0] : undefined;
    const statusLogs = logs.filter((l) => l.kind === 'status');
    const reachedAt = (s: ActionStatus) => statusLogs.find((l) => l.to_status === s)?.at;
    const ids = evidenceIds(a);
    const evRows = ids.map((x) => ({ id: x, row: rowsById.get(x), item: a.evidence.find((e) => e.event_id === x)! }));
    const evHours = evRows.reduce((s, e) => s + (e.row ? hoursOf(e.row) : 0), 0);
    const fresh = newEvidence(a);
    const due = dueInfo(a, today);
    const eqDesc = a.equipment_id ? startup?.equipment.find((e) => e.equipment_id === a.equipment_id)?.description : '';
    const auto = defaultOwnerFor(contractors, a.area_id);
    const comments = logs.filter((l) => l.kind === 'comment').slice().reverse();
    const history = actionHistory(logs.filter((l) => l.kind !== 'comment')).reverse();
    const drill = ids.length && startup ? { drill: { label: t('Evidence of {id}', { id: a.action_id }), eventIds: ids, rowIds: ids, years: startup.years, source: t('Action') } } : undefined;
    const shownEv = showAllEv ? evRows : evRows.slice(-8);

    content = (
      <>
        <header className="ad-head">
          {mobile ? (
            <div className="ad-phonebar">
              <button type="button" className="ad-icon-btn" onClick={onClose} aria-label={t('Back to Actions')} data-testid="action-close"><Icon name="arrowLeft" size={20} /></button>
              <span className="ad-phone-id mono" data-testid="action-id">{a.action_id}</span>
              <button type="button" className="ad-icon-btn" onClick={() => void copyLink()} aria-label={t('Copy link')} data-testid="action-copy"><Icon name="link" size={18} /></button>
            </div>
          ) : (
            <div className="ad-chips">
              <span className="ad-id mono" data-testid="action-id">{a.action_id}</span>
              <StatusChip status={a.status} />
              <PriorityTag priority={a.priority} />
              <SourceTag action={a} />
              <span className="act-tag">{t('Scope: {s}', { s: t(a.scope_kind === 'equipment' ? 'Equipment' : a.scope_kind === 'area' ? 'Area' : a.scope_kind === 'line' ? 'Line' : 'Plant') })}</span>
              <AccessBadge edit={acts.canEdit} />
              <span className="ad-head-btns">
                <button type="button" className="btn btn-sm" onClick={() => void copyLink()} data-testid="action-copy"><Icon name="link" size={15} /> {copied ? t('Copied') : t('Copy link')}</button>
                <button type="button" className="ad-icon-btn" onClick={onClose} aria-label={t('Close')} data-testid="action-close"><Icon name="close" size={18} /></button>
              </span>
            </div>
          )}
          {mobile && (
            <div className="ad-chips ad-chips--phone">
              <StatusChip status={a.status} />
              <PriorityTag priority={a.priority} />
              <span className="ad-opened">{t('opened {d}', { d: dayText(a.created_at) })}</span>
              <AccessBadge edit={acts.canEdit} />
            </div>
          )}
          <h2 className="ad-title" id={`ad-title-${a.action_id}`} data-testid="action-title">{head.code && <>{head.code} · </>}{head.text}</h2>
          {a.area_id && startup?.areas.some((x) => x.area_id === a.area_id && x.active === false) && (
            <p className="callout" role="note" data-testid="action-detail-area-inactive">
              <Icon name="info" size={15} /> {t('Area {a} is switched off (Settings > Areas): its records are left out of every number and no new drafts are made for it. This action stays as it is.', { a: a.area_id })}
            </p>
          )}
          <p className="ad-sub">
            {[eqDesc, a.area_id, a.line_id && t('Line {l}', { l: a.line_id })].filter(Boolean).join(' · ')}
            {' · '}{t('created {d} by {w}', { d: dateText(a.created_at), w: personName(people, a.created_by) })} · {t(SOURCE_LABEL[a.source])}
          </p>
          {a.status === 'Cancelled' ? (
            <p className="ad-cancelled" data-testid="action-cancelled"><Icon name="ban" size={15} /> {t('Cancelled {d} by {w}', { d: dateText(a.closed_at), w: personName(people, a.closed_by) })}</p>
          ) : (
            <ol className="ad-steps" aria-label={t('Progress')} data-testid="action-steps">
              {BOARD_STATUSES.map((s, i) => {
                const state = i < step ? 'done' : i === step ? 'now' : 'todo';
                const at = reachedAt(s);
                const extra = !withTasks ? '' : s === 'Open' && state !== 'todo' ? t('accepted') : s === 'In progress' && state === 'now' ? (ready ? t('all tasks done') : t('a task started'))
                  : s === 'Closed' && state === 'todo' ? (ready ? t('ready — needs a closer') : t('when all tasks are done')) : '';
                return (
                  <li key={s} className={`ad-step ad-step--${state} ad-step--${statusKey(s)}`} aria-current={state === 'now' ? 'step' : undefined}>
                    <span className="ad-step-mark" aria-hidden="true">{state === 'done' ? <Icon name="check" size={14} /> : i + 1}</span>
                    <span className="ad-step-text"><b>{t(s)}</b>{((at && state !== 'todo') || extra) && <small>{[at && state !== 'todo' ? (state === 'now' ? t('since {d}', { d: dayText(at) }) : dayText(at)) : '', extra].filter(Boolean).join(' · ')}</small>}</span>
                  </li>
                );
              })}
              {!mobile && <li className="ad-step-or" aria-hidden="true">{t('or Cancelled')}</li>}
            </ol>
          )}
          {mobile && a.status !== 'Cancelled' && (
            <p className="ad-step-line">{t(a.status)}{withTasks && !terminal && a.status !== 'Draft' ? ` · ${t('closes when all tasks are done')}` : next ? ` · ${t('next: {s}', { s: t(next) })}` : ''} <span>{t('{n} of {m}', { n: step + 1, m: BOARD_STATUSES.length })}</span></p>
          )}
          {acts.canEdit && withTasks && (
            <div className="ad-actions" data-testid="action-task-buttons">
              {a.status === 'Draft' && (
                <button type="button" className="btn-primary" disabled={!!acts.blockedReason} onClick={() => void save({ status: 'Open' }, t('Accepted: the action is open and follows its tasks.'))} data-testid="action-next">
                  <Icon name="check" size={16} /> {t('Accept · move to Open')}
                </button>
              )}
              {!terminal && a.status !== 'Draft' && (!mobile || (ready && canClose)) && (
                <button type="button" className={ready && canClose ? 'btn-primary' : 'btn ad-locked'} disabled={!ready || !canClose || !!acts.blockedReason}
                  onClick={() => setStatusFor('Closed')} data-testid="action-close-btn" title={!canClose ? t('Only people on the Who can close actions list can close.') : undefined}>
                  <Icon name={ready && canClose ? 'check' : 'shield'} size={15} /> {t('Close action')}
                </button>
              )}
              {!mobile && !terminal && a.status !== 'Draft' && tally.open > 0 && <span className="ad-open-left" data-testid="action-open-left">{tally.open === 1 ? t('1 task still open') : t('{n} tasks still open', { n: tally.open })}</span>}
              {!terminal && canClose && !mobile && <button type="button" className="btn" disabled={!!acts.blockedReason} onClick={() => setStatusFor('Cancelled')} data-testid="action-cancel">{t('Cancel action')}</button>}
              {terminal && canClose && (
                <button type="button" className="btn" disabled={!!acts.blockedReason} onClick={() => setStatusFor('Open')} data-testid="action-change-status"><Icon name="history" size={15} /> {t('Reopen')}</button>
              )}
              {!mobile && <span className="ad-actions-note"><Icon name="info" size={14} />{ready
                ? (canClose ? t('Close is available only to the people in Settings › Actions & targets › Who can close. You are on the list.') : t('Close is available only to the people in Settings › Actions & targets › Who can close.'))
                : t('The status follows the tasks: In progress as soon as any task starts. Talking to the contractor happens outside the app — log it on the task.')}</span>}
            </div>
          )}
          {acts.canEdit && !withTasks && (
            <div className="ad-actions">
              {!mobile && !terminal && next && (
                <button type="button" className="btn-primary" disabled={!!acts.blockedReason} onClick={() => (isTerminalStatus(next) ? setStatusFor(next) : void save({ status: next }, t('Moved to {s}.', { s: t(next) })))} data-testid="action-next">
                  <Icon name="chevronRight" size={16} /> {t('Move to {s}', { s: t(next) })}
                </button>
              )}
              {(!terminal || canClose) && (
                <button type="button" className={mobile ? 'btn-primary' : 'btn'} disabled={!!acts.blockedReason} onClick={() => setStatusFor(terminal ? 'Open' : null)} data-testid="action-change-status">
                  {terminal ? <><Icon name="history" size={15} /> {t('Reopen')}</> : mobile ? <><Icon name="chevronRight" size={16} /> {t('Change status')}</> : <>{t('Change status')} <Icon name="chevronDown" size={14} /></>}
                </button>
              )}
              {!mobile && !terminal && canClose && (
                <button type="button" className="btn" disabled={!!acts.blockedReason} onClick={() => setStatusFor('Cancelled')} data-testid="action-cancel">{t('Cancel action')}</button>
              )}
              <span className="ad-actions-note"><Icon name="info" size={14} />{t('This action has no tasks: its status is set by hand. Add tasks to split the work; then the status follows them.')}</span>
            </div>
          )}
          {acts.blockedReason && acts.canEdit && <p className="ad-offline" role="status" data-testid="action-offline"><Icon name="wifiOff" size={14} /> {acts.blockedReason}</p>}
          <p className="sr-only" role="status" aria-live="polite" data-testid="action-msg-live">{msg?.text ?? ''}</p>
          {msg && !msg.ok && <div className="callout callout--danger ad-msg" role="alert" data-testid="action-error"><Icon name="alert" size={16} /><span>{msg.text}</span></div>}
          {msg && msg.ok && <p className="ad-saved" data-testid="action-saved"><Icon name="check" size={14} /> {msg.text}</p>}
        </header>

        <div className={withTasks ? 'ad-body ad-body--tasks' : 'ad-body'}>
          <div className="ad-main">
            {fresh > 0 && !terminal && (
              <div className="ad-fresh" data-testid="action-fresh">
                <Icon name="trend" size={16} />
                <span><b>{fresh === 1 ? t('+1 new failure since opened') : t('+{n} new failures since opened', { n: fresh })}</b>{' · '}{t('added to this action as evidence instead of creating a duplicate.')}</span>
              </div>
            )}
            {ready && (
              <div className="ad-ready" data-testid="ready-banner">
                <p className="ad-ready-head"><Icon name="check" size={18} /> <b>{prog.total === 1 ? t('The task is done — ready to close') : t('All {n} tasks done — ready to close', { n: prog.total })}</b></p>
                <p className="ad-ready-sub">
                  {t('{d} done · {n} not needed.', { d: prog.total - prog.notNeeded, n: prog.notNeeded })}
                  {lastDone ? ` ${t('Last task finished {d} by {w}.', { d: tsText(lastDone.done_at), w: personName(people, lastDone.done_by) })}` : ''}
                  {' '}{t('A notification went to the people who can close.')}
                </p>
                {canClose && acts.canEdit ? (
                  <div className="ad-ready-form">
                    <div className={closeShown && closing.trim().length < NOTE_MIN ? 'field field--error' : 'field'}>
                      <label htmlFor={`ready-note-${a.action_id}`}>{t('Closing note')} <span className="req">*</span></label>
                      <textarea id={`ready-note-${a.action_id}`} className="textarea" rows={3} value={closing} onChange={(e) => setClosing(e.target.value)} maxLength={2000} data-testid="ready-note"
                        placeholder={t('What was done and why the problem should not come back.')} />
                      {closeShown && closing.trim().length < NOTE_MIN && <span className="field-error" role="alert" data-testid="ready-note-error">{t('Write a closing note (at least 3 characters).')}</span>}
                      <span className="field-hint">{t('Required. Shown in the history and in the monthly report.')}</span>
                    </div>
                    <div className="ad-ready-side">
                      <button type="button" className="btn-primary" disabled={closeBusy || !!acts.blockedReason} data-testid="ready-close"
                        onClick={async () => {
                          setCloseShown(true);
                          if (closing.trim().length < NOTE_MIN) return;
                          setCloseBusy(true);
                          const ok = await save({ status: 'Closed', closure_note: closing.trim() }, t('Closed. The effectiveness check has started.'));
                          setCloseBusy(false);
                          if (ok) setClosing('');
                        }}>
                        <Icon name="check" size={16} /> {closeBusy ? t('Closing…') : t('Close action')}
                      </button>
                      {a.scope_kind === 'equipment' && <p className="ad-hint"><Icon name="clock" size={13} /> {t('On close the {n}-day effectiveness check starts: a new failure of {e} marks the action Not effective.', { n: effectDays, e: a.equipment_id })}</p>}
                      <p className="ad-hint"><Icon name="shield" size={13} /> {t('Close is available only to the people in Settings › Who can close.')}</p>
                    </div>
                  </div>
                ) : (
                  <p className="ad-ready-who" data-testid="ready-closer-note"><Icon name="shield" size={14} /> {t('Only people in Settings › Who can close can close it. They have been told.')}</p>
                )}
              </div>
            )}
            {(withTasks || a.status !== 'Cancelled') && <TasksSection action={a} tasks={tasks} logs={logs} today={today} focusTask={taskId} />}
            {terminal && a.closure_note && (
              <div className={a.status === 'Closed' ? 'callout callout--success' : 'callout'} data-testid="action-closure">
                <Icon name={a.status === 'Closed' ? 'check' : 'ban'} size={16} />
                <span><b>{a.status === 'Closed' ? t('Closing note') : t('Why it was cancelled')}</b> · {personName(people, a.closed_by)}, {tsText(a.closed_at)}<br />{a.closure_note}</span>
              </div>
            )}

            <Section title={t('Problem statement')} right={<span className="muted">{a.source.startsWith('auto_') ? t('auto-written · editable') : t('editable')}</span>} testid="action-problem">
              <SavedText single value={a.title} label={t('Title')} testid="action-edit-title" max={200} disabled={disabled} onSave={(val) => save({ title: val })} />
              <SavedText value={a.detail} label={t('Problem statement')} testid="action-edit-detail" disabled={disabled} onSave={(val) => save({ detail: val })} />
            </Section>

            <Section icon="graphs" title={t('Evidence')} testid="action-evidence"
              right={drill ? <Link to="/events" state={drill} className="ad-link" data-testid="action-evidence-open">{t('Open {n} records', { n: ids.length })} <Icon name="chevronRight" size={14} /></Link> : undefined}>
              <p className="ad-pills">
                <span className="ad-pill"><b>{ids.length}</b> {ids.length === 1 ? t('linked record') : t('linked records')}</span>
                {evHours > 0 && <span className="ad-pill"><b>{evHours.toFixed(1)} h</b> {t('stopped')}</span>}
                {a.evidence.filter((e) => e.note && !e.event_id).length > 0 && <span className="ad-pill">{t('{n} notes', { n: a.evidence.filter((e) => e.note && !e.event_id).length })}</span>}
              </p>
              {ids.length === 0 ? <p className="muted ad-empty">{t('No records are linked yet. Records are added when the action is created from a chart, a record or a rule, and when the same cause fails again.')}</p> : (
                <div className="ad-table-wrap">
                  <table className="data-table ad-table" data-testid="evidence-table">
                    <thead><tr><th scope="col">{t('Started')}</th><th scope="col">{t('Reason · remark')}</th><th scope="col" className="num">{t('Hours')}</th><th scope="col">{t('Added')}</th></tr></thead>
                    <tbody>
                      {!showAllEv && evRows.length > shownEv.length && (
                        <tr><td colSpan={4}><button type="button" className="row-btn" onClick={() => setShowAllEv(true)} data-testid="evidence-more">{t('Show {n} earlier records', { n: evRows.length - shownEv.length })}</button></td></tr>
                      )}
                      {shownEv.map((e) => {
                        const isNew = e.item.added_at.slice(0, 19) > a.created_at.slice(0, 19);
                        return (
                          <tr key={e.id} data-testid="evidence-row">
                            <td className="nowrap">{e.row ? tsText(e.row.stop_ts).replace(/ \d{4}/, '') : <span className="mono">{e.id}</span>}</td>
                            <td>{e.row ? <>{e.row.reason_raw || t('(no reason)')}{e.row.description ? <span className="muted"> · {e.row.description}</span> : null}<span className="muted"> · {e.row.area_id} {e.row.code_raw}</span></> : <span className="muted">{t('Record not loaded on this device')}</span>}</td>
                            <td className="num">{e.row ? hoursOf(e.row).toFixed(1) : '–'}</td>
                            <td>{isNew ? <span className="act-tag act-tag--new"><Icon name="trend" size={12} />{t('New')}</span> : <span className="act-tag">{t('At opening')}</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title={t('Root cause')} testid="action-root">
              <div className="act-chips" role="group" aria-label={t('Root-cause category')}>
                {[...ACTION_ROOT_CAUSES.filter((r) => r), ''].map((r) => (
                  <button key={r || 'none'} type="button" className={a.root_cause === r ? 'act-choice act-choice--on' : 'act-choice'} aria-pressed={a.root_cause === r} disabled={disabled}
                    onClick={() => a.root_cause !== r && void save({ root_cause: r as ActionRootCause })} data-testid={`action-root-${r || 'none'}`}>
                    {a.root_cause === r && <Icon name="check" size={14} />}{r && <b>{r}</b>} {t(ROOT_CAUSE_LABEL[r]!)}
                  </button>
                ))}
              </div>
              <h4 className="ad-h4">{t('Required action')}</h4>
              <SavedText value={a.required_action} label={t('Required action')} testid="action-edit-required" disabled={disabled} onSave={(val) => save({ required_action: val })} />
            </Section>

            <Section icon="mail" title={t('Comments')} right={<span className="muted" data-testid="comment-count">{comments.length}</span>} testid="action-comments">
              {comments.length === 0 && <p className="muted ad-empty">{t('No comments yet.')}</p>}
              <ul className="ad-comments">
                {comments.map((c) => {
                  const who = personName(people, c.by);
                  return (
                    <li key={c.log_id} data-testid="comment">
                      <Avatar name={who} />
                      <span><b>{who}</b> <small className="muted">{tsText(c.at)}</small><br />{c.text}</span>
                    </li>
                  );
                })}
              </ul>
              {acts.canEdit && (
                <div className="ad-compose">
                  <textarea className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('Write a comment…')} aria-label={t('Comment')} maxLength={2000} disabled={!!acts.blockedReason} data-testid="comment-input" />
                  <button type="button" className="btn-primary act-blue" onClick={() => void post()} disabled={posting || !comment.trim() || !!acts.blockedReason} data-testid="comment-post"><Icon name="send" size={15} /> {posting ? t('Posting…') : t('Post')}</button>
                </div>
              )}
            </Section>
          </div>

          <aside className="ad-side">
            <Section title={t('Assignment')} testid="action-assignment">
              <div className="ad-form">
                <label className="ad-row">
                  <span>{t('Owner')}</span>
                  <select className="select" value={a.assignee} disabled={disabled} onChange={(e) => void save({ assignee: e.target.value })} data-testid="action-assignee">
                    <option value="">{t('Nobody yet')}</option>
                    {a.assignee && !people.some((p) => p.user_id === a.assignee) && <option value={a.assignee}>{a.assignee}</option>}
                    {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}
                  </select>
                </label>
                <label className="ad-row">
                  <span>{t('Contractor')}</span>
                  <select className="select" value={a.owner} disabled={disabled} onChange={(e) => void save({ owner: e.target.value })} data-testid="action-owner">
                    <option value="">{t('Nobody yet')}</option>
                    {contractors.filter((c) => c.active || c.contractor_id === a.owner).map((c) => <option key={c.contractor_id} value={c.contractor_id}>{c.name}{c.kind === 'internal' ? ` · ${t('internal')}` : ''}</option>)}
                  </select>
                </label>
                {auto.auto && a.area_id && <p className="ad-hint">{t('From the area: {a} → {c}', { a: a.area_id, c: contractorName(contractors, auto.owner) })}{withTasks ? ` · ${t('default for new tasks')}` : ''}</p>}
                {withTasks ? (
                  <div className="ad-row"><span>{t('Due')}</span><b className="ad-val" data-testid="action-due-derived">{tally.open === 0 ? t('All tasks done') : dueOf(a) ? dateText(dueOf(a)) : t('No task has a due date')}</b></div>
                ) : (
                  <label className="ad-row">
                    <span>{t('Due date')}</span>
                    <input type="date" className="input" value={a.due_date} disabled={disabled} onChange={(e) => void save({ due_date: e.target.value })} data-testid="action-due-input" />
                  </label>
                )}
                <p className={`ad-hint act-due--${due.tone}`} data-testid="action-due-text">{withTasks
                  ? (tally.open === 0 ? t('last task done {d}', { d: lastDone ? dayText(lastDone.done_at) : '–' }) : <>{due.tone === 'overdue' && <><Icon name="alert" size={13} /> {due.text} · </>}{t('follows the latest task due date')}</>)
                  : due.tone === 'overdue' ? <><Icon name="alert" size={13} /> {due.text}</> : due.tone === 'none' ? t('No due date') : due.days > 0 && !terminal ? t('{n} days left', { n: due.days }) : due.text}</p>
                <label className="ad-row">
                  <span>{t('Priority')}</span>
                  <select className="select" value={a.priority} disabled={disabled} onChange={(e) => void save({ priority: e.target.value as ActionPriority })} data-testid="action-priority-select">
                    {ACTION_PRIORITIES.map((p) => <option key={p} value={p}>{t(p)}</option>)}
                  </select>
                </label>
                {withTasks ? (
                  <div className="ad-row"><span>{t('Stoppage')}</span><b className="ad-val" data-testid="action-stop-tasks">{prog.needsStop ? `${prog.needsStop === 1 ? t('1 open task needs a stop') : t('{n} open tasks need a stop', { n: prog.needsStop })}${prog.stopHours ? ` · ${prog.stopHours.toFixed(1)} h` : ''}` : t('No open task needs a stop')}</b></div>
                ) : <div className="ad-row">
                  <span>{t('Stoppage')}</span>
                  <label className="act-switch">
                    <input type="checkbox" checked={a.needs_stop} disabled={disabled} onChange={(e) => void save({ needs_stop: e.target.checked })} data-testid="action-needs-stop" />
                    <span className="act-switch-ui" aria-hidden="true" />
                    <span>{a.needs_stop ? t('Needed') : t('Not needed')}</span>
                  </label>
                </div>}
                <div className="ad-row"><span>{t('Scope')}</span><b className="ad-val">{scopeText(a)}{a.equipment_id ? ` · ${a.equipment_id}` : ''}</b></div>
                {a.reason_key && <div className="ad-row"><span>{t('Reason')}</span><b className="ad-val">{a.reason_key}</b></div>}
              </div>
            </Section>

            <Section icon="trend" title={t('Effectiveness check')} testid="action-effect-card">
              {a.status !== 'Closed' ? (
                <p className="ad-effect-wait"><Icon name="clock" size={14} /> <span><b>{t('Will start when closed')}</b><br />{a.scope_kind === 'equipment'
                  ? t('After closing, {e} is watched for {n} days. A new failure of the same kind marks the action Not effective.', { e: a.equipment_id, n: effectDays })
                  : t('Only equipment actions are checked; this one is about {s}.', { s: scopeText(a) })}</span></p>
              ) : a.effectiveness ? (
                <div className="ad-effect">
                  <EffectBadge action={a} today={today} effectDays={effectDays} />
                  <p className="ad-hint">{a.effectiveness === 'Watching'
                    ? t('Failures of the {n} days after closing are compared with the {n} days before. {d} days left.', { n: effectDays, d: watchDaysLeft(a, today, effectDays) ?? 0 })
                    : t('Judged {d}.', { d: dateText(a.effectiveness_checked_at) })}</p>
                </div>
              ) : <p className="ad-hint">{t('Not checked: only equipment actions are watched after closing.')}</p>}
            </Section>

            <Section icon="history" title={t('History')} testid="action-history">
              <ol className="ad-history">
                {history.map((l) => {
                  const x = logText(l, people);
                  return (
                    <li key={l.log_id} className={`ad-hist ad-hist--${l.kind}`} data-testid="history-row" data-kind={l.kind}>
                      <span className={`ad-hist-dot act-dot--${statusKey(l.to_status || l.kind)}`} aria-hidden="true" />
                      <span><b>{x.head}</b> <span className="muted">{x.body}</span><br /><small className="muted">{tsText(l.at)}</small></span>
                    </li>
                  );
                })}
              </ol>
            </Section>
            <p className="ad-closers" data-testid="action-closers-note">
              <Icon name="shield" size={14} />
              <span>{t('Only people on the Who can close actions list (Settings › Actions & targets) can move this to Closed.')} {canClose ? t('You are on the list.') : t('You are not on the list.')}</span>
            </p>
          </aside>
        </div>
      </>
    );
  }

  const box = (
    <div className={mobile ? 'ad-shade ad-shade--phone' : 'ad-shade'} onClick={mobile ? undefined : onClose}>
      <div
        ref={boxRef} className={mobile ? 'ad-box ad-box--phone' : 'ad-box'} role="dialog" aria-modal="true" aria-label={a ? `${a.action_id} · ${a.title}` : id}
        tabIndex={-1} onClick={(e) => e.stopPropagation()} data-testid="action-detail" data-id={id} data-status={a?.status}
      >
        {content}
      </div>
    </div>
  );
  const dialog = a && statusFor !== undefined && (
    <StatusDialog action={a} canClose={canClose} initial={statusFor} tally={tally} onClose={() => setStatusFor(undefined)}
          since={[...logs].reverse().find((l) => l.kind === 'status' && l.to_status === a.status)?.at}
          onDone={(text) => { setStatusFor(undefined); setMsg({ ok: true, text }); }} />
  );
  return createPortal(<>{box}{dialog}</>, document.body);
}

export type { Action };
