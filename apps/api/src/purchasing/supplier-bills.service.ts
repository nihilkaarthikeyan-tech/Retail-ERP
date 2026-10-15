// Copyright (c) 2026, Rademics. All rights reserved.
// Supplier bills and debit notes (blueprint 07 processes 5–6; plan 05 §4,
// answers 1, 2 and 4). Amounts and account roles are stored; module 7 posts
// them. Supplier balances and payments come with module 7 (decision 51).
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  businessDate,
  type CreateSupplierBillInput,
  type CurrentUser,
  type DebitNoteInput,
  Decimal,
  dueDates,
  type FinaliseBillInput,
  hasPermission,
  type HoldBillInput,
  INDIA_TIME_ZONE,
  isOverAllowance,
  PURCHASE_ACCOUNT_ROLES,
  QUANTITY_TOLERANCE,
  roundMoney,
  type SupplierBillLineInput,
  type SupplierBillQuery,
  type UpdateSupplierBillInput,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { assertStoreAccess } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import type { Prisma, SupplierBill, SupplierBillKind, Supplier } from '../generated/prisma/client.js';
import { postingInstant } from '../inventory/stock-documents.service.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GoodsReceiptsService, type ReceiptHeader, type ResolvedReceiptLine } from './goods-receipts.service.js';
import { D, fromIso, iso, PurchaseCommon } from './purchase-common.service.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';

export const billInclude = {
  supplier: { select: { id: true, code: true, name: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      item: { select: { id: true, code: true, name: true, isStockItem: true } },
      receiptLine: { select: { id: true, receiptId: true, receipt: { select: { id: true, number: true, storeId: true } } } },
      orderLine: { select: { id: true, orderId: true, order: { select: { id: true, number: true } } } },
    },
  },
} satisfies Prisma.SupplierBillInclude;
export type BillRow = Prisma.SupplierBillGetPayload<{ include: typeof billInclude }>;

interface ResolvedBillLine {
  receiptLineId: string | null;
  orderLineId: string | null;
  itemId: string;
  itemCode: string;
  unitId: string;
  factor: Decimal;
  quantity: Decimal;
  freeQuantity: Decimal;
  basicQuantity: Decimal;
  priced: ReturnType<PurchaseCommon['price']>;
  priceDifference: Decimal;
  accountRole: string;
}

interface PreparedBill {
  supplier: Supplier;
  storeId: string | null;
  financialYearId: string;
  dueDate: string;
  paymentTermsId: string | null;
  lines: ResolvedBillLine[];
  /** Bills that receive goods: the receipt lines to create on finalising. */
  receipt?: { header: ReceiptHeader; lines: ResolvedReceiptLine[] };
}

@Injectable()
export class SupplierBillsService {
  private readonly log = new Logger(SupplierBillsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly common: PurchaseCommon,
    private readonly orders: PurchaseOrdersService,
    private readonly receipts: GoodsReceiptsService,
  ) {}

  // ---- Reading ----

