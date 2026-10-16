// Copyright (c) 2026, Rademics. All rights reserved.
// Home-delivery settings (plan 11 B4, decision 47): the service item the
// charge is billed as, and each store's charge with the bill value from which
// delivery is free.
"use client";

import { useState } from "react";
import { storeDeliveryChargesSchema } from "shared";
import { ItemPicker } from "@/components/prices/item-picker";
import { Alert, Button } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { ItemDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import type { PosSettingsDto } from "./pos-shared";

interface StoreCharges {
  storeId: string;
  code: string;
  name: string;
  deliveryCharge: string;
  deliveryFreeAbove: string | null;
}

export function DeliverySettings({ settings, canEdit, onSaved }: { settings: PosSettingsDto; canEdit: boolean; onSaved: (s: PosSettingsDto) => void }) {
  const item = useLoad<ItemDto | null>(() => (settings.deliveryItemId ? api.get<ItemDto>(`/items/${settings.deliveryItemId}`) : Promise.resolve(null)), [settings.deliveryItemId]);
  const stores = useLoad(() => api.get<StoreCharges[]>("/pos/delivery-charges"));
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  async function chooseItem(next: ItemDto | null) {
    setError(null);
    try {
      onSaved(await api.patch<PosSettingsDto>("/pos/settings", { deliveryItemId: next?.id ?? null }));
      setPicking(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Home delivery</h2>
      <p className="muted">A bill marked for home delivery gets the store&apos;s delivery charge as a line, billed as the item below (a service item with its SAC code, not a stock item). No charge at or above the &quot;free above&quot; amount.</p>
      <Alert kind="error">{error}</Alert>
      <p>
        Delivery charge item:{" "}
        {item.data ? (
          <>
            <span className="mono">{item.data.code}</span> {item.data.name}
          </>
        ) : (
          <span className="muted">not chosen</span>
        )}{" "}
        {canEdit && !picking ? (
          <Button size="small" variant="link" onClick={() => setPicking(true)}>
            {item.data ? "Change" : "Choose"}
          </Button>
        ) : null}
      </p>
      {picking ? <ItemPicker id="pos-delivery-item" label="Service item for the delivery charge" value={null} onChange={(i) => i && void chooseItem(i)} /> : null}
      <Alert kind="error">{stores.error}</Alert>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Store</th>
              <th scope="col">Delivery charge (₹)</th>
              <th scope="col">Free for bills of (₹)</th>
              <th scope="col">
                <span className="sr-only">Save</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(stores.data ?? []).map((s) => (
              <StoreRow key={s.storeId} store={s} canEdit={canEdit} onSaved={(next) => stores.setData((stores.data ?? []).map((x) => (x.storeId === next.storeId ? next : x)))} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StoreRow({ store, canEdit, onSaved }: { store: StoreCharges; canEdit: boolean; onSaved: (s: StoreCharges) => void }) {
  const [charge, setCharge] = useState(store.deliveryCharge);
  const [freeAbove, setFreeAbove] = useState(store.deliveryFreeAbove ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setError(null);
    setSaved(false);
    const parsed = storeDeliveryChargesSchema.safeParse({ deliveryCharge: charge.trim() || "0", deliveryFreeAbove: freeAbove.trim() || null });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the amounts");
    setBusy(true);
    try {
      onSaved(await api.patch<StoreCharges>(`/pos/stores/${store.storeId}/delivery-charges`, parsed.data));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>
        <span className="mono">{store.code}</span> {store.name}
        {error ? <div className="field-error">{error}</div> : null}
      </td>
      <td>
        <input id={`del-charge-${store.code}`} className="input" aria-label={`Delivery charge for ${store.code}`} inputMode="decimal" value={charge} disabled={!canEdit} onChange={(e) => setCharge(e.target.value)} />
      </td>
      <td>
        <input id={`del-free-${store.code}`} className="input" aria-label={`Free for bills of, ${store.code}`} inputMode="decimal" placeholder="Always charged" value={freeAbove} disabled={!canEdit} onChange={(e) => setFreeAbove(e.target.value)} />
      </td>
      <td>
        {canEdit ? (
          <Button size="small" busy={busy} onClick={() => void save()}>
            {saved ? "Saved" : "Save"}
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

/** Plan 11 part 2: the service item an alteration charge is billed as at the till. */
export function AlterationChargeSettings({ settings, canEdit, onSaved }: { settings: PosSettingsDto; canEdit: boolean; onSaved: (s: PosSettingsDto) => void }) {
  const item = useLoad<ItemDto | null>(() => (settings.alterationItemId ? api.get<ItemDto>(`/items/${settings.alterationItemId}`) : Promise.resolve(null)), [settings.alterationItemId]);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  async function chooseItem(next: ItemDto | null) {
    setError(null);
    try {
      onSaved(await api.patch<PosSettingsDto>("/pos/settings", { alterationItemId: next?.id ?? null }));
      setPicking(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Alterations</h2>
      <p className="muted">An alteration charge is billed at the till as a line of this item: a service item with its SAC code, not a stock item. It goes on the purchase bill or on the bill when the garment is collected, never both.</p>
      <Alert kind="error">{error}</Alert>
      <p>
        Alteration charge item:{" "}
        {item.data ? (
          <>
            <span className="mono">{item.data.code}</span> {item.data.name}
          </>
        ) : (
          <span className="muted">not chosen</span>
        )}{" "}
        {canEdit && !picking ? (
          <Button size="small" variant="link" onClick={() => setPicking(true)}>
            {item.data ? "Change" : "Choose"}
          </Button>
        ) : null}
      </p>
      {picking ? <ItemPicker id="pos-alteration-item" label="Service item for the alteration charge" value={null} onChange={(i) => i && void chooseItem(i)} /> : null}
    </div>
  );
}
