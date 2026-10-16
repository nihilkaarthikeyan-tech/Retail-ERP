// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { reasonSchema } from "shared";
import { Alert, Badge, Button, Dialog, TextareaInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { type GoodsReceiptHeader, RECEIPT_STATUS_LABELS, statusTone } from "@/lib/purchasing";
import { issuesToFieldErrors } from "@/lib/validation";

/** Status of a goods receipt; returns are also marked "Return", sale-or-return goods "Sale or return". */
export function ReceiptStatusBadge({ receipt }: { receipt: Pick<GoodsReceiptHeader, "status" | "isReturn"> & { isConsignment?: boolean } }) {
  return (
    <>
      {receipt.isConsignment ? <Badge kind="neutral">Sale or return</Badge> : null} {receipt.isReturn ? <Badge kind="warn">Return</Badge> : null} <Badge kind={statusTone(receipt.status)}>{RECEIPT_STATUS_LABELS[receipt.status] ?? receipt.status}</Badge>
    </>
  );
}

interface ReasonDialogProps<T> {
  open: boolean;
  title: string;
  /** What the action does, in plain words. */
  explanation: ReactNode;
  /** API path the reason is posted to. */
  path: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onDone: (result: T) => void;
}

/** Asks for a reason, explains the action, then posts { reason } and shows the API's refusal if any. */
export function ReasonDialog<T>({ open, title, explanation, path, confirmLabel, danger, onClose, onDone }: ReasonDialogProps<T>) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = reasonSchema.safeParse({ reason });
    setFieldError(parsed.success ? null : reason.trim() ? (issuesToFieldErrors(parsed).reason ?? "Check the reason") : "Give a reason");
    if (!parsed.success) return;
    setBusy(true);
    try {
      const after = await api.post<T>(path, parsed.data);
      onDone(after);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error}</Alert>
        <p>{explanation}</p>
        <TextareaInput id="reason-text" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={fieldError} required maxLength={300} />
        <div className="actions">
          <Button type="submit" variant={danger ? "danger" : "primary"} busy={busy}>
            {confirmLabel}
          </Button>
          <Button onClick={onClose}>Go back</Button>
        </div>
      </form>
    </Dialog>
  );
}
