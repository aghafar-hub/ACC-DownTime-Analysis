import { useCallback, useSyncExternalStore } from 'react';

/** True while the media query matches (re-renders when it changes). False when there is no window. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    const m = window.matchMedia(query);
    m.addEventListener('change', cb);
    return () => m.removeEventListener('change', cb);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Wide enough for the record drawer beside the Event records table (1100 px and up). */
export const DRAWER_QUERY = '(min-width: 1100px)';
