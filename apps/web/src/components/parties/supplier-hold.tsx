// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { businessDate, HOLD_TYPES, PARTY_STATUSES, supplierHoldSchema } from "shared";
import { HoldBadge, PartyStatusBadge } from "@/components/parties/status-badge";
import { Alert, Button, RadioInput, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { blankToNull, formatDate } from "@/lib/format";
import { effectiveHold, HOLD_LABELS, STATUS_LABELS } from "@/lib/parties";
import type { HoldType, PartyStatus, SupplierDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

const HOLD_HELP: Record<HoldType, string> = {
  none: "Orders, bills and payments are all allowed.",
  bills: "No new purchase orders or bills; payments of what is owed still go through.",
  payments: "No payments; orders and bills can still be entered.",
  all: "Nothing can be posted for this supplier.",
};

interface SupplierHoldProps {
  supplier: SupplierDto;
  /** suppliers.hold: the trusted role. Everyone else sees the hold only. */
  canEdit: boolean;
  onSaved: (supplier: SupplierDto) => void;
}

/** Hold tab: what is held, until when, why, and the supplier's status. */
export function SupplierHold({ supplier, canEdit, onSaved }: SupplierHoldProps) {
  const [holdType, setHoldType] = useState<HoldType>(supplier.holdType);
  const [holdUntil, setHoldUntil] = useState(supplier.holdUntil ?? "");
  const [holdReason, setHoldReason] = useState(supplier.holdReason ?? "");
  const [status, setStatus] = useState<PartyStatus>(supplier.status);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const today = businessDate();
  const inForce = effectiveHold(supplier, today);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = supplierHoldSchema.safeParse({
      holdType,
      holdUntil: holdType === "none" ? null : blankToNull(holdUntil),
      holdReason: holdType === "none" ? null : blankToNull(holdReason),
      ...(status !== supplier.status ? { status } : {}),
    });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      const updated = await api.patch<SupplierDto>(`/suppliers/${supplier.id}/hold`, parsed.data);
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
    <form onSubmit={onSubmit} noValidate>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Hold and status</h2>
        <PartyStatusBadge status={supplier.status} />
        <HoldBadge hold={inForce} until={supplier.holdUntil} />
      </div>
      {supplier.holdType !== "none" && inForce === "none" ? <Alert kind="info">The hold ended on {formatDate(supplier.holdUntil)}; it no longer applies.</Alert> : null}
      <Alert kind="error">{error}</Alert>
      {saved ? <Alert kind="success">Hold settings saved.</Alert> : null}
      <fieldset disabled={!canEdit}>
        <legend>Hold</legend>
        {errors.holdType ? <p className="field-error">{errors.holdType}</p> : null}
        <div className="check-list" role="radiogroup" aria-label="What is held">
          {HOLD_TYPES.map((t) => (
            <RadioInput key={t} id={`hold-${t}`} name="holdType" value={t} label={HOLD_LABELS[t]} description={HOLD_HELP[t]} checked={holdType === t} onChange={() => setHoldType(t)} />
          ))}
        </div>
        {holdType !== "none" ? (
          <div className="form-grid" style={{ marginTop: 12 }}>
            <TextInput id="hold-until" label="Until" type="date" value={holdUntil} onChange={(e) => setHoldUntil(e.target.value)} error={errors.holdUntil} min={today} hint="The hold lifts itself after this date. Empty = until removed." />
            <TextInput id="hold-reason" label="Reason" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} error={errors.holdReason} autoComplete="off" hint="Shown to whoever is refused, and kept in the history." />
          </div>
        ) : null}
      </fieldset>
      <fieldset disabled={!canEdit}>
        <legend>Status</legend>
        <div className="form-grid">
          <SelectInput id="hold-status" label="Status" value={status} onChange={(e) => setStatus(e.target.value as PartyStatus)} error={errors.status} hint="Blocked = only the trusted role may post for them. Switched off = refused on every document.">
            {PARTY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </SelectInput>
        </div>
      </fieldset>
      {canEdit ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save hold settings
          </Button>
        </div>
      ) : (
        <p className="muted">Only the trusted role (suppliers.hold) can hold, block or switch off a supplier.</p>
      )}
    </form>
  );
}
