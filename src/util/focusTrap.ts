// Keeps keyboard focus inside a dialog: Tab from the last control goes to the first, Shift+Tab from the first to the
// last, and a Tab while focus is on the dialog box itself (or has left it) goes to the first or last control.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The controls Tab can reach inside `root`, in order (hidden ones left out). */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.closest('[inert]'));
}

/** Call from a keydown handler; returns true when it moved the focus. */
export function trapTab(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>, root: HTMLElement | null): boolean {
  if (e.key !== 'Tab' || !root) return false;
  const list = focusables(root);
  if (list.length === 0) {
    e.preventDefault();
    root.focus();
    return true;
  }
  const first = list[0]!;
  const last = list[list.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  const inside = !!active && root.contains(active) && active !== root;
  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
