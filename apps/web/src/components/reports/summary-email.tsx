// Copyright (c) 2026, Rademics. All rights reserved.
// The owner's daily summary email settings (decision 67; plan 09 §1.5 and
// §6.4): on or off, the time (Indian time), who receives it, which figures it
// carries, a test send and the last sends with any error.
"use client";

import { type FormEvent, useState } from "react";
import { hasPermission } from "shared";
import { Alert, Badge, Button, CheckInput, DataTable, TextInput, type Column } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, fullName } from "@/lib/format";
import { formatWorkedOut, type SummaryEmailRunDto, type SummaryEmailSettingsDto } from "@/lib/reports";
import type { UserDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

interface Draft {
  enabled: boolean;
  sendAt: string;
  recipientIds: string[];
  figures: string[];
}

const toDraft = (s: SummaryEmailSettingsDto): Draft => ({ enabled: s.enabled, sendAt: s.sendAt, recipientIds: [...s.recipientIds], figures: [...s.figures] });
const same = (a: Draft, b: Draft) => a.enabled === b.enabled && a.sendAt === b.sendAt && [...a.recipientIds].sort().join() === [...b.recipientIds].sort().join() && [...a.figures].sort().join() === [...b.figures].sort().join();
const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));

export function SummaryEmailSettings() {
  const { user, loading } = useAuth();
  const allowed = hasPermission(user, "reports.summary_email");
  const settings = useLoad<SummaryEmailSettingsDto | null>(() => (allowed ? api.get<SummaryEmailSettingsDto>("/summary-email/settings") : Promise.resolve(null)), [allowed]);
  const canListUsers = hasPermission(user, "users.view");
  const users = useLoad<UserDto[]>(() => (allowed && canListUsers ? api.get<UserDto[]>("/users") : Promise.resolve([])), [allowed, canListUsers]);
  const runs = useLoad<SummaryEmailRunDto[]>(() => (allowed ? api.get<SummaryEmailRunDto[]>("/summary-email/runs") : Promise.resolve([])), [allowed]);

  if (loading) return <p className="muted">Loading…</p>;
  if (!allowed) {
    return (
      <>
        <h1>Daily summary email</h1>
        <Alert kind="error">Only the owner sets up the daily summary email.</Alert>
      </>
    );
  }

  return (
    <div className="area-admin">
      <h1>Daily summary email</h1>
      <p className="muted">Once a day, at the time you choose, an email goes to the people you pick with the shop&apos;s key figures. Sent in the evening it covers that day; sent in the morning, the day before.</p>
      <Alert kind="error">{settings.error}</Alert>
      {settings.data ? <MailStatus mail={settings.data.mail} /> : null}
      {settings.data ? (
        <SettingsForm
          saved={settings.data}
          users={users.data ?? []}
          usersError={canListUsers ? users.error : "You cannot see the list of users, so recipients cannot be changed here."}
          onSaved={(s) => settings.setData(s)}
          onTested={() => void runs.reload()}
        />
      ) : !settings.error ? (
        <p className="muted">Loading…</p>
      ) : null}
      <h2>Last emails sent</h2>
      <Alert kind="error">{runs.error}</Alert>
      <RunsTable runs={runs.data} loading={runs.loading} />
    </div>
  );
}

function MailStatus({ mail }: { mail: SummaryEmailSettingsDto["mail"] }) {
  if (mail.configured) {
    return (
      <Alert kind="success">
        Email is set up on the server. It is sent through <strong>{mail.account}</strong>.
      </Alert>
    );
  }
  return (
    <div className="alert alert-info" role="status">
      <p>
        <strong>Email is not set up on the server yet</strong>, so nothing can be sent.
      </p>
      <p>
        Whoever runs the server needs to add the mail account the email is sent from (your company mail, Gmail or Zoho) to the server settings: <span className="mono">SMTP_HOST</span> and the other <span className="mono">SMTP_</span> settings (<span className="mono">SMTP_PORT</span>, <span className="mono">SMTP_SECURE</span>,{" "}
        <span className="mono">SMTP_USER</span>, <span className="mono">SMTP_PASSWORD</span>) and <span className="mono">MAIL_FROM</span> in the server&apos;s <span className="mono">.env</span> file, then restart the server.
      </p>
      <p>You can still choose and save everything below now. The email starts going out once the mail account is added.</p>
    </div>
  );
}

