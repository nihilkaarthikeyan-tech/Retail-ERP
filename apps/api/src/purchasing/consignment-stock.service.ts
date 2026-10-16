// Copyright (c) 2026, Rademics. All rights reserved.
// Supplier sale-or-return (plan 11 part 2 §3): loads one store's sale-or-return
// receipts, returns to suppliers and till movements of some items, and works out
// which supplier's goods the till sold (rule in packages/shared/src/consignment.ts:
// sale-or-return goods are sold first, oldest receipt first).
import { Injectable } from '@nestjs/common';
import { allocateConsignment, type ConsignmentEvent, type ConsignmentLayer, Decimal, roundTo } from 'shared';
import type { Db } from '../audit/audit.service.js';
import { D, fromIso, iso } from './purchase-common.service.js';

/** One sale-or-return receipt line with what happened to it. */
export interface ConsignmentLayerRow extends ConsignmentLayer {
  itemId: string;
  receiptId: string;
  receiptNumber: string;
  postingDate: string;
  /** Units already settled by a statement's bill. */
  billed: Decimal;
  gstRate: string;
}

export interface ConsignmentPicture {
  layers: ConsignmentLayerRow[];
  /** Sale-or-return receipt lines (positive basic units), for per-period totals. */
  receipts: { lineId: string; itemId: string; supplierId: string; postingDate: string; quantity: Decimal }[];
  /** Returns to suppliers (positive basic units), against their original receipt line. */
  returns: { lineId: string; originalLineId: string; itemId: string; supplierId: string; postingDate: string; quantity: Decimal }[];
}

const live = { notIn: ['draft' as const, 'cancelled' as const] };

@Injectable()
export class ConsignmentStock {
  /**
   * Everything about these items' sale-or-return goods at one store, up to and
   * including `asOf` (a business date; everything when left out).
   */
  async picture(db: Db, storeId: string, itemIds: string[], asOf?: string): Promise<ConsignmentPicture> {
    if (!itemIds.length) return { layers: [], receipts: [], returns: [] };
    const upTo = asOf ? { postingDate: { lte: fromIso(asOf) } } : {};
    const receiptLines = await db.goodsReceiptLine.findMany({
      where: { itemId: { in: itemIds }, receipt: { storeId, isConsignment: true, isReturn: false, status: live, ...upTo } },
      include: { receipt: { select: { id: true, number: true, supplierId: true, postingAt: true, postingDate: true } } },
    });
    if (!receiptLines.length) return { layers: [], receipts: [], returns: [] };
    const returnLines = await db.goodsReceiptLine.findMany({
      where: { itemId: { in: itemIds }, returnOfLineId: { not: null }, receipt: { storeId, isReturn: true, status: { not: 'cancelled' }, returnOf: { isConsignment: true }, ...upTo } },
      include: { receipt: { select: { supplierId: true, postingAt: true, postingDate: true } } },
    });
    const locations = (await db.stockLocation.findMany({ where: { storeId }, select: { id: true } })).map((l) => l.id);
    const firstAt = new Map<string, Date>();
    for (const l of receiptLines) {
      const at = firstAt.get(l.itemId);
      if (!at || l.receipt.postingAt < at) firstAt.set(l.itemId, l.receipt.postingAt);
    }
    // Till movements after the first sale-or-return receipt of each item (earlier ones cannot touch it).
    const till = await db.stockLedgerEntry.findMany({
      where: {
        documentType: 'pos_bill',
        locationId: { in: locations },
        OR: [...firstAt.entries()].map(([itemId, at]) => ({ itemId, postingAt: { gte: at } })),
        ...upTo,
      },
      select: { id: true, itemId: true, postingAt: true, quantityChange: true },
      orderBy: [{ postingAt: 'asc' }, { id: 'asc' }],
    });

    const layers: ConsignmentLayerRow[] = [];
    for (const itemId of itemIds) {
      const mine = receiptLines.filter((l) => l.itemId === itemId);
      if (!mine.length) continue;
      const events: ConsignmentEvent[] = [];
      for (const l of mine) {
        const basic = D(l.basicAcceptedQuantity).add(D(l.basicRejectedQuantity));
        events.push({ kind: 'receipt', at: l.receipt.postingAt.getTime(), seq: l.lineNo, lineId: l.id, supplierId: l.receipt.supplierId, rate: rateOf(l.taxableAmount, basic), accepted: l.basicAcceptedQuantity.toString(), rejected: l.basicRejectedQuantity.toString() });
      }
      for (const r of returnLines.filter((x) => x.itemId === itemId)) {
        events.push({ kind: 'supplier_return', at: r.receipt.postingAt.getTime(), seq: r.lineNo, lineId: r.returnOfLineId!, accepted: D(r.basicAcceptedQuantity).abs().toString(), rejected: D(r.basicRejectedQuantity).abs().toString() });
      }
      for (const t of till.filter((x) => x.itemId === itemId)) events.push({ kind: 'till', at: t.postingAt.getTime(), seq: Number(t.id), quantity: t.quantityChange.toString() });
      const result = allocateConsignment(events);
      for (const l of mine) {
        const r = result.get(l.id)!;
        layers.push({ ...r, itemId, receiptId: l.receipt.id, receiptNumber: l.receipt.number, postingDate: iso(l.receipt.postingDate)!, billed: D(l.billedQuantity), gstRate: l.gstRate.toString() });
      }
    }
    return {
      layers,
      receipts: receiptLines.map((l) => ({ lineId: l.id, itemId: l.itemId, supplierId: l.receipt.supplierId, postingDate: iso(l.receipt.postingDate)!, quantity: D(l.basicAcceptedQuantity).add(D(l.basicRejectedQuantity)) })),
      returns: returnLines.map((r) => ({
        lineId: r.id,
        originalLineId: r.returnOfLineId!,
        itemId: r.itemId,
        supplierId: r.receipt.supplierId,
        postingDate: iso(r.receipt.postingDate)!,
        quantity: D(r.basicAcceptedQuantity).add(D(r.basicRejectedQuantity)).abs(),
      })),
    };
  }

  /** Units of a supplier's sale-or-return goods of an item still in the store (not sold, not returned). */
  async held(db: Db, storeId: string, itemId: string, supplierId: string): Promise<Decimal> {
    const p = await this.picture(db, storeId, [itemId]);
    return p.layers.filter((l) => l.supplierId === supplierId).reduce((s, l) => s.add(l.held), new Decimal(0));
  }
}

/** The agreed rate per basic unit: the line's taxable amount over the units received. */
export function rateOf(taxable: { toString(): string }, basicQuantity: Decimal): Decimal {
  return basicQuantity.gt(0) ? roundTo(D(taxable).div(basicQuantity), 4) : new Decimal(0);
}
