// Copyright (c) 2026, Rademics. All rights reserved.
// The editable lines of a purchase order, with a preview of the amounts.
// The preview uses the shared purchase maths; the server recalculates every
// figure on save and its answer is what counts.
"use client";

import { Decimal, documentTotals, lineAmounts, quantityProblem, suggestGst } from "shared";
import { itemUnits, newLineKey } from "@/components/stock/stock-line-grid";
import { Button } from "@/components/ui";
import { type PurchaseOrderLineDto, rupees } from "@/lib/purchasing";
import { showQuantity } from "@/lib/stock";
import type { ItemDto } from "@/lib/types";

/** One order line as typed on screen (all text, sent as decimal strings). */
export interface OrderLineDraft {
  key: string;
  /** The saved line this one is (sent back as lineId when changing an order). */
  lineId: string | null;
  item: ItemDto;
  unitId: string;
  quantity: string;
  freeQuantity: string;
  rate: string;
  discountPercent: string;
  /** Fixed discount kept from the saved line (not edited here). */
  discountAmount: string;
  gstRate: string;
  /** Blank: the order's date. */
  neededBy: string;
  /** The line as the server last returned it. */
  saved: PurchaseOrderLineDto | null;
  /** True once anything on the line was changed after loading. */
  changed: boolean;
}

