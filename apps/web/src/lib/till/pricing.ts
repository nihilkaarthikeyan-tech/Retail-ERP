// Copyright (c) 2026, Rademics. All rights reserved.
// Local pricing on the till (plan 06 §4–§5; pos-offline §2 and §5). The same
// shared functions as the server work out every figure, so an online bill shows
// what the server will save and an offline bill is right on the receipt:
// price (selectPrice, customer price first), MRP cap, cashier discount limit,
// the best offers of the bill (line offers, mix and match, buy X get Y) and
// free lines, the bill discount shared over the lines, the home-delivery
// charge, GST from the HSN rate list and rounding to the rupee. No floating
// point (rule 1).
import {
  bandUnitPrice,
  bestOffer,
  checkDiscount,
  Decimal,
  type DecimalInput,
  deliveryChargeFor,
  effectiveDiscountPercent,
  freeToSell,
  gstinProblem,
  type InclusiveTax,
  isStateCode,
  lineOfferSaving,
  needsBuyerDetails,
  pickGstRate,
  planOffers,
  pointsValue,
  returnRefundSplit,
  type PosTransactionInput,
  quantityProblem,
  rateForLine,
  resolveSupply,
  roundBill,
  roundMoney,
  saleLineAmount,
  selectPrice,
  shareByWeight,
  type Supply,
  supplyLineTax,
  taxSituationOf,
} from "shared";
import type { RefundParts, SnapCoupon, SnapCustomer, SnapGstRate, SnapItem, SnapOffer, SnapPaymentMethod, SnapPrice, TillSnapshot } from "./types";

const D = (v: DecimalInput) => new Decimal(v);
const ZERO = new Decimal(0);

export type ApprovalKind = "price_change" | "discount" | "bill_discount" | "return_without_bill";

// ---- The bill being made (saved on every change, pos-offline §6) ----

export interface DraftLine {
  key: string;
  itemId: string;
  unitId: string;
  quantity: string;
  barcode: string | null;
  /** A price typed by the cashier; null = the list price. */
  priceOverride: string | null;
  /** Manual discount in percent. */
  discountPercent: string;
  approvalToken?: string;
  approvedBy?: string;
  /** Serial-numbered items: the serials scanned, separated by commas or spaces. */
  serials?: string;
  /** Plan 11 C1: who sold this line, when not the bill's salesperson. */
  salesStaffId?: string | null;
  /** Plan 11 part 2: a line of the customer order being collected, sold at its agreed price. */
  orderLineId?: string | null;
  agreedPrice?: string | null;
}

/** Plan 11 B4 (decision 46): where and when to deliver the sale. */
export interface DraftDelivery {
  name: string;
  address: string;
  phone: string;
  /** YYYY-MM-DD, or empty. */
  deliverOn: string;
  remarks: string;
  /** Plan 08 G1: the state the goods go to (place of supply); empty = the store's state. */
  stateCode?: string;
  /** Audit 4 (T2): delivered to someone else on the buyer's behalf: the buyer's own state is the place of supply. */
  forOther?: boolean;
}

/** Plan 08 G4, G5: the buyer written on the bill: a GSTIN makes it a business tax invoice. */
export interface DraftBuyer {
  gstin: string;
  name: string;
  address: string;
  stateCode: string;
}

/** The serial numbers typed on a line. */
export function serialList(text: string | undefined): string[] {
  return (text ?? "").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
}

/** A line coming back: against a line of the original bill, or without a bill. */
export type DraftReturnLine = DraftBillReturnLine | DraftNoBillReturnLine;

interface ReturnLineBase {
  key: string;
  itemId: string;
  unitId: string;
  code: string;
  name: string;
  /** Quantity coming back now. */
  quantity: string;
}

/**
 * Without the original bill (plan 11 A9, blueprint 09): priced from the till's
 * price list as the server does, or at a price the cashier types.
 */
export interface DraftNoBillReturnLine extends ReturnLineBase {
  originalLineId: null;
  /** A price typed by the cashier; null = the list price. */
  priceOverride: string | null;
}

export interface DraftBillReturnLine extends ReturnLineBase {
  originalLineId: string;
  /** Sold minus already returned. */
  maxQuantity: string;
  originalQuantity: string;
  originalPrice: string;
  /** Every discount on the original line, in rupees. */
  originalDiscount: string;
  originalLineTotal: string;
  gstRate: string;
  isFree: boolean;
}

export interface DraftCustomer {
  id: string | null;
  name: string;
  mobile: string | null;
  gstin: string | null;
  stateCode: string | null;
  /** Plan 08 G3: empty = from the GSTIN. */
  taxSituation?: string | null;
  customerGroupId: string | null;
  /** Added on the till (module 3 quick add): sent as newCustomer. */
  newClientId?: string;
  /** Plan 11 C10: optional at the till's quick add ("MM-DD" and the year, when known). */
  birthday?: string | null;
  birthYear?: number | null;
  anniversary?: string | null;
  anniversaryYear?: number | null;
}

export interface DraftPayment {
  methodId: string;
  amount: string;
  reference: string;
}

export interface DraftBill {
  id: string;
  startedAt: string;
  customer: DraftCustomer | null;
  couponCode: string | null;
  /** `approvedFor` is the bill the manager approved (billDiscountStamp); any change of lines or discount needs a new approval (audit 5). */
  billDiscount: { percent?: string; amount?: string; approvalToken?: string; approvedBy?: string; approvedFor?: string } | null;
  lines: DraftLine[];
  ret: {
    /** Null for a return without the original bill: it needs a manager and the connection (plan 11 A9). */
    originalBillId: string | null;
    originalNumber: string | null;
    /** The original bill's customer; null without a bill (the bill's own customer, F6, is used). */
    customerId: string | null;
    lines: DraftReturnLine[];
    reason: string | null;
    /** The original bill was paid (partly) on account, so the refund may go back on account (plan 07 §1a). */
    paidOnAccount?: boolean;
    /** Plan 08 G6: the original bill's GST (its place of supply decides IGST; a bill of supply has no tax). */
    supply?: { interState: boolean; noTax: boolean } | null;
    /** Without a bill: the manager's single-use approval (action return_without_bill). */
    approvalToken?: string;
    approvedBy?: string;
    /** Plan 13 (decision 16): the original bill's total, what its points and gift cards can give back, and whether everything left comes back now. */
    originalTotal?: string | null;
    refundParts?: RefundParts | null;
    allReturned?: boolean;
  } | null;
  payments: DraftPayment[];
  /** Given once when the cashier first presses Finish; the idempotency key (pos-offline §4). */
  clientId: string | null;
  /** Numbers taken from the till's counter for this bill (kept so a retry reuses them). */
  numbers: { sale?: string; ret?: string };
  /** When the cashier first pressed Finish (the time of sale). */
  soldAt?: string;
  /** Plan 11 C1: the salesperson of the bill (picked, typed or scanned). */
  salesStaffId?: string | null;
  /** Plan 11 B4: home delivery of the sale. */
  delivery?: DraftDelivery | null;
  /** Plan 08 G4, G5: the buyer's GSTIN (business tax invoice) or name, address and state. */
  buyer?: DraftBuyer | null;
  /** Plan 11 part 2: the customer order collected on this bill; its unused advance pays part of it. */
  order?: { id: string; number: string; advance: string; lines: { itemId: string; quantity: string }[] } | null;
  /** Plan 11 part 2: how much of the customer's credit (advances kept) pays part of the bill. */
  credit?: string | null;
  /** Plan 11 part 2: an alteration job whose charge is billed on this sale (handed back now when `deliver`). */
  alteration?: { jobId: string; number: string; charge: string; deliver: boolean } | null;
  /** Plan 13: loyalty points paid with (online only; the server checks the balance and the limits). */
  points?: { points: number; value: string } | null;
  /** Plan 13: gift cards paid with (online only), each with the amount taken from it. */
  giftCards?: DraftGiftCard[] | null;
  /**
   * Audit 5: a bill that needs the server was sent and no answer came, so it
   * may have been saved. The till asks the server (by clientId) before it can
   * be changed or finished again.
   */
  sendUncertain?: boolean;
}

/** Plan 13: a gift card paying part of the bill, as checked on the server a moment ago. */
export interface DraftGiftCard {
  number: string;
  /** Last four digits, for the screen and the offline copy. */
  masked: string;
  amount: string;
  /** The card's balance when it was checked. */
  balance: string;
}

