// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { hasPermission, stylePriceSchema } from "shared";
import { VariantPicker } from "@/components/items/variant-picker";
import { ActiveBadge, Alert, Button, DataTable, SelectInput, TextInput, type Column } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { showMoney } from "@/lib/catalogue";
import type { AttributeDto, ItemDto, PriceListDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

/**
 * One selling price for every size and colour of the style (found in the launch check of
 * 27 October 2026: each variant had to be priced on its own). Variants with a price already
 * keep it; a different price for one size is still set on the Prices screen.
 */
function StylePrice({ item, count }: { item: ItemDto; count: number }) {
  const lists = useLoad(() => api.get<PriceListDto[]>("/price-lists"));
  const selling = (lists.data ?? []).filter((l) => l.forSelling && l.active);
  const [listId, setListId] = useState("");
  const [price, setPrice] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = listId || selling[0]?.id || "";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const parsed = stylePriceSchema.safeParse({ styleId: item.id, priceListId: chosen, price: price.trim() });
    setErrors(issuesToFieldErrors(parsed));
    if (!parsed.success) return;
    setBusy(true);
    try {
      const r = await api.post<{ added: string[]; kept: string[] }>("/prices/style", parsed.data);
      setDone(
        r.added.length
          ? `₹${price} set on ${r.added.length} of ${r.added.length + r.kept.length} sizes and colours.${r.kept.length ? ` ${r.kept.length} already had a price and kept it.` : ""}`
          : "Every size and colour already has a price in this list; change one on the Prices screen.",
      );
      setPrice("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!count) return null;
  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <h2 style={{ marginTop: 0 }}>Selling price for every size and colour</h2>
      <p className="muted">Gives the same price to each of the {count} sizes and colours that has none yet, from today.</p>
      <Alert kind="error">{error ?? lists.error}</Alert>
      {done ? <Alert kind="success">{done}</Alert> : null}
      <div className="form-grid">
        {selling.length > 1 ? (
          <SelectInput id="style-price-list" label="Price list" value={chosen} onChange={(e) => setListId(e.target.value)} error={errors.priceListId}>
            {selling.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectInput>
        ) : null}
        <TextInput id="style-price" label="Price (₹)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} error={errors.price} required />
      </div>
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy} disabled={!chosen}>
          Set the price
        </Button>
      </div>
    </form>
  );
}

interface ItemVariantsProps {
  item: ItemDto;
  attributes: AttributeDto[];
  readOnly: boolean;
  onChanged: () => Promise<void> | void;
}

/** Variants tab of a style: create combinations and list the variants that exist. */
export function ItemVariants({ item, attributes, readOnly, onChanged }: ItemVariantsProps) {
  const variants = useLoad(() => api.get<ItemDto[]>(`/items/${item.id}/variants`), [item.id]);
  const { user } = useAuth();

  const columns: Column<ItemDto>[] = [
    {
      key: "code",
      header: "Code",
      render: (v) => (
        <Link href={`/items/${v.id}`} className="mono">
          {v.code}
        </Link>
      ),
    },
    { key: "name", header: "Name", render: (v) => v.name },
    { key: "values", header: "Values", render: (v) => v.variantValues.map((x) => `${x.attribute.name}: ${x.value}`).join(", ") },
    { key: "barcodes", header: "Barcodes", render: (v) => v.barcodes.filter((b) => b.active).length },
    { key: "mrp", header: "MRP", align: "right", render: (v) => showMoney(v.mrp) },
    { key: "active", header: "Status", render: (v) => <ActiveBadge active={v.active} /> },
  ];

  return (
    <>
      <p className="muted">
        This style varies by {item.variantAttributes.map((a) => a.name).join(", ") || "no attributes"}. Variant codes are the style code plus the
        value short codes, for example <span className="mono">{item.code}-RED-M</span>.
      </p>
      {!readOnly ? (
        <VariantPicker
          item={item}
          attributes={attributes}
          onCreated={async () => {
            await variants.reload();
            await onChanged();
          }}
        />
      ) : null}
      <h2>Existing variants</h2>
      <Alert kind="error">{variants.error}</Alert>
      <DataTable columns={columns} rows={variants.data} rowKey={(v) => v.id} loading={variants.loading} empty="No variants yet." />
      {!readOnly && hasPermission(user, "prices.manage") ? <StylePrice item={item} count={(variants.data ?? []).filter((v) => v.active).length} /> : null}
    </>
  );
}
