// Copyright (c) 2026, Rademics. All rights reserved.
// Small parts shared by the purchase order and reorder screens.
"use client";

import { useState, type FormEvent } from "react";
import { hasPermission, reasonSchema } from "shared";
import { Alert, Badge, Button, Dialog, TextareaInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { ORDER_STATUS_LABELS, type PurchaseOrderStatus, statusTone } from "@/lib/purchasing";
import { storesFromLocations } from "@/lib/stock";
import type { StockLocationDto, StoreDto, StoreRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { issuesToFieldErrors } from "@/lib/validation";

export function OrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge kind={statusTone(status)}>{ORDER_STATUS_LABELS[status] ?? status}</Badge>;
}

/**
 * The stores the user may order for. Users limited to some stores get those;
 * users with every store get the company's active stores (from the store list,
 * or from the stock locations when they cannot list stores).
 */
export function useOrderStores(): { stores: StoreRef[]; loading: boolean; error: string | null } {
  const { user } = useAuth();
  const allStores = !!user?.allStores;
  const canListStores = hasPermission(user, "stores.view");
  const canSeeLocations = hasPermission(user, "stock.view");
  const loaded = useLoad<StoreRef[] | null>(async () => {
    if (!allStores) return null;
    if (canListStores) {
      const rows = await api.get<StoreDto[]>("/stores");
      return rows.filter((s) => s.active).map((s) => ({ id: s.id, code: s.code, name: s.name }));
    }
    if (canSeeLocations) return storesFromLocations(await api.get<StockLocationDto[]>("/stock/locations"));
    return [];
  }, [allStores, canListStores, canSeeLocations]);
  const own: StoreRef[] = (user?.stores ?? []).map((s) => ({ id: s.id, code: s.code, name: s.name }));
  const stores = allStores ? (loaded.data ?? []) : own;
  return { stores: [...stores].sort((a, b) => a.code.localeCompare(b.code)), loading: allStores && !loaded.error && (loaded.loading || loaded.data === null), error: loaded.error };
}

interface ReasonDialogProps {
  open: boolean;
  title: string;
  /** One or two plain sentences on what happens. */
  explain: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  /** Sends the reason; a thrown error is shown in the dialog. */
  onConfirm: (reason: string) => Promise<void>;
}

/** Asks for a reason (hold, close, cancel) before the action is sent. */
export function OrdersReasonDialog({ open, title, explain, confirmLabel, danger, onClose, onConfirm }: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = reasonSchema.safeParse({ reason });
    setFieldError(parsed.success ? null : (issuesToFieldErrors(parsed).reason ?? "Give a reason"));
    if (!parsed.success) return;
    setBusy(true);
    try {
      await onConfirm(parsed.data.reason);
      setReason("");
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
        <p>{explain}</p>
        <TextareaInput id="order-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} error={fieldError} maxLength={300} required />
        <div className="actions">
          <Button type="submit" variant={danger ? "danger" : "primary"} busy={busy}>
            {confirmLabel}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Go back
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
