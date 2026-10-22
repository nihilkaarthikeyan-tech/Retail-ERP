// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { businessDate, type CurrentUser } from "shared";
import { AppMenu } from "@/components/app-menu";
import { Icon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, fullName } from "@/lib/format";
import { BrandMark } from "@/components/brand-mark";

function initials(user: CurrentUser): string {
  const letters = [user.firstName, user.lastName].map((p) => p?.trim()?.[0] ?? "").join("");
  return (letters || user.email[0] || "?").toUpperCase();
}

/** Reads the current path (runtime-only data, so it sits behind Suspense). */
function CurrentMenu({ user }: { user: CurrentUser }) {
  const pathname = usePathname();
  return <AppMenu user={user} pathname={pathname} />;
}

/**
 * Shell for every logged-in page: top bar (today's business date, light/dark
 * switch, user, logout) and the menu on the left. Sends visitors to /setup, /login or /change-password as needed.
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
      <header className="shell-head">
        <Link href="/dashboard" className="shell-brand">
          <BrandMark />
          Retail ERP
        </Link>
        {ready ? (
          <span className="shell-date">
            <Icon name="calendar" size={15} />
            {formatDate(businessDate())}
          </span>
        ) : null}
        <div className="shell-head-end">
          <ThemeToggle />
          {ready ? (
            <>
              <span className="shell-user">
                <span className="shell-avatar" aria-hidden="true">
                  {initials(user)}
                </span>
                <span className="shell-user-text">
                  <span className="shell-user-name">{fullName(user)}</span>
                  <span className="shell-user-role">{user.roles.map((r) => r.name).join(", ") || "no role"}</span>
                </span>
              </span>
              <Link href="/change-password" className="btn btn-small btn-link">
                <Icon name="key" size={15} />
                Change password
              </Link>
              <Button size="small" onClick={onLogout}>
                <Icon name="logout" size={15} />
                Log out
              </Button>
            </>
          ) : (
            <span className="muted">Loading…</span>
          )}
        </div>
      </header>
      <aside className="shell-side">
        {ready ? (
          <Suspense fallback={<AppMenu user={user} pathname="" />}>
            <CurrentMenu user={user} />
          </Suspense>
        ) : null}
      </aside>
      <div className="shell-main">
        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
