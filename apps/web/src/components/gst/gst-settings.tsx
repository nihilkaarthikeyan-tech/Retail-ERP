// Copyright (c) 2026, Rademics. All rights reserved.
// GST settings (plan 08 §5) and "GST settings approved by the CA" (scenario
// 8.11). Every setting has a default; until the accountant approves them every
// bill stays provisional and the tills cannot be switched live.
"use client";

import { type FormEvent, useState } from "react";
import { defaultHsnDigits, type GstSettingsInput, gstSettingsSchema, hasPermission } from "shared";
import { Alert, Badge, Button, CheckInput, Dialog, SelectInput, TextInput, TextareaInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDateTime } from "@/lib/format";
import { useModules } from "@/lib/modules";
import { useLoad } from "@/lib/use-load";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

export interface GstSettingsDto {
  scheme: "regular" | "composition";
  filingFrequency: "monthly" | "quarterly";
  turnoverBand: "up_to_5cr" | "5cr_to_10cr" | "above_10cr" | "above_500cr";
  hsnDigits: 4 | 6 | 8;
  eInvoiceApplies: boolean;
  combineSmallSales: boolean;
  freeSampleTax: "not_set" | "reverse_input_credit" | "tax_on_value";
  receiptTaxTable: boolean;
  eWayLimit: string;
  eWayStateLimits: Record<string, string>;
  defaultTransporterId: string | null;
  defaultTransporterName: string | null;
  approved: boolean;
  approvedAt: string | null;
  approvedById: string | null;
  approvalNote: string | null;
}

export const TURNOVER_LABELS: Record<GstSettingsDto["turnoverBand"], string> = {
  up_to_5cr: "Up to ₹5 crore",
  "5cr_to_10cr": "Above ₹5 crore, below ₹10 crore",
  above_10cr: "₹10 crore and above",
  above_500cr: "Above ₹500 crore",
};

const FREE_SAMPLE_LABELS: Record<GstSettingsDto["freeSampleTax"], string> = {
  not_set: "Not set yet (the accountant decides)",
  reverse_input_credit: "No tax on the sample; input credit on it is reversed",
  tax_on_value: "Tax on the value of the sample",
};