function SettingsForm({ saved, users, usersError, onSaved, onTested }: { saved: SummaryEmailSettingsDto; users: UserDto[]; usersError: string | null; onSaved: (s: SummaryEmailSettingsDto) => void; onTested: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const dirty = !same(draft, toDraft(saved));
  // Recipients who are not in the user list (for example removed since) still show, so they can be taken off.
  const known = new Set(users.map((u) => u.id));
  const unknown = draft.recipientIds.filter((id) => !known.has(id));

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const problems: Record<string, string> = {};
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.sendAt)) problems.sendAt = "Choose a time, for example 21:00.";
    if (draft.figures.length === 0) problems.figures = "Choose at least one figure.";
    if (draft.enabled && draft.recipientIds.length === 0) problems.recipientIds = "Choose who receives the email.";
    setErrors(problems);
    if (Object.keys(problems).length) return;
    setBusy("save");
    try {
      const next = await api.put<SummaryEmailSettingsDto>("/summary-email/settings", draft);
      onSaved(next);
      setNotice("Saved.");
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setError(null);
    setNotice(null);
    setBusy("test");
    try {
      const run = await api.post<SummaryEmailRunDto>("/summary-email/test");
      setNotice(run?.error ? `The test email could not be sent: ${run.error}` : `A test email was sent to ${run?.recipients.length ?? 0} ${run?.recipients.length === 1 ? "person" : "people"}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
      onTested();
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="card" noValidate>
      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{notice}</Alert>
      <CheckInput
        id="se-enabled"
        label="Send the daily summary email"
        description={draft.enabled ? "On: it goes out every day at the time below." : "Off: nothing is sent."}
        checked={draft.enabled}
        onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
      />
      <div className="form-grid">
        <TextInput id="se-time" label="Send at (Indian time)" type="time" step={60} value={draft.sendAt} error={errors.sendAt} onChange={(e) => setDraft({ ...draft, sendAt: e.target.value })} hint="The server checks every five minutes, so it may arrive up to five minutes later." />
      </div>

      <fieldset>
        <legend>Who receives it</legend>
        {usersError ? <Alert kind="info">{usersError}</Alert> : null}
        {errors.recipientIds ? (
          <p className="field-error" role="alert">
            {errors.recipientIds}
          </p>
        ) : null}
        <div className="check-list">
          {users.map((u) => (
            <CheckInput
              key={u.id}
              id={`se-user-${u.id}`}
              label={fullName(u)}
              description={u.active ? u.email : `${u.email} — switched off, gets nothing`}
              checked={draft.recipientIds.includes(u.id)}
              onChange={(e) => setDraft({ ...draft, recipientIds: toggle(draft.recipientIds, u.id, e.target.checked) })}
            />
          ))}
          {unknown.map((id) => (
            <CheckInput key={id} id={`se-user-${id}`} label="A user not in the list" description={id} checked onChange={() => setDraft({ ...draft, recipientIds: toggle(draft.recipientIds, id, false) })} />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>What it includes</legend>
        {errors.figures ? (
          <p className="field-error" role="alert">
            {errors.figures}
          </p>
        ) : null}
        <div className="check-list">
          {Object.entries(saved.figureLabels).map(([key, label]) => (
            <CheckInput key={key} id={`se-figure-${key}`} label={label} checked={draft.figures.includes(key)} onChange={(e) => setDraft({ ...draft, figures: toggle(draft.figures, key, e.target.checked) })} />
          ))}
        </div>
      </fieldset>

      <div className="actions">
        <Button type="submit" variant="primary" busy={busy === "save"} disabled={!dirty || busy !== null}>
          Save
        </Button>
        <Button busy={busy === "test"} disabled={dirty || busy !== null} onClick={() => void test()}>
          Send a test now
        </Button>
      </div>
      <p className="field-hint">
        {dirty
          ? "Save your changes first; the test uses the saved settings."
          : "The test goes now to the people ticked above (or to you if no one is ticked), whatever the time and even when the email is switched off. It does not count as the day's email."}
      </p>
    </form>
  );
}

function RunsTable({ runs, loading }: { runs: SummaryEmailRunDto[] | null; loading: boolean }) {
  const columns: Column<SummaryEmailRunDto>[] = [
    { key: "started", header: "When", render: (r) => formatWorkedOut(r.startedAt) },
    { key: "date", header: "For the day", render: (r) => formatDate(r.businessDate) },
    { key: "kind", header: "Kind", render: (r) => (r.kind === "test" ? "Test" : "Daily") },
    { key: "to", header: "Sent to", render: (r) => (r.recipients.length ? r.recipients.join(", ") : <span className="muted">—</span>) },
    {
      key: "result",
      header: "Result",
      render: (r) =>
        r.error ? (
          <>
            <Badge kind="off">Failed</Badge> <span>{r.error}</span>
          </>
        ) : r.sentAt ? (
          <Badge kind="ok">Sent {formatWorkedOut(r.sentAt)}</Badge>
        ) : (
          <Badge kind="warn">Sending</Badge>
        ),
    },
  ];
  return <DataTable columns={columns} rows={runs} rowKey={(r) => r.id} loading={loading} empty="No email has been sent yet." />;
}
