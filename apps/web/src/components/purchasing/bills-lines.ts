// Copyright (c) 2026, Rademics. All rights reserved.
// Supplier bill lines as typed on screen, the live preview (shared
// calculations, preview only — the API's figures are the authority) and the
// conversion to the API's input.
import { Decimal, documentTotals, lineAmounts, suggestGst } from "shared";
import type { GoodsReceiptDto, GoodsReceiptLineDto, SupplierBillDto } from "@/lib/purchasing";
import { showQuantity, splitLines } from "@/lib/stock";
import type { ItemDto, ItemUnitDto } from "@/lib/types";

/** The three kinds of bill a user records (debit notes are made from a bill). */
export type NewBillKind = "against_receipt" | "receives_goods" | "services";

/** One-line explanations of the three kinds, shown when choosing and while editing. */
export const KIND_EXPLANATIONS: Record<NewBillKind, string> = {
  against_receipt: "The goods have already been received on a goods receipt. Pick the receipts this bill is for.",
  receives_goods: "For small purchases (often paid in cash): the goods come with the bill, so saving the bill also brings them into stock.",
  services: "For things that are not kept in stock, such as repairs, transport or electricity.",
};

export interface BillLineDraft {
  key: string;
  /** Against receipts: whether the receipt line goes on this bill. */
  include: boolean;
  itemId: string;
  itemCode: string;
  itemName: string;
  /** Known when the item was added on this screen; the unit can then be chosen. */
  units: ItemUnitDto[] | null;
  unitId: string;
  factor: string;
  trackBatches: boolean;
  trackSerials: boolean;
  autoNumberBatches: boolean;
  receiptLineId: string | null;
  receipt: { id: string; number: string } | null;
  orderLineId: string | null;
  /** Against receipts: most that can still be billed, in the line's unit. */
  billable: string | null;
  quantity: string;
  freeQuantity: string;
  rate: string;
  discountPercent: string;
  gstRate: string;
  cgst: string;
  sgst: string;
  igst: string;
  shelfLocationId: string;
  batchNumber: string;
  manufactureDate: string;
  expiryDate: string;
  serials: string;
  /** Plan 08 G8: off = input credit cannot be claimed; the tax goes into the cost of the goods. */
  creditClaimable: boolean;
}

let seq = 0;
function nextKey(): string {
  seq += 1;
  return `bill-line-${seq}`;
}

