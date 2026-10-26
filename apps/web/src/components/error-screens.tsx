// Copyright (c) 2026, Rademics. All rights reserved.
// "Page not found" and "Something went wrong" (owner, 26 October 2026), in the
// product's own look, with a way back. A crash is reported to the server log.
"use client";

import Link from "next/link";
import { useEffect } from "react";
import { BrandMark } from "@/components/brand-mark";
import { API_URL } from "@/lib/api";

export function NotFoundScreen({ inApp = false }: { inApp?: boolean }) {
  return (
    <div className={inApp ? "oops oops-in-app" : "oops"}>
      {inApp ? null : (
        <Link href="/" className="lp-brand oops-brand">
          <BrandMark />
          Retail ERP
        </Link>
      )}
      <p className="label-mono">Error 404</p>
      <h1>We can’t find that page</h1>
      <p className="oops-text">The link may be old or mistyped, or the page has moved.</p>
      <div className="oops-actions">
        <Link href="/dashboard" className="btn btn-primary">
          Go to the dashboard
        </Link>
        <Link href="/" className="btn">
          Go to the home page
        </Link>
      </div>
    </div>
  );
}

export function CrashScreen({ error, reset, inApp = false }: { error: Error & { digest?: string }; reset: () => void; inApp?: boolean }) {
  useEffect(() => {
    // Best effort: a note in the server log, never the page's data.
    void fetch(`${API_URL}/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: String(error.message || "Unknown error").slice(0, 500), page: window.location.pathname.slice(0, 300), digest: error.digest }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error]);

  return (
    <div className={inApp ? "oops oops-in-app" : "oops"}>
      {inApp ? null : (
        <Link href="/" className="lp-brand oops-brand">
          <BrandMark />
          Retail ERP
        </Link>
      )}
      <p className="label-mono">Something went wrong</p>
      <h1>This screen hit a problem</h1>
      <p className="oops-text">Nothing you saved before this is lost. Try again; if it keeps happening, tell us what you were doing{error.digest ? ` and quote code ${error.digest}` : ""}.</p>
      <div className="oops-actions">
        <button type="button" className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/dashboard" className="btn">
          Go to the dashboard
        </Link>
      </div>
    </div>
  );
}
