// Settings > Actions & targets (docs/actions-mockups/desktop-settings-actions.png): who can close actions, the contractors
// and their areas, the draft-rule thresholds with "Run checks now", and the targets per area for a year (availability
// target, planned-stop allowance split into months, overhaul months) with the year-to-date use. Changing anything needs
// Edit on Settings; View shows it read-only.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { evenMonthlySplit, type AreaTarget, type AreaTargetInput, type Contractor } from '../../api/types';
import { storeYearTargets, useActionsOptional, useAreaTargets } from '../../actions/ActionsContext';
import { initials, personName } from '../../actions/model';
import { checkDraft, draftOf, fmtH, isEvenSplit, plannedYtd, splitSummary, type TargetDraft } from '../../actions/targets';
import AccessBadge from '../../components/AccessBadge';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import { MONTHS } from '../../util/dates';
import { num } from '../../util/format';
import { useValidationOptional } from '../../validate/ValidationContext';
import { useAction } from '../useAction';
import SettingsForm from '../SettingsForm';
import { useSettingsData } from './useSettingsData';
import '../../components/ui.css';
import '../admin.css';
import '../../actions/actions.css';
import './actionsTargets.css';

const csv = (v: string | undefined): string[] => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------- (a) who can close

function Closers({ edit, stored, onSaved }: { edit: boolean; stored: string[]; onSaved: (text: string) => void }) {
  const acts = useActionsOptional();
  const people = acts?.payload?.people ?? [];
  const [draft, setDraft] = useState<string[] | null>(null);
  const [pick, setPick] = useState('');
  const { run, busy, error } = useAction();
  const list = draft ?? stored;
  const dirty = !sameList(list, stored);
  const name = (id: string) => personName(people, id) || id;
  async function save() {
    const res = await run((tok) => api.saveSettings(tok, { actions_closers: list.join(',') }));
    if (res.ok) {
      setDraft(null);
      onSaved(t('Who can close actions is saved.'));
      acts?.reload();
    }
  }
  return (
    <section className="card at-sec" aria-labelledby="at-closers" data-testid="closers">
      <header className="at-sec-head"><span className="at-letter" aria-hidden="true">a</span><div><h2 id="at-closers">{t('Who can close actions')}</h2>
        <p className="adm-note">{t('Only these people can move an action to Closed (or Cancelled) and reopen it. Everyone else with Edit on Actions can work an action up to In progress. Administrators can always close.')}</p></div></header>
      <div className="at-people" data-testid="closer-list">
        {list.length === 0 && <span className="muted" data-testid="closers-none">{t('Nobody yet: only administrators can close actions.')}</span>}
        {list.map((id) => (
          <span key={id} className="at-person" data-testid="closer" data-id={id}>
            <span className="act-avatar act-avatar--sm" aria-hidden="true">{initials(name(id))}</span>
            <b>{name(id)}</b>
            {edit && <button type="button" className="at-x" onClick={() => setDraft(list.filter((x) => x !== id))} aria-label={t('Remove {n}', { n: name(id) })} data-testid="closer-remove"><Icon name="close" size={14} /></button>}
          </span>
        ))}
        {edit && (
          <span className="at-add">
            <select className="select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t('Add person')} data-testid="closer-pick">
              <option value="">{t('Add person…')}</option>
              {people.filter((p) => !list.includes(p.user_id)).map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}
            </select>
            <button type="button" className="btn" disabled={!pick} onClick={() => { setDraft([...list, pick]); setPick(''); }} data-testid="closer-add"><Icon name="plus" size={14} /> {t('Add')}</button>
          </span>
        )}
      </div>
      {error && <div className="callout callout--danger" role="alert"><Icon name="alert" size={16} /><span>{error}</span></div>}
      {edit && dirty && (
        <div className="at-save">
          <button type="button" className="btn" onClick={() => setDraft(null)} disabled={busy}>{t('Undo changes')}</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy} data-testid="closers-save">{busy ? t('Saving…') : t('Save who can close')}</button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- (b) contractors

function Contractors({ edit, areaIds, onSaved }: { edit: boolean; areaIds: string[]; onSaved: (text: string) => void }) {
  const acts = useActionsOptional();
  const stored = useMemo(() => acts?.payload?.contractors ?? [], [acts?.payload]);
  const people = acts?.payload?.people ?? [];
  const openBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of acts?.payload?.actions ?? []) if (a.status !== 'Closed' && a.status !== 'Cancelled') m.set(a.owner, (m.get(a.owner) ?? 0) + 1);
    return m;
  }, [acts?.payload]);
  const [rows, setRows] = useState<Contractor[] | null>(null);
  const [areasFor, setAreasFor] = useState<string | null>(null);
  const { run, busy, error, setError } = useAction();
  const list = rows ?? stored;
  const changed = list.filter((r) => JSON.stringify(r) !== JSON.stringify(stored.find((s) => s.contractor_id === r.contractor_id)));
  const upd = (id: string, patch: Partial<Contractor>) => setRows(list.map((r) => (r.contractor_id === id ? { ...r, ...patch } : r)));
  // an area may belong to one active external contractor only
  const clash = useMemo(() => {
    const owner = new Map<string, string>();
    for (const c of list) {
      if (!c.active || c.kind !== 'contractor') continue;
      for (const a of c.areas) {
        const o = owner.get(a);
        if (o && o !== c.contractor_id) return t('Area {a} would belong to both {x} and {y}.', { a, x: o, y: c.contractor_id });
        owner.set(a, c.contractor_id);
      }
    }
    return null;
  }, [list]);
  const badId = list.find((r) => !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/.test(r.contractor_id) || !r.name.trim());
  async function save() {
    setError(null);
    if (clash || badId || !changed.length) return;
    const res = await run((tok) => api.saveContractors(tok, changed));
    if (res.ok) {
      setRows(null);
      onSaved(t('Contractors saved.'));
      acts?.reload();
    }
  }
  const add = () => {
    let n = list.length + 1;
    while (list.some((r) => r.contractor_id === `NEW${n}`)) n++;
    setRows([...list, { contractor_id: `NEW${n}`, name: '', areas: [], kind: 'contractor', active: true, sort_order: (Math.max(0, ...list.map((r) => r.sort_order)) || 0) + 1, default_assignee: '' }]);
  };
  const isNew = (id: string) => !stored.some((s) => s.contractor_id === id);
  return (
    <section className="card at-sec" aria-labelledby="at-contr" data-testid="contractors">
      <header className="at-sec-head"><span className="at-letter" aria-hidden="true">b</span><div><h2 id="at-contr">{t('Contractors and responsible areas')}</h2>
        <p className="adm-note">{t('New actions get the contractor of their area automatically. Talking to contractors happens outside the app.')}</p></div>
        {edit && <button type="button" className="btn btn-sm at-head-btn" onClick={add} data-testid="contractor-add"><Icon name="plus" size={14} /> {t('Add contractor')}</button>}
      </header>
      {!acts?.payload && <p className="muted">{acts?.error ?? t('Loading…')}</p>}
      <div className="table-wrap">
        <table className="data-table at-table" data-testid="contractor-table">
          <thead><tr><th scope="col">{t('Contractor / team')}</th><th scope="col">{t('Type')}</th><th scope="col">{t('Responsible areas')}</th><th scope="col">{t('Default owner')}</th><th scope="col">{t('Active')}</th><th scope="col" className="num">{t('Order')}</th><th scope="col" className="num">{t('Open actions')}</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.contractor_id} data-testid="contractor-row" data-id={c.contractor_id}>
                <td>
                  {edit && isNew(c.contractor_id) && <input className="input at-id" value={c.contractor_id} onChange={(e) => setRows(list.map((r) => (r === c ? { ...r, contractor_id: e.target.value } : r)))} aria-label={t('Contractor id')} data-testid="contractor-id" />}
                  {edit ? <input className="input" value={c.name} onChange={(e) => upd(c.contractor_id, { name: e.target.value })} aria-label={t('Name of {id}', { id: c.contractor_id })} maxLength={60} data-testid="contractor-name" /> : <b>{c.name}</b>}
                  {!isNew(c.contractor_id) && <small className="muted mono"> {c.contractor_id}</small>}
                </td>
                <td>
                  {edit ? (
                    <select className="select" value={c.kind} onChange={(e) => upd(c.contractor_id, { kind: e.target.value as Contractor['kind'] })} aria-label={t('Type of {id}', { id: c.contractor_id })} data-testid="contractor-kind">
                      <option value="contractor">{t('External contractor')}</option>
                      <option value="internal">{t('Internal team')}</option>
                    </select>
                  ) : c.kind === 'contractor' ? t('External contractor') : t('Internal team')}
                </td>
                <td className="at-areas-cell">
                  <span className="at-areas">{c.areas.length ? c.areas.map((a) => <span key={a} className="act-tag">{a}</span>) : <span className="muted">{c.kind === 'internal' ? t('Any area') : t('No area')}</span>}</span>
                  {edit && (
                    <button type="button" className="btn btn-sm" aria-expanded={areasFor === c.contractor_id} onClick={() => setAreasFor(areasFor === c.contractor_id ? null : c.contractor_id)} data-testid="contractor-areas-btn">
                      <Icon name="edit" size={13} /> {t('Areas')}
                    </button>
                  )}
                  {edit && areasFor === c.contractor_id && (
                    <div className="at-area-pick" role="group" aria-label={t('Areas of {n}', { n: c.name || c.contractor_id })} data-testid="contractor-area-pick">
                      {areaIds.map((a) => {
                        const on = c.areas.includes(a);
                        return <button key={a} type="button" className={on ? 'chip chip--on' : 'chip'} aria-pressed={on} onClick={() => upd(c.contractor_id, { areas: on ? c.areas.filter((x) => x !== a) : [...c.areas, a] })} data-testid={`contractor-area-${a}`}>{a}</button>;
                      })}
                    </div>
                  )}
                </td>
                <td>
                  {edit ? (
                    <select className="select" value={c.default_assignee} onChange={(e) => upd(c.contractor_id, { default_assignee: e.target.value })} aria-label={t('Default owner of {id}', { id: c.contractor_id })} data-testid="contractor-assignee">
                      <option value="">{t('Nobody')}</option>
                      {c.default_assignee && !people.some((p) => p.user_id === c.default_assignee) && <option value={c.default_assignee}>{c.default_assignee}</option>}
                      {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}
                    </select>
                  ) : personName(people, c.default_assignee) || <span className="muted">{t('Nobody')}</span>}
                </td>
                <td>
                  <label className="act-switch">
                    <input type="checkbox" checked={c.active} disabled={!edit} onChange={(e) => upd(c.contractor_id, { active: e.target.checked })} data-testid="contractor-active" />
                    <span className="act-switch-ui" aria-hidden="true" /><span className="sr-only">{t('Active')}</span>
                  </label>
                </td>
                <td className="num">
                  {edit ? <input className="input at-num" inputMode="numeric" value={String(c.sort_order)} onChange={(e) => upd(c.contractor_id, { sort_order: Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0))) })} aria-label={t('Order of {id}', { id: c.contractor_id })} /> : c.sort_order}
                </td>
                <td className="num">{openBy.get(c.contractor_id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(clash || badId) && edit && <div className="callout callout--warning" role="alert" data-testid="contractor-problem"><Icon name="alert" size={16} /><span>{clash ?? t('Each contractor needs an id (letters, digits, spaces, dots, dashes) and a name.')}</span></div>}
      {error && <div className="callout callout--danger" role="alert" data-testid="contractor-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
      {edit && changed.length > 0 && (
        <div className="at-save">
          <span className="muted">{t('{n} changed', { n: changed.length })}</span>
          <button type="button" className="btn" onClick={() => { setRows(null); setError(null); }} disabled={busy}>{t('Undo changes')}</button>
          <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy || !!clash || !!badId} data-testid="contractors-save">{busy ? t('Saving…') : t('Save contractors')}</button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- (c) rules and "Run checks now"

function Rules({ edit, onSaved }: { edit: boolean; onSaved: (text: string) => void }) {
  const { st, settings } = useSettingsData();
  const acts = useActionsOptional();
  const { run, busy, error } = useAction();
  const [result, setResult] = useState<string | null>(null);
  async function runNow() {
    setResult(null);
    const res = await run((tok) => api.runActionChecks(tok));
    if (res.ok) {
      const r = res.value;
      setResult(t('{c} drafts created, {m} merged into open actions, {e} effectiveness verdicts', { c: num(r.created), m: num(r.merged), e: num(r.effectiveness) }));
      acts?.reload();
    }
  }
  return (
    <div className="at-rules" data-testid="action-rules">
      {edit && (
        <section className="card at-sec" aria-label={t('Run checks now')}>
          <header className="at-sec-head"><span className="at-letter" aria-hidden="true">c</span><div><h2>{t('Rules')}</h2>
            <p className="adm-note">{t('When a rule fires it can create a Draft action for review. An open action for the same equipment and reason gets the new records as evidence instead. The checks run after every upload and once a day; run them now after changing a rule.')}</p></div>
            <button type="button" className="btn at-head-btn" onClick={() => void runNow()} disabled={busy} data-testid="run-action-checks"><Icon name="sync" size={14} /> {busy ? t('Running…') : t('Run checks now')}</button>
          </header>
          {result && <p role="status" className="np-result" data-testid="run-action-checks-result"><span aria-hidden="true">✓ </span>{result}</p>}
          {error && <div className="callout callout--danger" role="alert" data-testid="run-action-checks-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
        </section>
      )}
      {st.startup && <SettingsForm settings={settings} canEdit={edit} badge={<AccessBadge edit={edit} />} groupIds={['action-rules']} hideKeys={['actions_closers']} onSaved={(text) => { onSaved(text); st.reload(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- (d) area targets

function AreaTargets({ edit, onSaved }: { edit: boolean; onSaved: (text: string) => void }) {
  const { st } = useSettingsData();
  const tg = useAreaTargets();
  const v = useValidationOptional();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const areas = useMemo(() => (st.startup?.areas ?? []).slice().sort((a, b) => a.sort_order - b.sort_order), [st.startup]);
  const stored = useMemo(() => new Map(tg.targets.filter((r) => r.year === year).map((r) => [r.area_id, r])), [tg.targets, year]);
  const [drafts, setDrafts] = useState<Record<string, TargetDraft>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { run, busy, error } = useAction();
  useEffect(() => { setDrafts({}); setOpen(null); setShown(false); }, [year]);
  const years = useMemo(() => [...new Set([thisYear - 1, thisYear, thisYear + 1, ...tg.targets.map((r) => r.year), ...(st.startup?.years ?? [])])].sort((a, b) => b - a), [tg.targets, st.startup, thisYear]);
  const draftFor = (area: string): TargetDraft => drafts[area] ?? draftOf(stored.get(area));
  const dirtyAreas = Object.keys(drafts).filter((a) => JSON.stringify(drafts[a]) !== JSON.stringify(draftOf(stored.get(a))));
  const checks = Object.fromEntries(dirtyAreas.map((a) => [a, checkDraft(draftFor(a))]));
  const problems = dirtyAreas.filter((a) => Object.keys(checks[a]!.problems).length > 0);
  const toSend = dirtyAreas.filter((a) => !checks[a]!.blank);
  const set = (area: string, patch: Partial<TargetDraft>) => setDrafts((d) => ({ ...d, [area]: { ...(d[area] ?? draftOf(stored.get(area))), ...patch } }));
  // planned hours used, January to the newest data of the year
  const ytd = useMemo(() => {
    if (!v?.ready || !v.rows.length) return null;
    const end = v.rows.reduce((m, r) => (r.event_date > m ? r.event_date : m), '');
    const fake: AreaTarget[] = areas.map((a) => {
      const d = drafts[a.area_id] ?? draftOf(stored.get(a.area_id));
      const c = checkDraft(d);
      return { area_id: a.area_id, year, availability_target_pct: null, planned_allowance_h_year: c.allowance, monthly_split: c.split, overhaul_months: d.overhaul, updated_at: '', updated_by: '' };
    });
    return new Map(plannedYtd({ rows: v.rows, targets: fake, year, dataEnd: end }).map((p) => [p.area_id, p]));
  }, [v?.ready, v?.rows, areas, drafts, stored, year]);

  async function save() {
    setShown(true);
    if (problems.length || !toSend.length) return;
    const rows: AreaTargetInput[] = toSend.map((a) => {
      const d = draftFor(a);
      const c = checks[a]!;
      return {
        area_id: a, availability_target_pct: d.target.trim() === '' ? null : Number(d.target.replace(',', '.')),
        planned_allowance_h_year: c.allowance, monthly_split: c.split, overhaul_months: [...d.overhaul].sort((x, y) => x - y),
      };
    });
    const res = await run((tok) => api.saveAreaTargets(tok, year, rows));
    if (res.ok) {
      storeYearTargets(year, res.value);
      setDrafts({});
      setShown(false);
      onSaved(t('Area targets for {y} saved.', { y: year }));
    }
  }

  const visible = showAll ? areas : areas.filter((a, i) => i < 8 || stored.has(a.area_id) || drafts[a.area_id]);
  return (
    <section className="card at-sec" aria-labelledby="at-targets" data-testid="area-targets">
      <header className="at-sec-head"><span className="at-letter" aria-hidden="true">d</span><div><h2 id="at-targets">{t('Area targets')}</h2>
        <p className="adm-note">{t('Availability target and planned-stop allowance per area per year. The year is split evenly by month unless you change a month; an overhaul is marked in the month it is planned. Used by the rules Availability below target and Planned overrun, and by the Dashboard.')}</p></div>
        <label className="af-pill at-head-btn">
          <span className="af-pill-label">{t('Year')}:</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={t('Year')} data-testid="targets-year">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <Icon name="chevronDown" size={14} />
        </label>
      </header>
      {tg.error && !tg.data && <div className="callout callout--danger" role="alert"><Icon name="alert" size={16} /><span>{tg.error}</span></div>}
      <div className="table-wrap">
        <table className="data-table at-table at-targets" data-testid="targets-table">
          <thead>
            <tr><th scope="col">{t('Area · line')}</th><th scope="col">{t('Target %')}</th><th scope="col">{t('Allowance h / year')}</th><th scope="col">{t('Overhaul')}</th><th scope="col">{t('Monthly split')}</th><th scope="col">{t('Planned used, year to date')}</th></tr>
          </thead>
          <tbody>
            {visible.map((a) => {
              const d = draftFor(a.area_id);
              const c = checkDraft(d);
              const bad = (k: string) => shown && !!checks[a.area_id]?.problems[k];
              const p = ytd?.get(a.area_id);
              const isOpen = open === a.area_id;
              const dirty = dirtyAreas.includes(a.area_id);
              return [
                <tr key={a.area_id} className={isOpen ? 'tr-selected' : undefined} data-testid="target-row" data-area={a.area_id} data-dirty={dirty || undefined}>
                  <td className="nowrap">
                    <button type="button" className="at-expand" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : a.area_id)} data-testid="target-expand" aria-label={t('Months of {a}', { a: a.area_id })}>
                      <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={15} />
                    </button>
                    <b>{a.area_id}</b> <span className="muted">{a.name} · {a.line_id}</span>
                  </td>
                  <td>
                    <input className={bad('target') ? 'input at-num at-bad' : 'input at-num'} inputMode="decimal" value={d.target} readOnly={!edit} onChange={(e) => set(a.area_id, { target: e.target.value })} aria-label={t('Availability target of {a} (%)', { a: a.area_id })} data-testid="target-pct" placeholder="–" />
                  </td>
                  <td>
                    <input className={bad('allowance') ? 'input at-num at-bad' : 'input at-num'} inputMode="decimal" value={d.allowance} readOnly={!edit} aria-label={t('Planned allowance of {a} (hours a year)', { a: a.area_id })} data-testid="target-allowance" placeholder="–"
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(',', '.'));
                        // a split that was even (or blank) follows the new allowance
                        const wasEven = d.split.every((x) => x === '') || isEvenSplit(c.split, c.allowance);
                        set(a.area_id, { allowance: e.target.value, ...(wasEven && Number.isFinite(n) && n >= 0 ? { split: evenMonthlySplit(n).map(String) } : {}) });
                      }} />
                  </td>
                  <td className="nowrap">{d.overhaul.length ? d.overhaul.map((m) => <span key={m} className="act-tag act-tag--auto"><Icon name="tool" size={12} />{MONTHS[m - 1]}</span>) : <span className="muted">–</span>}</td>
                  <td className="nowrap" data-testid="target-split-summary">{c.blank ? <span className="muted">{t('No target')}</span> : splitSummary(c.split, c.allowance)}{bad('split') && <span className="at-bad-text"> · {t('does not add up')}</span>}</td>
                  <td className="at-ytd">
                    {p && c.allowance > 0 ? (
                      <span className={p.ytdUsed > p.ytdAllowed ? 'at-meter at-meter--over' : 'at-meter'} title={t('{u} h of {a} h, January to {m}', { u: fmtH(p.ytdUsed), a: fmtH(p.ytdAllowed), m: MONTHS[p.through - 1] ?? '' })}>
                        <span className="at-meter-bar"><span style={{ width: `${Math.min(100, p.ytdAllowed > 0 ? (p.ytdUsed / p.ytdAllowed) * 100 : 100)}%` }} /></span>
                        <b>{fmtH(p.ytdUsed)} / {fmtH(p.ytdAllowed)} h</b>{p.ytdUsed > p.ytdAllowed && <span className="at-over">{t('over')}</span>}
                      </span>
                    ) : <span className="muted">–</span>}
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${a.area_id}-m`} className="at-months-row" data-testid="target-months">
                    <td colSpan={6}>
                      <div className="at-months">
                        {MONTHS.map((m, i) => {
                          const used = p?.months[i]?.used;
                          const over = p?.months[i]?.over;
                          const oh = d.overhaul.includes(i + 1);
                          return (
                            <div key={m} className={`at-month${oh ? ' at-month--oh' : ''}`}>
                              <label htmlFor={`m-${a.area_id}-${i}`}>{m}</label>
                              <input id={`m-${a.area_id}-${i}`} className={bad(`split${i}`) || over ? 'input at-num at-bad' : 'input at-num'} inputMode="decimal" value={d.split[i] ?? ''} readOnly={!edit}
                                onChange={(e) => set(a.area_id, { split: d.split.map((x, k) => (k === i ? e.target.value : x)) })} data-testid={`target-month-${i + 1}`} />
                              <small className={over ? 'at-bad-text' : 'muted'}>{used === null || used === undefined ? '–' : t('used {h}', { h: fmtH(used) })}</small>
                              <button type="button" className={oh ? 'chip chip--on at-oh' : 'chip at-oh'} aria-pressed={oh} disabled={!edit} onClick={() => set(a.area_id, { overhaul: oh ? d.overhaul.filter((x) => x !== i + 1) : [...d.overhaul, i + 1] })} data-testid={`target-overhaul-${i + 1}`}>
                                <Icon name="tool" size={12} /> {t('Overhaul')}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <div className="at-months-foot">
                        <span role="status" className={Math.abs(c.diff) > 0.1 + 1e-9 && !c.blank ? 'at-sum at-sum--bad' : 'at-sum'} data-testid="target-sum">
                          {c.blank ? t('No allowance entered.') : Math.abs(c.diff) > 0.1 + 1e-9
                            ? t('The months add up to {s} h, not {a} h ({d} h).', { s: fmtH(c.sum), a: fmtH(c.allowance), d: `${c.diff > 0 ? '+' : '−'}${fmtH(Math.abs(c.diff))}` })
                            : t('The months add up to {s} h = the {a} h allowed in {y}.', { s: fmtH(c.sum), a: fmtH(c.allowance), y: year })}
                        </span>
                        {edit && <button type="button" className="btn btn-sm" onClick={() => set(a.area_id, { split: evenMonthlySplit(c.allowance).map(String) })} disabled={!(c.allowance >= 0)} data-testid="target-even"><Icon name="reset" size={13} /> {t('Even split')}</button>}
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
      {areas.length > visible.length && <button type="button" className="af-link at-more" onClick={() => setShowAll(true)} data-testid="targets-show-all">{t('Show {n} more areas', { n: areas.length - visible.length })}</button>}
      {shown && problems.length > 0 && <div className="callout callout--warning" role="alert" data-testid="targets-problems"><Icon name="alert" size={16} /><span>{t('Fix the marked areas first ({a}). Nothing was saved.', { a: problems.join(', ') })}{' '}{problems.map((a) => Object.values(checks[a]!.problems)[0]).filter(Boolean)[0]}</span></div>}
      {error && <div className="callout callout--danger" role="alert" data-testid="targets-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
      {edit && dirtyAreas.length > 0 && (
        <div className="adm-actionbar at-bar" data-testid="targets-bar">
          <div className="adm-actionbar-text" role="status"><Icon name="info" size={14} /> {t('{n} unsaved: {a}', { n: dirtyAreas.length, a: dirtyAreas.join(', ') })}</div>
          <div className="adm-actionbar-buttons">
            <button type="button" className="btn" onClick={() => { setDrafts({}); setShown(false); }} disabled={busy} data-testid="targets-discard">{t('Discard')}</button>
            <button type="button" className="btn-primary" onClick={() => void save()} disabled={busy} data-testid="targets-save">{busy ? t('Saving…') : t('Save targets')}</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Settings > Actions & targets. */
export default function ActionsTargets() {
  const { st, settings, edit, toastNode, toast } = useSettingsData();
  const closers = useMemo(() => csv(settings.find((s) => s.key === 'actions_closers')?.value), [settings]);
  const areaIds = useMemo(() => (st.startup?.areas ?? []).slice().sort((a, b) => a.sort_order - b.sort_order).map((a) => a.area_id), [st.startup]);
  return (
    <div data-testid="settings-actions">
      <p className="status-line set-summary"><Icon name="info" size={14} /><span>{t('Plant-wide settings for the Actions page. Changes are saved to the history.')}</span><AccessBadge edit={edit} /></p>
      <Closers edit={edit} stored={closers} onSaved={(text) => { toast(text); st.reload(); }} />
      <Contractors edit={edit} areaIds={areaIds} onSaved={toast} />
      <Rules edit={edit} onSaved={toast} />
      <AreaTargets edit={edit} onSaved={toast} />
      {toastNode}
    </div>
  );
}
