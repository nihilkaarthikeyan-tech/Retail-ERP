// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createHsnCodeSchema, hasPermission, updateHsnCodeSchema } from "shared";
import { ActiveBadge, Alert, Badge, Button, CheckInput, DataTable, Dialog, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { HsnCodeDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface HsnForm {
  code: string;
  description: string;
  isService: boolean;
  active: boolean;
}

const emptyHsn: HsnForm = { code: "", description: "", isService: false, active: true };

export default function HsnCodesPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "catalogue.manage");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const codes = useLoad(() => api.get<HsnCodeDto[]>(`/catalogue/hsn-codes${query({ search: applied })}`), [applied]);
  const [editing, setEditing] = useState<HsnCodeDto | "new" | null>(null);
  const [form, setForm] = useState<HsnForm>(emptyHsn);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(h: HsnCodeDto | "new") {
    setErrors({});
    setError(null);
    setForm(h === "new" ? emptyHsn : { code: h.code, description: h.description, isService: h.isService, active: h.active });
    setEditing(h);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed =
      editing === "new"
        ? createHsnCodeSchema.safeParse({ code: form.code, description: form.description, isService: form.isService })
        : updateHsnCodeSchema.safeParse({ description: form.description, active: form.active });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post("/catalogue/hsn-codes", parsed.data);
      else if (editing) await api.patch(`/catalogue/hsn-codes/${editing.id}`, parsed.data);
      setEditing(null);
      await codes.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<HsnCodeDto>[] = [
    { key: "code", header: "Code", render: (h) => <span className="mono">{h.code}</span> },
    { key: "desc", header: "Description", render: (h) => h.description },
    { key: "kind", header: "Kind", render: (h) => <Badge kind="neutral">{h.isService ? "Service (SAC)" : "Goods (HSN)"}</Badge> },
    { key: "active", header: "Status", render: (h) => <ActiveBadge active={h.active} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            render: (h: HsnCodeDto) => (
              <Button size="small" onClick={() => open(h)}>
                Edit
              </Button>
            ),
          } satisfies Column<HsnCodeDto>,
        ]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>HSN / SAC codes</h1>
        <span className="spacer" />
        {canManage ? (
          <Button variant="primary" onClick={() => open("new")}>
            Add code
          </Button>
        ) : null}
      </div>
      <p className="muted">Codes and descriptions only; the GST rate for each code is set under GST rates and applies as soon as it is saved.</p>
      <form
        className="scan-box"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(search.trim());
        }}
      >
        <label htmlFor="hsn-search" className="sr-only">
          Search codes
        </label>
        <input id="hsn-search" className="input" type="search" placeholder="Code starts with, or words from the description" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
        <Button type="submit">Search</Button>
      </form>
      <Alert kind="error">{codes.error}</Alert>
      <DataTable columns={columns} rows={codes.data} rowKey={(h) => h.id} loading={codes.loading} empty={applied ? `No codes match "${applied}".` : "No HSN codes yet."} />

      <Dialog open={editing !== null} title={editing === "new" ? "Add HSN / SAC code" : `Edit code ${form.code}`} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          {editing === "new" ? (
            <>
              <TextInput id="hsn-code" label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={errors.code} required inputMode="numeric" className="mono" hint="4, 6 or 8 digits." autoComplete="off" />
              <CheckInput id="hsn-isService" label="Service (SAC) code" description="Off = goods (HSN)." checked={form.isService} onChange={(e) => setForm({ ...form, isService: e.target.checked })} />
            </>
          ) : null}
          <TextInput id="hsn-description" label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={errors.description} required autoComplete="off" />
          {editing !== "new" ? <CheckInput id="hsn-active" label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> : null}
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
