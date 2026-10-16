// Copyright (c) 2026, Rademics. All rights reserved.
// Goods receipts and returns to suppliers (blueprint 07 processes 4 and 6;
// decisions 13, 27, 29–31; plan 05 §4). Stock moves only through StockEngine,
// in the same transaction as the document (rules 5–7).
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type CreateGoodsReceiptInput,
  type CurrentUser,
  Decimal,
  expiryFromShelfLife,
  type GoodsReceiptLineInput,
  type GoodsReceiptQuery,
  hasPermission,
  isExpiredOn,
  isOverAllowance,
  percentDone,
  PURCHASE_ACCOUNT_ROLES,
  type PurchaseReturnInput,
  QUANTITY_TOLERANCE,
  type ReceiptCheckInput,
  roundMoney,
  roundTo,
  unitCostPerBasicUnit,
  type UpdateGoodsReceiptInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { assertStoreAccess } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import type { GoodsReceipt, Prisma, StockLedgerEntry, Supplier } from '../generated/prisma/client.js';
import { postingInstant, StockDocumentsService } from '../inventory/stock-documents.service.js';
import { type Movement, StockEngine } from '../inventory/stock-engine.service.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, fromIso, iso, PurchaseCommon } from './purchase-common.service.js';
import { PurchasePostings } from './purchase-postings.service.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { ConsignmentStock } from './consignment-stock.service.js';

export const receiptInclude = {
  supplier: { select: { id: true, code: true, name: true } },
  store: { select: { id: true, code: true, name: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true, trackBatches: true, trackSerials: true, baseUnitId: true } },
      orderLine: { select: { id: true, orderId: true, order: { select: { id: true, number: true } } } },
    },
  },
} satisfies Prisma.GoodsReceiptInclude;
export type ReceiptRow = Prisma.GoodsReceiptGetPayload<{ include: typeof receiptInclude }>;

const ROLE = PURCHASE_ACCOUNT_ROLES.grni;
/** Plan 11 part 2: sale-or-return goods are held against the consignment balance, not goods received not billed. */
const roleOf = (r: { isConsignment: boolean }) => (r.isConsignment ? PURCHASE_ACCOUNT_ROLES.consignment : ROLE);

/** A receipt line after every check, ready to store (positive quantities). */
export interface ResolvedReceiptLine {
  orderLineId: string | null;
  itemId: string;
  itemCode: string;
  unitId: string;
  factor: Decimal;
  receivedQuantity: Decimal;
  acceptedQuantity: Decimal;
  rejectedQuantity: Decimal;
  freeQuantity: Decimal;
  basicAcceptedQuantity: Decimal;
  basicRejectedQuantity: Decimal;
  priced: ReturnType<PurchaseCommon['price']>;
  shelfLocationId: string;
  rejectedLocationId: string | null;
  batchId: string | null;
  newBatchNumber: string | null;
  newManufactureOn: string | null;
  newExpiryOn: string | null;
  serialNumbers: string[];
  rejectedSerialNumbers: string[];
}

export interface ReceiptHeader {
  supplierId: string;
  storeId: string;
  postingDate: string;
  postingTime?: string;
  deliveryNoteNo?: string | null;
  transporterName?: string | null;
  vehicleNo?: string | null;
  noOrderReason?: string | null;
  /** Plan 11 part 2: sale or return. */
  isConsignment?: boolean;
  remarks?: string | null;
}

