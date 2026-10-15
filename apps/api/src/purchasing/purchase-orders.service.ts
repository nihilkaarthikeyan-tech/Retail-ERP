// Copyright (c) 2026, Rademics. All rights reserved.
// Purchase orders (blueprint 07 process 3; plan 05 §1, §4).
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  businessDate,
  type CreatePurchaseOrderInput,
  type CurrentUser,
  Decimal,
  dueDates,
  hasPermission,
  percentDone,
  type PurchaseOrderLineInput,
  type PurchaseOrderQuery,
  type UpdatePurchaseOrderInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { assertStoreAccess } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import type { Prisma, PurchaseOrder, PurchaseOrderStatus, Supplier } from '../generated/prisma/client.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, fromIso, iso, PurchaseCommon } from './purchase-common.service.js';

export const orderInclude = {
  supplier: { select: { id: true, code: true, name: true, stateCode: true } },
  store: { select: { id: true, code: true, name: true } },
  lines: { orderBy: { lineNo: 'asc' }, include: { item: { select: { id: true, code: true, name: true, isStockItem: true, trackBatches: true, trackSerials: true, baseUnitId: true } } } },
} satisfies Prisma.PurchaseOrderInclude;
export type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;

/** Statuses in which goods and bills may still come (blueprint 07: hold/close refuse them). */
export const OPEN_ORDER_STATUSES: PurchaseOrderStatus[] = ['to_receive_and_bill', 'to_receive', 'to_bill', 'completed'];

