// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { LoginForm } from "@/components/login-form";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function SetupDoneMessage() {
  const params = useSearchParams();
  if (params.get("setup") !== "done") return null;
  return <Alert kind="success">Setup is complete. Log in with the owner account you just created.</Alert>;
}

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [checkedSetup, setCheckedSetup] = useState(false);

  // First run: there is nobody to log in as yet.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ needed: boolean }>("/setup/status", { redirectOnUnauthorized: false })
      .then((s) => {
        if (cancelled) return;
        if (s.needed) router.replace("/setup");
        else setCheckedSetup(true);
      })
      .catch(() => {
        if (!cancelled) setCheckedSetup(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!loading && user) router.replace(user.mustChangePassword ? "/change-password" : "/");
  }, [loading, user, router]);

  return (
    <main className="public-page narrow">
      <h1>Retail ERP</h1>
      <p className="muted">Log in to continue.</p>
      <Suspense fallback={null}>
        <SetupDoneMessage />
      </Suspense>
      {checkedSetup && !loading && !user ? <LoginForm /> : <p className="muted">Loading…</p>}
    </main>
  );
}
