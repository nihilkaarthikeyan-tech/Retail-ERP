// Copyright (c) 2026, Rademics. All rights reserved.
"use client";

import { Decimal, quantityProblem } from "shared";
import { Button } from "@/components/ui";
import { api, query } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { showQuantity, splitLines } from "@/lib/stock";
import type { BatchStockRow, ItemDto, ItemUnitDto, StockDocLineDto } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

/** The kinds of document the line grid edits. */
export type EditableKind = "stock_in" | "stock_out" | "move" | "transfer_send";

/** One line as typed on screen (all text, sent as decimal strings). */
export interface LineDraft {
  key: string;
  item: ItemDto;
  unitId: string;
  quantity: string;
  /** Existing batch (out, move, transfer; or more of a known batch on a stock in). */
  batchId: string;
  /** New batch on a stock in. */
  batchNumber: string;
  manufactureDate: string;
  expiryDate: string;
  /** Serial numbers, one per line. */
  serials: string;
  /** Stock in: cost per unit of the line's unit. */
  unitCost: string;
}

let keySeq = 0;
export function newLineKey(): string {
  keySeq += 1;
  return `line-${keySeq}`;
}

/** The item's units; an item without unit rows still has its basic unit. */
export function itemUnits(item: ItemDto): ItemUnitDto[] {
  if (item.units.length > 0) return item.units;
  return [{ unitId: item.baseUnit.id, code: item.baseUnit.code, name: item.baseUnit.name, allowsFractions: item.baseUnit.allowsFractions, factor: "1", mrp: null }];
}

export function emptyLine(item: ItemDto, unitId: string | null): LineDraft {
  const units = itemUnits(item);
  const unit = units.find((u) => u.unitId === unitId) ?? units.find((u) => u.unitId === item.baseUnit.id) ?? units[0];
  return { key: newLineKey(), item, unitId: unit.unitId, quantity: "", batchId: "", batchNumber: "", manufactureDate: "", expiryDate: "", serials: "", unitCost: "" };
}

/** A saved draft line back into its on-screen form. The API keeps cost per basic unit; the screen shows it per line unit. */
export function lineFromDto(line: StockDocLineDto, item: ItemDto): LineDraft {
  let unitCost = "";
  if (line.unitCost) {
    try {
      unitCost = new Decimal(line.unitCost).mul(line.factor).toDecimalPlaces(4).toString();
    } catch {
      unitCost = line.unitCost;
    }
  }
  return {
    key: newLineKey(),
    item,
    unitId: line.unitId,
    quantity: showQuantity(line.quantity),
    batchId: line.batch?.id ?? "",
    batchNumber: line.newBatchNumber ?? "",
    manufactureDate: "",
    expiryDate: line.newExpiryOn ?? "",
    serials: line.serialNumbers.join("\n"),
    unitCost,
  };
}

