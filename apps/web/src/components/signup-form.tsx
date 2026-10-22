// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { signupSchema } from "shared";
import { Alert, Button, TextInput } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { blankToNull } from "@/lib/format";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

/** Plan 14: a new shop and its owner's login; the owner then sets up the shop. */
export function SignupForm() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", mobile: "", shopName: "", password: "", confirm: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = signupSchema.safeParse({ firstName: form.firstName, lastName: blankToNull(form.lastName), email: form.email, mobile: blankToNull(form.mobile), shopName: form.shopName, password: form.password });
    const issues = issuesToFieldErrors(parsed);
    if (parsed.success && form.password !== form.confirm) issues.confirm = "The two passwords are not the same.";
    setFieldErrors(issues);
    if (!parsed.success || issues.confirm) return;

    setBusy(true);
    try {
      await api.post("/auth/signup", parsed.data, { redirectOnUnauthorized: false });
      await refresh();
      router.replace("/setup");
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setFieldErrors(err.fieldErrors);
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Alert kind="error">{error}</Alert>
      <div className="form-grid">
        <TextInput id="firstName" label="First name" autoComplete="given-name" value={form.firstName} onChange={set("firstName")} error={fieldErrors.firstName} required />
        <TextInput id="lastName" label="Last name" autoComplete="family-name" value={form.lastName} onChange={set("lastName")} error={fieldErrors.lastName} />
      </div>
      <TextInput id="shopName" label="Shop name" autoComplete="organization" value={form.shopName} onChange={set("shopName")} error={fieldErrors.shopName} required hint="The name of your business. You can fill in the rest after this." />
      <TextInput id="email" label="Email" type="email" autoComplete="username" value={form.email} onChange={set("email")} error={fieldErrors.email} required hint="You log in with this." />
      <TextInput id="mobile" label="Mobile" type="tel" inputMode="numeric" autoComplete="tel-national" value={form.mobile} onChange={set("mobile")} error={fieldErrors.mobile} hint="Optional. 10 digits, so we can call you if you need help." />
      <div className="form-grid">
        <TextInput id="password" label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} error={fieldErrors.password} required hint="At least 10 characters." />
        <TextInput id="confirm" label="Type it again" type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} error={fieldErrors.confirm} required />
      </div>
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy}>
          Start my free trial
        </Button>
      </div>
      <p className="muted">14 days free. No card needed.</p>
    </form>
  );
}
