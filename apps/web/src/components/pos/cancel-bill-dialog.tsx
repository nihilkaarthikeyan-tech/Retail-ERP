// Copyright (c) 2026, Rademics. All rights reserved.
// Cancelling a till bill: same day, before the shift closes, with a manager's PIN (plan 06 §4).
"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Dialog, TextareaInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { ManagerPinFields, type ManagerPinValue, requestApproval } from "./manager-pin";
import type { PosBillDto } from "./pos-shared";

export function CancelBillDialog({ bill, open, onClose, onCancelled }: { bill: PosBillDto; open: boolean; onClose: () => void; onCancelled: () => void }) {
  const [reason, setReason] = useState("");
  const [approval, setApproval] = useState<ManagerPinValue>({ managerId: "", pin: "" });
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const why = reason.trim();
    setReasonError(why ? null : "Say why the bill is cancelled.");
    if (!why) return;
    setBusy(true);
    try {
      const { token } = await requestApproval(bill.till.id, "cancel_bill", approval, bill.number);
      await api.post(`/pos/bills/${bill.id}/cancel`, { reason: why, approvalToken: token });
      setApproval({ managerId: approval.managerId, pin: "" });
      onCancelled();
    } catch (err) {
      setApproval((a) => ({ ...a, pin: "" }));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={`Cancel bill ${bill.number}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Alert kind="info">
          {bill.exchangeId ? "This bill is part of an exchange; both bills are cancelled together. " : ""}
          The stock comes back and any coupon use is taken back. The bill is kept, marked cancelled. Only bills of a shift that is still open can be cancelled; otherwise make a return.
        </Alert>
        <Alert kind="error">{error}</Alert>
        <TextareaInput id="cancel-reason" label="Reason" required rows={2} value={reason} error={reasonError} onChange={(e) => setReason(e.target.value)} />
        <ManagerPinFields tillId={bill.till.id} value={approval} onChange={setApproval} idPrefix="cancel" />
        <div className="actions">
          <Button type="submit" variant="danger" busy={busy}>
            Cancel the bill
          </Button>
          <Button onClick={onClose}>Keep the bill</Button>
        </div>
      </form>
    </Dialog>
  );
}
