import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// The shell keeps one sticky place under the top bar for the page's scope bar (ScopeBar.tsx). A page draws its bar into
// it with <InScopeSlot>, so the bar spans the page and stays in view while the page scrolls.
// Two places: the sticky row of chips, and under it (scrolling with the page) the note, the range and the active filters.
export interface ScopeSlots { bar: HTMLElement | null; info: HTMLElement | null }
export const ScopeSlotContext = createContext<ScopeSlots>({ bar: null, info: null });

export function InScopeSlot({ children, info }: { children: ReactNode; info?: boolean }) {
  const slots = useContext(ScopeSlotContext);
  const slot = info ? slots.info : slots.bar;
  return slot ? createPortal(children, slot) : null;
}
