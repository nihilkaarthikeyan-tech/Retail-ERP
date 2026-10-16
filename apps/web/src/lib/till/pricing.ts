// Copyright (c) 2026, Rademics. All rights reserved.
// Local pricing on the till (plan 06 §4–§5; pos-offline §2 and §5). The same
// shared functions as the server work out every figure, so an online bill shows
// what the server will save and an offline bill is right on the receipt:
// price (selectPrice, customer price first), MRP cap, cashier discount limit,
// the best offer and free lines, the bill discount shared over the lines, GST
// from the HSN rate list and rounding to the rupee. No floating point (rule 1).
import {
  bestOffer,
  checkDiscount,
  Decimal,
  type DecimalInput,
  effectiveDiscountPercent,
  freeUnits,
  inclusiveTax,
  type InclusiveTax,
  lineOfferSaving,
  type PosTransactionInput,
  quantityProblem,
  rateForLine,
  roundBill,
  roundMoney,
  saleLineAmount,
  selectPrice,
  shareByWeight,
} from "shared";
import type { SnapCoupon, SnapCustomer, SnapGstRate, SnapItem, SnapOffer, SnapPaymentMethod, TillSnapshot } from "./types";

const D = (v: DecimalInput) => new Decimal(v);
const ZERO = new Decimal(0);

export type ApprovalKind = "price_change" | "discount" | "bill_discount";

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
}

/** The serial numbers typed on a line. */
export function serialList(text: string | undefined): string[] {
  return (text ?? "").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
}

export interface DraftReturnLine {
  key: string;
  originalLineId: string;
  itemId: string;
  unitId: string;
  code: string;
  name: string;
  /** Quantity coming back now. */
  quantity: string;
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
  customerGroupId: string | null;
  /** Added on the till (module 3 quick add): sent as newCustomer. */
  newClientId?: string;
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
  billDiscount: { percent?: string; amount?: string; approvalToken?: string; approvedBy?: string } | null;
  lines: DraftLine[];
  ret: {
    originalBillId: string;
    originalNumber: string;
    customerId: string;
    lines: DraftReturnLine[];
    reason: string | null;
    /** The original bill was paid (partly) on account, so the refund may go back on account (plan 07 §1a). */
    paidOnAccount?: boolean;
  } | null;
  payments: DraftPayment[];
  /** Given once when the cashier first presses Finish; the idempotency key (pos-offline §4). */
  clientId: string | null;
  /** Numbers taken from the till's counter for this bill (kept so a retry reuses them). */
  numbers: { sale?: string; ret?: string };
  /** When the cashier first pressed Finish (the time of sale). */
  soldAt?: string;
}

export function emptyDraft(id: string, now: Date = new Date()): DraftBill {
  return { id, startedAt: now.toISOString(), customer: null, couponCode: null, billDiscount: null, lines: [], ret: null, payments: [], clientId: null, numbers: {} };
}

export function isDraftEmpty(d: DraftBill): boolean {
  return d.lines.length === 0 && !d.ret?.lines.length;
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
  provisional: boolean;
  tax: InclusiveTax;
  isFree: boolean;
  freeOfLineNo: number | null;
  returnOfLineId: string | null;
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
  problems: string[];
  approvals: NeededApproval[];
  provisional: boolean;
}

export interface PricingContext {
  snapshot: TillSnapshot;
  /** Indian business date of the sale (rule 15). */
  date: string;
}

// ---- Look-ups in the snapshot ----

export function findItem(snapshot: TillSnapshot, itemId: string): SnapItem | undefined {
  return snapshot.items.find((i) => i.id === itemId);
}

/** A scanned code: a barcode (item + its unit) first, then an exact item code. */
export function scan(snapshot: TillSnapshot, code: string): { item: SnapItem; unitId: string; barcode: string | null } | null {
  const c = code.trim();
  if (!c) return null;
  for (const item of snapshot.items) {
    if (!item.active) continue;
    const b = item.barcodes.find((x) => x.code === c);
    if (b) return { item, unitId: b.unitId ?? item.baseUnitId, barcode: c };
  }
  const byCode = snapshot.items.find((i) => i.active && i.code.toUpperCase() === c.toUpperCase());
  return byCode ? { item: byCode, unitId: byCode.baseUnitId, barcode: null } : null;
}