@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly common: PurchaseCommon,
    private readonly orders: PurchaseOrdersService,
    private readonly engine: StockEngine,
    private readonly stockDocs: StockDocumentsService,
    private readonly postings: PurchasePostings,
    private readonly consignment: ConsignmentStock,
  ) {}

  // ---- Reading ----

  async list(q: GoodsReceiptQuery, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const stores = this.common.storeFilter(user);
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: Prisma.GoodsReceiptWhereInput = {
      companyId: company.id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.storeId ? { storeId: q.storeId } : {}),
      ...(stores ? { storeId: { in: stores } } : {}),
      ...(q.isReturn ? { isReturn: q.isReturn === 'true' } : {}),
      ...(q.isConsignment ? { isConsignment: q.isConsignment === 'true' } : {}),
      ...(q.from || q.to ? { postingDate: { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.goodsReceipt.findMany({ where, include: { supplier: receiptInclude.supplier, store: receiptInclude.store }, orderBy: [{ postingAt: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.goodsReceipt.count({ where }),
    ]);
    return { rows: rows.map((r) => this.header(r, user)), total, page, pageSize };
  }

  async get(id: string, user: CurrentUser) {
    const r = await this.getRow(this.prisma, id);
    assertStoreAccess(user, r.storeId);
    return this.toDto(r, user);
  }

  async getRow(db: Db, id: string): Promise<ReceiptRow> {
    const r = await db.goodsReceipt.findUnique({ where: { id }, include: receiptInclude });
    if (!r) throw new NotFoundException('Goods receipt not found');
    return r;
  }

  // ---- Drafts ----

  async create(input: CreateGoodsReceiptInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.receive');
    const company = await this.common.currentCompany();
    const header: ReceiptHeader = { ...input, postingDate: input.postingDate ?? businessDate() };
    const { lines } = await this.resolve(this.prisma, company.id, header, input.lines, user);
    const created = await this.prisma.$transaction(async (tx) => {
      const r = await this.createDraft(tx, company.id, header, lines, actor, {});
      await this.audit.record(tx, actor, { action: 'create', entityType: 'goods_receipt', entityId: r.id, changes: { number: r.number, lines: lines.length, ...(header.isConsignment ? { saleOrReturn: true } : {}), ...(header.noOrderReason ? { withoutOrder: header.noOrderReason } : {}) } });
      return r;
    });
    return this.toDto(created, user);
  }

  async update(id: string, input: UpdateGoodsReceiptInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.receive');
    const before = await this.getRow(this.prisma, id);
    assertStoreAccess(user, before.storeId);
    if (before.status !== 'draft' || before.isReturn || before.billId) throw new BadRequestException('Only draft goods receipts can be changed');
    const header: ReceiptHeader = {
      supplierId: input.supplierId ?? before.supplierId,
      storeId: input.storeId ?? before.storeId,
      postingDate: input.postingDate ?? iso(before.postingDate)!,
      postingTime: input.postingTime,
      deliveryNoteNo: input.deliveryNoteNo !== undefined ? input.deliveryNoteNo : before.deliveryNoteNo,
      transporterName: input.transporterName !== undefined ? input.transporterName : before.transporterName,
      vehicleNo: input.vehicleNo !== undefined ? input.vehicleNo : before.vehicleNo,
      noOrderReason: input.noOrderReason !== undefined ? input.noOrderReason : before.noOrderReason,
      isConsignment: input.isConsignment ?? before.isConsignment,
      remarks: input.remarks !== undefined ? input.remarks : before.remarks,
    };
    const lineInputs = input.lines ?? before.lines.map((l) => lineInputOf(l));
    const { lines } = await this.resolve(this.prisma, before.companyId, header, lineInputs, user);
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.goodsReceipt.update({
        where: { id },
        data: {
          supplierId: header.supplierId,
          storeId: header.storeId,
          postingDate: fromIso(header.postingDate),
          postingAt: input.postingDate || input.postingTime ? postingInstant(header.postingDate, header.postingTime) : undefined,
          deliveryNoteNo: header.deliveryNoteNo ?? null,
          transporterName: header.transporterName ?? null,
          vehicleNo: header.vehicleNo ?? null,
          noOrderReason: header.noOrderReason ?? null,
          isConsignment: header.isConsignment ?? false,
          remarks: header.remarks ?? null,
          ...this.totalsOf(lines),
          updatedById: actor.userId,
          lines: { deleteMany: {}, create: lines.map((l, i) => receiptLineData(l, i)) },
        },
      });
      const a = await this.getRow(tx, id);
      await this.audit.recordUpdate(tx, actor, 'goods_receipt', id, summarise(before), summarise(a));
      return a;
    });
    return this.toDto(after, user);
  }

  async createDraft(tx: Db, companyId: string, header: ReceiptHeader, lines: ResolvedReceiptLine[], actor: Actor, extra: { billId?: string }): Promise<ReceiptRow> {
    const number = await this.common.allocate(tx, { companyId, documentKind: 'goods_receipt', storeId: header.storeId, date: header.postingDate });
    const r = await tx.goodsReceipt.create({
      data: {
        companyId,
        number,
        supplierId: header.supplierId,
        storeId: header.storeId,
        postingDate: fromIso(header.postingDate),
        postingAt: postingInstant(header.postingDate, header.postingTime),
        deliveryNoteNo: header.deliveryNoteNo ?? null,
        transporterName: header.transporterName ?? null,
        vehicleNo: header.vehicleNo ?? null,
        noOrderReason: header.noOrderReason ?? null,
        isConsignment: header.isConsignment ?? false,
        remarks: header.remarks ?? null,
        billId: extra.billId ?? null,
        ...this.totalsOf(lines),
        lines: { create: lines.map((l, i) => receiptLineData(l, i)) },
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    return this.getRow(tx, r.id);
  }

  /**
   * Checks every line against its order, the store, units, batches and
   * serials, and prices it (blueprint 07 business rules, goods receipts).
   */
  async resolve(db: Db, companyId: string, header: ReceiptHeader, inputs: GoodsReceiptLineInput[], user: CurrentUser, opts: { forBill?: boolean } = {}): Promise<{ supplier: Supplier; lines: ResolvedReceiptLine[] }> {
    const supplier = opts.forBill ? await this.common.supplierForBills(db, header.supplierId, user) : await this.common.supplierForGoods(db, header.supplierId, user);
    await this.common.store(db, companyId, header.storeId);
    assertStoreAccess(user, header.storeId);
    await this.common.checkStockDate(db, companyId, header.postingDate, 'Goods');
    const settings = await this.common.settings(db, companyId);
    const seesPrices = hasPermission(user, 'buying_prices.view');
    const interState = await this.common.interState(db, supplier, header.storeId);
    const lines: ResolvedReceiptLine[] = [];
    let withoutOrder = false;

    for (const l of inputs) {
      const orderLine = l.orderLineId ? await db.purchaseOrderLine.findUnique({ where: { id: l.orderLineId }, include: { order: true } }) : null;
      if (l.orderLineId && !orderLine) throw new BadRequestException('Purchase order line not found');
      // Plan 11 part 2: sale-or-return goods are agreed with the supplier, not ordered.
      if (orderLine && header.isConsignment) throw new BadRequestException('Sale-or-return goods are received without a purchase order; remove the order lines or untick "Sale or return"');
      if (orderLine) {
        const order = orderLine.order;
        if (order.companyId !== companyId) throw new BadRequestException('Purchase order line not found');
        this.orders.assertOpenForGoods(order);
        if (order.supplierId !== supplier.id) throw new BadRequestException(`Order ${order.number} is from another supplier`);
        if (l.itemId !== orderLine.itemId) throw new BadRequestException(`The item must match order ${order.number}`);
        if (l.unitId && l.unitId !== orderLine.unitId) throw new BadRequestException(`The unit must match order ${order.number}`);
        if (orderLine.storeId !== header.storeId) throw new BadRequestException(`That line of order ${order.number} is for another store`);
        if (header.postingDate < iso(order.orderDate)!) throw new BadRequestException(`Goods cannot be received before order ${order.number} was made`);
      } else {
        withoutOrder = true;
      }
      const unitId = orderLine?.unitId ?? l.unitId;
      const info = await this.common.itemUnit(db, l.itemId, unitId, [l.receivedQuantity, l.freeQuantity, l.rejectedQuantity], 'stock');
      const code = info.item.code;
      const received = D(l.receivedQuantity);
      const rejected = D(l.rejectedQuantity ?? '0');
      const free = D(l.freeQuantity ?? '0');
      const accepted = received.sub(rejected);
      const charged = received.sub(free);
      if (accepted.lt(0) || charged.lt(0)) throw new BadRequestException(`${code}: rejected and free cannot be more than received`);

      // Receiving staff cannot see buying prices (decision 70): the order or price list decides.
      const typedRate = seesPrices ? l.rate : undefined;
      const rate =
        typedRate ??
        orderLine?.rate.toString() ??
        (await this.common.buyingRate(db, supplier, info, header.postingDate, charged.gt(0) ? charged.toString() : '1', user)) ??
        // Nothing known: the price written on the delivery note is the only source.
        l.rate;
      if (rate == null) throw new BadRequestException(`${code}: give the buying price (no order, price list or last purchase price)`);
      // With an order, GST follows the order unless someone who sees prices typed it from the delivery note.
      const gstFromOrder = !!orderLine && (!seesPrices || (l.cgst === undefined && l.sgst === undefined && l.igst === undefined && l.gstRate === undefined));
      const gstRate = gstFromOrder ? orderLine!.gstRate.toString() : (l.gstRate ?? (await this.common.lastGstRate(db, l.itemId)));
      const discountAmount =
        l.discountAmount ?? (orderLine && D(orderLine.discountAmount).gt(0) ? roundMoney(D(orderLine.discountAmount).mul(charged).div(D(orderLine.quantity))).toString() : null);
      const priced = this.common.price(
        {
          quantity: charged.toString(),
          rate,
          discountPercent: (seesPrices ? l.discountPercent : undefined) ?? orderLine?.discountPercent.toString() ?? null,
          discountAmount: seesPrices ? discountAmount : orderLine && D(orderLine.discountAmount).gt(0) ? discountAmount : null,
          gstRate,
          ...(gstFromOrder ? {} : { cgst: l.cgst, sgst: l.sgst, igst: l.igst }),
        },
        interState,
        code,
      );

      const shelf = await this.common.shelfLocation(db, companyId, header.storeId, l.shelfLocationId);
      const rejectedLoc = rejected.gt(0) ? await this.common.rejectedLocation(db, header.storeId) : null;

      let batchId: string | null = null;
      let newBatchNumber: string | null = null;
      let newManufactureOn: string | null = null;
      let newExpiryOn: string | null = null;
      if (info.item.trackBatches) {
        if (l.batchId) {
          const batch = await db.batch.findUnique({ where: { id: l.batchId } });
          if (!batch || batch.itemId !== info.item.id) throw new BadRequestException(`${code}: batch not found`);
          batchId = batch.id;
        } else {
          if (!l.batchNumber && !info.item.autoNumberBatches) throw new BadRequestException(`${code}: give a batch number`);
          newBatchNumber = l.batchNumber ?? null;
          newManufactureOn = l.manufactureDate ?? null;
          newExpiryOn = l.expiryDate ?? (l.manufactureDate && info.item.shelfLifeDays ? expiryFromShelfLife(l.manufactureDate, info.item.shelfLifeDays) : null);
          if (info.item.shelfLifeDays && !newExpiryOn) throw new BadRequestException(`${code}: give the expiry date or the manufacture date`);
        }
      } else if (l.batchId || l.batchNumber) {
        throw new BadRequestException(`${code} is not tracked by batch`);
      }

      const basicAccepted = this.common.basic(accepted, info.factor);
      const basicRejected = this.common.basic(rejected, info.factor);
      const serials = (l.serialNumbers ?? []).map((s) => s.trim());
      const rejectedSerials = (l.rejectedSerialNumbers ?? []).map((s) => s.trim());
      if (info.item.trackSerials) {
        if (!basicAccepted.isInteger() || !basicAccepted.eq(serials.length)) throw new BadRequestException(`${code}: list exactly ${basicAccepted.toString()} serial numbers for the accepted goods`);
        if (!basicRejected.eq(rejectedSerials.length)) throw new BadRequestException(`${code}: list exactly ${basicRejected.toString()} serial numbers for the rejected goods`);
        const all = [...serials, ...rejectedSerials];
        if (new Set(all).size !== all.length) throw new BadRequestException(`${code}: a serial number is listed twice`);
      } else if (serials.length || rejectedSerials.length) {
        throw new BadRequestException(`${code} is not tracked by serial number`);
      }

      lines.push({
        orderLineId: orderLine?.id ?? null,
        itemId: info.item.id,
        itemCode: code,
        unitId: info.unitId,
        factor: info.factor,
        receivedQuantity: received,
        acceptedQuantity: accepted,
        rejectedQuantity: rejected,
        freeQuantity: free,
        basicAcceptedQuantity: basicAccepted,
        basicRejectedQuantity: basicRejected,
        priced,
        shelfLocationId: shelf.id,
        rejectedLocationId: rejectedLoc?.id ?? null,
        batchId,
        newBatchNumber,
        newManufactureOn,
        newExpiryOn,
        serialNumbers: serials,
        rejectedSerialNumbers: rejectedSerials,
      });
    }

    // Decision 31: without an order only with the right and a reason (unless orders are required).
    // Sale-or-return goods never come from an order, so decision 31 does not apply to them.
    if (withoutOrder && !opts.forBill && !header.isConsignment) {
      if (settings.requireOrderForReceipt) throw new BadRequestException('A purchase order is required before receiving goods');
      if (!hasPermission(user, 'purchase.receive_without_order')) throw new ForbiddenException('Receiving goods without a purchase order needs a Store Manager');
      if (!header.noOrderReason?.trim()) throw new BadRequestException('Give the reason for receiving goods without a purchase order');
    }
    return { supplier, lines };
  }

  private totalsOf(lines: ResolvedReceiptLine[]) {
    const t = this.common.totals(lines.map((l) => l.priced));
    return { taxableAmount: t.taxableAmount, taxAmount: t.taxAmount, total: t.total };
  }

  // ---- Finalising ----

  async finalise(id: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.receive');
    const r = await this.getRow(this.prisma, id);
    assertStoreAccess(user, r.storeId);
    if (r.status !== 'draft') throw new BadRequestException(`The goods receipt is already ${r.status}`);
    if (r.isReturn || r.billId) throw new BadRequestException('This receipt is finalised with its return or bill');
    // Re-run the checks on the stored lines (orders may have been held or closed since).
    await this.resolve(this.prisma, r.companyId, headerOf(r), r.lines.map((l) => lineInputOf(l)), user);
    const result = await this.prisma.$transaction(async (tx) => this.post(tx, id, actor, user), { timeout: 60_000, maxWait: 30_000 });
    return { ...this.toDto(result.receipt, user), warnings: result.warnings };
  }

  /** Posts a draft receipt to stock and its orders; used by finalise and by bills that receive goods. */
  async post(tx: Db, id: string, actor: Actor, user: CurrentUser): Promise<{ receipt: ReceiptRow; warnings: string[] }> {
    const r = await this.getRow(tx, id);
    if (r.status !== 'draft') throw new BadRequestException(`The goods receipt is already ${r.status}`);
    const postingDate = iso(r.postingDate)!;
    const settings = await this.common.settings(tx, r.companyId);
    const warnings: string[] = [];

    // Rule 7: lock the order lines so two receipts cannot both take the last allowed quantity.
    const orderLineIds = [...new Set(r.lines.map((l) => l.orderLineId).filter((x): x is string => !!x))].sort();
    for (const olId of orderLineIds) await tx.$queryRaw`SELECT 1 FROM "PurchaseOrderLine" WHERE "id" = ${olId}::uuid FOR UPDATE`;
    for (const olId of orderLineIds) {
      const ol = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: olId }, include: { order: true, item: true } });
      this.orders.assertOpenForGoods(ol.order);
      const adding = r.lines.filter((l) => l.orderLineId === olId).reduce((s, l) => s.add(D(l.basicAcceptedQuantity)).add(D(l.basicRejectedQuantity)), new Decimal(0));
      const total = D(ol.receivedQuantity).add(adding);
      const allowance = ol.item.overReceiptPercent ?? settings.overReceiptPercent;
      if (isOverAllowance(ol.basicQuantity.toString(), total, allowance.toString())) {
        const expected = Decimal.max(0, D(ol.basicQuantity).sub(D(ol.receivedQuantity)));
        const message = `${ol.item.code}: ${adding.toString()} received but only ${expected.toString()} still expected on order ${ol.order.number}`;
        if (!hasPermission(user, 'purchase.over_receive')) throw new BadRequestException(`${message} (allowance ${D(allowance).toString()}%)`);
        warnings.push(`${message}; accepted above the allowance`);
      }
      await tx.purchaseOrderLine.update({ where: { id: olId }, data: { receivedQuantity: total.toString() } });
    }

    // Batches (decision 13: an expired batch is never received).
    for (const l of r.lines) {
      if (!l.item.trackBatches) continue;
      let batchId = l.batchId;
      if (!batchId) {
        const batch = await this.stockDocs.ensureBatch(tx, l.itemId, l.newBatchNumber, iso(l.newManufactureOn), iso(l.newExpiryOn), actor);
        batchId = batch.id;
        await tx.batch.update({ where: { id: batch.id }, data: { supplierId: r.supplierId } }).catch(() => undefined);
        await tx.goodsReceiptLine.update({ where: { id: l.id }, data: { batchId } });
        l.batchId = batchId;
      }
      const batch = await tx.batch.findUniqueOrThrow({ where: { id: batchId } });
      if (isExpiredOn(iso(batch.expiryDate), postingDate)) throw new BadRequestException(`Batch ${batch.batchNumber} of ${l.item.code} expired on ${iso(batch.expiryDate)}; it cannot be received`);
    }

    const isBackDated = await this.common.checkBackdating(
      tx,
      r.lines.map((l) => l.itemId),
      r.lines.flatMap((l) => [l.shelfLocationId, l.rejectedLocationId].filter((x): x is string => !!x)),
      r.postingAt,
      postingDate,
      user,
    );

    // Cost per basic unit (decisions 27 and 30: free and rejected units share the cost).
    const movements: Movement[] = [];
    const costs = new Map<string, Decimal>();
    for (const l of r.lines) {
      const basicReceived = D(l.basicAcceptedQuantity).add(D(l.basicRejectedQuantity));
      const cost = unitCostPerBasicUnit({ taxable: l.taxableAmount.toString(), extraCharges: l.extraCharges.toString(), basicQuantity: basicReceived });
      costs.set(l.id, cost);
      // The receipt posts its own ledger entry (freight is credited separately), so the engine holds the value.
      const base = { companyId: r.companyId, documentType: 'goods_receipt', documentId: r.id, documentLineId: l.id, itemId: l.itemId, batchId: l.batchId, postingDate, postingAt: r.postingAt, accountRole: roleOf(r), ledger: 'held' as const };
      if (D(l.basicAcceptedQuantity).gt(0)) movements.push({ ...base, locationId: l.shelfLocationId, kind: 'in', quantity: l.basicAcceptedQuantity.toString(), incomingCost: cost.toString() });
      if (D(l.basicRejectedQuantity).gt(0)) movements.push({ ...base, locationId: l.rejectedLocationId!, kind: 'in', quantity: l.basicRejectedQuantity.toString(), incomingCost: cost.toString() });
    }
    const entries = await this.engine.post(tx, movements, { allowNegative: false, actorId: actor.userId, describe: await this.describer(tx, r) });
    await this.applySerials(tx, r, 'finalise', actor);

    for (const l of r.lines) {
      await tx.goodsReceiptLine.update({ where: { id: l.id }, data: { unitCost: costs.get(l.id)!.toFixed(4) } });
      // Last purchase price per basic unit, before GST and without free units.
      const basicCharged = this.common.basic(D(l.receivedQuantity).sub(D(l.freeQuantity)), D(l.factor));
      if (basicCharged.gt(0)) await tx.item.update({ where: { id: l.itemId }, data: { lastPurchasePrice: roundTo(D(l.taxableAmount).div(basicCharged), 4).toString() } });
    }
    await this.postings.goodsReceipt(tx, r.id, entries.map((e) => e.id), actor.userId);
    const stockValue = entries.reduce((s, e) => s.add(D(e.valueChange)), new Decimal(0));
    await tx.goodsReceipt.update({
      where: { id },
      data: {
        // Sale-or-return goods are never billed by a normal bill: only a consignment statement bills them.
        status: D(r.total).eq(0) || r.isConsignment ? 'completed' : 'to_bill',
        stockValue: stockValue.toFixed(2),
        isBackDated,
        finalisedAt: new Date(),
        finalisedById: actor.userId,
        updatedById: actor.userId,
      },
    });
    for (const orderId of new Set(r.lines.map((l) => l.orderLine?.orderId).filter((x): x is string => !!x))) await this.orders.refreshProgress(tx, orderId);
    await this.audit.record(tx, actor, {
      action: 'update',
      entityType: 'goods_receipt',
      entityId: id,
      changes: { status: { old: 'draft', new: 'finalised' }, number: r.number, stockValue: stockValue.toFixed(2), ...(r.isConsignment ? { saleOrReturn: true } : {}), ...(warnings.length ? { overReceipt: warnings } : {}), ...(r.noOrderReason ? { withoutOrder: r.noOrderReason } : {}) },
    });
    return { receipt: await this.getRow(tx, id), warnings };
  }

  // ---- Received-goods check (decision 29) ----

  async check(id: string, input: ReceiptCheckInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.receive');
    const r = await this.getRow(this.prisma, id);
    assertStoreAccess(user, r.storeId);
    if (r.status === 'cancelled' || r.isReturn) throw new BadRequestException('Only goods receipts can be checked');
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.goodsReceipt.update({
        where: { id },
        data: { checkedById: actor.userId, checkedAt: input.checkedAt ? new Date(input.checkedAt) : new Date(), checkResult: input.result, checkRemarks: input.remarks ?? null, updatedById: actor.userId },
      });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'goods_receipt', entityId: id, changes: { check: input.result, remarks: input.remarks ?? null, number: r.number } });
      return this.getRow(tx, id);
    });
    return this.toDto(after, user);
  }

  /** No more bills expected for this receipt. */
  async close(id: string, reason: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.bill');
    const r = await this.getRow(this.prisma, id);
    assertStoreAccess(user, r.storeId);
    if (!['to_bill', 'partly_billed'].includes(r.status)) throw new BadRequestException(`A ${r.status} receipt cannot be closed`);
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.goodsReceipt.update({ where: { id }, data: { status: 'closed', updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'goods_receipt', entityId: id, changes: { status: { old: r.status, new: 'closed' }, number: r.number }, reason });
      return this.getRow(tx, id);
    });
    return this.toDto(after, user);
  }

  // ---- Returns to the supplier (blueprint 07 process 6) ----

  async createReturn(originalId: string, input: PurchaseReturnInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.return');
    const original = await this.getRow(this.prisma, originalId);
    assertStoreAccess(user, original.storeId);
    const ret = await this.prisma.$transaction(async (tx) => this.returnGoods(tx, original.id, input, actor, user), { timeout: 60_000, maxWait: 30_000 });
    return this.toDto(ret, user);
  }

  /** Goods leave at the original cost (not today's), from the shelf or the Rejected location. */
  async returnGoods(tx: Db, originalId: string, input: PurchaseReturnInput, actor: Actor, user: CurrentUser): Promise<ReceiptRow> {
    const original = await this.getRow(tx, originalId);
    if (original.isReturn) throw new BadRequestException('A return cannot be returned');
    if (['draft', 'cancelled'].includes(original.status)) throw new BadRequestException(`A ${original.status} receipt cannot be returned`);
    await this.common.supplierForGoods(tx, original.supplierId, user);
    const postingDate = input.postingDate ?? businessDate();
    if (postingDate < iso(original.postingDate)!) throw new BadRequestException('A return cannot be dated before the goods arrived');
    await this.common.checkStockDate(tx, original.companyId, postingDate, 'A return');
    const postingAt = postingInstant(postingDate, input.postingTime);

    // Lock the original lines so two returns cannot take back the same goods.
    for (const l of [...original.lines].sort((a, b) => a.id.localeCompare(b.id))) await tx.$queryRaw`SELECT 1 FROM "GoodsReceiptLine" WHERE "id" = ${l.id}::uuid FOR UPDATE`;

    const plan: { line: ReceiptRow['lines'][number]; acc: Decimal; rej: Decimal; basicAcc: Decimal; basicRej: Decimal; serials: string[]; rejectedSerials: string[] }[] = [];
    for (const spec of input.lines) {
      const line = await tx.goodsReceiptLine.findUnique({ where: { id: spec.originalLineId }, include: receiptInclude.lines.include });
      if (!line || line.receiptId !== original.id) throw new BadRequestException('The line is not part of this goods receipt');
      const acc = D(spec.acceptedQuantity ?? '0');
      const rej = D(spec.rejectedQuantity ?? '0');
      if (acc.lt(0) || rej.lt(0) || acc.add(rej).lte(0)) throw new BadRequestException(`${line.item.code}: give the quantity going back`);
      const factor = D(line.factor);
      const basicAcc = this.common.basic(acc, factor);
      const basicRej = this.common.basic(rej, factor);
      const leftAcc = D(line.basicAcceptedQuantity).sub(D(line.returnedAcceptedQuantity));
      const leftRej = D(line.basicRejectedQuantity).sub(D(line.returnedRejectedQuantity));
      if (basicAcc.gt(leftAcc.add(QUANTITY_TOLERANCE))) throw new BadRequestException(`${line.item.code}: only ${leftAcc.toString()} accepted units are left to return`);
      if (basicRej.gt(leftRej.add(QUANTITY_TOLERANCE))) throw new BadRequestException(`${line.item.code}: only ${leftRej.toString()} rejected units are left to return`);
      let serials: string[] = [];
      let rejectedSerials: string[] = [];
      if (line.item.trackSerials) {
        const given = (spec.serialNumbers ?? []).map((s) => s.trim());
        serials = given.filter((s) => line.serialNumbers.includes(s));
        rejectedSerials = given.filter((s) => line.rejectedSerialNumbers.includes(s));
        if (serials.length + rejectedSerials.length !== given.length) throw new BadRequestException(`${line.item.code}: every serial number returned must have come in on this receipt`);
        if (!basicAcc.eq(serials.length) || !basicRej.eq(rejectedSerials.length)) throw new BadRequestException(`${line.item.code}: list the serial numbers going back (${basicAcc.toString()} accepted, ${basicRej.toString()} rejected)`);
      }
      plan.push({ line, acc, rej, basicAcc, basicRej, serials, rejectedSerials });
    }

    // Plan 11 part 2: only sale-or-return goods still in the shop can go back on sale-or-return terms.
    if (original.isConsignment) {
      const byItem = new Map<string, Decimal>();
      for (const p of plan) byItem.set(p.line.itemId, (byItem.get(p.line.itemId) ?? new Decimal(0)).add(p.basicAcc).add(p.basicRej));
      for (const [itemId, qty] of byItem) {
        const held = await this.consignment.held(tx, original.storeId, itemId, original.supplierId);
        if (qty.gt(held.add(QUANTITY_TOLERANCE))) {
          const code = plan.find((p) => p.line.itemId === itemId)!.line.item.code;
          throw new BadRequestException(`${code}: only ${held.toString()} of this supplier's sale-or-return goods are still in the shop (the rest were sold)`);
        }
      }
    }

    const number = await this.common.allocate(tx, { companyId: original.companyId, documentKind: 'purchase_return', storeId: original.storeId, date: postingDate });
    const neg = (v: Decimal) => v.neg().toString();
    const lineData = plan.map((p, i) => {
      const l = p.line;
      const receivedBasic = D(l.basicAcceptedQuantity).add(D(l.basicRejectedQuantity));
      const share = p.basicAcc.add(p.basicRej).div(receivedBasic);
      const part = (v: { toString(): string }) => roundMoney(D(v).mul(share));
      const taxable = part(l.taxableAmount);
      const cgst = part(l.cgst);
      const sgst = part(l.sgst);
      const igst = part(l.igst);
      return {
        lineNo: i + 1,
        orderLineId: l.orderLineId,
        itemId: l.itemId,
        unitId: l.unitId,
        factor: l.factor.toString(),
        receivedQuantity: neg(p.acc.add(p.rej)),
        acceptedQuantity: neg(p.acc),
        rejectedQuantity: neg(p.rej),
        freeQuantity: '0',
        basicAcceptedQuantity: neg(p.basicAcc),
        basicRejectedQuantity: neg(p.basicRej),
        rate: l.rate.toString(),
        discountPercent: l.discountPercent.toString(),
        discountAmount: '0',
        taxableAmount: taxable.neg().toFixed(2),
        gstRate: l.gstRate.toString(),
        cgst: cgst.neg().toFixed(2),
        sgst: sgst.neg().toFixed(2),
        igst: igst.neg().toFixed(2),
        lineTotal: taxable.add(cgst).add(sgst).add(igst).neg().toFixed(2),
        unitCost: l.unitCost.toString(),
        shelfLocationId: l.shelfLocationId,
        rejectedLocationId: l.rejectedLocationId,
        batchId: l.batchId,
        serialNumbers: p.serials,
        rejectedSerialNumbers: p.rejectedSerials,
        returnOfLineId: l.id,
      };
    });
    const totals = this.common.totals(lineData.map((l) => ({ taxable: D(l.taxableAmount), cgst: D(l.cgst), sgst: D(l.sgst), igst: D(l.igst) })));
    const ret = await tx.goodsReceipt.create({
      data: {
        companyId: original.companyId,
        number,
        supplierId: original.supplierId,
        storeId: original.storeId,
        postingDate: fromIso(postingDate),
        postingAt,
        isReturn: true,
        isConsignment: original.isConsignment,
        returnOfId: original.id,
        status: 'completed',
        remarks: input.reason,
        taxableAmount: totals.taxableAmount,
        taxAmount: totals.taxAmount,
        total: D(totals.taxableAmount).add(D(totals.taxAmount)).toFixed(2),
        lines: { create: lineData },
        finalisedAt: new Date(),
        finalisedById: actor.userId,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
      include: receiptInclude,
    });

    // Out at the original line's cost: each out-leg takes its cost from the original in-entry.
    const movements: Movement[] = [];
    for (const [i, p] of plan.entries()) {
      const retLine = ret.lines[i];
      const originals = await tx.stockLedgerEntry.findMany({ where: { documentId: original.id, documentLineId: p.line.id, kind: 'in', isCancellation: false } });
      const fromShelf = originals.find((e) => e.locationId === p.line.shelfLocationId);
      const fromRejected = originals.find((e) => e.locationId === p.line.rejectedLocationId);
      const base = { companyId: original.companyId, documentType: 'goods_receipt', documentId: ret.id, documentLineId: retLine.id, itemId: p.line.itemId, batchId: p.line.batchId, postingDate, postingAt, accountRole: roleOf(original) };
      if (p.basicAcc.gt(0)) movements.push({ ...base, locationId: p.line.shelfLocationId, kind: 'out', quantity: p.basicAcc.toString(), costSourceId: fromShelf?.id ?? null });
      if (p.basicRej.gt(0)) movements.push({ ...base, locationId: p.line.rejectedLocationId!, kind: 'out', quantity: p.basicRej.toString(), costSourceId: fromRejected?.id ?? null });
    }
    const entries = await this.engine.post(tx, movements, { allowNegative: false, actorId: actor.userId, describe: await this.describer(tx, original) });
    await this.applySerials(tx, ret, 'finalise', actor);

    for (const p of plan) {
      await tx.goodsReceiptLine.update({
        where: { id: p.line.id },
        data: {
          returnedAcceptedQuantity: D(p.line.returnedAcceptedQuantity).add(p.basicAcc).toString(),
          returnedRejectedQuantity: D(p.line.returnedRejectedQuantity).add(p.basicRej).toString(),
        },
      });
      if (p.line.orderLineId) {
        const ol = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: p.line.orderLineId } });
        await tx.purchaseOrderLine.update({ where: { id: ol.id }, data: { receivedQuantity: Decimal.max(0, D(ol.receivedQuantity).sub(p.basicAcc).sub(p.basicRej)).toString() } });
      }
    }
    await tx.goodsReceipt.update({ where: { id: ret.id }, data: { stockValue: entries.reduce((s, e) => s.add(D(e.valueChange)), new Decimal(0)).toFixed(2) } });
    await this.refreshReturns(tx, original.id);
    await this.refreshBilling(tx, original.id);
    for (const orderId of new Set(original.lines.map((l) => l.orderLine?.orderId).filter((x): x is string => !!x))) await this.orders.refreshProgress(tx, orderId);
    await this.audit.record(tx, actor, { action: 'create', entityType: 'goods_receipt', entityId: ret.id, changes: { number, returnOf: original.number, lines: plan.length }, reason: input.reason });
    return this.getRow(tx, ret.id);
  }

  // ---- Cancelling ----

  async cancel(id: string, reason: string, actor: Actor, user: CurrentUser) {
    const r = await this.getRow(this.prisma, id);
    assertStoreAccess(user, r.storeId);
    if (r.billId) throw new BadRequestException('This receipt belongs to a supplier bill; cancel the bill instead');
    this.common.requireRight(user, r.isReturn ? 'purchase.return' : 'purchase.receive');
    const after = await this.prisma.$transaction(async (tx) => this.cancelInTx(tx, id, reason, actor, user), { timeout: 60_000, maxWait: 30_000 });
    return this.toDto(after, user);
  }

  async cancelInTx(tx: Db, id: string, reason: string, actor: Actor, user: CurrentUser, opts: { forBillId?: string } = {}): Promise<ReceiptRow> {
    const r = await this.getRow(tx, id);
    if (r.status === 'cancelled') throw new BadRequestException('Already cancelled');
    if (r.status === 'draft') {
      await tx.goodsReceipt.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'goods_receipt', entityId: id, changes: { status: { old: 'draft', new: 'cancelled' }, number: r.number }, reason });
      return this.getRow(tx, id);
    }
    const lineIds = r.lines.map((l) => l.id);
    if (!r.isReturn) {
      const bills = await tx.supplierBillLine.count({ where: { receiptLineId: { in: lineIds }, bill: { status: { not: 'cancelled' }, ...(opts.forBillId ? { id: { not: opts.forBillId } } : {}) } } });
      if (bills) throw new BadRequestException('A supplier bill refers to this receipt; cancel the bill first');
      const returns = await tx.goodsReceipt.count({ where: { returnOfId: id, status: { not: 'cancelled' } } });
      if (returns) throw new BadRequestException('Goods from this receipt were returned; cancel the return first');
      const charges = await tx.landedChargeShare.count({ where: { receiptLineId: { in: lineIds }, charge: { status: 'finalised' } } });
      if (charges) throw new BadRequestException('Extra charges were added to this receipt; cancel them first');
      if (r.isConsignment) {
        // Sold sale-or-return goods are owed to the supplier: they cannot silently disappear.
        const picture = await this.consignment.picture(tx, r.storeId, [...new Set(r.lines.map((l) => l.itemId))]);
        const sold = picture.layers.filter((l) => lineIds.includes(l.lineId) && l.sold.gt(0));
        if (sold.length) {
          const list = sold.map((l) => `${r.lines.find((x) => x.id === l.lineId)!.item.code} × ${l.sold.toString()}`).join(', ');
          throw new BadRequestException(`Some of these sale-or-return goods were sold (${list}); they are owed to the supplier, so the receipt cannot be cancelled`);
        }
      }
    }
    if (iso(r.postingDate)!.slice(0, 7) < businessDate().slice(0, 7) && !hasPermission(user, 'stock.backdate')) {
      throw new ForbiddenException('Only the Accountant may cancel a goods receipt from an earlier month');
    }
    await this.common.checkStockDate(tx, r.companyId, iso(r.postingDate)!, 'The cancellation');
    if (r.isReturn) {
      // A return to the supplier posted itself through the engine (goods received not billed against stock).
      await this.engine.reverseDocument(tx, id, (e) => e.documentLineId, { allowNegative: false, actorId: actor.userId, describe: await this.describer(tx, r) });
    } else {
      const reversals = await this.engine.reverseDocument(tx, id, (e) => e.documentLineId, { allowNegative: false, actorId: actor.userId, describe: await this.describer(tx, r), ledger: 'held' });
      await this.postings.cancelGoodsReceipt(tx, id, reversals.map((e) => e.id), actor.userId);
    }
    await this.applySerials(tx, r, 'cancel', actor);

    for (const l of r.lines) {
      const basic = D(l.basicAcceptedQuantity).add(D(l.basicRejectedQuantity)); // negative on returns
      if (l.orderLineId) {
        const ol = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: l.orderLineId } });
        await tx.purchaseOrderLine.update({ where: { id: ol.id }, data: { receivedQuantity: Decimal.max(0, D(ol.receivedQuantity).sub(basic)).toString() } });
      }
      if (r.isReturn && l.returnOfLineId) {
        const orig = await tx.goodsReceiptLine.findUniqueOrThrow({ where: { id: l.returnOfLineId } });
        await tx.goodsReceiptLine.update({
          where: { id: orig.id },
          data: {
            returnedAcceptedQuantity: Decimal.max(0, D(orig.returnedAcceptedQuantity).add(D(l.basicAcceptedQuantity))).toString(),
            returnedRejectedQuantity: Decimal.max(0, D(orig.returnedRejectedQuantity).add(D(l.basicRejectedQuantity))).toString(),
          },
        });
      }
    }
    await tx.goodsReceipt.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason, updatedById: actor.userId } });
    if (r.isReturn && r.returnOfId) {
      await this.refreshReturns(tx, r.returnOfId);
      await this.refreshBilling(tx, r.returnOfId);
    }
    for (const orderId of new Set(r.lines.map((l) => l.orderLine?.orderId).filter((x): x is string => !!x))) await this.orders.refreshProgress(tx, orderId);
    await this.audit.record(tx, actor, { action: 'update', entityType: 'goods_receipt', entityId: id, changes: { status: { old: r.status, new: 'cancelled' }, number: r.number }, reason });
    return this.getRow(tx, id);
  }

  // ---- Progress ----

  /** Billed share and status of a receipt (blueprint 07: to bill → partly billed → completed). */
  async refreshBilling(tx: Db, receiptId: string): Promise<void> {
    const r = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: { lines: true } });
    if (r.isReturn || ['draft', 'cancelled', 'closed'].includes(r.status)) return;
    const billedPercent = percentDone(
      r.lines.map((l) => ({
        ordered: D(l.basicAcceptedQuantity).add(D(l.basicRejectedQuantity)).sub(D(l.returnedAcceptedQuantity)).sub(D(l.returnedRejectedQuantity)).toString(),
        done: l.billedQuantity.toString(),
      })),
    );
    const anythingLeft = r.lines.some((l) => D(l.basicAcceptedQuantity).add(D(l.basicRejectedQuantity)).sub(D(l.returnedAcceptedQuantity)).sub(D(l.returnedRejectedQuantity)).gt(0));
    const anyBilled = r.lines.some((l) => D(l.billedQuantity).gt(0));
    const status = !anythingLeft ? 'returned' : r.isConsignment || billedPercent.gte(100) || D(r.total).eq(0) ? 'completed' : anyBilled ? 'partly_billed' : 'to_bill';
    await tx.goodsReceipt.update({ where: { id: receiptId }, data: { billedPercent: billedPercent.toFixed(2), status } });
  }

  private async refreshReturns(tx: Db, receiptId: string): Promise<void> {
    const r = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: { lines: true } });
    const returnedPercent = percentDone(
      r.lines.map((l) => ({
        ordered: D(l.basicAcceptedQuantity).add(D(l.basicRejectedQuantity)).toString(),
        done: D(l.returnedAcceptedQuantity).add(D(l.returnedRejectedQuantity)).toString(),
      })),
    );
    await tx.goodsReceipt.update({ where: { id: receiptId }, data: { returnedPercent: returnedPercent.toFixed(2) } });
  }

  // ---- Serial numbers ----

  private async applySerials(tx: Db, r: ReceiptRow, mode: 'finalise' | 'cancel', actor: Actor): Promise<void> {
    for (const l of r.lines) {
      if (!l.item.trackSerials) continue;
      const groups: [string[], string | null][] = [
        [l.serialNumbers, l.shelfLocationId],
        [l.rejectedSerialNumbers, l.rejectedLocationId],
      ];
      for (const [serials, locationId] of groups) {
        if (!serials.length) continue;
        const incoming = !r.isReturn === (mode === 'finalise');
        if (incoming) {
          const existing = await tx.serialNumber.findMany({ where: { itemId: l.itemId, serial: { in: serials } } });
          const inStock = existing.filter((s) => s.status !== 'out' && !(mode === 'cancel' && s.outDocumentId === r.id));
          if (inStock.length) throw new BadRequestException(`${l.item.code}: serial ${inStock.map((s) => s.serial).join(', ')} is already in stock`);
          for (const s of serials) {
            await tx.serialNumber.upsert({
              where: { itemId_serial: { itemId: l.itemId, serial: s } },
              create: { itemId: l.itemId, serial: s, status: 'in_stock', locationId, batchId: l.batchId, inDocumentId: r.id, createdById: actor.userId, updatedById: actor.userId },
              update: { status: 'in_stock', locationId, batchId: l.batchId, ...(mode === 'finalise' ? { inDocumentId: r.id } : {}), outDocumentId: null, updatedById: actor.userId },
            });
          }
        } else {
          const rows = await tx.serialNumber.findMany({ where: { itemId: l.itemId, serial: { in: serials } } });
          const bad = serials.filter((s) => !rows.some((row) => row.serial === s && row.status === 'in_stock' && row.locationId === locationId));
          if (bad.length) throw new BadRequestException(`${l.item.code}: serial ${bad.join(', ')} is not in stock at this location`);
          await tx.serialNumber.updateMany({ where: { itemId: l.itemId, serial: { in: serials } }, data: { status: 'out', locationId: null, outDocumentId: r.id, updatedById: actor.userId } });
        }
      }
    }
  }

  private async describer(tx: Db, r: ReceiptRow): Promise<(itemId: string, locationId: string) => string> {
    const items = new Map(r.lines.map((l) => [l.itemId, `${l.item.code} ${l.item.name}`]));
    const locs = await tx.stockLocation.findMany({ where: { storeId: r.storeId } });
    const names = new Map(locs.map((l) => [l.id, `${l.name} (${r.store.code})`]));
    return (itemId, locationId) => `${items.get(itemId) ?? 'item'}${names.has(locationId) ? ` at ${names.get(locationId)}` : ''}`;
  }

  // ---- Output ----

  private header(r: GoodsReceipt & { supplier: { id: string; code: string; name: string }; store: { id: string; code: string; name: string } }, user: CurrentUser) {
    const prices = hasPermission(user, 'buying_prices.view');
    const costs = hasPermission(user, 'stock.cost.view');
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      isReturn: r.isReturn,
      isConsignment: r.isConsignment,
      returnOfId: r.returnOfId,
      billId: r.billId,
      supplier: r.supplier,
      store: r.store,
      postingDate: iso(r.postingDate),
      postingAt: r.postingAt,
      deliveryNoteNo: r.deliveryNoteNo,
      transporterName: r.transporterName,
      vehicleNo: r.vehicleNo,
      noOrderReason: r.noOrderReason,
      ...(prices ? { taxableAmount: r.taxableAmount.toFixed(2), taxAmount: r.taxAmount.toFixed(2), total: r.total.toFixed(2) } : {}),
      ...(costs ? { stockValue: r.stockValue.toFixed(2) } : {}),
      billedPercent: r.billedPercent.toFixed(2),
      returnedPercent: r.returnedPercent.toFixed(2),
      check: r.checkResult ? { result: r.checkResult, remarks: r.checkRemarks, checkedAt: r.checkedAt, checkedById: r.checkedById } : null,
      isBackDated: r.isBackDated,
      remarks: r.remarks,
      cancelReason: r.cancelReason,
      createdAt: r.createdAt,
      finalisedAt: r.finalisedAt,
    };
  }

  toDto(r: ReceiptRow, user: CurrentUser) {
    const prices = hasPermission(user, 'buying_prices.view');
    const costs = hasPermission(user, 'stock.cost.view');
    return {
      ...this.header(r, user),
      lines: r.lines.map((l) => {
        const left = D(l.basicAcceptedQuantity).add(D(l.basicRejectedQuantity)).sub(D(l.returnedAcceptedQuantity)).sub(D(l.returnedRejectedQuantity)).sub(D(l.billedQuantity));
        return {
          id: l.id,
          lineNo: l.lineNo,
          orderLineId: l.orderLineId,
          order: l.orderLine ? { id: l.orderLine.order.id, number: l.orderLine.order.number } : null,
          item: { id: l.item.id, code: l.item.code, name: l.item.name, trackBatches: l.item.trackBatches, trackSerials: l.item.trackSerials },
          unitId: l.unitId,
          factor: l.factor.toString(),
          receivedQuantity: l.receivedQuantity.toString(),
          acceptedQuantity: l.acceptedQuantity.toString(),
          rejectedQuantity: l.rejectedQuantity.toString(),
          freeQuantity: l.freeQuantity.toString(),
          basicAcceptedQuantity: l.basicAcceptedQuantity.toString(),
          basicRejectedQuantity: l.basicRejectedQuantity.toString(),
          returnedAcceptedQuantity: l.returnedAcceptedQuantity.toString(),
          returnedRejectedQuantity: l.returnedRejectedQuantity.toString(),
          billedQuantity: l.billedQuantity.toString(),
          billableQuantity: Decimal.max(0, left).toString(),
          shelfLocationId: l.shelfLocationId,
          rejectedLocationId: l.rejectedLocationId,
          batchId: l.batchId,
          newBatchNumber: l.newBatchNumber,
          newExpiryOn: iso(l.newExpiryOn),
          serialNumbers: l.serialNumbers,
          rejectedSerialNumbers: l.rejectedSerialNumbers,
          returnOfLineId: l.returnOfLineId,
          ...(prices
            ? {
                rate: l.rate.toFixed(2),
                discountPercent: l.discountPercent.toFixed(2),
                discountAmount: l.discountAmount.toFixed(2),
                taxableAmount: l.taxableAmount.toFixed(2),
                gstRate: l.gstRate.toString(),
                cgst: l.cgst.toFixed(2),
                sgst: l.sgst.toFixed(2),
                igst: l.igst.toFixed(2),
                lineTotal: l.lineTotal.toFixed(2),
              }
            : {}),
          ...(costs ? { unitCost: l.unitCost.toFixed(4), extraCharges: l.extraCharges.toFixed(2) } : {}),
        };
      }),
    };
  }
}

