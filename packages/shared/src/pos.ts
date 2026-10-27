// Copyright (c) 2026, Rademics. All rights reserved.
// Point-of-sale calculations (plan 06 §5; blueprint 09 "Calculations",
// blueprint 04 offers). Pure functions on decimal strings, shared by the till
// (preview and offline billing) and the API (authoritative check).
// The GST split from prices that include GST uses the rate list, which applies
// as soon as a rate is saved (owner decision of 22 Oct 2026).
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
  // Not approvable (blueprint 04, plan 06): say where the limit is set (launch check, 27 October 2026).
  if (pct.gt(max)) return { ok: false, needsApproval: false, reason: `Discount ${pct.toFixed(2)}% is above this item's maximum of ${max.toFixed(2)}%. The maximum is set on the item (Items, "Maximum discount %")` };
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

export type OfferKind = 'percent' | 'amount' | 'special_price' | 'free_goods' | 'buy_get' | 'mix_match';

/** Plan 11 B3: offers counted across the bill's lines, not on one line. */
export function isCountedOffer(kind: string): boolean {
  return kind === 'buy_get' || kind === 'mix_match';
}

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
    default:
      // buy_get and mix_match are counted over the whole bill (planOffers).
      return ZERO;
  }
}

// ---- Offers over the whole bill (plan 11 B3) ----

export interface PlanOffer extends LineOfferInput {
  id: string;
  code: string;
  priority?: number | null;
  /** mix_match: how many items make a set … */
  setQuantity?: number | null;
  /** … sold together for this price (any 3 for ₹999) … */
  setPrice?: DecimalInput | null;
  /** … or the cheapest one of each set free. */
  cheapestFree?: boolean | null;
  /** buy_get: what one free unit of the other item is worth (its price); null when it cannot be given. */
  freeUnitValue?: DecimalInput | null;
}

export interface PlanLine<O extends PlanOffer> {
  lineNo: number;
  /** Line units (whole units count towards sets). */
  quantity: DecimalInput;
  /** Price per line unit, including GST. */
  price: DecimalInput;
  /** Offers covering the line's item; empty when a typed price switches offers off. */
  offers: O[];
  /** Whether the line may count towards a set or a "buy" (list price, no manual discount). */
  countable: boolean;
}

export interface PlannedLineOffer<O extends PlanOffer> {
  offer: O;
  /** Rupees off the line (zero for free_goods and buy_get: their saving is a free line). */
  discount: Decimal;
  /** free_goods: units of the same item given free on a separate line. */
  freeQuantity: Decimal;
}

export interface PlannedFreeItem<O extends PlanOffer> {
  offer: O;
  /** buy_get: units of the offer's free item. */
  quantity: Decimal;
  /** The first line that counted towards it (the free line follows it). */
  ofLineNo: number;
  /** The free units' worth, for the saving shown on the bill. */
  saving: Decimal;
}

export interface OfferPlan<O extends PlanOffer> {
  lines: Map<number, PlannedLineOffer<O>>;
  freeItems: PlannedFreeItem<O>[];
}

interface CountedResult {
  saving: Decimal;
  /** Lines with units in a full set or "buy" block. */
  used: number[];
  /** mix_match: rupees off each line. */
  discounts: Map<number, Decimal>;
  /** buy_get: free units. */
  freeQuantity: Decimal;
}

/**
 * Works out a counted offer on the given lines. Units are taken most expensive
 * first, so the customer gets the most: sets are made of consecutive units in
 * that order; for "cheapest free" the last unit of each set is free; for a set
 * price a set is used only while it costs more than the set price.
 */
function countedOffer(offer: PlanOffer, lines: PlanLine<PlanOffer>[]): CountedResult | null {
  const buckets = lines
    .map((l) => ({ lineNo: l.lineNo, price: D(l.price), left: D(l.quantity).floor() }))
    .filter((b) => b.left.gt(0) && b.price.gt(0))
    .sort((a, b) => b.price.cmp(a.price) || a.lineNo - b.lineNo);
  const units = buckets.reduce((s, b) => s.add(b.left), ZERO);
  const size = offer.kind === 'mix_match' ? D(offer.setQuantity ?? 0) : D(offer.buyQuantity ?? 0);
  if (!size.isInteger() || size.lte(0) || units.lt(size)) return null;
  const used = new Map<number, Decimal>();
  const valueUsed = new Map<number, Decimal>();
  const discounts = new Map<number, Decimal>();
  let saving = ZERO;
  let sets = 0;
  let i = 0;
  // Takes one set (or "buy" block) of units; returns its value and its cheapest unit, or null when too few are left.
  const takeSet = (commit: boolean) => {
    let need = size;
    let value = ZERO;
    let last: { lineNo: number; price: Decimal } | null = null;
    const taken: { lineNo: number; count: Decimal; price: Decimal }[] = [];
    for (let j = i; j < buckets.length && need.gt(0); j++) {
      const b = buckets[j];
      const take = Decimal.min(b.left, need);
      if (take.lte(0)) continue;
      taken.push({ lineNo: b.lineNo, count: take, price: b.price });
      value = value.add(b.price.mul(take));
      need = need.sub(take);
      last = { lineNo: b.lineNo, price: b.price };
    }
    if (need.gt(0) || !last) return null;
    if (commit) {
      for (const t of taken) {
        const b = buckets.find((x) => x.lineNo === t.lineNo)!;
        b.left = b.left.sub(t.count);
        used.set(t.lineNo, (used.get(t.lineNo) ?? ZERO).add(t.count));
        valueUsed.set(t.lineNo, (valueUsed.get(t.lineNo) ?? ZERO).add(t.price.mul(t.count)));
      }
      while (i < buckets.length && buckets[i].left.lte(0)) i++;
    }
    return { value, last };
  };
  for (;;) {
    const peek = takeSet(false);
    if (!peek) break;
    if (offer.kind === 'mix_match' && !offer.cheapestFree) {
      const setPrice = D(offer.setPrice ?? 0);
      if (peek.value.lte(setPrice)) break;
      saving = saving.add(peek.value.sub(setPrice));
    } else if (offer.kind === 'mix_match') {
      discounts.set(peek.last.lineNo, (discounts.get(peek.last.lineNo) ?? ZERO).add(peek.last.price));
      saving = saving.add(peek.last.price);
    }
    takeSet(true);
    sets++;
  }
  if (sets === 0) return null;
  const usedLines = [...used.keys()].sort((a, b) => a - b);
  if (offer.kind === 'buy_get') {
    const worth = offer.freeUnitValue == null ? ZERO : D(offer.freeUnitValue);
    const freeQuantity = D(offer.freeQuantity ?? 0).mul(sets);
    if (worth.lte(0) || freeQuantity.lte(0)) return null;
    return { saving: roundMoney(worth.mul(freeQuantity)), used: usedLines, discounts, freeQuantity };
  }
  saving = roundMoney(saving);
  if (saving.lte(0)) return null;
  if (!offer.cheapestFree) {
    // The saving is spread over the lines in the sets by their value; the last line takes the remainder.
    const shares = shareByWeight(saving, usedLines.map((n) => valueUsed.get(n)!));
    usedLines.forEach((n, k) => discounts.set(n, shares[k]));
  }
  return { saving, used: usedLines, discounts, freeQuantity: ZERO };
}

