// Copyright (c) 2026, Rademics. All rights reserved.
// Extra charges on goods received (blueprint 07 process 7): freight, loading
// or insurance shared over receipt lines and added to their stock cost. The
// receipt entries are revalued and every later movement is re-costed by the
// stock engine in the same transaction (rules 5 and 6).
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type CurrentUser,
  Decimal,
  hasPermission,
  type LandedChargeInput,
  manualSharesProblem,
  shareCharges,
  unitCostPerBasicUnit,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { assertStoreAccess } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { StockEngine } from '../inventory/stock-engine.service.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, fromIso, iso, PurchaseCommon } from './purchase-common.service.js';

const chargeInclude = {
  items: { orderBy: { lineNo: 'asc' } },
  shares: { include: { receiptLine: { include: { item: { select: { id: true, code: true, name: true } }, receipt: { select: { id: true, number: true, storeId: true } } } } } },
} satisfies Prisma.LandedChargeInclude;
type ChargeRow = Prisma.LandedChargeGetPayload<{ include: typeof chargeInclude }>;

@Injectable()
export class LandedChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly common: PurchaseCommon,
    private readonly engine: StockEngine,
  ) {}

  async list(user: CurrentUser) {
    const company = await this.common.currentCompany();
    const rows = await this.prisma.landedCharge.findMany({ where: { companyId: company.id }, include: chargeInclude, orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }], take: 200 });
    return rows.filter((c) => this.visible(c, user)).map((c) => this.toDto(c, user));
  }

  async get(id: string, user: CurrentUser) {
    const c = await this.getRow(this.prisma, id);
    if (!this.visible(c, user)) throw new ForbiddenException('You are not allowed to work in this store');
    return this.toDto(c, user);
  }

  private async getRow(db: Db, id: string): Promise<ChargeRow> {
    const c = await db.landedCharge.findUnique({ where: { id }, include: chargeInclude });
    if (!c) throw new NotFoundException('Extra charge entry not found');
    return c;
  }

  /** The shares the charges would make, without saving anything. */
  async preview(input: LandedChargeInput, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.charges');
    const company = await this.common.currentCompany();
    const { shares, total } = await this.compute(this.prisma, company.id, input, user);
    return { total: total.toFixed(2), shares: shares.map((s) => ({ receiptLineId: s.line.id, receipt: s.line.receipt.number, item: { code: s.line.item.code, name: s.line.item.name }, quantity: s.basic.toString(), value: D(s.line.taxableAmount).toFixed(2), share: s.amount.toFixed(2) })) };
  }

  async create(input: LandedChargeInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.charges');
    const company = await this.common.currentCompany();
    const postingDate = input.postingDate ?? businessDate();
    await this.common.checkStockDate(this.prisma, company.id, postingDate, 'Extra charges');
    const { shares, total } = await this.compute(this.prisma, company.id, input, user);
    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.common.allocate(tx, { companyId: company.id, documentKind: 'landed_charge', date: postingDate });
      const c = await tx.landedCharge.create({
        data: {
          companyId: company.id,
          number,
          postingDate: fromIso(postingDate),
          shareBy: input.shareBy,
          transporterBillId: input.transporterBillId ?? null,
          total: total.toFixed(2),
          receiptIds: input.receiptIds,
          remarks: input.remarks ?? null,
          items: { create: input.charges.map((ch, i) => ({ lineNo: i + 1, description: ch.description, chargeType: ch.chargeType, amount: D(ch.amount).toFixed(2) })) },
          shares: { create: shares.map((s) => ({ receiptLineId: s.line.id, amount: s.amount.toFixed(2) })) },
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'landed_charge', entityId: c.id, changes: { number, total: total.toFixed(2), shareBy: input.shareBy, receipts: input.receiptIds.length } });
      return this.getRow(tx, c.id);
    });
    return this.toDto(created, user);
  }

  /** Works out each received line's share (blueprint 07 calculations). */
  private async compute(db: Db, companyId: string, input: LandedChargeInput, user: CurrentUser) {
    const receipts = await db.goodsReceipt.findMany({ where: { id: { in: input.receiptIds } }, include: { lines: { orderBy: { lineNo: 'asc' }, include: { item: true, receipt: true } } } });
    if (receipts.length !== new Set(input.receiptIds).size) throw new BadRequestException('Goods receipt not found');
    for (const r of receipts) {
      if (r.companyId !== companyId) throw new BadRequestException('Goods receipt not found');
      if (r.isReturn) throw new BadRequestException(`${r.number} is a return`);
      if (['draft', 'cancelled'].includes(r.status)) throw new BadRequestException(`Goods receipt ${r.number} is ${r.status}`);
      assertStoreAccess(user, r.storeId);
    }
    if (input.transporterBillId) {
      const bill = await db.supplierBill.findUnique({ where: { id: input.transporterBillId } });
      if (!bill || bill.companyId !== companyId || bill.kind !== 'services' || bill.status === 'cancelled') throw new BadRequestException('The transporter’s bill must be a services bill');
    }
    const lines = receipts.flatMap((r) => r.lines).filter((l) => l.item.isStockItem);
    if (!lines.length) throw new BadRequestException('The receipts have no stock lines');
    const total = input.charges.reduce((s, c) => s.add(D(c.amount)), new Decimal(0));
    const basicOf = (l: (typeof lines)[number]) => D(l.basicAcceptedQuantity).add(D(l.basicRejectedQuantity));

    let amounts: Decimal[];
    if (input.shareBy === 'manual') {
      const given = new Map((input.manualShares ?? []).map((s) => [s.receiptLineId, s.amount]));
      for (const id of given.keys()) if (!lines.some((l) => l.id === id)) throw new BadRequestException('A share names a line that is not on these receipts');
      amounts = lines.map((l) => D(given.get(l.id) ?? '0'));
      const problem = manualSharesProblem(total, amounts);
      if (problem) throw new BadRequestException(problem);
      // Keep the books exact: any paise of tolerance go on the last line.
      const diff = total.sub(amounts.reduce((s, a) => s.add(a), new Decimal(0)));
      amounts[amounts.length - 1] = amounts[amounts.length - 1].add(diff);
    } else {
      try {
        amounts = shareCharges(total, lines.map((l) => ({ key: l.id, quantity: basicOf(l), value: l.taxableAmount.toString() })), input.shareBy).map((s) => s.amount);
      } catch (err) {
        throw new BadRequestException(err instanceof Error ? err.message : String(err));
      }
    }
    return { total, shares: lines.map((l, i) => ({ line: l, basic: basicOf(l), amount: amounts[i] })).filter((s) => s.amount.gt(0) || input.shareBy !== 'manual') };
  }

  async finalise(id: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.charges');
    const c = await this.getRow(this.prisma, id);
    if (!this.visible(c, user)) throw new ForbiddenException('You are not allowed to work in this store');
    if (c.status !== 'draft') throw new BadRequestException(`The entry is already ${c.status}`);
    await this.common.checkStockDate(this.prisma, c.companyId, iso(c.postingDate)!, 'Extra charges');
    const after = await this.prisma.$transaction(
      async (tx) => {
        await this.apply(tx, c, 1, actor, user);
        await tx.landedCharge.update({ where: { id }, data: { status: 'finalised', finalisedAt: new Date(), finalisedById: actor.userId, updatedById: actor.userId } });
        await this.audit.record(tx, actor, { action: 'update', entityType: 'landed_charge', entityId: id, changes: { status: { old: 'draft', new: 'finalised' }, number: c.number, total: c.total.toString() } });
        return this.getRow(tx, id);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.toDto(after, user);
  }

  async cancel(id: string, reason: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.charges');
    const c = await this.getRow(this.prisma, id);
    if (!this.visible(c, user)) throw new ForbiddenException('You are not allowed to work in this store');
    if (c.status === 'cancelled') throw new BadRequestException('Already cancelled');
    if (c.status === 'finalised' && iso(c.postingDate)!.slice(0, 7) < businessDate().slice(0, 7) && !hasPermission(user, 'stock.backdate')) {
      throw new ForbiddenException('Only the Accountant may cancel extra charges from an earlier month');
    }
    const after = await this.prisma.$transaction(
      async (tx) => {
        if (c.status === 'finalised') await this.apply(tx, c, -1, actor, user);
        await tx.landedCharge.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason, updatedById: actor.userId } });
        await this.audit.record(tx, actor, { action: 'update', entityType: 'landed_charge', entityId: id, changes: { status: { old: c.status, new: 'cancelled' }, number: c.number }, reason });
        return this.getRow(tx, id);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.toDto(after, user);
  }

  /** Adds (or takes back) the shares and revalues the receipt entries; the engine re-costs what came after. */
  private async apply(tx: Db, c: ChargeRow, sign: 1 | -1, actor: Actor, user: CurrentUser) {
    const changes: { entryId: bigint; incomingCost: string }[] = [];
    const receiptIds = new Set<string>();
    for (const s of [...c.shares].sort((a, b) => a.receiptLineId.localeCompare(b.receiptLineId))) {
      await tx.$queryRaw`SELECT 1 FROM "GoodsReceiptLine" WHERE "id" = ${s.receiptLineId}::uuid FOR UPDATE`;
      const line = await tx.goodsReceiptLine.findUniqueOrThrow({ where: { id: s.receiptLineId }, include: { receipt: true } });
      if (line.receipt.status === 'cancelled') throw new BadRequestException(`Goods receipt ${line.receipt.number} is cancelled`);
      const extra = D(line.extraCharges).add(D(s.amount).mul(sign));
      if (extra.lt(0)) throw new BadRequestException('Extra charges on a line cannot go below zero');
      const basic = D(line.basicAcceptedQuantity).add(D(line.basicRejectedQuantity));
      const cost = unitCostPerBasicUnit({ taxable: line.taxableAmount.toString(), extraCharges: extra, basicQuantity: basic });
      await tx.goodsReceiptLine.update({ where: { id: line.id }, data: { extraCharges: extra.toFixed(2), unitCost: cost.toFixed(4) } });
      const entries = await tx.stockLedgerEntry.findMany({ where: { documentId: line.receiptId, documentLineId: line.id, kind: 'in', isCancellation: false } });
      for (const e of entries) changes.push({ entryId: e.id, incomingCost: cost.toFixed(4) });
      receiptIds.add(line.receiptId);
    }
    await this.engine.revalueIncoming(tx, changes, { allowNegative: true, actorId: actor.userId });
    for (const rid of receiptIds) {
      const sum = await tx.stockLedgerEntry.aggregate({ where: { documentId: rid, isCancellation: false }, _sum: { valueChange: true } });
      await tx.goodsReceipt.update({ where: { id: rid }, data: { stockValue: D(sum._sum.valueChange ?? '0').toFixed(2) } });
    }
    void user;
  }

  private visible(c: ChargeRow, user: CurrentUser): boolean {
    if (user.allStores) return true;
    return c.shares.some((s) => user.stores.some((u) => u.id === s.receiptLine.receipt.storeId));
  }

  private toDto(c: ChargeRow, user: CurrentUser) {
    const costs = hasPermission(user, 'stock.cost.view') || hasPermission(user, 'buying_prices.view');
    return {
      id: c.id,
      number: c.number,
      status: c.status,
      postingDate: iso(c.postingDate),
      shareBy: c.shareBy,
      receiptIds: c.receiptIds,
      transporterBillId: c.transporterBillId,
      remarks: c.remarks,
      cancelReason: c.cancelReason,
      ...(costs
        ? {
            total: c.total.toFixed(2),
            charges: c.items.map((i) => ({ description: i.description, chargeType: i.chargeType, amount: i.amount.toFixed(2) })),
            shares: c.shares.map((s) => ({ receiptLineId: s.receiptLineId, receipt: s.receiptLine.receipt.number, item: s.receiptLine.item, amount: s.amount.toFixed(2) })),
          }
        : {}),
      createdAt: c.createdAt,
      finalisedAt: c.finalisedAt,
    };
  }
}
