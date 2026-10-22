// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SignupForm } from "@/components/signup-form";
import { useAuth } from "@/lib/auth-context";

/** Plan 14: a new shop signs up, then sets up its shop. */
export default function SignupPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  return (
    <main className="public-page narrow">
      <Link href="/" className="public-brand">
        <span className="shell-brand-mark" aria-hidden="true" />
        Retail ERP
      </Link>
      <h1>Start your free trial</h1>
      <p className="muted">Billing, stock, GST and accounts for your shop. Set up in a few minutes.</p>
      {!loading && !user ? <SignupForm /> : <p className="muted">Loading…</p>}
      <p className="public-switch">
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