export function receiptLineData(l: ResolvedReceiptLine, i: number) {
  return {
    lineNo: i + 1,
    orderLineId: l.orderLineId,
    itemId: l.itemId,
    unitId: l.unitId,
    factor: l.factor.toString(),
    receivedQuantity: l.receivedQuantity.toString(),
    acceptedQuantity: l.acceptedQuantity.toString(),
    rejectedQuantity: l.rejectedQuantity.toString(),
    freeQuantity: l.freeQuantity.toString(),
    basicAcceptedQuantity: l.basicAcceptedQuantity.toString(),
    basicRejectedQuantity: l.basicRejectedQuantity.toString(),
    rate: l.priced.rate.toString(),
    discountPercent: l.priced.discountPercent.toFixed(2),
    discountAmount: l.priced.discountAmount.toFixed(2),
    taxableAmount: l.priced.taxable.toFixed(2),
    gstRate: l.priced.gstRate.toString(),
    cgst: l.priced.cgst.toFixed(2),
    sgst: l.priced.sgst.toFixed(2),
    igst: l.priced.igst.toFixed(2),
    lineTotal: l.priced.lineTotal.toFixed(2),
    shelfLocationId: l.shelfLocationId,
    rejectedLocationId: l.rejectedLocationId,
    batchId: l.batchId,
    newBatchNumber: l.newBatchNumber,
    newManufactureOn: l.newManufactureOn ? fromIso(l.newManufactureOn) : null,
    newExpiryOn: l.newExpiryOn ? fromIso(l.newExpiryOn) : null,
    serialNumbers: l.serialNumbers,
    rejectedSerialNumbers: l.rejectedSerialNumbers,
  };
}