interface ResolvedOrderLine {
  lineId?: string;
  itemId: string;
  itemCode: string;
  unitId: string;
  factor: Decimal;
  quantity: Decimal;
  freeQuantity: Decimal;
  basicQuantity: Decimal;
  storeId: string;
  neededBy: string;
  priced: ReturnType<PurchaseCommon['price']>;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly common: PurchaseCommon,
  ) {}

  // ---- Reading ----

  async list(q: PurchaseOrderQuery, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const stores = this.common.storeFilter(user);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: Prisma.PurchaseOrderWhereInput = {
      companyId: company.id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.storeId ? { storeId: q.storeId } : {}),
      ...(stores ? { storeId: { in: stores } } : {}),
      ...(q.overdue === 'true' ? { neededBy: { lt: fromIso(businessDate()) }, status: { in: ['to_receive_and_bill', 'to_receive'] } } : {}),
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { supplier: { name: { contains: q.search, mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({ where, include: { supplier: orderInclude.supplier, store: orderInclude.store }, orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    const prices = hasPermission(user, 'buying_prices.view');
    return { rows: rows.map((o) => this.header(o, prices)), total, page, pageSize };
  }

  async get(id: string, user: CurrentUser) {
    const order = await this.getRow(this.prisma, id);
    this.assertAccess(order, user);
    return this.toDto(order, user);
  }

  async getRow(db: Db, id: string): Promise<OrderRow> {
    const order = await db.purchaseOrder.findUnique({ where: { id }, include: orderInclude });
    if (!order) throw new NotFoundException('Purchase order not found');
    return order;
  }

  /** Lines still expecting goods or bills, for the receipt and bill screens. */
  async openLines(id: string, user: CurrentUser) {
    const order = await this.getRow(this.prisma, id);
    this.assertAccess(order, user);
    const dto = this.toDto(order, user);
    return { ...dto, lines: dto.lines.filter((l) => D(l.pendingQuantity).gt(0) || (l.pendingAmount !== undefined && D(l.pendingAmount).gt(0))) };
  }

  // ---- Creating and changing ----

  async create(input: CreatePurchaseOrderInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.order');
    const company = await this.common.currentCompany();
    const orderDate = input.orderDate ?? businessDate();
    const prepared = await this.prepare(this.prisma, company.id, { ...input, orderDate }, user);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await this.createDraft(tx, company.id, { ...input, orderDate }, prepared, actor);
      await this.audit.record(tx, actor, { action: 'create', entityType: 'purchase_order', entityId: row.id, changes: { number: row.number, supplier: prepared.supplier.code, total: row.total.toString(), lines: prepared.lines.length } });
      return row;
    });
    return this.toDto(created, user);
  }

  /** Used by reorder suggestions too; the caller audits. */
  async createDraft(tx: Db, companyId: string, input: CreatePurchaseOrderInput & { orderDate: string }, prepared: Awaited<ReturnType<PurchaseOrdersService['prepare']>>, actor: Actor): Promise<OrderRow> {
    const number = await this.common.allocate(tx, { companyId, documentKind: 'purchase_order', storeId: input.storeId, date: input.orderDate });
    return tx.purchaseOrder.create({
      data: {
        companyId,
        number,
        supplierId: input.supplierId,
        orderDate: fromIso(input.orderDate),
        neededBy: fromIso(input.neededBy),
        storeId: input.storeId,
        supplierQuoteRef: input.supplierQuoteRef ?? null,
        paymentTermsId: prepared.paymentTermsId,
        dueDate: prepared.dueDate ? fromIso(prepared.dueDate) : null,
        remarks: input.remarks ?? null,
        ...prepared.totals,
        lines: { create: prepared.lines.map((l, i) => lineData(l, i)) },
        createdById: actor.userId,
        updatedById: actor.userId,
      },
      include: orderInclude,
    });
  }

  async update(id: string, input: UpdatePurchaseOrderInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.order');
    const before = await this.getRow(this.prisma, id);
    this.assertAccess(before, user);
    if (['cancelled', 'closed', 'completed'].includes(before.status)) throw new BadRequestException(`A ${before.status} order cannot be changed`);
    const finalised = before.status !== 'draft';
    if (finalised && !input.changeReason) throw new BadRequestException('Give a reason for changing a finalised order');
    if (finalised && input.supplierId && input.supplierId !== before.supplierId) throw new BadRequestException('The supplier of a finalised order cannot change');

    const merged: CreatePurchaseOrderInput & { orderDate: string } = {
      supplierId: input.supplierId ?? before.supplierId,
      orderDate: input.orderDate ?? iso(before.orderDate)!,
      neededBy: input.neededBy ?? iso(before.neededBy)!,
      storeId: input.storeId ?? before.storeId,
      supplierQuoteRef: input.supplierQuoteRef !== undefined ? input.supplierQuoteRef : before.supplierQuoteRef,
      paymentTermsId: input.paymentTermsId !== undefined ? input.paymentTermsId : before.paymentTermsId,
      remarks: input.remarks !== undefined ? input.remarks : before.remarks,
      lines: input.lines ?? before.lines.map((l) => existingLineInput(l)),
    };
    const prepared = await this.prepare(this.prisma, before.companyId, merged, user);

    const after = await this.prisma.$transaction(async (tx) => {
      // Lines that already have goods or bills must stay (with at least what was received).
      const keep = new Map(prepared.lines.filter((l) => l.lineId).map((l) => [l.lineId!, l]));
      for (const old of before.lines) {
        const used = D(old.receivedQuantity).gt(0) || D(old.billedAmount).gt(0) || (await tx.goodsReceiptLine.count({ where: { orderLineId: old.id } })) > 0;
        const replacement = keep.get(old.id);
        if (!replacement) {
          if (used) throw new BadRequestException(`${old.item.code}: goods or bills already refer to this line; it cannot be removed`);
          continue;
        }
        if (replacement.itemId !== old.itemId || replacement.unitId !== old.unitId) {
          if (used) throw new BadRequestException(`${old.item.code}: the item and unit of a line with goods or bills cannot change`);
        }
        if (replacement.basicQuantity.lt(D(old.receivedQuantity))) {
          throw new BadRequestException(`${old.item.code}: ${D(old.receivedQuantity).toString()} already received; the order cannot be for less`);
        }
      }
      for (const lineId of keep.keys()) {
        if (!before.lines.some((l) => l.id === lineId)) throw new BadRequestException('A line belongs to another order');
      }
      const removed = before.lines.filter((l) => !keep.has(l.id)).map((l) => l.id);
      if (removed.length) {
        await tx.reorderSuggestion.updateMany({ where: { orderLineId: { in: removed } }, data: { status: 'open', orderLineId: null } });
        await tx.purchaseOrderLine.deleteMany({ where: { id: { in: removed } } });
      }
      for (const [i, l] of prepared.lines.entries()) {
        const data = lineData(l, i);
        if (l.lineId) await tx.purchaseOrderLine.update({ where: { id: l.lineId }, data });
        else await tx.purchaseOrderLine.create({ data: { ...data, orderId: id } });
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: merged.supplierId,
          orderDate: fromIso(merged.orderDate),
          neededBy: fromIso(merged.neededBy),
          storeId: merged.storeId,
          supplierQuoteRef: merged.supplierQuoteRef ?? null,
          paymentTermsId: prepared.paymentTermsId,
          dueDate: prepared.dueDate ? fromIso(prepared.dueDate) : null,
          remarks: merged.remarks ?? null,
          ...prepared.totals,
          updatedById: actor.userId,
        },
      });
      if (finalised) {
        // A finalised order above the limit needs the approver again (decision 69).
        await this.checkApproval(tx, before.companyId, D(prepared.totals.total), user);
        await this.refreshProgress(tx, id);
      }
      const a = await this.getRow(tx, id);
      await this.audit.recordUpdate(tx, actor, 'purchase_order', id, summarise(before), summarise(a), input.changeReason ?? undefined);
      return a;
    });
    return this.toDto(after, user);
  }

  /**
   * Checks and prices every line (blueprint 07 process 3, business rules).
   * Shared by create, update and reorder suggestions.
   */
  async prepare(db: Db, companyId: string, input: CreatePurchaseOrderInput & { orderDate: string }, user: CurrentUser) {
    const supplier = await this.common.supplierForBills(db, input.supplierId, user);
    await this.common.store(db, companyId, input.storeId);
    assertStoreAccess(user, input.storeId);
    if (input.orderDate > businessDate()) throw new BadRequestException('An order cannot be dated in the future');
    await this.common.checkPostingDate(db, companyId, input.orderDate, 'An order');
    if (input.neededBy < input.orderDate) throw new BadRequestException('The date needed cannot be before the order date');
    const lines: ResolvedOrderLine[] = [];
    for (const l of input.lines) lines.push(await this.resolveLine(db, companyId, supplier, input, l, user));

    // Minimum order quantity per item, in basic units, over the whole order.
    const byItem = new Map<string, Decimal>();
    for (const l of lines) byItem.set(l.itemId, (byItem.get(l.itemId) ?? new Decimal(0)).add(l.basicQuantity));
    for (const [itemId, qty] of byItem) {
      const item = await db.item.findUniqueOrThrow({ where: { id: itemId } });
      if (item.minOrderQuantity && qty.lt(D(item.minOrderQuantity))) {
        throw new BadRequestException(`${item.code}: the supplier's minimum order is ${D(item.minOrderQuantity).toString()} (basic units); this order has ${qty.toString()}`);
      }
    }
    const paymentTermsId = input.paymentTermsId ?? supplier.paymentTermsId ?? null;
    let dueDate: string | null = null;
    if (paymentTermsId) {
      const terms = await db.paymentTerms.findUnique({ where: { id: paymentTermsId }, include: { parts: true } });
      if (!terms) throw new BadRequestException('Payment terms not found');
      dueDate = dueDates(input.neededBy, terms.parts.map((p) => ({ share: p.share.toString(), dueBasis: p.dueBasis, days: p.days, months: p.months }))).dueDate;
    }
    return { supplier, lines, paymentTermsId, dueDate, totals: this.common.totals(lines.map((l) => l.priced)) };
  }

  private async resolveLine(db: Db, companyId: string, supplier: Supplier, header: CreatePurchaseOrderInput & { orderDate: string }, l: PurchaseOrderLineInput, user: CurrentUser): Promise<ResolvedOrderLine> {
    const info = await this.common.itemUnit(db, l.itemId, l.unitId, [l.quantity, l.freeQuantity]);
    const storeId = l.storeId ?? header.storeId;
    if (info.item.isStockItem) {
      await this.common.store(db, companyId, storeId);
      assertStoreAccess(user, storeId);
    }
    const neededBy = l.neededBy ?? header.neededBy;
    if (neededBy < header.orderDate) throw new BadRequestException(`${info.item.code}: the date needed cannot be before the order date`);
    // An existing line keeps its saved price when none is sent (users without buying_prices.view never send one).
    const saved = l.lineId && !l.rate ? await db.purchaseOrderLine.findUnique({ where: { id: l.lineId }, select: { rate: true, discountPercent: true, discountAmount: true, gstRate: true, itemId: true, unitId: true } }) : null;
    const keep = saved && saved.itemId === info.item.id && saved.unitId === info.unitId ? saved : null;
    const rate = l.rate ?? keep?.rate.toString() ?? (await this.common.buyingRate(db, supplier, info, header.orderDate, l.quantity, user));
    if (rate === null) throw new BadRequestException(`${info.item.code}: give the buying price (no price list or last purchase price found)`);
    const interState = await this.common.interState(db, supplier, storeId);
    const gstRate = l.gstRate ?? keep?.gstRate.toString() ?? (await this.common.lastGstRate(db, info.item.id));
    const discountPercent = l.discountPercent ?? keep?.discountPercent.toString();
    const discountAmount = l.discountAmount ?? (keep && keep.discountAmount.gt(0) ? keep.discountAmount.toString() : undefined);
    const priced = this.common.price({ quantity: l.quantity, rate, discountPercent, discountAmount, gstRate, cgst: l.cgst, sgst: l.sgst, igst: l.igst }, interState, info.item.code);
    const quantity = D(l.quantity);
    const freeQuantity = D(l.freeQuantity ?? '0');
    return {
      lineId: l.lineId,
      itemId: info.item.id,
      itemCode: info.item.code,
      unitId: info.unitId,
      factor: info.factor,
      quantity,
      freeQuantity,
      basicQuantity: this.common.basic(quantity.add(freeQuantity), info.factor),
      storeId,
      neededBy,
      priced,
    };
  }

  // ---- Finalising and later actions ----

  async finalise(id: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.order');
    const order = await this.getRow(this.prisma, id);
    this.assertAccess(order, user);
    if (order.status !== 'draft') throw new BadRequestException(`The order is already ${order.status}`);
    // Re-run the checks: the supplier may have been held, prices or items switched off since the draft.
    await this.prepare(this.prisma, order.companyId, { ...draftInput(order), orderDate: iso(order.orderDate)! }, user);
    const after = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.purchaseOrder.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== 'draft') throw new BadRequestException(`The order is already ${fresh.status}`);
      const approvedById = await this.checkApproval(tx, order.companyId, D(fresh.total), user);
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'to_receive_and_bill', approvedById, finalisedAt: new Date(), finalisedById: actor.userId, updatedById: actor.userId } });
      await this.refreshProgress(tx, id);
      await this.audit.record(tx, actor, { action: 'update', entityType: 'purchase_order', entityId: id, changes: { status: { old: 'draft', new: 'finalised' }, number: order.number, total: fresh.total.toString(), ...(approvedById ? { approvedAboveLimit: true } : {}) } });
      return this.getRow(tx, id);
    });
    return this.toDto(after, user);
  }

  /** Decision 69 / plan 05 answer 3: above the approval limit only an approver may finalise. */
  private async checkApproval(tx: Db, companyId: string, total: Decimal, user: CurrentUser): Promise<string | null> {
    const settings = await this.common.settings(tx, companyId);
    if (total.lte(D(settings.approvalLimit))) return null;
    if (!hasPermission(user, 'purchase.approve')) {
      throw new ForbiddenException(`Orders above ₹${D(settings.approvalLimit).toFixed(2)} need a Store Manager or Owner to finalise`);
    }
    return user.id;
  }

  async hold(id: string, reason: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.approve');
    return this.changeStatus(id, user, actor, reason, (o) => {
      if (!['to_receive_and_bill', 'to_receive', 'to_bill'].includes(o.status)) throw new BadRequestException(`A ${o.status} order cannot be put on hold`);
      return { status: 'on_hold', statusBeforeHold: o.status, holdReason: reason };
    });
  }

  async release(id: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.approve');
    return this.changeStatus(id, user, actor, null, (o) => {
      if (o.status !== 'on_hold') throw new BadRequestException('The order is not on hold');
      return { status: o.statusBeforeHold ?? 'to_receive_and_bill', statusBeforeHold: null, holdReason: null };
    }, true);
  }

  async close(id: string, reason: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.approve');
    return this.changeStatus(id, user, actor, reason, (o) => {
      if (!['to_receive_and_bill', 'to_receive', 'to_bill', 'on_hold'].includes(o.status)) throw new BadRequestException(`A ${o.status} order cannot be closed`);
      return { status: 'closed', closeReason: reason, statusBeforeHold: null };
    });
  }

  async reopen(id: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.approve');
    return this.changeStatus(id, user, actor, null, (o) => {
      if (o.status !== 'closed') throw new BadRequestException('Only a closed order can be reopened');
      return { status: 'to_receive_and_bill', closeReason: null };
    }, true);
  }

  async cancel(id: string, reason: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.order');
    const order = await this.getRow(this.prisma, id);
    this.assertAccess(order, user);
    if (order.status === 'cancelled') throw new BadRequestException('Already cancelled');
    const after = await this.prisma.$transaction(async (tx) => {
      const lineIds = order.lines.map((l) => l.id);
      const receipts = await tx.goodsReceiptLine.count({ where: { orderLineId: { in: lineIds }, receipt: { status: { not: 'cancelled' } } } });
      const bills = await tx.supplierBillLine.count({ where: { orderLineId: { in: lineIds }, bill: { status: { not: 'cancelled' } } } });
      if (receipts || bills) throw new BadRequestException('Goods receipts or supplier bills refer to this order; cancel them first, or close the order instead');
      await tx.reorderSuggestion.updateMany({ where: { orderLineId: { in: lineIds } }, data: { status: 'open', orderLineId: null } });
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'purchase_order', entityId: id, changes: { status: { old: order.status, new: 'cancelled' }, number: order.number }, reason });
      return this.getRow(tx, id);
    });
    return this.toDto(after, user);
  }

  private async changeStatus(id: string, user: CurrentUser, actor: Actor, reason: string | null, next: (o: PurchaseOrder) => Prisma.PurchaseOrderUpdateInput, refresh = false) {
    const order = await this.getRow(this.prisma, id);
    this.assertAccess(order, user);
    const after = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.purchaseOrder.findUniqueOrThrow({ where: { id } });
      const data = next(fresh);
      await tx.purchaseOrder.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
      if (refresh) await this.refreshProgress(tx, id);
      const a = await this.getRow(tx, id);
      await this.audit.record(tx, actor, { action: 'update', entityType: 'purchase_order', entityId: id, changes: { status: { old: fresh.status, new: a.status }, number: a.number }, ...(reason ? { reason } : {}) });
      return a;
    });
    return this.toDto(after, user);
  }

  /** Received and billed shares and the order status (blueprint 07 calculations). */
  async refreshProgress(tx: Db, orderId: string): Promise<void> {
    const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const receivedPercent = percentDone(order.lines.map((l) => ({ ordered: l.basicQuantity.toString(), done: l.receivedQuantity.toString() })));
    const billedPercent = percentDone(order.lines.map((l) => ({ ordered: l.taxableAmount.toString(), done: l.billedAmount.toString() })));
    let status = order.status;
    if (OPEN_ORDER_STATUSES.includes(status)) {
      const received = receivedPercent.gte(100);
      const billed = billedPercent.gte(100);
      status = received && billed ? 'completed' : received ? 'to_bill' : billed ? 'to_receive' : 'to_receive_and_bill';
    }
    await tx.purchaseOrder.update({ where: { id: orderId }, data: { receivedPercent: receivedPercent.toFixed(2), billedPercent: billedPercent.toFixed(2), status } });
  }

  /** Goods and bills are only accepted against an order that is still open. */
  assertOpenForGoods(order: PurchaseOrder): void {
    if (order.status === 'draft') throw new BadRequestException(`Order ${order.number} is not finalised yet`);
    if (order.status === 'on_hold') throw new BadRequestException(`Order ${order.number} is on hold${order.holdReason ? `: ${order.holdReason}` : ''}`);
    if (order.status === 'closed') throw new BadRequestException(`Order ${order.number} is closed`);
    if (order.status === 'cancelled') throw new BadRequestException(`Order ${order.number} is cancelled`);
  }

  assertAccess(order: { storeId: string; lines: { storeId: string }[] }, user: CurrentUser): void {
    if (user.allStores) return;
    const ok = [order.storeId, ...order.lines.map((l) => l.storeId)].some((s) => user.stores.some((u) => u.id === s));
    if (!ok) throw new ForbiddenException('You are not allowed to work in this store');
  }

  // ---- Output ----

  private header(o: PurchaseOrder & { supplier: { id: string; code: string; name: string }; store: { id: string; code: string; name: string } }, prices: boolean) {
    const today = businessDate();
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      supplier: { id: o.supplier.id, code: o.supplier.code, name: o.supplier.name },
      store: o.store,
      orderDate: iso(o.orderDate),
      neededBy: iso(o.neededBy),
      dueDate: iso(o.dueDate),
      supplierQuoteRef: o.supplierQuoteRef,
      paymentTermsId: o.paymentTermsId,
      receivedPercent: o.receivedPercent.toFixed(2),
      billedPercent: o.billedPercent.toFixed(2),
      overdue: ['to_receive_and_bill', 'to_receive'].includes(o.status) && iso(o.neededBy)! < today,
      ...(prices ? { taxableAmount: o.taxableAmount.toFixed(2), taxAmount: o.taxAmount.toFixed(2), roundingAdjustment: o.roundingAdjustment.toFixed(2), total: o.total.toFixed(2) } : {}),
      approvedAboveLimit: !!o.approvedById,
      holdReason: o.holdReason,
      closeReason: o.closeReason,
      cancelReason: o.cancelReason,
      remarks: o.remarks,
      createdAt: o.createdAt,
      finalisedAt: o.finalisedAt,
    };
  }

  toDto(o: OrderRow, user: CurrentUser) {
    const prices = hasPermission(user, 'buying_prices.view');
    return {
      ...this.header(o, prices),
      lines: o.lines.map((l) => {
        const pending = Decimal.max(0, D(l.basicQuantity).sub(D(l.receivedQuantity)));
        return {
          id: l.id,
          lineNo: l.lineNo,
          item: { id: l.item.id, code: l.item.code, name: l.item.name, isStockItem: l.item.isStockItem, trackBatches: l.item.trackBatches, trackSerials: l.item.trackSerials },
          unitId: l.unitId,
          factor: l.factor.toString(),
          quantity: l.quantity.toString(),
          freeQuantity: l.freeQuantity.toString(),
          basicQuantity: l.basicQuantity.toString(),
          storeId: l.storeId,
          neededBy: iso(l.neededBy),
          receivedQuantity: l.receivedQuantity.toString(),
          pendingQuantity: pending.toString(),
          ...(prices
            ? {
                // The full stored price (up to 4 places) so saving again never rounds it.
                rate: l.rate.toString(),
                discountPercent: l.discountPercent.toFixed(2),
                discountAmount: l.discountAmount.toFixed(2),
                taxableAmount: l.taxableAmount.toFixed(2),
                gstRate: l.gstRate.toString(),
                cgst: l.cgst.toFixed(2),
                sgst: l.sgst.toFixed(2),
                igst: l.igst.toFixed(2),
                lineTotal: l.lineTotal.toFixed(2),
                billedAmount: l.billedAmount.toFixed(2),
                pendingAmount: Decimal.max(0, D(l.taxableAmount).sub(D(l.billedAmount))).toFixed(2),
              }
            : {}),
        };
      }),
    };
  }
}

