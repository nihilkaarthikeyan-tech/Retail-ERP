// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { LoginForm } from "@/components/login-form";
import { useAuth } from "@/lib/auth-context";
import { safeNext } from "@/lib/unsaved";

export default function LoginPage() {
  const { user, loading, unreachable } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace(user.mustChangePassword ? "/change-password" : safeNext(new URLSearchParams(window.location.search).get("next"), "/dashboard"));
  }, [loading, user, router]);

  return (
    <AuthLayout
      title="Log in"
      intro="Log in to your shop."
      footer={
        // Plan 14: a new shop starts here.
        <>
          New to Retail ERP? <Link href="/signup">Start your free trial</Link>
        </>
      }
    >
      {!loading && !user ? <LoginForm /> : (
        // Audit 9: say so when the server cannot be reached (it showed "Loading…" with no end).
        <p className="muted" role="status">
          {unreachable ? "Cannot reach the server just now. Trying again…" : "Loading…"}
        </p>
      )}
    </AuthLayout>
  );
}