function Form({ s, canEdit, onSaved }: { s: GstSettingsDto; canEdit: boolean; onSaved: (s: GstSettingsDto) => void }) {
  const [form, setForm] = useState(s);
  // Plan 12: e-invoice and e-way bill settings only while those modules are on (their values are kept).
  const { isOn } = useModules();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof GstSettingsDto>(k: K, v: GstSettingsDto[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const input: GstSettingsInput = {
      scheme: form.scheme,
      filingFrequency: form.filingFrequency,
      turnoverBand: form.turnoverBand,
      hsnDigits: form.hsnDigits,
      eInvoiceApplies: form.eInvoiceApplies,
      combineSmallSales: form.combineSmallSales,
      freeSampleTax: form.freeSampleTax,
      receiptTaxTable: form.receiptTaxTable,
      eWayLimit: form.eWayLimit.trim(),
      defaultTransporterId: form.defaultTransporterId?.trim() || null,
      defaultTransporterName: form.defaultTransporterName?.trim() || null,
    };
    const parsed = gstSettingsSchema.safeParse(input);
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      onSaved(await api.patch<GstSettingsDto>("/gst/settings", parsed.data));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="card">
      <h2 style={{ marginTop: 0 }}>Registration and returns</h2>
      <Alert kind="error">{error}</Alert>
      {saved ? <Alert kind="success">GST settings saved.</Alert> : null}
      <div className="form-grid">
        <SelectInput id="gst-scheme" label="GST scheme" value={form.scheme} disabled={!canEdit} error={errors.scheme} hint="Composition: bills of supply with no GST, and no input credit." onChange={(e) => set("scheme", e.target.value as GstSettingsDto["scheme"])}>
          <option value="regular">Regular (tax invoices with GST)</option>
          <option value="composition">Composition scheme (bills of supply)</option>
        </SelectInput>
        <SelectInput id="gst-filing" label="Returns filed" value={form.filingFrequency} disabled={!canEdit} error={errors.filingFrequency} onChange={(e) => set("filingFrequency", e.target.value as GstSettingsDto["filingFrequency"])}>
          <option value="quarterly">Quarterly (turnover up to ₹5 crore)</option>
          <option value="monthly">Monthly</option>
        </SelectInput>
        <SelectInput
          id="gst-turnover"
          label="Turnover band (previous year, all GSTINs of the PAN)"
          value={form.turnoverBand}
          disabled={!canEdit}
          error={errors.turnoverBand}
          onChange={(e) => {
            const band = e.target.value as GstSettingsDto["turnoverBand"];
            setForm((f) => ({ ...f, turnoverBand: band, hsnDigits: defaultHsnDigits(band) }));
            setSaved(false);
          }}
        >
          {Object.entries(TURNOVER_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="gst-hsn-digits" label="HSN digits on invoices" value={String(form.hsnDigits)} disabled={!canEdit} error={errors.hsnDigits} hint="4 digits up to ₹5 crore, 6 above." onChange={(e) => set("hsnDigits", Number(e.target.value) as GstSettingsDto["hsnDigits"])}>
          <option value="4">4 digits</option>
          <option value="6">6 digits</option>
          <option value="8">8 digits</option>
        </SelectInput>
      </div>
      <h2>Documents</h2>
      {isOn("einvoice") ? <CheckInput id="gst-einvoice" label="E-invoicing applies to this business" description="Business invoices are registered on the e-invoice portal (turnover above ₹5 crore)." checked={form.eInvoiceApplies} disabled={!canEdit} onChange={(e) => set("eInvoiceApplies", e.target.checked)} /> : null}
      <CheckInput id="gst-tax-table" label="Show the GST table on till receipts" checked={form.receiptTaxTable} disabled={!canEdit} onChange={(e) => set("receiptTaxTable", e.target.checked)} />
      <CheckInput id="gst-small-sales" label="Show sales under ₹200 as one combined daily invoice in the reports" description="Every bill is still recorded; this only changes the report." checked={form.combineSmallSales} disabled={!canEdit} onChange={(e) => set("combineSmallSales", e.target.checked)} />
      <SelectInput id="gst-free-samples" label="Free samples" value={form.freeSampleTax} disabled={!canEdit} error={errors.freeSampleTax} onChange={(e) => set("freeSampleTax", e.target.value as GstSettingsDto["freeSampleTax"])}>
        {Object.entries(FREE_SAMPLE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </SelectInput>
      {isOn("eway") ? (
      <>
      <h2>Moving goods</h2>
      <div className="form-grid">
        <TextInput id="gst-eway-limit" label="E-way bill needed above (₹)" inputMode="decimal" value={form.eWayLimit} disabled={!canEdit} error={errors.eWayLimit} onChange={(e) => set("eWayLimit", e.target.value)} />
        <TextInput id="gst-transporter-id" label="Usual transporter's GSTIN or id" value={form.defaultTransporterId ?? ""} disabled={!canEdit} error={errors.defaultTransporterId} onChange={(e) => set("defaultTransporterId", e.target.value)} />
        <TextInput id="gst-transporter-name" label="Usual transporter's name" value={form.defaultTransporterName ?? ""} disabled={!canEdit} error={errors.defaultTransporterName} onChange={(e) => set("defaultTransporterName", e.target.value)} />
      </div>
      </>
      ) : null}
      {canEdit ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save GST settings
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function Approval({ s, canApprove, onChanged }: { s: GstSettingsDto; canApprove: boolean; onChanged: (s: GstSettingsDto) => void }) {
  const [asking, setAsking] = useState<"approve" | "withdraw" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setError(null);
    if (!note.trim()) return setError(asking === "approve" ? "Write what the accountant approved" : "Write why the approval is taken back");
    setBusy(true);
    try {
      onChanged(asking === "approve" ? await api.post<GstSettingsDto>("/gst/settings/approve", { note: note.trim() }) : await api.post<GstSettingsDto>("/gst/settings/withdraw-approval", { reason: note.trim() }));
      setAsking(null);
      setNote("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Approval by the Chartered Accountant</h2>
      {s.approved ? (
        <p>
          <Badge kind="ok">Approved {formatDateTime(s.approvedAt)}</Badge> {s.approvalNote}
        </p>
      ) : (
        <Alert kind="info">Not approved yet. Until the accountant approves the GST settings and rates, every bill is marked provisional and the tills cannot be switched live.</Alert>
      )}
      {canApprove ? (
        <div className="actions">
          {s.approved ? (
            <Button onClick={() => setAsking("withdraw")}>Take the approval back</Button>
          ) : (
            <Button variant="primary" onClick={() => setAsking("approve")}>
              Record the accountant’s approval
            </Button>
          )}
        </div>
      ) : null}
      <Dialog open={asking !== null} title={asking === "approve" ? "Approve the GST settings?" : "Take the approval back?"} onClose={() => setAsking(null)}>
        {asking === "approve" ? <Alert kind="info">Approve only after the Chartered Accountant has signed off the GST settings and rates. Who approved and when are kept.</Alert> : <Alert kind="info">Bills become provisional again and the tills are switched off live billing until it is approved again.</Alert>}
        <TextareaInput id="gst-approval-note" label={asking === "approve" ? "Note (for example the accountant's name and letter date)" : "Reason"} value={note} onChange={(e) => setNote(e.target.value)} />
        <Alert kind="error">{error}</Alert>
        <div className="actions">
          <Button variant="primary" busy={busy} onClick={() => void confirm()}>
            {asking === "approve" ? "Yes, the accountant has signed off" : "Take it back"}
          </Button>
          <Button onClick={() => setAsking(null)}>Cancel</Button>
        </div>
      </Dialog>
    </section>
  );
}

export function GstSettingsView() {
  const { user } = useAuth();
  const settings = useLoad(() => api.get<GstSettingsDto>("/gst/settings"));
  const canEdit = !!user && hasPermission(user, "gst_rates.manage");
  const canApprove = !!user && hasPermission(user, "gst_rates.approve");
  const s = settings.data;
  return (
    <>
      <h1>GST settings</h1>
      <p className="muted">How GST works for this business. The GST law itself is built in; these settings only say which parts apply to you. Rates per HSN code are under GST rates.</p>
      <Alert kind="error">{settings.error}</Alert>
      {s ? (
        <>
          <Approval s={s} canApprove={canApprove} onChanged={(n) => settings.setData(n)} />
          <Form key={String(s.approvedAt)} s={s} canEdit={canEdit} onSaved={(n) => settings.setData(n)} />
        </>
      ) : null}
    </>
  );
}
