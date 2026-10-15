// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { businessDate, createPaymentTermsSchema, hasPermission, updatePaymentTermsSchema } from "shared";
import { newPart, partFromDto, partsPayload, partsSharesProblem, TermsPartsEditor, type PartValues } from "@/components/parties/terms-parts-editor";
import { ActiveBadge, Alert, Button, CheckInput, DataTable, Dialog, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { describePart } from "@/lib/parties";
import type { DueDateResult, PaymentTermsDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface TermsForm {
  code: string;
  name: string;
  active: boolean;
  parts: PartValues[];
}

const emptyTerms = (): TermsForm => ({ code: "", name: "", active: true, parts: [newPart()] });

/** "Try it": pick terms and a bill date, the API works out the due dates. */
function TryIt({ terms }: { terms: PaymentTermsDto[] }) {
  const [termsId, setTermsId] = useState("");
  const [from, setFrom] = useState(() => businessDate());
  const [result, setResult] = useState<DueDateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = terms.find((t) => t.id === termsId) ?? terms[0];

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      setResult(await api.get<DueDateResult>(`/payment-terms/${chosen.id}/due-date${query({ from })}`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={run} className="card" noValidate>
      <h2 style={{ marginTop: 0 }}>Try it</h2>
      <p className="muted">Pick terms and a bill date to see when each part falls due.</p>
      <div className="filter-row">
        <SelectInput id="try-terms" label="Payment terms" value={chosen?.id ?? ""} onChange={(e) => setTermsId(e.target.value)}>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectInput>
        <TextInput id="try-from" label="Bill date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <Button type="submit" busy={busy} disabled={!chosen}>
        Show due dates
      </Button>
      <Alert kind="error">{error}</Alert>
      {result ? (
        <div style={{ marginTop: 12 }}>
          <ul>
            {result.parts.map((p, i) => (
              <li key={i}>
                {p.share}% due on <strong>{formatDate(p.dueDate)}</strong>
              </li>
            ))}
          </ul>
          <p>
            Bill fully due on <strong>{formatDate(result.dueDate)}</strong>.
          </p>
        </div>
      ) : null}
    </form>
  );
}

export default function PaymentTermsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "payment_terms.manage");
  const terms = useLoad(() => api.get<PaymentTermsDto[]>("/payment-terms"));
  const [editing, setEditing] = useState<PaymentTermsDto | "new" | null>(null);
  const [form, setForm] = useState<TermsForm>(emptyTerms);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(t: PaymentTermsDto | "new") {
    setErrors({});
    setError(null);
    setForm(t === "new" ? emptyTerms() : { code: t.code, name: t.name, active: t.active, parts: t.parts.map(partFromDto) });
    setEditing(t);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parts = partsPayload(form.parts);
    const parsed =
      editing === "new" ? createPaymentTermsSchema.safeParse({ code: form.code, name: form.name, parts }) : updatePaymentTermsSchema.safeParse({ name: form.name, active: form.active, parts });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success || partsSharesProblem(form.parts)) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post("/payment-terms", parsed.data);
      else if (editing) await api.patch(`/payment-terms/${editing.id}`, parsed.data);
      setEditing(null);
      await terms.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<PaymentTermsDto>[] = [
    { key: "name", header: "Name", render: (t) => t.name },
    { key: "code", header: "Code", render: (t) => <span className="mono">{t.code}</span> },
    {
      key: "parts",
      header: "Parts",
      render: (t) => (
        <ul className="changes">
          {t.parts.map((p, i) => (
            <li key={i}>
              {describePart(p)}
              {p.earlyDiscountPercent ? <span className="muted"> ({p.earlyDiscountPercent}% off if paid within {p.earlyDiscountDays ?? 0} days)</span> : null}
            </li>
          ))}
        </ul>
      ),
    },
    { key: "active", header: "Status", render: (t) => <ActiveBadge active={t.active} /> },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            render: (t: PaymentTermsDto) => (
              <Button size="small" onClick={() => open(t)}>
                Edit
              </Button>
            ),
          } satisfies Column<PaymentTermsDto>,
        ]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Payment terms</h1>
        <span className="spacer" />
        {canManage ? (
          <Button variant="primary" onClick={() => open("new")}>
            Add payment terms
          </Button>
        ) : null}
      </div>
      <p className="muted">When customers and suppliers must pay. A bill can be split into parts (for example 50% in advance and 50% on delivery); the shares must add up to 100%.</p>
      <Alert kind="error">{terms.error}</Alert>
      <DataTable columns={columns} rows={terms.data} rowKey={(t) => t.id} loading={terms.loading} empty="No payment terms." />
      {terms.data && terms.data.length > 0 ? <TryIt terms={terms.data} /> : null}

      <Dialog open={editing !== null} title={editing === "new" ? "Add payment terms" : `Edit payment terms: ${form.name}`} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          {editing === "new" ? (
            <TextInput id="terms-code" label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={errors.code} required className="mono" hint="Letters, digits, - . and /; cannot be changed later." autoComplete="off" />
          ) : null}
          <TextInput id="terms-name" label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} required autoComplete="off" />
          <TermsPartsEditor parts={form.parts} onChange={(parts) => setForm({ ...form, parts })} errors={errors} />
          {editing !== "new" ? <CheckInput id="terms-active" label="Active" description="Switched-off terms cannot be given to new parties." checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> : null}
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
