// Copyright (c) 2026, Rademics. All rights reserved.
// Sales staff (plan 11 C1): the salespeople of each store, picked or scanned
// at the till by their code. They need no login. No commissions (decision 48).
"use client";

import { useState, type FormEvent } from "react";
import { hasPermission, salesStaffSchema, updateSalesStaffSchema } from "shared";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { ActiveBadge, Alert, Button, CheckInput, DataTable, Dialog, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { storesFromLocations } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface SalesStaffDto {
  id: string;
  storeId: string;
  code: string;
  name: string;
  active: boolean;
}

interface Form {
  storeId: string;
  code: string;
  name: string;
  active: boolean;
}

export default function SalesStaffPage() {
  const { user } = useAuth();
  const canEdit = hasPermission(user, "sales_staff.manage");
  const locations = useStockLocations();
  const stores = storesFromLocations(locations.data ?? []);
  const [storeId, setStoreId] = useState("");
  const staff = useLoad(() => api.get<SalesStaffDto[]>(`/sales-staff${query({ storeId: storeId || undefined })}`), [storeId]);
  const [editing, setEditing] = useState<SalesStaffDto | "new" | null>(null);
  const [form, setForm] = useState<Form>({ storeId: "", code: "", name: "", active: true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const storeName = new Map(stores.map((s) => [s.id, `${s.code} — ${s.name}`]));

  function open(s: SalesStaffDto | "new") {
    setErrors({});
    setError(null);
    setForm(s === "new" ? { storeId: storeId || stores[0]?.id || "", code: "", name: "", active: true } : { storeId: s.storeId, code: s.code, name: s.name, active: s.active });
    setEditing(s);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = editing === "new" ? salesStaffSchema.safeParse(form) : updateSalesStaffSchema.safeParse({ code: form.code, name: form.name, active: form.active });
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post("/sales-staff", parsed.data);
      else if (editing) await api.patch(`/sales-staff/${editing.id}`, parsed.data);
      setEditing(null);
      await staff.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<SalesStaffDto>[] = [
    { key: "name", header: "Salesperson", render: (s) => s.name },
    { key: "code", header: "Code", render: (s) => <span className="mono">{s.code}</span> },
    { key: "store", header: "Store", render: (s) => storeName.get(s.storeId) ?? "—" },
    { key: "active", header: "Status", render: (s) => <ActiveBadge active={s.active} /> },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            render: (s: SalesStaffDto) => (
              <Button size="small" onClick={() => open(s)}>
                Edit
              </Button>
            ),
          } satisfies Column<SalesStaffDto>,
        ]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Sales staff</h1>
        <span className="spacer" />
        {canEdit ? (
          <Button variant="primary" onClick={() => open("new")} disabled={!stores.length}>
            Add salesperson
          </Button>
        ) : null}
      </div>
      <p className="muted">The people who sell on the shop floor. At the till the cashier picks them or types or scans their code; each line of a bill can name its own salesperson. They do not log in.</p>
      <div className="filter-row">
        <SelectInput id="staff-store" label="Store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">All my stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
      </div>
      <Alert kind="error">{staff.error}</Alert>
      <DataTable columns={columns} rows={staff.data} rowKey={(s) => s.id} loading={staff.loading} empty="No salespeople yet." />

      <Dialog open={editing !== null} title={editing === "new" ? "Add salesperson" : `Edit salesperson: ${form.name}`} onClose={() => setEditing(null)}>
        <form onSubmit={submit} noValidate>
          <Alert kind="error">{error}</Alert>
          {editing === "new" ? (
            <SelectInput id="staff-form-store" label="Store" value={form.storeId} error={errors.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </SelectInput>
          ) : null}
          <TextInput id="staff-code" label="Code" required className="mono" value={form.code} error={errors.code} hint="Short, for typing or scanning at the till, e.g. P1. Unique in the store." autoComplete="off" onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <TextInput id="staff-name" label="Name" required value={form.name} error={errors.name} autoComplete="off" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <CheckInput id="staff-active" label="Active" description="Switched-off salespeople are no longer offered at the till; their past sales stay." checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
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
