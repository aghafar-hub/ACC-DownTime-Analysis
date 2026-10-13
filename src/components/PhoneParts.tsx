import type { ReactNode } from 'react';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useBackClose } from '../mobile/useBackClose';
import './ui.css';

// Shared phone parts, used by every list page so they read the same:
// a row of chips, a Filters pill that opens a bottom sheet, and
// "Show 50 more" for long lists.
export const PAGE_SIZE = 50;

export function ChipRow({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="chip-row" role="group" aria-label={label}>{children}</div>;
}

/** Round chip, optionally with a count. Accent fill when on. */
export function CountChip({ on, onClick, children, count, testid }: { on?: boolean; onClick: () => void; children: ReactNode; count?: number | string; testid?: string }) {
  return (
    <button type="button" className={on ? 'chip chip--on' : 'chip'} aria-pressed={!!on} onClick={onClick} data-testid={testid}>
      {children}
      {count != null && <b>{count}</b>}
    </button>
  );
}

/** "Filters · 2" pill that opens the filter sheet. */
export function FiltersPill({ count = 0, onClick, testid, label }: { count?: number; onClick: () => void; testid?: string; label?: string }) {
  return (
    <button type="button" className={count ? 'chip chip--filters chip--on' : 'chip chip--filters'} onClick={onClick} data-testid={testid} aria-haspopup="dialog">
      <Icon name="filter" size={14} /> {label ?? t('Filters')}{count ? ` · ${count}` : ''}
    </button>
  );
}

/** "Show 50 more · 120 left" under a long list. */
export function ShowMore({ shown, total, onMore, testid = 'show-more' }: { shown: number; total: number; onMore: () => void; testid?: string }) {
  if (shown >= total) return null;
  const left = total - shown;
  return (
    <button type="button" className="show-more" onClick={onMore} data-testid={testid}>
      {t('Show {n} more', { n: Math.min(PAGE_SIZE, left) })} · {t('{n} left', { n: left })}
    </button>
  );
}

/** Bottom sheet: grab bar, title (with an optional '2 active' badge and a close button), scrolling body, footer buttons. Back closes it. */
export function BottomSheet({ title, onClose, footer, children, testid, badge, withClose }: {
  title: string; onClose: () => void; footer?: ReactNode; children: ReactNode; testid?: string; badge?: string; withClose?: boolean;
}) {
  useBackClose(true, onClose);
  return (
    <>
      <div className="module-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="module-sheet bottom-sheet" role="dialog" aria-modal="true" aria-label={title} data-testid={testid}>
        <div className="module-sheet-grab" aria-hidden="true" />
        {badge || withClose ? (
          <div className="bottom-sheet-head">
            <p className="module-sheet-title">{title}</p>
            {badge && <span className="bottom-sheet-badge">{badge}</span>}
            {withClose && <button type="button" className="bottom-sheet-close" onClick={onClose} aria-label={t('Close')} data-testid={testid ? `${testid}-close` : undefined}><Icon name="close" size={20} /></button>}
          </div>
        ) : <p className="module-sheet-title">{title}</p>}
        <div className="bottom-sheet-body">{children}</div>
        {footer && <div className="bottom-sheet-foot">{footer}</div>}
      </div>
    </>
  );
}
