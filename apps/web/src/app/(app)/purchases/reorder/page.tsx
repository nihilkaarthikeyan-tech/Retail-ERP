// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { useState } from "react";
import { createOrdersFromSuggestionsSchema } from "shared";
import { useOrderStores } from "@/components/purchasing/orders-shared";
import { Alert, Button, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format";
import { useModules } from "@/lib/modules";
import { type PurchaseOrderDto, purchaseRights, type ReorderSuggestionDto } from "@/lib/purchasing";
import { showQuantity, useBusinessToday } from "@/lib/stock";
import { useLoad } from "@/lib/use-load";
import { issuesToFieldErrors } from "@/lib/validation";

export default function ReorderSuggestionsPage() {
  const { user } = useAuth();
  const rights = purchaseRights(user);
  // Plan 12: making purchase orders from the suggestions only while "Purchase orders" is on.
  const { isOn } = useModules();
  const canMakeOrders = rights.order && isOn("purchase_orders");
  const today = useBusinessToday();
  const stores = useOrderStores();
  const [storeId, setStoreId] = useState("");
  const suggestions = useLoad(() => api.get<ReorderSuggestionDto[]>(`/purchase/reorder-suggestions${query({ storeId })}`), [storeId]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [neededBy, setNeededBy] = useState("");
  const [neededByError, setNeededByError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"run" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; number: string }[]>([]);

  const rows = suggestions.data ?? [];
  const orderable = rows.filter((r) => r.supplier);
  const chosen = orderable.filter((r) => ticked.has(r.id));

  function toggle(id: string, on: boolean) {
    setTicked((t) => {
      const next = new Set(t);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function runNow() {
    setBusy("run");
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<{ suggestions: number }>("/purchase/reorder-suggestions/run");
      setNotice(result.suggestions === 0 ? "Nothing is below its reorder level right now." : `${result.suggestions} item${result.suggestions === 1 ? " is" : "s are"} below the reorder level.`);
      setTicked(new Set());
      setCreated([]);
      await suggestions.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function createOrders() {
    setError(null);
    setNotice(null);
    const parsed = createOrdersFromSuggestionsSchema.safeParse({ suggestionIds: chosen.map((r) => r.id), ...(neededBy ? { neededBy } : {}) });
    const fieldErrors = issuesToFieldErrors(parsed);
    const dateProblem = neededBy && today && neededBy < today ? "The date needed cannot be in the past" : null;
    setNeededByError(fieldErrors.neededBy ?? dateProblem);
    if (!parsed.success || dateProblem) {
      setError(fieldErrors.suggestionIds ?? "Please fix the fields marked below.");
      return;
    }
    setBusy("create");
    try {
      const result = await api.post<{ orderIds: string[] }>("/purchase/reorder-suggestions/create-orders", parsed.data);
      const orders = await Promise.all(
        result.orderIds.map((id) =>
          api.get<PurchaseOrderDto>(`/purchase/orders/${id}`).then(
            (o) => ({ id, number: o.number }),
            () => ({ id, number: "Draft order" }),
          ),
        ),
      );
      setCreated(orders);
      setTicked(new Set());
      await suggestions.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<ReorderSuggestionDto>[] = [
    ...(canMakeOrders
      ? ([
          {
            key: "tick",
            header: (
              <input
                type="checkbox"
                aria-label="Tick all"
                checked={orderable.length > 0 && chosen.length === orderable.length}
                disabled={orderable.length === 0}
                onChange={(e) => setTicked(e.target.checked ? new Set(orderable.map((r) => r.id)) : new Set())}
              />
            ),
            render: (r: ReorderSuggestionDto) => (
              <input
                type="checkbox"
                aria-label={`Order ${r.item?.code ?? "item"} for ${r.store?.code ?? "store"}`}
                checked={ticked.has(r.id)}
                disabled={!r.supplier}
                title={r.supplier ? undefined : "No usual supplier; set one on the item or order it by hand"}
                onChange={(e) => toggle(r.id, e.target.checked)}
              />
            ),
          },
        ] satisfies Column<ReorderSuggestionDto>[])
      : []),
    { key: "store", header: "Store", render: (r) => r.store?.code ?? "—" },
    {
      key: "item",
      header: "Item",
      render: (r) =>
        r.item ? (
          <>
            <span className="mono">{r.item.code}</span> {r.item.name}
          </>
        ) : (
          "—"
        ),
    },
    {
      key: "supplier",
      header: "Supplier",
      render: (r) =>
        r.supplier ? (
          <>
            {r.supplier.name}
            {r.supplierSource === "last" ? <span className="muted"> (last bought from)</span> : null}
          </>
        ) : (
          <span className="muted">None yet</span>
        ),
    },
    { key: "onHand", header: "In stock", align: "right", render: (r) => showQuantity(r.onHand) },
    { key: "onOrder", header: "On order", align: "right", render: (r) => showQuantity(r.onOrder) },
    { key: "level", header: "Reorder level", align: "right", render: (r) => showQuantity(r.reorderLevel) },
    { key: "suggested", header: "Suggested", align: "right", render: (r) => <strong>{showQuantity(r.suggestedQuantity)}</strong> },
  ];

  const lastRun = rows.reduce<string | null>((latest, r) => (!latest || r.businessDate > latest ? r.businessDate : latest), null);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Reorder suggestions</h1>
        <span className="spacer" />
        {rights.order ? (
          <Button busy={busy === "run"} disabled={busy !== null} onClick={runNow}>
            Run now
          </Button>
        ) : null}
      </div>
      <p className="muted">
        Items that have fallen below their reorder level in each store, with how many to buy
        {canMakeOrders ? "; tick the ones you want and the system makes draft purchase orders, one per supplier and store." : "."}
      </p>
      {/* Launch check, 27 October 2026: say why a quantity is on order, and where the supplier comes from. */}
      <p className="muted">
        <strong>On order</strong> is what suppliers have still to send: ordered and not yet received, including pieces sent back on a return, which the supplier is expected to replace. The supplier is the item&apos;s usual one, or the one it was last bought from.
      </p>
      <div className="filter-row">
        <SelectInput id="reorder-store" label="Store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">All my stores</option>
          {stores.stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
      </div>
      {lastRun ? <p className="muted">Worked out on {formatDate(lastRun)}. Quantities are in each item&apos;s basic unit.</p> : null}
      <Alert kind="error">{suggestions.error ?? stores.error}</Alert>
      <DataTable columns={columns} rows={suggestions.data} rowKey={(r) => r.id} loading={suggestions.loading} empty="Nothing to reorder." />

      {canMakeOrders && orderable.length > 0 ? (
        <div className="card">
          <div className="form-grid">
            <TextInput
              id="reorder-needed-by"
              label="Needed by (optional)"
              type="date"
              value={neededBy}
              min={today || undefined}
              onChange={(e) => setNeededBy(e.target.value)}
              error={neededByError}
              hint="Blank: a week from today."
            />
          </div>
          <div className="actions">
            <Button variant="primary" busy={busy === "create"} disabled={busy !== null || chosen.length === 0} onClick={createOrders}>
              Create orders{chosen.length > 0 ? ` (${chosen.length} ticked)` : ""}
            </Button>
          </div>
        </div>
      ) : null}

      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{notice}</Alert>
      {created.length > 0 ? (
        <div className="alert alert-success" role="status">
          Draft orders made:{" "}
          {created.map((o, i) => (
            <span key={o.id}>
              {i > 0 ? ", " : ""}
              <Link href={`/purchases/orders/${o.id}`} className="mono">
                {o.number}
              </Link>
            </span>
          ))}
          . Check them and finalise when ready.
        </div>
      ) : null}
    </>
  );
}
