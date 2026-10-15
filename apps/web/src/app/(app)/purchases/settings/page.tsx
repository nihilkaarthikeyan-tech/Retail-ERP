// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { purchaseSettingsSchema } from "shared";
import { Alert, Button, CheckInput, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { type PurchaseSettingsDto, purchaseRights, rupees } from "@/lib/purchasing";
import { showQuantity } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

type Form = Omit<PurchaseSettingsDto, "approvalLimit" | "overOrderPercent" | "overReceiptPercent" | "overBillingPercent"> & {
  approvalLimit: string;
  overOrderPercent: string;
  overReceiptPercent: string;
  overBillingPercent: string;
};

function SettingsForm({ settings, canEdit, onSaved }: { settings: PurchaseSettingsDto; canEdit: boolean; onSaved: (s: PurchaseSettingsDto) => void }) {
  const [form, setForm] = useState<Form>(() => ({
    ...settings,
    overOrderPercent: showQuantity(settings.overOrderPercent),
    overReceiptPercent: showQuantity(settings.overReceiptPercent),
    overBillingPercent: showQuantity(settings.overBillingPercent),
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = purchaseSettingsSchema.safeParse({
      ...form,
      approvalLimit: form.approvalLimit.trim(),
      overOrderPercent: form.overOrderPercent.trim(),
      overReceiptPercent: form.overReceiptPercent.trim(),
      overBillingPercent: form.overBillingPercent.trim(),
    });
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      onSaved(await api.patch<PurchaseSettingsDto>("/purchase/settings", parsed.data));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Alert kind="error">{error}</Alert>
      {saved ? <Alert kind="success">Settings saved.</Alert> : null}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Orders</h2>
        <div className="form-grid">
          <TextInput
            id="ps-approval"
            label="Approval limit (₹)"
            inputMode="decimal"
            value={form.approvalLimit}
            disabled={!canEdit}
            onChange={(e) => set("approvalLimit", e.target.value)}
            error={errors.approvalLimit}
            hint="Orders above this total need a Store Manager or the Owner to finalise."
          />
          <TextInput
            id="ps-over-order"
            label="Extra allowed when ordering (%)"
            inputMode="decimal"
            value={form.overOrderPercent}
            disabled={!canEdit}
            onChange={(e) => set("overOrderPercent", e.target.value)}
            error={errors.overOrderPercent}
          />
        </div>
        <CheckInput
          id="ps-fill-price"
          label="Fill in the last purchase price"
          description="When the supplier has no price list price, new lines start with the last price paid for the item."
          checked={form.fillLastPurchasePrice}
          disabled={!canEdit}
          onChange={(e) => set("fillLastPurchasePrice", e.target.checked)}
        />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Receiving goods</h2>
        <div className="form-grid">
          <TextInput
            id="ps-over-receipt"
            label="Extra allowed when receiving (%)"
            inputMode="decimal"
            value={form.overReceiptPercent}
            disabled={!canEdit}
            onChange={(e) => set("overReceiptPercent", e.target.value)}
            error={errors.overReceiptPercent}
            hint="How much more than ordered may be received. 0 means not more than ordered."
          />
        </div>
        <CheckInput
          id="ps-require-order"
          label="Goods must come against a purchase order"
          description="When off, a manager can still receive goods without an order by giving a reason."
          checked={form.requireOrderForReceipt}
          disabled={!canEdit}
          onChange={(e) => set("requireOrderForReceipt", e.target.checked)}
        />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Supplier bills</h2>
        <div className="form-grid">
          <TextInput
            id="ps-over-billing"
            label="Extra allowed when billing (%)"
            inputMode="decimal"
            value={form.overBillingPercent}
            disabled={!canEdit}
            onChange={(e) => set("overBillingPercent", e.target.value)}
            error={errors.overBillingPercent}
          />
          <SelectInput
            id="ps-price-mismatch"
            label="When the bill price differs from the order"
            value={form.priceMismatch}
            disabled={!canEdit}
            onChange={(e) => set("priceMismatch", e.target.value as PurchaseSettingsDto["priceMismatch"])}
            error={errors.priceMismatch}
          >
            <option value="allow">Allow it</option>
            <option value="warn">Allow it with a warning</option>
            <option value="block">Do not allow it</option>
          </SelectInput>
        </div>
        <CheckInput
          id="ps-check-bill-no"
          label="Check supplier bill numbers"
          description="Stops the same supplier bill number being entered twice for one supplier."
          checked={form.checkSupplierBillNo}
          disabled={!canEdit}
          onChange={(e) => set("checkSupplierBillNo", e.target.checked)}
        />
      </div>

      {canEdit ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save
          </Button>
        </div>
      ) : (
        <p className="muted">You can see these settings but not change them.</p>
      )}
    </form>
  );
}

export default function PurchaseSettingsPage() {
  const { user } = useAuth();
  const canEdit = purchaseRights(user).settings;
  const settings = useLoad(() => api.get<PurchaseSettingsDto>("/purchase/settings"));
  return (
    <>
      <h1>Purchase settings</h1>
      <Alert kind="error">{settings.error}</Alert>
      {settings.data ? (
        <>
          <p className="muted">Orders above {rupees(settings.data.approvalLimit)} need approval.</p>
          <SettingsForm settings={settings.data} canEdit={canEdit} onSaved={settings.setData} />
        </>
      ) : settings.loading ? (
        <p className="muted">Loading…</p>
      ) : null}
    </>
  );
}
