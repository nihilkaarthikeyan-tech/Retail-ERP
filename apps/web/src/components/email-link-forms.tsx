// Copyright (c) 2026, Rademics. All rights reserved.
// "Forgot password?", "Choose a new password" and "Confirm your email"
// (owner, 26 October 2026). The links arrive by email; each works once.
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { forgotPasswordSchema, newPasswordByLinkSchema } from "shared";
import { Alert, Button, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

/** Asks for the email; always says the same afterwards, so the page never tells who has an account. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = forgotPasswordSchema.safeParse({ email });
    setFieldErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      await api.post("/auth/forgot-password", parsed.data, { redirectOnUnauthorized: false });
      setSentTo(parsed.data.email);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div className="auth-done">
        <Alert kind="success">If {sentTo} has a Retail ERP account, we have sent it a link to choose a new password.</Alert>
        <p className="muted">The link works once and stops working in 30 minutes. Nothing in your inbox? Look in the spam folder, or ask again in a few minutes.</p>
        <p>
          <Button variant="link" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <Alert kind="error">{error}</Alert>
      <TextInput id="forgot-email" label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email} required autoFocus />
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy}>
          Send me a link
        </Button>
      </div>
    </form>
  );
}

/** Reads the link's code and sets the new password; afterwards the person logs in with it. */
export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <Alert kind="error">
        This page needs the link from your email. <Link href="/forgot-password">Ask for a new link</Link>.
      </Alert>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = newPasswordByLinkSchema.safeParse({ token, newPassword: password });
    const issues = issuesToFieldErrors(parsed);
    if (password !== repeat) issues.repeat = "The two passwords are not the same.";
    setFieldErrors(issues);
    if (!parsed.success || password !== repeat) return;
    setBusy(true);
    try {
      await api.post("/auth/reset-password", parsed.data, { redirectOnUnauthorized: false });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="auth-done">
        <Alert kind="success">Your new password is saved. Every device that was logged in has been logged out.</Alert>
        <div className="actions">
          <Link href="/login" className="btn btn-primary">
            Log in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <Alert kind="error">
        {error && /expired|already been used/.test(error) ? (
          <>
            This link has expired or has already been used. <Link href="/forgot-password">Ask for a new link</Link>.
          </>
        ) : (
          error
        )}
      </Alert>
      <TextInput id="new-password" label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fieldErrors.newPassword} hint="At least 10 characters." required autoFocus />
      <TextInput id="new-password-repeat" label="Type it again" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} error={fieldErrors.repeat} required />
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy}>
          Save my new password
        </Button>
      </div>
    </form>
  );
}

/** Confirms the email as soon as the page opens (a person's browser, not a mail scanner, runs this). */
export function ConfirmEmail() {
  const params = useSearchParams();
  const router = useRouter();
  const { user, refresh } = useAuth();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"working" | "done" | "failed">(token ? "working" : "failed");
  const [error, setError] = useState<string | null>(token ? null : "This page needs the link from your email.");
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api
      .post("/auth/confirm-email", { token }, { redirectOnUnauthorized: false })
      .then(async () => {
        setState("done");
        await refresh();
      })
      .catch((err: unknown) => {
        setState("failed");
        setError(errorMessage(err));
      });
  }, [token, refresh]);

  if (state === "working") return <p className="muted">Confirming your email…</p>;
  if (state === "done") {
    return (
      <div className="auth-done">
        <Alert kind="success">Thank you, your email is confirmed.</Alert>
        <div className="actions">
          <Button variant="primary" onClick={() => router.replace(user ? "/dashboard" : "/login")}>
            {user ? "Go to the dashboard" : "Log in"}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="auth-done">
      <Alert kind="error">{error}</Alert>
      <p className="muted">Log in and use “Send the link again” on the bar at the top of the page.</p>
      <div className="actions">
        <Link href={user ? "/dashboard" : "/login"} className="btn btn-primary">
          {user ? "Go to the dashboard" : "Log in"}
        </Link>
      </div>
    </div>
  );
}

/** The bar at the top of every page for an owner who has not confirmed their email yet. */
export function ConfirmEmailBar() {
  const { user } = useAuth();
  const [state, setState] = useState<"idle" | "busy" | "sent" | "limit">("idle");
  if (!user || !user.isOwnerAdmin || user.emailConfirmed !== false) return null;

  async function resend() {
    setState("busy");
    try {
      const r = await api.post<{ sent: boolean; alreadyConfirmed: boolean }>("/auth/resend-confirmation", {});
      setState(r.sent || r.alreadyConfirmed ? "sent" : "limit");
    } catch {
      setState("limit");
    }
  }

  return (
    <div className="confirm-bar" role="status">
      <span>
        <strong>Confirm your email.</strong> We sent a link to {user.email}. It is how you get back in if you forget your password.
      </span>
      {state === "sent" ? (
        <span className="muted">Sent. Look in your inbox.</span>
      ) : state === "limit" ? (
        <span className="muted">Please wait a while before asking again.</span>
      ) : (
        <Button size="small" busy={state === "busy"} onClick={() => void resend()}>
          Send the link again
        </Button>
      )}
    </div>
  );
}
