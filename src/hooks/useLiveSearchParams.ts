// useSearchParams with a setter that starts from the address as it is NOW. Location updates render in a transition, so
// two quick changes (two chips clicked fast) would both start from the same rendered query and the second would drop
// the first, even with the functional form of setSearchParams. The hash is written at once, so reading it is current.
import { useCallback, useRef } from 'react';
import { useSearchParams, type NavigateOptions } from 'react-router-dom';

type Next = URLSearchParams | ((cur: URLSearchParams) => URLSearchParams);

/** The query of the address right now (hash routing), or null outside a hash route. */
export function liveSearch(): URLSearchParams | null {
  const h = window.location.hash;
  if (!h.startsWith('#/')) return null;
  const i = h.indexOf('?');
  return new URLSearchParams(i < 0 ? '' : h.slice(i + 1));
}

export function useLiveSearchParams(): [URLSearchParams, (next: Next, options?: NavigateOptions) => void] {
  const [sp, setSp] = useSearchParams();
  const ref = useRef(sp);
  ref.current = sp;
  const set = useCallback((next: Next, options?: NavigateOptions) => {
    const cur = liveSearch() ?? new URLSearchParams(ref.current);
    setSp(typeof next === 'function' ? next(cur) : next, options);
  }, [setSp]);
  return [sp, set];
}
