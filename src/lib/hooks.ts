import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, isAbort } from '../api/client';

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function useMediaQuery(q: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = window.matchMedia(q);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    [q],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(q).matches, () => false);
}

export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');

/** Width of an element, tracked with ResizeObserver (0 until measured). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver((entries) => {
      const cw = Math.round(entries[0].contentRect.width);
      setW((old) => (old === cw ? old : cw));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface RequestState<T> {
  data: T | null;
  /** The key the current `data` was fetched for. */
  dataKey: string | null;
  error: ApiError | null;
  loading: boolean;
  retry: () => void;
}

/**
 * Fetch whenever `key` changes. A new key aborts the request in flight, so a superseded
 * response can never overwrite a newer one. Previous data stays available while reloading.
 */
export function useRequest<T>(key: string | null, fn: (signal: AbortSignal) => Promise<T>): RequestState<T> {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [nonce, setNonce] = useState(0);
  const [st, setSt] = useState<Omit<RequestState<T>, 'retry'>>({
    data: null,
    dataKey: null,
    error: null,
    loading: key !== null,
  });

  useEffect(() => {
    if (key === null) {
      setSt((s) => ({ ...s, loading: false, error: null }));
      return;
    }
    const ac = new AbortController();
    setSt((s) => ({ ...s, loading: true, error: null }));
    fnRef.current(ac.signal).then(
      (data) => {
        if (!ac.signal.aborted) setSt({ data, dataKey: key, error: null, loading: false });
      },
      (e: unknown) => {
        if (ac.signal.aborted || isAbort(e)) return;
        const err =
          e instanceof ApiError ? e : new ApiError('unknown', e instanceof Error ? e.message : 'Something went wrong.', 0);
        setSt((s) => ({ ...s, error: err, loading: false }));
      },
    );
    return () => ac.abort();
  }, [key, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...st, retry };
}
