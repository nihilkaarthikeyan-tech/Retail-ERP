// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { type CurrentUser, loginSchema } from "shared";
import { Alert, Button, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

export function LoginForm() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    const issues = issuesToFieldErrors(parsed);
    setFieldErrors(issues);
    if (!parsed.success) return;

    setBusy(true);
    try {
      const user = await api.post<CurrentUser>("/auth/login", parsed.data, { redirectOnUnauthorized: false });
      await refresh();
      router.replace(user.mustChangePassword ? "/change-password" : "/dashboard");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Alert kind="error">{error}</Alert>
      <TextInput
        id="email"
        label="Email"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldErrors.email}
        required
      />
      <TextInput
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldErrors.password}
        required
      />
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy}>
          Log in
        </Button>
      </div>
    </form>
  );
}
