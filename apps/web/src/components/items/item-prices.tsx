// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState, type FormEvent } from "react";
import { PriceDialog } from "@/components/prices/price-dialog";
import { PriceTable } from "@/components/prices/price-table";
import { Alert, Button, CheckInput, SelectInput, TextInput } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import { todayIso } from "@/lib/format";
import type { ItemDto, PriceDto, PriceListDto, PriceLookupResult } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { unitRupees } from "@/lib/purchasing";

interface ItemPricesProps {
  item: ItemDto;
  canManage: boolean;
}

/** Prices tab: the item's prices across the lists the user may see, plus a price check box. */
export function ItemPrices({ item, canManage }: ItemPricesProps) {
  const lists = useLoad(() => api.get<PriceListDto[]>("/price-lists"));
  const [includeEnded, setIncludeEnded] = useState(false);
  const prices = useLoad(() => api.get<PriceDto[]>(`/prices${query({ itemId: item.id, includeEnded: includeEnded ? "true" : undefined })}`), [item.id, includeEnded]);
  const [adding, setAdding] = useState(false);

  // Price check
  const [checkUnitId, setCheckUnitId] = useState(item.baseUnit.id);
  const [checkListId, setCheckListId] = useState("");
  const [checkDate, setCheckDate] = useState(() => todayIso());
  const [checkQty, setCheckQty] = useState("1");
  const [checkResult, setCheckResult] = useState<PriceLookupResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function runCheck(e: FormEvent) {
    e.preventDefault();
    setCheckError(null);
    setCheckResult(null);
    setChecking(true);
    try {
      const result = await api.get<PriceLookupResult>(
        `/prices/lookup${query({ itemId: item.id, unitId: checkUnitId, priceListId: checkListId || undefined, date: checkDate || undefined, quantity: checkQty.trim() || undefined })}`,
      );
      setCheckResult(result);
    } catch (err) {
      setCheckError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  const listName = (id: string | null) => lists.data?.find((l) => l.id === id)?.name ?? "—";
  const unitCode = (id: string | null) => item.units.find((u) => u.unitId === id)?.code ?? "—";

  return (
    <>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Prices</h2>
        <CheckInput id="prices-includeEnded" label="Include ended prices" checked={includeEnded} onChange={(e) => setIncludeEnded(e.target.checked)} />
        <span className="spacer" />
        {canManage ? (
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add price
          </Button>
        ) : null}
      </div>
      {item.lastPurchasePrice !== undefined ? (
        <p className="muted">
          Last purchase price: <span className="mono">{item.lastPurchasePrice ?? "none yet"}</span>
        </p>
      ) : null}
      <Alert kind="error">{prices.error ?? lists.error}</Alert>
      <PriceTable rows={prices.data} loading={prices.loading} showList canManage={canManage} onChanged={() => prices.reload()} />

      <form onSubmit={runCheck} noValidate className="card">
        <h3 style={{ marginTop: 0 }}>Price check</h3>
        <p className="muted">What a bill line would be charged, found the same way the till will find it.</p>
        <div className="filter-row">
          <SelectInput id="check-unit" label="Unit" value={checkUnitId} onChange={(e) => setCheckUnitId(e.target.value)}>
            {item.units.map((u) => (
              <option key={u.unitId} value={u.unitId}>
                {u.code}
              </option>
            ))}
          </SelectInput>
          <SelectInput id="check-list" label="Price list" value={checkListId} onChange={(e) => setCheckListId(e.target.value)}>
            <option value="">Default selling list</option>
            {(lists.data ?? [])
              .filter((l) => l.active)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </SelectInput>
          <TextInput id="check-date" label="Date" type="date" value={checkDate} onChange={(e) => setCheckDate(e.target.value)} />
          <TextInput id="check-qty" label="Quantity" value={checkQty} onChange={(e) => setCheckQty(e.target.value)} inputMode="decimal" className="mono" />
        </div>
        <div className="actions" style={{ marginTop: 8 }}>
          <Button type="submit" busy={checking}>
            Check price
          </Button>
        </div>
        <Alert kind="error">{checkError}</Alert>
        {checkResult ? (
          checkResult.found ? (
            <Alert kind="success">
              Rate <span className="mono">{unitRupees(checkResult.rate)}</span> per {unitCode(checkUnitId)} — from {listName(checkResult.priceListId)}
              {checkResult.source === "default_list" ? " (no price on that list, so the shop's usual selling list)" : ""}, stored as <span className="mono">{unitRupees(checkResult.price)}</span> per{" "}
              {unitCode(checkResult.priceUnitId)}.
            </Alert>
          ) : (
            <Alert kind="info">No price found for these details.</Alert>
          )
        ) : null}
      </form>

      <PriceDialog open={adding} onClose={() => setAdding(false)} lists={lists.data ?? []} item={item} onSaved={() => prices.reload()} />
    </>
  );
}
