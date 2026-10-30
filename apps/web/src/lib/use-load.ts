// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";

export interface LoadState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Runs the loader again (after a save, for example). */
  reload: () => Promise<void>;
  /** Replaces the loaded data locally without a round trip. */
  setData: (next: T) => void;
}

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Loads data from the API in the browser on mount, again whenever `deps`
 * change, and on `reload()`. Results of an outdated request are ignored.
 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []): LoadState<T> {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: true });
  const version = useRef(0);
  const loaderRef = useRef(loader);

  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    let cancelled = false;
    const my = ++version.current;
    // Audit 9: a new filter shows as loading (the old figures stayed on screen with no sign).
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    loader().then(
      (data) => {
        if (!cancelled && my === version.current) setState({ data, error: null, loading: false });
      },
      (err: unknown) => {
        if (!cancelled && my === version.current) setState((s) => ({ ...s, error: errorMessage(err), loading: false }));
      },
    );
    return () => {
      // A newer effect run (or unmount) supersedes this request.
      cancelled = true;
    };
    // The loader is an inline function; `deps` says when it really changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(async () => {
    const my = ++version.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loaderRef.current();
      if (my === version.current) setState({ data, error: null, loading: false });
    } catch (err) {
      if (my === version.current) setState((s) => ({ ...s, error: errorMessage(err), loading: false }));
    }
  }, []);

  const setData = useCallback((data: T) => {
    setState({ data, error: null, loading: false });
  }, []);

  return { data: state.data, error: state.error, loading: state.loading, reload, setData };
}
