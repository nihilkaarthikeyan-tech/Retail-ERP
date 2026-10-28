// Copyright (c) 2026, Rademics. All rights reserved.
// Purchasing calculations (blueprint 07 "Calculations"; plan 05 §5).
// Pure functions on decimal strings, shared by the API (authoritative) and
// the web forms (preview only). Rounding comes from rounding.ts (rule 2).
import { Decimal, type DecimalInput, roundMoney, roundQuantity, roundTo } from './rounding.js';
import { UNIT_COST_DECIMALS } from './stock-costing.js';

const D = (v: DecimalInput) => new Decimal(v);
const ZERO = new Decimal(0);

/** Allowed gap between the GST typed from the supplier's bill and rate × taxable value. */
export const GST_TOLERANCE = new Decimal('0.01');
/** Hand-typed charge shares must add up to the total within two paise. */
export const MANUAL_SHARE_TOLERANCE = new Decimal('0.02');
/** Over-receipt / over-billing are refused only beyond the allowance by more than this (percent). */
export const ALLOWANCE_TOLERANCE_PERCENT = new Decimal('0.01');

export interface LineInput {
  /** Charged quantity in the line unit (free units are not charged). */
  quantity: DecimalInput;
  rate: DecimalInput;
  discountPercent?: DecimalInput | null;
  /** Fixed discount in rupees, taken after the percentage. */
  discountAmount?: DecimalInput | null;
}

export interface LineAmounts {
  gross: Decimal;
  discount: Decimal;
  taxable: Decimal;
}

/** gross = qty × rate; discount = gross × % + fixed; taxable = gross − discount (all to paise). */
export function lineAmounts(line: LineInput): LineAmounts {
  const gross = roundMoney(D(line.quantity).mul(D(line.rate)));
  const pct = line.discountPercent != null ? D(line.discountPercent) : ZERO;
  if (pct.lt(0) || pct.gt(100)) throw new Error('Discount must be between 0 and 100 percent');
  const fixed = line.discountAmount != null ? D(line.discountAmount) : ZERO;
  if (fixed.lt(0)) throw new Error('Discount cannot be negative');
  const discount = roundMoney(gross.mul(pct).div(100).add(fixed));
  if (discount.gt(gross)) throw new Error('Discount is more than the line amount');
  return { gross, discount, taxable: gross.sub(discount) };
}

export interface GstSplit {
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
}

/**
 * A suggested split for filling the form: within a state CGST and SGST are each
 * taxable × (rate ÷ 2) to paise, always equal (decision L8); between states
 * IGST is rate × taxable to paise.
 * The supplier's bill is the authority; users may type their figures instead.
 */
export function suggestGst(taxable: DecimalInput, gstRate: DecimalInput, interState: boolean): GstSplit {
  if (interState) return { cgst: ZERO, sgst: ZERO, igst: roundMoney(D(taxable).mul(D(gstRate)).div(100)) };
  const half = roundMoney(D(taxable).mul(D(gstRate)).div(200));
  return { cgst: half, sgst: half, igst: ZERO };
}

/**
 * Plan 05 answer 2: GST is recorded as the supplier states it, but the
 * arithmetic must hold: either CGST + SGST (equal within a paisa) or IGST
 * alone, adding up to rate × taxable within ₹0.01.
 */
export function gstProblem(line: { taxable: DecimalInput; gstRate: DecimalInput; cgst: DecimalInput; sgst: DecimalInput; igst: DecimalInput }): string | null {
  const rate = D(line.gstRate);
  const cgst = D(line.cgst);
  const sgst = D(line.sgst);
  const igst = D(line.igst);
  if (rate.lt(0) || rate.gt(100)) return 'GST rate must be between 0 and 100';
  if (cgst.lt(0) || sgst.lt(0) || igst.lt(0)) return 'GST amounts cannot be negative';
  if (igst.gt(0) && (cgst.gt(0) || sgst.gt(0))) return 'Use either CGST + SGST or IGST, not both';
  if (cgst.sub(sgst).abs().gt(GST_TOLERANCE)) return 'CGST and SGST must be equal';
  const expected = roundMoney(D(line.taxable).mul(rate).div(100));
  const actual = cgst.add(sgst).add(igst);
  if (actual.sub(expected).abs().gt(GST_TOLERANCE)) {
    return `GST ${actual.toFixed(2)} does not match ${rate.toString()}% of ${roundMoney(line.taxable).toFixed(2)} (${expected.toFixed(2)})`;
  }
  return null;
}

export interface TotalsLine {
  taxable: DecimalInput;
  cgst: DecimalInput;
  sgst: DecimalInput;
  igst: DecimalInput;
}

export interface DocumentTotals {
  taxable: Decimal;
  tax: Decimal;
  /** taxable + tax before rounding to the rupee. */
  exact: Decimal;
  /** Rounded to the whole rupee (decision 5: ₹0.50 and above rounds up). */
  total: Decimal;
  roundingAdjustment: Decimal;
}