function parse(text: string): Decimal | null {
  const t = text.trim();
  if (!t) return null;
  try {
    const d = new Decimal(t);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function isZero(text: string | undefined): boolean {
  const d = text ? parse(text) : null;
  return !d || d.isZero();
}

export function emptyOrderLine(item: ItemDto, unitId: string | null): OrderLineDraft {
  const units = itemUnits(item);
  const unit = units.find((u) => u.unitId === unitId) ?? units.find((u) => u.unitId === item.baseUnit.id) ?? units[0];
  return { key: newLineKey(), lineId: null, item, unitId: unit.unitId, quantity: "", freeQuantity: "", rate: "", discountPercent: "", discountAmount: "", gstRate: "", neededBy: "", saved: null, changed: true };
}

/** A saved line back into its on-screen form. A needed-by date equal to the order's is shown blank ("same as the order"). */
export function orderLineFromDto(line: PurchaseOrderLineDto, item: ItemDto, orderNeededBy: string): OrderLineDraft {
  return {
    key: newLineKey(),
    lineId: line.id,
    item,
    unitId: line.unitId,
    quantity: showQuantity(line.quantity),
    freeQuantity: isZero(line.freeQuantity) ? "" : showQuantity(line.freeQuantity),
    rate: line.rate ?? "",
    discountPercent: isZero(line.discountPercent) ? "" : showQuantity(line.discountPercent),
    discountAmount: isZero(line.discountAmount) ? "" : (line.discountAmount ?? ""),
    gstRate: line.gstRate !== undefined ? showQuantity(line.gstRate) : "",
    neededBy: line.neededBy && line.neededBy !== orderNeededBy ? line.neededBy : "",
    saved: line,
    changed: false,
  };
}

/** Goods or bills already refer to the line: it cannot be removed and its item and unit stay. */
export function lineInUse(line: OrderLineDraft): boolean {
  if (!line.saved) return false;
  return !isZero(line.saved.receivedQuantity) || !isZero(line.saved.billedAmount);
}

/** What is wrong with a line before anything is sent, or null. The API checks all of this again. */
export function orderLineProblem(line: OrderLineDraft, withPrices: boolean): string | null {
  const code = line.item.code;
  const unit = itemUnits(line.item).find((u) => u.unitId === line.unitId);
  if (!unit) return `${code}: choose a unit`;
  const typed = line.quantity.trim();
  if (!typed) return `${code}: enter a quantity`;
  const problem = quantityProblem(typed, unit);
  if (problem) return `${code}: ${problem}`;
  const quantity = parse(typed);
  if (!quantity || quantity.lte(0)) return `${code}: the quantity must be more than zero`;
  if (line.freeQuantity.trim()) {
    const free = parse(line.freeQuantity);
    if (!free || free.isNegative()) return `${code}: the free quantity must be zero or more`;
    const freeProblem = quantityProblem(line.freeQuantity.trim(), unit);
    if (freeProblem) return `${code}: free quantity: ${freeProblem}`;
  }
  if (withPrices) {
    if (line.rate.trim()) {
      const rate = parse(line.rate);
      if (!rate || rate.isNegative()) return `${code}: the rate must be zero or more`;
    }
    for (const [label, text] of [
      ["discount", line.discountPercent],
      ["GST rate", line.gstRate],
    ] as const) {
      if (!text.trim()) continue;
      const p = parse(text);
      if (!p || p.isNegative() || p.gt(100)) return `${code}: the ${label} must be between 0 and 100 percent`;
    }
  }
  return null;
}

/** The line as the API expects it. Without buying-price rights no price is sent, so the server fills it. */
export function orderLineToInput(line: OrderLineDraft, withPrices: boolean) {
  const text = (v: string) => (v.trim() ? v.trim() : undefined);
  return {
    ...(line.lineId ? { lineId: line.lineId } : {}),
    itemId: line.item.id,
    unitId: line.unitId,
    quantity: line.quantity.trim(),
    ...(text(line.freeQuantity) ? { freeQuantity: line.freeQuantity.trim() } : {}),
    ...(withPrices
      ? {
          ...(text(line.rate) ? { rate: line.rate.trim() } : {}),
          ...(text(line.discountPercent) ? { discountPercent: line.discountPercent.trim() } : {}),
          ...(text(line.discountAmount) ? { discountAmount: line.discountAmount.trim() } : {}),
          ...(text(line.gstRate) ? { gstRate: line.gstRate.trim() } : {}),
        }
      : {}),
    ...(text(line.neededBy) ? { neededBy: line.neededBy } : {}),
  };
}

export interface LinePreview {
  taxable: Decimal;
  gst: Decimal;
  total: Decimal;
}

/** Estimated taxable value, GST and total of a line, or null when the rate is not typed or a figure is not valid. */
export function previewOrderLine(line: OrderLineDraft): LinePreview | null {
  const quantity = parse(line.quantity);
  const rate = parse(line.rate);
  if (!quantity || !rate || quantity.lte(0) || rate.isNegative()) return null;
  try {
    const { taxable } = lineAmounts({ quantity, rate, discountPercent: line.discountPercent.trim() || null, discountAmount: line.discountAmount.trim() || null });
    const gstRate = line.gstRate.trim() ? parse(line.gstRate) : new Decimal(0);
    if (!gstRate) return null;
    // Within or between states only changes the split, not the amount.
    const split = suggestGst(taxable, gstRate, false);
    const gst = split.cgst.add(split.sgst).add(split.igst);
    return { taxable, gst, total: taxable.add(gst) };
  } catch {
    return null;
  }
}

/** Estimated order totals, and how many lines could not be estimated (no rate typed). */
export function previewOrderTotals(lines: OrderLineDraft[]): { taxable: Decimal; tax: Decimal; total: Decimal; roundingAdjustment: Decimal; missing: number } {
  const previews = lines.map(previewOrderLine);
  const known = previews.filter((p): p is LinePreview => p !== null);
  const t = documentTotals(known.map((p) => ({ taxable: p.taxable, cgst: p.gst, sgst: 0, igst: 0 })));
  return { taxable: t.taxable, tax: t.tax, total: t.total, roundingAdjustment: t.roundingAdjustment, missing: previews.length - known.length };
}

interface OrderLineGridProps {
  lines: OrderLineDraft[];
  onChange: (lines: OrderLineDraft[]) => void;
  /** Problems by line key, shown under the line. */
  problems: Record<string, string>;
  /** buying_prices.view (decision 70): rate, discount, GST and amounts. */
  withPrices: boolean;
  /** Received and still-to-come columns (finalised orders). */
  withProgress: boolean;
  readOnly?: boolean;
}

export function OrderLineGrid({ lines, onChange, problems, withPrices, withProgress, readOnly }: OrderLineGridProps) {
  function update(key: string, patch: Partial<OrderLineDraft>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch, changed: true } : l)));
  }

  if (lines.length === 0) return <p className="muted">No lines yet. Scan or search above to add items.</p>;

  return (
    <div className="table-wrap line-grid">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Item</th>
            <th scope="col">Unit</th>
            <th scope="col" className="num">
              Quantity
            </th>
            <th scope="col" className="num">
              Free
            </th>
            {withPrices ? (
              <>
                <th scope="col" className="num">
                  Rate (₹)
                </th>
                <th scope="col" className="num">
                  Discount %
                </th>
                <th scope="col" className="num">
                  GST %
                </th>
              </>
            ) : null}
            <th scope="col">Needed by</th>
            {withPrices ? (
              <th scope="col" className="num">
                Line total
              </th>
            ) : null}
            {withProgress ? (
              <>
                <th scope="col" className="num">
                  Received
                </th>
                <th scope="col" className="num">
                  Still to come
                </th>
              </>
            ) : null}
            {readOnly ? null : <th scope="col" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const n = i + 1;
            const units = itemUnits(l.item);
            const unit = units.find((u) => u.unitId === l.unitId);
            const problem = problems[l.key];
            const used = lineInUse(l);
            const preview = withPrices && (l.changed || !l.saved?.lineTotal) ? previewOrderLine(l) : null;
            const numeric = (label: string, field: "quantity" | "freeQuantity" | "rate" | "discountPercent" | "gstRate", decimal: boolean) => (
              <input
                className="input"
                inputMode={decimal ? "decimal" : "numeric"}
                aria-label={`${label} for line ${n}`}
                aria-invalid={problem ? true : undefined}
                value={l[field]}
                disabled={readOnly}
                onChange={(e) => update(l.key, { [field]: e.target.value })}
              />
            );
            return (
              <tr key={l.key} className={problem ? "row-alert" : undefined}>
                <td>{n}</td>
                <td>
                  <span className="mono">{l.item.code}</span> {l.item.name}
                  {!l.item.isStockItem ? <span className="muted"> · not a stock item</span> : null}
                  {problem ? (
                    <p className="field-error" role="alert">
                      {problem}
                    </p>
                  ) : null}
                </td>
                <td>
                  <select className="input" aria-label={`Unit for line ${n}`} value={l.unitId} disabled={readOnly || used} onChange={(e) => update(l.key, { unitId: e.target.value })}>
                    {units.map((u) => (
                      <option key={u.unitId} value={u.unitId}>
                        {u.code}
                        {showQuantity(u.factor) !== "1" ? ` (${showQuantity(u.factor)} ${l.item.baseUnit.code})` : ""}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num">{numeric("Quantity", "quantity", !!unit?.allowsFractions)}</td>
                <td className="num">{numeric("Free quantity", "freeQuantity", !!unit?.allowsFractions)}</td>
                {withPrices ? (
                  <>
                    <td className="num">{numeric(`Rate per ${unit?.code ?? "unit"}`, "rate", true)}</td>
                    <td className="num">{numeric("Discount percent", "discountPercent", true)}</td>
                    <td className="num">{numeric("GST percent", "gstRate", true)}</td>
                  </>
                ) : null}
                <td>
                  <input className="input" type="date" aria-label={`Needed by for line ${n}`} value={l.neededBy} disabled={readOnly} onChange={(e) => update(l.key, { neededBy: e.target.value })} />
                </td>
                {withPrices ? (
                  <td className="num">
                    {!l.changed && l.saved?.lineTotal ? (
                      rupees(l.saved.lineTotal)
                    ) : preview ? (
                      <span className="muted" title="Estimate; the server works out the final figure when you save">
                        {rupees(preview.total.toFixed(2))} (estimate)
                      </span>
                    ) : (
                      <span className="muted">{l.rate.trim() ? "—" : "From price list"}</span>
                    )}
                  </td>
                ) : null}
                {withProgress ? (
                  <>
                    <td className="num">{l.saved ? `${showQuantity(l.saved.receivedQuantity)} ${l.item.baseUnit.code}` : "—"}</td>
                    <td className="num">{l.saved ? `${showQuantity(l.saved.pendingQuantity)} ${l.item.baseUnit.code}` : "—"}</td>
                  </>
                ) : null}
                {readOnly ? null : (
                  <td>
                    {used ? (
                      <span className="muted" title="Goods or bills already refer to this line">
                        In use
                      </span>
                    ) : (
                      <Button size="small" variant="link" onClick={() => onChange(lines.filter((x) => x.key !== l.key))} aria-label={`Remove line ${n}`}>
                        Remove
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
