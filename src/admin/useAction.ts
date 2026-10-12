import { useCallback, useRef, useState } from 'react';
import { describeError } from '../api';
import { useAuth } from '../auth/AuthContext';

/** Runs one save: tracks "saving", keeps the plain-English error, never runs two at once. */
export function useAction() {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const run = useCallback(async <T,>(fn: (token: string) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
    if (!token || running.current) return { ok: false };
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      return { ok: true, value: await fn(token) };
    } catch (err) {
      setError(describeError(err));
      return { ok: false };
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [token]);
  return { run, busy, error, setError };
}

export interface TabProps {
  startup: import('../api/types').Startup;
  canEdit: boolean;
  /** reload the master data from the server, resolves when done */
  reload: () => Promise<void> | void;
  toast: (text: string) => void;
}
