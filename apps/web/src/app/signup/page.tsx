// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AuthLayout } from "@/components/auth-layout";
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
    <AuthLayout
      title="Start your free trial"
      intro="14 days free, no card needed. Set up your shop in a few minutes."
      footer={
        <>
          Already have an account? <Link href="/login">Log in</Link>
        </>
      }
    >
      {!loading && !user ? <SignupForm /> : <p className="muted">Loading…</p>}
    </AuthLayout>
  );
}
