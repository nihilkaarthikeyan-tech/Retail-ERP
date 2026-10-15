// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { customerCreditSchema, PARTY_STATUSES } from "shared";
import { PartyStatusBadge } from "@/components/parties/status-badge";
import { Alert, Button, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { blankToNull } from "@/lib/format";
import { STATUS_LABELS } from "@/lib/parties";
import type { CustomerDto, PartyStatus } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface CustomerCreditProps {
  customer: CustomerDto;
  /** customers.credit: the credit controller. Everyone else sees the values only. */
  canEdit: boolean;
  onSaved: (customer: CustomerDto) => void;
}

/** Credit tab: limits and status, each change with a reason that goes into the history (decision 22). */
export function CustomerCredit({ customer, canEdit, onSaved }: CustomerCreditProps) {
  const [creditLimit, setCreditLimit] = useState(customer.creditLimit);
  const [overdueLimit, setOverdueLimit] = useState(customer.overdueLimit);
  const [status, setStatus] = useState<PartyStatus>(customer.status);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = customerCreditSchema.safeParse({
      creditLimit: creditLimit.trim(),
      overdueLimit: overdueLimit.trim(),
      ...(status !== customer.status ? { status } : {}),
      reason: blankToNull(reason),
    });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      const updated = await api.patch<CustomerDto>(`/customers/${customer.id}/credit`, parsed.data);
      setReason("");
      setSaved(true);
      onSaved(updated);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (customer.isWalkIn) {
    return (
      <>
        <h2>Credit and status</h2>
        <Alert kind="info">The walk-in customer cannot be blocked, switched off or given credit. Every walk-in sale is paid at the till.</Alert>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Credit and status</h2>
        <PartyStatusBadge status={customer.status} />
      </div>
      <Alert kind="error">{error}</Alert>
      {saved ? <Alert kind="success">Credit settings saved.</Alert> : null}
      <fieldset disabled={!canEdit}>
        <legend>Limits</legend>
        <div className="form-grid">
          <TextInput id="credit-limit" label="Credit limit" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} error={errors.creditLimit} inputMode="decimal" className="mono" hint="0 = no credit of its own; the group's limit or the company default applies. Can never be set below what is owed." />
          <TextInput id="credit-overdue" label="Overdue limit" value={overdueLimit} onChange={(e) => setOverdueLimit(e.target.value)} error={errors.overdueLimit} inputMode="decimal" className="mono" hint="Overdue amount above which new sales on credit are refused. 0 = no overdue allowed." />
        </div>
      </fieldset>
      <fieldset disabled={!canEdit}>
        <legend>Status</legend>
        <div className="form-grid">
          <SelectInput id="credit-status" label="Status" value={status} onChange={(e) => setStatus(e.target.value as PartyStatus)} error={errors.status} hint="Blocked = only a credit controller may post for them. Switched off = refused on every document.">
            {PARTY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </SelectInput>
          <TextInput id="credit-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} autoComplete="off" hint="Recorded in the history with the change." />
        </div>
      </fieldset>
      {canEdit ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save credit settings
          </Button>
        </div>
      ) : (
        <p className="muted">Only a credit controller (customers.credit) can change limits and status.</p>
      )}
    </form>
  );
}