function parse(text: string): Decimal | null {
  try {
    const d = new Decimal(text.trim());
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * What is wrong with a line before anything is sent, or null. The API checks
 * all of this again; this only saves a round trip.
 */
export function lineProblem(line: LineDraft, kind: EditableKind): string | null {
  const code = line.item.code;
  const unit = itemUnits(line.item).find((u) => u.unitId === line.unitId);
  if (!unit) return `${code}: choose a unit`;
  const typed = line.quantity.trim();
  if (!typed) return `${code}: enter a quantity`;
  const problem = quantityProblem(typed, unit);
  if (problem) return `${code}: ${problem}`;
  const quantity = parse(typed);
  if (!quantity || quantity.lte(0)) return `${code}: the quantity must be more than zero`;

  if (line.item.trackBatches) {
    if (kind === "stock_in") {
      if (!line.batchId && !line.batchNumber.trim() && !line.item.autoNumberBatches) return `${code}: give a batch number`;
      if (!line.batchId && line.item.shelfLifeDays && !line.expiryDate && !line.manufactureDate) return `${code}: give the expiry date or the manufacture date`;
    } else if (!line.batchId) {
      return `${code}: choose the batch`;
    }
  }

  if (line.item.trackSerials) {
    const serials = splitLines(line.serials);
    const basic = quantity.mul(parse(unit.factor) ?? 1);
    if (!basic.isInteger() || !basic.eq(serials.length)) return `${code}: list exactly ${basic.toString()} serial numbers, one per line`;
    if (new Set(serials).size !== serials.length) return `${code}: a serial number is listed twice`;
  }

  if (kind === "stock_in") {
    const cost = line.unitCost.trim();
    if (!cost) return `${code}: give the cost per unit`;
    const c = parse(cost);
    if (!c || c.isNegative()) return `${code}: the cost must be zero or more`;
  }
  return null;
}

/** The line as the API expects it. */
export function lineToInput(line: LineDraft, kind: EditableKind) {
  const serials = splitLines(line.serials);
  return {
    itemId: line.item.id,
    unitId: line.unitId,
    quantity: line.quantity.trim(),
    ...(line.item.trackBatches && line.batchId ? { batchId: line.batchId } : {}),
    ...(line.item.trackBatches && kind === "stock_in" && !line.batchId
      ? {
          batchNumber: line.batchNumber.trim() || null,
          manufactureDate: line.manufactureDate || null,
          expiryDate: line.expiryDate || null,
        }
      : {}),
    ...(line.item.trackSerials ? { serialNumbers: serials } : {}),
    ...(kind === "stock_in" ? { unitCost: line.unitCost.trim() } : {}),
  };
}

export function BatchSelect({ id, itemId, locationId, value, onChange, disabled }: { id: string; itemId: string; locationId: string; value: string; onChange: (batchId: string) => void; disabled?: boolean }) {
  const batches = useLoad(() => api.get<BatchStockRow[]>(`/stock/batches${query({ itemId })}`), [itemId]);
  const here = (batches.data ?? []).filter((b) => !locationId || b.location.id === locationId);
  return (
    <select id={id} className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label="Batch">
      <option value="">{batches.loading ? "Loading batches…" : here.length ? "Choose a batch" : "No batch in stock here"}</option>
      {here.map((b) => (
        <option key={`${b.batch.id}-${b.location.id}`} value={b.batch.id}>
          {b.batch.batchNumber} · {showQuantity(b.quantity)} in stock{b.batch.expiryDate ? ` · expires ${formatDate(b.batch.expiryDate)}` : ""}
          {b.expired ? " (EXPIRED)" : ""}
        </option>
      ))}
    </select>
  );
}

interface StockLineGridProps {
  kind: EditableKind;
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  /** Where stock leaves from (batch choices are limited to it). */
  fromLocationId: string;
  /** Problems by line key, shown under the line. */
  problems: Record<string, string>;
  readOnly?: boolean;
}

/** The editable lines of a stock in, write-off, move or transfer. */
export function StockLineGrid({ kind, lines, onChange, fromLocationId, problems, readOnly }: StockLineGridProps) {
  const anyBatches = lines.some((l) => l.item.trackBatches);
  const anySerials = lines.some((l) => l.item.trackSerials);
  const withCost = kind === "stock_in";

  function update(key: string, patch: Partial<LineDraft>) {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
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
            {anyBatches ? <th scope="col">Batch</th> : null}
            {anySerials ? <th scope="col">Serial numbers</th> : null}
            {withCost ? (
              <th scope="col" className="num">
                Cost per unit
              </th>
            ) : null}
            {readOnly ? null : <th scope="col" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const units = itemUnits(l.item);
            const unit = units.find((u) => u.unitId === l.unitId);
            const problem = problems[l.key];
            const idBase = `line-${i + 1}`;
            return (
              <tr key={l.key} className={problem ? "row-alert" : undefined}>
                <td>{i + 1}</td>
                <td>
                  <span className="mono">{l.item.code}</span> {l.item.name}
                  {problem ? (
                    <p className="field-error" role="alert">
                      {problem}
                    </p>
                  ) : null}
                </td>
                <td>
                  <select id={`${idBase}-unit`} className="input" aria-label={`Unit for line ${i + 1}`} value={l.unitId} disabled={readOnly} onChange={(e) => update(l.key, { unitId: e.target.value })}>
                    {units.map((u) => (
                      <option key={u.unitId} value={u.unitId}>
                        {u.code}
                        {u.factor !== "1" && showQuantity(u.factor) !== "1" ? ` (${showQuantity(u.factor)} ${l.item.baseUnit.code})` : ""}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num">
                  <input
                    id={`${idBase}-qty`}
                    className="input"
                    inputMode={unit?.allowsFractions ? "decimal" : "numeric"}
                    aria-label={`Quantity for line ${i + 1}`}
                    aria-invalid={problem ? true : undefined}
                    value={l.quantity}
                    disabled={readOnly}
                    onChange={(e) => update(l.key, { quantity: e.target.value })}
                  />
                </td>
                {anyBatches ? (
                  <td>
                    {!l.item.trackBatches ? (
                      <span className="muted">—</span>
                    ) : kind === "stock_in" ? (
                      <div className="form-grid">
                        <input className="input" aria-label={`Batch number for line ${i + 1}`} placeholder={l.item.autoNumberBatches ? "Batch (blank = automatic)" : "Batch number"} value={l.batchNumber} disabled={readOnly} onChange={(e) => update(l.key, { batchNumber: e.target.value, batchId: "" })} />
                        <label className="muted">
                          Made on
                          <input className="input" type="date" aria-label={`Manufacture date for line ${i + 1}`} value={l.manufactureDate} disabled={readOnly} onChange={(e) => update(l.key, { manufactureDate: e.target.value })} />
                        </label>
                        <label className="muted">
                          Expires on
                          <input className="input" type="date" aria-label={`Expiry date for line ${i + 1}`} value={l.expiryDate} disabled={readOnly} onChange={(e) => update(l.key, { expiryDate: e.target.value })} />
                        </label>
                      </div>
                    ) : (
                      <BatchSelect id={`${idBase}-batch`} itemId={l.item.id} locationId={fromLocationId} value={l.batchId} disabled={readOnly} onChange={(batchId) => update(l.key, { batchId })} />
                    )}
                  </td>
                ) : null}
                {anySerials ? (
                  <td>
                    {l.item.trackSerials ? (
                      <textarea className="input" aria-label={`Serial numbers for line ${i + 1}`} placeholder="One per line" value={l.serials} disabled={readOnly} onChange={(e) => update(l.key, { serials: e.target.value })} />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                ) : null}
                {withCost ? (
                  <td className="num">
                    <input className="input" inputMode="decimal" aria-label={`Cost per ${unit?.code ?? "unit"} for line ${i + 1}`} value={l.unitCost} disabled={readOnly} onChange={(e) => update(l.key, { unitCost: e.target.value })} />
                  </td>
                ) : null}
                {readOnly ? null : (
                  <td>
                    <Button size="small" variant="link" onClick={() => onChange(lines.filter((x) => x.key !== l.key))} aria-label={`Remove line ${i + 1}`}>
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