function lineInputOf(l: ReceiptRow['lines'][number]): GoodsReceiptLineInput {
  return {
    orderLineId: l.orderLineId,
    itemId: l.itemId,
    unitId: l.unitId,
    receivedQuantity: l.receivedQuantity.toString(),
    freeQuantity: l.freeQuantity.toString(),
    rejectedQuantity: l.rejectedQuantity.toString(),
    rate: l.rate.toString(),
    discountPercent: l.discountPercent.toString(),
    discountAmount: l.discountAmount.toString(),
    gstRate: l.gstRate.toString(),
    cgst: l.cgst.toString(),
    sgst: l.sgst.toString(),
    igst: l.igst.toString(),
    shelfLocationId: l.shelfLocationId,
    batchId: l.batchId,
    batchNumber: l.newBatchNumber,
    manufactureDate: iso(l.newManufactureOn),
    expiryDate: iso(l.newExpiryOn),
    serialNumbers: l.serialNumbers,
    rejectedSerialNumbers: l.rejectedSerialNumbers,
  };
}

function headerOf(r: ReceiptRow): ReceiptHeader {
  return {
    supplierId: r.supplierId,
    storeId: r.storeId,
    postingDate: iso(r.postingDate)!,
    deliveryNoteNo: r.deliveryNoteNo,
    transporterName: r.transporterName,
    vehicleNo: r.vehicleNo,
    noOrderReason: r.noOrderReason,
    isConsignment: r.isConsignment,
    remarks: r.remarks,
  };
}

function summarise(r: ReceiptRow): Record<string, unknown> {
  return {
    supplierId: r.supplierId,
    storeId: r.storeId,
    postingDate: iso(r.postingDate),
    deliveryNoteNo: r.deliveryNoteNo,
    noOrderReason: r.noOrderReason,
    isConsignment: r.isConsignment,
    lines: r.lines.map((l) => `${l.item.code}×${l.receivedQuantity.toString()}(−${l.rejectedQuantity.toString()})`),
  };
}

export type { StockLedgerEntry };
