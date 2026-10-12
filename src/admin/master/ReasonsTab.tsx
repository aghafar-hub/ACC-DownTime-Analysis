import { useMemo, useState } from 'react';
import { api } from '../../api';
import type { ClassificationCode, Reason } from '../../api/types';
import { matchKey } from '../../calc';
import { ChipRow, CountChip } from '../../components/PhoneParts';
import ShellModal, { FormSection } from '../../components/ShellModal';
import { t } from '../../i18n/t';
import { Icon } from '../../icons';
import ConfirmDialog from '../ConfirmDialog';
import ListedText, { hasOddSpacing } from '../ListedText';
import { useAction, type TabProps } from '../useAction';

function ReasonModal({ row, startCode, startup, canEdit, onClose, onSaved }: {
  row: Reason | null; startCode: ClassificationCode; startup: TabProps['startup']; canEdit: boolean; onClose: () => void; onSaved: (s: string) => void;
}) {
  const { run, busy, error } = useAction();
  const isNew = row === null;
  const [cls, setCls] = useState<ClassificationCode>(row?.classification ?? startCode);
  const [text, setText] = useState(row?.text_as_listed ?? '');
  const [active, setActive] = useState(row?.active ?? true);
  const [confirm, setConfirm] = useState(false);
  const [tried, setTried] = useState(false);
  const key = matchKey(text);
  const clash = key ? startup.reasons.find((r) => r.classification === cls && matchKey(r.text_as_listed) === key && r.reason_id !== row?.reason_id) : undefined;
  const empty = tried && !key;

  async function save() {
    const next: Reason = row ? { ...row, classification: cls, text_as_listed: text, active } : { reason_id: '', classification: cls, text_as_listed: text, match_key: key, order_no: 0, active };
    const res = await run((tok) => api.saveReason(tok, next));
    if (res.ok) onSaved(isNew ? t('Added the reason.') : t('Saved the reason.'));
  }
  const onSave = () => {
    setTried(true);
    if (!key || clash) return;
    if (row?.active && !active) setConfirm(true); else void save();
  };
  return (
    <ShellModal icon="list" title={isNew ? t('Add reason') : row.reason_id} subtitle={isNew ? t('Written exactly as it should be listed') : undefined} onClose={onClose} width={640} testid="reason-modal"
      footer={canEdit ? (<><button type="button" className="btn" onClick={onClose} disabled={busy}>{t('Cancel')}</button><button type="button" className="btn-primary" onClick={onSave} disabled={busy || !!clash} data-testid="save-reason">{busy ? t('Saving…') : t('Save')}</button></>) : <button type="button" className="btn" onClick={onClose}>{t('Close')}</button>}>
      {error && <div className="callout callout--danger" role="alert" data-testid="server-error"><Icon name="alert" size={16} /><span>{error}</span></div>}
      <fieldset disabled={!canEdit || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <FormSection icon="list" title={t('Reason')}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="rs-class">{t('Classification')}</label>
              <select id="rs-class" className="select" value={cls} disabled={!isNew} onChange={(e) => setCls(e.target.value as ClassificationCode)} data-testid="rs-class">
                {startup.classifications.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <span className="field-label">{t('Status')}</span>
              <ChipRow label={t('Status')}>
                <CountChip on={active} onClick={() => setActive(true)} testid="rs-active">{t('Active')}</CountChip>
                <CountChip on={!active} onClick={() => setActive(false)} testid="rs-inactive">{t('Inactive')}</CountChip>
              </ChipRow>
            </div>
            <div className={empty || clash ? 'field field--error span-2' : 'field span-2'}>
              <label htmlFor="rs-text">{t('Reason text')}</label>
              <input id="rs-text" className="input" value={text} onChange={(e) => setText(e.target.value)} data-testid="rs-text" />
              {text && <span className="field-hint" data-testid="rs-preview">{t('Shown as:')} <ListedText text={text} /></span>}
              {hasOddSpacing(text) && <span className="field-hint" data-testid="rs-spacing">{t('The text has extra spaces (marked ·). They are kept exactly as written. Matching ignores them.')}</span>}
              {empty && <span className="field-error" role="alert" data-testid="error-text">{t('Write the reason text.')}</span>}
              {clash && <span className="field-error" role="alert" data-testid="reason-duplicate">{t('Already listed for {c} as {id}: "{text}". The same words with different spaces or capital letters count as the same reason.', { c: cls, id: clash.reason_id, text: clash.text_as_listed.trim() })}</span>}
            </div>
          </div>
        </FormSection>
      </fieldset>
      {confirm && (
        <ConfirmDialog title={t('Make this reason inactive?')} danger confirmLabel={t('Make inactive')} busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void save(); }}>
          {t('Events that already use it keep it. Rows uploaded later with this text will be flagged as "reason not in the list".')}
        </ConfirmDialog>
      )}
    </ShellModal>
  );
}

