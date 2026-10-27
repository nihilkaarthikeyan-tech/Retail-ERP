// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createItemSchema, STYLE_FIELDS_FOR_VARIANTS, updateItemSchema } from "shared";
import { GstRateWarning } from "@/components/items/gst-rate-warning";
import { HsnInput } from "@/components/items/hsn-input";
import { Alert, Button, CheckInput, SelectInput, TextInput, TextareaInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { flattenGroups } from "@/lib/catalogue";
import { blankToNull, blankToUndefined } from "@/lib/format";
import { useModules } from "@/lib/modules";
import type { SeasonDto } from "@/lib/styles-seasons";
import type { AttributeDto, BrandDto, CatalogueSettingsDto, ItemDto, ItemGroupNode, UnitDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface ItemFormValues {
  code: string;
  name: string;
  description: string;
  itemGroupId: string;
  brandId: string;
  seasonId: string;
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
  /** Plan 11 B2, editing a style: also change all its sizes and colours. */
  applyToVariants: boolean;
}

function fromItem(item: ItemDto | null, settings: CatalogueSettingsDto | null): ItemFormValues {
  if (!item) {
    return {
      code: "",
      name: "",
      description: "",
      itemGroupId: settings?.defaultItemGroupId ?? "",
      brandId: "",
      seasonId: "",
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
      applyToVariants: true,
    };
  }
  return {
    code: item.code,
    name: item.name,
    description: item.description ?? "",
    itemGroupId: item.itemGroup.id,
    brandId: item.brand?.id ?? "",
    seasonId: item.seasonId ?? "",
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
    applyToVariants: true,
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
  /** Plan 11 C4: seasons to choose from (GET /seasons). */
  seasons?: SeasonDto[];
  readOnly?: boolean;
  onSaved: (item: ItemDto) => void;
}

export function ItemForm({ item, groups, brands, units, attributes, settings, seasons = [], readOnly = false, onSaved }: ItemFormProps) {
  const [form, setForm] = useState<ItemFormValues>(() => fromItem(item, settings));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Plan 12: parts of switched-off modules are hidden; their saved values are sent back unchanged.
  const { isOn } = useModules();
  const showVariants = isOn("variants");
  const showSeasons = isOn("seasons");
  const showBatches = isOn("batches");
  const showSerials = isOn("serials");

  type TextKey = "code" | "name" | "description" | "itemGroupId" | "brandId" | "seasonId" | "baseUnitId" | "mrp" | "maxDiscountPercent" | "endDate" | "shelfLifeDays" | "warrantyDays" | "sellingPrice";
  const set = (key: TextKey) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setFlag = (key: "isStockItem" | "canBuy" | "canSell" | "active" | "trackBatches" | "autoNumberBatches" | "trackSerials" | "isStyle" | "applyToVariants") => (e: { target: { checked: boolean } }) =>
    setForm((f) => ({ ...f, [key]: e.target.checked }));

  /**
   * Editing a style with "also change all its sizes and colours" ticked: only
   * the style fields that changed are sent (and so copied to the variants), so
   * saving an unrelated change does not overwrite a variant's own MRP.
   */
  function styleChanges(common: Record<string, unknown>): Record<string, unknown> {
    if (!item?.isParentStyle || !form.applyToVariants) return {};
    const was = fromItem(item, settings);
    const unchanged = STYLE_FIELDS_FOR_VARIANTS.filter((f) => was[f] === form[f]);
    for (const f of unchanged) delete common[f];
    return { applyToVariants: unchanged.length < STYLE_FIELDS_FOR_VARIANTS.length };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const stock = form.isStockItem;
    const common = {
      name: form.name,
      description: blankToNull(form.description),
      itemGroupId: form.itemGroupId,
      brandId: form.brandId || null,
      seasonId: form.seasonId || null,
      baseUnitId: form.baseUnitId,
      hsnCode: blankToNull(form.hsnCode),
      mrp: blankToNull(form.mrp),
      maxDiscountPercent: form.maxDiscountPercent.trim() || "0",
      isStockItem: stock,
      canBuy: form.canBuy,
      canSell: form.canSell,
      endDate: blankToNull(form.endDate),
      trackBatches: stock && form.trackBatches,
      // "Number batches automatically" only means something for an item tracked by batch.
      autoNumberBatches: stock && form.trackBatches && form.autoNumberBatches,
      shelfLifeDays: stock ? intOrNull(form.shelfLifeDays) : null,
      trackSerials: stock && form.trackSerials,
      warrantyDays: intOrNull(form.warrantyDays),
    };
    const parsed = item
      ? updateItemSchema.safeParse({ ...common, active: form.active, ...styleChanges(common) })
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
          <SelectInput
            id="item-group"
            label="Group"
            value={form.itemGroupId}
            onChange={(e) => {
              const itemGroupId = e.target.value;
              // Launch check, 27 October 2026: the group's HSN code was used only on saving, unseen; now it shows at once.
              const groupHsn = groupOptions.find((g) => g.id === itemGroupId)?.node.hsnCode ?? null;
              setForm((f) => ({ ...f, itemGroupId, ...(!f.hsnCode && groupHsn ? { hsnCode: groupHsn } : {}) }));
            }}
            error={errors.itemGroupId}
            required
            hint="Only the last level of the tree can hold items. A new item takes the group's HSN code when it has one."
          >
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
          {showSeasons ? (
            <SelectInput id="item-season" label="Season" value={form.seasonId} onChange={set("seasonId")} error={errors.seasonId} hint="The season or collection, for reports and markdowns.">
              <option value="">No season</option>
              {seasons
                .filter((s) => s.active || s.id === form.seasonId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.active ? "" : " (switched off)"}
                  </option>
                ))}
            </SelectInput>
          ) : null}
          <SelectInput id="item-baseUnit" label="Basic unit" value={form.baseUnitId} onChange={set("baseUnitId")} error={errors.baseUnitId} required disabled={isVariant} hint={item ? "Changing it clears the other units of the item." : "The unit stock is counted in."}>
            <option value="">Choose a unit</option>
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} — {u.name}
              </option>
            ))}
          </SelectInput>
          <div>
            <HsnInput id="item-hsn" value={form.hsnCode} onChange={(hsnCode) => setForm((f) => ({ ...f, hsnCode }))} error={errors.hsnCode} disabled={readOnly} hint="4, 6 or 8 digits. The GST rate for each code is set under Billing counter → GST rates." />
            {form.canSell && !readOnly ? <GstRateWarning hsnCode={form.hsnCode} /> : null}
          </div>
          <TextInput id="item-mrp" label="MRP (per basic unit)" value={form.mrp} onChange={set("mrp")} error={errors.mrp} inputMode="decimal" className="mono" hint="Printed maximum retail price, if any." />
          <TextInput id="item-maxDiscount" label="Maximum discount %" value={form.maxDiscountPercent} onChange={set("maxDiscountPercent")} error={errors.maxDiscountPercent} inputMode="decimal" className="mono" hint="The most a discount typed at the till can be, even with a manager's PIN. 0 = no typed discount on this item. Offers are not limited by it." />
          <TextInput id="item-endDate" label="End date" type="date" value={form.endDate} onChange={set("endDate")} error={errors.endDate} hint="After this date the item cannot be used on any document." />
          <div className="span-2 check-row">
            <CheckInput id="item-isStockItem" label="Stock item" description="Off = service; no stock is kept." checked={form.isStockItem} onChange={setFlag("isStockItem")} disabled={isVariant || form.isStyle} />
            <CheckInput id="item-canBuy" label="Can be bought" checked={form.canBuy} onChange={setFlag("canBuy")} />
            <CheckInput id="item-canSell" label="Can be sold" checked={form.canSell} onChange={setFlag("canSell")} />
            {item?.isParentStyle && showVariants ? (
              <CheckInput
                id="item-applyToVariants"
                label="Also change all its sizes and colours"
                description="Copies a changed MRP, HSN, brand, group, maximum discount, description or season to every variant. Codes, barcodes and prices are never copied."
                checked={form.applyToVariants}
                onChange={setFlag("applyToVariants")}
              />
            ) : null}
            {item ? <CheckInput id="item-active" label="Active" description="Switched-off items cannot be used on new documents; history is kept." checked={form.active} onChange={setFlag("active")} /> : null}
          </div>
        </div>
      </fieldset>

      {!item ? (
        <fieldset disabled={readOnly}>
          <legend>{showVariants ? "Style with variants" : "Selling price"}</legend>
          {showVariants ? (
            <CheckInput id="item-isStyle" label="This is a style with variants" description="A style (shirt) has variants (shirt red M). Prices, barcodes and stock belong to the variants, never to the style." checked={form.isStyle} onChange={setFlag("isStyle")} />
          ) : null}
          {form.isStyle && showVariants ? (
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

      {!form.isStyle && (showBatches || showSerials) ? (
        <fieldset disabled={readOnly || !form.isStockItem}>
          <legend>Tracking</legend>
          {!form.isStockItem ? <p className="muted">Only stock items can be tracked by {showBatches && showSerials ? "batch or serial number" : showBatches ? "batch" : "serial number"}.</p> : null}
          <div className="form-grid">
            <div className="check-row span-2">
              {showBatches ? (
                <>
                  <CheckInput id="item-trackBatches" label="Track batches" description="Each receipt creates a batch with its own expiry." checked={form.trackBatches} onChange={setFlag("trackBatches")} />
                  <CheckInput id="item-autoNumberBatches" label="Number batches automatically" checked={form.autoNumberBatches} onChange={setFlag("autoNumberBatches")} disabled={!form.trackBatches} />
                </>
              ) : null}
              {showSerials ? <CheckInput id="item-trackSerials" label="Track serial numbers" description="Every unit has its own serial number." checked={form.trackSerials} onChange={setFlag("trackSerials")} /> : null}
            </div>
            {showBatches ? <TextInput id="item-shelfLifeDays" label="Shelf life (days)" value={form.shelfLifeDays} onChange={set("shelfLifeDays")} error={errors.shelfLifeDays} inputMode="numeric" hint="Suggests the expiry date on receipts." /> : null}
            {showSerials ? <TextInput id="item-warrantyDays" label="Warranty (days)" value={form.warrantyDays} onChange={set("warrantyDays")} error={errors.warrantyDays} inputMode="numeric" /> : null}
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
