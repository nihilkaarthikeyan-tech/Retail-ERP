// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { hasPermission } from "shared";
import { ExportButton } from "@/components/documents/export-button";
import { PriceDialog } from "@/components/prices/price-dialog";
import { PriceTable } from "@/components/prices/price-table";
import { Alert, Button, CheckInput, SelectInput, TextInput } from "@/components/ui";
import { api, query } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { PriceDto, PriceListDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

export function PricesView() {
  const params = useSearchParams();
  const { user } = useAuth();
  const canManage = hasPermission(user, "prices.manage");
  const lists = useLoad(() => api.get<PriceListDto[]>("/price-lists"));
  const [chosenListId, setChosenListId] = useState(params.get("list") ?? "");
  const [date, setDate] = useState("");
  const [includeEnded, setIncludeEnded] = useState(false);
  const [adding, setAdding] = useState(false);

  // Until the user picks one: the first selling list, else the first list visible.
  const listId = chosenListId || lists.data?.find((l) => l.forSelling && l.active)?.id || lists.data?.[0]?.id || "";
  const prices = useLoad<PriceDto[] | null>(
    () => (listId ? api.get<PriceDto[]>(`/prices${query({ priceListId: listId, date: date || undefined, includeEnded: includeEnded ? "true" : undefined })}`) : Promise.resolve(null)),
    [listId, date, includeEnded],
  );
  const list = lists.data?.find((l) => l.id === listId) ?? null;

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Prices</h1>
        <span className="spacer" />
        <ExportButton kind="prices" />
        {canManage && list ? (
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add price
          </Button>
        ) : null}
      </div>
      <div className="filter-row">
        <SelectInput id="prices-list" label="Price list" value={listId} onChange={(e) => setChosenListId(e.target.value)}>
          {(lists.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.active ? "" : " (switched off)"}
            </option>
          ))}
        </SelectInput>
        <TextInput id="prices-date" label="Valid on" type="date" value={date} onChange={(e) => setDate(e.target.value)} hint="Empty = today." />
        <CheckInput id="prices-includeEnded" label="Include ended prices" checked={includeEnded} onChange={(e) => setIncludeEnded(e.target.checked)} />
      </div>
      {list ? (
        <p className="muted">
          {list.pricesPerUnit ? "Each unit has its own price as stored." : "Prices are per basic unit; a pack's price is worked out from its factor unless it has its own price."}
        </p>
      ) : null}
      <Alert kind="error">{lists.error ?? prices.error}</Alert>
      {lists.data && lists.data.length === 0 ? <p className="muted">No price lists are visible to you.</p> : null}
      <PriceTable rows={prices.data} loading={prices.loading} showItem canManage={canManage} onChanged={() => prices.reload()} />
      {list ? <PriceDialog key={list.id} open={adding} onClose={() => setAdding(false)} lists={lists.data ?? []} priceListId={list.id} onSaved={() => prices.reload()} /> : null}
    </>
  );
}
