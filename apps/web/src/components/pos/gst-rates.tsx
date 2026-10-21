// Copyright (c) 2026, Rademics. All rights reserved.
// The HSN GST rate list (decision 56; plan 06 answer 1): enter, approve.
// Plan 08 G2: exempt and nil-rated kept apart from 0%, and price bands (a rate
// chosen by the selling price per unit, GST included, e.g. clothing).
"use client";

import { useState, type FormEvent } from "react";
import { gstRateSchema } from "shared";
import { Alert, Badge, Button, DataTable, Dialog, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate, formatDateTime } from "@/lib/format";
import { showQuantity } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { type GstRateDto, posRights } from "./pos-shared";

interface Form {
  hsnCode: string;
  rate: string;
  cessRate: string;
  effectiveFrom: string;
  note: string;
  kind: "taxable" | "exempt" | "nil";
  priceFrom: string;
  priceUpTo: string;
}

const empty: Form = { hsnCode: "", rate: "", cessRate: "0", effectiveFrom: "", note: "", kind: "taxable", priceFrom: "", priceUpTo: "" };

const KIND_LABELS = { taxable: "Taxable", exempt: "Exempt", nil: "Nil-rated" } as const;

/** "Up to ₹2,500", "Above ₹2,500", "Above ₹1,000 up to ₹2,500" or "Any price". */
export function bandText(r: Pick<GstRateDto, "priceFrom" | "priceUpTo">): string {
  const from = r.priceFrom ? `above ₹${r.priceFrom}` : "";
  const to = r.priceUpTo ? `up to ₹${r.priceUpTo}` : "";
  const text = [from, to].filter(Boolean).join(" ");
  return text ? text[0].toUpperCase() + text.slice(1) : "Any price";
}

