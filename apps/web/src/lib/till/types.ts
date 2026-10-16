// Copyright (c) 2026, Rademics. All rights reserved.
// Shapes the till works with: what GET /pos/till/:id/snapshot sends, what
// POST /pos/bills answers, and the till's own records (pos-offline plan §2).

export interface SnapPaymentMethod {
  id: string;
  code: string;
  name: string;
  kind: "cash" | "card" | "upi" | "other" | "on_account";
  allowRefund: boolean;
  needsReference: boolean;
  isDefault: boolean;
  active: boolean;
}

export interface SnapTill {
  id: string;
  code: string;
  name: string;
  numberPrefix: string;
  locationId: string;
  priceListId: string;
  /** Prices are per the price's own unit (true) or per basic unit, scaled to the line's unit (false). */
  pricesPerUnit: boolean;
  /** The default selling list, used when an item has no price in the till's list. */
  fallbackPriceList: { id: string; pricesPerUnit: boolean } | null;
  cashierDiscountPercent: string;
  allowPriceChange: boolean;
  autoPrint: boolean;
  receiptFooter: string | null;
  store: { id: string; code: string; name: string; address: string; phone: string | null; stateCode: string | null };
  company: { legalName: string; stateCode: string; gstin: string | null };
  paymentMethods: SnapPaymentMethod[];
  liveAllowed: boolean;
  walkInCustomerId: string | null;
  /** Plan 11 B4 (decision 47): the store's home-delivery charge, none at or above freeAbove, billed as itemId. */
  delivery?: { charge: string; freeAbove: string | null; itemId: string | null };
  /** Plan 11 part 2: the service item an alteration charge is billed as. */
  alterationItemId?: string | null;
}

export interface SnapItemUnit {
  unitId: string;
  code: string;
  factor: string;
  allowsFractions: boolean;
  mrp: string | null;
}

export interface SnapItem {
  id: string;
  code: string;
  name: string;
  active: boolean;
  isStockItem: boolean;
  trackBatches: boolean;
  trackSerials: boolean;
  hsnCode: string | null;
  mrp: string | null;
  maxDiscountPercent: string;
  baseUnitId: string;
  parentItemId: string | null;
  brandId: string | null;
  itemGroup: { id: string; path: string };
  units: SnapItemUnit[];
  barcodes: { code: string; unitId: string | null }[];
}

export interface SnapPrice {
  id: string;
  priceListId: string;
  itemId: string;
  unitId: string;
  price: string;
  startDate: string;
  endDate: string | null;
  customerId: string | null;
  batchId: string | null;
  packSize: string | null;
}

export interface SnapGstRate {
  hsnCode: string;
  rate: string;
  effectiveFrom: string;
  approved: boolean;
}

export interface SnapOffer {
  id: string;
  code: string;
  name: string;
  kind: "percent" | "amount" | "special_price" | "free_goods" | "buy_get" | "mix_match";
  appliesTo: "items" | "groups" | "brands" | "bill";
  targetIds: string[];
  value: string | null;
  buyQuantity: string | null;
  freeQuantity: string | null;
  /** Plan 11 B3: buy_get gives this item free … */
  freeItemId?: string | null;
  /** … mix_match counts sets of this many items, for setPrice or with the cheapest free. */
  setQuantity?: number | null;
  setPrice?: string | null;
  cheapestFree?: boolean;
  minQuantity: string | null;
  minAmount: string | null;
  storeIds: string[];
  customerGroupId: string | null;
  startDate: string;
  endDate: string | null;
  priority: number;
  couponOnly: boolean;
  active: boolean;
}

export interface SnapCoupon {
  code: string;
  offerId: string;
  startDate: string;
  endDate: string | null;
  maxUses: number | null;
  usedCount: number;
  customerId: string | null;
}

/** A salesperson of the till's store (plan 11 C1). */
export interface SnapSalesStaff {
  id: string;
  code: string;
  name: string;
}

export interface SnapCustomer {
  id: string;
  code: string;
  name: string;
  mobile: string | null;
  gstin: string | null;
  stateCode: string | null;
  customerGroupId: string | null;
  status: string;
}

export interface TillSnapshot {
  serverTime: string;
  full: boolean;
  till: SnapTill;
  financialYears: { name: string; startDate: string; endDate: string }[];
  lastNumbers: { financialYear: string; prefix: string; lastNumber: string | null }[];
  items: SnapItem[];
  prices: SnapPrice[];
  gstRates: SnapGstRate[];
  offers: SnapOffer[];
  coupons: SnapCoupon[];
  customers: SnapCustomer[];
  stock: { itemId: string; quantity: string }[];
  /** Plan 11 part 2: stock set aside for ready customer orders (basic units). */
  reserved?: { itemId: string; quantity: string }[];
  /** Plan 11 C1: the store's salespeople in use. */
  salesStaff?: SnapSalesStaff[];
}

