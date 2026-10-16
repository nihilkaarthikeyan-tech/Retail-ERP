// Copyright (c) 2026, Rademics. All rights reserved.
// Supplier sale-or-return (plan 11 part 2 §3): which till sales used up which
// supplier's sale-or-return goods. Pure functions; the API feeds them the
// receipts, returns to suppliers and till movements of one item at one store.
//
// The rule (agreed simplest rule, documented in docs/plans/11-shop-extras-part2.md):
// - Every sale-or-return receipt line is a "layer" of that supplier's goods at its agreed rate.
// - Till sales of the item at that store use up sale-or-return goods first, oldest layer first,
//   before any of the shop's own stock of the same item. Only accepted goods can be sold.
// - A till return (or a cancelled till bill) gives back the most recently used-up units first,
//   so they count as sale-or-return goods again (and are no longer "sold").
// - A return to the supplier takes the goods from its own receipt line first, then from the same
//   supplier's newer layers of the item.
import { Decimal, type DecimalInput, roundMoney } from './rounding.js';

export type ConsignmentEvent =
  /** Goods received on sale or return (basic units). */
  | { kind: 'receipt'; at: number; seq?: number; lineId: string; supplierId: string; rate: DecimalInput; accepted: DecimalInput; rejected?: DecimalInput }
  /** Goods given back to the supplier (positive basic units). */
  | { kind: 'supplier_return'; at: number; seq?: number; lineId: string; accepted: DecimalInput; rejected?: DecimalInput }
  /** A till movement of the item at the store: negative = sold, positive = returned or cancelled. */
  | { kind: 'till'; at: number; seq?: number; quantity: DecimalInput };

export interface ConsignmentLayer {
  lineId: string;
  supplierId: string;
  /** Agreed rate per basic unit. */
  rate: Decimal;
  received: Decimal;
  returned: Decimal;
  sold: Decimal;
  /** Still in the shop: accepted not sold plus rejected not returned. */
  held: Decimal;
}

const ORDER: Record<ConsignmentEvent['kind'], number> = { receipt: 0, supplier_return: 1, till: 2 };

/**
 * Plays the events in time order (receipts before returns before till movements
 * at the same instant) and returns each layer's received, returned, sold and held.
 */
export function allocateConsignment(events: ConsignmentEvent[]): Map<string, ConsignmentLayer> {
  const sorted = [...events].sort((a, b) => a.at - b.at || ORDER[a.kind] - ORDER[b.kind] || (a.seq ?? 0) - (b.seq ?? 0));
  const layers = new Map<string, ConsignmentLayer & { saleable: Decimal; rejectedHeld: Decimal }>();
  const order: string[] = [];
  /** Units used up by till sales, most recent last. */
  const used: { lineId: string; qty: Decimal }[] = [];

  for (const e of sorted) {
    if (e.kind === 'receipt') {
      const accepted = new Decimal(e.accepted);
      const rejected = new Decimal(e.rejected ?? 0);
      const existing = layers.get(e.lineId);
      if (existing) {
        existing.received = existing.received.add(accepted).add(rejected);
        existing.saleable = existing.saleable.add(accepted);
        existing.rejectedHeld = existing.rejectedHeld.add(rejected);
        continue;
      }
      layers.set(e.lineId, { lineId: e.lineId, supplierId: e.supplierId, rate: new Decimal(e.rate), received: accepted.add(rejected), returned: new Decimal(0), sold: new Decimal(0), held: new Decimal(0), saleable: accepted, rejectedHeld: rejected });
      order.push(e.lineId);
    } else if (e.kind === 'supplier_return') {
      const own = layers.get(e.lineId);
      if (!own) continue;
      const rejected = Decimal.min(new Decimal(e.rejected ?? 0), own.rejectedHeld);
      own.rejectedHeld = own.rejectedHeld.sub(rejected);
      own.returned = own.returned.add(rejected);
      let left = new Decimal(e.accepted);
      // Its own line first, then the same supplier's newer layers of the item.
      const candidates = [own, ...order.map((id) => layers.get(id)!).filter((l) => l !== own && l.supplierId === own.supplierId).reverse()];
      for (const l of candidates) {
        if (left.lte(0)) break;
        const take = Decimal.min(left, l.saleable);
        if (take.lte(0)) continue;
        l.saleable = l.saleable.sub(take);
        l.returned = l.returned.add(take);
        left = left.sub(take);
      }
    } else {
      const q = new Decimal(e.quantity);
      if (q.lt(0)) {
        let left = q.neg();
        for (const id of order) {
          if (left.lte(0)) break;
          const l = layers.get(id)!;
          const take = Decimal.min(left, l.saleable);
          if (take.lte(0)) continue;
          l.saleable = l.saleable.sub(take);
          l.sold = l.sold.add(take);
          used.push({ lineId: id, qty: take });
          left = left.sub(take);
        }
      } else if (q.gt(0)) {
        let left = q;
        while (left.gt(0) && used.length) {
          const top = used[used.length - 1];
          const take = Decimal.min(left, top.qty);
          const l = layers.get(top.lineId)!;
          l.sold = l.sold.sub(take);
          l.saleable = l.saleable.add(take);
          top.qty = top.qty.sub(take);
          if (top.qty.lte(0)) used.pop();
          left = left.sub(take);
        }
      }
    }
  }

  const out = new Map<string, ConsignmentLayer>();
  for (const id of order) {
    const l = layers.get(id)!;
    out.set(id, { lineId: l.lineId, supplierId: l.supplierId, rate: l.rate, received: l.received, returned: l.returned, sold: l.sold, held: l.saleable.add(l.rejectedHeld) });
  }
  return out;
}

/**
 * What a statement settles on one layer: the units sold so far that no earlier
 * statement has billed. Never negative (a unit sold, billed, returned by the
 * customer and sold again is not billed twice).
 */
export function unsettledSold(soldToDate: DecimalInput, alreadyBilled: DecimalInput): Decimal {
  return Decimal.max(0, new Decimal(soldToDate).sub(new Decimal(alreadyBilled)));
}

/** Amount owed for sold units at the agreed rate, to the paisa. */
export function consignmentAmount(quantity: DecimalInput, rate: DecimalInput): Decimal {
  return roundMoney(new Decimal(quantity).mul(new Decimal(rate)));
}
