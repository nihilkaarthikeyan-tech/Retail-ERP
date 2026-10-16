// Copyright (c) 2026, Rademics. All rights reserved.
// Point-of-sale calculations (plan 06 §5; blueprint 09 "Calculations",
// blueprint 04 offers). Pure functions on decimal strings, shared by the till
// (preview and offline billing) and the API (authoritative check).
// The GST split from prices that include GST is provisional until the CA
// approves it with the rate list (plan 06 answer 1).
import { Decimal, type DecimalInput, roundMoney, roundTo } from './rounding.js';

const D = (v: DecimalInput) => new Decimal(v);
const ZERO = new Decimal(0);

/** Notes and coins counted at shift close (decision 41). */
export const DENOMINATIONS = ['500', '200', '100', '50', '20', '10', '5', '2', '1'] as const;

export interface InclusiveTax {
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  tax: Decimal;
}

/**
 * GST inside a price that includes it (MRP-style retail): taxable =
 * amount ÷ (1 + rate ÷ 100) to paise, GST = amount − taxable, CGST takes the
 * odd paisa (half up), SGST the rest; IGST alone between states.
 * Works for minus amounts (returns) by symmetry.
 */
export function inclusiveTax(amount: DecimalInput, gstRate: DecimalInput, interState = false): InclusiveTax {
  const a = D(amount);
  const sign = a.isNegative() ? -1 : 1;
  const abs = a.abs();
  const taxable = roundMoney(abs.div(D(1).add(D(gstRate).div(100))));
  const tax = abs.sub(taxable);
  let cgst = ZERO;
  let sgst = ZERO;
  let igst = ZERO;
  if (interState) igst = tax;
  else {
    cgst = roundMoney(tax.div(2));
    sgst = tax.sub(cgst);
  }
  const s = (v: Decimal) => v.mul(sign);
  return { taxable: s(taxable), cgst: s(cgst), sgst: s(sgst), igst: s(igst), tax: s(tax) };
}

export interface SaleLineInput {
  quantity: DecimalInput;
  /** Price per line unit including GST, after any price override. */
  price: DecimalInput;
  discountPercent?: DecimalInput | null;
  /** Rupee discount on the whole line (offers, bill-discount share), taken after the percentage. */
  discountAmount?: DecimalInput | null;
}

/** Line amount = quantity × price − (percentage + fixed discount), to paise. */
export function saleLineAmount(line: SaleLineInput): { gross: Decimal; discount: Decimal; amount: Decimal } {
  const gross = roundMoney(D(line.quantity).mul(D(line.price)));
  const pct = D(line.discountPercent ?? 0);
  if (pct.lt(0) || pct.gt(100)) throw new Error('Discount must be between 0 and 100 percent');
  const fixed = D(line.discountAmount ?? 0);
  if (fixed.lt(0)) throw new Error('Discount cannot be negative');
  const discount = roundMoney(gross.abs().mul(pct).div(100).add(fixed));
  if (discount.gt(gross.abs())) throw new Error('Discount is more than the line amount');
  const amount = gross.isNegative() ? gross.add(discount) : gross.sub(discount);
  return { gross, discount, amount };
}

/** Effective discount percent of a line against its list price (for the limit checks). */
export function effectiveDiscountPercent(listPrice: DecimalInput, quantity: DecimalInput, amount: DecimalInput): Decimal {
  const full = D(listPrice).mul(D(quantity)).abs();
  if (full.lte(0)) return ZERO;
  return roundTo(full.sub(D(amount).abs()).div(full).mul(100), 2);
}

export type DiscountVerdict = { ok: true } | { ok: false; needsApproval: boolean; reason: string };

/**
 * Plan 06 §4: never above MRP (decision 76); never above the item's maximum
 * discount even with a PIN; above the cashier's limit only with a manager PIN
 * (decision 19). Free lines and offer discounts are not cashier discounts.
 */
export function checkDiscount(args: {
  listPrice: DecimalInput;
  price: DecimalInput;
  mrp?: DecimalInput | null;
  /** Discount the cashier gave (manual), as a percent of the list amount. */
  manualDiscountPercent: DecimalInput;
  itemMaxPercent: DecimalInput;
  cashierLimitPercent: DecimalInput;
  approved: boolean;
}): DiscountVerdict {
  if (args.mrp != null && D(args.mrp).gt(0) && D(args.price).gt(D(args.mrp))) {
    return { ok: false, needsApproval: false, reason: `Price ${D(args.price).toFixed(2)} is above the MRP ${D(args.mrp).toFixed(2)}` };
  }
  const pct = D(args.manualDiscountPercent);
  const max = D(args.itemMaxPercent);
  if (pct.gt(max)) return { ok: false, needsApproval: false, reason: `Discount ${pct.toFixed(2)}% is above this item's maximum of ${max.toFixed(2)}%` };
  if (pct.gt(D(args.cashierLimitPercent)) && !args.approved) {
    return { ok: false, needsApproval: true, reason: `Discount ${pct.toFixed(2)}% is above the cashier's limit of ${D(args.cashierLimitPercent).toFixed(2)}%; a manager must approve it` };
  }
  return { ok: true };
}

