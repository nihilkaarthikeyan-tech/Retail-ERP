// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { businessDate, type CurrentUser } from "shared";
import { AppMenu } from "@/components/app-menu";
import { Icon } from "@/components/icons";
import { QuickSearch } from "@/components/quick-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, ToastProvider } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, fullName } from "@/lib/format";
import { MENU } from "@/lib/menu";
import { recordVisit } from "@/lib/menu-usage";
import { BrandMark } from "@/components/brand-mark";

function initials(user: CurrentUser): string {
  const letters = [user.firstName, user.lastName].map((p) => p?.trim()?.[0] ?? "").join("");
  return (letters || user.email[0] || "?").toUpperCase();
}

/** Reads the current path (runtime-only data, so it sits behind Suspense) and counts the visit for "Most used". */
function CurrentMenu({ user }: { user: CurrentUser }) {
  const pathname = usePathname();
  useEffect(() => {
    if (MENU.some((e) => e.href === pathname)) recordVisit(pathname);
  }, [pathname]);
  return <AppMenu user={user} pathname={pathname} />;
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Shell for every logged-in page: the menu on the left with the brand at its
 * top, and a top bar over the page (today's business date, light/dark switch,
 * user, logout). Sends visitors to /setup, /login or /change-password as needed.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // On a phone the menu is a drawer opened with the ☰ button.
  const [menuOpen, setMenuOpen] = useState(false);

  // Ctrl+K (Cmd+K on a Mac) opens quick search from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    <ToastProvider>
    <div className="shell">
      <header className="shell-head">
        {ready ? (
          <button type="button" className="shell-menu-button" onClick={() => setMenuOpen(true)} aria-label="Open the menu" aria-expanded={menuOpen}>
            <Icon name="menu" size={20} />
          </button>
        ) : null}
        <Link href="/dashboard" className="shell-brand shell-brand-compact">
          <BrandMark />
          Retail ERP
        </Link>
        {ready ? (
          <button type="button" className="shell-search" onClick={() => setSearchOpen(true)} aria-label="Quick search">
            <Icon name="search" size={16} />
            <span>Search screens, items, customers, bills</span>
            <kbd>{isMac() ? "⌘" : "Ctrl"} K</kbd>
          </button>
        ) : null}
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
      {menuOpen ? <div className="shell-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" /> : null}
      <aside
        className={`shell-side${menuOpen ? " is-open" : ""}`}
        onClick={(e) => {
          // Picking a screen on a phone closes the drawer.
          if ((e.target as HTMLElement).closest("a")) setMenuOpen(false);
        }}
      >
        <div className="shell-side-top">
          <Link href="/dashboard" className="shell-brand">
            <BrandMark />
            Retail ERP
          </Link>
          <button type="button" className="shell-menu-close" onClick={() => setMenuOpen(false)} aria-label="Close the menu">
            ×
          </button>
        </div>
        {ready ? (
          <Suspense fallback={<AppMenu user={user} pathname="" />}>
            <CurrentMenu user={user} />
          </Suspense>
        ) : null}
        {ready ? (
          <div className="shell-side-foot">
            <ThemeToggle />
            <Button size="small" onClick={onLogout}>
              <Icon name="logout" size={15} />
              Log out
            </Button>
          </div>
        ) : null}
      </aside>
      <div className="shell-main">
        <main className="shell-content">{children}</main>
      </div>
      {ready ? <QuickSearch user={user} open={searchOpen} onClose={() => setSearchOpen(false)} /> : null}
    </div>
    </ToastProvider>
  );
}
