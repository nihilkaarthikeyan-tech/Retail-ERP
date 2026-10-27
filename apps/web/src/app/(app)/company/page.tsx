// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createGstRegistrationSchema, hasPermission, INDIAN_STATES, updateCompanySchema, updateGstRegistrationSchema } from "shared";
import { AddressFields, addressFrom, addressPayload, type AddressValues, emptyAddress } from "@/components/address-fields";
import { ActiveBadge, Alert, Badge, Button, CheckInput, DataTable, Dialog, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { blankToNull } from "@/lib/format";
import type { CompanyDto, GstRegistrationDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface CompanyForm {
  legalName: string;
  tradeName: string;
  pan: string;
  phone: string;
  email: string;
  address: AddressValues;
}

function companyForm(c: CompanyDto): CompanyForm {
  return {
    legalName: c.legalName,
    tradeName: c.tradeName ?? "",
    pan: c.pan ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    address: addressFrom(c),
  };
}

function CompanyDetails({ canManage }: { canManage: boolean }) {
  const company = useLoad(() => api.get<CompanyDto>("/company"));
  if (company.error) return <Alert kind="error">{company.error}</Alert>;
  if (!company.data) return <p className="muted">Loading…</p>;
  return <CompanyDetailsForm key={company.data.id} company={company.data} canManage={canManage} onSaved={company.setData} />;
}

function CompanyDetailsForm({ company: c, canManage, onSaved }: { company: CompanyDto; canManage: boolean; onSaved: (c: CompanyDto) => void }) {
  const [form, setForm] = useState<CompanyForm>(() => companyForm(c));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof Omit<CompanyForm, "address">) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const payload = {
      legalName: form.legalName,
      tradeName: blankToNull(form.tradeName),
      pan: blankToNull(form.pan),
      phone: blankToNull(form.phone),
      email: blankToNull(form.email),
      ...addressPayload(form.address),
      stateCode: form.address.stateCode || undefined,
    };
    const parsed = updateCompanySchema.safeParse(payload);
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      const updated = await api.patch<CompanyDto>("/company", parsed.data);
      setForm(companyForm(updated));
      setSaved(true);
      onSaved(updated);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="card">
      <dl className="kv">
        <dt>Code</dt>
        <dd className="mono">{c.code}</dd>
        <dt>Home currency</dt>
        <dd>{c.homeCurrency}</dd>
        <dt>Financial year starts</dt>
        <dd>{new Date(2000, c.fiscalYearStartMonth - 1, 1).toLocaleString("en-IN", { month: "long" })}</dd>
      </dl>
      <h2>Details</h2>
      <Alert kind="error">{error}</Alert>
      {saved ? <Alert kind="success">Company details saved.</Alert> : null}
      <div className="form-grid">
        <TextInput id="legalName" label="Legal name" value={form.legalName} onChange={set("legalName")} error={errors.legalName} required disabled={!canManage} className="span-2" />
        <TextInput id="tradeName" label="Trade name" value={form.tradeName} onChange={set("tradeName")} error={errors.tradeName} disabled={!canManage} />
        <TextInput id="pan" label="PAN" value={form.pan} onChange={set("pan")} error={errors.pan} disabled={!canManage} />
        <AddressFields idPrefix="company" values={form.address} onChange={(address) => setForm((f) => ({ ...f, address }))} errors={errors} stateRequired stateDisabled={!canManage} />
        <TextInput id="phone" label="Phone" type="tel" value={form.phone} onChange={set("phone")} error={errors.phone} disabled={!canManage} />
        <TextInput id="email" label="Email" type="email" value={form.email} onChange={set("email")} error={errors.email} disabled={!canManage} />
      </div>
      {canManage ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save company
          </Button>
        </div>
      ) : (
        <p className="muted">You can view these details but not change them.</p>
      )}
    </form>
  );
}

interface GstForm {
  gstin: string;
  legalNameOnCertificate: string;
  address: AddressValues;
  isDefault: boolean;
  active: boolean;
}

const emptyGst: GstForm = { gstin: "", legalNameOnCertificate: "", address: emptyAddress, isDefault: false, active: true };