function parse(text: string | null | undefined): Decimal | null {
  if (text == null) return null;
  const t = text.trim();
  if (!t) return null;
  try {
    const d = new Decimal(t);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** "120.00" → "120", for filling inputs from API figures. */
function plain(value: string | null | undefined): string {
  if (value == null || value === "") return "";
  return showQuantity(value);
}

function blankLine(): Omit<BillLineDraft, "itemId" | "itemCode" | "itemName" | "unitId"> {
  return {
    key: nextKey(),
    include: true,
    units: null,
    factor: "1",
    trackBatches: false,
    trackSerials: false,
    autoNumberBatches: true,
    receiptLineId: null,
    receipt: null,
    orderLineId: null,
    billable: null,
    quantity: "",
    freeQuantity: "",
    rate: "",
    discountPercent: "",
    gstRate: "",
    cgst: "",
    sgst: "",
    igst: "",
    shelfLocationId: "",
    batchNumber: "",
    manufactureDate: "",
    expiryDate: "",
    serials: "",
    creditClaimable: true,
  };
}

/** The item's units; an item without unit rows still has its basic unit. */
export function unitsOf(item: ItemDto): ItemUnitDto[] {
  if (item.units.length > 0) return item.units;
  return [{ unitId: item.baseUnit.id, code: item.baseUnit.code, name: item.baseUnit.name, allowsFractions: item.baseUnit.allowsFractions, factor: "1", mrp: null }];
}

/** A new line for an item picked on screen (receiving bills and services). */
export function lineForItem(item: ItemDto, unitId: string | null): BillLineDraft {
  const units = unitsOf(item);
  const unit = units.find((u) => u.unitId === unitId) ?? units.find((u) => u.unitId === item.baseUnit.id) ?? units[0];
  return {
    ...blankLine(),
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    units,
    unitId: unit.unitId,
    factor: unit.factor,
    trackBatches: item.trackBatches,
    trackSerials: item.trackSerials,
    autoNumberBatches: item.autoNumberBatches,
  };
}

/** Billable quantity in the line's unit (the API gives it in basic units). */
function billableInLineUnit(line: GoodsReceiptLineDto): string {
  const basic = parse(line.billableQuantity) ?? new Decimal(0);
  const factor = parse(line.factor) ?? new Decimal(1);
  return factor.isZero() ? basic.toString() : basic.div(factor).toDecimalPlaces(3).toString();
}

/** Receipt lines with something left to bill, ticked, quantity = what is left. */
export function linesFromReceipt(receipt: GoodsReceiptDto): BillLineDraft[] {
  return receipt.lines
    .filter((l) => (parse(l.billableQuantity) ?? new Decimal(0)).gt(0))
    .map((l) => {
      const left = billableInLineUnit(l);
      return {
        ...blankLine(),
        itemId: l.item.id,
        itemCode: l.item.code,
        itemName: l.item.name,
        unitId: l.unitId,
        factor: l.factor,
        trackBatches: l.item.trackBatches,
        trackSerials: l.item.trackSerials,
        receiptLineId: l.id,
        receipt: { id: receipt.id, number: receipt.number },
        orderLineId: l.orderLineId,
        billable: left,
        quantity: left,
        rate: plain(l.rate),
        discountPercent: l.discountPercent && !new Decimal(l.discountPercent).isZero() ? plain(l.discountPercent) : "",
        gstRate: plain(l.gstRate),
      };
    });
}

/** A saved draft bill's lines (against receipts or services) back on screen. */
export function linesFromBill(bill: SupplierBillDto): BillLineDraft[] {
  return bill.lines.map((l) => ({
    ...blankLine(),
    itemId: l.item.id,
    itemCode: l.item.code,
    itemName: l.item.name,
    unitId: l.unitId,
    factor: l.factor,
    receiptLineId: l.receiptLineId,
    receipt: l.receipt,
    orderLineId: l.orderLineId,
    quantity: plain(l.quantity),
    freeQuantity: l.freeQuantity && !new Decimal(l.freeQuantity).isZero() ? plain(l.freeQuantity) : "",
    rate: plain(l.rate),
    discountPercent: l.discountPercent && !new Decimal(l.discountPercent).isZero() ? plain(l.discountPercent) : "",
    gstRate: plain(l.gstRate),
    cgst: l.cgst ?? "",
    sgst: l.sgst ?? "",
    igst: l.igst ?? "",
    creditClaimable: l.creditClaimable ?? true,
  }));
}

/**
 * A receiving bill's draft goods receipt (it holds shelves, batches and
 * serials) back on screen; the bill's own lines say whether credit is claimable.
 */
export function linesFromDraftReceipt(receipt: GoodsReceiptDto, bill?: SupplierBillDto | null): BillLineDraft[] {
  const claimable = new Map((bill?.lines ?? []).filter((b) => b.receiptLineId).map((b) => [b.receiptLineId!, b.creditClaimable ?? true]));
  return receipt.lines.map((l) => {
    const received = parse(l.receivedQuantity) ?? new Decimal(0);
    const free = parse(l.freeQuantity) ?? new Decimal(0);
    return {
      ...blankLine(),
      itemId: l.item.id,
      itemCode: l.item.code,
      itemName: l.item.name,
      unitId: l.unitId,
      factor: l.factor,
      trackBatches: l.item.trackBatches,
      trackSerials: l.item.trackSerials,
      orderLineId: l.orderLineId,
      quantity: received.sub(free).toString(),
      freeQuantity: free.isZero() ? "" : free.toString(),
      rate: plain(l.rate),
      discountPercent: l.discountPercent && !new Decimal(l.discountPercent).isZero() ? plain(l.discountPercent) : "",
      gstRate: plain(l.gstRate),
      cgst: l.cgst ?? "",
      sgst: l.sgst ?? "",
      igst: l.igst ?? "",
      shelfLocationId: l.shelfLocationId,
      batchNumber: l.newBatchNumber ?? "",
      expiryDate: l.newExpiryOn ?? "",
      serials: l.serialNumbers.join("\n"),
      creditClaimable: claimable.get(l.id) ?? true,
    };
  });
}

export interface LinePreview {
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  gst: Decimal;
  total: Decimal;
  /** True when the GST figures were suggested from the rate (none typed). */
  suggested: boolean;
}

/**
 * Preview of one line, or null when it cannot be worked out yet (no quantity
 * or price). GST as typed from the supplier's bill; when none is typed it is
 * suggested from the rate. The split does not change the totals, so the
 * preview does not need to know whether the supplier is in another state.
 */
/** Audit 14: `interState` from the server (useInterState), so a supplier in another state previews IGST as the bill is saved. */
export function previewLine(l: BillLineDraft, interState = false): LinePreview | null {
  const quantity = parse(l.quantity);
  const rate = parse(l.rate);
  if (!quantity || !rate || quantity.lte(0) || rate.isNegative()) return null;
  let taxable: Decimal;
  try {
    taxable = lineAmounts({ quantity, rate, discountPercent: parse(l.discountPercent) }).taxable;
  } catch {
    return null;
  }
  const typed = [l.cgst, l.sgst, l.igst].some((v) => v.trim() !== "");
  const split = typed
    ? { cgst: parse(l.cgst) ?? new Decimal(0), sgst: parse(l.sgst) ?? new Decimal(0), igst: parse(l.igst) ?? new Decimal(0) }
    : suggestGst(taxable, parse(l.gstRate) ?? new Decimal(0), interState);
  const gst = split.cgst.add(split.sgst).add(split.igst);
  return { taxable, ...split, gst, total: taxable.add(gst), suggested: !typed };
}

export interface BillPreview {
  taxable: Decimal;
  tax: Decimal;
  roundingAdjustment: Decimal;
  total: Decimal;
  /** Lines left out of the preview because their price is not typed yet. */
  unpriced: number;
}

/**
 * Totals of the included lines, rounded to the rupee like the API does.
 * Under reverse charge (plan 08 G8) the supplier is owed the bill without
 * tax; the tax is still shown, as the shop pays it itself.
 */
export function previewBill(lines: BillLineDraft[], reverseCharge = false, interState = false): BillPreview {
  const included = lines.filter((l) => l.include);
  const previews = included.map((l) => previewLine(l, interState));
  const priced = previews.filter((p): p is LinePreview => p !== null);
  const zero = new Decimal(0);
  const t = documentTotals(priced.map((p) => (reverseCharge ? { taxable: p.taxable, cgst: zero, sgst: zero, igst: zero } : { taxable: p.taxable, cgst: p.cgst, sgst: p.sgst, igst: p.igst })));
  const tax = reverseCharge ? priced.reduce((s, p) => s.add(p.gst), zero) : t.tax;
  return { taxable: t.taxable, tax, roundingAdjustment: t.roundingAdjustment, total: t.total, unpriced: previews.length - priced.length };
}

/** What is wrong with a line before anything is sent, or null. The API checks all of this again. */
export function billLineProblem(l: BillLineDraft, kind: NewBillKind): string | null {
  if (!l.include) return null;
  const code = l.itemCode;
  const quantity = parse(l.quantity);
  if (!l.quantity.trim()) return `${code}: enter the quantity billed`;
  if (!quantity || quantity.lte(0)) return `${code}: the quantity must be more than zero`;
  const free = l.freeQuantity.trim() ? parse(l.freeQuantity) : new Decimal(0);
  if (!free || free.isNegative()) return `${code}: the free quantity must be zero or more`;
  if (l.rate.trim()) {
    const rate = parse(l.rate);
    if (!rate || rate.isNegative()) return `${code}: the price must be zero or more`;
  }
  if (l.discountPercent.trim()) {
    const pct = parse(l.discountPercent);
    if (!pct || pct.isNegative() || pct.gt(100)) return `${code}: the discount must be between 0 and 100 percent`;
  }
  if (l.gstRate.trim()) {
    const g = parse(l.gstRate);
    if (!g || g.isNegative() || g.gt(100)) return `${code}: the GST rate must be between 0 and 100`;
  }
  for (const [name, v] of [
    ["CGST", l.cgst],
    ["SGST", l.sgst],
    ["IGST", l.igst],
  ] as const) {
    if (v.trim()) {
      const d = parse(v);
      if (!d || d.isNegative()) return `${code}: ${name} must be an amount of zero or more`;
    }
  }
  if (kind === "against_receipt" && l.billable !== null) {
    const max = parse(l.billable) ?? new Decimal(0);
    if (quantity.add(free).gt(max)) return `${code}: only ${showQuantity(l.billable)} still to be billed on ${l.receipt?.number ?? "the receipt"}`;
  }
  if (kind === "receives_goods") {
    if (l.trackBatches && !l.batchNumber.trim() && !l.autoNumberBatches) return `${code}: give the batch number`;
    if (l.trackSerials) {
      const serials = splitLines(l.serials);
      const basic = quantity.add(free).mul(parse(l.factor) ?? 1);
      if (!basic.isInteger() || !basic.eq(serials.length)) return `${code}: list exactly ${basic.toString()} serial numbers, one per line`;
      if (new Set(serials).size !== serials.length) return `${code}: a serial number is listed twice`;
    }
  }
  return null;
}

const typed = (v: string) => (v.trim() ? { value: v.trim() } : null);

/** The line as the API expects it; blank fields are left out so the API fills them. */
export function billLineToInput(l: BillLineDraft, kind: NewBillKind) {
  const pick = (name: string, v: string) => {
    const t = typed(v);
    return t ? { [name]: t.value } : {};
  };
  return {
    ...(l.receiptLineId ? { receiptLineId: l.receiptLineId } : {}),
    ...(l.orderLineId ? { orderLineId: l.orderLineId } : {}),
    itemId: l.itemId,
    unitId: l.unitId,
    quantity: l.quantity.trim(),
    ...pick("freeQuantity", l.freeQuantity),
    ...pick("rate", l.rate),
    ...pick("discountPercent", l.discountPercent),
    ...pick("gstRate", l.gstRate),
    ...pick("cgst", l.cgst),
    ...pick("sgst", l.sgst),
    ...pick("igst", l.igst),
    // Claimable is the default on the server; only "not claimable" is sent.
    ...(l.creditClaimable ? {} : { creditClaimable: false }),
    ...(kind === "receives_goods"
      ? {
          shelfLocationId: l.shelfLocationId || null,
          ...(l.trackBatches
            ? { batchNumber: l.batchNumber.trim() || null, manufactureDate: l.manufactureDate || null, expiryDate: l.expiryDate || null }
            : {}),
          ...(l.trackSerials ? { serialNumbers: splitLines(l.serials) } : {}),
        }
      : {}),
  };
}