/**
 * Decision 17 with plan 11 B3: chooses the offers of a bill. Each line gets at
 * most one offer. A counted offer (mix and match, buy X get Y) is used when
 * it saves more than the line offers of the lines it needs; the biggest gain
 * goes first (equal: higher priority, then the earlier code), then the next
 * one on the lines left. The other lines keep their best line offer.
 * The till and the server both use this, so their totals agree.
 */
export function planOffers<O extends PlanOffer>(lines: PlanLine<O>[]): OfferPlan<O> {
  const bestOnLine = new Map<number, { offer: O; saving: Decimal }>();
  for (const l of lines) {
    const candidates = l.offers.filter((o) => !isCountedOffer(o.kind)).map((o) => ({ offer: o, code: o.code, priority: o.priority, saving: lineOfferSaving(o, l) }));
    const best = bestOffer(candidates);
    if (best) bestOnLine.set(l.lineNo, { offer: best.offer, saving: D(best.saving) });
  }
  const counted: O[] = [];
  for (const l of lines) for (const o of l.offers) if (isCountedOffer(o.kind) && !counted.some((c) => c.id === o.id)) counted.push(o);

  const plan: OfferPlan<O> = { lines: new Map(), freeItems: [] };
  const taken = new Set<number>();
  for (;;) {
    let pick: { offer: O; gain: Decimal; result: CountedResult } | null = null;
    for (const o of counted) {
      const pool = lines.filter((l) => l.countable && !taken.has(l.lineNo) && l.offers.some((x) => x.id === o.id));
      const result = countedOffer(o, pool);
      if (!result) continue;
      const displaced = result.used.reduce((s, n) => s.add(bestOnLine.get(n)?.saving ?? ZERO), ZERO);
      const gain = result.saving.sub(displaced);
      if (gain.lte(0)) continue;
      const better = !pick || gain.gt(pick.gain) || (gain.eq(pick.gain) && ((o.priority ?? 0) > (pick.offer.priority ?? 0) || ((o.priority ?? 0) === (pick.offer.priority ?? 0) && o.code.localeCompare(pick.offer.code) < 0)));
      if (better) pick = { offer: o, gain, result };
    }
    if (!pick) break;
    for (const n of pick.result.used) {
      taken.add(n);
      plan.lines.set(n, { offer: pick.offer, discount: pick.result.discounts.get(n) ?? ZERO, freeQuantity: ZERO });
    }
    if (pick.offer.kind === 'buy_get') plan.freeItems.push({ offer: pick.offer, quantity: pick.result.freeQuantity, ofLineNo: pick.result.used[0], saving: pick.result.saving });
    counted.splice(counted.indexOf(pick.offer), 1);
  }
  for (const l of lines) {
    if (taken.has(l.lineNo)) continue;
    const best = bestOnLine.get(l.lineNo);
    if (!best) continue;
    const free = best.offer.kind === 'free_goods';
    plan.lines.set(l.lineNo, {
      offer: best.offer,
      discount: free ? ZERO : best.saving,
      freeQuantity: free ? freeUnits(l.quantity, best.offer.buyQuantity ?? 0, best.offer.freeQuantity ?? 0) : ZERO,
    });
  }
  return plan;
}

/** Decision 47: the store's delivery charge, none when the bill is at or above the "free above" amount. */
export function deliveryChargeFor(goodsTotal: DecimalInput, charge: DecimalInput | null | undefined, freeAbove: DecimalInput | null | undefined): Decimal {
  const c = D(charge ?? 0);
  if (c.lte(0)) return ZERO;
  if (freeAbove != null && D(goodsTotal).gte(D(freeAbove))) return ZERO;
  return roundMoney(c);
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
