// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { hasPermission, updateInventorySettingsSchema } from "shared";
import { Alert, Button, CheckInput, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { useModules } from "@/lib/modules";
import type { InventorySettingsDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

function SettingsForm({ settings, canEdit, onSaved }: { settings: InventorySettingsDto; canEdit: boolean; onSaved: (s: InventorySettingsDto) => void }) {
  const [form, setForm] = useState({ stockLockDate: settings.stockLockDate ?? "", allowNegativeAtTill: settings.allowNegativeAtTill, batchPickOrder: settings.batchPickOrder });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // Plan 12: the batch setting only while "Batches and expiry" is on (its value is kept).
  const batchesOn = useModules().isOn("batches");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = updateInventorySettingsSchema.safeParse({ ...form, stockLockDate: form.stockLockDate || null });
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      onSaved(await api.patch<InventorySettingsDto>("/stock/settings", parsed.data));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" noValidate>
      <Alert kind="error">{error}</Alert>
      {saved ? <Alert kind="success">Settings saved.</Alert> : null}
      <TextInput
        id="inv-lock"
        label="Stock locked up to"
        type="date"
        value={form.stockLockDate}
        disabled={!canEdit}
        onChange={(e) => setForm({ ...form, stockLockDate: e.target.value })}
        error={errors.stockLockDate}
        hint="Month-end lock: nothing can be posted or cancelled on or before this date. Blank: not locked. Every change is recorded in the history."
      />
      <CheckInput
        id="inv-negative"
        label="Allow selling below zero at the till"
        description="A sale is never stopped for missing stock; it is flagged on the Negative stock list. The back office can never go below zero."
        checked={form.allowNegativeAtTill}
        disabled={!canEdit}
        onChange={(e) => setForm({ ...form, allowNegativeAtTill: e.target.checked })}
      />
      {batchesOn ? (
      <SelectInput id="inv-batch-order" label="Batch picked first at the till" value={form.batchPickOrder} disabled={!canEdit} onChange={(e) => setForm({ ...form, batchPickOrder: e.target.value as InventorySettingsDto["batchPickOrder"] })} error={errors.batchPickOrder}>
        <option value="earliest_expiry">Earliest expiry first</option>
        <option value="oldest_first">Oldest batch first</option>
      </SelectInput>
      ) : null}
      {canEdit ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save
          </Button>
        </div>
      ) : (
        <p className="muted">Only the Accountant or the Owner can change these settings.</p>
      )}
    </form>
  );
}

export default function InventorySettingsPage() {
  const { user } = useAuth();
  const canEdit = hasPermission(user, "stock.lock");
  const settings = useLoad(() => api.get<InventorySettingsDto>("/stock/settings"));
  return (
    <>
      <h1>Inventory settings</h1>
      <Alert kind="error">{settings.error}</Alert>
      {settings.data ? (
        <>
          <p className="muted">{settings.data.stockLockDate ? `Stock is currently locked up to ${formatDate(settings.data.stockLockDate)}.` : "Stock is not locked."}</p>
          <SettingsForm key={settings.data.companyId} settings={settings.data} canEdit={canEdit} onSaved={settings.setData} />
        </>
      ) : settings.loading ? (
        <p className="muted">Loading…</p>
      ) : null}
    </>
  );
}
