import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// The shell keeps one sticky place under the top bar for the page's scope bar (ScopeBar.tsx). A page draws its bar into
// it with <InScopeSlot>, so the bar spans the page and stays in view while the page scrolls.
export const ScopeSlotContext = createContext<HTMLElement | null>(null);

export function InScopeSlot({ children }: { children: ReactNode }) {
  const slot = useContext(ScopeSlotContext);
  return slot ? createPortal(children, slot) : null;
}
