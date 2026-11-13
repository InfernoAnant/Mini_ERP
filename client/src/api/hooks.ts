import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { errorMessage } from './client';

/** Load data with `fn` whenever `deps` change; exposes reload() and setData(). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  useLayoutEffect(() => {
    fnRef.current = fn;
  });
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const result = await fnRef.current();
      if (mine === seq.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mine === seq.current) setError(errorMessage(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // Load on mount / when deps change. State is only set from the promise callbacks (never synchronously
  // in the effect), and a newer request wins over a stale one.
  useEffect(() => {
    const mine = ++seq.current;
    fnRef
      .current()
      .then((result) => {
        if (mine !== seq.current) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (mine === seq.current) setError(errorMessage(err));
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, setData, error, loading, reload };
}

/** Wrap an async action: tracks busy state and turns errors into a message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(errorMessage(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

/**
 * Run `onChange` (which may set this component's state) during render whenever `value` changes identity —
 * React's recommended alternative to "copy props into state in an effect" (no extra render pass).
 */
export function useOnChange<T>(value: T, onChange: (value: T) => void): void {
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    onChange(value);
  }
}
