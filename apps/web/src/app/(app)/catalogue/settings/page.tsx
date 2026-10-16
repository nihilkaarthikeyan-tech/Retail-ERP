// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { hasPermission, updateCatalogueSettingsSchema } from "shared";
import { Alert, Button, CheckInput, SelectInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { flattenGroups } from "@/lib/catalogue";
import type { CatalogueSettingsDto, ItemGroupNode, PriceListDto, UnitDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface SettingsForm {
  autoItemCodes: boolean;
  defaultItemGroupId: string;
  defaultUnitId: string;
  defaultSellingPriceListId: string;
  defaultBuyingPriceListId: string;
  fallbackToDefaultSellingList: boolean;
  allowPriceChangeOnBill: boolean;
  blockSellingBelowCost: boolean;
  saveTypedPrices: boolean;
}

function fromDto(s: CatalogueSettingsDto): SettingsForm {
  return {
    autoItemCodes: s.autoItemCodes,
    defaultItemGroupId: s.defaultItemGroupId ?? "",
    defaultUnitId: s.defaultUnitId ?? "",
    defaultSellingPriceListId: s.defaultSellingPriceListId ?? "",
    defaultBuyingPriceListId: s.defaultBuyingPriceListId ?? "",
    fallbackToDefaultSellingList: s.fallbackToDefaultSellingList,
    allowPriceChangeOnBill: s.allowPriceChangeOnBill,
    blockSellingBelowCost: s.blockSellingBelowCost,
    saveTypedPrices: s.saveTypedPrices,
  };
}

function SettingsForm({ settings, groups, units, lists, canEdit, onSaved }: { settings: CatalogueSettingsDto; groups: ItemGroupNode[]; units: UnitDto[]; lists: PriceListDto[]; canEdit: boolean; onSaved: (s: CatalogueSettingsDto) => void }) {
  const [form, setForm] = useState<SettingsForm>(() => fromDto(settings));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const setFlag = (key: "autoItemCodes" | "fallbackToDefaultSellingList" | "allowPriceChangeOnBill" | "blockSellingBelowCost" | "saveTypedPrices") => (e: { target: { checked: boolean } }) =>
    setForm((f) => ({ ...f, [key]: e.target.checked }));
  const setId = (key: "defaultItemGroupId" | "defaultUnitId" | "defaultSellingPriceListId" | "defaultBuyingPriceListId") => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const parsed = updateCatalogueSettingsSchema.safeParse({
      autoItemCodes: form.autoItemCodes,
      defaultItemGroupId: form.defaultItemGroupId || null,
      defaultUnitId: form.defaultUnitId || null,
      defaultSellingPriceListId: form.defaultSellingPriceListId || null,
      defaultBuyingPriceListId: form.defaultBuyingPriceListId || null,
      fallbackToDefaultSellingList: form.fallbackToDefaultSellingList,
      allowPriceChangeOnBill: form.allowPriceChangeOnBill,
      blockSellingBelowCost: form.blockSellingBelowCost,
      saveTypedPrices: form.saveTypedPrices,
    });
    const issues = issuesToFieldErrors(parsed);
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      const updated = await api.patch<CatalogueSettingsDto>("/catalogue/settings", parsed.data);
      setForm(fromDto(updated));
      setSaved(true);
      onSaved(updated);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const groupOptions = flattenGroups(groups).filter((g) => g.active || g.id === form.defaultItemGroupId);
  const selling = lists.filter((l) => l.forSelling && (l.active || l.id === form.defaultSellingPriceListId));
  const buying = lists.filter((l) => l.forBuying && (l.active || l.id === form.defaultBuyingPriceListId));

  return (
    <form onSubmit={onSubmit} noValidate>
      <Alert kind="error">{error}</Alert>
      {saved ? <Alert kind="success">Catalogue settings saved.</Alert> : null}
      <fieldset disabled={!canEdit}>
        <legend>New items</legend>
        <CheckInput id="cs-autoItemCodes" label="Number items automatically" description="Uses the “item” number series (ITM-000001) when no code is typed. Typed codes are always allowed." checked={form.autoItemCodes} onChange={setFlag("autoItemCodes")} />
        <div className="form-grid" style={{ marginTop: 12 }}>
          <SelectInput id="cs-defaultGroup" label="Default item group" value={form.defaultItemGroupId} onChange={setId("defaultItemGroupId")} error={errors.defaultItemGroupId}>
            <option value="">None</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id} disabled={!g.isLeaf}>
                {g.label}
              </option>
            ))}
          </SelectInput>
          <SelectInput id="cs-defaultUnit" label="Default basic unit" value={form.defaultUnitId} onChange={setId("defaultUnitId")} error={errors.defaultUnitId}>
            <option value="">None</option>
            {units
              .filter((u) => u.active || u.id === form.defaultUnitId)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.name}
                </option>
              ))}
          </SelectInput>
        </div>
      </fieldset>

      <fieldset disabled={!canEdit}>
        <legend>Price lists</legend>
        <div className="form-grid">
          <SelectInput id="cs-sellingList" label="Default selling price list" value={form.defaultSellingPriceListId} onChange={setId("defaultSellingPriceListId")} error={errors.defaultSellingPriceListId} hint="Used by the till and for an item's first selling price.">
            <option value="">None</option>
            {selling.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput id="cs-buyingList" label="Default buying price list" value={form.defaultBuyingPriceListId} onChange={setId("defaultBuyingPriceListId")} error={errors.defaultBuyingPriceListId} hint={buying.length === 0 ? "No buying list is visible to you." : "Used by purchase orders."}>
            <option value="">None</option>
            {buying.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectInput>
        </div>
        <CheckInput id="cs-fallback" label="Fall back to the default selling list" description="When a customer's own list has no price for an item, use the default selling list." checked={form.fallbackToDefaultSellingList} onChange={setFlag("fallbackToDefaultSellingList")} />
      </fieldset>

      <fieldset disabled={!canEdit}>
        <legend>At the till (used from the point of sale module on)</legend>
        <CheckInput id="cs-allowChange" label="Allow changing the price on a bill" description="Off = only a manager (with their PIN) can change a price on a bill, even on tills that allow price changes." checked={form.allowPriceChangeOnBill} onChange={setFlag("allowPriceChangeOnBill")} />
        <CheckInput id="cs-blockBelowCost" label="Block selling below cost" description="A till line whose price before GST is under the item's last purchase price or current cost needs a manager's PIN. Returns and free items are never blocked." checked={form.blockSellingBelowCost} onChange={setFlag("blockSellingBelowCost")} />
        <CheckInput id="cs-saveTyped" label="Save typed prices into the price list" description="When an item has no price in the till's list, the price typed on the bill is used and saved as its price from that day." checked={form.saveTypedPrices} onChange={setFlag("saveTypedPrices")} />
      </fieldset>

      {canEdit ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save settings
          </Button>
        </div>
      ) : (
        <p className="muted">Only the Owner / Admin can change these settings.</p>
      )}
    </form>
  );
}

export default function CatalogueSettingsPage() {
  const { user } = useAuth();
  const canEdit = user?.isOwnerAdmin ?? false;
  const canSeePrices = hasPermission(user, "prices.view");
  const settings = useLoad(() => api.get<CatalogueSettingsDto>("/catalogue/settings"));
  const groups = useLoad(() => api.get<ItemGroupNode[]>("/catalogue/item-groups"));
  const units = useLoad(() => api.get<UnitDto[]>("/catalogue/units"));
  const lists = useLoad<PriceListDto[]>(() => (canSeePrices ? api.get<PriceListDto[]>("/price-lists") : Promise.resolve([])), [canSeePrices]);

  return (
    <>
      <h1>Catalogue settings</h1>
      <p className="muted">Defaults for new items and how prices behave. One set per company.</p>
      <Alert kind="error">{settings.error ?? groups.error ?? units.error ?? lists.error}</Alert>
      {settings.data && groups.data && units.data && lists.data ? (
        <SettingsForm key={settings.data.updatedAt} settings={settings.data} groups={groups.data} units={units.data} lists={lists.data} canEdit={canEdit} onSaved={settings.setData} />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </>
  );
}
