// Copyright (c) 2026, Rademics. All rights reserved.
// Customer credit at the till and stock set aside for customer orders (plan 11
// part 2). An advance is a customer receipt (a Payment with orderId) that shows
// as a credit on the customer's balance (blueprint 12). A till bill uses it by
// carrying that amount "on account" and linking the receipt to the bill, so the
// receivable and the advance net to zero and nothing stays open. Advances of an
// order still open or ready belong to that order; once the order is cancelled
// with the credit kept (or collected with some left), they are free credit.
import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from 'shared';
import type { Db } from '../audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { D } from './pos-common.service.js';

/** An advance with what is still unused on it, oldest first. */
export interface OpenAdvance {
  paymentId: string;
  number: string | null;
  orderId: string | null;
  unused: Decimal;
}

@Injectable()
export class PosCredit {
  constructor(private readonly ledger: LedgerService) {}

  /** Serialises everything that uses or links a customer's credit (as the payment matching tool does). */
  async lock(tx: Db, customerId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settle|customer|${customerId}`}))`;
  }

  /** The customer's receipts with something unused on them, oldest first. */
  private async openReceipts(db: Db, customerId: string): Promise<OpenAdvance[]> {
    const items = (await this.ledger.openItems(db, 'customer', customerId)).filter((i) => i.itemType === 'payment' && i.owed.lt(0));
    if (!items.length) return [];
    const payments = await db.payment.findMany({ where: { id: { in: items.map((i) => i.itemId) }, kind: 'receipt', status: 'posted' }, select: { id: true, number: true, orderId: true, paymentDate: true, createdAt: true } });
    const byId = new Map(payments.map((p) => [p.id, p]));
    return items
      .filter((i) => byId.has(i.itemId))
      .map((i) => ({ paymentId: i.itemId, number: byId.get(i.itemId)!.number, orderId: byId.get(i.itemId)!.orderId, unused: i.owed.neg(), at: byId.get(i.itemId)!.createdAt.getTime() }))
      .sort((a, b) => a.at - b.at)
      .map(({ at: _at, ...r }) => r);
  }

  /** The advances of one order still unused. */
  async orderAdvances(db: Db, customerId: string, orderId: string): Promise<OpenAdvance[]> {
    return (await this.openReceipts(db, customerId)).filter((r) => r.orderId === orderId);
  }

  /** Credit the customer may use on any bill: receipts not held for an order that is still open or ready. */
  async freeCredit(db: Db, customerId: string): Promise<OpenAdvance[]> {
    const open = await this.openReceipts(db, customerId);
    const orderIds = [...new Set(open.map((r) => r.orderId).filter((x): x is string => !!x))];
    const held = new Set(
      (await db.customerOrder.findMany({ where: { id: { in: orderIds }, status: { in: ['open', 'ready'] } }, select: { id: true } })).map((o) => o.id),
    );
    return open.filter((r) => !r.orderId || !held.has(r.orderId));
  }

  static total(rows: OpenAdvance[]): Decimal {
    return rows.reduce((s, r) => s.add(r.unused), new Decimal(0));
  }

  /**
   * Links advances (oldest first) to a till bill for `amount`. Called inside
   * the bill's transaction after lock(); refuses when less is left than planned
   * (another till used it a moment ago).
   */
  async useOnBill(tx: Db, s: { companyId: string; customerId: string; billId: string; date: string; actorId: string | null; amount: Decimal; from: OpenAdvance[] }): Promise<void> {
    let left = s.amount;
    for (const a of s.from) {
      if (left.lte(0)) break;
      const take = Decimal.min(left, a.unused);
      if (take.lte(0)) continue;
      await this.ledger.link(tx, { companyId: s.companyId, partyType: 'customer', partyId: s.customerId, billType: 'pos_bill', billId: s.billId, byType: 'payment', byId: a.paymentId, amount: take, date: s.date, actorId: s.actorId });
      left = left.sub(take);
    }
    if (left.gt(0)) throw new BadRequestException(`Only ₹${s.amount.sub(left).toFixed(2)} of the customer’s advance is left; check the payment again`);
  }

  // ---- Stock set aside for ready orders ----

  /** Quantities (basic unit) set aside at a location, per item, leaving out one order's own. */
  async reserved(db: Db, locationId: string, itemIds: string[], exceptOrderId: string | null = null): Promise<Map<string, Decimal>> {
    const out = new Map<string, Decimal>();
    if (!itemIds.length) return out;
    const exceptLines = exceptOrderId ? (await db.customerOrderLine.findMany({ where: { orderId: exceptOrderId }, select: { id: true } })).map((l) => l.id) : [];
    const rows = await db.stockReservation.groupBy({
      by: ['itemId'],
      where: { locationId, itemId: { in: itemIds }, releasedAt: null, ...(exceptLines.length ? { orderLineId: { notIn: exceptLines } } : {}) },
      _sum: { quantity: true },
    });
    for (const r of rows) out.set(r.itemId, D(r._sum.quantity ?? 0));
    return out;
  }

  /** Sets aside a ready order's goods at the store's selling location (basic units). */
  async reserve(tx: Db, s: { companyId: string; orderId: string; locationId: string; actorId: string | null }): Promise<void> {
    const lines = await tx.customerOrderLine.findMany({ where: { orderId: s.orderId } });
    const units = await tx.itemUnit.findMany({ where: { OR: lines.map((l) => ({ itemId: l.itemId, unitId: l.unitId })) } });
    const items = await tx.item.findMany({ where: { id: { in: lines.map((l) => l.itemId) } }, select: { id: true, isStockItem: true } });
    const stockItem = new Set(items.filter((i) => i.isStockItem).map((i) => i.id));
    const data = lines
      .filter((l) => stockItem.has(l.itemId))
      .map((l) => {
        const factor = D(units.find((u) => u.itemId === l.itemId && u.unitId === l.unitId)?.factor ?? 1);
        return { companyId: s.companyId, itemId: l.itemId, locationId: s.locationId, quantity: D(l.quantity).mul(factor).toDecimalPlaces(3).toString(), orderLineId: l.id, createdById: s.actorId };
      });
    if (data.length) await tx.stockReservation.createMany({ data });
  }

  async release(tx: Db, orderId: string): Promise<void> {
    const lines = (await tx.customerOrderLine.findMany({ where: { orderId }, select: { id: true } })).map((l) => l.id);
    if (lines.length) await tx.stockReservation.updateMany({ where: { orderLineId: { in: lines }, releasedAt: null }, data: { releasedAt: new Date() } });
  }
}