export default function ReasonsTab({ startup, canEdit, reload, toast }: TabProps) {
  const [filter, setFilter] = useState<'' | ClassificationCode>('');
  const [editing, setEditing] = useState<{ row: Reason | null; code: ClassificationCode } | null>(null);
  const groups = useMemo(() => startup.classifications.map((c) => ({ c, items: startup.reasons.filter((r) => r.classification === c.code).sort((a, b) => a.order_no - b.order_no) })), [startup]);
  const dupes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of startup.reasons) { const k = `${r.classification}|${matchKey(r.text_as_listed)}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
    return (r: Reason) => (seen.get(`${r.classification}|${matchKey(r.text_as_listed)}`) ?? 0) > 1;
  }, [startup.reasons]);
  const shown = groups.filter((g) => !filter || g.c.code === filter);
  return (
    <>
      <div className="adm-toolbar">
        <div className="field adm-grow">
          <span className="field-label">{t('Classification')}</span>
          <ChipRow label={t('Classification')}>
            <CountChip on={filter === ''} onClick={() => setFilter('')} count={startup.reasons.length} testid="reasons-all">{t('All')}</CountChip>
            {groups.map((g) => <CountChip key={g.c.code} on={filter === g.c.code} onClick={() => setFilter(g.c.code)} count={g.items.length} testid={`reasons-${g.c.code}`}>{g.c.code}</CountChip>)}
          </ChipRow>
        </div>
        {canEdit && <div className="adm-toolbar-actions"><button type="button" className="btn-primary" onClick={() => setEditing({ row: null, code: filter || 'MEC' })} data-testid="add-reason"><Icon name="plus" size={15} /> {t('Add reason')}</button></div>}
      </div>
      <p className="adm-note">{t('Reasons are shown exactly as listed. A space at the start or end is drawn as a marked dot, because it is part of the listed text.')}</p>
      {shown.map(({ c, items }) => (
        <section key={c.code} className="card" data-testid={`reasons-group-${c.code}`}>
          <h2>{c.code} · {c.name} <span className="badge" style={{ marginInlineStart: 6 }}>{items.length}</span></h2>
          {items.length === 0 ? <p className="adm-note">{t('No reasons listed.')}</p> : (
            <ul className="up-list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((r) => (
                <li key={r.reason_id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 10px', border: '1px solid var(--tk-border2)', borderRadius: 8, background: 'var(--tk-card-sub-bg)' }} data-testid="reason-row" data-reason={r.reason_id}>
                  <span style={{ flex: '1 1 120px', minWidth: 0, overflowWrap: 'anywhere' }}><ListedText text={r.text_as_listed} /> <span className="adm-muted-sm mono">{r.reason_id}</span></span>
                  {dupes(r) && <span className="badge badge--warning" data-testid="badge-duplicate"><span aria-hidden="true">▲</span> {t('Duplicate')}</span>}
                  {r.active ? <span className="badge badge--success"><span aria-hidden="true">●</span> {t('Active')}</span> : <span className="badge"><span aria-hidden="true">⊘</span> {t('Inactive')}</span>}
                  <button type="button" className="btn btn-sm" onClick={() => setEditing({ row: r, code: r.classification })} aria-label={t('{what} {id}', { what: canEdit ? t('Edit') : t('Open'), id: r.reason_id })} data-testid="reason-open">{canEdit ? t('Edit') : t('Open')}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {editing && <ReasonModal row={editing.row} startCode={editing.code} startup={startup} canEdit={canEdit} onClose={() => setEditing(null)} onSaved={(s) => { setEditing(null); toast(s); void reload(); }} />}
    </>
  );
}
