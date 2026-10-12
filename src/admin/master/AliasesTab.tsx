import { useMemo, useState } from 'react';
import { api } from '../../api';
import type { EquipmentAlias } from '../../api/types';
import { codeKey } from '../../calc';
import ShellModal, { FormSection } from '../../components/ShellModal';
import { useIsMobile } from '../../hooks/useIsMobile';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import ConfirmDialog from '../ConfirmDialog';
import { useAction, type TabProps } from '../useAction';

function AliasModal({ startup, onClose, onSaved }: { startup: TabProps['startup']; onClose: () => void; onSaved: (s: string) => void }) {
  const { run, busy, error } = useAction();
  const [alias, setAlias] = useState('');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const tk = codeKey(target);
  const found = startup.equipment.find((e) => e.equipment_id === tk);
  function validate(): boolean {
    const e: Record<string, string> = {};
    const ak = codeKey(alias);
    if (!ak) e.alias = t('Write the alias, the wrong spelling that appears in the workbook.');
    else if (startup.equipment.some((x) => x.equipment_id === ak)) e.alias = t('"{a}" is already a real equipment code, so it cannot be an alias.', { a: ak });
    if (!tk) e.target = t('Write the real equipment code this alias stands for.');
    else if (!found) e.target = t('The code "{c}" is not in the equipment list.', { c: tk });
    else if (ak && ak === tk) e.alias = t('The alias must differ from the code it points to.');
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  async function save() {
    if (!validate()) return;
    const row: EquipmentAlias = { alias: codeKey(alias), equipment_id: tk, reason: reason.trim() || undefined };
    const res = await run((tok) => api.saveAlias(tok, row));
    if (res.ok) onSaved(t('Added the alias {a}.', { a: row.alias }));
  }
  const err = (k: string) => errors[k] && <span className="field-error" role="alert" data-testid={`error-${k}`}>{errors[k]}</span>;
  return (
    <ShellModal icon="route" title={t('Add alias')} subtitle={t('A typo that always means one real code')} onClose={onClose} width={620} testid="alias-modal"
      footer={<><button type="button" className="btn" onClick={onClose} disabled={busy}>{t('Cancel')}</button><button type="button" className="btn-primary" onClick={() => void save()} disabled={busy} data-testid="save-alias">{busy ? t('Saving…') : t('Save')}</button></>}>
      {error && <div className="callout callout--danger" role="alert" data-testid="server-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
      <FormSection icon="route" title={t('Alias')}>
        <div className="form-grid">
          <div className={errors.alias ? 'field field--error' : 'field'}>
            <label htmlFor="al-alias">{t('Alias (as written in the workbook)')}</label>
            <input id="al-alias" className="input mono" value={alias} onChange={(e) => setAlias(e.target.value)} data-testid="al-alias" autoCapitalize="characters" />
            {codeKey(alias) && codeKey(alias) !== alias && <span className="field-hint">{t('Saved as {key}', { key: codeKey(alias) })}</span>}
            {err('alias')}
          </div>
          <div className={errors.target ? 'field field--error' : 'field'}>
            <label htmlFor="al-target">{t('Real equipment code')}</label>
            <input id="al-target" className="input mono" list="al-targets" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="al-target" autoCapitalize="characters" />
            <datalist id="al-targets">{startup.equipment.slice(0, 3000).map((e) => <option key={e.equipment_id} value={e.equipment_id} />)}</datalist>
            {found && <span className="field-hint" data-testid="al-found"><span aria-hidden="true">✓ </span>{found.description || t('(no description yet)')}</span>}
            {err('target')}
          </div>
          <div className="field span-2">
            <label htmlFor="al-reason">{t('Why (optional)')}</label>
            <input id="al-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('For example: missing dot in the sheet')} />
          </div>
        </div>
      </FormSection>
    </ShellModal>
  );
}

export default function AliasesTab({ startup, canEdit, reload, toast }: TabProps) {
  const mobile = useIsMobile();
  const del = useAction();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<EquipmentAlias | null>(null);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return startup.aliases.filter((a) => !n || a.alias.toLowerCase().includes(n) || a.equipment_id.toLowerCase().includes(n)).sort((a, b) => a.alias.localeCompare(b.alias));
  }, [startup.aliases, q]);
  async function remove() {
    if (!removing) return;
    const a = removing;
    const res = await del.run((tok) => api.deleteAlias(tok, a.alias));
    if (res.ok) { setRemoving(null); toast(t('Deleted the alias {a}.', { a: a.alias })); void reload(); }
  }
  return (
    <>
      <div className="adm-toolbar">
        <div className="field adm-grow">
          <label htmlFor="al-search">{t('Search')}</label>
          <input id="al-search" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Alias or code')} data-testid="alias-search" />
        </div>
        {canEdit && <div className="adm-toolbar-actions"><button type="button" className="btn-primary" onClick={() => setAdding(true)} data-testid="add-alias"><Icon name="plus" size={15} /> {t('Add alias')}</button></div>}
      </div>
      <p className="adm-note">{t('When the workbook has an alias in the EQUIPMENT CODE column, the app reads it as the real code.')}</p>
      {list.length === 0 ? <div className="callout" role="status" data-testid="alias-empty"><Icon name="info" size={16} /><span>{t('No aliases.')}</span></div> : !mobile ? (
        <div className="table-wrap" data-testid="alias-table">
          <table className="data-table">
            <thead><tr><th scope="col">{t('Alias')}</th><th scope="col">{t('Real code')}</th><th scope="col">{t('Why')}</th>{canEdit && <th scope="col"><span className="sr-only">{t('Actions')}</span></th>}</tr></thead>
            <tbody>
              {list.map((a) => (
                <tr key={a.alias} data-testid="alias-row" data-alias={a.alias}>
                  <td className="mono nowrap">{a.alias}</td><td className="mono nowrap">{a.equipment_id}</td><td>{a.reason || '-'}</td>
                  {canEdit && <td><button type="button" className="btn-danger btn-sm" onClick={() => setRemoving(a)} data-testid="alias-delete" aria-label={t('Delete alias {a}', { a: a.alias })}>{t('Delete')}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="adm-cards" data-testid="alias-cards">
          {list.map((a) => (
            <div key={a.alias} className="adm-card" data-testid="alias-card" data-alias={a.alias}>
              <div className="adm-card-top"><span className="adm-card-title">{a.alias}</span><span className="adm-card-line mono">→ {a.equipment_id}</span></div>
              {a.reason && <div className="adm-card-line">{a.reason}</div>}
              {canEdit && <div className="adm-card-badges"><button type="button" className="btn-danger btn-sm" onClick={() => setRemoving(a)} data-testid="alias-delete" aria-label={t('Delete alias {a}', { a: a.alias })}>{t('Delete')}</button></div>}
            </div>
          ))}
        </div>
      )}
      {adding && <AliasModal startup={startup} onClose={() => setAdding(false)} onSaved={(s) => { setAdding(false); toast(s); void reload(); }} />}
      {removing && (
        <ConfirmDialog title={t('Delete alias {a}?', { a: removing.alias })} danger confirmLabel={t('Delete')} busy={del.busy} onCancel={() => setRemoving(null)} onConfirm={() => void remove()}>
          {t('Rows that use "{a}" will be flagged as an unknown code from now on, until the alias is added again.', { a: removing.alias })}
          {del.error && <span className="field-error" role="alert" style={{ display: 'block', marginTop: 6 }}>{del.error}</span>}
        </ConfirmDialog>
      )}
    </>
  );
}
