// Copyright (c) 2026, Rademics. All rights reserved.
// Calculations used across reports and dashboards (blueprint 14 "Calculations";
// plan 09 §4). Pure functions on decimal strings; rounding from rounding.ts.
import { addDays } from './financial-year.js';
import { daysBetween } from './accounting.js';
import { Decimal, type DecimalInput, roundTo } from './rounding.js';

const D = (v: DecimalInput) => new Decimal(v);
const ZERO = new Decimal(0);
const pct = (v: Decimal) => roundTo(v, 2);

/** The period of the same length that ends the day before `from` (both ends included). */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const length = daysBetween(from, to) + 1;
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

/** Change % against the previous period; null when the previous figure is zero (shown as "new"). */
export function changePercent(current: DecimalInput, previous: DecimalInput): Decimal | null {
  const p = D(previous);
  if (p.isZero()) return null;
  return pct(D(current).sub(p).div(p.abs()).mul(100));
}

/** Net sales ÷ number of sale bills; returns reduce the value but are not bills. */
export function averageBill(netSales: DecimalInput, saleBills: number): Decimal {
  return saleBills > 0 ? roundTo(D(netSales).div(saleBills), 2) : ZERO;
}

export function itemsPerBill(quantity: DecimalInput, saleBills: number): Decimal {
  return saleBills > 0 ? roundTo(D(quantity).div(saleBills), 2) : ZERO;
}

/** (net sales − cost of goods sold) ÷ net sales × 100; null when nothing was sold. */
export function grossMarginPercent(netSales: DecimalInput, cost: DecimalInput): Decimal | null {
  const s = D(netSales);
  if (s.isZero()) return null;
  return pct(s.sub(D(cost)).div(s).mul(100));
}

/** Quantity sold ÷ (opening stock + received) × 100. */
export function sellThroughPercent(sold: DecimalInput, opening: DecimalInput, received: DecimalInput): Decimal | null {
  const available = D(opening).add(D(received));
  if (available.lte(0)) return null;
  return pct(D(sold).div(available).mul(100));
}

/** Stock on hand ÷ average daily quantity sold over `days`; null when nothing sold. */
export function daysOfStockLeft(onHand: DecimalInput, soldInPeriod: DecimalInput, days: number): Decimal | null {
  const perDay = D(soldInPeriod).div(days);
  if (perDay.lte(0)) return null;
  return roundTo(Decimal.max(ZERO, D(onHand)).div(perDay), 1);
}

/** Cost of goods sold ÷ average stock value ((opening + closing) ÷ 2). */
export function stockTurnover(cogs: DecimalInput, openingValue: DecimalInput, closingValue: DecimalInput): Decimal | null {
  const average = D(openingValue).add(D(closingValue)).div(2);
  if (average.lte(0)) return null;
  return roundTo(D(cogs).div(average), 2);
}

/** Value lost (write-offs and count shortfalls) ÷ net sales × 100. */
export function shrinkagePercent(lossValue: DecimalInput, netSales: DecimalInput): Decimal | null {
  const s = D(netSales);
  if (s.lte(0)) return null;
  return pct(D(lossValue).div(s).mul(100));
}

export const STOCK_AGE_BANDS = [30, 60, 90, 180] as const;

export function stockAgeLabels(bands: readonly number[] = STOCK_AGE_BANDS): string[] {
  const out: string[] = [];
  let lower = 0;
  for (const b of bands) {
    out.push(lower === 0 ? `0–${b}` : `${lower + 1}–${b}`);
    lower = b;
  }
  out.push(`Over ${lower}`);
  return out;
}

/**
 * Ages the stock on hand, assuming the oldest leaves first: the quantity on
 * hand is matched against the most recent receipts, newest first. Anything not
 * covered by a receipt goes in the oldest band.
 */
export function stockAge(onHand: DecimalInput, receipts: { date: string; quantity: DecimalInput }[], asOf: string, bands: readonly number[] = STOCK_AGE_BANDS): Record<string, Decimal> {
  const labels = stockAgeLabels(bands);
  const out: Record<string, Decimal> = Object.fromEntries(labels.map((l) => [l, ZERO]));
  let left = Decimal.max(ZERO, D(onHand));
  const bandOf = (days: number) => {
    for (const [i, b] of bands.entries()) if (days <= b) return labels[i];
    return labels[labels.length - 1];
  };
  for (const r of [...receipts].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))) {
    if (left.lte(0)) break;
    const take = Decimal.min(left, Decimal.max(ZERO, D(r.quantity)));
    const band = bandOf(Math.max(0, daysBetween(r.date, asOf)));
    out[band] = out[band].add(take);
    left = left.sub(take);
  }
  if (left.gt(0)) out[labels[labels.length - 1]] = out[labels[labels.length - 1]].add(left);
  return out;
}
