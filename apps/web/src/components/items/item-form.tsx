// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createItemSchema, updateItemSchema } from "shared";
import { HsnInput } from "@/components/items/hsn-input";
import { Alert, Button, CheckInput, SelectInput, TextInput, TextareaInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { flattenGroups } from "@/lib/catalogue";
import { blankToNull, blankToUndefined } from "@/lib/format";
import type { AttributeDto, BrandDto, CatalogueSettingsDto, ItemDto, ItemGroupNode, UnitDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface ItemFormValues {
  code: string;
  name: string;
  description: string;
  itemGroupId: string;
  brandId: string;
  baseUnitId: string;
  hsnCode: string;
  mrp: string;
  maxDiscountPercent: string;
  isStockItem: boolean;
  canBuy: boolean;
  canSell: boolean;
  endDate: string;
  active: boolean;
  trackBatches: boolean;
  autoNumberBatches: boolean;
  shelfLifeDays: string;
  trackSerials: boolean;
  warrantyDays: string;
  /** Create only. */
  sellingPrice: string;
  isStyle: boolean;
  variantAttributeIds: string[];
}

function fromItem(item: ItemDto | null, settings: CatalogueSettingsDto | null): ItemFormValues {
  if (!item) {
    return {
      code: "",
      name: "",
      description: "",
      itemGroupId: settings?.defaultItemGroupId ?? "",
      brandId: "",
      baseUnitId: settings?.defaultUnitId ?? "",
      hsnCode: "",
      mrp: "",
      maxDiscountPercent: "0",
      isStockItem: true,
      canBuy: true,
      canSell: true,
      endDate: "",
      active: true,
      trackBatches: false,
      autoNumberBatches: true,
      shelfLifeDays: "",
      trackSerials: false,
      warrantyDays: "",
      sellingPrice: "",
      isStyle: false,
      variantAttributeIds: [],
    };
  }
  return {
    code: item.code,
    name: item.name,
    description: item.description ?? "",
    itemGroupId: item.itemGroup.id,
    brandId: item.brand?.id ?? "",
    baseUnitId: item.baseUnit.id,
    hsnCode: item.hsnCode ?? "",
    mrp: item.mrp ?? "",
    maxDiscountPercent: item.maxDiscountPercent,
    isStockItem: item.isStockItem,
    canBuy: item.canBuy,
    canSell: item.canSell,
    endDate: item.endDate ?? "",
    active: item.active,
    trackBatches: item.trackBatches,
    autoNumberBatches: item.autoNumberBatches,
    shelfLifeDays: item.shelfLifeDays == null ? "" : String(item.shelfLifeDays),
    trackSerials: item.trackSerials,
    warrantyDays: item.warrantyDays == null ? "" : String(item.warrantyDays),
    sellingPrice: "",
    isStyle: item.isParentStyle,
    variantAttributeIds: item.variantAttributes.map((a) => a.id),
  };
}

/** Whole-number field: empty → null, else a number (zod reports anything odd). */
function intOrNull(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

interface ItemFormProps {
  /** Null = create a new item. */
  item: ItemDto | null;
  groups: ItemGroupNode[];
  brands: BrandDto[];
  units: UnitDto[];
  attributes: AttributeDto[];
  settings: CatalogueSettingsDto | null;
  readOnly?: boolean;
  onSaved: (item: ItemDto) => void;
}

export function ItemForm({ item, groups, brands, units, attributes, settings, readOnly = false, onSaved }: ItemFormProps) {
  const [form, setForm] = useState<ItemFormValues>(() => fromItem(item, settings));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  type TextKey = "code" | "name" | "description" | "itemGroupId" | "brandId" | "baseUnitId" | "mrp" | "maxDiscountPercent" | "endDate" | "shelfLifeDays" | "warrantyDays" | "sellingPrice";
  const set = (key: TextKey) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setFlag = (key: "isStockItem" | "canBuy" | "canSell" | "active" | "trackBatches" | "autoNumberBatches" | "trackSerials" | "isStyle") => (e: { target: { checked: boolean } }) =>
    setForm((f) => ({ ...f, [key]: e.target.checked }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const stock = form.isStockItem;
    const common = {
      name: form.name,
      description: blankToNull(form.description),
      itemGroupId: form.itemGroupId,
      brandId: form.brandId || null,
      baseUnitId: form.baseUnitId,
      hsnCode: blankToNull(form.hsnCode),
      mrp: blankToNull(form.mrp),
      maxDiscountPercent: form.maxDiscountPercent.trim() || "0",
      isStockItem: stock,
      canBuy: form.canBuy,
      canSell: form.canSell,
      endDate: blankToNull(form.endDate),
      trackBatches: stock && form.trackBatches,
      autoNumberBatches: form.autoNumberBatches,
      shelfLifeDays: stock ? intOrNull(form.shelfLifeDays) : null,
      trackSerials: stock && form.trackSerials,
      warrantyDays: intOrNull(form.warrantyDays),
    };
    const parsed = item
      ? updateItemSchema.safeParse({ ...common, active: form.active })
      : createItemSchema.safeParse({
          ...common,
          code: blankToUndefined(form.code),
          ...(form.isStyle ? { variantAttributeIds: form.variantAttributeIds } : { sellingPrice: blankToNull(form.sellingPrice) }),
        });
    const issues = issuesToFieldErrors(parsed);
    if (!item && form.isStyle && form.variantAttributeIds.length === 0) issues.variantAttributeIds = "Pick at least one attribute the style varies by";
    setErrors(issues);
    if (!parsed.success || Object.keys(issues).length > 0) return;
    setBusy(true);
    try {
      const saved = item ? await api.patch<ItemDto>(`/items/${item.id}`, parsed.data) : await api.post<ItemDto>("/items", parsed.data);
      onSaved(saved);
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const groupOptions = flattenGroups(groups).filter((g) => g.active || g.id === form.itemGroupId);
  const unitOptions = units.filter((u) => u.active || u.id === form.baseUnitId);
  const brandOptions = brands.filter((b) => b.active || b.id === form.brandId);
  const attributeOptions = attributes.filter((a) => a.active);
  const autoCodes = settings?.autoItemCodes ?? true;
  const isVariant = item?.parent != null;

  return (
    <form onSubmit={onSubmit} noValidate>
      <Alert kind="error">{error}</Alert>
      <fieldset disabled={readOnly}>
        <legend>Details</legend>
        <div className="form-grid">
          {item ? (
            <TextInput id="item-code" label="Code" value={form.code} readOnly className="mono" hint="Codes cannot be changed after creation." />
          ) : (
            <TextInput id="item-code" label="Code" value={form.code} onChange={set("code")} error={errors.code} className="mono" autoComplete="off" hint={autoCodes ? "Left blank = automatic (ITM-000001…). Letters, digits, - . and /." : "Letters, digits, - . and /."} required={!autoCodes} />
          )}
          <TextInput id="item-name" label="Name" value={form.name} onChange={set("name")} error={errors.name} required autoComplete="off" />
          <TextareaInput id="item-description" label="Description" rows={2} value={form.description} onChange={set("description")} error={errors.description} className="span-2" />
          <SelectInput id="item-group" label="Group" value={form.itemGroupId} onChange={set("itemGroupId")} error={errors.itemGroupId} required hint="Only the last level of the tree can hold items.">
            <option value="">Choose a group</option>
            {groupOptions.map((g) => (
              <option key={g.id} value={g.id} disabled={!g.isLeaf}>
                {g.label}
                {g.active ? "" : " (switched off)"}
              </option>
            ))}
          </SelectInput>
          <SelectInput id="item-brand" label="Brand" value={form.brandId} onChange={set("brandId")} error={errors.brandId}>
            <option value="">No brand</option>
            {brandOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.active ? "" : " (switched off)"}
              </option>
            ))}
          </SelectInput>
          <SelectInput id="item-baseUnit" label="Basic unit" value={form.baseUnitId} onChange={set("baseUnitId")} error={errors.baseUnitId} required disabled={isVariant} hint={item ? "Changing it clears the other units of the item." : "The unit stock is counted in."}>
            <option value="">Choose a unit</option>
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} — {u.name}
              </option>
            ))}
          </SelectInput>
          <HsnInput id="item-hsn" value={form.hsnCode} onChange={(hsnCode) => setForm((f) => ({ ...f, hsnCode }))} error={errors.hsnCode} disabled={readOnly} hint="4, 6 or 8 digits; the GST rate per code comes with the GST module." />
          <TextInput id="item-mrp" label="MRP (per basic unit)" value={form.mrp} onChange={set("mrp")} error={errors.mrp} inputMode="decimal" className="mono" hint="Printed maximum retail price, if any." />
          <TextInput id="item-maxDiscount" label="Maximum discount %" value={form.maxDiscountPercent} onChange={set("maxDiscountPercent")} error={errors.maxDiscountPercent} inputMode="decimal" className="mono" hint="0 = no cashier discount unless a manager allows it." />
          <TextInput id="item-endDate" label="End date" type="date" value={form.endDate} onChange={set("endDate")} error={errors.endDate} hint="After this date the item cannot be used on any document." />
          <div className="span-2 check-row">
            <CheckInput id="item-isStockItem" label="Stock item" description="Off = service; no stock is kept." checked={form.isStockItem} onChange={setFlag("isStockItem")} disabled={isVariant || form.isStyle} />
            <CheckInput id="item-canBuy" label="Can be bought" checked={form.canBuy} onChange={setFlag("canBuy")} />
            <CheckInput id="item-canSell" label="Can be sold" checked={form.canSell} onChange={setFlag("canSell")} />
            {item ? <CheckInput id="item-active" label="Active" description="Switched-off items cannot be used on new documents; history is kept." checked={form.active} onChange={setFlag("active")} /> : null}
          </div>
        </div>
      </fieldset>

      {!item ? (
        <fieldset disabled={readOnly}>
          <legend>Style with variants</legend>
          <CheckInput id="item-isStyle" label="This is a style with variants" description="A style (shirt) has variants (shirt red M). Prices, barcodes and stock belong to the variants, never to the style." checked={form.isStyle} onChange={setFlag("isStyle")} />
          {form.isStyle ? (
            <>
              <p className="muted">Attributes the style varies by, in code order:</p>
              {errors.variantAttributeIds ? <p className="field-error">{errors.variantAttributeIds}</p> : null}
              <div className="check-list">
                {attributeOptions.length === 0 ? <p className="muted">No attributes yet. Add them under Catalogue → Attributes.</p> : null}
                {attributeOptions.map((a) => (
                  <CheckInput
                    key={a.id}
                    id={`item-attr-${a.id}`}
                    label={a.name}
                    description={a.kind === "list" ? a.values.map((v) => v.value).join(", ") : `numeric ${a.rangeStart ?? ""}–${a.rangeEnd ?? ""} step ${a.rangeStep ?? ""}`}
                    checked={form.variantAttributeIds.includes(a.id)}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        variantAttributeIds: e.target.checked ? [...new Set([...f.variantAttributeIds, a.id])] : f.variantAttributeIds.filter((x) => x !== a.id),
                      }))
                    }
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="form-grid">
              <TextInput id="item-sellingPrice" label="First selling price" value={form.sellingPrice} onChange={set("sellingPrice")} error={errors.sellingPrice} inputMode="decimal" className="mono" hint="Per basic unit, in the default selling price list. Optional." />
            </div>
          )}
        </fieldset>
      ) : null}

      {!form.isStyle ? (
        <fieldset disabled={readOnly || !form.isStockItem}>
          <legend>Tracking</legend>
          {!form.isStockItem ? <p className="muted">Only stock items can be tracked by batch or serial number.</p> : null}
          <div className="form-grid">
            <div className="check-row span-2">
              <CheckInput id="item-trackBatches" label="Track batches" description="Each receipt creates a batch with its own expiry." checked={form.trackBatches} onChange={setFlag("trackBatches")} />
              <CheckInput id="item-autoNumberBatches" label="Number batches automatically" checked={form.autoNumberBatches} onChange={setFlag("autoNumberBatches")} disabled={!form.trackBatches} />
              <CheckInput id="item-trackSerials" label="Track serial numbers" description="Every unit has its own serial number." checked={form.trackSerials} onChange={setFlag("trackSerials")} />
            </div>
            <TextInput id="item-shelfLifeDays" label="Shelf life (days)" value={form.shelfLifeDays} onChange={set("shelfLifeDays")} error={errors.shelfLifeDays} inputMode="numeric" hint="Suggests the expiry date on receipts." />
            <TextInput id="item-warrantyDays" label="Warranty (days)" value={form.warrantyDays} onChange={set("warrantyDays")} error={errors.warrantyDays} inputMode="numeric" />
          </div>
        </fieldset>
      ) : null}

      {!readOnly ? (
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            {item ? "Save item" : "Create item"}
          </Button>
        </div>
      ) : (
        <p className="muted">You can view this item but not change it.</p>
      )}
    </form>
  );
}
