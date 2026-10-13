import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import { Icon } from '../icons';
import { useBackClose } from '../mobile/useBackClose';
import './PopMenu.css';

// A button that opens a small panel under it (a menu of actions, or a panel with a list and a field). The panel stays inside
// the screen (it is shifted sideways when it would stick out, so it fits a 360 px phone), closes with Escape, with Back, with a tap
// outside and when an item is chosen (for a menu), and gives focus back to the button. Items are 44 px high.
export interface PopMenuProps {
  label: string;
  icon?: string;
  testid: string;
  /** 'menu': a list of actions; 'dialog': a panel with its own controls (stays open until closed) */
  kind?: 'menu' | 'dialog';
  disabled?: boolean;
  /** extra words for assistive technology on the button */
  hint?: string;
  /** a count shown on the button, such as the number of saved views */
  count?: number;
  buttonClass?: string;
  children: (close: () => void) => ReactNode;
}

export default function PopMenu({ label, icon, testid, kind = 'menu', disabled, hint, count, buttonClass = 'btn', children }: PopMenuProps) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  // where the panel goes: under the button, or above it when there is more room there; its height is limited to the room it has
  const [place, setPlace] = useState<{ up: boolean; maxH: number | null }>({ up: false, maxH: null });
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, '');
  const close = useCallback(() => {
    setOpen(false);
    btn.current?.focus({ preventScroll: true });
  }, []);
  // the phone's Back closes the open panel instead of leaving the page
  useBackClose(open, close);

  useEffect(() => {
    if (!open) return undefined;
    // a dialog opened from inside the panel (for example 'Delete this view?') is drawn on <body>: it belongs to the panel
    const inDialog = (n: EventTarget | null): boolean => n instanceof Element && !!n.closest('.sm-shade');
    const onDoc = (e: Event) => wrap.current && e.target instanceof Node && !wrap.current.contains(e.target) && !inDialog(e.target) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.sm-shade')) {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // keep the panel inside the screen (re-measured when the panel grows or the window turns)
  useLayoutEffect(() => {
    if (!open) return undefined;
    const fit = () => {
      const p = panel.current;
      const w = wrap.current;
      if (!p || !w) return;
      const margin = 12;
      const vw = document.documentElement.clientWidth;
      const box = w.getBoundingClientRect();
      const width = p.offsetWidth;
      let x = 0;
      if (box.left + width > vw - margin) x = vw - margin - width - box.left;
      if (box.left + x < margin) x = margin - box.left;
      setShift(Math.round(x));
      // room below (the phone's bottom bar is about 72 px) and above (the top bar is about 60 px)
      const below = window.innerHeight - box.bottom - (window.innerWidth <= 860 ? 80 : 16);
      const above = box.top - 68;
      const natural = p.scrollHeight + 18;
      const up = natural > below && above > below;
      const room = Math.max(160, (up ? above : below) - 6);
      setPlace((cur) => (cur.up === up && cur.maxH === room ? cur : { up, maxH: room }));
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' && panel.current ? new ResizeObserver(fit) : null;
    if (ro && panel.current) ro.observe(panel.current);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit);
      ro?.disconnect();
    };
  }, [open]);

  // a menu takes focus to its first item so the arrow keys work
  useEffect(() => {
    if (open && kind === 'menu') panel.current?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus({ preventScroll: true });
  }, [open, kind]);

  const onPanelKey = (e: React.KeyboardEvent) => {
    if (kind !== 'menu' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]!.focus();
  };

  return (
    <div className="pm" ref={wrap}>
      <button
        type="button" ref={btn} className={buttonClass} disabled={disabled} aria-haspopup={kind === 'menu' ? 'menu' : 'dialog'} aria-expanded={open}
        aria-controls={open ? `pm-${id}` : undefined} aria-label={hint ? `${label}. ${hint}` : undefined} onClick={() => setOpen((v) => !v)} data-testid={testid}
      >
        {icon && <Icon name={icon} size={16} />} {label}
        {count !== undefined && count > 0 && <span className="pm-count" aria-hidden="true">{count}</span>}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
      </button>
      {open && (
        <div
          id={`pm-${id}`} ref={panel} className={kind === 'menu' ? 'pm-panel pm-panel--menu' : 'pm-panel'} style={{ left: shift, maxHeight: place.maxH ?? undefined, ...(place.up ? { top: 'auto', bottom: 'calc(100% + 6px)' } : null) }}
          role={kind === 'menu' ? 'menu' : 'dialog'} aria-label={label} onKeyDown={onPanelKey} data-testid={`${testid}-panel`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** One action of a menu: 44 px high, with an optional second line. */
export function MenuItem({ children, sub, onClick, disabled, testid }: { children: ReactNode; sub?: string; onClick: () => void; disabled?: boolean; testid?: string }) {
  return (
    <button type="button" role="menuitem" className="pm-item" onClick={onClick} disabled={disabled} data-testid={testid}>
      <span className="pm-item-main">{children}</span>
      {sub && <small>{sub}</small>}
    </button>
  );
}

export const MenuHeading = ({ children }: { children: ReactNode }) => <p className="pm-heading" role="presentation">{children}</p>;
export const closeLabel = (): string => t('Close');