  async list(q: SupplierBillQuery, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const stores = this.common.storeFilter(user);
    const where: Prisma.SupplierBillWhereInput = {
      companyId: company.id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.held === 'true' ? { holdUntil: { not: null } } : q.held === 'false' ? { holdUntil: null } : {}),
      ...(q.dueBy ? { dueDate: { lte: fromIso(q.dueBy) }, status: 'unpaid' } : {}),
      ...(stores ? { OR: [{ storeId: null }, { storeId: { in: stores } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.supplierBill.findMany({ where, include: { supplier: billInclude.supplier }, orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.supplierBill.count({ where }),
    ]);
    return { rows: rows.map((b) => this.header(b, user)), total, page, pageSize };
  }

  async get(id: string, user: CurrentUser) {
    const b = await this.getRow(this.prisma, id);
    if (b.storeId) assertStoreAccess(user, b.storeId);
    return this.toDto(b, user);
  }

  async getRow(db: Db, id: string): Promise<BillRow> {
    const b = await db.supplierBill.findUnique({ where: { id }, include: billInclude });
    if (!b) throw new NotFoundException('Supplier bill not found');
    return b;
  }

  // ---- Drafts ----

  async create(input: CreateSupplierBillInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.bill');
    const company = await this.common.currentCompany();
    const postingDate = input.postingDate ?? businessDate();
    const prepared = await this.prepare(this.prisma, company.id, input.kind, { ...input, postingDate }, user, null);
    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.common.allocate(tx, { companyId: company.id, documentKind: 'supplier_bill', date: postingDate });
      const b = await tx.supplierBill.create({
        data: {
          companyId: company.id,
          number,
          supplierId: input.supplierId,
          kind: input.kind,
          supplierBillNo: input.supplierBillNo.trim(),
          supplierBillDate: fromIso(input.supplierBillDate),
          postingDate: fromIso(postingDate),
          postingAt: postingInstant(postingDate, input.postingTime),
          financialYearId: prepared.financialYearId,
          storeId: prepared.storeId,
          paymentTermsId: prepared.paymentTermsId,
          dueDate: fromIso(prepared.dueDate),
          remarks: input.remarks ?? null,
          ...this.totalsOf(prepared.lines),
          lines: { create: prepared.lines.map((l, i) => billLineData(l, i)) },
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      if (prepared.receipt) await this.linkDraftReceipt(tx, company.id, b.id, prepared.receipt, actor);
      await this.audit.record(tx, actor, { action: 'create', entityType: 'supplier_bill', entityId: b.id, changes: { number, kind: input.kind, supplierBillNo: b.supplierBillNo, total: b.total.toString() } });
      return this.getRow(tx, b.id);
    });
    return this.toDto(created, user);
  }

  async update(id: string, input: UpdateSupplierBillInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.bill');
    const before = await this.getRow(this.prisma, id);
    if (before.status !== 'draft' || before.kind === 'debit_note') throw new BadRequestException('Only draft bills can be changed');
    const merged = {
      supplierId: input.supplierId ?? before.supplierId,
      supplierBillNo: input.supplierBillNo ?? before.supplierBillNo,
      supplierBillDate: input.supplierBillDate ?? iso(before.supplierBillDate)!,
      postingDate: input.postingDate ?? iso(before.postingDate)!,
      storeId: input.storeId !== undefined ? input.storeId : before.storeId,
      paymentTermsId: input.paymentTermsId !== undefined ? input.paymentTermsId : before.paymentTermsId,
      remarks: input.remarks !== undefined ? input.remarks : before.remarks,
      lines: input.lines ?? (await this.storedLineInputs(this.prisma, before)),
    };
    const prepared = await this.prepare(this.prisma, before.companyId, before.kind as CreateSupplierBillInput['kind'], merged, user, id);
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.supplierBill.update({
        where: { id },
        data: {
          supplierId: merged.supplierId,
          supplierBillNo: merged.supplierBillNo.trim(),
          supplierBillDate: fromIso(merged.supplierBillDate),
          postingDate: fromIso(merged.postingDate),
          postingAt: input.postingDate || input.postingTime ? postingInstant(merged.postingDate, input.postingTime) : undefined,
          financialYearId: prepared.financialYearId,
          storeId: prepared.storeId,
          paymentTermsId: prepared.paymentTermsId,
          dueDate: fromIso(prepared.dueDate),
          remarks: merged.remarks ?? null,
          ...this.totalsOf(prepared.lines),
          updatedById: actor.userId,
          lines: { deleteMany: {}, create: prepared.lines.map((l, i) => billLineData(l, i)) },
        },
      });
      if (prepared.receipt) await this.linkDraftReceipt(tx, before.companyId, id, prepared.receipt, actor, before.receiptId);
      const a = await this.getRow(tx, id);
      await this.audit.recordUpdate(tx, actor, 'supplier_bill', id, summarise(before), summarise(a));
      return a;
    });
    return this.toDto(after, user);
  }

  /** All the checks of blueprint 07 process 5 that do not need locks. */
  private async prepare(
    db: Db,
    companyId: string,
    kind: CreateSupplierBillInput['kind'],
    input: { supplierId: string; supplierBillNo: string; supplierBillDate: string; postingDate: string; storeId?: string | null; paymentTermsId?: string | null; lines: SupplierBillLineInput[] },
    user: CurrentUser,
    selfId: string | null,
  ): Promise<PreparedBill> {
    const supplier = await this.common.supplierForBills(db, input.supplierId, user);
    if (input.supplierBillDate > businessDate()) throw new BadRequestException('The supplier’s bill date cannot be in the future');
    const postingYear = await this.common.checkPostingDate(db, companyId, input.postingDate, 'A bill');
    const billYear = await db.financialYear.findFirst({ where: { companyId, startDate: { lte: fromIso(input.supplierBillDate) }, endDate: { gte: fromIso(input.supplierBillDate) } } });
    const financialYearId = billYear?.id ?? postingYear.id;
    await this.assertBillNoFree(db, companyId, supplier.id, input.supplierBillNo, financialYearId, selfId);

    const interState = await this.common.interState(db, supplier, input.storeId ?? null);
    const lines: ResolvedBillLine[] = [];
    let storeId: string | null = input.storeId ?? null;
    let receipt: PreparedBill['receipt'];

    if (kind === 'receives_goods') {
      if (!input.storeId) throw new BadRequestException('Choose the store the goods arrive at');
      const header: ReceiptHeader = { supplierId: supplier.id, storeId: input.storeId, postingDate: input.postingDate, noOrderReason: null, remarks: `Received with supplier bill ${input.supplierBillNo}` };
      const resolved = await this.receipts.resolve(
        db,
        companyId,
        header,
        input.lines.map((l) => ({
          orderLineId: l.orderLineId,
          itemId: l.itemId,
          unitId: l.unitId,
          receivedQuantity: D(l.quantity).add(D(l.freeQuantity ?? '0')).toString(),
          freeQuantity: l.freeQuantity,
          rejectedQuantity: '0',
          rate: l.rate,
          discountPercent: l.discountPercent,
          discountAmount: l.discountAmount,
          gstRate: l.gstRate,
          cgst: l.cgst,
          sgst: l.sgst,
          igst: l.igst,
          shelfLocationId: l.shelfLocationId,
          batchId: l.batchId,
          batchNumber: l.batchNumber,
          manufactureDate: l.manufactureDate,
          expiryDate: l.expiryDate,
          serialNumbers: l.serialNumbers,
        })),
        user,
        { forBill: true },
      );
      receipt = { header, lines: resolved.lines };
      for (const r of resolved.lines) {
        lines.push({
          receiptLineId: null,
          orderLineId: r.orderLineId,
          itemId: r.itemId,
          itemCode: r.itemCode,
          unitId: r.unitId,
          factor: r.factor,
          quantity: r.receivedQuantity.sub(r.freeQuantity),
          freeQuantity: r.freeQuantity,
          basicQuantity: r.basicAcceptedQuantity,
          priced: r.priced,
          priceDifference: new Decimal(0),
          accountRole: PURCHASE_ACCOUNT_ROLES.stock,
        });
      }
    } else {
      for (const l of input.lines) {
        const label = 'Line';
        if (kind === 'against_receipt') {
          if (!l.receiptLineId) throw new BadRequestException('Choose the goods receipt line this bill line is for');
          const rl = await db.goodsReceiptLine.findUnique({ where: { id: l.receiptLineId }, include: { receipt: true, item: true } });
          if (!rl || rl.receipt.companyId !== companyId || rl.receipt.isReturn) throw new BadRequestException('Goods receipt line not found');
          if (['draft', 'cancelled', 'closed'].includes(rl.receipt.status)) throw new BadRequestException(`Goods receipt ${rl.receipt.number} is ${rl.receipt.status}`);
          if (rl.receipt.supplierId !== supplier.id) throw new BadRequestException(`Goods receipt ${rl.receipt.number} is from another supplier`);
          if (l.itemId !== rl.itemId || (l.unitId && l.unitId !== rl.unitId)) throw new BadRequestException(`The item and unit must match goods receipt ${rl.receipt.number}`);
          assertStoreAccess(user, rl.receipt.storeId);
          storeId = rl.receipt.storeId;
          const factor = D(rl.factor);
          const quantity = D(l.quantity);
          const freeQuantity = D(l.freeQuantity ?? '0');
          const basicQuantity = this.common.basic(quantity.add(freeQuantity), factor);
          const billable = D(rl.basicAcceptedQuantity).add(D(rl.basicRejectedQuantity)).sub(D(rl.returnedAcceptedQuantity)).sub(D(rl.returnedRejectedQuantity)).sub(D(rl.billedQuantity));
          if (basicQuantity.gt(billable.add(QUANTITY_TOLERANCE))) throw new BadRequestException(`${rl.item.code}: only ${Decimal.max(0, billable).toString()} still to be billed on receipt ${rl.receipt.number}`);
          const gstTyped = l.cgst !== undefined || l.sgst !== undefined || l.igst !== undefined || l.gstRate !== undefined;
          const priced = this.common.price(
            {
              quantity: quantity.toString(),
              rate: l.rate ?? rl.rate.toString(),
              discountPercent: l.discountPercent ?? rl.discountPercent.toString(),
              discountAmount: l.discountAmount ?? null,
              gstRate: gstTyped ? (l.gstRate ?? rl.gstRate.toString()) : rl.gstRate.toString(),
              ...(gstTyped ? { cgst: l.cgst, sgst: l.sgst, igst: l.igst } : {}),
            },
            interState,
            rl.item.code,
          );
          const receiptBasic = D(rl.basicAcceptedQuantity).add(D(rl.basicRejectedQuantity));
          const receiptTaxable = roundMoney(D(rl.taxableAmount).mul(basicQuantity).div(receiptBasic));
          lines.push({
            receiptLineId: rl.id,
            orderLineId: rl.orderLineId,
            itemId: rl.itemId,
            itemCode: rl.item.code,
            unitId: rl.unitId,
            factor,
            quantity,
            freeQuantity,
            basicQuantity,
            priced,
            priceDifference: priced.taxable.sub(receiptTaxable),
            accountRole: PURCHASE_ACCOUNT_ROLES.grni,
          });
        } else {
          // Services and other non-stock purchases.
          const info = await this.common.itemUnit(db, l.itemId, l.unitId, [l.quantity]);
          if (info.item.isStockItem) throw new BadRequestException(`${info.item.code} is a stock item; record a goods receipt, or a bill that receives the goods`);
          const orderLine = l.orderLineId ? await this.openOrderLine(db, companyId, supplier, l.orderLineId, l.itemId, input.supplierBillDate) : null;
          const rate = l.rate ?? orderLine?.rate.toString() ?? (await this.common.buyingRate(db, supplier, info, input.postingDate, l.quantity, user));
          if (rate == null) throw new BadRequestException(`${info.item.code}: give the price`);
          const priced = this.common.price({ quantity: l.quantity, rate, discountPercent: l.discountPercent, discountAmount: l.discountAmount, gstRate: l.gstRate ?? (await this.common.lastGstRate(db, info.item.id)), cgst: l.cgst, sgst: l.sgst, igst: l.igst }, interState, label);
          lines.push({
            receiptLineId: null,
            orderLineId: orderLine?.id ?? null,
            itemId: info.item.id,
            itemCode: info.item.code,
            unitId: info.unitId,
            factor: info.factor,
            quantity: D(l.quantity),
            freeQuantity: new Decimal(0),
            basicQuantity: this.common.basic(l.quantity, info.factor),
            priced,
            priceDifference: new Decimal(0),
            accountRole: PURCHASE_ACCOUNT_ROLES.expense,
          });
        }
      }
    }

    // The bill date cannot be before the order date (blueprint 07 rules).
    for (const l of lines) {
      if (!l.orderLineId) continue;
      const ol = await db.purchaseOrderLine.findUniqueOrThrow({ where: { id: l.orderLineId }, include: { order: true } });
      if (input.supplierBillDate < iso(ol.order.orderDate)!) throw new BadRequestException(`The bill cannot be dated before order ${ol.order.number}`);
    }

    const paymentTermsId = input.paymentTermsId ?? supplier.paymentTermsId ?? null;
    let dueDate = input.supplierBillDate;
    if (paymentTermsId) {
      const terms = await db.paymentTerms.findUnique({ where: { id: paymentTermsId }, include: { parts: true } });
      if (!terms) throw new BadRequestException('Payment terms not found');
      dueDate = dueDates(input.supplierBillDate, terms.parts.map((p) => ({ share: p.share.toString(), dueBasis: p.dueBasis, days: p.days, months: p.months }))).dueDate;
    }
    if (dueDate < input.postingDate) dueDate = input.postingDate; // never before the posting date
    return { supplier, storeId, financialYearId, dueDate, paymentTermsId, lines, receipt };
  }

  private async openOrderLine(db: Db, companyId: string, supplier: Supplier, orderLineId: string, itemId: string, billDate: string) {
    const ol = await db.purchaseOrderLine.findUnique({ where: { id: orderLineId }, include: { order: true } });
    if (!ol || ol.order.companyId !== companyId) throw new BadRequestException('Purchase order line not found');
    this.orders.assertOpenForGoods(ol.order);
    if (ol.order.supplierId !== supplier.id) throw new BadRequestException(`Order ${ol.order.number} is from another supplier`);
    if (ol.itemId !== itemId) throw new BadRequestException(`The item must match order ${ol.order.number}`);
    if (billDate < iso(ol.order.orderDate)!) throw new BadRequestException(`The bill cannot be dated before order ${ol.order.number}`);
    return ol;
  }

  /** The supplier's bill number is unique per supplier per financial year (if the business checks it). */
  private async assertBillNoFree(db: Db, companyId: string, supplierId: string, billNo: string, financialYearId: string, selfId: string | null) {
    const settings = await this.common.settings(db, companyId);
    if (!settings.checkSupplierBillNo) return;
    const clash = await db.supplierBill.findFirst({
      where: {
        companyId,
        supplierId,
        financialYearId,
        kind: { not: 'debit_note' },
        status: { not: 'cancelled' },
        supplierBillNo: { equals: billNo.trim(), mode: 'insensitive' },
        ...(selfId ? { id: { not: selfId } } : {}),
      },
    });
    if (clash) throw new BadRequestException(`Bill number ${clash.supplierBillNo} from this supplier is already recorded as ${clash.number}`);
  }

  private totalsOf(lines: ResolvedBillLine[]) {
    const t = this.common.totals(lines.map((l) => l.priced));
    const priceDifference = lines.reduce((s, l) => s.add(l.priceDifference), new Decimal(0));
    return { ...t, priceDifference: priceDifference.toFixed(2) };
  }

  // ---- Finalising ----

  async finalise(id: string, input: FinaliseBillInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.bill');
    const b = await this.getRow(this.prisma, id);
    if (b.storeId) assertStoreAccess(user, b.storeId);
    if (b.status !== 'draft') throw new BadRequestException(`The bill is already ${b.status}`);
    if (b.kind === 'debit_note') throw new BadRequestException('Debit notes are finalised when they are made');
    const prepared = await this.prepare(
      this.prisma,
      b.companyId,
      b.kind as CreateSupplierBillInput['kind'],
      { supplierId: b.supplierId, supplierBillNo: b.supplierBillNo, supplierBillDate: iso(b.supplierBillDate)!, postingDate: iso(b.postingDate)!, storeId: b.storeId, paymentTermsId: b.paymentTermsId, lines: await this.storedLineInputs(this.prisma, b) },
      user,
      id,
    );

    // Plan 05 answer 4: a price different from the receipt is refused, warned about, or allowed.
    const settings = await this.common.settings(this.prisma, b.companyId);
    const differing = prepared.lines.filter((l) => !l.priceDifference.eq(0));
    if (differing.length && settings.priceMismatch !== 'allow') {
      const list = differing.map((l) => `${l.itemCode} ${l.priceDifference.gt(0) ? '+' : ''}${l.priceDifference.toFixed(2)}`).join(', ');
      if (settings.priceMismatch === 'block') throw new BadRequestException(`The bill’s prices differ from the goods receipts (${list}); they must match`);
      if (!input.confirmPriceDifference) throw new BadRequestException(`PRICE_DIFFERENCE: the bill’s prices differ from the goods receipts (${list}). Check with the supplier, then confirm to record the difference.`);
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Rule 7 for bill numbers: one finalisation per supplier + number at a time.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${b.supplierId}|${b.supplierBillNo.trim().toLowerCase()}`}))`;
        await this.assertBillNoFree(tx, b.companyId, b.supplierId, b.supplierBillNo, prepared.financialYearId, id);
        const fresh = await tx.supplierBill.findUniqueOrThrow({ where: { id } });
        if (fresh.status !== 'draft') throw new BadRequestException(`The bill is already ${fresh.status}`);
        let warnings: string[] = [];
        let receiptId: string | null = null;

        if (b.kind === 'receives_goods') {
          if (!b.receiptId) throw new BadRequestException('The bill has no goods to receive');
          const posted = await this.receipts.post(tx, b.receiptId, actor, user);
          warnings = posted.warnings;
          receiptId = b.receiptId;
          for (const rl of posted.receipt.lines) {
            await tx.goodsReceiptLine.update({ where: { id: rl.id }, data: { billedQuantity: D(rl.basicAcceptedQuantity).add(D(rl.basicRejectedQuantity)).toString() } });
          }
          await this.receipts.refreshBilling(tx, b.receiptId);
        } else if (b.kind === 'against_receipt') {
          const lineIds = [...new Set(b.lines.map((l) => l.receiptLineId!))].sort();
          for (const rlId of lineIds) await tx.$queryRaw`SELECT 1 FROM "GoodsReceiptLine" WHERE "id" = ${rlId}::uuid FOR UPDATE`;
          for (const l of b.lines) {
            const rl = await tx.goodsReceiptLine.findUniqueOrThrow({ where: { id: l.receiptLineId! }, include: { item: true, receipt: true } });
            const billable = D(rl.basicAcceptedQuantity).add(D(rl.basicRejectedQuantity)).sub(D(rl.returnedAcceptedQuantity)).sub(D(rl.returnedRejectedQuantity)).sub(D(rl.billedQuantity));
            if (D(l.basicQuantity).gt(billable.add(QUANTITY_TOLERANCE))) throw new BadRequestException(`${rl.item.code}: only ${Decimal.max(0, billable).toString()} still to be billed on receipt ${rl.receipt.number}`);
            await tx.goodsReceiptLine.update({ where: { id: rl.id }, data: { billedQuantity: D(rl.billedQuantity).add(D(l.basicQuantity)).toString() } });
          }
          for (const receiptId of new Set(b.lines.map((l) => l.receiptLine?.receiptId).filter((x): x is string => !!x))) await this.receipts.refreshBilling(tx, receiptId);
        }

        warnings = warnings.concat(await this.applyToOrders(tx, b, 1, user));
        await tx.supplierBill.update({
          where: { id },
          data: {
            status: 'unpaid',
            receiptId,
            priceDifferenceConfirmedById: differing.length ? user.id : null,
            finalisedAt: new Date(),
            finalisedById: actor.userId,
            updatedById: actor.userId,
          },
        });
        await this.audit.record(tx, actor, {
          action: 'update',
          entityType: 'supplier_bill',
          entityId: id,
          changes: {
            status: { old: 'draft', new: 'finalised' },
            number: b.number,
            supplierBillNo: b.supplierBillNo,
            total: b.total.toString(),
            ...(differing.length ? { priceDifferenceConfirmed: b.priceDifference.toString() } : {}),
            ...(warnings.length ? { overBilling: warnings } : {}),
          },
        });
        return { bill: await this.getRow(tx, id), warnings };
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return { ...this.toDto(result.bill, user), warnings: result.warnings };
  }

  /** Billed amounts on order lines (+1 when finalising, −1 when cancelling), with the over-billing check. */
  private async applyToOrders(tx: Db, b: BillRow, sign: 1 | -1, user: CurrentUser): Promise<string[]> {
    const warnings: string[] = [];
    const settings = await this.common.settings(tx, b.companyId);
    const byLine = new Map<string, Decimal>();
    for (const l of b.lines) if (l.orderLineId) byLine.set(l.orderLineId, (byLine.get(l.orderLineId) ?? new Decimal(0)).add(D(l.taxableAmount)));
    for (const olId of [...byLine.keys()].sort()) await tx.$queryRaw`SELECT 1 FROM "PurchaseOrderLine" WHERE "id" = ${olId}::uuid FOR UPDATE`;
    const orderIds = new Set<string>();
    for (const [olId, amount] of byLine) {
      const ol = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: olId }, include: { order: true, item: true } });
      const total = D(ol.billedAmount).add(amount.mul(sign));
      if (sign === 1) {
        if (b.kind !== 'receives_goods') this.orders.assertOpenForGoods(ol.order);
        const allowance = ol.item.overReceiptPercent ?? settings.overBillingPercent;
        if (isOverAllowance(ol.taxableAmount.toString(), total, allowance.toString())) {
          const message = `${ol.item.code}: billed ₹${total.toFixed(2)} against ₹${D(ol.taxableAmount).toFixed(2)} ordered on ${ol.order.number}`;
          if (!hasPermission(user, 'purchase.over_receive')) throw new BadRequestException(`${message} (allowance ${D(allowance).toString()}%)`);
          warnings.push(`${message}; accepted above the allowance`);
        }
      }
      await tx.purchaseOrderLine.update({ where: { id: olId }, data: { billedAmount: Decimal.max(0, total).toFixed(2) } });
      orderIds.add(ol.orderId);
    }
    for (const orderId of orderIds) await this.orders.refreshProgress(tx, orderId);
    return warnings;
  }

  // ---- Cancelling ----

  async cancel(id: string, reason: string, actor: Actor, user: CurrentUser) {
    const b = await this.getRow(this.prisma, id);
    this.common.requireRight(user, b.kind === 'debit_note' ? 'purchase.return' : 'purchase.bill');
    if (b.storeId) assertStoreAccess(user, b.storeId);
    if (b.status === 'cancelled') throw new BadRequestException('Already cancelled');
    const after = await this.prisma.$transaction(
      async (tx) => {
        if (b.status === 'draft') {
          if (b.receiptId) await tx.goodsReceipt.update({ where: { id: b.receiptId }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason } });
          await tx.supplierBill.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason } });
        } else {
          const notes = await tx.supplierBill.count({ where: { returnOfId: id, status: { not: 'cancelled' } } });
          if (notes) throw new BadRequestException('A debit note refers to this bill; cancel it first');
          if (b.kind === 'debit_note') await this.undoDebitNote(tx, b, reason, actor, user);
          else {
            if (b.kind === 'against_receipt') {
              for (const l of b.lines) {
                const rl = await tx.goodsReceiptLine.findUniqueOrThrow({ where: { id: l.receiptLineId! } });
                await tx.goodsReceiptLine.update({ where: { id: rl.id }, data: { billedQuantity: Decimal.max(0, D(rl.billedQuantity).sub(D(l.basicQuantity))).toString() } });
              }
              for (const receiptId of new Set(b.lines.map((l) => l.receiptLine?.receiptId).filter((x): x is string => !!x))) await this.receipts.refreshBilling(tx, receiptId);
            }
            await this.applyToOrders(tx, b, -1, user);
            if (b.kind === 'receives_goods' && b.receiptId) await this.receipts.cancelInTx(tx, b.receiptId, reason, actor, user, { forBillId: id });
          }
          await tx.supplierBill.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason, holdReason: null, holdUntil: null, updatedById: actor.userId } });
        }
        await this.audit.record(tx, actor, { action: 'update', entityType: 'supplier_bill', entityId: id, changes: { status: { old: b.status, new: 'cancelled' }, number: b.number }, reason });
        return this.getRow(tx, id);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.toDto(after, user);
  }

  // ---- Holding (blueprint 07: after finalising, while something is owed, with a future end date) ----

  async hold(id: string, input: HoldBillInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.bill');
    const b = await this.getRow(this.prisma, id);
    if (b.kind === 'debit_note') throw new BadRequestException('A debit note cannot be held');
    if (b.status !== 'unpaid') throw new BadRequestException('Only a finalised bill that is still owed can be held');
    if (input.until <= businessDate()) throw new BadRequestException('The hold must end on a future date');
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.supplierBill.update({ where: { id }, data: { holdReason: input.reason, holdUntil: fromIso(input.until), updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'supplier_bill', entityId: id, changes: { hold: { old: null, new: input.until }, number: b.number }, reason: input.reason });
      return this.getRow(tx, id);
    });
    return this.toDto(after, user);
  }

  async release(id: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.bill');
    const b = await this.getRow(this.prisma, id);
    if (!b.holdUntil) throw new BadRequestException('The bill is not held');
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.supplierBill.update({ where: { id }, data: { holdReason: null, holdUntil: null, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'supplier_bill', entityId: id, changes: { hold: { old: iso(b.holdUntil), new: null }, number: b.number } });
      return this.getRow(tx, id);
    });
    return this.toDto(after, user);
  }

  /** Holds end by themselves on their end date (Indian business date, rule 15). */
  async releaseEndedHolds(today: string): Promise<number> {
    const ended = await this.prisma.supplierBill.findMany({ where: { holdUntil: { lte: fromIso(today) } }, select: { id: true, number: true, holdUntil: true } });
    for (const b of ended) {
      await this.prisma.$transaction(async (tx) => {
        await tx.supplierBill.update({ where: { id: b.id }, data: { holdReason: null, holdUntil: null } });
        await this.audit.record(tx, { userId: null, ipAddress: null }, { action: 'update', entityType: 'supplier_bill', entityId: b.id, changes: { hold: { old: iso(b.holdUntil), new: null }, number: b.number }, reason: 'Hold ended' });
      });
    }
    return ended.length;
  }

  @Cron('10 2 * * *', { timeZone: INDIA_TIME_ZONE })
  async nightly(): Promise<void> {
    try {
      const n = await this.releaseEndedHolds(businessDate());
      if (n) this.log.log(`Released ${n} supplier bill hold(s)`);
    } catch (err) {
      this.log.error('Nightly bill-hold release failed', err instanceof Error ? err.stack : String(err));
    }
  }

  // ---- Debit notes (returns against a bill) ----

  async debitNote(billId: string, input: DebitNoteInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.return');
    const original = await this.getRow(this.prisma, billId);
    if (original.storeId) assertStoreAccess(user, original.storeId);
    if (original.kind === 'debit_note') throw new BadRequestException('A debit note cannot itself be returned');
    if (original.status !== 'unpaid') throw new BadRequestException('Only a finalised bill can have a debit note');
    const postingDate = input.postingDate ?? businessDate();
    if (postingDate < iso(original.postingDate)!) throw new BadRequestException('A debit note cannot be dated before the bill');
    const year = await this.common.checkPostingDate(this.prisma, original.companyId, postingDate, 'A debit note');

    const note = await this.prisma.$transaction(
      async (tx) => {
        for (const l of [...original.lines].sort((a, b) => a.id.localeCompare(b.id))) await tx.$queryRaw`SELECT 1 FROM "SupplierBillLine" WHERE "id" = ${l.id}::uuid FOR UPDATE`;
        const plan: { line: BillRow['lines'][number]; quantity: Decimal; basic: Decimal; share: Decimal }[] = [];
        for (const spec of input.lines) {
          const line = await tx.supplierBillLine.findUnique({ where: { id: spec.originalLineId }, include: billInclude.lines.include });
          if (!line || line.billId !== original.id) throw new BadRequestException('The line is not part of this bill');
          const quantity = D(spec.quantity);
          const left = D(line.quantity).sub(D(line.returnedQuantity));
          if (quantity.gt(left.add(QUANTITY_TOLERANCE))) throw new BadRequestException(`${line.item.code}: only ${left.toString()} left on the bill`);
          plan.push({ line, quantity, basic: this.common.basic(quantity, D(line.factor)), share: quantity.div(D(line.quantity)) });
        }
        const number = await this.common.allocate(tx, { companyId: original.companyId, documentKind: 'debit_note', date: postingDate });
        const part = (v: { toString(): string }, share: Decimal) => roundMoney(D(v).mul(share));
        const lineData = plan.map((p, i) => {
          const taxable = part(p.line.taxableAmount, p.share);
          const cgst = part(p.line.cgst, p.share);
          const sgst = part(p.line.sgst, p.share);
          const igst = part(p.line.igst, p.share);
          return {
            lineNo: i + 1,
            receiptLineId: p.line.receiptLineId,
            orderLineId: p.line.orderLineId,
            itemId: p.line.itemId,
            unitId: p.line.unitId,
            factor: p.line.factor.toString(),
            quantity: p.quantity.neg().toString(),
            basicQuantity: p.basic.neg().toString(),
            rate: p.line.rate.toString(),
            discountPercent: p.line.discountPercent.toString(),
            taxableAmount: taxable.neg().toFixed(2),
            gstRate: p.line.gstRate.toString(),
            cgst: cgst.neg().toFixed(2),
            sgst: sgst.neg().toFixed(2),
            igst: igst.neg().toFixed(2),
            lineTotal: taxable.add(cgst).add(sgst).add(igst).neg().toFixed(2),
            accountRole: p.line.accountRole,
            returnOfLineId: p.line.id,
          };
        });
        const totals = this.common.totals(lineData.map((l) => ({ taxable: D(l.taxableAmount), cgst: D(l.cgst), sgst: D(l.sgst), igst: D(l.igst) })));
        let returnReceiptId: string | null = null;
        // A bill that received the goods: the goods physically go back, at their original cost.
        if (original.kind === 'receives_goods' && original.receiptId) {
          const ret = await this.receipts.returnGoods(
            tx,
            original.receiptId,
            { postingDate, reason: input.reason, lines: plan.map((p) => ({ originalLineId: p.line.receiptLineId!, acceptedQuantity: p.quantity.toString(), rejectedQuantity: '0' })) },
            actor,
            user,
          );
          returnReceiptId = ret.id;
        }
        const created = await tx.supplierBill.create({
          data: {
            companyId: original.companyId,
            number,
            supplierId: original.supplierId,
            kind: 'debit_note' as SupplierBillKind,
            supplierBillNo: input.supplierNoteNo?.trim() || `${original.supplierBillNo}/DN`,
            supplierBillDate: fromIso(postingDate),
            postingDate: fromIso(postingDate),
            postingAt: postingInstant(postingDate),
            financialYearId: year.id,
            storeId: original.storeId,
            dueDate: fromIso(postingDate),
            status: 'unpaid',
            returnOfId: original.id,
            receiptId: returnReceiptId,
            remarks: input.reason,
            taxableAmount: totals.taxableAmount,
            taxAmount: totals.taxAmount,
            roundingAdjustment: totals.roundingAdjustment,
            total: totals.total,
            lines: { create: lineData },
            finalisedAt: new Date(),
            finalisedById: actor.userId,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        for (const p of plan) {
          await tx.supplierBillLine.update({ where: { id: p.line.id }, data: { returnedQuantity: D(p.line.returnedQuantity).add(p.quantity).toString() } });
          // Blueprint 07: a debit note normally reduces the billed share of the receipt, not of the order.
          if (original.kind === 'against_receipt' && p.line.receiptLineId) {
            const rl = await tx.goodsReceiptLine.findUniqueOrThrow({ where: { id: p.line.receiptLineId } });
            await tx.goodsReceiptLine.update({ where: { id: rl.id }, data: { billedQuantity: Decimal.max(0, D(rl.billedQuantity).sub(p.basic)).toString() } });
            await this.receipts.refreshBilling(tx, rl.receiptId);
          }
        }
        await this.audit.record(tx, actor, { action: 'create', entityType: 'supplier_bill', entityId: created.id, changes: { number, kind: 'debit_note', against: original.number, total: totals.total }, reason: input.reason });
        return this.getRow(tx, created.id);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.toDto(note, user);
  }

  private async undoDebitNote(tx: Db, note: BillRow, reason: string, actor: Actor, user: CurrentUser) {
    const original = note.returnOfId ? await this.getRow(tx, note.returnOfId) : null;
    for (const l of note.lines) {
      if (!l.returnOfLineId) continue;
      const orig = await tx.supplierBillLine.findUniqueOrThrow({ where: { id: l.returnOfLineId } });
      await tx.supplierBillLine.update({ where: { id: orig.id }, data: { returnedQuantity: Decimal.max(0, D(orig.returnedQuantity).add(D(l.quantity))).toString() } });
      if (original?.kind === 'against_receipt' && l.receiptLineId) {
        const rl = await tx.goodsReceiptLine.findUniqueOrThrow({ where: { id: l.receiptLineId } });
        await tx.goodsReceiptLine.update({ where: { id: rl.id }, data: { billedQuantity: D(rl.billedQuantity).sub(D(l.basicQuantity)).toString() } });
        await this.receipts.refreshBilling(tx, rl.receiptId);
      }
    }
    if (note.receiptId) await this.receipts.cancelInTx(tx, note.receiptId, reason, actor, user);
  }

  /**
   * A bill that receives goods keeps a draft goods receipt (with batches,
   * expiry dates and serial numbers) from the start; finalising the bill posts it.
   */
  private async linkDraftReceipt(tx: Db, companyId: string, billId: string, receipt: NonNullable<PreparedBill['receipt']>, actor: Actor, existingId?: string | null) {
    if (existingId) await tx.goodsReceipt.delete({ where: { id: existingId } }); // a never-finalised draft owned by this bill
    const draft = await this.receipts.createDraft(tx, companyId, receipt.header, receipt.lines, actor, { billId });
    const billLines = await tx.supplierBillLine.findMany({ where: { billId }, orderBy: { lineNo: 'asc' } });
    for (const [i, rl] of draft.lines.entries()) await tx.supplierBillLine.update({ where: { id: billLines[i].id }, data: { receiptLineId: rl.id } });
    await tx.supplierBill.update({ where: { id: billId }, data: { receiptId: draft.id } });
  }

  /** The stored lines as input again; for receiving bills the draft receipt holds the stock details. */
  private async storedLineInputs(db: Db, b: BillRow): Promise<SupplierBillLineInput[]> {
    if (b.kind !== 'receives_goods' || !b.receiptId) return b.lines.map((l) => billLineInputOf(l));
    const receipt = await this.receipts.getRow(db, b.receiptId);
    return receipt.lines.map((rl) => ({
      orderLineId: rl.orderLineId,
      itemId: rl.itemId,
      unitId: rl.unitId,
      quantity: D(rl.receivedQuantity).sub(D(rl.freeQuantity)).toString(),
      freeQuantity: rl.freeQuantity.toString(),
      rate: rl.rate.toString(),
      discountPercent: rl.discountPercent.toString(),
      discountAmount: rl.discountAmount.toString(),
      gstRate: rl.gstRate.toString(),
      cgst: rl.cgst.toString(),
      sgst: rl.sgst.toString(),
      igst: rl.igst.toString(),
      shelfLocationId: rl.shelfLocationId,
      batchId: rl.batchId,
      batchNumber: rl.newBatchNumber,
      manufactureDate: iso(rl.newManufactureOn),
      expiryDate: iso(rl.newExpiryOn),
      serialNumbers: rl.serialNumbers,
    }));
  }

  // ---- Output ----

  private header(b: SupplierBill & { supplier: { id: string; code: string; name: string } }, user: CurrentUser) {
    const prices = hasPermission(user, 'buying_prices.view');
    const today = businessDate();
    return {
      id: b.id,
      number: b.number,
      kind: b.kind,
      status: b.status,
      supplier: b.supplier,
      supplierBillNo: b.supplierBillNo,
      supplierBillDate: iso(b.supplierBillDate),
      postingDate: iso(b.postingDate),
      storeId: b.storeId,
      paymentTermsId: b.paymentTermsId,
      dueDate: iso(b.dueDate),
      overdue: b.status === 'unpaid' && b.kind !== 'debit_note' && iso(b.dueDate)! < today,
      held: !!b.holdUntil,
      holdReason: b.holdReason,
      holdUntil: iso(b.holdUntil),
      ...(prices
        ? { taxableAmount: b.taxableAmount.toFixed(2), taxAmount: b.taxAmount.toFixed(2), roundingAdjustment: b.roundingAdjustment.toFixed(2), total: b.total.toFixed(2), priceDifference: b.priceDifference.toFixed(2) }
        : {}),
      returnOfId: b.returnOfId,
      receiptId: b.receiptId,
      remarks: b.remarks,
      cancelReason: b.cancelReason,
      createdAt: b.createdAt,
      finalisedAt: b.finalisedAt,
    };
  }

  toDto(b: BillRow, user: CurrentUser) {
    const prices = hasPermission(user, 'buying_prices.view');
    return {
      ...this.header(b, user),
      lines: b.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        item: { id: l.item.id, code: l.item.code, name: l.item.name, isStockItem: l.item.isStockItem },
        unitId: l.unitId,
        factor: l.factor.toString(),
        quantity: l.quantity.toString(),
        freeQuantity: l.freeQuantity.toString(),
        basicQuantity: l.basicQuantity.toString(),
        returnedQuantity: l.returnedQuantity.toString(),
        receiptLineId: l.receiptLineId,
        receipt: l.receiptLine ? { id: l.receiptLine.receipt.id, number: l.receiptLine.receipt.number } : null,
        orderLineId: l.orderLineId,
        order: l.orderLine ? { id: l.orderLine.order.id, number: l.orderLine.order.number } : null,
        accountRole: l.accountRole,
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
              priceDifference: l.priceDifference.toFixed(2),
            }
          : {}),
      })),
    };
  }
}

function billLineData(l: ResolvedBillLine, i: number) {
  return {
    lineNo: i + 1,
    receiptLineId: l.receiptLineId,
    orderLineId: l.orderLineId,
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
    priceDifference: l.priceDifference.toFixed(2),
    accountRole: l.accountRole,
  };
}

function billLineInputOf(l: BillRow['lines'][number]): SupplierBillLineInput {
  return {
    receiptLineId: l.receiptLineId,
    orderLineId: l.orderLineId,
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
  };
}

function summarise(b: BillRow): Record<string, unknown> {
  return {
    supplierId: b.supplierId,
    supplierBillNo: b.supplierBillNo,
    supplierBillDate: iso(b.supplierBillDate),
    postingDate: iso(b.postingDate),
    total: b.total.toString(),
    lines: b.lines.map((l) => `${l.item.code}×${l.quantity.toString()}@${l.rate.toString()}`),
  };
}
