// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CurrentUser } from "shared";
import { api, ApiError, isPublicPath, setUnauthorizedHandler } from "./api";

export interface AuthState {
  /** The logged-in user, or null when not logged in. */
  user: CurrentUser | null;
  /** True until the first "who am I" check has finished. */
  loading: boolean;
  /** True while that check cannot reach the server; it is retried until it can. */
  unreachable: boolean;
  /** Counts the times the server came back after being unreachable, so pages can load again. */
  reconnects: number;
  /** Re-reads the user from the API (after login or a password change). */
  refresh: () => Promise<CurrentUser | null>;
  /** Ends the session on the server and forgets the user. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const RETRY_MS = 3000;

/**
 * The logged-in user, or null when the server says nobody is (401). Any other failure
 * (server restarting, no internet) throws: that is not a logout. Found in the launch check of
 * 27 October 2026: a short API restart sent everyone to the login page.
 */
function whoAmI(): Promise<CurrentUser | null> {
  return api.get<CurrentUser>("/auth/me", { redirectOnUnauthorized: false }).catch((e: unknown) => {
    if (e instanceof ApiError && e.statusCode === 401) return null;
    throw e;
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [reconnects, setReconnects] = useState(0);

  // Any 401 from the API while on a private page: forget the user and go to the login page.
  useEffect(() => {
    const previous = setUnauthorizedHandler(() => {
      setUser(null);
      // Audit 9: back to this page after logging in again.
      if (!isPublicPath(window.location.pathname)) router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    });
    return () => {
      setUnauthorizedHandler(previous);
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failed = false;
    const check = () =>
      whoAmI().then(
        (me) => {
          if (cancelled) return;
          setUser(me);
          setUnreachable(false);
          if (failed) setReconnects((n) => n + 1);
          setLoading(false);
        },
        () => {
          if (cancelled) return;
          failed = true;
          setUnreachable(true);
          timer = setTimeout(check, RETRY_MS);
        },
      );
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const refresh = useCallback(async () => {
    const me = await whoAmI().catch(() => null);
    setUser(me);
    setLoading(false);
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout", undefined, { redirectOnUnauthorized: false });
    } catch {
      // The session may already be gone; either way the user is logged out locally.
    }
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(() => ({ user, loading, unreachable, reconnects, refresh, logout }), [user, loading, unreachable, reconnects, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
