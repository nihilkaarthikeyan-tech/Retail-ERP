// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createBrandSchema, hasPermission, updateBrandSchema } from "shared";
import { ActiveBadge, Alert, Button, CheckInput, DataTable, Dialog, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { BrandDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface BrandForm {
  code: string;
  name: string;
  active: boolean;
}

const emptyBrand: BrandForm = { code: "", name: "", active: true };

export default function BrandsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "catalogue.manage");
  const brands = useLoad(() => api.get<BrandDto[]>("/catalogue/brands"));
  const [editing, setEditing] = useState<BrandDto | "new" | null>(null);
  const [form, setForm] = useState<BrandForm>(emptyBrand);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(b: BrandDto | "new") {
    setErrors({});
    setError(null);
    setForm(b === "new" ? emptyBrand : { code: b.code, name: b.name, active: b.active });
    setEditing(b);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = editing === "new" ? createBrandSchema.safeParse({ code: form.code, name: form.name }) : updateBrandSchema.safeParse({ name: form.name, active: form.active });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post("/catalogue/brands", parsed.data);
      else if (editing) await api.patch(`/catalogue/brands/${editing.id}`, parsed.data);
      setEditing(null);
      await brands.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<BrandDto>[] = [
    { key: "code", header: "Code", render: (b) => <span className="mono">{b.code}</span> },
    { key: "name", header: "Name", render: (b) => b.name },
    { key: "active", header: "Status", render: (b) => <ActiveBadge active={b.active} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            render: (b: BrandDto) => (
              <Button size="small" onClick={() => open(b)}>
                Edit
              </Button>
            ),
          } satisfies Column<BrandDto>,
        ]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Brands</h1>
        <span className="spacer" />
        {canManage ? (
          <Button variant="primary" onClick={() => open("new")}>
            Add brand
          </Button>
        ) : null}
      </div>
      <Alert kind="error">{brands.error}</Alert>
      <DataTable columns={columns} rows={brands.data} rowKey={(b) => b.id} loading={brands.loading} empty="No brands yet." />

      <Dialog open={editing !== null} title={editing === "new" ? "Add brand" : `Edit brand: ${form.name}`} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          {editing === "new" ? (
            <TextInput id="brand-code" label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={errors.code} required className="mono" hint="Letters, digits, - . and /; cannot be changed later." autoComplete="off" />
          ) : null}
          <TextInput id="brand-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} required autoComplete="off" />
          {editing !== "new" ? <CheckInput id="brand-active" label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> : null}
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