function GstRegistrations({ canManage }: { canManage: boolean }) {
  const regs = useLoad(() => api.get<GstRegistrationDto[]>("/company/gst-registrations"));
  const [editing, setEditing] = useState<GstRegistrationDto | "new" | null>(null);
  const [form, setForm] = useState<GstForm>(emptyGst);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(reg: GstRegistrationDto | "new") {
    setErrors({});
    setError(null);
    setForm(
      reg === "new"
        ? emptyGst
        : {
            gstin: reg.gstin,
            legalNameOnCertificate: reg.legalNameOnCertificate ?? "",
            address: addressFrom(reg),
            isDefault: reg.isDefault,
            active: reg.active,
          },
    );
    setEditing(reg);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const common = {
      legalNameOnCertificate: blankToNull(form.legalNameOnCertificate),
      ...addressPayload(form.address, false),
      isDefault: form.isDefault,
    };
    const parsed =
      editing === "new"
        ? createGstRegistrationSchema.safeParse({ gstin: form.gstin, ...common })
        : updateGstRegistrationSchema.safeParse({ ...common, active: form.active });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post("/company/gst-registrations", parsed.data);
      else if (editing) await api.patch(`/company/gst-registrations/${editing.id}`, parsed.data);
      setEditing(null);
      await regs.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function quick(reg: GstRegistrationDto, patch: { isDefault?: boolean; active?: boolean }) {
    setRowError(null);
    try {
      await api.patch(`/company/gst-registrations/${reg.id}`, patch);
      await regs.reload();
    } catch (err) {
      setRowError(errorMessage(err));
    }
  }

  const columns: Column<GstRegistrationDto>[] = [
    { key: "gstin", header: "GSTIN", render: (r) => <span className="mono">{r.gstin}</span> },
    { key: "state", header: "State", render: (r) => INDIAN_STATES[r.stateCode] ?? r.stateCode },
    { key: "name", header: "Legal name on certificate", render: (r) => r.legalNameOnCertificate ?? "—" },
    { key: "city", header: "City", render: (r) => r.city ?? "—" },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span className="row-actions">
          <ActiveBadge active={r.active} />
          {r.isDefault ? <Badge kind="neutral">Default</Badge> : null}
        </span>
      ),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            render: (r: GstRegistrationDto) => (
              <span className="row-actions">
                <Button size="small" onClick={() => open(r)}>
                  Edit
                </Button>
                {!r.isDefault && r.active ? (
                  <Button size="small" onClick={() => quick(r, { isDefault: true })}>
                    Set default
                  </Button>
                ) : null}
                {r.active ? (
                  <Button size="small" variant="danger" onClick={() => quick(r, { active: false })} disabled={r.isDefault}>
                    Switch off
                  </Button>
                ) : (
                  <Button size="small" onClick={() => quick(r, { active: true })}>
                    Switch on
                  </Button>
                )}
              </span>
            ),
          } satisfies Column<GstRegistrationDto>,
        ]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>GST registrations</h2>
        <span className="spacer" />
        {canManage ? (
          <Button variant="primary" onClick={() => open("new")}>
            Add registration
          </Button>
        ) : null}
      </div>
      <Alert kind="error">{rowError ?? regs.error}</Alert>
      <DataTable columns={columns} rows={regs.data} rowKey={(r) => r.id} loading={regs.loading} empty="No GST registration yet." />

      <Dialog open={editing !== null} title={editing === "new" ? "Add GST registration" : "Edit GST registration"} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          <div className="form-grid">
            {editing === "new" ? (
              <TextInput id="gst-gstin" label="GSTIN" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} error={errors.gstin} required className="span-2" hint="15 characters; the first two are the state code." />
            ) : (
              <p className="span-2">
                GSTIN <span className="mono">{form.gstin}</span>
              </p>
            )}
            <TextInput id="gst-legalName" label="Legal name on certificate" value={form.legalNameOnCertificate} onChange={(e) => setForm({ ...form, legalNameOnCertificate: e.target.value })} error={errors.legalNameOnCertificate} className="span-2" />
            <AddressFields idPrefix="gst" values={form.address} onChange={(address) => setForm({ ...form, address })} errors={errors} withState={false} />
            <div className="span-2">
              <CheckInput id="gst-isDefault" label="Default registration" description="Used when a store has no registration of its own." checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              {editing !== "new" ? (
                <CheckInput id="gst-active" label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              ) : null}
            </div>
          </div>
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

export default function CompanyPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "company.manage");
  return (
    <>
      <h1>Company</h1>
      <CompanyDetails canManage={canManage} />
      <GstRegistrations canManage={canManage} />
    </>
  );
}