/** Shares an amount over weights in proportion; the last share takes the rounding remainder. */
export function shareByWeight(total: DecimalInput, weights: DecimalInput[]): Decimal[] {
  const t = roundMoney(total);
  const w = weights.map((x) => D(x).abs());
  const sum = w.reduce((a, b) => a.add(b), ZERO);
  if (w.length === 0) return [];
  if (sum.lte(0)) return w.map((_, i) => (i === w.length - 1 ? t : ZERO));
  let given = ZERO;
  return w.map((x, i) => {
    const share = i === w.length - 1 ? t.sub(given) : roundMoney(t.mul(x).div(sum));
    given = given.add(share);
    return share;
  });
}

export type OfferKind = 'percent' | 'amount' | 'special_price' | 'free_goods';

export interface LineOfferInput {
  kind: OfferKind;
  /** percent: %; amount: rupees off per line unit; special_price: the price per line unit. */
  value?: DecimalInput | null;
  /** free_goods: buy N … */
  buyQuantity?: DecimalInput | null;
  /** … get M free (same item). */
  freeQuantity?: DecimalInput | null;
  minQuantity?: DecimalInput | null;
  minAmount?: DecimalInput | null;
}

/** Free units for "buy N get M": whole blocks of N bought give M each. */
export function freeUnits(bought: DecimalInput, buyQuantity: DecimalInput, freeQuantity: DecimalInput): Decimal {
  const n = D(buyQuantity);
  if (n.lte(0)) return ZERO;
  return D(bought).div(n).floor().mul(D(freeQuantity));
}

/**
 * What an offer saves the customer on one line (0 when it does not apply).
 * free_goods saves the price of the free units, which come as a separate line.
 */
export function lineOfferSaving(offer: LineOfferInput, line: { quantity: DecimalInput; price: DecimalInput }): Decimal {
  const qty = D(line.quantity);
  const price = D(line.price);
  const amount = roundMoney(qty.mul(price));
  if (qty.lte(0)) return ZERO;
  if (offer.minQuantity != null && qty.lt(D(offer.minQuantity))) return ZERO;
  if (offer.minAmount != null && amount.lt(D(offer.minAmount))) return ZERO;
  switch (offer.kind) {
    case 'percent':
      return roundMoney(amount.mul(D(offer.value ?? 0)).div(100));
    case 'amount':
      return Decimal.min(amount, roundMoney(D(offer.value ?? 0).mul(qty)));
    case 'special_price': {
      const special = D(offer.value ?? 0);
      return special.lt(price) ? roundMoney(price.sub(special).mul(qty)) : ZERO;
    }
    case 'free_goods':
      return roundMoney(freeUnits(qty, offer.buyQuantity ?? 0, offer.freeQuantity ?? 0).mul(price));
  }
}

/**
 * Decision 17: the offer giving the biggest saving wins automatically; equal
 * savings go to the higher priority, then the earlier code. Never refuses.
 */
export function bestOffer<T extends { saving: DecimalInput; priority?: number | null; code: string }>(candidates: T[]): T | null {
  const useful = candidates.filter((c) => D(c.saving).gt(0));
  if (!useful.length) return null;
  return useful.sort((a, b) => D(b.saving).cmp(D(a.saving)) || (b.priority ?? 0) - (a.priority ?? 0) || a.code.localeCompare(b.code))[0];
}

/** Bill total rounded to the rupee (decision 5); the adjustment is stored with the rounding role. */
export function roundBill(total: DecimalInput): { rounded: Decimal; adjustment: Decimal } {
  const t = D(total);
  const rounded = roundTo(t, 0);
  return { rounded, adjustment: rounded.sub(t) };
}

/**
 * Change (blueprint 09): paid − rounded total, only when more was paid and
 * cash is one of the methods; otherwise more than the total is refused.
 */
export function changeDue(args: { total: DecimalInput; payments: { amount: DecimalInput; isCash: boolean }[] }): { paid: Decimal; change: Decimal; short: Decimal; overpaidWithoutCash: boolean } {
  const total = D(args.total);
  const paid = args.payments.reduce((s, p) => s.add(D(p.amount)), ZERO);
  const usesCash = args.payments.some((p) => p.isCash && !D(p.amount).eq(0));
  const over = paid.sub(total);
  if (total.gte(0)) {
    return {
      paid,
      change: over.gt(0) && usesCash ? over : ZERO,
      short: over.lt(0) ? over.neg() : ZERO,
      overpaidWithoutCash: over.gt(0) && !usesCash,
    };
  }
  // Refunds (minus totals): the refund may not be more than what is returned.
  return { paid, change: ZERO, short: over.gt(0) ? over : ZERO, overpaidWithoutCash: over.lt(0) };
}

/** Cash counted = Σ note or coin value × count (decision 41). */
export function denominationTotal(counts: Record<string, DecimalInput | number>): Decimal {
  let total = ZERO;
  for (const [value, count] of Object.entries(counts)) {
    const c = D(count);
    if (c.lt(0) || !c.isInteger()) throw new Error(`Count of ₹${value} must be a whole number`);
    total = total.add(D(value).mul(c));
  }
  return total;
}

/**
 * Expected amount of one payment method at closing = opening + payments
 * received − refunds paid − change given (cash) + cash in − cash out.
 * `payments` are signed: sales positive, refunds negative.
 */
export function expectedAtClose(args: { opening: DecimalInput; payments: DecimalInput[]; change?: DecimalInput; cashIn?: DecimalInput; cashOut?: DecimalInput }): Decimal {
  const pay = args.payments.reduce<Decimal>((s, p) => s.add(D(p)), ZERO);
  return D(args.opening).add(pay).sub(D(args.change ?? 0)).add(D(args.cashIn ?? 0)).sub(D(args.cashOut ?? 0));
}
