import { useSyncExternalStore } from 'react';

// The phone breakpoint is 860 px everywhere (CSS media queries use the same).
const QUERY = '(max-width: 860px)';

function subscribe(cb: () => void) {
  const m = window.matchMedia(QUERY);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
