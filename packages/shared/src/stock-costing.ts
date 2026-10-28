// Copyright (c) 2026, Rademics. All rights reserved.
// Moving-average stock costing (blueprint 08 process 2; decisions 33–34).
// Pure functions: the API replays ledger entries through `replay` both when
// posting and when re-costing after a back-dated or cancelled movement.
import { Decimal, type DecimalInput, roundMoney, roundQuantity, roundTo } from './rounding.js';

export const UNIT_COST_DECIMALS = 4;
/** Quantities this close to zero count as zero (blueprint 08: rounding tolerance). */
export const QUANTITY_TOLERANCE = new Decimal('0.0001');

export interface StockState {
  quantity: Decimal;
  unitCost: Decimal;
  value: Decimal;
}

export const EMPTY_STATE: StockState = { quantity: new Decimal(0), unitCost: new Decimal(0), value: new Decimal(0) };

/**
 * What a ledger line asks for. The derived figures (quantity change for
 * counts, value change, state after) are worked out by `apply`.
 * - `in`: goods arrive at `incomingCost` per unit.
 * - `out`: goods leave at the current average cost (or `fixedCost` when the
 *   cost comes from a linked line, e.g. receiving a transfer out of transit).
 * - `set`: a count sets the quantity (and optionally the cost).
 * - `reverse`: undoes another line's quantity and value exactly (cancelling).
 */
export type StockIntent =
  | { kind: 'in'; quantity: DecimalInput; incomingCost: DecimalInput; incomingValue?: DecimalInput | null }
  | { kind: 'out'; quantity: DecimalInput; fixedCost?: DecimalInput | null }
  | { kind: 'set'; targetQuantity: DecimalInput; targetCost?: DecimalInput | null }
  | { kind: 'reverse'; quantityChange: DecimalInput; valueChange: DecimalInput };

export interface AppliedLine {
  quantityChange: Decimal;
  valueChange: Decimal;
  /** Cost per unit the line moved at (incoming, average or fixed). */
  unitCost: Decimal;
  after: StockState;
}

function roundCost(v: Decimal): Decimal {
  return roundTo(v, UNIT_COST_DECIMALS);
}

function isZero(q: Decimal): boolean {
  return q.abs().lte(QUANTITY_TOLERANCE);
}

function stateFrom(quantity: Decimal, value: Decimal, fallbackCost: Decimal): StockState {
  if (isZero(quantity)) return { quantity: new Decimal(0), unitCost: fallbackCost, value: new Decimal(0) };
  if (quantity.gt(0)) return { quantity, unitCost: roundCost(value.div(quantity)), value };
  // Negative stock (only the till may cause it): keep the last known cost.
  return { quantity, unitCost: fallbackCost, value };
}

/**
 * Applies one line to a state. `fallbackCost` is used when goods leave and the
 * position has no cost yet (selling beyond stock, blueprint 08 "fallback cost").
 */
