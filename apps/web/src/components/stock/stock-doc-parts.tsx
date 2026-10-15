// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { cancelStockDocumentSchema } from "shared";
import { Alert, Badge, Button, Dialog, TextareaInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { STATUS_LABELS } from "@/lib/stock";
import type { StockDocStatus, StockDocumentDto } from "@/lib/types";
import { issuesToFieldErrors } from "@/lib/validation";

export function StockStatusBadge({ status }: { status: StockDocStatus }) {
  const kind = status === "finalised" ? "ok" : status === "cancelled" ? "off" : "neutral";
  return <Badge kind={kind}>{STATUS_LABELS[status]}</Badge>;
}

export function BackDatedBadge({ show }: { show: boolean }) {
  return show ? <Badge kind="warn">Back-dated</Badge> : null;
}

interface CancelDialogProps {
  doc: StockDocumentDto;
  open: boolean;
  onClose: () => void;
  onCancelled: (doc: StockDocumentDto) => void;
}

/** Asks for the reason, explains what cancelling does, then cancels. */
export function CancelDocumentDialog({ doc, open, onClose, onCancelled }: CancelDialogProps) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = cancelStockDocumentSchema.safeParse({ reason });
    setFieldError(issuesToFieldErrors(parsed).reason ?? null);
    if (!parsed.success) return;
    setBusy(true);
    try {
      const after = await api.post<StockDocumentDto>(`/stock/documents/${doc.id}/cancel`, parsed.data);
      onCancelled(after);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title={`Cancel ${doc.number}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error}</Alert>
        {doc.status === "finalised" ? (
          <p>
            Cancelling a finalised document posts <strong>reversing lines</strong> at its original date and time, so the stock and its cost go back exactly as they
            were, and later movements are re-worked. The document stays visible, marked as cancelled. Nothing is deleted.
          </p>
        ) : (
          <p>The draft is kept, marked as cancelled. Nothing in stock changes.</p>
        )}
        <TextareaInput id="cancel-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={fieldError} required maxLength={200} />
        <div className="actions">
          <Button type="submit" variant="danger" busy={busy}>
            Cancel the document
          </Button>
          <Button onClick={onClose}>Keep it</Button>
        </div>
      </form>
    </Dialog>
  );
}
