import { useState } from 'react';
import { api } from '../../api';
import type { Area } from '../../api/types';
import { ChipRow, CountChip } from '../../components/PhoneParts';
import ShellModal, { FormSection } from '../../components/ShellModal';
import { useIsMobile } from '../../hooks/useIsMobile';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import ConfirmDialog from '../ConfirmDialog';
import { useAction, type TabProps } from '../useAction';
import StickyTableWrap from '../../components/StickyTableWrap';

const Active = ({ on }: { on: boolean }) => on
  ? <span className="badge badge--success"><span aria-hidden="true">●</span> {t('Active')}</span>
  : <span className="badge"><span aria-hidden="true">⊘</span> {t('Inactive')}</span>;

function AreaModal({ row, startup, canEdit, onClose, onSaved }: { row: Area | null; startup: TabProps['startup']; canEdit: boolean; onClose: () => void; onSaved: (s: string) => void }) {
  const { run, busy, error } = useAction();
  const isNew = row === null;
  const [id, setId] = useState(row?.area_id ?? '');
  const [name, setName] = useState(row?.name ?? '');
  const [line, setLine] = useState(row?.line_id ?? startup.lines[0]?.line_id ?? '');
  const [order, setOrder] = useState(String(row?.sort_order ?? Math.max(0, ...startup.areas.map((a) => a.sort_order)) + 1));
  const [active, setActive] = useState(row?.active ?? true);
  const [sheet, setSheet] = useState(row?.in_downtime_sheet ?? true);
  const [notes, setNotes] = useState(row?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!id.trim()) e.id = t('Write the area code.');
    else if (isNew && startup.areas.some((a) => a.area_id.toLowerCase() === id.trim().toLowerCase())) e.id = t('This area code is already in the list.');
    if (!name.trim()) e.name = t('The area needs a name.');
    if (!Number.isInteger(Number(order)) || order.trim() === '') e.order = t('The order must be a whole number.');
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  async function save() {
    const next: Area = { area_id: id.trim(), name: name.trim(), line_id: line, sort_order: Number(order), active, in_downtime_sheet: sheet, notes: notes.trim() || undefined };
    const res = await run((tok) => api.saveArea(tok, next));
    if (res.ok) onSaved(isNew ? t('Added area {id}.', { id: next.area_id }) : t('Saved area {id}.', { id: next.area_id }));
  }
  const onSave = () => {
    if (!validate()) return;
    if (row?.active && !active) setConfirm(true); else void save();
  };
  const err = (k: string) => errors[k] && <span className="field-error" role="alert" data-testid={`error-${k}`}>{errors[k]}</span>;
  return (
    <ShellModal icon="database" title={isNew ? t('Add area') : row.area_id} subtitle={isNew ? undefined : row.name} onClose={onClose} width={640} testid="area-modal"
      footer={canEdit ? (<><button type="button" className="btn" onClick={onClose} disabled={busy}>{t('Cancel')}</button><button type="button" className="btn-primary" onClick={onSave} disabled={busy} data-testid="save-area">{busy ? t('Saving…') : t('Save')}</button></>) : <button type="button" className="btn" onClick={onClose}>{t('Close')}</button>}>
      {error && <div className="callout callout--danger" role="alert" data-testid="server-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
      <fieldset disabled={!canEdit || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <FormSection icon="database" title={t('Area')}>
          <div className="form-grid">
            <div className={errors.id ? 'field field--error' : 'field'}>
              <label htmlFor="ar-id">{t('Area code')}</label>
              <input id="ar-id" className="input mono" value={id} readOnly={!isNew} onChange={(e) => setId(e.target.value)} data-testid="ar-id" />
              {err('id')}
            </div>
            <div className={errors.name ? 'field field--error' : 'field'}>
              <label htmlFor="ar-name">{t('Name')}</label>
              <input id="ar-name" className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="ar-name" />
              {err('name')}
            </div>
            <div className="field">
              <label htmlFor="ar-line">{t('Line')}</label>
              <select id="ar-line" className="select" value={line} onChange={(e) => setLine(e.target.value)} data-testid="ar-line">
                {startup.lines.map((l) => <option key={l.line_id} value={l.line_id}>{l.name}</option>)}
              </select>
            </div>
            <div className={errors.order ? 'field field--error' : 'field'}>
              <label htmlFor="ar-order">{t('Order in lists')}</label>
              <input id="ar-order" className="input mono" inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} data-testid="ar-order" />
              {err('order')}
            </div>
            <div className="field">
              <span className="field-label">{t('Active')}</span>
              <ChipRow label={t('Active')}>
                <CountChip on={active} onClick={() => setActive(true)} testid="ar-active-yes">{t('Active')}</CountChip>
                <CountChip on={!active} onClick={() => setActive(false)} testid="ar-active-no">{t('Inactive')}</CountChip>
              </ChipRow>
            </div>
            <div className="field">
              <span className="field-label">{t('Appears in the downtime sheet')}</span>
              <ChipRow label={t('Appears in the downtime sheet')}>
                <CountChip on={sheet} onClick={() => setSheet(true)}>{t('Yes')}</CountChip>
                <CountChip on={!sheet} onClick={() => setSheet(false)}>{t('No')}</CountChip>
              </ChipRow>
            </div>
            <div className="field span-2">
              <label htmlFor="ar-notes">{t('Notes')}</label>
              <textarea id="ar-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </FormSection>
      </fieldset>
      {confirm && (
        <ConfirmDialog title={t('Make {id} inactive?', { id })} danger confirmLabel={t('Make inactive')} busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void save(); }}>
          {t('Existing events keep their area. An inactive area is no longer offered for new data.')}
        </ConfirmDialog>
      )}
    </ShellModal>
  );
}

