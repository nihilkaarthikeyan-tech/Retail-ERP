// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { LoginForm } from "@/components/login-form";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace(user.mustChangePassword ? "/change-password" : "/dashboard");
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
      {!loading && !user ? <LoginForm /> : <p className="muted">Loading…</p>}
    </AuthLayout>
  );
}
