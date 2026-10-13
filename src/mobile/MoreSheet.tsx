import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { tapHaptic } from '../haptics';
import { useVisiblePages } from '../hooks/useVisiblePages';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { pageLabel, pagesInSection, ROLE_LABELS, SECTIONS, sectionLabel } from '../navigation';
import ValidateBadge from '../validate/NavBadge';
import { useBackClose } from './useBackClose';
import './mobile.css';

export const OPEN_MORE_EVENT = 'acc-dt-open-more';

// The phone's "More" (bottom bar): search the pages, every page you may open
// as a tile (with View or Edit under its name), the account in one row, and
// Sign out. Settings (with Appearance and Users) is the gear in the header. Back closes it.
export default function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout, levelOf } = useAuth();
  const navigate = useNavigate();
  const pages = useVisiblePages();
  const [q, setQ] = useState('');
  useEffect(() => {
    if (open) setQ('');
  }, [open]);
  useBackClose(open, onClose);
  if (!open) return null;

  const term = q.trim().toLowerCase();
  const hits = term ? pages.filter((p) => pageLabel(p).toLowerCase().includes(term)) : pages;
  const go = (path: string) => {
    tapHaptic();
    onClose();
    navigate(path);
  };
  const name = user?.display_name || user?.email || '';
  const initials = (name.match(/\b\w/g) || ['?']).slice(0, 2).join('').toUpperCase();
  const role = user ? t(ROLE_LABELS[user.role_id] || user.role_id) : '';
  const tile = (p: (typeof pages)[number]) => (
    <button key={p.id} type="button" className="more-tile" onClick={() => go(p.path)} data-preload={p.path} data-testid={`more-tile-${p.id}`}>
      <span className="more-tile-icon more-tile-icon--other"><Icon name={p.icon} size={22} /></span>
      <b>{pageLabel(p)} {p.id === 'validate' && <ValidateBadge testid="validate-badge-more" />}</b>
      <small>{levelOf(p.access) === 'Edit' ? t('Can edit') : t('View only')}</small>
    </button>
  );
  const sections = SECTIONS.map((sec) => ({ sec, items: pagesInSection(hits, sec.id) })).filter((g) => g.items.length > 0);

  return (
    <>
      <div className="module-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="module-sheet more-sheet" role="dialog" aria-modal="true" aria-label={t('More')} data-testid="more-sheet">
        <div className="module-sheet-grab" aria-hidden="true" />
        <div className="more-hub">
          <label className="more-search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search pages')} aria-label={t('Search pages')} data-testid="more-search" />
          </label>
          {sections.map(({ sec, items }) => (
            <section key={sec.id} className="more-group" aria-labelledby={`more-sec-${sec.id}`} data-section={sec.id}>
              <h2 className="more-group-title" id={`more-sec-${sec.id}`} data-testid={`more-section-${sec.id}`}>{sectionLabel(sec.id)}</h2>
              <div className="more-tiles">{items.map(tile)}</div>
            </section>
          ))}
          {hits.length === 0 && <p className="more-muted more-empty">{t('Nothing found.')}</p>}

          <div className="more-account">
            <span className="more-avatar">{initials}</span>
            <span className="more-account-text">
              <b data-testid="more-name">{name}</b>
              <span data-testid="more-role">{role}</span>
            </span>
          </div>
          <div className="more-account-actions" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            <button type="button" className="more-action more-signout" onClick={() => { onClose(); logout(); }} data-testid="more-logout">
              <Icon name="logout" size={18} />
              {t('Sign out')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