/** The snapshot as kept on the till, with when it was last refreshed. */
export interface StoredSnapshot extends TillSnapshot {
  /** Browser time of the last successful refresh (ISO). */
  fetchedAt: string;
}

// ---- What the server answers ----

export interface ReceiptLine {
  name: string;
  code: string;
  hsn: string | null;
  quantity: string;
  price: string;
  discount: string;
  amount: string;
  free: boolean;
  serials: string[];
  /** Plan 11 B3: the offer on the line. */
  offer?: string | null;
  /** Plan 11 C1: the line's salesperson code. */
  salesStaff?: string | null;
}

/** Plan 11 B4: delivery details shown on the receipt. */
export interface ReceiptDelivery {
  name: string | null;
  address: string;
  phone: string | null;
  deliverOn: string | null;
  chargeAmount: string;
}

export interface Receipt {
  billId: string | null;
  number: string;
  kind: "sale" | "return";
  duplicate: boolean;
  provisional: boolean;
  soldAt: string;
  till: string;
  footer: string | null;
  lines: ReceiptLine[];
  gstTable: { rate: string; taxable: string; cgst: string; sgst: string; igst: string }[];
  totals: { gross: string; discount: string; taxable: string; rounding: string; total: string };
  payments: { method: string; amount: string; reference: string | null }[];
  change: string;
  /** Plan 11 B3: each offer used and what it saved. */
  offers?: { name: string; saving: string }[];
  /** Plan 11 C1: the bill's salesperson. */
  salesStaff?: string | null;
  delivery?: ReceiptDelivery | null;
}

export interface BillLineDto {
  id: string;
  lineNo: number;
  item: { id: string; code: string; name: string; hsnCode: string | null };
  unitId: string;
  quantity: string;
  basicQuantity: string;
  returnedQuantity: string;
  mrp: string | null;
  listPrice: string;
  price: string;
  discountAmount: string;
  isFree: boolean;
  gstRate: string;
  lineTotal: string;
  salesStaffId?: string | null;
}

export interface BillDto {
  id: string;
  number: string;
  kind: "sale" | "return";
  status: string;
  till: { id: string; code: string; name: string };
  clientId: string;
  customerId: string;
  soldAt: string;
  businessDate: string;
  total: string;
  offline: boolean;
  lines: BillLineDto[];
  payments: { paymentMethod: { id: string; code: string; name: string; kind: string }; amount: string; reference: string | null }[];
}

export interface TransactionResult {
  repeated: boolean;
  sale: BillDto | null;
  return: BillDto | null;
  net: string;
  change: string;
  receipts: Receipt[];
  /** Plan 11 part 2: e.g. the sale took stock set aside for a customer order (never a refusal). */
  warnings?: string[];
}

export interface ShiftExpected {
  paymentMethodId: string;
  code: string;
  name: string;
  kind: string;
  opening: string;
  received: string;
  change: string;
  cashIn: string;
  cashOut: string;
  expected: string;
}

export interface ServerShift {
  id: string;
  clientId: string;
  businessDate: string;
  openedById: string;
  openedAt: string;
  status: string;
  openingCash: { paymentMethodId: string; amount: string }[];
  cashMovements: { id: string; clientId: string; direction: string; amount: string; reason: string; at: string }[];
  expected?: ShiftExpected[];
}

// ---- The till's own records ----

/** The open shift as the till knows it (pos-offline §2). */
export interface LocalShift {
  clientId: string;
  /** Known once the server has the shift. */
  id: string | null;
  businessDate: string;
  openedAt: string;
  openedByName: string;
  openingCash: { paymentMethodId: string; amount: string }[];
}

export interface Person {
  id: string;
  name: string;
}

// ---- Plan 11 part 2: customer orders and alteration jobs at the till ----

export interface TillOrderLine {
  id: string;
  lineNo: number;
  item: { id: string; code: string; name: string };
  unitId: string;
  unitCode: string;
  quantity: string;
  price: string;
  amount: string;
  setAside: string;
}

export interface TillOrder {
  id: string;
  number: string;
  status: "open" | "ready" | "collected" | "cancelled";
  customer: { id: string; code: string; name: string; mobile: string | null } | null;
  customerId: string;
  expectedOn: string | null;
  overdue: boolean;
  total: string;
  advanceReceived: string;
  advanceHeld: string;
  lines: TillOrderLine[];
}

export interface TillAlteration {
  id: string;
  number: string;
  status: "received" | "with_tailor" | "ready" | "delivered" | "cancelled";
  name: string | null;
  phone: string | null;
  promisedOn: string | null;
  overdue: boolean;
  charge: string;
  chargePaidWith: "bill" | "collection";
  chargeBill: { id: string; number: string | null } | null;
  tailor: string | null;
  lines: { garment: string; work: string }[];
}
