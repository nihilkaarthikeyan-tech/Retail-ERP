// Copyright (c) 2026, Rademics. All rights reserved.
// Posts documents made before the books existed (plan 07 §4 "Already in the
// database"): goods receipts, stock movements, supplier bills and closed till
// shifts. It runs at start-up and does nothing once everything is posted, so it
// is safe to run any number of times.
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service.js';
import { PosPostings } from '../pos/pos-postings.service.js';
import { forEachShop } from '../prisma/each-shop.js';
import { PrismaService, SystemPrisma } from '../prisma/prisma.service.js';
import { PurchasePostings } from '../purchasing/purchase-postings.service.js';

@Injectable()
export class CatchUpService implements OnApplicationBootstrap {
  private readonly log = new Logger(CatchUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly system: SystemPrisma,
    private readonly ledger: LedgerService,
    private readonly purchase: PurchasePostings,
    private readonly pos: PosPostings,
  ) {}

  async onApplicationBootstrap() {
    // Plan 14: shop by shop.
    await forEachShop(this.system, this.log, 'Posting earlier documents', async () => {
      const done = await this.run();
      if (done) this.log.log(`Posted ${done} earlier documents to the ledger`);
    });
  }

  /** Returns how many documents were posted. */
  async run(): Promise<number> {
    let count = 0;
    const pending = await this.prisma.stockLedgerEntry.findMany({ where: { ledgerHeld: false }, select: { id: true, documentType: true, documentId: true, valueChange: true, postedValue: true } });
    const unposted = pending.filter((e) => !e.valueChange.equals(e.postedValue));

    // Goods receipts (not returns) post their own split entry; cancelled ones net to zero.
    const receiptIds: string[] = [];
    for (const id of new Set(unposted.filter((e) => e.documentType === 'goods_receipt').map((e) => e.documentId))) {
      const r = await this.prisma.goodsReceipt.findUnique({ where: { id }, select: { status: true, isReturn: true } });
      if (!r || r.isReturn) continue;
      receiptIds.push(id);
      if (await this.prisma.ledgerEntry.count({ where: { documentType: 'goods_receipt', documentId: id } })) continue;
      const ids = unposted.filter((e) => e.documentId === id).map((e) => e.id);
      await this.prisma.$transaction(
        async (tx) => {
          // Audit 2 (28 October 2026): two copies of the API starting at once post it only once.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`catch-up:${id}`}))`;
          if (await tx.ledgerEntry.count({ where: { documentType: 'goods_receipt', documentId: id } })) return;
          if (r.status === 'cancelled') await this.ledger.markPosted(tx, ids);
          else {
            const own = (await tx.stockLedgerEntry.findMany({ where: { id: { in: ids }, isCancellation: false }, select: { id: true } })).map((e) => e.id);
            await this.purchase.goodsReceipt(tx, id, own, null);
          }
        },
        { timeout: 60_000 },
      );
      count++;
    }

    // Till sales: closed shifts post now; open shifts wait for their close.
    const billIds = [...new Set(unposted.filter((e) => e.documentType === 'pos_bill').map((e) => e.documentId))];
    if (billIds.length) {
      const bills = await this.prisma.posBill.findMany({ where: { id: { in: billIds } }, select: { id: true, shiftId: true, shift: { select: { status: true, ledgerEntryId: true } } } });
      const openBills = bills.filter((b) => b.shift.status === 'open').map((b) => b.id);
      if (openBills.length) {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.stock_recost', 'on', true)`;
          await tx.stockLedgerEntry.updateMany({ where: { documentType: 'pos_bill', documentId: { in: openBills } }, data: { ledgerHeld: true } });
        });
      }
    }
    const shifts = await this.prisma.shift.findMany({ where: { status: 'closed', ledgerEntryId: null }, select: { id: true, closedAt: true } });
    for (const s of shifts) {
      const posted = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`catch-up:${s.id}`}))`;
          if ((await tx.shift.findUniqueOrThrow({ where: { id: s.id }, select: { ledgerEntryId: true } })).ledgerEntryId) return false;
          const entryId = await this.pos.postShift(tx, s.id, null);
          await tx.shift.update({ where: { id: s.id }, data: { ledgerEntryId: entryId } });
          return entryId !== null;
        },
        { timeout: 60_000 },
      );
      // A shift with no bills and no cash has nothing to post; it is not counted (it was logged
      // as "Posted 1 earlier documents" at every start; launch check, 27 October 2026).
      if (posted) count++;
    }

    // Every other stock movement posts against its own account role.
    const rest = (await this.prisma.stockLedgerEntry.findMany({ where: { ledgerHeld: false, documentType: { notIn: ['pos_bill'] } }, select: { id: true, documentType: true, documentId: true, valueChange: true, postedValue: true } }))
      .filter((e) => !e.valueChange.equals(e.postedValue))
      .filter((e) => e.documentType !== 'goods_receipt' || !receiptIds.includes(e.documentId));
    if (rest.length) {
      const ids = rest.map((e) => e.id);
      await this.prisma.$transaction(
        async (tx) => {
          // syncStock posts only what is still unposted, read again after the lock.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('catch-up:stock'))`;
          await this.ledger.syncStock(tx, ids, { actorId: null, newIds: new Set(ids) });
        },
        { timeout: 120_000 },
      );
      count += new Set(rest.map((e) => e.documentId)).size;
    }

    // Supplier bills and debit notes that were posted in purchasing.
    const bills = await this.prisma.supplierBill.findMany({ where: { status: 'unpaid' }, select: { id: true }, orderBy: { postingDate: 'asc' } });
    for (const b of bills) {
      if (await this.prisma.ledgerEntry.count({ where: { documentType: 'supplier_bill', documentId: b.id } })) continue;
      await this.prisma.$transaction((tx) => this.purchase.supplierBill(tx, b.id, null), { timeout: 60_000 });
      count++;
    }
    return count;
  }
}
