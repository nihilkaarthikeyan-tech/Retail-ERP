// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createSupplierSchema, updateSupplierSchema } from "shared";
import { GstinStateFields } from "@/components/parties/gstin-state-fields";
import { PartyPicker } from "@/components/parties/party-picker";
import { Alert, Button, CheckInput, SelectInput, TextInput, TextareaInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { flattenGroups } from "@/lib/catalogue";
import { blankToNull } from "@/lib/format";
import { panInGstin } from "@/lib/parties";
import type { PartyGroupNode, PartyRef, PartySettingsDto, PaymentTermsDto, PriceListDto, SupplierDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface SupplierFormValues {
  name: string;
  isBusiness: boolean;
  isTransporter: boolean;
  mobile: string;
  email: string;
  notes: string;
  supplierGroupId: string;
  gstin: string;
  pan: string;
  stateCode: string;
  priceListId: string;
  paymentTermsId: string;
  bankAccountNote: string;
  allowBillWithoutOrder: boolean;
  allowBillWithoutReceipt: boolean;
  linkedCustomer: PartyRef | null;
}

function fromSupplier(s: SupplierDto | null, settings: PartySettingsDto | null): SupplierFormValues {
  if (!s) {
    return {
      name: "",
      isBusiness: true,
      isTransporter: false,
      mobile: "",
      email: "",
      notes: "",
      supplierGroupId: settings?.defaultSupplierGroupId ?? "",
      gstin: "",
      pan: "",
      stateCode: "",
      priceListId: "",
      paymentTermsId: settings?.defaultPaymentTermsId ?? "",
      bankAccountNote: "",
      allowBillWithoutOrder: false,
      allowBillWithoutReceipt: false,
      linkedCustomer: null,
    };
  }
  return {
    name: s.name,
    isBusiness: s.isBusiness,
    isTransporter: s.isTransporter,
    mobile: s.mobile ?? "",
    email: s.email ?? "",
    notes: s.notes ?? "",
    supplierGroupId: s.supplierGroup.id,
    gstin: s.gstin ?? "",
    pan: s.pan ?? "",
    stateCode: s.stateCode ?? "",
    priceListId: s.priceList?.id ?? "",
    paymentTermsId: s.paymentTerms?.id ?? "",
    bankAccountNote: s.bankAccountNote ?? "",
    allowBillWithoutOrder: s.allowBillWithoutOrder,
    allowBillWithoutReceipt: s.allowBillWithoutReceipt,
    // The API returns only the customers that point at this supplier, not the supplier's own
    // linkedCustomerId; the first is shown and the field is sent only when it is changed.
    linkedCustomer: s.linkedCustomers[0] ?? null,
  };
}

interface SupplierFormProps {
  supplier: SupplierDto | null;
  groups: PartyGroupNode[];
  priceLists: PriceListDto[] | null;
  terms: PaymentTermsDto[] | null;
  settings: PartySettingsDto | null;
  readOnly?: boolean;
  onSaved: (supplier: SupplierDto) => void;
}

export function SupplierForm({ supplier, groups, priceLists, terms, settings, readOnly = false, onSaved }: SupplierFormProps) {
  const [form, setForm] = useState<SupplierFormValues>(() => fromSupplier(supplier, settings));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  type TextKey = "name" | "mobile" | "email" | "notes" | "supplierGroupId" | "pan" | "priceListId" | "paymentTermsId" | "bankAccountNote";
  const set = (key: TextKey) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setFlag = (key: "isBusiness" | "isTransporter" | "allowBillWithoutOrder" | "allowBillWithoutReceipt") => (e: { target: { checked: boolean } }) =>
    setForm((f) => ({ ...f, [key]: e.target.checked }));

  const panFromGstin = panInGstin(form.gstin);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body = {
      name: form.name,
      isBusiness: form.isBusiness,
      isTransporter: form.isTransporter,
      mobile: blankToNull(form.mobile),
      email: blankToNull(form.email),
      notes: blankToNull(form.notes),
      ...(form.supplierGroupId ? { supplierGroupId: form.supplierGroupId } : {}),
      gstin: blankToNull(form.gstin),
      pan: blankToNull(form.pan),
      stateCode: form.stateCode || null,
      priceListId: form.priceListId || null,
      paymentTermsId: form.paymentTermsId || null,
      bankAccountNote: blankToNull(form.bankAccountNote),
      allowBillWithoutOrder: form.allowBillWithoutOrder,
      allowBillWithoutReceipt: form.allowBillWithoutReceipt,
      ...(!supplier || form.linkedCustomer?.id !== (supplier.linkedCustomers[0]?.id ?? undefined) ? { linkedCustomerId: form.linkedCustomer?.id ?? null } : {}),
    };
    const parsed = supplier ? updateSupplierSchema.safeParse(body) : createSupplierSchema.safeParse(body);
    const issues = issuesToFieldErrors(parsed);
    if (!supplier && !form.supplierGroupId) issues.supplierGroupId = "Choose a group";
    setErrors(issues);
    if (!parsed.success || Object.keys(issues).length > 0) return;
    setBusy(true);
    try {
      const saved = supplier ? await api.patch<SupplierDto>(`/suppliers/${supplier.id}`, parsed.data) : await api.post<SupplierDto>("/suppliers", parsed.data);
      onSaved(saved);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const groupOptions = flattenGroups(groups).filter((g) => g.active || g.id === form.supplierGroupId);
  const listOptions = priceLists?.filter((l) => l.forBuying && (l.active || l.id === form.priceListId)) ?? null;
  const termsOptions = terms?.filter((t) => t.active || t.id === form.paymentTermsId) ?? null;

  return (
    <form onSubmit={onSubmit} noValidate>
      <Alert kind="error">{error}</Alert>
      <fieldset disabled={readOnly}>
        <legend>Details</legend>
        <div className="form-grid">
          <TextInput id="sup-name" label="Name" value={form.name} onChange={set("name")} error={errors.name} required autoComplete="off" />
          <SelectInput id="sup-group" label="Group" value={form.supplierGroupId} onChange={set("supplierGroupId")} error={errors.supplierGroupId} required hint="Only the last level of the tree can hold suppliers.">
            <option value="">Choose a group</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id} disabled={!g.isLeaf}>
                {g.label}
                {g.active ? "" : " (switched off)"}
              </option>
            ))}
          </SelectInput>
          <TextInput id="sup-mobile" label="Mobile" value={form.mobile} onChange={set("mobile")} error={errors.mobile} inputMode="numeric" className="mono" autoComplete="off" hint="10 digits." />
          <TextInput id="sup-email" label="Email" type="email" value={form.email} onChange={set("email")} error={errors.email} autoComplete="off" />
          <TextareaInput id="sup-notes" label="Notes" rows={2} value={form.notes} onChange={set("notes")} error={errors.notes} className="span-2" />
          <div className="span-2 check-row">
            <CheckInput id="sup-isBusiness" label="Business" description="Off = an individual (a local vendor, for example)." checked={form.isBusiness} onChange={setFlag("isBusiness")} />
            <CheckInput id="sup-isTransporter" label="Transporter" description="Carries goods; can be named on e-way bills." checked={form.isTransporter} onChange={setFlag("isTransporter")} />
          </div>
        </div>
      </fieldset>

      <fieldset disabled={readOnly}>
        <legend>Tax</legend>
        <div className="form-grid">
          <GstinStateFields idPrefix="sup" values={{ gstin: form.gstin, stateCode: form.stateCode }} onChange={(v) => setForm((f) => ({ ...f, ...v, pan: panInGstin(v.gstin) ?? f.pan }))} errors={errors} />
          <TextInput id="sup-pan" label="PAN" value={panFromGstin ?? form.pan} onChange={set("pan")} error={errors.pan} className="mono" autoComplete="off" maxLength={10} readOnly={panFromGstin !== null} hint={panFromGstin ? "Taken from the GSTIN." : "10 characters. For suppliers without a GSTIN."} />
        </div>
      </fieldset>

      <fieldset disabled={readOnly}>
        <legend>Buying, terms and payments</legend>
        <div className="form-grid">
          {listOptions ? (
            <SelectInput id="sup-priceList" label="Buying price list" value={form.priceListId} onChange={set("priceListId")} error={errors.priceListId} hint={listOptions.length === 0 ? "No buying list is visible to you." : "Empty = the default buying list."}>
              <option value="">Default buying list</option>
              {listOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.active ? "" : " (switched off)"}
                </option>
              ))}
            </SelectInput>
          ) : (
            <TextInput id="sup-priceList" label="Buying price list" value={supplier?.priceList?.name ?? "Default buying list"} readOnly hint="You cannot see price lists." />
          )}
          {termsOptions ? (
            <SelectInput id="sup-terms" label="Payment terms" value={form.paymentTermsId} onChange={set("paymentTermsId")} error={errors.paymentTermsId}>
              <option value="">None (cash)</option>
              {termsOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.active ? "" : " (switched off)"}
                </option>
              ))}
            </SelectInput>
          ) : (
            <TextInput id="sup-terms" label="Payment terms" value={supplier?.paymentTerms?.name ?? "None"} readOnly />
          )}
          <TextInput id="sup-bank" label="Bank account note" value={form.bankAccountNote} onChange={set("bankAccountNote")} error={errors.bankAccountNote} className="span-2" autoComplete="off" hint="A short note for payments (bank, account name). Not used for automatic transfers." />
          <div className="span-2 check-row">
            <CheckInput id="sup-billWithoutOrder" label="Bill without order" description="A purchase bill may be entered without a purchase order." checked={form.allowBillWithoutOrder} onChange={setFlag("allowBillWithoutOrder")} />
            <CheckInput id="sup-billWithoutReceipt" label="Bill without receipt" description="A purchase bill may be entered before the goods are received." checked={form.allowBillWithoutReceipt} onChange={setFlag("allowBillWithoutReceipt")} />
          </div>
          <div className="span-2">
            <PartyPicker id="sup-linkedCustomer" label="Linked customer" kind="customer" value={form.linkedCustomer} onChange={(p) => setForm((f) => ({ ...f, linkedCustomer: p }))} error={errors.linkedCustomerId} disabled={readOnly} hint="When this supplier is also one of our customers. Balances stay separate." />
          </div>
        </div>
      </fieldset>

      {!readOnly ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            {supplier ? "Save supplier" : "Create supplier"}
          </Button>
        </div>
      ) : (
        <p className="muted">You can view this supplier but not change it.</p>
      )}
    </form>
  );
}