export function emptyDraft(id: string, now: Date = new Date()): DraftBill {
  return { id, startedAt: now.toISOString(), customer: null, couponCode: null, billDiscount: null, lines: [], ret: null, payments: [], clientId: null, numbers: {} };
}

export function isDraftEmpty(d: DraftBill): boolean {
  return d.lines.length === 0 && !d.ret?.lines.length && !d.alteration;
}

/** The bill has a return without the original bill (online only, with a manager's approval). */
export function isNoBillReturn(d: DraftBill): boolean {
  return !!d.ret && d.ret.originalBillId === null;
}

// ---- Worked-out figures ----

export interface ComputedLine {
  lineNo: number;
  draftKey: string | null;
  item: SnapItem;
  unitId: string;
  unitCode: string;
  quantity: Decimal;
  mrp: Decimal | null;
  listPrice: Decimal;
  price: Decimal;
  manualPercent: Decimal;
  /** The cashier's percentage discount in rupees. */
  manualDiscount: Decimal;
  offer: SnapOffer | null;
  offerDiscount: Decimal;
  billShare: Decimal;
  /** Every discount on the line in rupees (manual + offer + bill share). */
  discountAmount: Decimal;
  amount: Decimal;
  gstRate: Decimal;
  tax: InclusiveTax;
  isFree: boolean;
  /** Plan 11 B4: the delivery charge line, added from the store's settings (not sent as a line). */
  isDelivery: boolean;
  /** Plan 11 part 2: the alteration charge line, added by the server from the job (not sent as a line). */
  isAlteration?: boolean;
  freeOfLineNo: number | null;
  returnOfLineId: string | null;
  /** Plan 11 C1: who sold the line (returns: the server keeps the original line's). */
  salesStaffId: string | null;
  problem: string | null;
}

export interface ComputedPart {
  lines: ComputedLine[];
  gross: Decimal;
  discount: Decimal;
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  exact: Decimal;
  total: Decimal;
  rounding: Decimal;
}

export interface NeededApproval {
  kind: ApprovalKind;
  /** Draft line key; null for the bill discount. */
  lineKey: string | null;
  reason: string;
}

export interface ComputedBill {
  sale: ComputedPart | null;
  ret: ComputedPart | null;
  net: Decimal;
  billDiscount: Decimal;
  billOffer: SnapOffer | null;
  coupon: SnapCoupon | null;
  interState: boolean;
  /** Plan 08 G1, G3, G4, G7: place of supply, invoice kind and whether tax is charged on the sale. */
  supply: Supply;
  problems: string[];
  approvals: NeededApproval[];
  /** Plan 11 B4: the delivery charge worked out (zero at or above "free above"); null without delivery. */
  delivery: { charge: Decimal } | null;
  /** Plan 11 B3: each offer used on the sale and what it saves. */
  offers: { offer: SnapOffer; saving: Decimal }[];
  /** Plan 11 part 2: the order's advance and the customer's credit used on the bill. */
  credit: Decimal;
  /** Plan 13: points and gift cards paying part of the sale. */
  pointsPaid: Decimal;
  giftCardsPaid: Decimal;
  /** Plan 13 (decision 16): what a return gives back in points and onto gift cards (the till refunds the rest). */
  back: ReturnBack | null;
  /** What is left to pay (or refund) with the till's payment methods: net less credit, points and gift cards; a return less what goes back by itself. */
  due: Decimal;
}

/** Plan 13: points and gift card money going back on a return, worked out as the server will. */
export interface ReturnBack {
  points: number;
  pointsValue: Decimal;
  giftCards: { key: string; number: string; amount: Decimal }[];
  /** Points value plus gift card money (positive). */
  total: Decimal;
}

export interface PricingContext {
  snapshot: TillSnapshot;
  /** Indian business date of the sale (rule 15). */
  date: string;
  /**
   * Audit 5: coupon uses by this till's bills that the saved copy does not count
   * yet (waiting to be sent, or sent after the last refresh), by coupon code.
   */
  couponUses?: Record<string, number>;
}

/**
 * What a manager's bill-discount approval is for: the lines and the discount
 * typed. A change of either makes the approval stale, so the token sent always
 * matches the discount the manager saw (the server compares the amount).
 */
export function billDiscountStamp(d: Pick<DraftBill, "lines" | "billDiscount">): string {
  const lines = d.lines.map((l) => [l.itemId, l.unitId, l.quantity, l.priceOverride ?? "", l.discountPercent || "0"].join(":")).join("|");
  return `${d.billDiscount?.amount ?? ""}/${d.billDiscount?.percent ?? ""}/${lines}`;
}

/** The bill discount's approval token when it is still for this bill, else undefined. */
export function billDiscountToken(d: Pick<DraftBill, "lines" | "billDiscount">): string | undefined {
  const bd = d.billDiscount;
  return bd?.approvalToken && bd.approvedFor === billDiscountStamp(d) ? bd.approvalToken : undefined;
}

// ---- Look-up maps (audit 5: a slow till with 30,000 items and 40,000 prices) ----

interface SnapshotIndex {
  items: SnapItem[];
  prices: SnapPrice[];
  itemCount: number;
  priceCount: number;
  byId: Map<string, SnapItem>;
  /** Barcode → the first active item carrying it (as the scan loop found it). */
  byBarcode: Map<string, { item: SnapItem; unitId: string }>;
  /** Upper-case code → the first active item with it. */
  byCode: Map<string, SnapItem>;
  pricesByItem: Map<string, SnapPrice[]>;
  /** Active items with their name and code in lower case, in snapshot order. */
  search: { item: SnapItem; name: string; code: string }[];
}

const indexes = new WeakMap<TillSnapshot, SnapshotIndex>();

/** The look-up maps of a snapshot, built once (again only if its items or prices were replaced). */
function indexOf(snapshot: TillSnapshot): SnapshotIndex {
  const cached = indexes.get(snapshot);
  if (cached && cached.items === snapshot.items && cached.prices === snapshot.prices && cached.itemCount === snapshot.items.length && cached.priceCount === snapshot.prices.length) return cached;
  const byId = new Map<string, SnapItem>();
  const byBarcode = new Map<string, { item: SnapItem; unitId: string }>();
  const byCode = new Map<string, SnapItem>();
  const search: SnapshotIndex["search"] = [];
  for (const item of snapshot.items) {
    if (!byId.has(item.id)) byId.set(item.id, item);
    if (!item.active) continue;
    for (const b of item.barcodes) if (!byBarcode.has(b.code)) byBarcode.set(b.code, { item, unitId: b.unitId ?? item.baseUnitId });
    const code = item.code.toUpperCase();
    if (!byCode.has(code)) byCode.set(code, item);
    search.push({ item, name: item.name.toLowerCase(), code: item.code.toLowerCase() });
  }
  const pricesByItem = new Map<string, SnapPrice[]>();
  for (const p of snapshot.prices) {
    const list = pricesByItem.get(p.itemId);
    if (list) list.push(p);
    else pricesByItem.set(p.itemId, [p]);
  }
  const index = { items: snapshot.items, prices: snapshot.prices, itemCount: snapshot.items.length, priceCount: snapshot.prices.length, byId, byBarcode, byCode, pricesByItem, search };
  indexes.set(snapshot, index);
  return index;
}

// ---- Look-ups in the snapshot ----

export function findItem(snapshot: TillSnapshot, itemId: string): SnapItem | undefined {
  return indexOf(snapshot).byId.get(itemId);
}

/** A scanned code: a barcode (item + its unit) first, then an exact item code. */
export function scan(snapshot: TillSnapshot, code: string): { item: SnapItem; unitId: string; barcode: string | null } | null {
  const c = code.trim();
  if (!c) return null;
  const index = indexOf(snapshot);
  const hit = index.byBarcode.get(c);
  if (hit) return { item: hit.item, unitId: hit.unitId, barcode: c };
  const byCode = index.byCode.get(c.toUpperCase());
  return byCode ? { item: byCode, unitId: byCode.baseUnitId, barcode: null } : null;
}

