// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { createSeasonSchema, hasPermission, updateSeasonSchema } from "shared";
import { ActiveBadge, Alert, Button, CheckInput, DataTable, Dialog, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { blankToNull } from "@/lib/format";
import type { SeasonDto } from "@/lib/styles-seasons";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface SeasonForm {
  code: string;
  name: string;
  startsOn: string;
  endsOn: string;
  active: boolean;
}

const emptySeason: SeasonForm = { code: "", name: "", startsOn: "", endsOn: "", active: true };

/** Plan 11 C4: seasons or collections (Summer 2026, Diwali 2026…) that items and styles belong to. */
export default function SeasonsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "catalogue.manage");
  const seasons = useLoad(() => api.get<SeasonDto[]>("/seasons"));
  const [editing, setEditing] = useState<SeasonDto | "new" | null>(null);
  const [form, setForm] = useState<SeasonForm>(emptySeason);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(s: SeasonDto | "new") {
    setErrors({});
    setError(null);
    setForm(s === "new" ? emptySeason : { code: s.code, name: s.name, startsOn: s.startsOn ?? "", endsOn: s.endsOn ?? "", active: s.active });
    setEditing(s);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const dates = { startsOn: blankToNull(form.startsOn), endsOn: blankToNull(form.endsOn) };
    const parsed = editing === "new" ? createSeasonSchema.safeParse({ code: form.code, name: form.name, ...dates }) : updateSeasonSchema.safeParse({ name: form.name, ...dates, active: form.active });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) {
      if (!Object.keys(issues).length) setError(parsed.error.issues[0]?.message ?? "Check the dates");
      return;
    }
    setBusy(true);
    try {
      if (editing === "new") await api.post("/seasons", parsed.data);
      else if (editing) await api.patch(`/seasons/${editing.id}`, parsed.data);
      setEditing(null);
      await seasons.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<SeasonDto>[] = [
    { key: "code", header: "Code", render: (s) => <span className="mono">{s.code}</span> },
    { key: "name", header: "Name", render: (s) => s.name },
    { key: "dates", header: "From – to", render: (s) => (s.startsOn || s.endsOn ? `${s.startsOn ?? "…"} – ${s.endsOn ?? "…"}` : "—") },
    {
      key: "items",
      header: "Items",
      align: "right",
      render: (s) => (s.itemCount ? <Link href={`/items?seasonId=${s.id}`}>{s.itemCount}</Link> : "0"),
    },
    { key: "active", header: "Status", render: (s) => <ActiveBadge active={s.active} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            render: (s: SeasonDto) => (
              <Button size="small" onClick={() => open(s)}>
                Edit
              </Button>
            ),
          } satisfies Column<SeasonDto>,
        ]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Seasons</h1>
        <span className="spacer" />
        {canManage ? (
          <Button variant="primary" onClick={() => open("new")}>
            Add season
          </Button>
        ) : null}
      </div>
      <p className="muted">A season or collection groups the styles bought for it. Give it to items on the item page or in the Excel import; the season sell-through report and the markdown tool choose items by it.</p>
      <Alert kind="error">{seasons.error}</Alert>
      <DataTable columns={columns} rows={seasons.data} rowKey={(s) => s.id} loading={seasons.loading} empty="No seasons yet." />

      <Dialog open={editing !== null} title={editing === "new" ? "Add season" : `Edit season: ${form.name}`} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          {editing === "new" ? (
            <TextInput id="season-code" label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={errors.code} required className="mono" hint="e.g. SUMMER26; cannot be changed later." autoComplete="off" />
          ) : null}
          <TextInput id="season-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} required autoComplete="off" />
          <TextInput id="season-startsOn" label="From" type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} error={errors.startsOn} />
          <TextInput id="season-endsOn" label="To" type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} error={errors.endsOn} />
          {editing !== "new" ? <CheckInput id="season-active" label="Active" description="Switched-off seasons cannot be given to more items." checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> : null}
          <div className="actions">
            <Button type="submit" variant="primary" busy={busy}>
              Save
            </Button>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
