// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createStoreSchema, suggestCode, updateStoreSchema } from "shared";
import { AddressFields, addressFrom, addressPayload, type AddressValues, emptyAddress } from "@/components/address-fields";
import { Alert, Button, CheckInput, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { blankToNull } from "@/lib/format";
import type { GstRegistrationDto, StoreDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface StoreFormValues {
  code: string;
  name: string;
  phone: string;
  email: string;
  gstRegistrationId: string;
  active: boolean;
  address: AddressValues;
}

function fromStore(store: StoreDto | null): StoreFormValues {
  if (!store) return { code: "", name: "", phone: "", email: "", gstRegistrationId: "", active: true, address: emptyAddress };
  return {
    code: store.code,
    name: store.name,
    phone: store.phone ?? "",
    email: store.email ?? "",
    gstRegistrationId: store.gstRegistrationId ?? "",
    active: store.active,
    address: addressFrom(store),
  };
}

interface StoreFormProps {
  /** Null = create a new store. */
  store: StoreDto | null;
  registrations: GstRegistrationDto[];
  readOnly?: boolean;
  onSaved: (store: StoreDto) => void;
  onCancel?: () => void;
}

export function StoreForm({ store, registrations, readOnly, onSaved, onCancel }: StoreFormProps) {
  const [form, setForm] = useState<StoreFormValues>(() => fromStore(store));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof Omit<StoreFormValues, "address" | "active">) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const common = {
      name: form.name,
      phone: blankToNull(form.phone),
      email: blankToNull(form.email),
      gstRegistrationId: form.gstRegistrationId || null,
      ...addressPayload(form.address),
    };
    const parsed = store
      ? updateStoreSchema.safeParse({ ...common, active: form.active })
      : createStoreSchema.safeParse({ code: form.code, ...common });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      const saved = store
        ? await api.patch<StoreDto>(`/stores/${store.id}`, parsed.data)
        : await api.post<StoreDto>("/stores", parsed.data);
      onSaved(saved);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Alert kind="error">{error}</Alert>
      <div className="form-grid">
        <TextInput
          id="store-name"
          label="Name"
          value={form.name}
          onChange={(e) => {
            const name = e.target.value;
            // The code follows the name until the person types their own.
            const follows = !store && form.code === suggestCode(form.name, 10);
            setForm({ ...form, name, ...(follows ? { code: suggestCode(name, 10) } : {}) });
          }}
          error={errors.name}
          required
          disabled={readOnly}
        />
        <TextInput id="store-code" label="Store code" value={form.code} onChange={set("code")} error={errors.code} required disabled={!!store || readOnly} hint={store ? "The code cannot change once set." : "Filled in from the name; change it if you like. 2–10 letters or digits."} />
        <AddressFields idPrefix="store" values={form.address} onChange={(address) => setForm((f) => ({ ...f, address }))} errors={errors} stateDisabled={readOnly} />
        <TextInput id="store-phone" label="Phone" type="tel" value={form.phone} onChange={set("phone")} error={errors.phone} disabled={readOnly} />
        <TextInput id="store-email" label="Email" type="email" value={form.email} onChange={set("email")} error={errors.email} disabled={readOnly} />
        <SelectInput id="store-gst" label="GST registration" value={form.gstRegistrationId} onChange={set("gstRegistrationId")} error={errors.gstRegistrationId} disabled={readOnly} hint="Leave empty to use the company's default registration.">
          <option value="">Company default</option>
          {registrations
            .filter((r) => r.active || r.id === form.gstRegistrationId)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.gstin}
                {r.active ? "" : " (switched off)"}
              </option>
            ))}
        </SelectInput>
        {store ? (
          <div className="span-2">
            <CheckInput id="store-active" label="Active" description="Switched-off stores cannot be used for new bills or stock." checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} disabled={readOnly} />
          </div>
        ) : null}
      </div>
      {!readOnly ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            {store ? "Save store" : "Add store"}
          </Button>
          {onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
        </div>
      ) : null}
    </form>
  );
}
