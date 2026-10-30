// Copyright (c) 2026, Rademics. All rights reserved.
// Types, labels and small helpers shared by the purchasing (module 5) screens.
// The shapes mirror the API's DTOs; money and quantities are decimal strings
// (rule 1). Amounts are missing when the user may not see buying prices
// (decision 70), so every price field is optional.
import { type CurrentUser, Decimal, hasPermission } from "shared";

export type PurchaseOrderStatus = "draft" | "to_receive_and_bill" | "to_receive" | "to_bill" | "completed" | "on_hold" | "closed" | "cancelled";
export type GoodsReceiptStatus = "draft" | "to_bill" | "partly_billed" | "completed" | "returned" | "closed" | "cancelled";
export type SupplierBillStatus = "draft" | "unpaid" | "cancelled";
export type SupplierBillKind = "against_receipt" | "receives_goods" | "services" | "debit_note";

export interface Ref {
  id: string;
  code: string;
  name: string;
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** GST and amounts shown only to users with buying_prices.view. */
export interface PricedFields {
  rate?: string;
  discountPercent?: string;
  discountAmount?: string;
  taxableAmount?: string;
  gstRate?: string;
  cgst?: string;
  sgst?: string;
  igst?: string;
  lineTotal?: string;
}

export interface PurchaseOrderHeader {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  supplier: Ref;
  store: Ref;
  orderDate: string;
  neededBy: string;
  dueDate: string | null;
  supplierQuoteRef: string | null;
  paymentTermsId: string | null;
  receivedPercent: string;
  billedPercent: string;
  overdue: boolean;
  taxableAmount?: string;
  taxAmount?: string;
  roundingAdjustment?: string;
  total?: string;
  approvedAboveLimit: boolean;
  holdReason: string | null;
  closeReason: string | null;
  cancelReason: string | null;
  remarks: string | null;
  createdAt: string;
  finalisedAt: string | null;
}

export interface PurchaseOrderLineDto extends PricedFields {
  id: string;
  lineNo: number;
  item: { id: string; code: string; name: string; isStockItem: boolean; trackBatches: boolean; trackSerials: boolean };
  unitId: string;
  factor: string;
  quantity: string;
  freeQuantity: string;
  basicQuantity: string;
  storeId: string;
  neededBy: string;
  receivedQuantity: string;
  pendingQuantity: string;
  billedAmount?: string;
  pendingAmount?: string;
}

export interface PurchaseOrderDto extends PurchaseOrderHeader {
  lines: PurchaseOrderLineDto[];
}

export interface GoodsReceiptHeader {
  id: string;
  number: string;
  status: GoodsReceiptStatus;
  isReturn: boolean;
  /** Plan 11 part 2: sale or return. */
  isConsignment: boolean;
  returnOfId: string | null;
  billId: string | null;
  supplier: Ref;
  store: Ref;
  postingDate: string;
  postingAt: string;
  deliveryNoteNo: string | null;
  transporterName: string | null;
  vehicleNo: string | null;
  noOrderReason: string | null;
  taxableAmount?: string;
  taxAmount?: string;
  total?: string;
  stockValue?: string;
  billedPercent: string;
  returnedPercent: string;
  check: { result: string; remarks: string | null; checkedAt: string | null; checkedById: string | null } | null;
  isBackDated: boolean;
  remarks: string | null;
  cancelReason: string | null;
  createdAt: string;
  finalisedAt: string | null;
}

export interface GoodsReceiptLineDto extends PricedFields {
  id: string;
  lineNo: number;
  orderLineId: string | null;
  order: { id: string; number: string } | null;
  item: { id: string; code: string; name: string; trackBatches: boolean; trackSerials: boolean };
  unitId: string;
  factor: string;
  receivedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  freeQuantity: string;
  basicAcceptedQuantity: string;
  basicRejectedQuantity: string;
  returnedAcceptedQuantity: string;
  returnedRejectedQuantity: string;
  billedQuantity: string;
  billableQuantity: string;
  shelfLocationId: string;
  rejectedLocationId: string | null;
  batchId: string | null;
  newBatchNumber: string | null;
  newExpiryOn: string | null;
  serialNumbers: string[];
  rejectedSerialNumbers: string[];
  returnOfLineId: string | null;
  unitCost?: string;
  extraCharges?: string;
}

export interface GoodsReceiptDto extends GoodsReceiptHeader {
  lines: GoodsReceiptLineDto[];
  /** Over-receipt accepted with a warning (finalise only). */
  warnings?: string[];
}

export interface SupplierBillHeader {
  id: string;
  number: string;
  kind: SupplierBillKind;
  status: SupplierBillStatus;
  supplier: Ref;
  supplierBillNo: string;
  supplierBillDate: string;
  postingDate: string;
  storeId: string | null;
  paymentTermsId: string | null;
  dueDate: string;
  overdue: boolean;
  /** From the accounts (plan 11 A3): finalised bills only. */
  paymentStatus?: "unpaid" | "part_paid" | "paid";
  /** Still owed, when buying prices may be seen. */
  amountDue?: string;
  held: boolean;
  holdReason: string | null;
  holdUntil: string | null;
  taxableAmount?: string;
  taxAmount?: string;
  roundingAdjustment?: string;
  total?: string;
  priceDifference?: string;
  returnOfId: string | null;
  receiptId: string | null;
  remarks: string | null;
  cancelReason: string | null;
  /** Plan 08 G8: the shop pays the tax itself; the total leaves it out. */
  reverseCharge?: boolean;
  /** Plan 08 G1: state code of the place of supply (the receiving store's GSTIN state). */
  placeOfSupply?: string | null;
  gstRegistrationId?: string | null;
  createdAt: string;
  finalisedAt: string | null;
}

export interface SupplierBillLineDto extends PricedFields {
  id: string;
  lineNo: number;
  item: { id: string; code: string; name: string; isStockItem: boolean };
  unitId: string;
  factor: string;
  quantity: string;
  freeQuantity: string;
  basicQuantity: string;
  returnedQuantity: string;
  receiptLineId: string | null;
  receipt: { id: string; number: string } | null;
  orderLineId: string | null;
  order: { id: string; number: string } | null;
  accountRole: string;
  priceDifference?: string;
  hsnCode?: string | null;
  /** Plan 08 G8: false = the tax is added to the cost of the goods. */
  creditClaimable?: boolean;
}

export interface SupplierBillDto extends SupplierBillHeader {
  lines: SupplierBillLineDto[];
  warnings?: string[];
}

export interface LandedChargeDto {
  id: string;
  number: string;
  status: "draft" | "finalised" | "cancelled";
  postingDate: string;
  shareBy: "quantity" | "value" | "manual";
  receiptIds: string[];
  transporterBillId: string | null;
  remarks: string | null;
  cancelReason: string | null;
  total?: string;
  charges?: { description: string; chargeType: string; amount: string }[];
  shares?: { receiptLineId: string; receipt: string; item: { id: string; code: string; name: string }; amount: string }[];
  createdAt: string;
  finalisedAt: string | null;
}

export interface ChargePreview {
  total: string;
  shares: { receiptLineId: string; receipt: string; item: { code: string; name: string }; quantity: string; value: string; share: string }[];
}

export interface ReorderSuggestionDto {
  id: string;
  businessDate: string;
  store: Ref | null;
  item: { id: string; code: string; name: string; baseUnitId: string } | null;
  supplier: Ref | null;
  /** "usual" when set on the item; "last" when it is the supplier it was last bought from. */
  supplierSource?: "usual" | "last" | null;
  onHand: string;
  onOrder: string;
  reorderLevel: string;
  reorderQuantity: string;
  suggestedQuantity: string;
}

export interface PurchaseSettingsDto {
  requireOrderForReceipt: boolean;
  billNeedsOrder: boolean;
  billNeedsReceipt: boolean;
  overOrderPercent: string;
  overReceiptPercent: string;
  overBillingPercent: string;
  priceMismatch: "allow" | "warn" | "block";
  checkSupplierBillNo: boolean;
  approvalLimit: string;
  fillLastPurchasePrice: boolean;
}

export const ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  to_receive_and_bill: "Waiting for goods and bill",
  to_receive: "Waiting for goods",
  to_bill: "Waiting for bill",
  completed: "Completed",
  on_hold: "On hold",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const RECEIPT_STATUS_LABELS: Record<GoodsReceiptStatus, string> = {
  draft: "Draft",
  to_bill: "Waiting for bill",
  partly_billed: "Partly billed",
  completed: "Completed",
  returned: "Returned",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const BILL_STATUS_LABELS: Record<SupplierBillStatus, string> = {
  draft: "Draft",
  unpaid: "Not paid",
  cancelled: "Cancelled",
};

export const BILL_PAYMENT_LABELS: Record<"unpaid" | "part_paid" | "paid", string> = {
  unpaid: "Not paid",
  part_paid: "Part paid",
  paid: "Paid",
};

export const BILL_KIND_LABELS: Record<SupplierBillKind, string> = {
  against_receipt: "Against goods receipts",
  receives_goods: "Bill that also receives the goods",
  services: "Services / non-stock",
  debit_note: "Debit note",
};

export const CHECK_RESULT_LABELS: Record<string, string> = {
  passed: "Passed",
  passed_with_remarks: "Passed with remarks",
  failed: "Failed",
};

export const CHARGE_TYPE_LABELS: Record<string, string> = {
  freight: "Freight",
  loading: "Loading / unloading",
  insurance: "Insurance",
  other: "Other",
};

/** Plain-language names for the account roles module 7 will post (shown on bills). */
export const ACCOUNT_ROLE_LABELS: Record<string, string> = {
  goods_received_not_billed: "Goods received, not billed",
  stock: "Stock",
  purchase_expense: "Purchase expense",
  supplier_payable: "Owed to supplier",
  consignment_payable: "Sale or return (consignment statement)",
  gst_input: "GST input credit",
};

/** Badge tone for a status (matches the .badge-* classes). */
export function statusTone(status: string): "ok" | "warn" | "off" | "neutral" {
  if (status === "completed" || status === "unpaid" || status === "finalised") return "ok";
  if (status === "cancelled") return "off";
  if (status === "on_hold" || status === "draft" || status === "closed") return "neutral";
  return "warn";
}

/** "1,84,250.00" — Indian digit grouping for rupee amounts (display only). */
export function rupees(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    return value;
  }
  const negative = d.isNegative() && !d.isZero();
  const [whole, frac] = d.abs().toFixed(2).split(".");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}₹${rest ? `${rest},${last3}` : last3}.${frac}`;
}

/**
 * Audit 9: a price or cost per unit, "₹1,250.50" or "₹12.3456" — rupees with grouping, keeping the
 * third and fourth decimal only when they are not zero (a cost per piece can have them).
 */
export function unitRupees(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    return value;
  }
  const extra = d.toFixed(4).slice(-2) === "00" ? "" : d.abs().toFixed(4).slice(-2).replace(/0$/, "");
  return `${rupees(d.toFixed(2, Decimal.ROUND_DOWN))}${extra}`;
}

/** Rights in plain names, matching the API checks. */
export function purchaseRights(user: CurrentUser | null) {
  return {
    view: hasPermission(user, "purchase.view"),
    order: hasPermission(user, "purchase.order"),
    approve: hasPermission(user, "purchase.approve"),
    receive: hasPermission(user, "purchase.receive"),
    receiveWithoutOrder: hasPermission(user, "purchase.receive_without_order"),
    bill: hasPermission(user, "purchase.bill"),
    returns: hasPermission(user, "purchase.return"),
    charges: hasPermission(user, "purchase.charges"),
    settings: hasPermission(user, "purchase.settings"),
    prices: hasPermission(user, "buying_prices.view"),
    costs: hasPermission(user, "stock.cost.view"),
  };
}

/** Rows to CSV text (opens in Excel); every value is quoted. Decision 65: fixed reports with export. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  // Code audit, 27 October 2026: text starting with = + - @ would run as a formula in Excel.
  const safe = (s: string) => (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s) ? `'${s}` : s);
  const cell = (v: string | number | null | undefined) => `"${(typeof v === "string" ? safe(v) : String(v ?? "")).replace(/"/g, '""')}"`;
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n");
}

/** Starts a download of CSV text in the browser. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
