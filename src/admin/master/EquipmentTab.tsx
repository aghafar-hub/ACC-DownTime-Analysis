import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import type { Equipment } from '../../api/types';
import { codeKey } from '../../calc';
import { BottomSheet, ChipRow, CountChip, FiltersPill, PAGE_SIZE, ShowMore } from '../../components/PhoneParts';
import ShellModal, { FormSection } from '../../components/ShellModal';
import { useIsMobile } from '../../hooks/useIsMobile';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import ConfirmDialog from '../ConfirmDialog';
import { useAction, type TabProps } from '../useAction';

const CRITICALITY_HINTS = ['High', 'Medium', 'Low'];

function StatusBadge({ s }: { s: Equipment['status'] }) {
  return s === 'Active'
    ? <span className="badge badge--success"><span aria-hidden="true">●</span> {t('Active')}</span>
    : <span className="badge"><span aria-hidden="true">⊘</span> {t('Retired')}</span>;
}
const ReviewBadge = () => <span className="badge badge--warning" data-testid="badge-review"><span aria-hidden="true">▲</span> {t('Needs review')}</span>;

function EquipmentModal({ row, startup, canEdit, onClose, onSaved }: {
  row: Equipment | null; startup: TabProps['startup']; canEdit: boolean; onClose: () => void; onSaved: (text: string) => void;
}) {
  const { run, busy, error } = useAction();
  const isNew = row === null;
  const [code, setCode] = useState(row?.equipment_id ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [type, setType] = useState(row?.equipment_type ?? '');
  const [criticality, setCriticality] = useState(row?.criticality ?? '');
  const [parent, setParent] = useState(row?.parent_id ?? '');
  const [status, setStatus] = useState<Equipment['status']>(row?.status ?? 'Active');
  const [areas, setAreas] = useState<Set<string>>(() => new Set(startup.equipment_areas.filter((a) => a.equipment_id === row?.equipment_id).map((a) => a.area_id)));
  const [areaQ, setAreaQ] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmRetire, setConfirmRetire] = useState(false);

  const key = codeKey(code);
  const codes = useMemo(() => new Set(startup.equipment.map((e) => e.equipment_id)), [startup.equipment]);
  const shownAreas = startup.areas.filter((a) => !areaQ.trim() || `${a.area_id} ${a.name}`.toLowerCase().includes(areaQ.trim().toLowerCase()));

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!key) e.code = t('Write the equipment code.');
    else if (key === 'N/A' || key === 'NA') e.code = t('N/A means "the whole area stopped". Use a real equipment code.');
    else if (isNew && codes.has(key)) e.code = t('This code is already in the list. Open it from the list to change it.');
    const p = codeKey(parent);
    if (p && p === key) e.parent = t('Equipment cannot be its own parent.');
    else if (p && !codes.has(p)) e.parent = t('The parent code "{p}" is not in the equipment list.', { p });
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    const next: Equipment = {
      ...(row ?? { status: 'Active' as const, needs_review: false }),
      equipment_id: key, description: description.trim(), equipment_type: type.trim(), criticality: criticality.trim(),
      parent_id: codeKey(parent), status,
    };
    const res = await run((tok) => api.saveEquipment(tok, next, [...areas]));
    if (res.ok) onSaved(isNew ? t('Added {code}.', { code: key }) : t('Saved {code}.', { code: key }));
  }
  const onSave = () => {
    if (!validate()) return;
    if (row && row.status === 'Active' && status === 'Retired') setConfirmRetire(true);
    else void save();
  };
  const err = (k: string) => errors[k] && <span className="field-error" role="alert" data-testid={`error-${k}`}>{errors[k]}</span>;
  const ref = (label: string, v?: string) => (<><dt>{label}</dt><dd>{v || '-'}</dd></>);

  return (
    <ShellModal
      icon="equipment"
      title={isNew ? t('Add equipment code') : row.equipment_id}
      subtitle={isNew ? t('A new code for the equipment list') : row.description || t('(no description yet)')}
      badge={row?.needs_review ? <ReviewBadge /> : undefined}
      onClose={onClose}
      width={820}
      testid="equipment-modal"
      footer={canEdit ? (
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>{t('Cancel')}</button>
          <button type="button" className="btn-primary" onClick={onSave} disabled={busy} data-testid="save-equipment">{busy ? t('Saving…') : t('Save')}</button>
        </>
      ) : <button type="button" className="btn" onClick={onClose}>{t('Close')}</button>}
    >
      {error && <div className="callout callout--danger" role="alert" data-testid="server-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
      <fieldset disabled={!canEdit || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <FormSection icon="equipment" title={t('Equipment')}>
          <div className="form-grid">
            <div className={errors.code ? 'field field--error' : 'field'}>
              <label htmlFor="eq-code">{t('Equipment code')}</label>
              <input id="eq-code" className="input mono" value={code} readOnly={!isNew} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" data-testid="eq-code" />
              {isNew && key && key !== code && <span className="field-hint">{t('Saved as {key}', { key })}</span>}
              {err('code')}
            </div>
            <div className="field">
              <label htmlFor="eq-desc">{t('Description')}</label>
              <input id="eq-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="eq-desc" />
            </div>
            <div className="field">
              <label htmlFor="eq-type">{t('Type')}</label>
              <input id="eq-type" className="input" value={type} onChange={(e) => setType(e.target.value)} data-testid="eq-type" />
            </div>
            <div className="field">
              <label htmlFor="eq-crit">{t('Criticality')}</label>
              <input id="eq-crit" className="input" list="eq-crit-list" value={criticality} onChange={(e) => setCriticality(e.target.value)} data-testid="eq-crit" />
              <datalist id="eq-crit-list">{[...new Set([...CRITICALITY_HINTS, ...startup.equipment.map((e) => e.criticality ?? '')])].filter(Boolean).map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className={errors.parent ? 'field field--error' : 'field'}>
              <label htmlFor="eq-parent">{t('Parent code')}</label>
              <input id="eq-parent" className="input mono" list="eq-parent-list" value={parent} onChange={(e) => setParent(e.target.value)} data-testid="eq-parent" />
              <datalist id="eq-parent-list">{startup.equipment.slice(0, 3000).map((e) => <option key={e.equipment_id} value={e.equipment_id} />)}</datalist>
              {err('parent')}
            </div>
            <div className="field">
              <span className="field-label">{t('Status')}</span>
              <ChipRow label={t('Status')}>
                <CountChip on={status === 'Active'} onClick={() => setStatus('Active')} testid="status-active">{t('Active')}</CountChip>
                <CountChip on={status === 'Retired'} onClick={() => setStatus('Retired')} testid="status-retired">{t('Retired')}</CountChip>
              </ChipRow>
            </div>
          </div>
        </FormSection>
        <FormSection icon="database" title={t('Areas')} hint={t('A code can belong to several areas')} right={<span className="adm-muted-sm" data-testid="area-count">{t('{n} selected', { n: areas.size })}</span>}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="eq-area-q">{t('Find an area')}</label>
            <input id="eq-area-q" className="input" type="search" value={areaQ} onChange={(e) => setAreaQ(e.target.value)} />
          </div>
          <div className="adm-checklist" role="group" aria-label={t('Areas')} data-testid="area-checklist">
            {shownAreas.map((a) => (
              <label key={a.area_id} className="adm-check">
                <input type="checkbox" checked={areas.has(a.area_id)} data-testid={`area-${a.area_id}`}
                  onChange={() => setAreas((cur) => { const n = new Set(cur); if (n.has(a.area_id)) n.delete(a.area_id); else n.add(a.area_id); return n; })} />
                <span>{a.area_id} · {a.name} <small>{a.line_id}{a.active ? '' : ` · ${t('inactive')}`}</small></span>
              </label>
            ))}
          </div>
        </FormSection>
      </fieldset>
      {row && (
        <FormSection icon="info" title={t('From the platform and the system')} hint={t('Read only')}>
          <dl className="kv" data-testid="eq-reference">
            {ref(t('Plant area'), row.platform_plant_area)}
            {ref(t('Main area'), row.platform_main_area)}
            {ref(t('Sub area'), row.platform_sub_area)}
            {ref(t('Origin'), row.origin)}
            {ref(t('Review note'), row.review_note)}
            {ref(t('Last changed'), row.updated_at ? `${row.updated_at.slice(0, 16)}${row.updated_by ? ` · ${row.updated_by}` : ''}` : '')}
          </dl>
          <p className="adm-muted-sm" style={{ margin: '8px 0 0' }}>{t('"Needs review" is worked out by the system: a code needs review while it has no description, no criticality or no area.')}</p>
        </FormSection>
      )}
      {confirmRetire && (
        <ConfirmDialog title={t('Retire {code}?', { code: key })} danger confirmLabel={t('Retire')} busy={busy} onCancel={() => setConfirmRetire(false)} onConfirm={() => { setConfirmRetire(false); void save(); }}>
          {t('A retired code stays on the events that used it, but it is marked as no longer in service. You can make it Active again later.')}
        </ConfirmDialog>
      )}
    </ShellModal>
  );
}

export default function EquipmentTab({ startup, canEdit, reload, toast, reviewOnly }: TabProps & { reviewOnly?: boolean }) {
  const mobile = useIsMobile();
  const [q, setQ] = useState('');
  const [area, setArea] = useState('');
  const [review, setReview] = useState(!!reviewOnly);
  // a link from a notification asks for the "Needs review" filter (also when the tab is already open)
  useEffect(() => {
    if (reviewOnly) setReview(true);
  }, [reviewOnly]);
  const [status, setStatus] = useState('');
  const [origin, setOrigin] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [editing, setEditing] = useState<Equipment | 'new' | null>(null);
  const [sheet, setSheet] = useState(false);
  const dq = useDeferredValue(q);

  const areasOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const ea of startup.equipment_areas) m.set(ea.equipment_id, [...(m.get(ea.equipment_id) ?? []), ea.area_id]);
    return m;
  }, [startup.equipment_areas]);
  const origins = useMemo(() => [...new Set(startup.equipment.map((e) => e.origin ?? '').filter(Boolean))].sort(), [startup.equipment]);
  const list = useMemo(() => {
    const n = dq.trim().toLowerCase();
    const nk = codeKey(dq);
    return startup.equipment.filter((e) => {
      if (n && !(codeKey(e.equipment_id).includes(nk) || (e.description ?? '').toLowerCase().includes(n))) return false;
      if (area && !(areasOf.get(e.equipment_id) ?? []).includes(area)) return false;
      if (review && !e.needs_review) return false;
      if (status && e.status !== status) return false;
      if (origin && (e.origin ?? '') !== origin) return false;
      return true;
    });
  }, [startup.equipment, dq, area, review, status, origin, areasOf]);
  const visible = list.slice(0, shown);
  const filterKey = `${dq}|${area}|${review}|${status}|${origin}`;
  const [lastKey, setLastKey] = useState(filterKey);
  if (lastKey !== filterKey) { setLastKey(filterKey); setShown(PAGE_SIZE); }
  const reset = () => { setQ(''); setArea(''); setReview(false); setStatus(''); setOrigin(''); };
  const filtered = !!(q || area || review || status || origin);

  const selects = (id: string) => (
    <>
      <div className="field">
        <label htmlFor={`${id}-eq-area`}>{t('Area')}</label>
        <select id={`${id}-eq-area`} className="select" value={area} onChange={(e) => setArea(e.target.value)} data-testid="equipment-area">
          <option value="">{t('All areas')}</option>
          {startup.areas.map((a) => <option key={a.area_id} value={a.area_id}>{a.area_id} · {a.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-eq-status`}>{t('Status')}</label>
        <select id={`${id}-eq-status`} className="select" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="equipment-status">
          <option value="">{t('Active and retired')}</option>
          <option value="Active">{t('Active')}</option>
          <option value="Retired">{t('Retired')}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-eq-origin`}>{t('Origin')}</label>
        <select id={`${id}-eq-origin`} className="select" value={origin} onChange={(e) => setOrigin(e.target.value)} data-testid="equipment-origin">
          <option value="">{t('Any origin')}</option>
          {origins.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    </>
  );

  return (
    <>
      <div className="adm-toolbar" data-testid="equipment-filters">
        <div className="field adm-grow">
          <label htmlFor="eq-search">{t('Search')}</label>
          <input id="eq-search" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Code or description')} autoComplete="off" data-testid="equipment-search" />
        </div>
        {!mobile && selects('d')}
        <div className="field">
          <span className="field-label">{t('Review')}</span>
          <ChipRow label={t('Quick filters')}>
            <CountChip on={review} onClick={() => setReview(!review)} testid="equipment-review">{t('Needs review')}</CountChip>
            {mobile && <FiltersPill count={[area, status, origin].filter(Boolean).length} onClick={() => setSheet(true)} testid="equipment-filters-pill" />}
          </ChipRow>
        </div>
        <div className="adm-toolbar-actions">
          {filtered && <button type="button" className="btn" onClick={reset} data-testid="equipment-reset">{t('Reset')}</button>}
          {canEdit && <button type="button" className="btn-primary" onClick={() => setEditing('new')} data-testid="add-equipment"><Icon name="plus" size={15} /> {t('Add code')}</button>}
        </div>
      </div>
      {sheet && (
        <BottomSheet title={t('Filters')} onClose={() => setSheet(false)} testid="equipment-sheet"
          footer={<><button type="button" className="btn" onClick={reset}>{t('Reset')}</button><button type="button" className="btn-primary" onClick={() => setSheet(false)} data-testid="equipment-sheet-apply">{t('Show {n} codes', { n: list.length.toLocaleString('en-GB') })}</button></>}>
          {selects('s')}
        </BottomSheet>
      )}
      <p className="status-line" style={{ marginBottom: 8 }} data-testid="equipment-count">{t('{a} of {b} codes', { a: list.length.toLocaleString('en-GB'), b: startup.equipment.length.toLocaleString('en-GB') })}</p>

      {list.length === 0 ? (
        <div className="callout" role="status" data-testid="equipment-empty"><Icon name="info" size={16} /><span>{t('No codes match these filters.')}</span></div>
      ) : !mobile ? (
        <div className="table-wrap" data-testid="equipment-table">
          <table className="data-table">
            <thead><tr><th scope="col">{t('Code')}</th><th scope="col">{t('Description')}</th><th scope="col">{t('Type')}</th><th scope="col">{t('Criticality')}</th><th scope="col">{t('Areas')}</th><th scope="col">{t('Status')}</th></tr></thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.equipment_id} data-testid="equipment-row" data-code={e.equipment_id}>
                  <td className="nowrap"><button type="button" className="row-link" onClick={() => setEditing(e)} aria-label={t('Open {code}', { code: e.equipment_id })}>{e.equipment_id}</button></td>
                  <td>{e.description || <span className="muted">{t('(none)')}</span>}</td>
                  <td>{e.equipment_type || '-'}</td>
                  <td>{e.criticality || '-'}</td>
                  <td className="mono">{(areasOf.get(e.equipment_id) ?? []).join(', ') || '-'}</td>
                  <td><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}><StatusBadge s={e.status} />{e.needs_review && <ReviewBadge />}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="adm-cards" data-testid="equipment-cards">
          {visible.map((e) => (
            <button key={e.equipment_id} type="button" className="adm-card" onClick={() => setEditing(e)} data-testid="equipment-card" data-code={e.equipment_id}>
              <div className="adm-card-top"><span className="adm-card-title">{e.equipment_id}</span><StatusBadge s={e.status} /></div>
              <div className="adm-card-line">{e.description || t('(no description yet)')}</div>
              <div className="adm-card-line mono">{(areasOf.get(e.equipment_id) ?? []).join(', ') || t('no area')}</div>
              {e.needs_review && <div className="adm-card-badges"><ReviewBadge /></div>}
            </button>
          ))}
        </div>
      )}
      <ShowMore shown={visible.length} total={list.length} onMore={() => setShown((n) => n + PAGE_SIZE)} />

      {editing && (
        <EquipmentModal
          row={editing === 'new' ? null : editing} startup={startup} canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSaved={(text) => { setEditing(null); toast(text); void reload(); }}
        />
      )}
    </>
  );
}
