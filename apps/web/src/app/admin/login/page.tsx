// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { platformLoginSchema } from "shared";
import { Alert, Button, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

/** Plan 14: login of the people who run the Retail ERP service (not a shop's login). */
export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = platformLoginSchema.safeParse({ email, password });
    setFieldErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      await api.post("/platform/login", parsed.data, { redirectOnUnauthorized: false });
      router.replace("/admin");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="public-page narrow">
      <div className="public-brand">
        <span className="shell-brand-mark" aria-hidden="true" />
        Retail ERP admin
      </div>
      <h1>Log in</h1>
      <p className="muted">For the people who run Retail ERP. Shop owners and staff log in on the main login page.</p>
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <Alert kind="error">{error}</Alert>
        <TextInput id="admin-email" label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email} required />
        <TextInput id="admin-password" label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fieldErrors.password} required />
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Log in
          </Button>
        </div>
      </form>
    </main>
  );
}