function lineData(l: ResolvedOrderLine, i: number) {
  return {
    lineNo: i + 1,
    itemId: l.itemId,
    unitId: l.unitId,
    factor: l.factor.toString(),
    quantity: l.quantity.toString(),
    freeQuantity: l.freeQuantity.toString(),
    basicQuantity: l.basicQuantity.toString(),
    rate: l.priced.rate.toString(),
    discountPercent: l.priced.discountPercent.toFixed(2),
    discountAmount: l.priced.discountAmount.toFixed(2),
    taxableAmount: l.priced.taxable.toFixed(2),
    gstRate: l.priced.gstRate.toString(),
    cgst: l.priced.cgst.toFixed(2),
    sgst: l.priced.sgst.toFixed(2),
    igst: l.priced.igst.toFixed(2),
    lineTotal: l.priced.lineTotal.toFixed(2),
    storeId: l.storeId,
    neededBy: fromIso(l.neededBy),
  };
}

function existingLineInput(l: OrderRow['lines'][number]): PurchaseOrderLineInput {
  return {
    lineId: l.id,
    itemId: l.itemId,
    unitId: l.unitId,
    quantity: l.quantity.toString(),
    freeQuantity: l.freeQuantity.toString(),
    rate: l.rate.toString(),
    discountPercent: l.discountPercent.toString(),
    discountAmount: l.discountAmount.toString(),
    gstRate: l.gstRate.toString(),
    cgst: l.cgst.toString(),
    sgst: l.sgst.toString(),
    igst: l.igst.toString(),
    storeId: l.storeId,
    neededBy: iso(l.neededBy),
  };
}

function draftInput(o: OrderRow): CreatePurchaseOrderInput {
  return {
    supplierId: o.supplierId,
    orderDate: iso(o.orderDate)!,
    neededBy: iso(o.neededBy)!,
    storeId: o.storeId,
    supplierQuoteRef: o.supplierQuoteRef,
    paymentTermsId: o.paymentTermsId,
    remarks: o.remarks,
    lines: o.lines.map((l) => existingLineInput(l)),
  };
}

function summarise(o: OrderRow): Record<string, unknown> {
  return {
    supplierId: o.supplierId,
    orderDate: iso(o.orderDate),
    neededBy: iso(o.neededBy),
    storeId: o.storeId,
    total: o.total.toString(),
    lines: o.lines.map((l) => `${l.item.code}×${l.quantity.toString()}@${l.rate.toString()}`),
  };
}

/** Default "needed by" for orders made from reorder suggestions: a week from today. */
export function defaultNeededBy(): string {
  return addDays(businessDate(), 7);
}
