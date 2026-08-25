import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errorMessage } from '../lib/api';

/**
 * Fetch-on-mount helper with a stale-response guard: if a filter changes while a
 * slower request is still in flight, the outdated payload is discarded instead of
 * overwriting fresher data.
 */
export function useFetch(url, { enabled = true, deps = [] } = {}) {
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const run = useCallback(async () => {
    if (!enabled || !url) return;
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const response = await api.get(url);
      if (id !== requestId.current) return;
      setData(response.data.data);
      setMeta(response.data.meta || null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(errorMessage(err));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [url, enabled]);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ...deps]);

  return { data, meta, loading, error, refetch: run, setData };
}

/** Debounces a rapidly changing value — used for the employee search box. */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
