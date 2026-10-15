// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { paymentMethodSchema, updatePaymentMethodSchema } from "shared";
import { PAYMENT_KIND_LABELS, type PaymentKind, type PaymentMethodDto, posRights, usePaymentMethods } from "@/components/pos/pos-shared";
import { ActiveBadge, Alert, Badge, Button, CheckInput, DataTable, Dialog, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface Form {
  code: string;
  name: string;
  kind: PaymentKind;
  allowRefund: boolean;
  needsReference: boolean;
  active: boolean;
}

const empty: Form = { code: "", name: "", kind: "card", allowRefund: true, needsReference: true, active: true };

export default function PaymentMethodsPage() {
  const { user } = useAuth();
  const canEdit = posRights(user).setup;
  const methods = usePaymentMethods();
  const [editing, setEditing] = useState<PaymentMethodDto | "new" | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(m: PaymentMethodDto | "new") {
    setErrors({});
    setError(null);
    setForm(m === "new" ? empty : { code: m.code, name: m.name, kind: m.kind, allowRefund: m.allowRefund, needsReference: m.needsReference, active: m.active });
    setEditing(m);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body = { name: form.name, kind: form.kind, allowRefund: form.allowRefund, needsReference: form.needsReference, active: form.active };
    const parsed = editing === "new" ? paymentMethodSchema.safeParse({ ...body, code: form.code }) : updatePaymentMethodSchema.safeParse(body);
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post("/pos/payment-methods", parsed.data);
      else if (editing) await api.patch(`/pos/payment-methods/${editing.id}`, parsed.data);
      setEditing(null);
      await methods.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<PaymentMethodDto>[] = [
    { key: "name", header: "Payment method", render: (m) => m.name },
    { key: "code", header: "Code", render: (m) => <span className="mono">{m.code}</span> },
    { key: "kind", header: "Kind", render: (m) => PAYMENT_KIND_LABELS[m.kind] ?? m.kind },
    {
      key: "rules",
      header: "Rules",
      render: (m) => (
        <span className="row-actions">
          {m.allowRefund ? <Badge kind="neutral">Refunds allowed</Badge> : <Badge kind="off">No refunds</Badge>}
          {m.needsReference ? <Badge kind="neutral">Needs reference</Badge> : null}
        </span>
      ),
    },
    { key: "active", header: "Status", render: (m) => <ActiveBadge active={m.active} /> },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            render: (m: PaymentMethodDto) => (
              <Button size="small" onClick={() => open(m)}>
                Edit
              </Button>
            ),
          } satisfies Column<PaymentMethodDto>,
        ]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Payment methods</h1>
        <span className="spacer" />
        {canEdit ? (
          <Button variant="primary" onClick={() => open("new")}>
            Add payment method
          </Button>
        ) : null}
      </div>
      <p className="muted">How customers can pay at the tills. Card and UPI are recorded with their approval code or reference; the card machine and UPI QR stay separate.</p>
      <Alert kind="error">{methods.error}</Alert>
      <DataTable columns={columns} rows={methods.data} rowKey={(m) => m.id} loading={methods.loading} empty="No payment methods." />

      <Dialog open={editing !== null} title={editing === "new" ? "Add payment method" : `Edit payment method: ${form.name}`} onClose={() => setEditing(null)}>
        <form onSubmit={submit} noValidate>
          <Alert kind="error">{error}</Alert>
          {editing === "new" ? (
            <TextInput id="pm-code" label="Code" required className="mono" value={form.code} error={errors.code} hint="For example PAYTM. Cannot be changed later." autoComplete="off" onChange={(e) => setForm({ ...form, code: e.target.value })} />
          ) : null}
          <TextInput id="pm-name" label="Name" required value={form.name} error={errors.name} autoComplete="off" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <SelectInput id="pm-kind" label="Kind" value={form.kind} error={errors.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as PaymentKind })}>
            {Object.entries(PAYMENT_KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </SelectInput>
          <CheckInput id="pm-refund" label="Can be used for refunds" checked={form.allowRefund} onChange={(e) => setForm({ ...form, allowRefund: e.target.checked })} />
          <CheckInput id="pm-reference" label="Needs a reference" description="The cashier must type the card approval code or UPI reference." checked={form.needsReference} onChange={(e) => setForm({ ...form, needsReference: e.target.checked })} />
          <CheckInput id="pm-active" label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
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
