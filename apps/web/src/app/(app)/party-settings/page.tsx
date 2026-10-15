// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { hasPermission, updatePartySettingsSchema } from "shared";
import { Alert, Button, RadioInput, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { flattenGroups } from "@/lib/catalogue";
import type { PartyGroupNode, PartySettingsDto, PaymentTermsDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface SettingsForm {
  defaultCustomerGroupId: string;
  defaultSupplierGroupId: string;
  defaultPaymentTermsId: string;
  defaultCreditLimit: string;
  gstTreatmentFrom: "billing" | "delivery";
}

function fromDto(s: PartySettingsDto): SettingsForm {
  return {
    defaultCustomerGroupId: s.defaultCustomerGroupId ?? "",
    defaultSupplierGroupId: s.defaultSupplierGroupId ?? "",
    defaultPaymentTermsId: s.defaultPaymentTermsId ?? "",
    defaultCreditLimit: s.defaultCreditLimit,
    gstTreatmentFrom: s.gstTreatmentFrom,
  };
}

interface FormProps {
  settings: PartySettingsDto;
  customerGroups: PartyGroupNode[];
  supplierGroups: PartyGroupNode[] | null;
  terms: PaymentTermsDto[];
  canEdit: boolean;
  onSaved: (s: PartySettingsDto) => void;
}

function PartySettingsForm({ settings, customerGroups, supplierGroups, terms, canEdit, onSaved }: FormProps) {
  const [form, setForm] = useState<SettingsForm>(() => fromDto(settings));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = updatePartySettingsSchema.safeParse({
      defaultCustomerGroupId: form.defaultCustomerGroupId || null,
      ...(supplierGroups ? { defaultSupplierGroupId: form.defaultSupplierGroupId || null } : {}),
      defaultPaymentTermsId: form.defaultPaymentTermsId || null,
      defaultCreditLimit: form.defaultCreditLimit.trim() || "0",
      gstTreatmentFrom: form.gstTreatmentFrom,
    });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      const updated = await api.patch<PartySettingsDto>("/party-settings", parsed.data);
      setForm(fromDto(updated));
      setSaved(true);
      onSaved(updated);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const customerOptions = flattenGroups(customerGroups).filter((g) => g.active || g.id === form.defaultCustomerGroupId);
  const supplierOptions = supplierGroups ? flattenGroups(supplierGroups).filter((g) => g.active || g.id === form.defaultSupplierGroupId) : [];
  const termsOptions = terms.filter((t) => t.active || t.id === form.defaultPaymentTermsId);

  return (
    <form onSubmit={onSubmit} noValidate>
      <Alert kind="error">{error}</Alert>
      {saved ? <Alert kind="success">Party settings saved.</Alert> : null}
      <fieldset disabled={!canEdit}>
        <legend>New customers and suppliers</legend>
        <div className="form-grid">
          <SelectInput id="ps-customerGroup" label="Default customer group" value={form.defaultCustomerGroupId} onChange={(e) => setForm({ ...form, defaultCustomerGroupId: e.target.value })} error={errors.defaultCustomerGroupId} hint="Used for quick add at the till and when no group is chosen.">
            <option value="">None</option>
            {customerOptions.map((g) => (
              <option key={g.id} value={g.id} disabled={!g.isLeaf}>
                {g.label}
              </option>
            ))}
          </SelectInput>
          <SelectInput id="ps-supplierGroup" label="Default supplier group" value={form.defaultSupplierGroupId} onChange={(e) => setForm({ ...form, defaultSupplierGroupId: e.target.value })} error={errors.defaultSupplierGroupId} disabled={!supplierGroups}>
            <option value="">None</option>
            {supplierOptions.map((g) => (
              <option key={g.id} value={g.id} disabled={!g.isLeaf}>
                {g.label}
              </option>
            ))}
          </SelectInput>
          <SelectInput id="ps-terms" label="Default payment terms" value={form.defaultPaymentTermsId} onChange={(e) => setForm({ ...form, defaultPaymentTermsId: e.target.value })} error={errors.defaultPaymentTermsId} hint="When neither the party nor its group names terms.">
            <option value="">None</option>
            {termsOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectInput>
          <TextInput id="ps-creditLimit" label="Default credit limit" value={form.defaultCreditLimit} onChange={(e) => setForm({ ...form, defaultCreditLimit: e.target.value })} error={errors.defaultCreditLimit} inputMode="decimal" className="mono" hint="0 = no credit until a credit controller sets a limit (agreed default)." />
        </div>
      </fieldset>
      <fieldset disabled={!canEdit}>
        <legend>GST: which address decides same-state or other-state</legend>
        <div className="check-list" role="radiogroup" aria-label="GST treatment from">
          <RadioInput id="ps-gst-billing" name="gstTreatmentFrom" value="billing" label="Billing address" checked={form.gstTreatmentFrom === "billing"} onChange={() => setForm({ ...form, gstTreatmentFrom: "billing" })} />
          <RadioInput id="ps-gst-delivery" name="gstTreatmentFrom" value="delivery" label="Delivery address" checked={form.gstTreatmentFrom === "delivery"} onChange={() => setForm({ ...form, gstTreatmentFrom: "delivery" })} />
        </div>
      </fieldset>
      {canEdit ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save settings
          </Button>
        </div>
      ) : (
        <p className="muted">Only the Owner / Admin can change these settings.</p>
      )}
    </form>
  );
}

export default function PartySettingsPage() {
  const { user } = useAuth();
  const canEdit = user?.isOwnerAdmin ?? false;
  const canSeeSuppliers = hasPermission(user, "suppliers.view");
  const settings = useLoad(() => api.get<PartySettingsDto>("/party-settings"));
  const customerGroups = useLoad(() => api.get<PartyGroupNode[]>("/customer-groups"));
  const supplierGroups = useLoad<PartyGroupNode[] | null>(() => (canSeeSuppliers ? api.get<PartyGroupNode[]>("/supplier-groups") : Promise.resolve(null)), [canSeeSuppliers]);
  const terms = useLoad(() => api.get<PaymentTermsDto[]>("/payment-terms"));

  return (
    <>
      <h1>Party settings</h1>
      <p className="muted">Defaults for new customers and suppliers. One set per company.</p>
      <Alert kind="error">{settings.error ?? customerGroups.error ?? supplierGroups.error ?? terms.error}</Alert>
      {settings.data && customerGroups.data && !supplierGroups.loading && terms.data ? (
        <PartySettingsForm key={settings.data.updatedAt} settings={settings.data} customerGroups={customerGroups.data} supplierGroups={supplierGroups.data} terms={terms.data} canEdit={canEdit} onSaved={settings.setData} />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </>
  );
}
