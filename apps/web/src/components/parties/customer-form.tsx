// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createCustomerSchema, updateCustomerSchema } from "shared";
import { blankDate, type DayMonthYear, DayMonthYearFields, joinDayMonth, splitDayMonth } from "@/components/parties/customer-dates-fields";
import { DuplicateMatches } from "@/components/parties/duplicate-matches";
import { GstinStateFields } from "@/components/parties/gstin-state-fields";
import { PartyPicker } from "@/components/parties/party-picker";
import { Alert, Button, CheckInput, SelectInput, TextInput, TextareaInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { flattenGroups } from "@/lib/catalogue";
import { blankToNull } from "@/lib/format";
import { duplicateMobile } from "@/lib/parties";
import type { CustomerDto, DuplicateMobileBody, PartyGroupNode, PartyRef, PartySettingsDto, PaymentTermsDto, PriceListDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface CustomerFormValues {
  name: string;
  isBusiness: boolean;
  mobile: string;
  email: string;
  notes: string;
  customerGroupId: string;
  gstin: string;
  stateCode: string;
  priceListId: string;
  paymentTermsId: string;
  creditCheckAtDelivery: boolean;
  linkedSupplier: PartyRef | null;
  birthday: DayMonthYear;
  anniversary: DayMonthYear;
}

function fromCustomer(c: CustomerDto | null, settings: PartySettingsDto | null): CustomerFormValues {
  if (!c) {
    return {
      name: "",
      isBusiness: false,
      mobile: "",
      email: "",
      notes: "",
      customerGroupId: settings?.defaultCustomerGroupId ?? "",
      gstin: "",
      stateCode: "",
      priceListId: "",
      paymentTermsId: settings?.defaultPaymentTermsId ?? "",
      creditCheckAtDelivery: false,
      linkedSupplier: null,
      birthday: blankDate,
      anniversary: blankDate,
    };
  }
  return {
    name: c.name,
    isBusiness: c.isBusiness,
    mobile: c.mobile ?? "",
    email: c.email ?? "",
    notes: c.notes ?? "",
    customerGroupId: c.customerGroup.id,
    gstin: c.gstin ?? "",
    stateCode: c.stateCode ?? "",
    priceListId: c.priceList?.id ?? "",
    paymentTermsId: c.paymentTerms?.id ?? "",
    creditCheckAtDelivery: c.creditCheckAtDelivery,
    linkedSupplier: c.linkedSupplier,
    birthday: splitDayMonth(c.birthday, c.birthYear),
    anniversary: splitDayMonth(c.anniversary, c.anniversaryYear),
  };
}

interface CustomerFormProps {
  /** Null = create a new customer. */
  customer: CustomerDto | null;
  groups: PartyGroupNode[];
  /** Null when the user may not see price lists; the current list is then shown as is. */
  priceLists: PriceListDto[] | null;
  terms: PaymentTermsDto[] | null;
  settings: PartySettingsDto | null;
  readOnly?: boolean;
  onSaved: (customer: CustomerDto) => void;
}

export function CustomerForm({ customer, groups, priceLists, terms, settings, readOnly = false, onSaved }: CustomerFormProps) {
  const [form, setForm] = useState<CustomerFormValues>(() => fromCustomer(customer, settings));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMobileBody | null>(null);
  const [busy, setBusy] = useState(false);

  type TextKey = "name" | "mobile" | "email" | "notes" | "customerGroupId" | "priceListId" | "paymentTermsId";
  const set = (key: TextKey) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setFlag = (key: "isBusiness" | "creditCheckAtDelivery") => (e: { target: { checked: boolean } }) => setForm((f) => ({ ...f, [key]: e.target.checked }));

  const walkIn = customer?.isWalkIn ?? false;

  async function send(confirmDuplicate: boolean) {
    setError(null);
    const birthday = joinDayMonth(form.birthday);
    const anniversary = joinDayMonth(form.anniversary);
    const body = {
      name: form.name,
      isBusiness: form.isBusiness,
      mobile: blankToNull(form.mobile),
      email: blankToNull(form.email),
      notes: blankToNull(form.notes),
      ...(form.customerGroupId ? { customerGroupId: form.customerGroupId } : {}),
      // The walk-in customer never has a GSTIN or a supplier link (the API refuses them).
      ...(walkIn ? {} : { gstin: blankToNull(form.gstin), linkedSupplierId: form.linkedSupplier?.id ?? null }),
      stateCode: form.stateCode || null,
      priceListId: form.priceListId || null,
      paymentTermsId: form.paymentTermsId || null,
      creditCheckAtDelivery: form.creditCheckAtDelivery,
      birthday: birthday.dayMonth,
      birthYear: birthday.year,
      anniversary: anniversary.dayMonth,
      anniversaryYear: anniversary.year,
      ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
    };
    const parsed = customer ? updateCustomerSchema.safeParse(body) : createCustomerSchema.safeParse(body);
    const issues = issuesToFieldErrors(parsed);
    if (!customer && !form.customerGroupId) issues.customerGroupId = "Choose a group";
    for (const [key, v] of [
      ["birthday", form.birthday],
      ["anniversary", form.anniversary],
    ] as const) {
      if ((v.day === "") !== (v.month === "")) issues[key] = "Choose both the day and the month";
      if (v.year.trim() && !/^\d{4}$/.test(v.year.trim())) issues[key === "birthday" ? "birthYear" : "anniversaryYear"] = "The year as four digits, e.g. 1990";
    }
    setErrors(issues);
    if (!parsed.success || Object.keys(issues).length > 0) return;
    setBusy(true);
    try {
      const saved = customer ? await api.patch<CustomerDto>(`/customers/${customer.id}`, parsed.data) : await api.post<CustomerDto>("/customers", parsed.data);
      setDuplicate(null);
      onSaved(saved);
    } catch (err) {
      const dup = duplicateMobile(err);
      if (dup) {
        setDuplicate(dup);
      } else {
        setErrors(apiFieldErrors(err));
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDuplicate(null);
    void send(false);
  }

  const groupOptions = flattenGroups(groups).filter((g) => g.active || g.id === form.customerGroupId);
  const listOptions = priceLists?.filter((l) => l.forSelling && (l.active || l.id === form.priceListId)) ?? null;
  const termsOptions = terms?.filter((t) => t.active || t.id === form.paymentTermsId) ?? null;

  return (
    <form onSubmit={onSubmit} noValidate>
      <Alert kind="error">{error}</Alert>
      <fieldset disabled={readOnly}>
        <legend>Details</legend>
        <div className="form-grid">
          <TextInput id="cus-name" label="Name" value={form.name} onChange={set("name")} error={errors.name} required autoComplete="off" />
          <SelectInput id="cus-group" label="Group" value={form.customerGroupId} onChange={set("customerGroupId")} error={errors.customerGroupId} required hint="Only the last level of the tree can hold customers.">
            <option value="">Choose a group</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id} disabled={!g.isLeaf}>
                {g.label}
                {g.active ? "" : " (switched off)"}
              </option>
            ))}
          </SelectInput>
          <TextInput id="cus-mobile" label="Mobile" value={form.mobile} onChange={set("mobile")} error={errors.mobile} inputMode="numeric" className="mono" autoComplete="off" hint="10 digits. A number already on file is warned about." />
          <TextInput id="cus-email" label="Email" type="email" value={form.email} onChange={set("email")} error={errors.email} autoComplete="off" />
          <TextareaInput id="cus-notes" label="Notes" rows={2} value={form.notes} onChange={set("notes")} error={errors.notes} className="span-2" />
          <div className="span-2 check-row">
            <CheckInput id="cus-isBusiness" label="Business (B2B)" description="Off = a person. A customer with a GSTIN is a business." checked={form.isBusiness} onChange={setFlag("isBusiness")} />
            <CheckInput id="cus-creditCheckAtDelivery" label="Credit check at delivery" description="Check the credit limit when goods leave, not only when the order is taken." checked={form.creditCheckAtDelivery} onChange={setFlag("creditCheckAtDelivery")} />
          </div>
        </div>
      </fieldset>

      <fieldset disabled={readOnly}>
        <legend>Birthday and anniversary</legend>
        <p className="muted">Optional. Shown in &ldquo;Birthdays this week&rdquo; under Customers; the year is not needed.</p>
        <div className="form-grid">
          <DayMonthYearFields idPrefix="cus-birthday" label="Birthday" value={form.birthday} onChange={(v) => setForm((f) => ({ ...f, birthday: v }))} error={errors.birthday} yearError={errors.birthYear} disabled={readOnly} />
          <DayMonthYearFields idPrefix="cus-anniversary" label="Anniversary" value={form.anniversary} onChange={(v) => setForm((f) => ({ ...f, anniversary: v }))} error={errors.anniversary} yearError={errors.anniversaryYear} disabled={readOnly} />
        </div>
      </fieldset>

      <fieldset disabled={readOnly}>
        <legend>GST</legend>
        {walkIn ? <p className="muted">The walk-in customer has no GSTIN.</p> : null}
        <div className="form-grid">
          <GstinStateFields idPrefix="cus" values={{ gstin: form.gstin, stateCode: form.stateCode }} onChange={(v) => setForm((f) => ({ ...f, ...v }))} errors={errors} withoutGstin={walkIn} />
        </div>
      </fieldset>

      <fieldset disabled={readOnly}>
        <legend>Prices, terms and links</legend>
        <div className="form-grid">
          {listOptions ? (
            <SelectInput id="cus-priceList" label="Price list" value={form.priceListId} onChange={set("priceListId")} error={errors.priceListId} hint="Selling list used for this customer. Empty = the default selling list.">
              <option value="">Default selling list</option>
              {listOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.active ? "" : " (switched off)"}
                </option>
              ))}
            </SelectInput>
          ) : (
            <TextInput id="cus-priceList" label="Price list" value={customer?.priceList?.name ?? "Default selling list"} readOnly hint="You cannot see price lists." />
          )}
          {termsOptions ? (
            <SelectInput id="cus-terms" label="Payment terms" value={form.paymentTermsId} onChange={set("paymentTermsId")} error={errors.paymentTermsId}>
              <option value="">None (cash)</option>
              {termsOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.active ? "" : " (switched off)"}
                </option>
              ))}
            </SelectInput>
          ) : (
            <TextInput id="cus-terms" label="Payment terms" value={customer?.paymentTerms?.name ?? "None"} readOnly />
          )}
          {!walkIn ? (
            <div className="span-2">
              <PartyPicker id="cus-linkedSupplier" label="Linked supplier" kind="supplier" value={form.linkedSupplier} onChange={(p) => setForm((f) => ({ ...f, linkedSupplier: p }))} error={errors.linkedSupplierId} disabled={readOnly} hint="When this customer is also one of our suppliers (decision 25). Balances stay separate." />
            </div>
          ) : null}
        </div>
      </fieldset>

      {duplicate ? <DuplicateMatches duplicate={duplicate} busy={busy} onAddAnyway={() => void send(true)} onCancel={() => setDuplicate(null)} /> : null}

      {!readOnly ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy} disabled={duplicate !== null}>
            {customer ? "Save customer" : "Create customer"}
          </Button>
        </div>
      ) : (
        <p className="muted">You can view this customer but not change it.</p>
      )}
    </form>
  );
}
