// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { Decimal, quantityProblem } from "shared";
import { itemUnits } from "@/components/stock/stock-line-grid";
import { Button } from "@/components/ui";
import type { GoodsReceiptLineDto, PurchaseOrderLineDto } from "@/lib/purchasing";
import { showQuantity, splitLines } from "@/lib/stock";
import type { ItemDto, StockLocationDto } from "@/lib/types";

/** One goods receipt line as typed on screen (all text, sent as decimal strings). */
export interface ReceiptLineDraft {
  key: string;
  item: ItemDto;
  unitId: string;
  /** The order line this receives against, or null for goods without an order. */
  orderLineId: string | null;
  orderNumber: string | null;
  /** Still expected on the order line, in the line's unit (display only). */
  expected: string | null;
  received: string;
  rejected: string;
  free: string;
  /** Existing batch kept from a saved draft. */
  batchId: string;
  batchNumber: string;
  manufactureDate: string;
  expiryDate: string;
  /** Serial numbers of the accepted goods, one per line. */
  serials: string;
  /** Serial numbers of the rejected goods, one per line. */
  rejectedSerials: string;
  shelfLocationId: string;
  /** Only for users who see buying prices; blank = from the order / price list. */
  rate: string;
  gstRate: string;
}

let keySeq = 0;
function newKey(): string {
  keySeq += 1;
  return `grn-line-${keySeq}`;
}

