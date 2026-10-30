// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useEffect } from "react";
import { api } from "./api";

export const LEAVE_QUESTION = "Leave this page? What you typed here is not saved yet.";
/** Sign-ins end after 30 idle minutes; typing alone does not reach the server. */
const KEEP_ALIVE_MS = 5 * 60_000;

/**
 * Audit 9: while a form has changes that are not saved,
 * - closing the tab or reloading asks first,
 * - a click on a link inside the app asks first ("Leave this page?"),
 * - the sign-in is kept alive, so a long purchase order or count is not lost to the 30-minute limit.
 */
export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const to = new URL(a.href, window.location.href);
      if (to.origin !== window.location.origin || (to.pathname === window.location.pathname && to.search === window.location.search)) return;
      if (!window.confirm(LEAVE_QUESTION)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const timer = setInterval(() => {
      void api.get("/auth/me").catch(() => undefined);
    }, KEEP_ALIVE_MS);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}

/** Where to go after logging in: the page the person was on (only a path inside the app). */
export function safeNext(next: string | null | undefined, fallback: string): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : fallback;
}
