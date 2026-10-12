import { useEffect, useRef } from 'react';

// Phone back gesture / Android back button closes the top sheet, popup or
// panel instead of leaving the page. While `open`, one history entry is
// added for it; Back pops that entry and calls close(). Closing from the UI
// removes the entry again. Nested sheets form a stack: Back closes only
// the top one.
// One stack for the shell and the embedded module apps (separate bundles),
// kept on window so Back always closes only the sheet on top.
const w = window as unknown as { __accBackStack?: string[] };
const stack: string[] = (w.__accBackStack ||= []);

export function useBackClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const id = Math.random().toString(36).slice(2);
    stack.push(id);
    // a popup that just closed may still have its entry on top (its Back is
    // deferred): reuse that entry, so opening one popup straight after
    // another (e.g. Create route → the new route) doesn't get closed by it
    const cur = window.history.state?.accSheet;
    if (cur && !stack.slice(0, -1).includes(cur)) window.history.replaceState({ ...window.history.state, accSheet: id }, '');
    else window.history.pushState({ ...(window.history.state || {}), accSheet: id }, '');
    let popped = false;
    const onPop = () => {
      if (stack[stack.length - 1] !== id) return;
      // landed on our own entry: a nested popup (e.g. More → a module's
      // pages) just dropped its entry — this popup stays open
      if (window.history.state?.accSheet === id) return;
      popped = true;
      stack.pop();
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (popped) return;
      const at = stack.indexOf(id);
      if (at !== -1) stack.splice(at, 1);
      // closed from the UI: drop the entry we added (only if it's still on top)
      setTimeout(() => {
        if (window.history.state?.accSheet === id) window.history.back();
      }, 0);
    };
  }, [open]);
}
