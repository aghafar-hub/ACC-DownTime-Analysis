import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import { useBackClose } from '../mobile/useBackClose';
import './PopMenu.css';

// The "⋯" actions menu of a table row. Its panel is drawn on <body> at the button (a table box scrolls sideways and
// would clip a panel drawn inside it), right-aligned to the button, above it when there is no room below. Closes with
// Escape, Back, a click outside and when an item is chosen (it follows the button while the page scrolls); focus goes
// back to the button.
// Items are PopMenu's MenuItem (44 px high).
export default function RowMenu({ label, testid, children }: { label: string; testid: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, '');
  const close = useCallback(() => {
    setOpen(false);
    btn.current?.focus({ preventScroll: true });
  }, []);
  useBackClose(open, close);

  // placed at the button, and kept there while the page scrolls or the window changes
  const place = useCallback(() => {
    if (!btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = panel.current?.offsetHeight ?? 160;
    const up = r.bottom + h + 12 > window.innerHeight && r.top - h - 12 > 0;
    const next = { top: Math.round(up ? r.top - h - 6 : r.bottom + 6), right: Math.round(Math.max(12, document.documentElement.clientWidth - r.right)), up };
    setPos((cur) => (cur && cur.top === next.top && cur.right === next.right && cur.up === next.up ? cur : next));
  }, []);
  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: Event) => {
      const n = e.target as Node;
      if (!panel.current?.contains(n) && !btn.current?.contains(n)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onScroll = () => place();
    document.addEventListener('pointerdown', onDoc);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
    };
  }, [open, close, place]);

  // the first item takes focus once the panel is placed (a hidden panel cannot take it)
  const placed = pos !== null;
  useEffect(() => {
    if (open && placed) panel.current?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus({ preventScroll: true });
  }, [open, placed]);

  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]!.focus();
  };

  return (
    <>
      <button
        type="button" ref={btn} className="btn btn-sm row-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `rm-${id}` : undefined}
        aria-label={label} title={label} onClick={() => setOpen((v) => !v)} data-testid={testid}
      >
        <Icon name="more" size={18} />
      </button>
      {open && createPortal(
        <div
          id={`rm-${id}`} ref={panel} role="menu" aria-label={label} className="pm-panel pm-panel--menu row-menu-panel" onKeyDown={onPanelKey} data-testid={`${testid}-panel`}
          style={{ position: 'fixed', top: pos?.top ?? -9999, right: pos?.right ?? 0, left: 'auto', visibility: pos ? 'visible' : 'hidden' }}
        >
          {children(close)}
        </div>,
        document.body,
      )}
    </>
  );
}
