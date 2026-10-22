// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoginForm } from "@/components/login-form";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace(user.mustChangePassword ? "/change-password" : "/dashboard");
  }, [loading, user, router]);

  return (
    <main className="public-page narrow">
      <Link href="/" className="public-brand">
        <span className="shell-brand-mark" aria-hidden="true" />
        Retail ERP
      </Link>
      <h1>Log in</h1>
      <p className="muted">Log in to your shop.</p>
      {!loading && !user ? <LoginForm /> : <p className="muted">Loading…</p>}
      {/* Plan 14: a new shop starts here. */}
      <p className="public-switch">
        New to Retail ERP? <Link href="/signup">Start your free trial</Link>
      </p>
    </main>
  );
}