/** Name or code search for the pick list. */
export function searchItems(snapshot: TillSnapshot, text: string, limit = 20): SnapItem[] {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return snapshot.items.filter((i) => i.active && words.every((w) => i.name.toLowerCase().includes(w) || i.code.toLowerCase().includes(w))).slice(0, limit);
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
    const rows = snapshot.prices.filter((p) => p.itemId === item.id && p.priceListId === list.id);
    const candidates = rows.map((r) => ({ id: r.id, price: r.price, unitId: r.unitId, startDate: r.startDate, endDate: r.endDate, customerId: r.customerId, supplierId: null, batchId: r.batchId, packSize: r.packSize }));
    const chosen = selectPrice(candidates, { date, unitId, quantity: D(quantity).toString(), customerId, batchId: null });
    if (!chosen) continue;
    const lineUnit = item.units.find((u) => u.unitId === unitId);
    const priceUnit = item.units.find((u) => u.unitId === chosen.unitId);
    return rateForLine({ price: chosen.price, unitId: chosen.unitId }, { unitId, unitFactor: lineUnit?.factor ?? "1" }, priceUnit?.factor ?? "1", list.pricesPerUnit);
  }
  return null;
}

/** GST rate: longest HSN match (8, 6, 4 digits), latest start on or before the date (plan 06 answer 1). */
export function gstRateFor(rates: SnapGstRate[], hsnCode: string | null, date: string): SnapGstRate | null {
  if (!hsnCode) return null;
  const codes = [hsnCode.slice(0, 8), hsnCode.slice(0, 6), hsnCode.slice(0, 4)].filter((c, i, a) => c.length >= 4 && a.indexOf(c) === i);
  for (const code of codes) {
    const found = rates.filter((r) => r.hsnCode === code && r.effectiveFrom <= date).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
    if (found) return found;
  }
  return null;
}