/** Name or code search for the pick list. Digits only (a barcode or code being typed) look at codes only. */
export function searchItems(snapshot: TillSnapshot, text: string, limit = 20): SnapItem[] {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const digitsOnly = words.every((w) => /^\d+$/.test(w));
  const out: SnapItem[] = [];
  for (const s of indexOf(snapshot).search) {
    if (words.every((w) => s.code.includes(w) || (!digitsOnly && s.name.includes(w)))) {
      out.push(s.item);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function findCustomerByMobile(snapshot: TillSnapshot, mobile: string): SnapCustomer | undefined {
  const m = mobile.replace(/\D/g, "");
  return snapshot.customers.find((c) => c.mobile === m && c.status !== "off");
}

/** The list price for a line from the till's price list (module 2 rules), or null. */
export function listPriceFor(snapshot: TillSnapshot, item: SnapItem, unitId: string, quantity: DecimalInput, customerId: string | null, date: string): Decimal | null {
  const till = snapshot.till;
  const lists = [{ id: till.priceListId, pricesPerUnit: till.pricesPerUnit }, ...(till.fallbackPriceList ? [till.fallbackPriceList] : [])];
  // The till's own list first; the default selling list only when the item has no price there.
  for (const list of lists) {
    const rows = (indexOf(snapshot).pricesByItem.get(item.id) ?? []).filter((p) => p.priceListId === list.id);
    const candidates = rows.map((r) => ({ id: r.id, price: r.price, unitId: r.unitId, startDate: r.startDate, endDate: r.endDate, customerId: r.customerId, supplierId: null, batchId: r.batchId, packSize: r.packSize }));
    const chosen = selectPrice(candidates, { date, unitId, quantity: D(quantity).toString(), customerId, batchId: null });
    if (!chosen) continue;
    const lineUnit = item.units.find((u) => u.unitId === unitId);
    const priceUnit = item.units.find((u) => u.unitId === chosen.unitId);
    return rateForLine({ price: chosen.price, unitId: chosen.unitId }, { unitId, unitFactor: lineUnit?.factor ?? "1" }, priceUnit?.factor ?? "1", list.pricesPerUnit);
  }
  return null;
}

/**
 * GST rate (plan 08 G2): longest HSN match (8, 6, 4 digits), latest start on
 * or before the date and, for price-banded codes, the band of the selling price
 * per unit (GST included); the same shared rule as the server.
 */
export function gstRateFor(rates: SnapGstRate[], hsnCode: string | null, date: string, unitPrice?: DecimalInput | null): SnapGstRate | null {
  // Till prices include GST (decision L7: the band is on the value before GST).
  return pickGstRate(rates, hsnCode, date, unitPrice, { gstIncluded: true });
}

/** Plan 08 G1, G3, G4: the place of supply and invoice kind of the sale, as the server works them out. */
export function supplyFor(snapshot: TillSnapshot, draft: Pick<DraftBill, "customer" | "buyer" | "delivery">): Supply {
  const till = snapshot.till;
  const sellerState = till.gst?.sellerState ?? till.store.stateCode ?? till.company.stateCode;
  const customer = draft.customer;
  const typed = draft.buyer?.gstin?.trim().toUpperCase() || null;
  const own = !typed && customer?.gstin && taxSituationOf(customer.gstin, customer.taxSituation) !== "unregistered" ? customer.gstin : null;
  return resolveSupply({
    sellerState,
    scheme: till.gst?.scheme ?? "regular",
    buyerGstin: typed ?? own,
    buyerState: draft.buyer?.stateCode || null,
    deliveryState: draft.delivery?.stateCode || null,
    deliveredToOther: !!draft.delivery?.forOther,
    sezUnderLut: !!till.gst?.sezUnderLut,
    taxSituation: typed && typed !== customer?.gstin ? null : (customer?.taxSituation ?? null),
  });
}

/** What is wrong with the buyer typed at the till; null when it can go on the bill. */
export function buyerProblem(b: DraftBuyer): string | null {
  if (b.gstin.trim()) {
    const p = gstinProblem(b.gstin, isStateCode);
    if (p) return p;
    if (!b.name.trim() || !b.address.trim()) return "A business invoice needs the buyer's name and address";
  }
  if (b.stateCode && !isStateCode(b.stateCode)) return "Choose the buyer's state";
  return null;
}

/** A coupon typed at the till, checked as the server does (blueprint 04 §5). */
export function couponProblem(c: SnapCoupon | undefined, code: string, date: string, customerId: string | null, usedOnTill = 0): string | null {
  if (!c) return `Coupon ${code} not found`;
  if (c.startDate > date || (c.endDate && c.endDate < date)) return `Coupon ${c.code} is not valid today`;
  // Audit 5: uses by this till's bills not yet counted in the saved copy count too (offline).
  if (c.maxUses != null && c.usedCount + usedOnTill >= c.maxUses) return `Coupon ${c.code} has been used up`;
  if (c.customerId && c.customerId !== customerId) return `Coupon ${c.code} belongs to another customer`;
  return null;
}

/** Offers in force for this bill: date, store, customer group, coupon (decision 17). */
export function activeOffers(offers: SnapOffer[], ctx: { date: string; storeId: string; customerGroupId: string | null; couponOfferId: string | null }): SnapOffer[] {
  return offers.filter(
    (o) =>
      o.active &&
      o.startDate <= ctx.date &&
      (!o.endDate || o.endDate >= ctx.date) &&
      (o.storeIds.length === 0 || o.storeIds.includes(ctx.storeId)) &&
      (!o.customerGroupId || o.customerGroupId === ctx.customerGroupId) &&
      (!o.couponOnly || o.id === ctx.couponOfferId),
  );
}

export function offerCovers(o: SnapOffer, item: SnapItem): boolean {
  switch (o.appliesTo) {
    case "items":
      return o.targetIds.includes(item.id) || (!!item.parentItemId && o.targetIds.includes(item.parentItemId));
    case "groups":
      return o.targetIds.some((g) => item.itemGroup.path.includes(`/${g}/`) || item.itemGroup.id === g);
    case "brands":
      return !!item.brandId && o.targetIds.includes(item.brandId);
    default:
      return false;
  }
}

function offerInput(o: SnapOffer) {
  return { kind: o.kind, value: o.value, buyQuantity: o.buyQuantity, freeQuantity: o.freeQuantity, minQuantity: o.minQuantity, minAmount: o.minAmount };
}

/** What a "buy X, get Y" offer gives (plan 11 B3). */
interface FreeItem {
  item: SnapItem;
  /** One unit's worth: its price, else its MRP. */
  value: Decimal;
  gstRate: Decimal;
}

/** The free item of a buy_get offer, as the server works it out; null when it cannot be given (the offer is then not used). */
export function freeItemFor(snapshot: TillSnapshot, offer: SnapOffer, customerId: string | null, date: string): FreeItem | null {
  const item = offer.freeItemId ? findItem(snapshot, offer.freeItemId) : undefined;
  if (!item || !item.active) return null;
  const value = listPriceFor(snapshot, item, item.baseUnitId, "1", customerId, date) ?? (item.mrp ? D(item.mrp) : null);
  if (!value || value.lte(0)) return null;
  const rate = gstRateFor(snapshot.gstRates, item.hsnCode, date);
  return { item, value, gstRate: D(rate?.rate ?? "0") };
}

/** The offers used on a sale and what each saves: rupees off its lines, and its free lines at their list price. */
export function offersUsed(lines: ComputedLine[]): { offer: SnapOffer; saving: Decimal }[] {
  const used = new Map<string, { offer: SnapOffer; saving: Decimal }>();
  for (const l of lines) {
    if (!l.offer) continue;
    const saving = l.isFree ? roundMoney(l.listPrice.mul(l.quantity)) : l.offerDiscount;
    const u = used.get(l.offer.id) ?? { offer: l.offer, saving: ZERO };
    used.set(l.offer.id, { offer: u.offer, saving: u.saving.add(saving) });
  }
  return [...used.values()].filter((u) => u.saving.gt(0));
}

export function bestBillOffer(offers: SnapOffer[], amount: Decimal): { offer: SnapOffer; saving: Decimal } | null {
  const candidates = offers.filter((o) => o.appliesTo === "bill").map((o) => ({ offer: o, code: o.code, priority: o.priority, saving: lineOfferSaving(offerInput(o), { quantity: "1", price: amount }) }));
  const best = bestOffer(candidates);
  return best ? { offer: best.offer, saving: D(best.saving) } : null;
}

/** IGST for the sale (plan 08 G1): see supplyFor. */
export function isInterState(snapshot: TillSnapshot, customer: DraftCustomer | null): boolean {
  return supplyFor(snapshot, { customer, buyer: null, delivery: null }).interState;
}

// ---- Working out a bill ----

function partTotals(lines: ComputedLine[]): ComputedPart {
  let gross = ZERO;
  let discount = ZERO;
  let taxable = ZERO;
  let cgst = ZERO;
  let sgst = ZERO;
  let igst = ZERO;
  let exact = ZERO;
  for (const l of lines) {
    gross = gross.add(roundMoney(l.price.mul(l.quantity)));
    discount = discount.add(l.quantity.isNegative() ? l.discountAmount.neg() : l.discountAmount);
    taxable = taxable.add(l.tax.taxable);
    cgst = cgst.add(l.tax.cgst);
    sgst = sgst.add(l.tax.sgst);
    igst = igst.add(l.tax.igst);
    exact = exact.add(l.amount);
  }
  const { rounded, adjustment } = roundBill(exact);
  return { lines, gross, discount, taxable, cgst, sgst, igst, exact, total: rounded, rounding: adjustment };
}

function blankTax(): InclusiveTax {
  return { taxable: ZERO, cgst: ZERO, sgst: ZERO, igst: ZERO, tax: ZERO };
}

/**
 * A line coming back without the original bill, worked out as POST /pos/bills
 * does (plan 11 A9): the till's list price (no customer price) or the typed
 * price, today's GST rate, no discounts; the amount is price × quantity.
 */
function noBillReturnLine(rl: DraftNoBillReturnLine, lineNo: number, snapshot: TillSnapshot, date: string, supply: Pick<Supply, "interState" | "noTax">): ComputedLine {
  const known = findItem(snapshot, rl.itemId);
  const item: SnapItem = known ?? { id: rl.itemId, code: rl.code, name: rl.name, active: false, isStockItem: true, trackBatches: false, trackSerials: false, hsnCode: null, mrp: null, maxDiscountPercent: "0", baseUnitId: rl.unitId, parentItemId: null, brandId: null, itemGroup: { id: "", path: "" }, units: [], barcodes: [] };
  const unit = item.units.find((u) => u.unitId === rl.unitId);
  let quantity = ZERO;
  try {
    quantity = D(rl.quantity || "0");
  } catch {
    // stays zero
  }
  let problem: string | null = quantity.lte(0) ? "Quantity must be above zero" : quantityProblem(rl.quantity, { code: unit?.code ?? "", allowsFractions: unit?.allowsFractions ?? false });
  if (!known || !item.active) problem = problem ?? `${rl.code} can no longer be sold, so it cannot come back without a bill`;
  const list = known ? listPriceFor(snapshot, item, rl.unitId, quantity.gt(0) ? quantity : "1", null, date) : null;
  if (list === null) problem = problem ?? `${item.code} has no price in the till's price list`;
  let price = list ?? ZERO;
  if (rl.priceOverride !== null && rl.priceOverride !== "") {
    try {
      price = roundMoney(rl.priceOverride);
    } catch {
      problem = problem ?? "The price is not a number";
    }
  }
  const rate = gstRateFor(snapshot.gstRates, item.hsnCode, date, price.div(D(unit?.factor ?? "1")));
  if (!rate) problem = problem ?? (item.hsnCode ? `No GST rate is set for HSN ${item.hsnCode} (${item.code})` : `${item.code} has no HSN code, so its GST rate is not known`);
  const gstRate = supply.noTax ? ZERO : D(rate?.rate ?? "0");
  const amount = quantity.gt(0) ? roundMoney(price.mul(quantity)).neg() : ZERO;
  const mrp = unit?.mrp ? D(unit.mrp) : item.mrp ? D(item.mrp).mul(D(unit?.factor ?? "1")) : null;
  return {
    lineNo,
    draftKey: rl.key,
    item,
    unitId: rl.unitId,
    unitCode: unit?.code ?? "",
    quantity: quantity.neg(),
    mrp,
    listPrice: list ?? ZERO,
    price,
    manualPercent: ZERO,
    manualDiscount: ZERO,
    offer: null,
    offerDiscount: ZERO,
    billShare: ZERO,
    discountAmount: ZERO,
    amount,
    gstRate,
    tax: supplyLineTax(amount, gstRate, supply),
    isFree: false,
    isDelivery: false,
    freeOfLineNo: null,
    returnOfLineId: null,
    salesStaffId: null,
    problem,
  };
}

/** Works out the whole bill exactly as POST /pos/bills will (plan 06 §4–§5). */
export function priceBill(draft: DraftBill, ctx: PricingContext): ComputedBill {
  const { snapshot, date } = ctx;
  const till = snapshot.till;
  const problems: string[] = [];
  const approvals: NeededApproval[] = [];
  const customer = draft.customer;
  const supply = supplyFor(snapshot, draft);
  const interState = supply.interState;
  const walkIn = till.walkInCustomerId ? snapshot.customers.find((c) => c.id === till.walkInCustomerId) : undefined;
  const groupId = customer ? customer.customerGroupId : (walkIn?.customerGroupId ?? null);
  const customerIdForPrice = customer?.id ?? null;
  const cashierLimit = D(till.cashierDiscountPercent);

  let coupon: SnapCoupon | null = null;
  if (draft.couponCode && draft.lines.length) {
    const code = draft.couponCode.trim().toUpperCase();
    const found = snapshot.coupons.find((c) => c.code === code);
    const problem = couponProblem(found, code, date, customer?.id ?? till.walkInCustomerId, ctx.couponUses?.[code] ?? 0);
    if (problem) problems.push(problem);
    else coupon = found ?? null;
  }
  const offers = activeOffers(snapshot.offers, { date, storeId: till.store.id, customerGroupId: groupId, couponOfferId: coupon?.offerId ?? null });

  // ---- Sale lines ----
  let sale: ComputedPart | null = null;
  let billDiscount = ZERO;
  let billOffer: SnapOffer | null = null;
  let delivery: { charge: Decimal } | null = null;
  if (draft.lines.length || draft.alteration) {
    // 1. Price, GST and the cashier's discount of each line.
    const priced: { line: ComputedLine; covering: SnapOffer[] }[] = [];
    draft.lines.forEach((dl, index) => {
      const lineNo = index + 1;
      const item = findItem(snapshot, dl.itemId);
      if (!item) {
        problems.push(`Line ${lineNo}: the item is no longer in the till's list`);
        return;
      }
      const unit = item.units.find((u) => u.unitId === dl.unitId) ?? item.units.find((u) => u.unitId === item.baseUnitId);
      const factor = D(unit?.factor ?? "1");
      let quantity: Decimal;
      try {
        quantity = D(dl.quantity);
      } catch {
        quantity = ZERO;
      }
      let problem: string | null = null;
      const qtyProblem = quantity.lte(0) ? "Quantity must be above zero" : quantityProblem(dl.quantity, { code: unit?.code ?? "", allowsFractions: unit?.allowsFractions ?? false });
      if (qtyProblem) problem = qtyProblem;
      if (!item.active) problem = `${item.code} can no longer be sold`;
      if (item.isStockItem && item.trackSerials && !problem && !quantity.eq(serialList(dl.serials).length)) problem = `scan the ${quantity.toString()} serial number(s) of ${item.code}`;
      const mrp = unit?.mrp ? D(unit.mrp) : item.mrp ? D(item.mrp).mul(factor) : null;
      // Plan 11 part 2: an ordered line is sold at the price agreed on the order (no list price, offers or approvals).
      const agreed = dl.orderLineId && dl.agreedPrice != null ? D(dl.agreedPrice) : null;
      const list = agreed ?? listPriceFor(snapshot, item, dl.unitId, quantity.gt(0) ? quantity : "1", customerIdForPrice, date);
      if (list === null && !problem) problem = `${item.code} has no price in the till's price list`;
      const listPrice = list ?? ZERO;
      const price = agreed ?? (dl.priceOverride !== null && dl.priceOverride !== "" ? roundMoney(dl.priceOverride) : listPrice);
      const priceChanged = !price.eq(listPrice);
      const rate = gstRateFor(snapshot.gstRates, item.hsnCode, date);
      if (!rate && !problem) problem = item.hsnCode ? `No GST rate is set for HSN ${item.hsnCode} (${item.code})` : `${item.code} has no HSN code, so its GST rate is not known`;
      const gstRate = D(rate?.rate ?? "0");
      // Offers apply to the list price; a typed price switches them off for the line (blueprint 04).
      const covering = !priceChanged && !agreed && quantity.gt(0) ? offers.filter((o) => o.appliesTo !== "bill" && offerCovers(o, item)) : [];
      let manualPercent = ZERO;
      try {
        manualPercent = D(dl.discountPercent || "0");
      } catch {
        problem = problem ?? "The discount is not a number";
      }
      if (agreed && manualPercent.gt(0)) problem = problem ?? "an ordered item is sold at the agreed price, without a discount";
      if (priceChanged && !till.allowPriceChange && !dl.approvalToken) approvals.push({ kind: "price_change", lineKey: dl.key, reason: `${item.code}: a price change needs a manager` });
      const verdict = checkDiscount({ listPrice, price, mrp, manualDiscountPercent: manualPercent, itemMaxPercent: item.maxDiscountPercent, cashierLimitPercent: cashierLimit, approved: !!dl.approvalToken });
      if (!verdict.ok) {
        if (verdict.needsApproval) approvals.push({ kind: "discount", lineKey: dl.key, reason: `${item.code}: ${verdict.reason}` });
        else problem = problem ?? verdict.reason;
      }
      const line: ComputedLine = {
        lineNo,
        draftKey: dl.key,
        item,
        unitId: dl.unitId,
        unitCode: unit?.code ?? "",
        quantity,
        mrp,
        listPrice,
        price,
        manualPercent,
        manualDiscount: ZERO,
        offer: null,
        offerDiscount: ZERO,
        billShare: ZERO,
        discountAmount: ZERO,
        amount: ZERO,
        gstRate,
        tax: blankTax(),
        isFree: false,
        isDelivery: false,
        freeOfLineNo: null,
        returnOfLineId: null,
        salesStaffId: dl.salesStaffId ?? draft.salesStaffId ?? null,
        problem,
      };
      priced.push({ line, covering });
    });

    // 2. The offers of the whole bill, chosen as the server does (decision 17; plan 11 B3).
    const freeItems = new Map<string, FreeItem | null>();
    for (const o of offers) if (o.kind === "buy_get" && priced.some((p) => p.covering.includes(o))) freeItems.set(o.id, freeItemFor(snapshot, o, customerIdForPrice, date));
    const planned = new Map(offers.map((o) => [o.id, { ...offerInput(o), id: o.id, code: o.code, priority: o.priority, setQuantity: o.setQuantity ?? null, setPrice: o.setPrice ?? null, cheapestFree: !!o.cheapestFree, freeUnitValue: freeItems.get(o.id)?.value ?? null, snap: o }]));
    const plan = planOffers(priced.map((p) => ({ lineNo: p.line.lineNo, quantity: p.line.quantity, price: p.line.price, offers: p.covering.map((o) => planned.get(o.id)!), countable: p.line.manualPercent.isZero() })));

    // 3. Amounts and free lines.
    const lines: ComputedLine[] = [];
    for (const { line } of priced) {
      const chosen = plan.lines.get(line.lineNo) ?? null;
      const offerDiscount = chosen?.discount ?? ZERO;
      line.offer = chosen?.offer.snap ?? null;
      line.offerDiscount = offerDiscount;
      if (line.quantity.gt(0)) {
        try {
          const r = saleLineAmount({ quantity: line.quantity, price: line.price, discountPercent: line.manualPercent, discountAmount: offerDiscount });
          line.amount = r.amount;
          line.discountAmount = r.discount;
          line.manualDiscount = r.discount.sub(offerDiscount);
        } catch (e) {
          line.problem = line.problem ?? (e instanceof Error ? e.message : String(e));
        }
      }
      if (line.problem) problems.push(`Line ${line.lineNo}: ${line.problem}`);
      lines.push(line);
      if (chosen && chosen.freeQuantity.gt(0)) {
        lines.push({ ...line, lineNo: 1000 + line.lineNo, draftKey: null, quantity: chosen.freeQuantity, price: ZERO, manualPercent: ZERO, manualDiscount: ZERO, offerDiscount: ZERO, discountAmount: ZERO, amount: ZERO, isFree: true, freeOfLineNo: line.lineNo, problem: null });
      }
    }
    // Buy X, get Y: the other item at ₹0 after the first line that counted.
    for (const f of plan.freeItems) {
      const info = freeItems.get(f.offer.id);
      const parent = lines.find((l) => l.lineNo === f.ofLineNo);
      if (!info || !parent) continue;
      const free: ComputedLine = {
        lineNo: 1000 + f.ofLineNo,
        draftKey: null,
        item: info.item,
        unitId: info.item.baseUnitId,
        unitCode: info.item.units.find((u) => u.unitId === info.item.baseUnitId)?.code ?? "",
        quantity: f.quantity,
        mrp: info.item.mrp ? D(info.item.mrp) : null,
        listPrice: info.value,
        price: ZERO,
        manualPercent: ZERO,
        manualDiscount: ZERO,
        offer: f.offer.snap,
        offerDiscount: ZERO,
        billShare: ZERO,
        discountAmount: ZERO,
        amount: ZERO,
        gstRate: info.gstRate,
        tax: blankTax(),
        isFree: true,
        isDelivery: false,
        freeOfLineNo: f.ofLineNo,
        returnOfLineId: null,
        salesStaffId: parent.salesStaffId,
        problem: null,
      };
      lines.splice(lines.indexOf(parent) + 1, 0, free);
    }

    // Whole-bill discount: typed (approval above the cashier's limit) or the best bill offer.
    const paid = lines.filter((l) => !l.isFree);
    const base = paid.reduce((s, l) => s.add(l.amount), ZERO);
    const bd = draft.billDiscount;
    const manual = !!bd && ((!!bd.amount && D(bd.amount).gt(0)) || (!!bd.percent && D(bd.percent).gt(0)));
    if (manual && bd) {
      billDiscount = bd.amount && D(bd.amount).gt(0) ? roundMoney(bd.amount) : roundMoney(base.mul(D(bd.percent!)).div(100));
      const pct = base.gt(0) ? billDiscount.div(base).mul(100) : ZERO;
      // Audit 5: an approval given for other lines or another discount is stale; the manager is asked again.
      if (pct.gt(cashierLimit) && !billDiscountToken(draft)) approvals.push({ kind: "bill_discount", lineKey: null, reason: `A bill discount of ₹${billDiscount.toFixed(2)} is above the cashier's limit of ${cashierLimit.toFixed(2)}%` });
    } else if (!draft.order) {
      // A bill that collects an order keeps the agreed prices: no bill offer (as the server).
      const best = bestBillOffer(offers, base);
      if (best) {
        billDiscount = best.saving;
        billOffer = best.offer;
      }
    }
    if (billDiscount.gt(base)) {
      problems.push("The bill discount is more than the bill");
    } else if (billDiscount.gt(0)) {
      const shares = shareByWeight(billDiscount, paid.map((l) => l.amount));
      paid.forEach((l, i) => {
        l.billShare = shares[i];
        l.amount = l.amount.sub(shares[i]);
        l.discountAmount = l.discountAmount.add(shares[i]);
      });
      if (manual) {
        for (const l of paid) {
          if (l.offerDiscount.eq(0) && effectiveDiscountPercent(l.listPrice, l.quantity, l.amount).gt(D(l.item.maxDiscountPercent))) {
            problems.push(`${l.item.code}: the bill discount takes it above its maximum discount of ${D(l.item.maxDiscountPercent).toFixed(2)}%`);
          }
        }
      }
    }

    // Home delivery (plan 11 B4, decision 47): the store's charge as a service line, none at or above "free above".
    if (draft.delivery) {
      const goods = lines.reduce((s, l) => s.add(l.amount), ZERO);
      const charge = deliveryChargeFor(goods, till.delivery?.charge ?? "0", till.delivery?.freeAbove ?? null);
      if (charge.gt(0)) {
        const item = till.delivery?.itemId ? findItem(snapshot, till.delivery.itemId) : undefined;
        if (!item) problems.push("The delivery charge item is not set up; ask the owner to choose it in the till settings");
        else {
          lines.push({
            lineNo: draft.lines.length + 1,
            draftKey: null,
            item,
            unitId: item.baseUnitId,
            unitCode: item.units.find((u) => u.unitId === item.baseUnitId)?.code ?? "",
            quantity: D(1),
            mrp: null,
            listPrice: charge,
            price: charge,
            manualPercent: ZERO,
            manualDiscount: ZERO,
            offer: null,
            offerDiscount: ZERO,
            billShare: ZERO,
            discountAmount: ZERO,
            amount: charge,
            // Set with the goods' rates below (audit 4, T4).
            gstRate: ZERO,
            tax: blankTax(),
            isFree: false,
            isDelivery: true,
            freeOfLineNo: null,
            returnOfLineId: null,
            salesStaffId: null,
            problem: null,
          });
        }
      }
      delivery = { charge };
    }
    // Plan 11 part 2: the alteration charge as a service line after every other line (as the server adds it).
    if (draft.alteration) {
      const item = till.alterationItemId ? findItem(snapshot, till.alterationItemId) : undefined;
      const rate = item ? gstRateFor(snapshot.gstRates, item.hsnCode, date) : null;
      if (!item) problems.push("The alteration charge item is not set up; ask the owner to choose it in the till settings");
      else if (!rate) problems.push(`No GST rate is set for the alteration charge (${item.code})`);
      else {
        const charge = roundMoney(draft.alteration.charge);
        lines.push({
          lineNo: Math.max(0, ...lines.filter((l) => l.lineNo < 1000).map((l) => l.lineNo)) + 1,
          draftKey: null,
          item,
          unitId: item.baseUnitId,
          unitCode: item.units.find((u) => u.unitId === item.baseUnitId)?.code ?? "",
          quantity: D(1),
          mrp: null,
          listPrice: charge,
          price: charge,
          manualPercent: ZERO,
          manualDiscount: ZERO,
          offer: null,
          offerDiscount: ZERO,
          billShare: ZERO,
          discountAmount: ZERO,
          amount: charge,
          gstRate: D(rate.rate),
          tax: blankTax(),
          isFree: false,
          isDelivery: false,
          isAlteration: true,
          freeOfLineNo: null,
          returnOfLineId: null,
          salesStaffId: null,
          problem: null,
        });
      }
    }
    // Plan 08 G2, G7: each line's rate on its final amount (price bands); no tax on a bill of supply or to an exempt buyer.
    // Audit 4 (T12; CBIC circular 92/11/2019): free pieces of the same item share the price (its band); a free
    // other item makes a mixed supply at the higher rate. (T4) Delivery takes the goods' rate, the highest.
    const factorOf = (l: ComputedLine) => D(l.item.units.find((u) => u.unitId === l.unitId)?.factor ?? "1");
    for (const l of lines) {
      if (!l.isFree && !l.isDelivery && !l.problem && l.item.hsnCode) {
        const sameFree = lines.filter((f) => f.isFree && f.freeOfLineNo === l.lineNo && f.item.id === l.item.id).reduce((s, f) => s.add(f.quantity.mul(factorOf(f))), ZERO);
        const r = gstRateFor(snapshot.gstRates, l.item.hsnCode, date, bandUnitPrice(l.amount, l.quantity.mul(factorOf(l)).add(sameFree)));
        if (r) l.gstRate = D(r.rate);
      }
    }
    for (const l of lines.filter((x) => !x.isFree && !x.isDelivery)) {
      const free = lines.filter((f) => f.isFree && f.freeOfLineNo === l.lineNo);
      for (const f of free) if (f.item.id === l.item.id) f.gstRate = l.gstRate;
      l.gstRate = free.reduce((m, f) => Decimal.max(m, f.gstRate), l.gstRate);
    }
    const goodsRate = lines.filter((g) => !g.isDelivery && g.item.isStockItem !== false).reduce((m, g) => Decimal.max(m, g.gstRate), ZERO);
    for (const l of lines) {
      if (l.isDelivery) l.gstRate = goodsRate;
      if (supply.noTax) l.gstRate = ZERO;
      l.tax = supplyLineTax(l.amount, l.gstRate, supply);
    }
    sale = partTotals(lines);
    // Plan 08 G4, G5: the buyer's details a business invoice or a large consumer bill needs.
    const b = draft.buyer;
    if (supply.invoiceKind === "business" && b?.gstin.trim() && (!b.name.trim() || !b.address.trim())) problems.push("A business tax invoice needs the buyer's name and address");
    else if (supply.invoiceKind !== "business" && needsBuyerDetails(sale.taxable) && (!b?.name.trim() || !b?.address.trim() || !b?.stateCode)) {
      problems.push("A bill of ₹50,000 or more (taxable value) needs the buyer's name, address and state");
    }
    if (b?.gstin.trim()) {
      const p = gstinProblem(b.gstin, isStateCode);
      if (p) problems.push(p);
    }
  }

  // ---- Return lines: the original net price per unit (after all discounts) comes back ----
  let ret: ComputedPart | null = null;
  if (draft.ret?.lines.length) {
    const lines: ComputedLine[] = [];
    if (draft.ret.originalBillId === null && !draft.ret.approvalToken) approvals.push({ kind: "return_without_bill", lineKey: null, reason: "A return without the original bill needs a manager" });
    // Audit 4 (T8, rule 53(1A)(f)): a credit note to a walk-in customer carries their name (the state defaults to the shop's).
    const returnCustomer = draft.customer?.id ?? draft.ret.customerId;
    if (draft.ret.originalBillId && !draft.ret.supply?.noTax && (!returnCustomer || returnCustomer === snapshot.till.walkInCustomerId) && !draft.buyer?.name.trim()) problems.push("A credit note needs the customer's name: add it with \"Buyer GSTIN / details\"");
    draft.ret.lines.forEach((rl, index) => {
      const lineNo = index + 1;
      if (rl.originalLineId === null) {
        const line = noBillReturnLine(rl, lineNo, snapshot, date, supply);
        if (line.problem) problems.push(`${rl.code}: ${line.problem}`);
        if (line.quantity.lt(0)) lines.push(line);
        return;
      }
      const item: SnapItem = findItem(snapshot, rl.itemId) ?? {
        id: rl.itemId,
        code: rl.code,
        name: rl.name,
        active: false,
        isStockItem: true,
        trackBatches: false,
        trackSerials: false,
        hsnCode: null,
        mrp: null,
        maxDiscountPercent: "0",
        baseUnitId: rl.unitId,
        parentItemId: null,
        brandId: null,
        itemGroup: { id: "", path: "" },
        units: [],
        barcodes: [],
      };
      let quantity = ZERO;
      try {
        quantity = D(rl.quantity || "0");
      } catch {
        // stays zero
      }
      let problem: string | null = null;
      if (quantity.gt(D(rl.maxQuantity))) problem = `only ${rl.maxQuantity} left to return`;
      const amount = D(rl.originalQuantity).isZero() ? ZERO : roundMoney(D(rl.originalLineTotal).mul(quantity).div(D(rl.originalQuantity))).neg();
      const price = D(rl.originalPrice);
      const discountAmount = D(rl.originalQuantity).isZero() ? ZERO : roundMoney(D(rl.originalDiscount).mul(quantity).div(D(rl.originalQuantity)));
      const line: ComputedLine = {
        lineNo,
        draftKey: rl.key,
        item,
        unitId: rl.unitId,
        unitCode: item.units.find((u) => u.unitId === rl.unitId)?.code ?? "",
        quantity: quantity.neg(),
        mrp: null,
        listPrice: price,
        price,
        manualPercent: ZERO,
        manualDiscount: ZERO,
        offer: null,
        offerDiscount: ZERO,
        billShare: ZERO,
        discountAmount,
        amount,
        gstRate: D(rl.gstRate),
        tax: supplyLineTax(amount, rl.gstRate, draft.ret!.supply ?? { interState: false, noTax: false }),
        isFree: rl.isFree,
        isDelivery: false,
        freeOfLineNo: null,
        returnOfLineId: rl.originalLineId,
        salesStaffId: null,
        problem,
      };
      if (problem) problems.push(`${rl.code}: ${problem}`);
      if (quantity.gt(0)) lines.push(line);
    });
    if (lines.length) ret = partTotals(lines);
  }

  const net = (sale?.total ?? ZERO).add(ret?.total ?? ZERO);
  // Plan 11 part 2: the order's advance (up to the bill) and the customer's credit pay part of it.
  const payable = Decimal.max(net, 0);
  const advance = draft.order ? Decimal.min(D(draft.order.advance || "0"), payable) : ZERO;
  let credit = advance;
  if (draft.credit && D(draft.credit).gt(0)) {
    if (D(draft.credit).gt(payable.sub(advance))) problems.push("More credit is used than the bill");
    else credit = credit.add(D(draft.credit));
  }
  // Plan 13 (decision 16): a return of a bill paid with points or gift cards gives them back in proportion.
  let back: ReturnBack | null = null;
  const parts = draft.ret?.refundParts;
  if (ret && parts && draft.ret?.originalTotal && ret.total.lt(0)) {
    const split = returnRefundSplit({
      originalTotal: draft.ret.originalTotal,
      returnedBefore: parts.returnedTotal,
      thisReturn: ret.total.abs(),
      allReturned: !!draft.ret.allReturned,
      points: parts.points,
      pointValue: parts.pointValue,
      giftCards: parts.giftCards.map((g) => ({ key: g.key, paid: g.paid, refundedBefore: g.refundedBefore, usable: g.usable })),
    });
    const giftCards = split.giftCards.filter((g) => g.amount.gt(0)).map((g) => ({ key: g.key, number: parts.giftCards.find((c) => c.key === g.key)?.number ?? "", amount: g.amount }));
    const total = split.pointsValue.add(giftCards.reduce((s, g) => s.add(g.amount), ZERO));
    if (total.gt(0)) back = { points: split.points, pointsValue: split.pointsValue, giftCards, total };
  }
  // Plan 13: points and gift cards pay part of a sale (the server checks the balances and limits again).
  let pointsPaid = ZERO;
  let giftCardsPaid = ZERO;
  if (draft.points?.points || draft.giftCards?.length) {
    if (!sale) problems.push("Points and gift cards pay only for a sale");
    else {
      pointsPaid = draft.points?.points ? pointsValue(draft.points.points, till.loyalty?.pointValue ?? draft.points.value) : ZERO;
      giftCardsPaid = (draft.giftCards ?? []).reduce((s, g) => s.add(D(g.amount)), ZERO);
      const payable = Decimal.max(net, 0).sub(credit).add(back?.total ?? ZERO);
      if (pointsPaid.add(giftCardsPaid).gt(payable)) problems.push("Points and gift cards pay more than the bill; take some off in Pay");
      const share = till.loyalty ? roundMoney(Decimal.max(net, 0).mul(D(till.loyalty.maxSharePercent)).div(100)) : null;
      if (share && pointsPaid.gt(share)) problems.push(`At most ${D(till.loyalty!.maxSharePercent).toString()}% of the bill (₹${share.toFixed(2)}) can be paid with points; change the points in Pay`);
    }
  }
  return {
    sale,
    ret,
    net,
    billDiscount,
    billOffer,
    coupon,
    interState,
    supply,
    problems,
    approvals,
    delivery,
    offers: offersUsed(sale?.lines ?? []),
    credit,
    pointsPaid,
    giftCardsPaid,
    back,
    due: net.sub(credit).sub(pointsPaid).sub(giftCardsPaid).add(back?.total ?? ZERO),
  };
}

/** Plan 13: the bill uses points or gift cards, which need the connection. */
export function usesPointsOrCards(draft: DraftBill): boolean {
  return !!draft.points?.points || !!draft.giftCards?.length;
}

// ---- Payments ----

export interface PaymentCheck {
  paid: Decimal;
  change: Decimal;
  /** Still to pay (sale) or still to refund (return). */
  short: Decimal;
  problem: string | null;
}

/** The payment rules of blueprint 09 process 3 (plan 06 answer 5: no credit). */
export function checkPayments(net: Decimal, payments: DraftPayment[], methods: SnapPaymentMethod[]): PaymentCheck {
  const byId = new Map(methods.map((m) => [m.id, m]));
  const rows = payments.filter((p) => p.amount.trim() !== "");
  let problem: string | null = null;
  const parsed = rows.map((p) => {
    let amount = ZERO;
    try {
      amount = D(p.amount);
    } catch {
      problem = "An amount is not a number";
    }
    return { ...p, amount: net.isNegative() ? amount.abs().neg() : amount };
  });
  for (const p of parsed) {
    const m = byId.get(p.methodId);
    if (!m) problem = problem ?? "That payment method is not used on this till";
    else if (p.amount.isNegative() && !m.allowRefund) problem = problem ?? `${m.name} cannot be used for refunds`;
    else if (m.needsReference && !p.amount.isZero() && !p.reference.trim()) problem = problem ?? `${m.name} needs the approval code or reference`;
  }
  const paid = parsed.reduce((s, p) => s.add(p.amount), ZERO);
  if (net.gte(0)) {
    const usesCash = parsed.some((p) => byId.get(p.methodId)?.kind === "cash" && !p.amount.isZero());
    const over = paid.sub(net);
    if (over.gt(0) && !usesCash) problem = problem ?? "More than the bill was entered without cash; only cash can give change";
    return { paid, change: over.gt(0) && usesCash ? over : ZERO, short: over.lt(0) ? over.neg() : ZERO, problem };
  }
  const left = net.neg().sub(paid.neg());
  if (left.lt(0)) problem = problem ?? `The refund must be exactly ₹${net.neg().toFixed(2)}`;
  return { paid, change: ZERO, short: left.gt(0) ? left : ZERO, problem };
}

/** True when a non-zero payment uses an on-account method (customer pays later, plan 07 §1a). */
export function usesOnAccount(payments: DraftPayment[], methods: SnapPaymentMethod[]): boolean {
  const kinds = new Map(methods.map((m) => [m.id, m.kind]));
  return payments.some((p) => {
    if (kinds.get(p.methodId) !== "on_account" || p.amount.trim() === "") return false;
    try {
      return !D(p.amount).isZero();
    } catch {
      return false;
    }
  });
}

/** Whether the bill is for a named customer (not walk-in): on account needs one. */
export function hasNamedCustomer(draft: DraftBill, walkInCustomerId: string | null): boolean {
  if (draft.ret?.originalBillId) return draft.ret.customerId !== walkInCustomerId;
  return !!draft.customer;
}

/** Payments as sent: signed (refunds minus), zero rows dropped, at least one row. */
export function paymentsForServer(net: Decimal, payments: DraftPayment[], methods: SnapPaymentMethod[]): PosTransactionInput["payments"] {
  const out = payments
    .filter((p) => p.amount.trim() !== "" && !D(p.amount).isZero())
    .map((p) => {
      const amount = net.isNegative() ? D(p.amount).abs().neg() : D(p.amount);
      return { paymentMethodId: p.methodId, amount: amount.toFixed(2), reference: p.reference.trim() || null };
    });
  if (out.length) return out;
  const cash = methods.find((m) => m.kind === "cash" && m.isDefault) ?? methods.find((m) => m.kind === "cash") ?? methods[0];
  return [{ paymentMethodId: cash.id, amount: "0.00", reference: null }];
}

// ---- The transaction sent to POST /pos/bills ----

export interface BuildOptions {
  clientId: string;
  tillId: string;
  shiftClientId: string;
  soldAt: string;
  offline: boolean;
  numbers: { sale?: string; ret?: string };
  cashierToken?: string;
}

/**
 * Online bills carry expectedTotal (a different server total is refused so the
 * cashier sees it); offline bills carry what was charged on each line, which
 * the server keeps as sold (pos-offline §5).
 */
export function buildTransaction(draft: DraftBill, bill: ComputedBill, methods: SnapPaymentMethod[], o: BuildOptions): PosTransactionInput {
  const input: PosTransactionInput = {
    clientId: o.clientId,
    tillId: o.tillId,
    shiftClientId: o.shiftClientId,
    soldAt: o.soldAt,
    offline: o.offline,
    payments: paymentsForServer(bill.due, draft.payments, methods),
  };
  if (o.cashierToken) input.cashierToken = o.cashierToken;
  // A return against a bill is for that bill's customer; without a bill, the customer chosen on the till.
  if (draft.ret?.originalBillId) input.customerId = draft.ret.customerId;
  else if (draft.customer?.newClientId) {
    const c = draft.customer;
    input.newCustomer = {
      clientId: draft.customer.newClientId,
      name: c.name,
      mobile: c.mobile ?? "",
      ...(c.birthday ? { birthday: c.birthday, birthYear: c.birthYear ?? null } : {}),
      ...(c.anniversary ? { anniversary: c.anniversary, anniversaryYear: c.anniversaryYear ?? null } : {}),
    };
  }
  else if (draft.customer?.id) input.customerId = draft.customer.id;
  if (draft.couponCode && bill.coupon) input.couponCode = bill.coupon.code;
  if (draft.salesStaffId) input.salesStaffId = draft.salesStaffId;
  // Plan 11 part 2: the order collected, the customer's credit used and an alteration charge.
  if (draft.order) input.orderId = draft.order.id;
  if (draft.credit && D(draft.credit).gt(0)) input.useCredit = D(draft.credit).toFixed(2);
  // Plan 13: points and gift cards (the server adds them as payments and checks the balances).
  if (bill.sale && draft.points?.points) input.redeemPoints = draft.points.points;
  if (bill.sale && draft.giftCards?.length) input.giftCards = draft.giftCards.map((g) => ({ number: g.number, amount: D(g.amount).toFixed(2) }));
  if (draft.alteration && bill.sale) input.alteration = { jobId: draft.alteration.jobId, ...(draft.alteration.deliver ? { deliver: true } : {}) };
  if (draft.delivery && bill.sale && bill.delivery) {
    const d = draft.delivery;
    input.delivery = {
      address: d.address.trim(),
      ...(d.name.trim() ? { name: d.name.trim() } : {}),
      ...(d.phone.trim() ? { phone: d.phone.trim() } : {}),
      ...(d.deliverOn ? { deliverOn: d.deliverOn } : {}),
      ...(d.remarks.trim() ? { remarks: d.remarks.trim() } : {}),
      ...(d.stateCode ? { stateCode: d.stateCode } : {}),
      ...(d.forOther ? { forOther: true } : {}),
      // Offline the server keeps the charge the till added (pos-offline §5).
      ...(o.offline ? { charge: bill.delivery.charge.toFixed(2) } : {}),
    };
  }
  // Plan 08 G4, G5: the buyer typed at the till; audit 4 (T8): also on a return, for the credit note (rule 53(1A)(f)).
  const buyer = draft.buyer;
  if (buyer && (buyer.gstin.trim() || buyer.name.trim() || buyer.address.trim() || buyer.stateCode)) {
    input.buyer = {
      ...(buyer.gstin.trim() ? { gstin: buyer.gstin.trim().toUpperCase() } : {}),
      ...(buyer.name.trim() ? { name: buyer.name.trim() } : {}),
      ...(buyer.address.trim() ? { address: buyer.address.trim() } : {}),
      ...(buyer.stateCode ? { stateCode: buyer.stateCode } : {}),
    };
  }
  const bd = draft.billDiscount;
  if (bd && ((bd.amount && D(bd.amount).gt(0)) || (bd.percent && D(bd.percent).gt(0)))) {
    input.billDiscount = { ...(bd.amount && D(bd.amount).gt(0) ? { amount: D(bd.amount).toFixed(2) } : { percent: D(bd.percent!).toString() }), ...(billDiscountToken(draft) ? { approvalToken: billDiscountToken(draft) } : {}) };
  }
  if (bill.sale) {
    if (!o.numbers.sale) throw new Error("The sale has no bill number");
    const draftByKey = new Map(draft.lines.map((l) => [l.key, l]));
    // The delivery charge line is added by the server from the store's settings.
    const lines = bill.sale.lines
      .filter((l) => !l.isDelivery && !l.isAlteration && (!l.isFree || o.offline))
      .map((l) => {
        const dl = l.draftKey ? draftByKey.get(l.draftKey) : undefined;
        if (l.isFree) {
          return { lineNo: l.lineNo, itemId: l.item.id, unitId: l.unitId, quantity: l.quantity.toString(), offerId: l.offer?.id ?? null, freeOfLineNo: l.freeOfLineNo ?? undefined };
        }
        return {
          lineNo: l.lineNo,
          itemId: l.item.id,
          unitId: l.unitId,
          quantity: l.quantity.toString(),
          ...(dl?.orderLineId ? { orderLineId: dl.orderLineId } : {}),
          ...(dl?.salesStaffId ? { salesStaffId: dl.salesStaffId } : {}),
          ...(dl?.barcode ? { barcode: dl.barcode } : {}),
          ...(serialList(dl?.serials).length ? { serialNumbers: serialList(dl?.serials) } : {}),
          ...(dl?.priceOverride ? { price: l.price.toFixed(2) } : {}),
          ...(l.manualPercent.gt(0) ? { discountPercent: l.manualPercent.toString() } : {}),
          ...(dl?.approvalToken ? { approvalToken: dl.approvalToken } : {}),
          // Audit 5: offline, the unit's size goes with the line, so a unit removed from the item meanwhile is still understood.
          ...(o.offline ? { factor: l.item.units.find((u) => u.unitId === l.unitId)?.factor ?? "1" } : {}),
          ...(o.offline
            ? {
                charged: {
                  listPrice: l.listPrice.toFixed(2),
                  price: l.price.toFixed(2),
                  discountAmount: l.manualDiscount.add(l.billShare).toFixed(2),
                  offerDiscount: l.offerDiscount.toFixed(2),
                  gstRate: l.gstRate.toString(),
                  lineTotal: l.amount.toFixed(2),
                },
              }
            : {}),
        };
      });
    input.sale = { number: o.numbers.sale, lines };
  }
  if (bill.ret && draft.ret) {
    if (!o.numbers.ret) throw new Error("The return has no bill number");
    if (draft.ret.originalBillId) {
      input.ret = {
        number: o.numbers.ret,
        returnOfId: draft.ret.originalBillId,
        reason: draft.ret.reason,
        lines: bill.ret.lines.map((l) => ({ lineNo: l.lineNo, itemId: l.item.id, unitId: l.unitId, quantity: l.quantity.abs().toString(), returnOfLineId: l.returnOfLineId })),
      };
    } else {
      // Without a bill (plan 11 A9): no returnOfId, the manager's approval, and a typed price where there is one.
      const typed = new Map(draft.ret.lines.map((l) => [l.key, l.originalLineId === null && !!l.priceOverride]));
      input.ret = {
        number: o.numbers.ret,
        reason: draft.ret.reason,
        ...(draft.ret.approvalToken ? { approvalToken: draft.ret.approvalToken } : {}),
        lines: bill.ret.lines.map((l) => ({ lineNo: l.lineNo, itemId: l.item.id, unitId: l.unitId, quantity: l.quantity.abs().toString(), ...(l.draftKey && typed.get(l.draftKey) ? { price: l.price.toFixed(2) } : {}) })),
      };
    }
  }
  if (!o.offline) input.expectedTotal = bill.net.toFixed(2);
  return input;
}

// ---- Plan 11 part 2: goods set aside for customer orders ----

/**
 * Items on the sale whose free quantity (on hand less what is set aside for
 * customer orders, less this bill) goes below zero. The till warns; it never
 * refuses (decision 32). The order being collected does not count against itself.
 */
export function setAsideWarnings(draft: DraftBill, bill: ComputedBill, snapshot: TillSnapshot): string[] {
  const reserved = new Map((snapshot.reserved ?? []).map((r) => [r.itemId, D(r.quantity)]));
  if (!reserved.size || !bill.sale) return [];
  for (const l of draft.order?.lines ?? []) reserved.set(l.itemId, Decimal.max(0, (reserved.get(l.itemId) ?? ZERO).sub(D(l.quantity))));
  const onHand = new Map(snapshot.stock.map((s) => [s.itemId, D(s.quantity)]));
  const onBill = new Map<string, { item: SnapItem; qty: Decimal }>();
  for (const l of bill.sale.lines) {
    if (!l.item.isStockItem) continue;
    const factor = D(l.item.units.find((u) => u.unitId === l.unitId)?.factor ?? "1");
    const q = onBill.get(l.item.id);
    onBill.set(l.item.id, { item: l.item, qty: (q?.qty ?? ZERO).add(l.quantity.mul(factor)) });
  }
  const out: string[] = [];
  for (const [itemId, { item, qty }] of onBill) {
    const r = reserved.get(itemId) ?? ZERO;
    if (r.gt(0) && freeToSell(onHand.get(itemId) ?? ZERO, r, qty).lt(0)) out.push(`${item.name}: ${r.toString()} set aside for customer orders. Selling it takes stock kept for a customer.`);
  }
  return out;
}
