// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { setPinSchema } from "shared";
import { Alert, Badge, Button, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

export default function MyPinPage() {
  const status = useLoad(() => api.get<{ hasPin: boolean }>("/pos/pin"));
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = setPinSchema.safeParse({ pin, currentPassword: password });
    const issues = issuesToFieldErrors(parsed);
    if (issues.currentPassword) issues.currentPassword = "Type your password.";
    if (!issues.pin && pin !== again) issues.again = "The two PINs are not the same.";
    setErrors(issues);
    if (!parsed.success || issues.again) return;
    setBusy(true);
    try {
      await api.post("/pos/pin", parsed.data);
      setSaved(true);
      setPin("");
      setAgain("");
      setPassword("");
      status.setData({ hasPin: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 6);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>My till PIN</h1>
        {status.data ? status.data.hasPin ? <Badge kind="ok">PIN is set</Badge> : <Badge kind="warn">No PIN yet</Badge> : null}
      </div>
      <p className="muted">
        Your PIN is a 4 to 6 digit number you type at the till to switch to yourself as the cashier, or, if you are a manager, to approve things like a big discount or cancelling a bill. Keep it secret; if you forget it, a manager can clear it and you set a new one here.
      </p>
      <Alert kind="error">{status.error}</Alert>
      <form onSubmit={submit} noValidate className="card">
        <Alert kind="error">{error}</Alert>
        {saved ? <Alert kind="success">Your PIN is saved.</Alert> : null}
        <div className="form-grid">
          <TextInput id="pin-new" label={status.data?.hasPin ? "New PIN" : "PIN"} type="password" inputMode="numeric" autoComplete="off" className="mono" required value={pin} error={errors.pin} hint="4 to 6 digits; not 1111 or 1234." onChange={(e) => setPin(digitsOnly(e.target.value))} />
          <TextInput id="pin-again" label="PIN again" type="password" inputMode="numeric" autoComplete="off" className="mono" required value={again} error={errors.again} onChange={(e) => setAgain(digitsOnly(e.target.value))} />
          <TextInput id="pin-password" label="Your password" type="password" autoComplete="current-password" required value={password} error={errors.currentPassword} hint="To check it is really you." onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save PIN
          </Button>
        </div>
      </form>
    </>
  );
}
