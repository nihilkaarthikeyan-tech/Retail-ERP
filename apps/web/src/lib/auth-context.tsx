// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CurrentUser } from "shared";
import { api, isPublicPath, setUnauthorizedHandler } from "./api";

export interface AuthState {
  /** The logged-in user, or null when not logged in. */
  user: CurrentUser | null;
  /** True until the first "who am I" check has finished. */
  loading: boolean;
  /** Re-reads the user from the API (after login or a password change). */
  refresh: () => Promise<CurrentUser | null>;
  /** Ends the session on the server and forgets the user. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function whoAmI(): Promise<CurrentUser | null> {
  // 401 (not logged in) and any other failure both mean "no user" here;
  // pages show the real cause when their own requests fail.
  return api.get<CurrentUser>("/auth/me", { redirectOnUnauthorized: false }).catch(() => null);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Any 401 from the API while on a private page: forget the user and go to the login page.
  useEffect(() => {
    const previous = setUnauthorizedHandler(() => {
      setUser(null);
      if (!isPublicPath(window.location.pathname)) router.replace("/login");
    });
    return () => {
      setUnauthorizedHandler(previous);
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    whoAmI().then((me) => {
      if (cancelled) return;
      setUser(me);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const me = await whoAmI();
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

  const value = useMemo<AuthState>(() => ({ user, loading, refresh, logout }), [user, loading, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
