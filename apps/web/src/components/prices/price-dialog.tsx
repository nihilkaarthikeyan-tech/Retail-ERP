// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { createPriceSchema } from "shared";
import { ItemPicker } from "@/components/prices/item-picker";
import { Alert, Button, Dialog, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { blankToNull, blankToUndefined, todayIso } from "@/lib/format";
import type { ItemDto, PriceDto, PriceListDto } from "@/lib/types";
import { apiFieldErrors, type FieldErrors, issuesToFieldErrors } from "@/lib/validation";

interface PriceDialogProps {
  open: boolean;
  onClose: () => void;
  lists: PriceListDto[];
  /** When given, the price is for this item; otherwise the dialog has an item picker. */
  item?: ItemDto | null;
  /** List to start with. */
  priceListId?: string;
  onSaved: (price: PriceDto) => Promise<void> | void;
}

/** Adds one price: list, item, unit, price, dates and pack size. */
export function PriceDialog({ open, onClose, lists, item: fixedItem, priceListId, onSaved }: PriceDialogProps) {
  const [pickedItem, setPickedItem] = useState<ItemDto | null>(null);
  const [listId, setListId] = useState(priceListId ?? "");
  const [unitId, setUnitId] = useState("");
  const [price, setPrice] = useState("");
  const [startDate, setStartDate] = useState(() => todayIso());
  const [endDate, setEndDate] = useState("");
  const [packSize, setPackSize] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const item = fixedItem ?? pickedItem;
  const activeLists = lists.filter((l) => l.active);

  function close() {
    setPickedItem(null);
    setUnitId("");
    setPrice("");
    setEndDate("");
    setPackSize("");
    setErrors({});
    setError(null);
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!item) {
      setErrors({ itemId: "Pick an item" });
      return;
    }
    const parsed = createPriceSchema.safeParse({
      priceListId: listId || priceListId || "",
      itemId: item.id,
      unitId: unitId || item.baseUnit.id,
      price: price.trim(),
      startDate: blankToUndefined(startDate),
      endDate: blankToNull(endDate),
      packSize: blankToNull(packSize),
    });
    const issues = issuesToFieldErrors(parsed);
    // Object-level refinements (dates, party) arrive with an empty path.
    if (issues[""]) issues.endDate = issues[""];
    setErrors(issues);
    if (!parsed.success) return;
    setBusy(true);
    try {
      const saved = await api.post<PriceDto>("/prices", parsed.data);
      await onSaved(saved);
      close();
    } catch (err) {
      setErrors(apiFieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} title="Add price" onClose={close}>
      <form onSubmit={submit} noValidate>
        <Alert kind="error">{error}</Alert>
        {fixedItem ? (
          <p>
            Item <span className="mono">{fixedItem.code}</span> — {fixedItem.name}
          </p>
        ) : (
          <ItemPicker
            id="price-item"
            value={pickedItem}
            onChange={(i) => {
              setPickedItem(i);
              setUnitId("");
            }}
            error={errors.itemId}
          />
        )}
        <div className="form-grid">
          <SelectInput id="price-list" label="Price list" value={listId || priceListId || ""} onChange={(e) => setListId(e.target.value)} error={errors.priceListId} required>
            <option value="">Choose a list</option>
            {activeLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.forBuying && !l.forSelling ? " (buying)" : ""}
              </option>
            ))}
          </SelectInput>
          <SelectInput id="price-unit" label="Unit" value={unitId} onChange={(e) => setUnitId(e.target.value)} error={errors.unitId} disabled={!item}>
            {item ? (
              item.units.map((u) => (
                <option key={u.unitId} value={u.unitId === item.baseUnit.id ? "" : u.unitId}>
                  {u.code} — {u.name}
                  {u.unitId === item.baseUnit.id ? " (basic)" : ` (× ${u.factor})`}
                </option>
              ))
            ) : (
              <option value="">Pick an item first</option>
            )}
          </SelectInput>
          <TextInput id="price-price" label="Price" value={price} onChange={(e) => setPrice(e.target.value)} error={errors.price} required inputMode="decimal" className="mono" hint="In rupees, for one of the chosen unit." />
          <TextInput id="price-packSize" label="Pack size" value={packSize} onChange={(e) => setPackSize(e.target.value)} error={errors.packSize} inputMode="decimal" className="mono" hint="Optional: this price applies only to multiples of this quantity." />
          <TextInput id="price-startDate" label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} error={errors.startDate} />
          <TextInput id="price-endDate" label="End date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} error={errors.endDate} hint="Leave empty for an open-ended price." />
        </div>
        <div className="actions">
          <Button type="submit" variant="primary" busy={busy}>
            Add price
          </Button>
          <Button onClick={close}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