export default function AreasTab({ startup, canEdit, reload, toast }: TabProps) {
  const mobile = useIsMobile();
  const [editing, setEditing] = useState<Area | 'new' | null>(null);
  const lineName = (id: string) => startup.lines.find((l) => l.line_id === id)?.name ?? id;
  const list = [...startup.areas].sort((a, b) => a.sort_order - b.sort_order);
  return (
    <>
      <div className="adm-toolbar">
        <p className="adm-note" style={{ margin: 0 }}>{t('Areas are the parts of the plant that stop. The downtime sheet names them in its EQUIPMENT column.')}</p>
        {canEdit && <div className="adm-toolbar-actions"><button type="button" className="btn-primary" onClick={() => setEditing('new')} data-testid="add-area"><Icon name="plus" size={15} /> {t('Add area')}</button></div>}
      </div>
      {!mobile ? (
        <StickyTableWrap testid="areas-table">
          <table className="data-table">
            <thead><tr><th scope="col">{t('Area')}</th><th scope="col">{t('Name')}</th><th scope="col">{t('Line')}</th><th scope="col" className="num">{t('Order')}</th><th scope="col">{t('Status')}</th><th scope="col">{t('In downtime sheet')}</th></tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.area_id} data-testid="area-row" data-area={a.area_id}>
                  <td className="nowrap"><button type="button" className="row-link" onClick={() => setEditing(a)} aria-label={t('Open area {id}', { id: a.area_id })}>{a.area_id}</button></td>
                  <td>{a.name}{a.notes && <div className="muted" style={{ fontSize: 12 }}>{a.notes}</div>}</td>
                  <td>{lineName(a.line_id)}</td>
                  <td className="num">{a.sort_order}</td>
                  <td><Active on={a.active} /></td>
                  <td>{a.in_downtime_sheet ? t('Yes') : t('No')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StickyTableWrap>
      ) : (
        <div className="adm-cards" data-testid="areas-cards">
          {list.map((a) => (
            <button key={a.area_id} type="button" className="adm-card" onClick={() => setEditing(a)} data-testid="area-card" data-area={a.area_id}>
              <div className="adm-card-top"><span className="adm-card-title">{a.area_id}</span><Active on={a.active} /></div>
              <div className="adm-card-line">{a.name} · {lineName(a.line_id)}</div>
              <div className="adm-card-line">{t('Order {n}', { n: a.sort_order })} · {a.in_downtime_sheet ? t('in the downtime sheet') : t('not in the downtime sheet')}</div>
            </button>
          ))}
        </div>
      )}
      {editing && <AreaModal row={editing === 'new' ? null : editing} startup={startup} canEdit={canEdit} onClose={() => setEditing(null)} onSaved={(s) => { setEditing(null); toast(s); void reload(); }} />}
    </>
  );
}
