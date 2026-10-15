// Settings › Actions & targets › (c) Task templates (docs/actions-mockups/tasks/10-settings-task-templates.png): the ready-made
// task lists a new action is filled with. The templates on the left, the chosen one on the right: its name, the draft rules
// that suggest it first, whether it is offered, and its tasks (title, default owner — "Area contractor" or a fixed contractor
// or team —, due after N days, needs a stop, estimated hours). Saved with saveTaskTemplates; changes apply to new actions only.
// Edit on Settings changes them; View shows them read-only. Templates are never deleted: switch one off.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { AREA_CONTRACTOR, type ActionSource, type TaskTemplate, type TaskTemplateInput } from '../../api/types';
import { useActionsOptional } from '../../actions/ActionsContext';
import { contractorName, personName, SOURCE_LABEL } from '../../actions/model';
import { templateInput, templateProblem } from '../../actions/tasks';
import RowMenu from '../../components/RowMenu';
import { MenuItem } from '../../components/PopMenu';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { dateText } from '../../util/dates';
import { useAction } from '../useAction';

const AUTO_SOURCES: ActionSource[] = ['auto_repeat', 'auto_chronic', 'auto_long_stop', 'auto_planned_overrun'];
type Step = TaskTemplateInput['steps'][number];

export default function TaskTemplates({ edit, onSaved }: { edit: boolean; onSaved: (text: string) => void }) {
  const acts = useActionsOptional();
  const { run, busy, error, setError } = useAction();
  const [fetched, setFetched] = useState<TaskTemplate[] | null>(null);
  // a person who cannot open Actions still sees the templates here (listTaskTemplates)
  useEffect(() => {
    if (acts?.payload?.templates) return;
    let live = true;
    void run((tok) => api.listTaskTemplates(tok)).then((r) => { if (live && r.ok) setFetched(r.value); });
    return () => { live = false; };
  }, [acts?.payload?.templates, run]);
  const stored = useMemo(() => [...(acts?.payload?.templates ?? fetched ?? [])].sort((a, b) => a.sort_order - b.sort_order), [acts?.payload?.templates, fetched]);
  const contractors = acts?.payload?.contractors ?? [];
  const people = acts?.payload?.people ?? [];
  const used = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of acts?.payload?.actions ?? []) if (a.template_id) m.set(a.template_id, (m.get(a.template_id) ?? 0) + 1);
    return m;
  }, [acts?.payload]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [draft, setDraft] = useState<TaskTemplateInput | null>(null);
  const [shown, setShown] = useState(false);
  const current = stored.find((x) => x.template_id === chosen) ?? (chosen === 'new' ? null : stored[0] ?? null);
  const base: TaskTemplateInput | null = chosen === 'new' ? null : current ? templateInput(current) : null;
  const d = draft ?? base;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(base);
  const problem = d ? templateProblem(d, stored) : null;

  const choose = (id: string) => {
    setChosen(id);
    setDraft(null);
    setShown(false);
    setError(null);
  };
  const patch = (p: Partial<TaskTemplateInput>) => d && setDraft({ ...d, ...p });
  const patchStep = (i: number, p: Partial<Step>) => d && setDraft({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const move = (i: number, by: number) => {
    if (!d) return;
    const steps = [...d.steps];
    const [x] = steps.splice(i, 1);
    steps.splice(i + by, 0, x!);
    setDraft({ ...d, steps });
  };
  const newTemplate = () => {
    setChosen('new');
    setShown(false);
    setDraft({ name: '', applies_to: [], active: true, sort_order: (Math.max(0, ...stored.map((x) => x.sort_order)) || 0) + 1,
      steps: [{ title: '', default_owner: AREA_CONTRACTOR, due_offset_days: 7, needs_stop: false, est_stop_h: null }] });
  };
  async function save() {
    setShown(true);
    if (!d || problem) return;
    const input: TaskTemplateInput = { ...d, name: d.name.trim(), steps: d.steps.map((s) => ({ ...s, title: s.title.trim(), est_stop_h: s.needs_stop ? s.est_stop_h : null })) };
    const res = await run((tok) => api.saveTaskTemplates(tok, [input]));
    if (!res.ok) return;
    if (acts) acts.storeTemplates(res.value); else setFetched(res.value);
    const saved = res.value.find((x) => x.name.toLowerCase() === input.name.toLowerCase());
    setDraft(null);
    setShown(false);
    if (saved) setChosen(saved.template_id);
    onSaved(t('Template {n} saved. New actions get it; existing actions keep their tasks.', { n: input.name }));
  }

  const ownerOptions = [{ value: AREA_CONTRACTOR, label: t('Area contractor') }, ...contractors.filter((c) => c.active).map((c) => ({ value: c.contractor_id, label: `${c.name}${c.kind === 'internal' ? ` · ${t('team')}` : ''}` }))];
  const areaMap = contractors.filter((c) => c.active && c.kind === 'contractor' && c.areas.length).map((c) => `${c.areas.join(', ')} → ${c.name}`).join('; ');

  return (
    <section className="card at-sec" aria-labelledby="at-tpl" data-testid="task-templates">
      <header className="at-sec-head"><span className="at-letter" aria-hidden="true">c</span><div><h2 id="at-tpl">{t('Task templates')}</h2>
        <p className="adm-note">{t('Ready-made task lists. Picked when an action is created (pre-filled, editable there) and given to the automatic drafts. Changes apply to new actions only.')}</p></div>
        {edit && <button type="button" className="btn btn-sm at-head-btn" onClick={newTemplate} data-testid="tt-new"><Icon name="plus" size={14} /> {t('New template')}</button>}
      </header>
      {stored.length === 0 && !d && <p className="muted">{acts?.error ?? t('Loading…')}</p>}
      <div className="tt-grid">
        <ul className="tt-list" aria-label={t('Templates')}>
          {stored.map((x) => {
            const on = (chosen === null ? stored[0]?.template_id : chosen) === x.template_id;
            return (
              <li key={x.template_id}>
                <button type="button" className={on ? 'tt-card tt-card--on' : 'tt-card'} aria-pressed={on} onClick={() => choose(x.template_id)} data-testid="tt-card" data-id={x.template_id}>
                  <b>{x.name}{!x.active && <span className="act-tag"> {t('off')}</span>}</b>
                  <ol>{[...x.steps].sort((a, b) => a.seq - b.seq).map((s) => <li key={s.seq}>{s.title}</li>)}</ol>
                  <small className="muted">{x.applies_to.length ? t('suggested for {s}', { s: x.applies_to.map((a) => t(SOURCE_LABEL[a]).replace(/^Auto · /, '')).join(', ') }) : t('not suggested by a rule')} · {t('used {n} times', { n: used.get(x.template_id) ?? 0 })}</small>
                </button>
              </li>
            );
          })}
          {chosen === 'new' && <li><span className="tt-card tt-card--on">{t('New template')}</span></li>}
        </ul>
        {d && (
          <div className="tt-edit" data-testid="tt-editor">
            <div className="tt-row">
              <div className={shown && !d.name.trim() ? 'field field--error' : 'field'}>
                <label htmlFor="tt-name">{t('Template name')}</label>
                <input id="tt-name" className="input" value={d.name} readOnly={!edit} onChange={(e) => patch({ name: e.target.value })} maxLength={60} data-testid="tt-name" />
              </div>
              <div className="field">
                <span className="field-label" id="tt-src">{t('Suggested first for')}</span>
                <div className="tt-srcs" role="group" aria-labelledby="tt-src">
                  {AUTO_SOURCES.map((s) => {
                    const on = d.applies_to.includes(s);
                    return <button key={s} type="button" className={on ? 'chip chip--on' : 'chip'} aria-pressed={on} disabled={!edit} data-testid={`tt-src-${s}`}
                      onClick={() => patch({ applies_to: on ? d.applies_to.filter((x) => x !== s) : [...d.applies_to, s] })}><Icon name="sync" size={13} />{t(SOURCE_LABEL[s])}</button>;
                  })}
                </div>
              </div>
              <label className="act-switch tt-active">
                <input type="checkbox" checked={d.active} disabled={!edit} onChange={(e) => patch({ active: e.target.checked })} data-testid="tt-active" />
                <span className="act-switch-ui" aria-hidden="true" /><span>{d.active ? t('Offered') : t('Switched off')}</span>
              </label>
            </div>
            <div className="table-wrap">
              <table className="data-table tt-table" data-testid="tt-steps">
                <thead><tr><th scope="col" className="num">#</th><th scope="col">{t('Task')}</th><th scope="col">{t('Default owner')}</th><th scope="col">{t('Due after')}</th><th scope="col">{t('Needs stop')}</th><th scope="col">{t('Est. h')}</th>{edit && <th scope="col"><span className="sr-only">{t('More')}</span></th>}</tr></thead>
                <tbody>
                  {d.steps.map((s, i) => (
                    <tr key={i} data-testid="tt-step">
                      <td className="num">{i + 1}</td>
                      <td><input className="input" value={s.title} readOnly={!edit} onChange={(e) => patchStep(i, { title: e.target.value })} aria-label={t('Title of task {n}', { n: i + 1 })} maxLength={200} data-testid="tt-step-title" /></td>
                      <td>
                        <select className="select" value={s.default_owner} disabled={!edit} onChange={(e) => patchStep(i, { default_owner: e.target.value })} aria-label={t('Default owner of task {n}', { n: i + 1 })} data-testid="tt-step-owner">
                          {!ownerOptions.some((o) => o.value === s.default_owner) && <option value={s.default_owner}>{contractorName(contractors, s.default_owner)}</option>}
                          {ownerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td><span className="tt-days">+<input className="input at-num" inputMode="numeric" value={String(s.due_offset_days)} readOnly={!edit}
                        onChange={(e) => patchStep(i, { due_offset_days: Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))) })} aria-label={t('Due after (days) of task {n}', { n: i + 1 })} data-testid="tt-step-offset" /> {t('days')}</span></td>
                      <td>
                        <label className="act-switch">
                          <input type="checkbox" checked={s.needs_stop} disabled={!edit} onChange={(e) => patchStep(i, { needs_stop: e.target.checked, est_stop_h: e.target.checked ? s.est_stop_h : null })} data-testid="tt-step-stop" />
                          <span className="act-switch-ui" aria-hidden="true" /><span>{s.needs_stop ? t('Yes') : t('No')}</span>
                        </label>
                      </td>
                      <td><input className="input at-num" inputMode="decimal" value={s.est_stop_h === null ? '' : String(s.est_stop_h)} readOnly={!edit || !s.needs_stop} placeholder="– h"
                        onChange={(e) => patchStep(i, { est_stop_h: e.target.value.trim() === '' ? null : Math.max(0, Number(e.target.value.replace(',', '.')) || 0) })} aria-label={t('Estimated stop hours of task {n}', { n: i + 1 })} data-testid="tt-step-hours" /></td>
                      {edit && (
                        <td>
                          <RowMenu label={t('More for task {n}', { n: i + 1 })} testid="tt-step-menu">
                            {(close) => (
                              <>
                                <MenuItem disabled={i === 0} onClick={() => { close(); move(i, -1); }} testid="tt-step-up">{t('Move up')}</MenuItem>
                                <MenuItem disabled={i === d.steps.length - 1} onClick={() => { close(); move(i, 1); }} testid="tt-step-down">{t('Move down')}</MenuItem>
                                <MenuItem disabled={d.steps.length === 1} onClick={() => { close(); setDraft({ ...d, steps: d.steps.filter((_x, j) => j !== i) }); }} testid="tt-step-remove">{t('Remove from the template')}</MenuItem>
                              </>
                            )}
                          </RowMenu>
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="tt-check"><td className="num"><Icon name="shield" size={14} /></td><td colSpan={edit ? 6 : 5}><b>{t('Check after 60 days')}</b> — <span className="muted">{t('the action\'s effectiveness check, starts when the action is closed (not a task, does not block closing). Equipment actions only.')}</span></td></tr>
                </tbody>
              </table>
            </div>
            {edit && d.steps.length < 20 && <button type="button" className="af-link tt-add" onClick={() => setDraft({ ...d, steps: [...d.steps, { title: '', default_owner: AREA_CONTRACTOR, due_offset_days: 7, needs_stop: false, est_stop_h: null }] })} data-testid="tt-add-step"><Icon name="plus" size={14} /> {t('Add task to template')}</button>}
            <p className="callout tt-info"><Icon name="info" size={16} /><span><b>{t('Area contractor')}</b> {t('becomes the contractor of the action\'s area from section b')}{areaMap ? `: ${areaMap}` : ''}. {t('An area with no contractor gives the task no owner. The person is that owner\'s default person.')}</span></p>
            {shown && problem && <div className="callout callout--warning" role="alert" data-testid="tt-problem"><Icon name="alert" size={16} /><span>{problem}</span></div>}
            {error && <div className="callout callout--danger" role="alert" data-testid="tt-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
            <div className="at-save tt-save-row">
              <span className="muted">{current && chosen !== 'new' ? t('Last changed {d} by {w} · existing actions keep their tasks', { d: dateText(current.updated_at), w: personName(people, current.updated_by) || current.updated_by || '–' }) : t('Existing actions keep their tasks.')}</span>
              {edit && (dirty || chosen === 'new') && <button type="button" className="btn" onClick={() => { setDraft(null); if (chosen === 'new') setChosen(null); setShown(false); }} disabled={busy} data-testid="tt-discard">{t('Discard')}</button>}
              {edit && <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy || (!dirty && chosen !== 'new')} data-testid="tt-save"><Icon name="check" size={15} /> {busy ? t('Saving…') : t('Save template')}</button>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
