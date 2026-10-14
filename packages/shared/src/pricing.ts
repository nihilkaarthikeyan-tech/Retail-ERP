// Copyright (c) 2026, Rademics. All rights reserved.
// Choosing the right price for a line (blueprint 04, process 1). The database
// fetching lives in the API; the choice itself is here so it can be tested.
import { Decimal, type DecimalInput, roundMoney } from './rounding.js';

export interface PriceCandidate {
  id: string;
  price: DecimalInput;
  unitId: string;
  /** ISO dates; endDate null = open-ended. */
  startDate: string;
  endDate: string | null;
  customerId: string | null;
  supplierId: string | null;
  batchId: string | null;
  packSize: DecimalInput | null;
}

export interface PriceLookupContext {
  date: string;
  unitId: string;
  quantity: DecimalInput;
  customerId?: string | null;
  supplierId?: string | null;
  batchId?: string | null;
}

function validOn(c: PriceCandidate, date: string): boolean {
  return c.startDate <= date && (c.endDate === null || date <= c.endDate);
}

function partyMatches(c: PriceCandidate, ctx: PriceLookupContext): boolean {
  if (c.customerId && c.customerId !== (ctx.customerId ?? null)) return false;
  if (c.supplierId && c.supplierId !== (ctx.supplierId ?? null)) return false;
  return true;
}

function packSizeOk(c: PriceCandidate, quantity: DecimalInput): boolean {
  if (c.packSize === null) return true;
  const pack = new Decimal(c.packSize);
  if (pack.lte(0)) return true;
  return new Decimal(quantity).mod(pack).isZero();
}

/**
 * Picks the best price among the candidates of ONE price list and item:
 * valid on the date, for this batch or any batch, for this party or general,
 * and (for pack-size prices) only for multiples of the pack. Preference:
 * the party's own price, then a batch price, then a pack-size price, then
 * the latest start date, then the line's own unit. (Blueprint 04 lists the
 * start date before the party's own price, but its edge case says a customer's
 * contract price wins over the general price; the business meaning is used.)
 * Returns null when nothing fits (the caller then widens the search).
 */
export function selectPrice(candidates: PriceCandidate[], ctx: PriceLookupContext): PriceCandidate | null {
  const fitting = candidates.filter(
    (c) =>
      validOn(c, ctx.date) &&
      (c.batchId === null || c.batchId === (ctx.batchId ?? null)) &&
      partyMatches(c, ctx) &&
      packSizeOk(c, ctx.quantity),
  );
  const isParty = (c: PriceCandidate) => c.customerId !== null || c.supplierId !== null;
  fitting.sort((a, b) => {
    const party = Number(isParty(b)) - Number(isParty(a));
    if (party) return party;
    const batch = Number(b.batchId !== null) - Number(a.batchId !== null);
    if (batch) return batch;
    const pack = Number(b.packSize !== null) - Number(a.packSize !== null);
    if (pack) return pack;
    if (a.startDate !== b.startDate) return a.startDate < b.startDate ? 1 : -1;
    const unit = Number(b.unitId === ctx.unitId) - Number(a.unitId === ctx.unitId);
    if (unit) return unit;
    return a.id < b.id ? -1 : 1; // deterministic
  });
  return fitting[0] ?? null;
}

/**
 * The rate for the line from a chosen price. When the price is for another
 * unit: per-basic-unit lists scale by the units' factors; per-unit lists use
 * the price as stored (blueprint 04, process 1, last step).
 */
export function rateForLine(
  chosen: { price: DecimalInput; unitId: string },
  line: { unitId: string; unitFactor: DecimalInput },
  priceUnitFactor: DecimalInput,
  pricesPerUnit: boolean,
): Decimal {
  if (chosen.unitId === line.unitId) return roundMoney(chosen.price);
  if (pricesPerUnit) return roundMoney(chosen.price);
  return roundMoney(new Decimal(chosen.price).div(priceUnitFactor).mul(line.unitFactor));
}