function parse(text: string): Decimal | null {
  try {
    const d = new Decimal(text.trim());
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

function blankLine(item: ItemDto, unitId: string): ReceiptLineDraft {
  return {
    key: newKey(),
    item,
    unitId,
    orderLineId: null,
    orderNumber: null,
    expected: null,
    received: "",
    rejected: "",
    free: "",
    batchId: "",
    batchNumber: "",
    manufactureDate: "",
    expiryDate: "",
    serials: "",
    rejectedSerials: "",
    shelfLocationId: "",
    rate: "",
    gstRate: "",
  };
}

/** A line for goods that arrived without an order. */
export function lineWithoutOrder(item: ItemDto, unitId: string | null): ReceiptLineDraft {
  const units = itemUnits(item);
  const unit = units.find((u) => u.unitId === unitId) ?? units.find((u) => u.unitId === item.baseUnit.id) ?? units[0];
  return blankLine(item, unit.unitId);
}

/** A line prefilled from an open order line: everything still expected is taken as received. */
export function lineFromOrder(ol: PurchaseOrderLineDto, orderNumber: string, item: ItemDto): ReceiptLineDraft {
  let expected = "0";
  try {
    const factor = new Decimal(ol.factor);
    expected = new Decimal(ol.pendingQuantity).div(factor.isZero() ? 1 : factor).toDecimalPlaces(3).toString();
  } catch {
    expected = ol.pendingQuantity;
  }
  return { ...blankLine(item, ol.unitId), orderLineId: ol.id, orderNumber, expected, received: expected };
}

/** A saved draft line back into its on-screen form. */
export function lineFromReceiptDto(l: GoodsReceiptLineDto, item: ItemDto): ReceiptLineDraft {
  return {
    ...blankLine(item, l.unitId),
    orderLineId: l.orderLineId,
    orderNumber: l.order?.number ?? null,
    received: showQuantity(l.receivedQuantity),
    rejected: new Decimal(l.rejectedQuantity).isZero() ? "" : showQuantity(l.rejectedQuantity),
    free: new Decimal(l.freeQuantity).isZero() ? "" : showQuantity(l.freeQuantity),
    batchId: l.newBatchNumber ? "" : (l.batchId ?? ""),
    batchNumber: l.newBatchNumber ?? "",
    expiryDate: l.newExpiryOn ?? "",
    serials: l.serialNumbers.join("\n"),
    rejectedSerials: l.rejectedSerialNumbers.join("\n"),
    shelfLocationId: l.shelfLocationId,
    rate: l.rate ?? "",
    gstRate: l.gstRate ?? "",
  };
}

/**
 * What is wrong with a line before anything is sent, or null. The API checks
 * everything again (and the order allowance); this only saves a round trip.
 */
export function receiptLineProblem(line: ReceiptLineDraft): string | null {
  const code = line.item.code;
  const unit = itemUnits(line.item).find((u) => u.unitId === line.unitId);
  if (!unit) return `${code}: choose a unit`;
  const typed = line.received.trim();
  if (!typed) return `${code}: enter the quantity received`;
  const received = parse(typed);
  if (!received) return `${code}: the quantity received must be a number`;
  const qp = quantityProblem(typed, unit);
  if (qp) return `${code}: ${qp}`;
  if (received.lte(0)) return `${code}: the quantity received must be more than zero`;

  const rejected = line.rejected.trim() ? parse(line.rejected) : new Decimal(0);
  if (!rejected || rejected.isNegative()) return `${code}: rejected must be zero or more`;
  if (line.rejected.trim()) {
    const rp = quantityProblem(line.rejected.trim(), unit);
    if (rp) return `${code}: ${rp}`;
  }
  if (rejected.gt(received)) return `${code}: rejected (${rejected.toString()}) cannot be more than received (${received.toString()})`;
  const free = line.free.trim() ? parse(line.free) : new Decimal(0);
  if (!free || free.isNegative()) return `${code}: free must be zero or more`;
  if (free.gt(received)) return `${code}: free (${free.toString()}) cannot be more than received (${received.toString()})`;

  if (line.item.trackBatches && !line.batchId) {
    if (!line.batchNumber.trim() && !line.item.autoNumberBatches) return `${code}: give the batch number`;
    if (line.item.shelfLifeDays && !line.expiryDate && !line.manufactureDate) return `${code}: give the expiry date or the manufacture date`;
  }

  if (line.item.trackSerials) {
    const factor = parse(unit.factor) ?? new Decimal(1);
    const accepted = received.sub(rejected).mul(factor);
    const rejectedBasic = rejected.mul(factor);
    const serials = splitLines(line.serials);
    const rejectedSerials = splitLines(line.rejectedSerials);
    if (!accepted.isInteger() || !accepted.eq(serials.length)) return `${code}: list exactly ${accepted.toString()} serial numbers for the accepted goods, one per line`;
    if (!rejectedBasic.eq(rejectedSerials.length)) return `${code}: list exactly ${rejectedBasic.toString()} serial numbers for the rejected goods`;
    const all = [...serials, ...rejectedSerials];
    if (new Set(all).size !== all.length) return `${code}: a serial number is listed twice`;
  }

  if (line.rate.trim()) {
    const r = parse(line.rate);
    if (!r || r.isNegative()) return `${code}: the rate must be zero or more`;
  }
  if (line.gstRate.trim()) {
    const g = parse(line.gstRate);
    if (!g || g.isNegative() || g.gt(100)) return `${code}: the GST rate must be between 0 and 100`;
  }
  return null;
}

/** The line as the API expects it. Rate and GST are sent only by users who see prices. */
export function receiptLineToInput(line: ReceiptLineDraft, seesPrices: boolean) {
  const rejected = line.rejected.trim();
  const free = line.free.trim();
  return {
    ...(line.orderLineId ? { orderLineId: line.orderLineId } : {}),
    itemId: line.item.id,
    unitId: line.unitId,
    receivedQuantity: line.received.trim(),
    freeQuantity: free || null,
    rejectedQuantity: rejected || null,
    ...(line.shelfLocationId ? { shelfLocationId: line.shelfLocationId } : {}),
    ...(line.item.trackBatches && line.batchId ? { batchId: line.batchId } : {}),
    ...(line.item.trackBatches && !line.batchId
      ? { batchNumber: line.batchNumber.trim() || null, manufactureDate: line.manufactureDate || null, expiryDate: line.expiryDate || null }
      : {}),
    ...(line.item.trackSerials ? { serialNumbers: splitLines(line.serials), rejectedSerialNumbers: splitLines(line.rejectedSerials) } : {}),
    ...(seesPrices && line.rate.trim() ? { rate: line.rate.trim() } : {}),
    ...(seesPrices && line.gstRate.trim() ? { gstRate: line.gstRate.trim() } : {}),
  };
}

interface ReceiptLineGridProps {
  lines: ReceiptLineDraft[];
  onChange: (lines: ReceiptLineDraft[]) => void;
  /** Shelf locations of the receiving store. */
  shelves: StockLocationDto[];
  /** Problems by line key, shown under the line. */
  problems: Record<string, string>;
  seesPrices: boolean;
  readOnly?: boolean;
}

/** The editable lines of a goods receipt. */
export function ReceiptLineGrid({ lines, onChange, shelves, problems, seesPrices, readOnly }: ReceiptLineGridProps) {
  const anyBatches = lines.some((l) => l.item.trackBatches);
  const anySerials = lines.some((l) => l.item.trackSerials);

  function update(key: string, patch: Partial<ReceiptLineDraft>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  if (lines.length === 0) return <p className="muted">No lines yet. Add the lines of an order, or an item that came without an order.</p>;

  return (
    <div className="table-wrap line-grid">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Item</th>
            <th scope="col">Unit</th>
            <th scope="col" className="num">
              Received
            </th>
            <th scope="col" className="num">
              of which rejected
            </th>
            <th scope="col" className="num">
              of which free
            </th>
            <th scope="col">Shelf</th>
            {anyBatches ? <th scope="col">Batch</th> : null}
            {anySerials ? <th scope="col">Serial numbers</th> : null}
            {seesPrices ? (
              <>
                <th scope="col" className="num">
                  Rate
                </th>
                <th scope="col" className="num">
                  GST %
                </th>
              </>
            ) : null}
            {readOnly ? null : <th scope="col" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const units = itemUnits(l.item);
            const unit = units.find((u) => u.unitId === l.unitId);
            const problem = problems[l.key];
            const n = i + 1;
            return (
              <tr key={l.key} className={problem ? "row-alert" : undefined}>
                <td>{n}</td>
                <td>
                  <span className="mono">{l.item.code}</span> {l.item.name}
                  {l.orderNumber ? (
                    <p className="muted">
                      Order {l.orderNumber}
                      {l.expected !== null ? ` · ${showQuantity(l.expected)} still expected` : ""}
                    </p>
                  ) : (
                    <p className="muted">Without an order</p>
                  )}
                  {problem ? (
                    <p className="field-error" role="alert">
                      {problem}
                    </p>
                  ) : null}
                </td>
                <td>
                  {l.orderLineId ? (
                    <span>{unit?.code ?? "—"}</span>
                  ) : (
                    <select className="input" aria-label={`Unit for line ${n}`} value={l.unitId} disabled={readOnly} onChange={(e) => update(l.key, { unitId: e.target.value })}>
                      {units.map((u) => (
                        <option key={u.unitId} value={u.unitId}>
                          {u.code}
                          {showQuantity(u.factor) !== "1" ? ` (${showQuantity(u.factor)} ${l.item.baseUnit.code})` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="num">
                  <input
                    className="input"
                    inputMode={unit?.allowsFractions ? "decimal" : "numeric"}
                    aria-label={`Received for line ${n}`}
                    aria-invalid={problem ? true : undefined}
                    value={l.received}
                    disabled={readOnly}
                    onChange={(e) => update(l.key, { received: e.target.value })}
                  />
                </td>
                <td className="num">
                  <input className="input" inputMode="decimal" aria-label={`Rejected for line ${n}`} placeholder="0" value={l.rejected} disabled={readOnly} onChange={(e) => update(l.key, { rejected: e.target.value })} />
                </td>
                <td className="num">
                  <input className="input" inputMode="decimal" aria-label={`Free for line ${n}`} placeholder="0" value={l.free} disabled={readOnly} onChange={(e) => update(l.key, { free: e.target.value })} />
                </td>
                <td>
                  <select className="input" aria-label={`Shelf for line ${n}`} value={l.shelfLocationId} disabled={readOnly} onChange={(e) => update(l.key, { shelfLocationId: e.target.value })}>
                    <option value="">Default shelf</option>
                    {shelves.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                {anyBatches ? (
                  <td>
                    {!l.item.trackBatches ? (
                      <span className="muted">—</span>
                    ) : l.batchId ? (
                      <span className="muted">Batch already chosen</span>
                    ) : (
                      <div className="form-grid">
                        <input
                          className="input"
                          aria-label={`Batch number for line ${n}`}
                          placeholder={l.item.autoNumberBatches ? "Batch (blank = automatic)" : "Batch number"}
                          value={l.batchNumber}
                          disabled={readOnly}
                          onChange={(e) => update(l.key, { batchNumber: e.target.value })}
                        />
                        <label className="muted">
                          Expires on
                          <input className="input" type="date" aria-label={`Expiry date for line ${n}`} value={l.expiryDate} disabled={readOnly} onChange={(e) => update(l.key, { expiryDate: e.target.value })} />
                        </label>
                        <label className="muted">
                          or made on
                          <input className="input" type="date" aria-label={`Manufacture date for line ${n}`} value={l.manufactureDate} disabled={readOnly} onChange={(e) => update(l.key, { manufactureDate: e.target.value })} />
                        </label>
                      </div>
                    )}
                  </td>
                ) : null}
                {anySerials ? (
                  <td>
                    {l.item.trackSerials ? (
                      <div className="form-grid">
                        <textarea className="input" aria-label={`Serial numbers accepted for line ${n}`} placeholder="Accepted, one per line" value={l.serials} disabled={readOnly} onChange={(e) => update(l.key, { serials: e.target.value })} />
                        <textarea
                          className="input"
                          aria-label={`Serial numbers rejected for line ${n}`}
                          placeholder="Rejected, one per line"
                          value={l.rejectedSerials}
                          disabled={readOnly}
                          onChange={(e) => update(l.key, { rejectedSerials: e.target.value })}
                        />
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                ) : null}
                {seesPrices ? (
                  <>
                    <td className="num">
                      <input
                        className="input"
                        inputMode="decimal"
                        aria-label={`Rate per ${unit?.code ?? "unit"} for line ${n}`}
                        placeholder={l.orderLineId ? "From order" : "From price list"}
                        value={l.rate}
                        disabled={readOnly}
                        onChange={(e) => update(l.key, { rate: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      <input className="input" inputMode="decimal" aria-label={`GST rate for line ${n}`} placeholder={l.orderLineId ? "From order" : "Last used"} value={l.gstRate} disabled={readOnly} onChange={(e) => update(l.key, { gstRate: e.target.value })} />
                    </td>
                  </>
                ) : null}
                {readOnly ? null : (
                  <td>
                    <Button size="small" variant="link" onClick={() => onChange(lines.filter((x) => x.key !== l.key))} aria-label={`Remove line ${n}`}>
                      Remove
                    </Button>
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