export function apply(before: StockState, intent: StockIntent, fallbackCost?: DecimalInput | null): AppliedLine {
  // Goods in stock leave at their own cost, even when it is 0 (free goods; audit 3, 28 October 2026);
  // the fallback cost is only for selling beyond stock with no cost known.
  const inStock = before.quantity.gt(QUANTITY_TOLERANCE);
  const currentCost = inStock || before.unitCost.gt(0) ? before.unitCost : fallbackCost != null ? new Decimal(fallbackCost) : null;

  switch (intent.kind) {
    case 'in': {
      const q = roundQuantity(intent.quantity);
      const c = roundCost(new Decimal(intent.incomingCost));
      if (q.lte(0)) throw new Error('Incoming quantity must be above zero');
      if (c.lt(0)) throw new Error('Cost cannot be negative');
      const quantity = roundQuantity(before.quantity.add(q));
      let value: Decimal;
      if (before.quantity.lte(0)) {
        // Q₀ ≤ 0: the new cost is simply the incoming cost (blueprint 08 calculations).
        value = roundMoney(quantity.mul(c));
        const after = isZero(quantity) ? { quantity: new Decimal(0), unitCost: c, value: new Decimal(0) } : { quantity, unitCost: c, value };
        return { quantityChange: q, valueChange: after.value.sub(before.value), unitCost: c, after };
      }
      // Audit 3 (28 October 2026): goods coming from another movement (a transfer) bring exactly the
      // value that left there, not quantity × the rounded unit cost, so no paise stay in clearing.
      value = before.value.add(intent.incomingValue != null ? roundMoney(new Decimal(intent.incomingValue)) : roundMoney(q.mul(c)));
      return { quantityChange: q, valueChange: value.sub(before.value), unitCost: c, after: stateFrom(quantity, value, c) };
    }

    case 'out': {
      const q = roundQuantity(intent.quantity);
      if (q.lte(0)) throw new Error('Outgoing quantity must be above zero');
      const cost = intent.fixedCost != null ? roundCost(new Decimal(intent.fixedCost)) : currentCost;
      if (cost === null) throw new Error('MISSING_COST');
      const quantity = roundQuantity(before.quantity.sub(q));
      // Taking out the last units takes out the whole remaining value (no paise left behind). Audit 3
      // (28 October 2026): at a fixed cost too (a return to the supplier, goods out of transit), or the
      // position would show nothing left while its movements still add up to a value.
      const valueChange = isZero(quantity) ? before.value.neg() : roundMoney(q.mul(cost)).neg();
      const value = before.value.add(valueChange);
      return { quantityChange: q.neg(), valueChange, unitCost: cost, after: stateFrom(quantity, value, cost) };
    }

    case 'set': {
      const target = roundQuantity(intent.targetQuantity);
      if (target.lt(0)) throw new Error('Counted quantity cannot be negative');
      const cost = intent.targetCost != null ? roundCost(new Decimal(intent.targetCost)) : currentCost;
      if (cost === null) {
        if (!target.isZero()) throw new Error('MISSING_COST');
      }
      const c = cost ?? new Decimal(0);
      const value = isZero(target) ? new Decimal(0) : roundMoney(target.mul(c));
      const after: StockState = isZero(target) ? { quantity: new Decimal(0), unitCost: c, value } : { quantity: target, unitCost: c, value };
      return { quantityChange: target.sub(before.quantity), valueChange: value.sub(before.value), unitCost: c, after };
    }

    case 'reverse': {
      const qc = new Decimal(intent.quantityChange).neg();
      const vc = new Decimal(intent.valueChange).neg();
      const quantity = roundQuantity(before.quantity.add(qc));
      const value = before.value.add(vc);
      const fallback = before.unitCost;
      return { quantityChange: qc, valueChange: vc, unitCost: qc.isZero() ? fallback : roundCost(vc.div(qc).abs()), after: stateFrom(quantity, value, fallback) };
    }
  }
}

/** Applies lines in order; returns each result and the final state. */
export function replay(start: StockState, intents: StockIntent[], fallbackCost?: DecimalInput | null): { lines: AppliedLine[]; end: StockState } {
  let state = start;
  const lines: AppliedLine[] = [];
  for (const intent of intents) {
    const applied = apply(state, intent, fallbackCost);
    lines.push(applied);
    state = applied.after;
  }
  return { lines, end: state };
}

/** The lowest quantity reached across a run of lines (for the negative-stock rule). */
export function lowestQuantity(start: StockState, lines: AppliedLine[]): Decimal {
  return lines.reduce((min, l) => Decimal.min(min, l.after.quantity), start.quantity);
}

/** Batch expiry = manufacture date + shelf life when not typed (blueprint 03). ISO dates. */
export function expiryFromShelfLife(manufactureDate: string, shelfLifeDays: number): string {
  const d = new Date(`${manufactureDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + shelfLifeDays);
  return d.toISOString().slice(0, 10);
}

/** A batch is expired on a date when its expiry date is before that date (usable through its expiry day). */
export function isExpiredOn(expiryDate: string | null, date: string): boolean {
  return expiryDate !== null && expiryDate < date;
}
