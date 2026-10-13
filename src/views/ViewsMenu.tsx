// The 'Views' button next to the filter bar: the person's saved views for this page (apply, rename, delete) and
// 'Save current filters as view'. A view is a name and the page's filter query; applying one navigates to the page with
// that query. Stored in the preference `saved_views` (src/views/savedViews.ts).
import { useRef, useState } from 'react';
import ConfirmDialog from '../admin/ConfirmDialog';
import PopMenu from '../components/PopMenu';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import {
  SAVED_VIEWS_MAX, SAVED_VIEW_NAME_MAX, viewNameError, viewsForPage, type SavedView, type ViewPage,
} from './savedViews';
import { useSavedViews } from './useSavedViews';
import './views.css';

export default function ViewsMenu({ page, currentQuery, onApply }: {
  page: ViewPage;
  /** the query that describes the filters on screen now */
  currentQuery: () => string;
  onApply: (view: SavedView) => void;
}) {
  const views = useSavedViews();
  const mine = viewsForPage(views.list, page);
  return (
    <PopMenu label={t('Views')} icon="bookmark" kind="dialog" testid="views-btn" count={mine.length} hint={t('{n} saved on this page', { n: mine.length })}>
      {(close) => <Panel page={page} views={views} mine={mine} currentQuery={currentQuery} onApply={(v) => { onApply(v); close(); }} />}
    </PopMenu>
  );
}

function Panel({ page, views, mine, currentQuery, onApply }: {
  page: ViewPage; views: ReturnType<typeof useSavedViews>; mine: SavedView[]; currentQuery: () => string; onApply: (v: SavedView) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState<SavedView | null>(null);
  const [editError, setEditError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const total = views.list.length;
  const full = total >= SAVED_VIEWS_MAX;

  const save = async () => {
    setNote('');
    const local = viewNameError(name, views.list, page);
    if (local) { setError(t(local)); nameRef.current?.focus(); return; }
    setBusy(true);
    const r = await views.save({ name, page, query: currentQuery() });
    setBusy(false);
    if (!r.ok) { setError(t(r.error)); return; }
    setError('');
    setName('');
    setNote(t('Saved the view "{n}".', { n: r.item?.name ?? name.trim() }));
  };
  const startRename = (v: SavedView) => { setEditing(v.id); setDraft(v.name); setEditError(''); setNote(''); };
  const rename = async (v: SavedView) => {
    const local = viewNameError(draft, views.list, page, v.id);
    if (local) { setEditError(t(local)); return; }
    setBusy(true);
    const r = await views.rename(v.id, draft);
    setBusy(false);
    if (!r.ok) { setEditError(t(r.error)); return; }
    setEditing(null);
    setNote(t('Renamed to "{n}".', { n: draft.trim() }));
  };
  const remove = async (v: SavedView) => {
    setBusy(true);
    const r = await views.remove(v.id);
    setBusy(false);
    setConfirm(null);
    setNote(r.ok ? t('Deleted the view "{n}".', { n: v.name }) : t(r.error));
  };

  return (
    <div className="vw" data-testid="views-panel-body">
      <p className="pm-heading" role="presentation">{t('Saved views on this page')}</p>
      {!views.loaded && <p className="pm-note" role="status" data-testid="views-loading">{views.failed ? t('Your saved views could not be loaded. Check the connection and try again.') : t('Loading your saved views…')}</p>}
      {views.loaded && mine.length === 0 && <p className="pm-note" data-testid="views-empty">{t('No saved views yet. Set the filters you want, then save them below.')}</p>}
      <ul className="vw-list" data-testid="views-list">
        {mine.map((v) => (
          <li key={v.id} className="vw-row" data-testid="views-row">
            {editing === v.id ? (
              <form className="vw-edit" onSubmit={(e) => { e.preventDefault(); void rename(v); }}>
                <label className="vw-label" htmlFor={`vw-rn-${v.id}`}>{t('New name')}</label>
                <input id={`vw-rn-${v.id}`} className="input" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus autoComplete="off" aria-invalid={!!editError} data-testid="views-rename-input" />
                {editError && <p className="vw-error" role="alert" data-testid="views-rename-error">{editError}</p>}
                <div className="vw-actions">
                  <button type="submit" className="btn-primary" disabled={busy} data-testid="views-rename-save">{t('Save name')}</button>
                  <button type="button" className="btn" onClick={() => setEditing(null)} data-testid="views-rename-cancel">{t('Cancel')}</button>
                </div>
              </form>
            ) : (
              <>
                <button type="button" className="vw-apply" onClick={() => onApply(v)} data-testid="views-apply" title={t('Apply this view')}>
                  <span className="vw-name">{v.name}</span>
                  <small>{t('Apply')}</small>
                </button>
                <button type="button" className="vw-icon" onClick={() => startRename(v)} aria-label={t('Rename {n}', { n: v.name })} data-testid="views-rename"><Icon name="edit" size={16} /></button>
                <button type="button" className="vw-icon" onClick={() => setConfirm(v)} aria-label={t('Delete {n}', { n: v.name })} data-testid="views-delete"><Icon name="trash" size={16} /></button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="vw-save" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <p className="pm-heading" role="presentation">{t('Save current filters as view')}</p>
        <label className="vw-label" htmlFor="vw-name">{t('View name')}</label>
        <input
          id="vw-name" ref={nameRef} className="input" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder={t('For example: Crushing, last 30 days')}
          autoComplete="off" aria-invalid={!!error} aria-describedby="vw-hint" data-testid="views-name"
        />
        <p id="vw-hint" className="vw-hint" data-testid="views-count">{t('{n} of {m} views saved (all pages). Name: 1 to {l} characters.', { n: total, m: SAVED_VIEWS_MAX, l: SAVED_VIEW_NAME_MAX })}</p>
        {full && !error && <p className="vw-error" role="status" data-testid="views-full">{t('You have saved {m} views, the most you can keep. Delete one to save another.', { m: SAVED_VIEWS_MAX })}</p>}
        {error && <p className="vw-error" role="alert" data-testid="views-error">{error}</p>}
        <button type="submit" className="btn-primary vw-submit" disabled={busy || !views.loaded} data-testid="views-save">
          <Icon name="bookmark" size={16} /> {busy ? t('Saving…') : t('Save current filters as view')}
        </button>
      </form>
      <p className="vw-status" role="status" aria-live="polite" data-testid="views-note">{note}</p>
      {confirm && (
        <ConfirmDialog
          title={t('Delete this view?')} confirmLabel={t('Delete view')} danger busy={busy} testid="views-confirm"
          onConfirm={() => void remove(confirm)} onCancel={() => setConfirm(null)}
        >
          {t('"{n}" will be removed from your saved views. The filters on screen do not change.', { n: confirm.name })}
        </ConfirmDialog>
      )}
    </div>
  );
}
