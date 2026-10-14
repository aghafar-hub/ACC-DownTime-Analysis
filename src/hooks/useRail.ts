import { store } from '../storagePrefix';

// The desktop left rail: always the 68 px icon rail. Hovering or keyboard-focusing it opens the labels OVER the page
// (the page never moves) and it closes again by itself when the pointer or focus leaves; there is no pin or collapse
// button (owner decision). The pinned 232 px mode is kept in the CSS but no longer used.

// the old "Collapse menu" choice is no longer read; drop it from the device
try { store.remove('rail_collapsed'); } catch { /* storage unavailable */ }

export interface RailState {
  /** the labelled rail is pinned open (never, since the rail collapses by itself) */
  pinned: boolean;
}

export function useRail(): RailState {
  return { pinned: false };
}
