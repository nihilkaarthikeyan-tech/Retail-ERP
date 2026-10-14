// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { use, useState, type FormEvent } from "react";
import { hasPermission, resetPasswordSchema } from "shared";
import { UserForm } from "@/components/user-form";
import { ActiveBadge, Alert, Button, Dialog, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime, fullName } from "@/lib/format";
import type { RoleDto, StoreDto, UserDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

export function UserEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user: me } = useAuth();
  const canManage = hasPermission(me, "users.manage");
  const canEndSessions = hasPermission(me, "sessions.manage_others");
  const user = useLoad(() => api.get<UserDto>(`/users/${id}`), [id]);
  const roles = useLoad(() => api.get<RoleDto[]>("/roles"));
  const stores = useLoad(() => api.get<StoreDto[]>("/stores"));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [resetErrors, setResetErrors] = useState<FieldErrors>({});
  const [resetError, setResetError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reset" | "sessions" | null>(null);

  async function submitReset(e: FormEvent) {
    e.preventDefault();
    setResetError(null);
    const parsed = resetPasswordSchema.safeParse({ temporaryPassword });
    const issues = issuesToFieldErrors(parsed);
    setResetErrors(issues);
    if (!parsed.success) return;
    setBusy("reset");
    try {
      await api.post(`/users/${id}/reset-password`, parsed.data);
      setResetOpen(false);
      setTemporaryPassword("");
      setMessage("Temporary password set. The user must change it at next login; their sessions were ended.");
      await user.reload();
    } catch (err) {
      setResetErrors(apiFieldErrors(err));
      setResetError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function endSessions() {
    setError(null);
    setBusy("sessions");
    try {
      const result = await api.delete<{ ended: number }>(`/users/${id}/sessions`);
      setMessage(`${result.ended} session(s) ended.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (user.error) {
    return (
      <>
        <h1>User</h1>
        <Alert kind="error">{user.error}</Alert>
        <Link href="/users">Back to users</Link>
      </>
    );
  }
  if (!user.data || !roles.data || !stores.data) {
    return (
      <>
        <Alert kind="error">{roles.error ?? stores.error}</Alert>
        <p className="muted">Loading…</p>
      </>
    );
  }
  const u = user.data;

  return (
    <>
      <p>
        <Link href="/users">← Users</Link>
      </p>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>{fullName(u)}</h1>
        <ActiveBadge active={u.active} />
        <span className="spacer" />
        {canManage ? (
          <Button onClick={() => setResetOpen(true)}>Reset password</Button>
        ) : null}
        {canEndSessions ? (
          <Button variant="danger" busy={busy === "sessions"} onClick={endSessions}>
            End all sessions
          </Button>
        ) : null}
      </div>
      <dl className="kv">
        <dt>Last login</dt>
        <dd>{formatDateTime(u.lastLoginAt)}</dd>
        <dt>Password</dt>
        <dd>{u.mustChangePassword ? "Change pending at next login" : "Set by the user"}</dd>
        {u.lockedUntil && new Date(u.lockedUntil) > new Date() ? (
          <>
            <dt>Locked until</dt>
            <dd>{formatDateTime(u.lockedUntil)}</dd>
          </>
        ) : null}
      </dl>
      {message ? <Alert kind="success">{message}</Alert> : null}
      <Alert kind="error">{error}</Alert>

      {canManage ? (
        <UserForm
          key={u.id}
          user={u}
          roles={roles.data}
          stores={stores.data}
          selfId={me?.id}
          onSaved={(saved) => {
            user.setData(saved);
            setMessage("User saved.");
          }}
        />
      ) : (
        <p className="muted">You can view this user but not change them.</p>
      )}

      <Dialog open={resetOpen} title="Reset password" onClose={() => setResetOpen(false)}>
        <form onSubmit={submitReset} noValidate>
          <Alert kind="error">{resetError}</Alert>
          <TextInput
            id="reset-temporaryPassword"
            label="Temporary password"
            type="password"
            value={temporaryPassword}
            onChange={(e) => setTemporaryPassword(e.target.value)}
            error={resetErrors.temporaryPassword}
            required
            autoComplete="new-password"
            hint="Tell the person in private. They must change it at next login; all their sessions end now."
          />
          <div className="actions">
            <Button type="submit" variant="primary" busy={busy === "reset"}>
              Set temporary password
            </Button>
            <Button onClick={() => setResetOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
