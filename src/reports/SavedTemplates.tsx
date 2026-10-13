// The person's saved report templates in the builder: a chip for each (after the ready-made ones) that applies it, and
// Save as template / Rename / Delete with a name dialog and a confirmation. Stored through the `saved_reports`
// preference (src/reports/useSavedTemplates.ts); a template keeps the period preset, filters, sections and options.
import { useId, useState, type ReactNode } from 'react';
import ConfirmDialog from '../admin/ConfirmDialog';
import { CountChip } from '../components/PhoneParts';
import ShellModal from '../components/ShellModal';
import type { SavedReportTemplate } from '../api/types';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { SAVED_REPORTS_MAX, TEMPLATE_NAME_MAX, templateNameError } from './savedTemplates';
import { fromSavedTemplate, setupsEqual, type ReportSetup } from './setup';
import { useSavedTemplates } from './useSavedTemplates';

type Dialog = { kind: 'save' } | { kind: 'rename'; id: string } | { kind: 'delete'; id: string } | null;

export interface TemplateUi {
  /** the chips of the saved templates (put them after the ready-made chips) */
  chips: ReactNode;
  /** Save as template / Rename / Delete, the count, messages and the dialogs */
  actions: ReactNode;
  /** a saved template is the one on screen (the ready-made chips switch off) */
  active: boolean;
}

export function useTemplateUi(setup: ReportSetup, onChange: (next: ReportSetup) => void): TemplateUi {
  const store = useSavedTemplates();
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const list = store.list;
  const sel = list.find((x) => x.id === selected) ?? null;
  const activeId = sel && setupsEqual(setup, fromSavedTemplate(sel)) ? sel.id : null;
  const full = list.length >= SAVED_REPORTS_MAX;

  const apply = (x: SavedReportTemplate) => {
    setSelected(x.id);
    setNote(null);
    onChange(fromSavedTemplate(x));
  };
  const openSave = () => {
    if (full) { setNote({ text: t('You have saved {m} templates, the most you can keep. Delete one to save another.', { m: SAVED_REPORTS_MAX }), bad: true }); return; }
    setNote(null);
    setDialog({ kind: 'save' });
  };

  const chips = list.map((x) => (
    <CountChip key={x.id} on={activeId === x.id} onClick={() => apply(x)} testid={`rb-saved-${x.id}`}>
      <Icon name="bookmark" size={13} /> {x.name}
    </CountChip>
  ));

  const target = dialog && 'id' in dialog ? list.find((x) => x.id === dialog.id) ?? null : null;

  const actions = (
    <div className="tpl" data-testid="rb-saved">
      <div className="tpl-bar">
        <button type="button" className="btn" onClick={openSave} disabled={!store.loaded} aria-describedby="tpl-count" data-testid="rb-save-template">
          <Icon name="bookmark" size={16} /> {t('Save as template')}
        </button>
        {sel && (
          <>
            <button type="button" className="btn" onClick={() => { setNote(null); setDialog({ kind: 'rename', id: sel.id }); }} aria-label={t('Rename template {n}', { n: sel.name })} data-testid="rb-rename-template">
              <Icon name="edit" size={16} /> {t('Rename')}
            </button>
            <button type="button" className="btn" onClick={() => { setNote(null); setDialog({ kind: 'delete', id: sel.id }); }} aria-label={t('Delete template {n}', { n: sel.name })} data-testid="rb-delete-template">
              <Icon name="trash" size={16} /> {t('Delete')}
            </button>
          </>
        )}
      </div>
      <p id="tpl-count" className="rb-hint" data-testid="rb-template-count">
        {store.loaded ? t('{n} of {m} templates saved. A template keeps the period (Last full month stays relative), filters, sections and options.', { n: list.length, m: SAVED_REPORTS_MAX }) : t('Loading your saved templates…')}
      </p>
      <p className={note?.bad ? 'tpl-note tpl-note--bad' : 'tpl-note'} role={note?.bad ? 'alert' : 'status'} aria-live="polite" data-testid="rb-template-note">{note?.text ?? ''}</p>

      {dialog?.kind === 'save' && (
        <NameDialog
          title={t('Save as template')} confirmLabel={t('Save template')} initial="" busy={busy} list={list} testid="rb-name-dialog"
          onCancel={() => setDialog(null)}
          onSubmit={async (name) => {
            setBusy(true);
            const r = await store.save(setup, name);
            setBusy(false);
            if (!r.ok) return t(r.error);
            setDialog(null);
            if (r.item) setSelected(r.item.id);
            setNote({ text: t('Saved the template "{n}".', { n: r.item?.name ?? name.trim() }), bad: false });
            return null;
          }}
        />
      )}
      {dialog?.kind === 'rename' && target && (
        <NameDialog
          title={t('Rename template')} confirmLabel={t('Save name')} initial={target.name} exceptId={target.id} busy={busy} list={list} testid="rb-name-dialog"
          onCancel={() => setDialog(null)}
          onSubmit={async (name) => {
            setBusy(true);
            const r = await store.rename(target.id, name);
            setBusy(false);
            if (!r.ok) return t(r.error);
            setDialog(null);
            setNote({ text: t('Renamed to "{n}".', { n: name.trim() }), bad: false });
            return null;
          }}
        />
      )}
      {dialog?.kind === 'delete' && target && (
        <ConfirmDialog
          title={t('Delete this template?')} confirmLabel={t('Delete template')} danger busy={busy} testid="rb-delete-dialog"
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            setBusy(true);
            const r = await store.remove(target.id);
            setBusy(false);
            setDialog(null);
            if (r.ok) {
              setSelected((cur) => (cur === target.id ? null : cur));
              setNote({ text: t('Deleted the template "{n}".', { n: target.name }), bad: false });
            } else setNote({ text: t(r.error), bad: true });
          }}
        >
          {t('"{n}" will be removed from your saved templates. The report setup on screen does not change.', { n: target.name })}
        </ConfirmDialog>
      )}
    </div>
  );
  return { chips: <>{chips}</>, actions, active: activeId !== null };
}

