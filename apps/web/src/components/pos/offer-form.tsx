// Copyright (c) 2026, Rademics. All rights reserved.
// Offer and coupon editors (plan 06 answer 2: simple offers and coupons).
"use client";

import { useState, type FormEvent } from "react";
import { couponSchema, offerSchema } from "shared";
import { PartyPicker } from "@/components/parties/party-picker";
import { ItemPicker } from "@/components/prices/item-picker";
import { useStockLocations } from "@/components/stock/use-stock-refs";
import { Alert, Button, CheckInput, Field, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { flattenGroups } from "@/lib/catalogue";
import { showQuantity, storesFromLocations } from "@/lib/stock";
import type { BrandDto, ItemDto, ItemGroupNode, PartyGroupNode, PartyRef } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";
import { type CouponDto, OFFER_KIND_LABELS, OFFER_TARGET_LABELS, type OfferDto, type OfferKind, type OfferTarget } from "./pos-shared";

interface OfferFormState {
  code: string;
  name: string;
  kind: OfferKind;
  appliesTo: OfferTarget;
  targetIds: string[];
  value: string;
  buyQuantity: string;
  freeQuantity: string;
  freeItemId: string;
  setQuantity: string;
  setPrice: string;
  cheapestFree: boolean;
  minQuantity: string;
  minAmount: string;
  storeIds: string[];
  customerGroupId: string;
  startDate: string;
  endDate: string;
  priority: string;
  couponOnly: boolean;
  active: boolean;
}

const blank = (v: string) => (v.trim() === "" ? null : v.trim());
const fromDecimal = (v: string | null) => (v == null ? "" : showQuantity(v));

function initial(offer: OfferDto | null, today: string): OfferFormState {
  if (!offer) {
    return { code: "", name: "", kind: "percent", appliesTo: "items", targetIds: [], value: "", buyQuantity: "", freeQuantity: "", freeItemId: "", setQuantity: "", setPrice: "", cheapestFree: false, minQuantity: "", minAmount: "", storeIds: [], customerGroupId: "", startDate: today, endDate: "", priority: "0", couponOnly: false, active: true };
  }
  return {
    code: offer.code,
    name: offer.name,
    kind: offer.kind,
    appliesTo: offer.appliesTo,
    targetIds: offer.targetIds,
    value: fromDecimal(offer.value),
    buyQuantity: fromDecimal(offer.buyQuantity),
    freeQuantity: fromDecimal(offer.freeQuantity),
    freeItemId: offer.freeItemId ?? "",
    setQuantity: offer.setQuantity == null ? "" : String(offer.setQuantity),
    setPrice: offer.setPrice ?? "",
    cheapestFree: !!offer.cheapestFree,
    minQuantity: fromDecimal(offer.minQuantity),
    minAmount: offer.minAmount ?? "",
    storeIds: offer.storeIds,
    customerGroupId: offer.customerGroupId ?? "",
    startDate: offer.startDate,
    endDate: offer.endDate ?? "",
    priority: String(offer.priority),
    couponOnly: offer.couponOnly,
    active: offer.active,
  };
}

/** What the API receives for a form (before validation). */
function offerPayload(f: OfferFormState) {
  const free = f.kind === "free_goods" || f.kind === "buy_get";
  const mix = f.kind === "mix_match";
  return {
    code: f.code,
    name: f.name,
    kind: f.kind,
    appliesTo: f.appliesTo,
    targetIds: f.appliesTo === "bill" ? [] : f.targetIds,
    value: free || mix ? null : blank(f.value),
    buyQuantity: free ? blank(f.buyQuantity) : null,
    freeQuantity: free ? blank(f.freeQuantity) : null,
    freeItemId: f.kind === "buy_get" ? f.freeItemId || null : null,
    setQuantity: mix && f.setQuantity.trim() !== "" ? Number(f.setQuantity) : null,
    setPrice: mix && !f.cheapestFree ? blank(f.setPrice) : null,
    cheapestFree: mix && f.cheapestFree,
    minQuantity: blank(f.minQuantity),
    minAmount: blank(f.minAmount),
    storeIds: f.storeIds,
    customerGroupId: f.customerGroupId || null,
    startDate: f.startDate,
    endDate: f.endDate || null,
    priority: f.priority.trim() === "" ? 0 : Number(f.priority),
    couponOnly: f.couponOnly,
    active: f.active,
  };
}

function toggle(list: string[], id: string, on: boolean): string[] {
  return on ? [...list, id] : list.filter((x) => x !== id);
}

export function OfferForm({ offer, today, onSaved, onCancel }: { offer: OfferDto | null; today: string; onSaved: (o: OfferDto) => void; onCancel: () => void }) {
  const [form, setForm] = useState<OfferFormState>(() => initial(offer, today));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const [itemNames, setItemNames] = useState<Record<string, ItemDto>>({});
  const groups = useLoad(() => api.get<ItemGroupNode[]>("/catalogue/item-groups"));
  const brands = useLoad(() => api.get<BrandDto[]>("/catalogue/brands"));
  const customerGroups = useLoad(() => api.get<PartyGroupNode[]>("/customer-groups"));
  const locations = useStockLocations();
  const stores = storesFromLocations(locations.data ?? []);
  // Names of items already on a saved offer (and its free item).
  const savedItems = useLoad<ItemDto[]>(() => {
    const ids = [...(offer && offer.appliesTo === "items" ? offer.targetIds : []), ...(offer?.freeItemId ? [offer.freeItemId] : [])];
    return ids.length ? Promise.all(ids.map((id) => api.get<ItemDto>(`/items/${id}`))) : Promise.resolve([]);
  }, [offer?.id]);
  const known: Record<string, ItemDto> = { ...Object.fromEntries((savedItems.data ?? []).map((i) => [i.id, i])), ...itemNames };

  function set<K extends keyof OfferFormState>(key: K, value: OfferFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = offerSchema.safeParse(offerPayload(form));
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      const saved = offer ? await api.patch<OfferDto>(`/pos/offers/${offer.id}`, parsed.data) : await api.post<OfferDto>("/pos/offers", parsed.data);
      onSaved(saved);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const free = form.kind === "free_goods" || form.kind === "buy_get";
  const mix = form.kind === "mix_match";
  const valueLabel = form.kind === "percent" ? "Percentage off (%)" : form.kind === "amount" ? "Rupees off (₹)" : "Special price (₹)";

  return (
    <form onSubmit={submit} noValidate>
      <Alert kind="error">{error}</Alert>
      <div className="form-grid">
        <TextInput id="offer-code" label="Code" required className="mono" value={form.code} error={errors.code} disabled={!!offer} hint={offer ? undefined : "For example DIWALI10. Cannot be changed later."} autoComplete="off" onChange={(e) => set("code", e.target.value)} />
        <TextInput id="offer-name" label="Name" required value={form.name} error={errors.name} autoComplete="off" onChange={(e) => set("name", e.target.value)} />
        <SelectInput id="offer-kind" label="Kind of offer" value={form.kind} error={errors.kind} onChange={(e) => set("kind", e.target.value as OfferKind)}>
          {Object.entries(OFFER_KIND_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectInput>
        <SelectInput id="offer-applies" label="Applies to" value={form.appliesTo} error={errors.appliesTo} onChange={(e) => setForm((f) => ({ ...f, appliesTo: e.target.value as OfferTarget, targetIds: [] }))}>
          {Object.entries(OFFER_TARGET_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectInput>
        {free ? (
          <>
            <TextInput id="offer-buy" label="Buy (quantity)" inputMode="decimal" value={form.buyQuantity} error={errors.buyQuantity} hint={form.kind === "buy_get" ? "Counted over all the listed items on the bill." : "For buy 2 get 1 free, type 2 here."} onChange={(e) => set("buyQuantity", e.target.value)} />
            <TextInput id="offer-free" label="Get free (quantity)" inputMode="decimal" value={form.freeQuantity} error={errors.freeQuantity} hint={form.kind === "buy_get" ? "…of the item chosen below, added to the bill at ₹0." : "…and 1 here. The free goods are the same item."} onChange={(e) => set("freeQuantity", e.target.value)} />
          </>
        ) : mix ? (
          <>
            <TextInput id="offer-set-qty" label="Items in a set" inputMode="numeric" value={form.setQuantity} error={errors.setQuantity} hint="Any of the listed items, counted across the bill. Repeats for every full set." onChange={(e) => set("setQuantity", e.target.value)} />
            <TextInput id="offer-set-price" label="Price of a set (₹)" inputMode="decimal" value={form.cheapestFree ? "" : form.setPrice} error={errors.setPrice} disabled={form.cheapestFree} hint="For any 3 for ₹999, type 3 and 999." onChange={(e) => set("setPrice", e.target.value)} />
            <CheckInput id="offer-cheapest" label="Cheapest one of each set free" description="Instead of a set price: buy 2, the cheaper one is free." checked={form.cheapestFree} onChange={(e) => set("cheapestFree", e.target.checked)} />
          </>
        ) : (
          <TextInput id="offer-value" label={valueLabel} inputMode="decimal" value={form.value} error={errors.value} onChange={(e) => set("value", e.target.value)} />
        )}
        <TextInput id="offer-min-qty" label="Minimum quantity" inputMode="decimal" value={form.minQuantity} error={errors.minQuantity} hint="Leave empty for none." onChange={(e) => set("minQuantity", e.target.value)} />
        <TextInput id="offer-min-amount" label="Minimum amount (₹)" inputMode="decimal" value={form.minAmount} error={errors.minAmount} hint="Leave empty for none." onChange={(e) => set("minAmount", e.target.value)} />
        <TextInput id="offer-start" label="Starts on" type="date" required value={form.startDate} error={errors.startDate} onChange={(e) => set("startDate", e.target.value)} />
        <TextInput id="offer-end" label="Ends on" type="date" value={form.endDate} error={errors.endDate} hint="Leave empty to run until switched off." onChange={(e) => set("endDate", e.target.value)} />
        <TextInput id="offer-priority" label="Priority (0–20)" inputMode="numeric" value={form.priority} error={errors.priority} hint="Only used when two offers save the customer the same amount." onChange={(e) => set("priority", e.target.value)} />
        <SelectInput id="offer-customer-group" label="Customer group" value={form.customerGroupId} error={errors.customerGroupId} onChange={(e) => set("customerGroupId", e.target.value)}>
          <option value="">Every customer</option>
          {flattenGroups(customerGroups.data ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </SelectInput>
      </div>

      {form.kind === "buy_get" ? (
        <Field id="offer-free-item" label="Item given free" error={errors.freeItemId}>
          <div id="offer-free-item">
            {form.freeItemId ? (
              <p>
                {known[form.freeItemId] ? (
                  <>
                    <span className="mono">{known[form.freeItemId].code}</span> {known[form.freeItemId].name}
                  </>
                ) : (
                  <span className="muted">Item</span>
                )}{" "}
                <Button size="small" variant="link" onClick={() => set("freeItemId", "")}>
                  Change
                </Button>
              </p>
            ) : (
              <ItemPicker
                id="offer-free-item-picker"
                label="Choose the free item"
                value={null}
                onChange={(item) => {
                  if (!item) return;
                  setItemNames((n) => ({ ...n, [item.id]: item }));
                  set("freeItemId", item.id);
                }}
              />
            )}
          </div>
        </Field>
      ) : null}

      {form.appliesTo === "items" ? (
        <Field id="offer-targets" label="Items" error={errors.targetIds}>
          <div id="offer-targets">
            {form.targetIds.length ? (
              <ul className="changes">
                {form.targetIds.map((id) => (
                  <li key={id}>
                    {known[id] ? (
                      <>
                        <span className="mono">{known[id].code}</span> {known[id].name}
                      </>
                    ) : (
                      <span className="muted">Item</span>
                    )}{" "}
                    <Button size="small" variant="link" onClick={() => set("targetIds", form.targetIds.filter((x) => x !== id))}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <ItemPicker
              key={pickerKey}
              id="offer-item-picker"
              label="Add an item"
              value={null}
              excludeStyles={false}
              onChange={(item) => {
                if (!item) return;
                setItemNames((n) => ({ ...n, [item.id]: item }));
                setForm((f) => (f.targetIds.includes(item.id) ? f : { ...f, targetIds: [...f.targetIds, item.id] }));
                setPickerKey((k) => k + 1);
              }}
            />
          </div>
        </Field>
      ) : form.appliesTo === "groups" ? (
        <Field id="offer-targets" label="Item groups" error={errors.targetIds} hint="Sub-groups are included.">
          <div id="offer-targets" className="check-list">
            {flattenGroups(groups.data ?? []).map((g) => (
              <CheckInput key={g.id} id={`offer-group-${g.id}`} label={g.label} checked={form.targetIds.includes(g.id)} onChange={(e) => set("targetIds", toggle(form.targetIds, g.id, e.target.checked))} />
            ))}
          </div>
        </Field>
      ) : form.appliesTo === "brands" ? (
        <Field id="offer-targets" label="Brands" error={errors.targetIds}>
          <div id="offer-targets" className="check-list">
            {(brands.data ?? []).map((b) => (
              <CheckInput key={b.id} id={`offer-brand-${b.id}`} label={b.name} checked={form.targetIds.includes(b.id)} onChange={(e) => set("targetIds", toggle(form.targetIds, b.id, e.target.checked))} />
            ))}
          </div>
        </Field>
      ) : (
        <p className="muted">A whole-bill offer takes a percentage or rupees off the bill once it reaches the minimum amount.</p>
      )}

      <Field id="offer-stores" label="Stores" hint="Tick none for every store.">
        <div id="offer-stores" className="check-row">
          {stores.map((s) => (
            <CheckInput key={s.id} id={`offer-store-${s.id}`} label={`${s.code} — ${s.name}`} checked={form.storeIds.includes(s.id)} onChange={(e) => set("storeIds", toggle(form.storeIds, s.id, e.target.checked))} />
          ))}
        </div>
      </Field>
      <CheckInput id="offer-coupon-only" label="Only with a coupon" description="The offer works only when the cashier types one of its coupon codes." checked={form.couponOnly} onChange={(e) => set("couponOnly", e.target.checked)} />
      <CheckInput id="offer-active" label="Active" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy}>
          Save offer
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function CouponForm({ offers, today, onSaved, onCancel }: { offers: OfferDto[]; today: string; onSaved: (c: CouponDto) => void; onCancel: () => void }) {
  const usable = offers.filter((o) => o.active && o.couponOnly);
  const [form, setForm] = useState({ code: "", offerId: usable[0]?.id ?? "", startDate: today, endDate: "", maxUses: "" });
  const [customer, setCustomer] = useState<PartyRef | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = couponSchema.safeParse({
      code: form.code,
      offerId: form.offerId,
      startDate: form.startDate,
      endDate: form.endDate || null,
      maxUses: form.maxUses.trim() === "" ? null : Number(form.maxUses),
      customerId: customer?.id ?? null,
    });
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      onSaved(await api.post<CouponDto>("/pos/coupons", parsed.data));
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (usable.length === 0) {
    return (
      <>
        <Alert kind="info">A coupon switches on an offer marked “Only with a coupon”. Make such an offer first.</Alert>
        <div className="actions">
          <Button onClick={onCancel}>Close</Button>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <Alert kind="error">{error}</Alert>
      <TextInput id="coupon-code" label="Coupon code" required className="mono" value={form.code} error={errors.code} hint="4–30 letters, digits or -." autoComplete="off" onChange={(e) => setForm({ ...form, code: e.target.value })} />
      <SelectInput id="coupon-offer" label="Offer it switches on" value={form.offerId} error={errors.offerId} onChange={(e) => setForm({ ...form, offerId: e.target.value })}>
        {usable.map((o) => (
          <option key={o.id} value={o.id}>
            {o.code} — {o.name}
          </option>
        ))}
      </SelectInput>
      <TextInput id="coupon-start" label="Valid from" type="date" required value={form.startDate} error={errors.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
      <TextInput id="coupon-end" label="Valid until" type="date" value={form.endDate} error={errors.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
      <TextInput id="coupon-max" label="Most uses" inputMode="numeric" value={form.maxUses} error={errors.maxUses} disabled={!!customer} hint={customer ? "A personal coupon is used once." : "Leave empty for no limit."} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} />
      <PartyPicker id="coupon-customer" label="For one customer only" kind="customer" value={customer} onChange={setCustomer} error={errors.customerId} hint="Leave empty for anyone." />
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy}>
          Save coupon
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