/** A coupon typed at the till, checked as the server does (blueprint 04 §5). */
export function couponProblem(c: SnapCoupon | undefined, code: string, date: string, customerId: string | null): string | null {
  if (!c) return `Coupon ${code} not found`;
  if (c.startDate > date || (c.endDate && c.endDate < date)) return `Coupon ${c.code} is not valid today`;
  if (c.maxUses != null && c.usedCount >= c.maxUses) return `Coupon ${c.code} has been used up`;
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

/** The line offer with the biggest saving (equal: higher priority, then code). */
export function bestLineOffer(offers: SnapOffer[], item: SnapItem, line: { quantity: Decimal; price: Decimal }): { offer: SnapOffer; saving: Decimal } | null {
  const candidates = offers.filter((o) => o.appliesTo !== "bill" && offerCovers(o, item)).map((o) => ({ offer: o, code: o.code, priority: o.priority, saving: lineOfferSaving(offerInput(o), line) }));
  const best = bestOffer(candidates);
  return best ? { offer: best.offer, saving: D(best.saving) } : null;
}

export function bestBillOffer(offers: SnapOffer[], amount: Decimal): { offer: SnapOffer; saving: Decimal } | null {
  const candidates = offers.filter((o) => o.appliesTo === "bill").map((o) => ({ offer: o, code: o.code, priority: o.priority, saving: lineOfferSaving(offerInput(o), { quantity: "1", price: amount }) }));
  const best = bestOffer(candidates);
  return best ? { offer: best.offer, saving: D(best.saving) } : null;
}

export function isInterState(snapshot: TillSnapshot, customer: { gstin: string | null; stateCode: string | null } | null): boolean {
  if (!customer?.gstin || !customer.stateCode) return false;
  return customer.stateCode !== (snapshot.till.store.stateCode ?? snapshot.till.company.stateCode);
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

/** Works out the whole bill exactly as POST /pos/bills will (plan 06 §4–§5). */
export function priceBill(draft: DraftBill, ctx: PricingContext): ComputedBill {
  const { snapshot, date } = ctx;
  const till = snapshot.till;
  const problems: string[] = [];
  const approvals: NeededApproval[] = [];
  const customer = draft.customer;
  const interState = isInterState(snapshot, customer);
  const walkIn = till.walkInCustomerId ? snapshot.customers.find((c) => c.id === till.walkInCustomerId) : undefined;
  const groupId = customer ? customer.customerGroupId : (walkIn?.customerGroupId ?? null);
  const customerIdForPrice = customer?.id ?? null;
  const cashierLimit = D(till.cashierDiscountPercent);

  let coupon: SnapCoupon | null = null;
  if (draft.couponCode && draft.lines.length) {
    const code = draft.couponCode.trim().toUpperCase();
    const found = snapshot.coupons.find((c) => c.code === code);
    const problem = couponProblem(found, code, date, customer?.id ?? till.walkInCustomerId);
    if (problem) problems.push(problem);
    else coupon = found ?? null;
  }
  const offers = activeOffers(snapshot.offers, { date, storeId: till.store.id, customerGroupId: groupId, couponOfferId: coupon?.offerId ?? null });

  // ---- Sale lines ----
  let sale: ComputedPart | null = null;
  let billDiscount = ZERO;
  let billOffer: SnapOffer | null = null;
  if (draft.lines.length) {
    const lines: ComputedLine[] = [];
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
      const list = listPriceFor(snapshot, item, dl.unitId, quantity.gt(0) ? quantity : "1", customerIdForPrice, date);
      if (list === null && !problem) problem = `${item.code} has no price in the till's price list`;
      const listPrice = list ?? ZERO;
      const price = dl.priceOverride !== null && dl.priceOverride !== "" ? roundMoney(dl.priceOverride) : listPrice;
      const priceChanged = !price.eq(listPrice);
      const rate = gstRateFor(snapshot.gstRates, item.hsnCode, date);
      if (!rate && !problem) problem = item.hsnCode ? `No GST rate is set for HSN ${item.hsnCode} (${item.code})` : `${item.code} has no HSN code, so its GST rate is not known`;
      const gstRate = D(rate?.rate ?? "0");
      // Offers apply to the list price; a typed price switches them off for the line (blueprint 04).
      const chosen = !priceChanged && quantity.gt(0) ? bestLineOffer(offers, item, { quantity, price }) : null;
      let manualPercent = ZERO;
      try {
        manualPercent = D(dl.discountPercent || "0");
      } catch {
        problem = problem ?? "The discount is not a number";
      }
      if (priceChanged && !till.allowPriceChange && !dl.approvalToken) approvals.push({ kind: "price_change", lineKey: dl.key, reason: `${item.code}: a price change needs a manager` });
      const verdict = checkDiscount({ listPrice, price, mrp, manualDiscountPercent: manualPercent, itemMaxPercent: item.maxDiscountPercent, cashierLimitPercent: cashierLimit, approved: !!dl.approvalToken });
      if (!verdict.ok) {
        if (verdict.needsApproval) approvals.push({ kind: "discount", lineKey: dl.key, reason: `${item.code}: ${verdict.reason}` });
        else problem = problem ?? verdict.reason;
      }
      const offerDiscount = chosen && chosen.offer.kind !== "free_goods" ? chosen.saving : ZERO;
      let amount = ZERO;
      let discount = ZERO;
      if (quantity.gt(0)) {
        try {
          const r = saleLineAmount({ quantity, price, discountPercent: manualPercent, discountAmount: offerDiscount });
          amount = r.amount;
          discount = r.discount;
        } catch (e) {
          problem = problem ?? (e instanceof Error ? e.message : String(e));
        }
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
        manualDiscount: discount.sub(offerDiscount),
        offer: chosen?.offer ?? null,
        offerDiscount,
        billShare: ZERO,
        discountAmount: discount,
        amount,
        gstRate,
        provisional: !rate?.approved,
        tax: blankTax(),
        isFree: false,
        freeOfLineNo: null,
        returnOfLineId: null,
        problem,
      };
      if (problem) problems.push(`Line ${lineNo}: ${problem}`);
      lines.push(line);
      if (chosen?.offer.kind === "free_goods") {
        const free = freeUnits(quantity, chosen.offer.buyQuantity ?? "0", chosen.offer.freeQuantity ?? "0");
        if (free.gt(0)) {
          lines.push({ ...line, lineNo: 1000 + lineNo, draftKey: null, quantity: free, price: ZERO, manualPercent: ZERO, manualDiscount: ZERO, offerDiscount: ZERO, discountAmount: ZERO, amount: ZERO, isFree: true, freeOfLineNo: lineNo, problem: null });
        }
      }
    });

    // Whole-bill discount: typed (approval above the cashier's limit) or the best bill offer.
    const paid = lines.filter((l) => !l.isFree);
    const base = paid.reduce((s, l) => s.add(l.amount), ZERO);
    const bd = draft.billDiscount;
    const manual = !!bd && ((!!bd.amount && D(bd.amount).gt(0)) || (!!bd.percent && D(bd.percent).gt(0)));
    if (manual && bd) {
      billDiscount = bd.amount && D(bd.amount).gt(0) ? roundMoney(bd.amount) : roundMoney(base.mul(D(bd.percent!)).div(100));
      const pct = base.gt(0) ? billDiscount.div(base).mul(100) : ZERO;
      if (pct.gt(cashierLimit) && !bd.approvalToken) approvals.push({ kind: "bill_discount", lineKey: null, reason: `A bill discount of ₹${billDiscount.toFixed(2)} is above the cashier's limit of ${cashierLimit.toFixed(2)}%` });
    } else {
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
    for (const l of lines) l.tax = inclusiveTax(l.amount, l.gstRate, interState);
    sale = partTotals(lines);
  }

  // ---- Return lines: the original net price per unit (after all discounts) comes back ----
  let ret: ComputedPart | null = null;
  if (draft.ret?.lines.length) {
    const lines: ComputedLine[] = [];
    draft.ret.lines.forEach((rl, index) => {
      const lineNo = index + 1;
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
        provisional: false,
        tax: inclusiveTax(amount, rl.gstRate, interState),
        isFree: rl.isFree,
        freeOfLineNo: null,
        returnOfLineId: rl.originalLineId,
        problem,
      };
      if (problem) problems.push(`${rl.code}: ${problem}`);
      if (quantity.gt(0)) lines.push(line);
    });
    if (lines.length) ret = partTotals(lines);
  }

  const net = (sale?.total ?? ZERO).add(ret?.total ?? ZERO);
  const provisional = (sale?.lines ?? []).some((l) => l.provisional);
  return { sale, ret, net, billDiscount, billOffer, coupon, interState, problems, approvals, provisional };
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
  if (draft.ret) return draft.ret.customerId !== walkInCustomerId;
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
    payments: paymentsForServer(bill.net, draft.payments, methods),
  };
  if (o.cashierToken) input.cashierToken = o.cashierToken;
  if (draft.ret) input.customerId = draft.ret.customerId;
  else if (draft.customer?.newClientId) input.newCustomer = { clientId: draft.customer.newClientId, name: draft.customer.name, mobile: draft.customer.mobile ?? "" };
  else if (draft.customer?.id) input.customerId = draft.customer.id;
  if (draft.couponCode && bill.coupon) input.couponCode = bill.coupon.code;
  const bd = draft.billDiscount;
  if (bd && ((bd.amount && D(bd.amount).gt(0)) || (bd.percent && D(bd.percent).gt(0)))) {
    input.billDiscount = { ...(bd.amount && D(bd.amount).gt(0) ? { amount: D(bd.amount).toFixed(2) } : { percent: D(bd.percent!).toString() }), ...(bd.approvalToken ? { approvalToken: bd.approvalToken } : {}) };
  }
  if (bill.sale) {
    if (!o.numbers.sale) throw new Error("The sale has no bill number");
    const draftByKey = new Map(draft.lines.map((l) => [l.key, l]));
    const lines = bill.sale.lines
      .filter((l) => !l.isFree || o.offline)
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
          ...(dl?.barcode ? { barcode: dl.barcode } : {}),
          ...(serialList(dl?.serials).length ? { serialNumbers: serialList(dl?.serials) } : {}),
          ...(dl?.priceOverride ? { price: l.price.toFixed(2) } : {}),
          ...(l.manualPercent.gt(0) ? { discountPercent: l.manualPercent.toString() } : {}),
          ...(dl?.approvalToken ? { approvalToken: dl.approvalToken } : {}),
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
    input.ret = {
      number: o.numbers.ret,
      returnOfId: draft.ret.originalBillId,
      reason: draft.ret.reason,
      lines: bill.ret.lines.map((l) => ({ lineNo: l.lineNo, itemId: l.item.id, unitId: l.unitId, quantity: l.quantity.abs().toString(), returnOfLineId: l.returnOfLineId })),
    };
  }
  if (!o.offline) input.expectedTotal = bill.net.toFixed(2);
  return input;
}