export function GstRatesView() {
  const { user } = useAuth();
  const rights = posRights(user);
  const rates = useLoad(() => api.get<GstRateDto[]>("/pos/gst-rates"));
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<GstRateDto | "new" | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState<GstRateDto | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  function open(r: GstRateDto | "new") {
    setErrors({});
    setError(null);
    setForm(r === "new" ? empty : { hsnCode: r.hsnCode, rate: showQuantity(r.rate), cessRate: showQuantity(r.cessRate), effectiveFrom: r.effectiveFrom, note: r.note ?? "", kind: r.kind ?? "taxable", priceFrom: r.priceFrom ?? "", priceUpTo: r.priceUpTo ?? "" });
    setEditing(r);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = gstRateSchema.safeParse({
      hsnCode: form.hsnCode.trim(),
      rate: form.kind === "taxable" ? form.rate.trim() : "0",
      cessRate: form.cessRate.trim() || null,
      effectiveFrom: form.effectiveFrom,
      note: form.note.trim() || null,
      kind: form.kind,
      priceFrom: form.priceFrom.trim() || null,
      priceUpTo: form.priceUpTo.trim() || null,
    });
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post("/pos/gst-rates", parsed.data);
      else if (editing) {
        const { hsnCode: _hsn, ...rest } = parsed.data;
        void _hsn;
        await api.patch(`/pos/gst-rates/${editing.id}`, rest);
      }
      setEditing(null);
      await rates.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!approving) return;
    setApproveError(null);
    setBusy(true);
    try {
      await api.post(`/pos/gst-rates/${approving.id}/approve`);
      setApproving(null);
      await rates.reload();
    } catch (err) {
      setApproveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const term = search.trim();
  const rows = (rates.data ?? []).filter((r) => !term || r.hsnCode.startsWith(term));
  const pending = (rates.data ?? []).filter((r) => !r.approved).length;

  const columns: Column<GstRateDto>[] = [
    { key: "hsn", header: "HSN code", render: (r) => <span className="mono">{r.hsnCode}</span> },
    { key: "rate", header: "GST %", align: "right", render: (r) => (r.kind && r.kind !== "taxable" ? KIND_LABELS[r.kind] : showQuantity(r.rate)) },
    { key: "band", header: "Selling price per piece", render: (r) => bandText(r) },
    { key: "cess", header: "Cess %", align: "right", render: (r) => showQuantity(r.cessRate) },
    { key: "from", header: "Starts on", render: (r) => formatDate(r.effectiveFrom) },
    { key: "note", header: "Note", render: (r) => r.note ?? <span className="muted">—</span> },
    {
      key: "approved",
      header: "Approved",
      render: (r) => (r.approved ? <Badge kind="ok">Approved {formatDateTime(r.approvedAt)}</Badge> : <Badge kind="warn">Not approved yet</Badge>),
    },
    {
      key: "actions",
      header: "",
      render: (r) =>
        r.approved ? null : (
          <span className="row-actions">
            {rights.gstManage ? (
              <Button size="small" onClick={() => open(r)}>
                Edit
              </Button>
            ) : null}
            {rights.gstApprove ? (
              <Button
                size="small"
                variant="primary"
                onClick={() => {
                  setApproveError(null);
                  setApproving(r);
                }}
              >
                Approve
              </Button>
            ) : null}
          </span>
        ),
    },
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>GST rates</h1>
        <span className="spacer" />
        {rights.gstManage ? (
          <Button variant="primary" onClick={() => open("new")}>
            Add a rate
          </Button>
        ) : null}
      </div>
      <p className="muted">
        The GST rate for each HSN code and the date it starts. Till bills using a rate that is not approved yet are marked provisional. An approved rate cannot be changed: add a new rate with a later start date.
      </p>
      {pending ? <Alert kind="info">{pending} rate{pending === 1 ? " is" : "s are"} waiting for the accountant’s approval.</Alert> : null}
      <div className="filter-row">
        <TextInput id="gst-search" label="HSN code" placeholder="Starts with…" inputMode="numeric" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Alert kind="error">{rates.error}</Alert>
      <DataTable columns={columns} rows={rates.data ? rows : null} rowKey={(r) => r.id} loading={rates.loading} empty="No GST rates yet." />

      <Dialog open={editing !== null} title={editing === "new" ? "Add a GST rate" : `Edit rate for HSN ${form.hsnCode}`} onClose={() => setEditing(null)}>
        <form onSubmit={submit} noValidate>
          <Alert kind="error">{error}</Alert>
          <TextInput id="gst-hsn" label="HSN code" required className="mono" inputMode="numeric" value={form.hsnCode} error={errors.hsnCode} disabled={editing !== "new"} hint="4, 6 or 8 digits." autoComplete="off" onChange={(e) => setForm({ ...form, hsnCode: e.target.value })} />
          <SelectInput id="gst-kind" label="Kind" value={form.kind} error={errors.kind} hint="Exempt and nil-rated goods carry no GST and are reported apart from a 0% rate." onChange={(e) => setForm({ ...form, kind: e.target.value as Form["kind"] })}>
            <option value="taxable">Taxable</option>
            <option value="exempt">Exempt</option>
            <option value="nil">Nil-rated</option>
          </SelectInput>
          {form.kind === "taxable" ? (
            <TextInput id="gst-rate" label="GST %" required inputMode="decimal" value={form.rate} error={errors.rate} hint="The full rate, for example 18 (split into CGST 9 + SGST 9)." onChange={(e) => setForm({ ...form, rate: e.target.value })} />
          ) : null}
          <TextInput id="gst-price-from" label="Only above this selling price per piece (₹)" inputMode="decimal" value={form.priceFrom} error={errors.priceFrom} hint="Leave both prices empty when the rate does not depend on the price. GST included." onChange={(e) => setForm({ ...form, priceFrom: e.target.value })} />
          <TextInput id="gst-price-up-to" label="Only up to this selling price per piece (₹)" inputMode="decimal" value={form.priceUpTo} error={errors.priceUpTo} hint="For example 5% up to ₹2,500 and a second rate of 18% above ₹2,500." onChange={(e) => setForm({ ...form, priceUpTo: e.target.value })} />
          <TextInput id="gst-cess" label="Cess %" inputMode="decimal" value={form.cessRate} error={errors.cessRate} onChange={(e) => setForm({ ...form, cessRate: e.target.value })} />
          <TextInput id="gst-from" label="Starts on" type="date" required value={form.effectiveFrom} error={errors.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
          <TextInput id="gst-note" label="Note" value={form.note} error={errors.note} hint="For example the government notification number." onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="actions">
            <Button type="submit" variant="primary" busy={busy}>
              Save
            </Button>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={approving !== null} title="Approve this GST rate?" onClose={() => setApproving(null)}>
        {approving ? (
          <>
            <p>
              HSN <span className="mono">{approving.hsnCode}</span>: {showQuantity(approving.rate)}% GST from {formatDate(approving.effectiveFrom)}.
            </p>
            <Alert kind="info">Approve only after the Chartered Accountant has signed off this rate. Once approved it cannot be changed, and the tills charge it as real GST.</Alert>
            <Alert kind="error">{approveError}</Alert>
            <div className="actions">
              <Button variant="primary" busy={busy} onClick={() => void approve()}>
                Yes, the accountant has signed off
              </Button>
              <Button onClick={() => setApproving(null)}>Cancel</Button>
            </div>
          </>
        ) : null}
      </Dialog>
    </>
  );
}