function NameDialog({ title, confirmLabel, initial, exceptId, busy, list, testid, onCancel, onSubmit }: {
  title: string; confirmLabel: string; initial: string; exceptId?: string; busy: boolean; list: readonly SavedReportTemplate[]; testid: string;
  onCancel: () => void; onSubmit: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState('');
  const uid = useId().replace(/:/g, '');
  const submit = async () => {
    const local = templateNameError(name, list, exceptId);
    if (local) { setError(t(local)); return; }
    const server = await onSubmit(name);
    if (server) setError(server);
  };
  const formId = `tpl-form-${uid}`;
  return (
    <ShellModal
      icon="bookmark" title={title} onClose={onCancel} width={460} testid={testid}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy} data-testid="rb-name-cancel">{t('Cancel')}</button>
          <button type="submit" form={formId} className="btn-primary" disabled={busy} data-testid="rb-name-save">{busy ? t('Saving…') : confirmLabel}</button>
        </>
      }
    >
      <form id={formId} className="tpl-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="tpl-label" htmlFor={`tpl-name-${uid}`}>{t('Template name')}</label>
        <input
          id={`tpl-name-${uid}`} className="input tpl-input" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} autoFocus autoComplete="off"
          aria-invalid={!!error} aria-describedby={`tpl-hint-${uid}`} placeholder={t('For example: Crushing monthly review')} data-testid="rb-name-input"
        />
        <p id={`tpl-hint-${uid}`} className="rb-hint">{t('1 to {m} characters, different from your other templates.', { m: TEMPLATE_NAME_MAX })} <span data-testid="rb-name-length">{name.trim().length}/{TEMPLATE_NAME_MAX}</span></p>
        {error && <p className="tpl-note tpl-note--bad" role="alert" data-testid="rb-name-error">{error}</p>}
      </form>
    </ShellModal>
  );
}
