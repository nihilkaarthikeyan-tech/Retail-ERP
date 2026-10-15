// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import Link from "next/link";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { rupees } from "@/lib/purchasing";
import { showQuantity } from "@/lib/stock";
import type { ItemDto, StockLocationDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { type BillLineDraft, type NewBillKind, previewLine } from "./bills-lines";

/** Unit codes by unit id for items whose units are not on screen yet (one item fetch each). */
export function useUnitCodes(itemIds: string[]): Record<string, string> {
  const ids = [...new Set(itemIds)].sort();
  const loaded = useLoad<Record<string, string>>(async () => {
    const out: Record<string, string> = {};
    const items = await Promise.all(ids.map((id) => api.get<ItemDto>(`/items/${id}`).catch(() => null)));
    for (const item of items) {
      if (!item) continue;
      out[item.baseUnit.id] = item.baseUnit.code;
      for (const u of item.units) out[u.unitId] = u.code;
    }
    return out;
  }, [ids.join(",")]);
  return loaded.data ?? {};
}

interface BillLineGridProps {
  kind: NewBillKind;
  lines: BillLineDraft[];
  onChange: (lines: BillLineDraft[]) => void;
  problems: Record<string, string>;
  /** Receiving bills: the shelves of the chosen store. */
  shelves: StockLocationDto[];
  /** Whether the user may see and type buying prices. */
  prices: boolean;
}

/** The editable lines of a supplier bill, with a live preview of each line's amounts. */
export function BillLineGrid({ kind, lines, onChange, problems, shelves, prices }: BillLineGridProps) {
  const unitCodes = useUnitCodes(lines.filter((l) => !l.units).map((l) => l.itemId));
  const receiving = kind === "receives_goods";
  const againstReceipt = kind === "against_receipt";
  const anyBatches = receiving && lines.some((l) => l.trackBatches);
  const anySerials = receiving && lines.some((l) => l.trackSerials);

  function update(key: string, patch: Partial<BillLineDraft>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  if (lines.length === 0) {
    return <p className="muted">{againstReceipt ? "No lines yet. Add a goods receipt above." : "No lines yet. Search above to add items."}</p>;
  }

  return (
    <div className="table-wrap line-grid">
      <table className="table">
        <thead>
          <tr>
            {againstReceipt ? <th scope="col">Bill it</th> : <th scope="col">#</th>}
            <th scope="col">Item</th>
            <th scope="col">Unit</th>
            <th scope="col" className="num">
              Quantity billed
            </th>
            {kind !== "services" ? (
              <th scope="col" className="num">
                Free
              </th>
            ) : null}
            {prices ? (
              <>
                <th scope="col" className="num">
                  Price per unit
                </th>
                <th scope="col" className="num">
                  Discount %
                </th>
                <th scope="col" className="num">
                  GST %
                </th>
                <th scope="col" className="num">
                  CGST
                </th>
                <th scope="col" className="num">
                  SGST
                </th>
                <th scope="col" className="num">
                  IGST
                </th>
                <th scope="col" className="num">
                  Line total (preview)
                </th>
              </>
            ) : null}
            {receiving ? <th scope="col">Shelf</th> : null}
            {anyBatches ? <th scope="col">Batch</th> : null}
            {anySerials ? <th scope="col">Serial numbers</th> : null}
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const n = i + 1;
            const problem = problems[l.key];
            const preview = prices ? previewLine(l) : null;
            const off = !l.include;
            return (
              <tr key={l.key} className={problem ? "row-alert" : off ? "row-muted" : undefined}>
                <td>
                  {againstReceipt ? (
                    <input type="checkbox" aria-label={`Bill line ${n}`} checked={l.include} onChange={(e) => update(l.key, { include: e.target.checked })} />
                  ) : (
                    n
                  )}
                </td>
                <td>
                  <span className="mono">{l.itemCode}</span> {l.itemName}
                  {l.receipt ? (
                    <div className="muted">
                      Receipt <Link href={`/purchases/receipts/${l.receipt.id}`}>{l.receipt.number}</Link>
                    </div>
                  ) : null}
                  {problem ? (
                    <p className="field-error" role="alert">
                      {problem}
                    </p>
                  ) : null}
                </td>
                <td>
                  {l.units ? (
                    <select
                      className="input"
                      aria-label={`Unit for line ${n}`}
                      value={l.unitId}
                      onChange={(e) => {
                        const u = l.units!.find((x) => x.unitId === e.target.value);
                        update(l.key, { unitId: e.target.value, factor: u?.factor ?? "1" });
                      }}
                    >
                      {l.units.map((u) => (
                        <option key={u.unitId} value={u.unitId}>
                          {u.code}
                        </option>
                      ))}
                    </select>
                  ) : (
                    (unitCodes[l.unitId] ?? "—")
                  )}
                </td>
                <td className="num">
                  <input className="input" inputMode="decimal" aria-label={`Quantity for line ${n}`} value={l.quantity} disabled={off} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                  {l.billable !== null ? <div className="muted">of {showQuantity(l.billable)} left</div> : null}
                </td>
                {kind !== "services" ? (
                  <td className="num">
                    <input className="input" inputMode="decimal" aria-label={`Free quantity for line ${n}`} value={l.freeQuantity} disabled={off} onChange={(e) => update(l.key, { freeQuantity: e.target.value })} />
                  </td>
                ) : null}
                {prices ? (
                  <>
                    <td className="num">
                      <input className="input" inputMode="decimal" aria-label={`Price for line ${n}`} placeholder={kind === "against_receipt" ? "As received" : "From price list"} value={l.rate} disabled={off} onChange={(e) => update(l.key, { rate: e.target.value })} />
                    </td>
                    <td className="num">
                      <input className="input" inputMode="decimal" aria-label={`Discount percent for line ${n}`} value={l.discountPercent} disabled={off} onChange={(e) => update(l.key, { discountPercent: e.target.value })} />
                    </td>
                    <td className="num">
                      <input className="input" inputMode="decimal" aria-label={`GST rate for line ${n}`} value={l.gstRate} disabled={off} onChange={(e) => update(l.key, { gstRate: e.target.value })} />
                    </td>
                    <td className="num">
                      <input className="input" inputMode="decimal" aria-label={`CGST for line ${n}`} placeholder={preview?.suggested ? preview.cgst.toFixed(2) : ""} value={l.cgst} disabled={off} onChange={(e) => update(l.key, { cgst: e.target.value })} />
                    </td>
                    <td className="num">
                      <input className="input" inputMode="decimal" aria-label={`SGST for line ${n}`} placeholder={preview?.suggested ? preview.sgst.toFixed(2) : ""} value={l.sgst} disabled={off} onChange={(e) => update(l.key, { sgst: e.target.value })} />
                    </td>
                    <td className="num">
                      <input className="input" inputMode="decimal" aria-label={`IGST for line ${n}`} value={l.igst} disabled={off} onChange={(e) => update(l.key, { igst: e.target.value })} />
                    </td>
                    <td className="num">
                      {preview ? (
                        <>
                          {rupees(preview.total.toFixed(2))}
                          <div className="muted">
                            {rupees(preview.taxable.toFixed(2))} + GST {rupees(preview.gst.toFixed(2))}
                          </div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </>
                ) : null}
                {receiving ? (
                  <td>
                    <select className="input" aria-label={`Shelf for line ${n}`} value={l.shelfLocationId} onChange={(e) => update(l.key, { shelfLocationId: e.target.value })}>
                      <option value="">Usual place</option>
                      {shelves.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                ) : null}
                {anyBatches ? (
                  <td>
                    {l.trackBatches ? (
                      <div className="form-grid">
                        <input className="input" aria-label={`Batch number for line ${n}`} placeholder={l.autoNumberBatches ? "Batch (blank = automatic)" : "Batch number"} value={l.batchNumber} onChange={(e) => update(l.key, { batchNumber: e.target.value })} />
                        <label className="muted">
                          Made on
                          <input className="input" type="date" aria-label={`Manufacture date for line ${n}`} value={l.manufactureDate} onChange={(e) => update(l.key, { manufactureDate: e.target.value })} />
                        </label>
                        <label className="muted">
                          Expires on
                          <input className="input" type="date" aria-label={`Expiry date for line ${n}`} value={l.expiryDate} onChange={(e) => update(l.key, { expiryDate: e.target.value })} />
                        </label>
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                ) : null}
                {anySerials ? (
                  <td>
                    {l.trackSerials ? (
                      <textarea className="input" aria-label={`Serial numbers for line ${n}`} placeholder="One per line" value={l.serials} onChange={(e) => update(l.key, { serials: e.target.value })} />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                ) : null}
                <td>
                  <Button size="small" variant="link" onClick={() => onChange(lines.filter((x) => x.key !== l.key))} aria-label={`Remove line ${n}`}>
                    Remove
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
