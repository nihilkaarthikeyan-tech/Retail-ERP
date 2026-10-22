// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { changePasswordSchema } from "shared";
import { Alert, Button, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

/**
 * Lives outside the app shell because the shell sends users here while a
 * password change is pending, which would otherwise loop.
 */
export default function ChangePasswordPage() {
  const { user, loading, refresh, logout } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    const issues = issuesToFieldErrors(parsed);
    if (newPassword !== confirm) issues.confirm = "Passwords do not match";
    setErrors(issues);
    if (!parsed.success || Object.keys(issues).length > 0) return;
    setBusy(true);
    try {
      await api.post("/auth/change-password", parsed.data);
      await refresh();
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) {
    return (
      <main className="public-page narrow">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="public-page narrow">
      <h1>Change password</h1>
      {user.mustChangePassword ? (
        <Alert kind="info">You must choose a new password before continuing.</Alert>
      ) : (
        <p className="muted">Signed in as {user.email}.</p>
      )}
      {done ? (
        <Alert kind="success">
          Your password has been changed. Other sessions have been ended. <Link href="/dashboard">Go to the dashboard</Link>.
        </Alert>
      ) : null}
      <form onSubmit={onSubmit} noValidate>
        <Alert kind="error">{error}</Alert>
        <TextInput
          id="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          error={errors.currentPassword}
          required
        />
        <TextInput
          id="newPassword"
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          error={errors.newPassword}
          hint="At least 10 characters."
          required
        />
        <TextInput
          id="confirm"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
          required
        />
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Change password
          </Button>
          {user.mustChangePassword ? (
            <Button
              onClick={async () => {
                await logout();
                router.replace("/login");
              }}
            >
              Log out
            </Button>
          ) : (
            <Link href="/dashboard" className="btn btn-link">
              Back
            </Link>
          )}
        </div>
      </form>
    </main>
  );
}
