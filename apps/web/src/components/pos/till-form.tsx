// Copyright (c) 2026, Rademics. All rights reserved.
// Till set-up form: new till and editing an existing one (plan 06 §3).
"use client";

import { useState, type FormEvent } from "react";
import { tillSchema, updateTillSchema } from "shared";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert, Button, CheckInput, Field, RadioInput, SelectInput, TextareaInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { storesFromLocations } from "@/lib/stock";
import type { PriceListDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { PAYMENT_KIND_LABELS, type TillDto, usePaymentMethods } from "./pos-shared";

interface Form {
  storeId: string;
  code: string;
  name: string;
  locationId: string;
  priceListId: string;
  cashierDiscountPercent: string;
  allowPriceChange: boolean;
  autoPrint: boolean;
  receiptFooter: string;
  active: boolean;
  methods: string[];
  defaultMethod: string;
  /** Plan 08: the invoice prefix (PREFIX/2627/000001, at most 16 characters); empty = worked out from the codes. */
  numberPrefix: string;
}

function initial(till: TillDto | null): Form {
  if (!till) {
    return { storeId: "", code: "", name: "", locationId: "", priceListId: "", cashierDiscountPercent: "5", allowPriceChange: false, autoPrint: true, receiptFooter: "", active: true, methods: [], defaultMethod: "", numberPrefix: "" };
  }
  return {
    storeId: till.store.id,
    code: till.code,
    name: till.name,
    locationId: till.locationId,
    priceListId: till.priceListId,
    cashierDiscountPercent: till.cashierDiscountPercent,
    allowPriceChange: till.allowPriceChange,
    autoPrint: till.autoPrint,
    receiptFooter: till.receiptFooter ?? "",
    active: till.active,
    numberPrefix: /^[A-Z0-9]{1,4}$/.test(till.numberPrefix) ? till.numberPrefix : "",
    methods: till.paymentMethods.map((m) => m.paymentMethodId),
    defaultMethod: till.paymentMethods.find((m) => m.isDefault)?.paymentMethodId ?? "",
  };
}

export function TillForm({ till, canEdit, onSaved }: { till: TillDto | null; canEdit: boolean; onSaved: (t: TillDto) => void }) {
  const [form, setForm] = useState<Form>(() => initial(till));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const locations = useStockLocations();
  const lists = useLoad(() => api.get<PriceListDto[]>("/price-lists"));
  const methods = usePaymentMethods();
  const stores = storesFromLocations(locations.data ?? []);
  const shelves = (locations.data ?? []).filter((l) => l.kind === "shelf" && l.active && l.store?.id === form.storeId);
  const sellingLists = (lists.data ?? []).filter((l) => l.forSelling && (l.active || l.id === form.priceListId));
  const isNew = till === null;

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  function toggleMethod(id: string, on: boolean) {
    setForm((f) => {
      const next = on ? [...f.methods, id] : f.methods.filter((m) => m !== id);
      const defaultMethod = next.includes(f.defaultMethod) ? f.defaultMethod : (next[0] ?? "");
      return { ...f, methods: next, defaultMethod };
    });
    setSaved(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const paymentMethods = form.methods.map((id) => ({ paymentMethodId: id, isDefault: id === form.defaultMethod }));
    const common = {
      name: form.name,
      locationId: form.locationId,
      priceListId: form.priceListId,
      cashierDiscountPercent: form.cashierDiscountPercent.trim(),
      allowPriceChange: form.allowPriceChange,
      autoPrint: form.autoPrint,
      receiptFooter: form.receiptFooter.trim() || null,
      paymentMethods,
      active: form.active,
      ...(form.numberPrefix.trim() && (isNew || form.numberPrefix.trim().toUpperCase() !== till.numberPrefix) ? { numberPrefix: form.numberPrefix.trim() } : {}),
    };
    const parsed = isNew ? tillSchema.safeParse({ ...common, storeId: form.storeId, code: form.code }) : updateTillSchema.safeParse(common);
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      const out = isNew ? await api.post<TillDto>("/pos/tills", parsed.data) : await api.patch<TillDto>(`/pos/tills/${till.id}`, parsed.data);
      setSaved(true);
      onSaved(out);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const loadError = locations.error ?? lists.error ?? methods.error;

  return (
    <form onSubmit={submit} noValidate>
      <Alert kind="error">{loadError}</Alert>
      <Alert kind="error">{error}</Alert>
      {saved && !isNew ? <Alert kind="success">Till saved.</Alert> : null}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Till</h2>
        <div className="form-grid">
          {isNew ? (
            <SelectInput
              id="till-store"
              label="Store"
              required
              value={form.storeId}
              error={errors.storeId}
              onChange={(e) => setForm((f) => ({ ...f, storeId: e.target.value, locationId: "" }))}
            >
              <option value="">Choose a store</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </SelectInput>
          ) : (
            <Field id="till-store" label="Store">
              <span id="till-store">
                {till.store.code} — {till.store.name}
              </span>
            </Field>
          )}
          {isNew ? (
            <TextInput id="till-code" label="Code" required className="mono" value={form.code} error={errors.code} hint="For example T1. It cannot be changed later." autoComplete="off" onChange={(e) => set("code", e.target.value)} />
          ) : (
            <Field id="till-code" label="Code">
              <span id="till-code" className="mono">
                {till.code}
              </span>
            </Field>
          )}
          <TextInput
            id="till-number-prefix"
            label="Invoice prefix"
            className="mono"
            maxLength={4}
            value={form.numberPrefix}
            error={errors.numberPrefix}
            disabled={!canEdit}
            autoComplete="off"
            hint={`1–4 letters or digits, different for every till. Bill numbers look like ${form.numberPrefix.trim().toUpperCase() || "MAT1"}/2627/000001 (GST allows 16 characters). Leave empty to use the store and till codes. A new prefix starts a new series.`}
            onChange={(e) => set("numberPrefix", e.target.value.toUpperCase())}
          />
          <TextInput id="till-name" label="Name" required value={form.name} error={errors.name} disabled={!canEdit} autoComplete="off" onChange={(e) => set("name", e.target.value)} />
          <SelectInput id="till-location" label="Sells from" required value={form.locationId} error={errors.locationId} disabled={!canEdit || !form.storeId} hint="A shelf location of the store, normally the shop floor." onChange={(e) => set("locationId", e.target.value)}>
            <option value="">{form.storeId ? "Choose a location" : "Choose the store first"}</option>
            {shelves.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.code})
              </option>
            ))}
          </SelectInput>
          <SelectInput id="till-price-list" label="Price list" required value={form.priceListId} error={errors.priceListId} disabled={!canEdit} onChange={(e) => set("priceListId", e.target.value)}>
            <option value="">Choose a selling price list</option>
            {sellingLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectInput>
          <TextInput
            id="till-discount"
            label="Cashier discount without a manager (%)"
            inputMode="decimal"
            value={form.cashierDiscountPercent}
            error={errors.cashierDiscountPercent}
            disabled={!canEdit}
            hint="Above this a manager types their PIN. An item's own maximum discount always applies."
            onChange={(e) => set("cashierDiscountPercent", e.target.value)}
          />
        </div>
        <CheckInput id="till-price-change" label="Cashier may change prices" description="When off, a price change needs a manager PIN. Never above MRP." checked={form.allowPriceChange} disabled={!canEdit} onChange={(e) => set("allowPriceChange", e.target.checked)} />
        <CheckInput id="till-auto-print" label="Print the receipt automatically" checked={form.autoPrint} disabled={!canEdit} onChange={(e) => set("autoPrint", e.target.checked)} />
        {!isNew ? <CheckInput id="till-active" label="Active" description="A switched-off till cannot bill." checked={form.active} disabled={!canEdit} onChange={(e) => set("active", e.target.checked)} /> : null}
        <TextareaInput id="till-footer" label="Receipt footer" rows={2} value={form.receiptFooter} error={errors.receiptFooter} disabled={!canEdit} hint="For example: Thank you! Exchange within 7 days with this bill." onChange={(e) => set("receiptFooter", e.target.value)} />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Payment methods</h2>
        <p className="muted">Tick the ways this till takes payment and choose one as the default.</p>
        {errors.paymentMethods ? <p className="field-error" role="alert">{errors.paymentMethods}</p> : null}
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Accepts</th>
              <th scope="col">Kind</th>
              <th scope="col">Default</th>
            </tr>
          </thead>
          <tbody>
            {(methods.data ?? [])
              .filter((m) => m.active || form.methods.includes(m.id))
              .map((m) => (
                <tr key={m.id}>
                  <td>
                    <CheckInput id={`till-pm-${m.id}`} label={m.name} checked={form.methods.includes(m.id)} disabled={!canEdit} onChange={(e) => toggleMethod(m.id, e.target.checked)} />
                  </td>
                  <td>{PAYMENT_KIND_LABELS[m.kind]}</td>
                  <td>
                    <RadioInput
                      id={`till-pm-default-${m.id}`}
                      name="till-default-method"
                      label={<span className="sr-only">Default: {m.name}</span>}
                      checked={form.defaultMethod === m.id}
                      disabled={!canEdit || !form.methods.includes(m.id)}
                      onChange={() => set("defaultMethod", m.id)}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            {isNew ? "Create till" : "Save"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
