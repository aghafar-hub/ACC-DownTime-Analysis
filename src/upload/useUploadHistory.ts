import { useCallback, useEffect, useState } from 'react';
import { api, describeError } from '../api';
import type { UploadBatch } from '../api/types';
import { useAuth } from '../auth/AuthContext';

/** The list of earlier uploads, newest first. */
export function useUploadHistory() {
  const { token } = useAuth();
  const [batches, setBatches] = useState<UploadBatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!token) return;
    setError(null);
    api.getUploadHistory(token).then(setBatches, (e) => setError(describeError(e)));
  }, [token]);
  useEffect(load, [load]);
  return { batches, error, reload: load };
}
