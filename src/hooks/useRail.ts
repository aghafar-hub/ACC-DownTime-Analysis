import { useCallback, useSyncExternalStore } from 'react';
import { store } from '../storagePrefix';

// The desktop left rail. At 1280 px and wider it is pinned open with labels (232 px) unless the person chose
// "Collapse menu"; that choice is kept on this device. Narrower (861-1279 px), or collapsed, it is the 68 px icon
// rail, and hovering or focusing it opens the labels OVER the page (the page never moves).
export const RAIL_WIDE_QUERY = '(min-width: 1280px)';
const KEY = 'rail_collapsed';

let collapsed: boolean | null = null;
const listeners = new Set<() => void>();

function readCollapsed(): boolean {
  if (collapsed === null) collapsed = store.get(KEY) === '1';
  return collapsed;
}

function subscribeCollapsed(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function subscribeWide(cb: () => void) {
  const m = window.matchMedia(RAIL_WIDE_QUERY);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}

export function setRailCollapsed(next: boolean): void {
  collapsed = next;
  if (next) store.set(KEY, '1');
  else store.remove(KEY);
  listeners.forEach((l) => l());
}

export interface RailState {
  /** the screen is wide enough for the labelled rail */
  wide: boolean;
  /** the person chose the icon rail */
  collapsed: boolean;
  /** the labelled rail is pinned open (wide and not collapsed) */
  pinned: boolean;
  toggle: () => void;
}

export function useRail(): RailState {
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(RAIL_WIDE_QUERY).matches, () => true);
  const isCollapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const toggle = useCallback(() => setRailCollapsed(!readCollapsed()), []);
  return { wide, collapsed: isCollapsed, pinned: wide && !isCollapsed, toggle };
}
