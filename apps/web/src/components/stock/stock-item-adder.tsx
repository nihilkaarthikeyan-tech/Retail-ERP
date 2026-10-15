// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { useState } from "react";
import { ItemSearchBox } from "@/components/items/item-search-box";
import { Button } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import type { ItemDto, ItemPage, ScanResult } from "@/lib/types";

interface StockItemAdderProps {
  /** Called with the full item (units included) and the unit the scan matched, if any. */
  onAdd: (item: ItemDto, unitId: string | null) => void;
  disabled?: boolean;
}

/** Only stock items that can actually move: not services, not styles, not switched off. */
function stockable(item: ItemDto): string | null {
  if (item.isParentStyle) return `${item.code} is a style; choose one of its variants`;
  if (!item.isStockItem) return `${item.code} is not a stock item`;
  if (!item.active) return `${item.code} is switched off`;
  return null;
}

/**
 * Scan box for stock documents: Enter on a barcode or item code adds the item
 * straight away; other text lists matching items to pick from.
 */
export function StockItemAdder({ onAdd, disabled }: StockItemAdderProps) {
  const [matches, setMatches] = useState<ItemDto[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Changing the key empties the scan box after each item is added, ready for the next scan.
  const [boxKey, setBoxKey] = useState(0);

  async function add(itemId: string, unitId: string | null) {
    setBusy(true);
    setNote(null);
    try {
      const item = await api.get<ItemDto>(`/items/${itemId}`);
      const problem = stockable(item);
      if (problem) {
        setNote(problem);
        return;
      }
      onAdd(item, unitId);
      setMatches([]);
      setBoxKey((k) => k + 1);
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function search(text: string) {
    setNote(null);
    setMatches([]);
    if (!text) return;
    try {
      const page = await api.get<ItemPage>(`/items${query({ search: text, active: "true", kind: "stock", pageSize: 20 })}`);
      const rows = page.rows.filter((r) => !r.isParentStyle && r.isStockItem);
      setMatches(rows);
      if (rows.length === 0) setNote(`No stock items match "${text}".`);
    } catch (err) {
      setNote(errorMessage(err));
    }
  }

  function scanned(result: ScanResult) {
    if (!result.usable) {
      setNote(result.reason ?? `${result.item.code} cannot be used`);
      return;
    }
    void add(result.item.id, result.unit.id);
  }

  if (disabled) return null;

  return (
    <div className="card">
      <ItemSearchBox key={boxKey} label="Add an item" placeholder="Scan a barcode, or type a code or name" onScanned={scanned} onSearch={search} />
      {busy ? <p className="muted">Adding…</p> : null}
      {note ? (
        <p className="field-error" role="alert">
          {note}
        </p>
      ) : null}
      {matches.length > 0 ? (
        <ul className="picker-results picker-results-static">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" className="picker-result" onClick={() => add(m.id, null)}>
                <span className="mono">{m.code}</span> {m.name}
                <span className="muted"> · {m.baseUnit.code}</span>
              </button>
            </li>
          ))}
          <li>
            <Button size="small" variant="link" onClick={() => setMatches([])}>
              Close the list
            </Button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
