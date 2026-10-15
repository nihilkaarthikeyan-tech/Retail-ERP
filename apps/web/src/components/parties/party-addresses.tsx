// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { addressSchema, updateAddressSchema } from "shared";
import { AddressFields, addressFrom, type AddressValues, emptyAddress } from "@/components/address-fields";
import { GstinStateFields } from "@/components/parties/gstin-state-fields";
import { ActiveBadge, Alert, Badge, Button, CheckInput, DataTable, Dialog, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { blankToNull } from "@/lib/format";
import type { AddressDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface AddressForm {
  label: string;
  address: AddressValues;
  gstin: string;
  phone: string;
  email: string;
  isBilling: boolean;
  isDelivery: boolean;
  isMain: boolean;
  active: boolean;
}

const emptyForm: AddressForm = { label: "", address: emptyAddress, gstin: "", phone: "", email: "", isBilling: true, isDelivery: true, isMain: false, active: true };

function fromDto(a: AddressDto): AddressForm {
  return { label: a.label ?? "", address: addressFrom(a), gstin: a.gstin ?? "", phone: a.phone ?? "", email: a.email ?? "", isBilling: a.isBilling, isDelivery: a.isDelivery, isMain: a.isMain, active: a.active };
}

interface PartyAddressesProps {
  /** "/customers/<id>" or "/suppliers/<id>". */
  basePath: string;
  addresses: AddressDto[];
  readOnly: boolean;
  /** Whether GSTIN per address is offered (business customers, decision 21). */
  withGstin?: boolean;
  onChanged: () => Promise<void> | void;
}

/** Addresses tab: a table and an add/edit dialog. */
export function PartyAddresses({ basePath, addresses, readOnly, withGstin = true, onChanged }: PartyAddressesProps) {
  const [editing, setEditing] = useState<AddressDto | "new" | null>(null);
  const [form, setForm] = useState<AddressForm>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(a: AddressDto | "new") {
    setErrors({});
    setError(null);
    setForm(a === "new" ? { ...emptyForm, isMain: addresses.filter((x) => x.active).length === 0 } : fromDto(a));
    setEditing(a);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body = {
      label: blankToNull(form.label),
      addressLine1: form.address.addressLine1.trim(),
      addressLine2: blankToNull(form.address.addressLine2),
      city: form.address.city.trim(),
      stateCode: form.address.stateCode,
      pincode: blankToNull(form.address.pincode),
      phone: blankToNull(form.phone),
      email: blankToNull(form.email),
      gstin: withGstin ? blankToNull(form.gstin) : null,
      isBilling: form.isBilling,
      isDelivery: form.isDelivery,
      isMain: form.isMain,
    };
    const parsed = editing === "new" ? addressSchema.safeParse(body) : updateAddressSchema.safeParse({ ...body, active: form.active });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      if (editing === "new") await api.post(`${basePath}/addresses`, parsed.data);
      else if (editing) await api.patch(`${basePath}/addresses/${editing.id}`, parsed.data);
      setEditing(null);
      await onChanged();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<AddressDto>[] = [
    { key: "label", header: "Label", render: (a) => a.label ?? <span className="muted">—</span> },
    {
      key: "address",
      header: "Address",
      render: (a) => (
        <>
          {a.addressLine1}
          {a.addressLine2 ? `, ${a.addressLine2}` : ""}
          <br />
          {a.city}, {a.stateCode}
          {a.pincode ? ` ${a.pincode}` : ""}
        </>
      ),
    },
    { key: "contact", header: "Phone / email", render: (a) => [a.phone, a.email].filter(Boolean).join(" · ") || "—" },
    ...(withGstin ? [{ key: "gstin", header: "GSTIN", render: (a: AddressDto) => (a.gstin ? <span className="mono">{a.gstin}</span> : "—") } satisfies Column<AddressDto>] : []),
    {
      key: "use",
      header: "Used for",
      render: (a) => (
        <span className="row-actions">
          {a.isMain ? <Badge kind="ok">Main</Badge> : null}
          {a.isBilling ? <Badge kind="neutral">Billing</Badge> : null}
          {a.isDelivery ? <Badge kind="neutral">Delivery</Badge> : null}
        </span>
      ),
    },
    { key: "active", header: "Status", render: (a) => <ActiveBadge active={a.active} /> },
    ...(!readOnly
      ? [
          {
            key: "actions",
            header: "",
            render: (a: AddressDto) => (
              <Button size="small" onClick={() => open(a)}>
                Edit
              </Button>
            ),
          } satisfies Column<AddressDto>,
        ]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Addresses</h2>
        <span className="spacer" />
        {!readOnly ? (
          <Button variant="primary" onClick={() => open("new")}>
            Add address
          </Button>
        ) : null}
      </div>
      <p className="muted">The main address decides same-state or other-state GST unless a bill names another one.</p>
      <DataTable columns={columns} rows={addresses} rowKey={(a) => a.id} empty="No addresses yet." />

      <Dialog open={editing !== null} title={editing === "new" ? "Add address" : "Edit address"} onClose={() => setEditing(null)}>
        <form onSubmit={onSubmit} noValidate>
          <Alert kind="error">{error}</Alert>
          <TextInput id="addr-label" label="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} error={errors.label} autoComplete="off" hint="For example Head office, Godown. Optional." />
          <AddressFields idPrefix="addr" values={form.address} onChange={(address) => setForm({ ...form, address })} errors={errors} withState={false} />
          <GstinStateFields
            idPrefix="addr"
            values={{ gstin: form.gstin, stateCode: form.address.stateCode }}
            onChange={(v) => setForm({ ...form, gstin: v.gstin, address: { ...form.address, stateCode: v.stateCode } })}
            errors={errors}
            withoutGstin={!withGstin}
            stateRequired
            gstinHint="For a business customer billed at this address (decision 21). Optional."
          />
          <TextInput id="addr-phone" label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={errors.phone} autoComplete="off" />
          <TextInput id="addr-email" label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} autoComplete="off" />
          <div className="check-row">
            <CheckInput id="addr-isBilling" label="Billing address" checked={form.isBilling} onChange={(e) => setForm({ ...form, isBilling: e.target.checked })} />
            <CheckInput id="addr-isDelivery" label="Delivery address" checked={form.isDelivery} onChange={(e) => setForm({ ...form, isDelivery: e.target.checked })} />
            <CheckInput id="addr-isMain" label="Main address" description="Only one address is the main one." checked={form.isMain} onChange={(e) => setForm({ ...form, isMain: e.target.checked })} />
            {editing !== "new" ? <CheckInput id="addr-active" label="Active" description="Make another address the main one before switching this off." checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> : null}
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
