// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import type { CurrentUser } from "shared";
import { AppMenu } from "@/components/app-menu";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { fullName } from "@/lib/format";

/** Reads the current path (runtime-only data, so it sits behind Suspense). */
function CurrentMenu({ user }: { user: CurrentUser }) {
  const pathname = usePathname();
  return <AppMenu user={user} pathname={pathname} />;
}

/**
 * Shell for every logged-in page: menu on the left, header with the user's
 * name and logout. Sends visitors to /setup, /login or /change-password as needed.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ needed: boolean }>("/setup/status", { redirectOnUnauthorized: false })
      .then((s) => {
        if (!cancelled) setSetupNeeded(s.needed);
      })
      .catch(() => {
        // Unknown: fall back to the login check below.
        if (!cancelled) setSetupNeeded(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (setupNeeded === null || loading) return;
    if (setupNeeded) {
      router.replace("/setup");
    } else if (!user) {
      router.replace("/login");
    } else if (user.mustChangePassword) {
      router.replace("/change-password");
    }
  }, [setupNeeded, loading, user, router]);

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  // The page itself is rendered straight away: every page shows its own loading
  // state and the API refuses anything the session is not allowed to see. The
  // menu and header fill in once the user is known; redirects happen above.
  const ready = !loading && setupNeeded !== null && !!user && !setupNeeded && !user.mustChangePassword;

  return (
    <div className="shell">
      <aside className="shell-side">
        <div className="shell-brand">Retail ERP</div>
        {ready ? (
          <Suspense fallback={<AppMenu user={user} pathname="" />}>
            <CurrentMenu user={user} />
          </Suspense>
        ) : null}
      </aside>
      <div className="shell-main">
        <header className="shell-head">
          {ready ? (
            <>
              <span>
                {fullName(user)} <span className="muted">({user.roles.map((r) => r.name).join(", ") || "no role"})</span>
              </span>
              <Link href="/change-password">Change password</Link>
              <Button size="small" onClick={onLogout}>
                Log out
              </Button>
            </>
          ) : (
            <span className="muted">Loading…</span>
          )}
        </header>
        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
