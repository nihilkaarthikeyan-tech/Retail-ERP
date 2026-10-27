// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { hasPermission, reorderLevelSchema } from "shared";
import { ExportButton } from "@/components/documents/export-button";
import { ItemPicker } from "@/components/prices/item-picker";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { ActiveBadge, Alert, Button, CheckInput, DataTable, Dialog, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { defaultStoreId, showQuantity, storesFromLocations } from "@/lib/stock";
import type { ItemDto, ReorderLevelDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface FormState {
  item: ItemDto | null;
  level: string;
  quantity: string;
  requestType: "buy" | "move";
  active: boolean;
}

export default function ReorderLevelsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user, "stock.locations.manage");
  const canSeeItems = hasPermission(user, "catalogue.view");
  const locations = useStockLocations();
  const stores = storesFromLocations(locations.data ?? []);
  const [chosenStore, setChosenStore] = useState("");
  const storeId = chosenStore || defaultStoreId(user, stores);

  const levels = useLoad<ReorderLevelDto[]>(() => (storeId ? api.get<ReorderLevelDto[]>(`/stock/reorder-levels${query({ storeId })}`) : Promise.resolve([])), [storeId]);
  const itemIds = [...new Set((levels.data ?? []).map((r) => r.itemId))];
  // The reorder list carries only item ids; names come from the items list.
  const items = useLoad<ItemDto[]>(
    () => (canSeeItems ? Promise.all(itemIds.map((id) => api.get<ItemDto>(`/items/${id}`).catch(() => null))).then((r) => r.filter((x): x is ItemDto => x !== null)) : Promise.resolve([])),
    [canSeeItems, itemIds.join(",")],
  );
  const itemById = new Map((items.data ?? []).map((i) => [i.id, i]));

  const [editing, setEditing] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open(row: ReorderLevelDto | null) {
    setErrors({});
    setError(null);
    setEditing(
      row
        ? { item: itemById.get(row.itemId) ?? null, level: showQuantity(row.level), quantity: showQuantity(row.quantity), requestType: row.requestType, active: row.active }
        : { item: null, level: "", quantity: "", requestType: "buy", active: true },
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    const parsed = reorderLevelSchema.safeParse({ itemId: editing.item?.id ?? "", storeId, level: editing.level.trim(), quantity: editing.quantity.trim(), requestType: editing.requestType, active: editing.active });
    const issues = issuesToFieldErrors(parsed);
    if (!editing.item) issues.itemId = "Choose the item";
    setErrors(issues);
    if (!parsed.success || !editing.item) return;
    setBusy(true);
    try {
      await api.post("/stock/reorder-levels", parsed.data);
      setEditing(null);
      await levels.reload();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<ReorderLevelDto>[] = [
    {
      key: "item",
      header: "Item",
      render: (r) => {
        const it = itemById.get(r.itemId);
        return it ? (
          <>
            <span className="mono">{it.code}</span> {it.name}
          </>
        ) : (
          <span className="mono muted">{r.itemId}</span>
        );
      },
    },
    { key: "level", header: "Reorder when stock falls to", align: "right", render: (r) => showQuantity(r.level) },
    { key: "qty", header: "Quantity to ask for", align: "right", render: (r) => showQuantity(r.quantity) },
    { key: "type", header: "How", render: (r) => (r.requestType === "buy" ? "Buy" : "Move from another store") },
    { key: "active", header: "Status", render: (r) => <ActiveBadge active={r.active} /> },
    ...(canManage
      ? [
          {
            key: "edit",
            header: "",
            render: (r: ReorderLevelDto) => (
              <Button size="small" onClick={() => open(r)} disabled={!itemById.has(r.itemId)}>
                Edit
              </Button>
            ),
          } satisfies Column<ReorderLevelDto>,
        ]
      : []),
  ];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Reorder levels</h1>
        <span className="spacer" />
        <ExportButton kind="reorder_levels" />
        {canManage && storeId ? (
          <Button variant="primary" onClick={() => open(null)}>
            Add reorder level
          </Button>
        ) : null}
      </div>
      <p className="muted">Per item and store. When stock falls to the level, the item appears in Reorder suggestions, ready to put on a purchase order. You stay in control: nothing is ordered without you.</p>
      <div className="filter-row">
        <SelectInput id="reorder-store" label="Store" value={storeId} onChange={(e) => setChosenStore(e.target.value)}>
          {stores.length === 0 ? <option value="">No stores</option> : null}
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </SelectInput>
      </div>
      <Alert kind="error">{levels.error ?? locations.error ?? items.error}</Alert>
      <DataTable columns={columns} rows={levels.data} rowKey={(r) => r.id} loading={levels.loading} empty="No reorder levels for this store yet." />

      <Dialog open={editing !== null} title="Reorder level" onClose={() => setEditing(null)}>
        {editing ? (
          <form onSubmit={submit} noValidate>
            <Alert kind="error">{error}</Alert>
            <ItemPicker id="reorder-item" value={editing.item} onChange={(item) => setEditing({ ...editing, item })} error={errors.itemId} />
            <TextInput id="reorder-level" label="Reorder when stock falls to" inputMode="decimal" value={editing.level} onChange={(e) => setEditing({ ...editing, level: e.target.value })} error={errors.level} required />
            <TextInput id="reorder-qty" label="Quantity to ask for" inputMode="decimal" value={editing.quantity} onChange={(e) => setEditing({ ...editing, quantity: e.target.value })} error={errors.quantity} required />
            <SelectInput id="reorder-type" label="How" value={editing.requestType} onChange={(e) => setEditing({ ...editing, requestType: e.target.value as "buy" | "move" })}>
              <option value="buy">Buy from a supplier</option>
              <option value="move">Move from another store</option>
            </SelectInput>
            <CheckInput id="reorder-active" label="Active" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
            <div className="actions">
              <Button type="submit" variant="primary" busy={busy}>
                Save
              </Button>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}