export function documentTotals(lines: TotalsLine[], roundToRupee = true): DocumentTotals {
  let taxable = ZERO;
  let tax = ZERO;
  for (const l of lines) {
    taxable = taxable.add(D(l.taxable));
    tax = tax.add(D(l.cgst)).add(D(l.sgst)).add(D(l.igst));
  }
  const exact = taxable.add(tax);
  const total = roundToRupee ? roundTo(exact, 0) : exact;
  return { taxable, tax, exact, total, roundingAdjustment: total.sub(exact) };
}

/**
 * Cost per basic unit of a received line (stock is valued before GST, plan 05
 * answer 2). Free units share the cost (decision 27); rejected units carry the
 * same cost (decision 30).
 */
export function unitCostPerBasicUnit(args: { taxable: DecimalInput; extraCharges?: DecimalInput | null; priceDifference?: DecimalInput | null; basicQuantity: DecimalInput }): Decimal {
  const qty = D(args.basicQuantity);
  if (qty.lte(0)) throw new Error('Received quantity must be above zero');
  const amount = D(args.taxable).add(D(args.extraCharges ?? 0)).add(D(args.priceDifference ?? 0));
  if (amount.lt(0)) throw new Error('Cost cannot be negative');
  return roundTo(amount.div(qty), UNIT_COST_DECIMALS);
}

export type ShareBy = 'quantity' | 'value';

export interface ShareBase {
  key: string;
  quantity: DecimalInput;
  value: DecimalInput;
}

/**
 * Shares extra charges over receipt lines by quantity or value; each share is
 * rounded to paise and the last line takes the rounding remainder, so the
 * shares always add up to the total exactly.
 */
export function shareCharges(total: DecimalInput, lines: ShareBase[], by: ShareBy): { key: string; amount: Decimal }[] {
  const t = roundMoney(total);
  if (t.lt(0)) throw new Error('Charges cannot be negative');
  if (lines.length === 0) throw new Error('Choose at least one received line');
  const weights = lines.map((l) => D(by === 'quantity' ? l.quantity : l.value));
  const sum = weights.reduce((a, b) => a.add(b), ZERO);
  if (sum.lte(0)) throw new Error(`The lines have no ${by === 'quantity' ? 'quantity' : 'value'} to share by`);
  let given = ZERO;
  return lines.map((l, i) => {
    const amount = i === lines.length - 1 ? t.sub(given) : roundMoney(t.mul(weights[i]).div(sum));
    given = given.add(amount);
    return { key: l.key, amount };
  });
}

/** Hand-typed shares must match the total within ₹0.02 (blueprint 07). */
export function manualSharesProblem(total: DecimalInput, shares: DecimalInput[]): string | null {
  if (shares.some((s) => D(s).lt(0))) return 'A share cannot be negative';
  const sum = shares.reduce<Decimal>((a, s) => a.add(D(s)), ZERO);
  if (sum.sub(D(total)).abs().gt(MANUAL_SHARE_TOLERANCE)) return `Shares add up to ${sum.toFixed(2)}, not ${roundMoney(total).toFixed(2)}`;
  return null;
}

/** Most allowed = ordered × (100 + allowance) ÷ 100. */
export function maxWithAllowance(ordered: DecimalInput, allowancePercent: DecimalInput): Decimal {
  return D(ordered).mul(D(100).add(D(allowancePercent))).div(100);
}

/**
 * Over-receipt / over-billing check (blueprint 07): refused when
 * (total − ordered) ÷ ordered × 100 is more than the allowance by over 0.01.
 * Nothing ordered (receipt without an order) is never "over".
 */
export function isOverAllowance(ordered: DecimalInput, total: DecimalInput, allowancePercent: DecimalInput): boolean {
  const o = D(ordered);
  if (o.lte(0)) return false;
  const overPercent = D(total).sub(o).div(o).mul(100);
  return overPercent.gt(D(allowancePercent).add(ALLOWANCE_TOLERANCE_PERCENT));
}

/** Σ min(done, ordered) ÷ Σ ordered × 100, to two places; 0 when nothing ordered. */
export function percentDone(lines: { ordered: DecimalInput; done: DecimalInput }[]): Decimal {
  let ordered = ZERO;
  let done = ZERO;
  for (const l of lines) {
    const o = D(l.ordered);
    ordered = ordered.add(o);
    done = done.add(Decimal.max(ZERO, Decimal.min(o, D(l.done))));
  }
  return ordered.lte(0) ? ZERO : roundTo(done.div(ordered).mul(100), 2);
}

/**
 * Plan 05 §5: suggest only when on hand + on order is below the reorder level;
 * the reorder quantity if set, otherwise enough to reach the level, rounded up
 * to whole units of `roundUpTo` (the order unit's size in basic units).
 */
export function reorderSuggestion(args: { onHand: DecimalInput; onOrder: DecimalInput; level: DecimalInput; reorderQuantity?: DecimalInput | null; roundUpTo?: DecimalInput | null }): Decimal | null {
  const available = D(args.onHand).add(D(args.onOrder));
  const level = D(args.level);
  if (level.lte(0) || available.gte(level)) return null;
  let qty = args.reorderQuantity != null && D(args.reorderQuantity).gt(0) ? D(args.reorderQuantity) : level.sub(available);
  const step = args.roundUpTo != null ? D(args.roundUpTo) : null;
  if (step && step.gt(0)) qty = qty.div(step).ceil().mul(step);
  return roundQuantity(qty);
}
