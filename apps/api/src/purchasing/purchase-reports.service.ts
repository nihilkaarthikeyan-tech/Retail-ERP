// Copyright (c) 2026, Rademics. All rights reserved.
// Purchase reports (blueprint 07 "Reports"; plan 05 §1 item 10). Read only.
import { Injectable } from '@nestjs/common';
import { businessDate, type CurrentUser, Decimal, daysUntil, hasPermission, type PurchaseReportQuery } from 'shared';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, fromIso, iso, PurchaseCommon } from './purchase-common.service.js';

@Injectable()
export class PurchaseReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: PurchaseCommon,
  ) {}

  private dateRange(q: PurchaseReportQuery) {
    return q.from || q.to ? { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } : undefined;
  }

  /** Per open order line: ordered, received, billed, pending and days late. */
  async orderFollowUp(q: PurchaseReportQuery, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const stores = this.common.storeFilter(user);
    const prices = hasPermission(user, 'buying_prices.view');
    const today = businessDate();
    const lines = await this.prisma.purchaseOrderLine.findMany({
      where: {
        order: { companyId: company.id, status: { in: ['to_receive_and_bill', 'to_receive', 'to_bill', 'on_hold'] }, ...(q.supplierId ? { supplierId: q.supplierId } : {}), ...(this.dateRange(q) ? { orderDate: this.dateRange(q) } : {}) },
        ...(q.itemId ? { itemId: q.itemId } : {}),
        ...(q.storeId ? { storeId: q.storeId } : {}),
        ...(stores ? { storeId: { in: stores } } : {}),
      },
      include: { order: { include: { supplier: { select: { code: true, name: true } } } }, item: { select: { code: true, name: true } } },
      orderBy: [{ neededBy: 'asc' }],
    });
    return lines.map((l) => {
      const pending = Decimal.max(0, D(l.basicQuantity).sub(D(l.receivedQuantity)));
      const neededBy = iso(l.neededBy)!;
      return {
        orderId: l.orderId,
        orderNumber: l.order.number,
        status: l.order.status,
        supplier: l.order.supplier,
        item: l.item,
        storeId: l.storeId,
        orderDate: iso(l.order.orderDate),
        neededBy,
        ordered: l.basicQuantity.toString(),
        received: l.receivedQuantity.toString(),
        pending: pending.toString(),
        daysLate: pending.gt(0) && neededBy < today ? daysUntil(neededBy, today) : 0,
        ...(prices ? { orderedAmount: l.taxableAmount.toFixed(2), billedAmount: l.billedAmount.toFixed(2) } : {}),
      };
    });
  }

  /** Receipt lines not (fully) billed, by supplier, with their age. */
  async receivedNotBilled(q: PurchaseReportQuery, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const stores = this.common.storeFilter(user);
    const prices = hasPermission(user, 'buying_prices.view');
    const today = businessDate();
    const lines = await this.prisma.goodsReceiptLine.findMany({
      where: {
        receipt: {
          companyId: company.id,
          isReturn: false,
          status: { in: ['to_bill', 'partly_billed'] },
          ...(q.supplierId ? { supplierId: q.supplierId } : {}),
          ...(q.storeId ? { storeId: q.storeId } : {}),
          ...(stores ? { storeId: { in: stores } } : {}),
          ...(this.dateRange(q) ? { postingDate: this.dateRange(q) } : {}),
        },
        ...(q.itemId ? { itemId: q.itemId } : {}),
      },
      include: { receipt: { include: { supplier: { select: { code: true, name: true } } } }, item: { select: { code: true, name: true } } },
      orderBy: [{ receipt: { postingDate: 'asc' } }],
    });
    return lines
      .map((l) => {
        const received = D(l.basicAcceptedQuantity).add(D(l.basicRejectedQuantity)).sub(D(l.returnedAcceptedQuantity)).sub(D(l.returnedRejectedQuantity));
        const notBilled = Decimal.max(0, received.sub(D(l.billedQuantity)));
        const value = received.gt(0) ? D(l.taxableAmount).mul(notBilled).div(D(l.basicAcceptedQuantity).add(D(l.basicRejectedQuantity))) : new Decimal(0);
        return {
          receiptId: l.receiptId,
          receiptNumber: l.receipt.number,
          supplier: l.receipt.supplier,
          item: l.item,
          postingDate: iso(l.receipt.postingDate),
          ageDays: daysUntil(iso(l.receipt.postingDate)!, today),
          notBilled: notBilled.toString(),
          ...(prices ? { value: value.toFixed(2) } : {}),
        };
      })
      .filter((r) => D(r.notBilled).gt(0));
  }

  /** Every finalised bill line (debit notes as minus lines) with supplier, price, quantity and GST. */
  async register(q: PurchaseReportQuery, user: CurrentUser) {
    const company = await this.common.currentCompany();
    this.common.requireRight(user, 'buying_prices.view');
    // Audit 1 (28 October 2026): a person working in some stores sees only their stores' bills (and those without a store).
    const stores = this.common.storeFilter(user);
    const where: Prisma.SupplierBillLineWhereInput = {
      bill: {
        companyId: company.id,
        status: 'unpaid',
        ...(stores ? { OR: [{ storeId: null }, { storeId: { in: stores } }] } : {}),
        ...(q.supplierId ? { supplierId: q.supplierId } : {}),
        ...(this.dateRange(q) ? { postingDate: this.dateRange(q) } : {}),
      },
      ...(q.itemId ? { itemId: q.itemId } : {}),
    };
    const lines = await this.prisma.supplierBillLine.findMany({
      where,
      include: { bill: { include: { supplier: { select: { code: true, name: true, gstin: true } } } }, item: { select: { code: true, name: true, hsnCode: true } } },
      orderBy: [{ bill: { postingDate: 'asc' } }, { lineNo: 'asc' }],
    });
    return lines.map((l) => ({
      billId: l.billId,
      number: l.bill.number,
      kind: l.bill.kind,
      supplier: l.bill.supplier,
      supplierBillNo: l.bill.supplierBillNo,
      supplierBillDate: iso(l.bill.supplierBillDate),
      postingDate: iso(l.bill.postingDate),
      item: l.item,
      quantity: l.quantity.toString(),
      rate: l.rate.toFixed(2),
      taxableAmount: l.taxableAmount.toFixed(2),
      gstRate: l.gstRate.toString(),
      cgst: l.cgst.toFixed(2),
      sgst: l.sgst.toFixed(2),
      igst: l.igst.toFixed(2),
      lineTotal: l.lineTotal.toFixed(2),
    }));
  }

  /** Bills grouped by supplier for the period. */
  async bySupplier(q: PurchaseReportQuery, user: CurrentUser) {
    const rows = await this.register(q, user);
    const groups = new Map<string, { supplier: { code: string; name: string }; bills: Set<string>; taxable: Decimal; tax: Decimal; total: Decimal }>();
    for (const r of rows) {
      const g = groups.get(r.supplier.code) ?? { supplier: { code: r.supplier.code, name: r.supplier.name }, bills: new Set<string>(), taxable: new Decimal(0), tax: new Decimal(0), total: new Decimal(0) };
      g.bills.add(r.billId);
      g.taxable = g.taxable.add(D(r.taxableAmount));
      g.tax = g.tax.add(D(r.cgst)).add(D(r.sgst)).add(D(r.igst));
      g.total = g.total.add(D(r.lineTotal));
      groups.set(r.supplier.code, g);
    }
    return [...groups.values()]
      .map((g) => ({ supplier: g.supplier, bills: g.bills.size, taxableAmount: g.taxable.toFixed(2), taxAmount: g.tax.toFixed(2), total: g.total.toFixed(2) }))
      .sort((a, b) => D(b.taxableAmount).cmp(D(a.taxableAmount)));
  }

  /** Bills grouped by item for the period. */
  async byItem(q: PurchaseReportQuery, user: CurrentUser) {
    const rows = await this.register(q, user);
    const groups = new Map<string, { item: { code: string; name: string }; quantity: Decimal; taxable: Decimal }>();
    for (const r of rows) {
      const g = groups.get(r.item.code) ?? { item: { code: r.item.code, name: r.item.name }, quantity: new Decimal(0), taxable: new Decimal(0) };
      g.quantity = g.quantity.add(D(r.quantity));
      g.taxable = g.taxable.add(D(r.taxableAmount));
      groups.set(r.item.code, g);
    }
    return [...groups.values()]
      .map((g) => ({ item: g.item, quantity: g.quantity.toString(), taxableAmount: g.taxable.toFixed(2), averageRate: g.quantity.gt(0) ? g.taxable.div(g.quantity).toFixed(2) : '0.00' }))
      .sort((a, b) => D(b.taxableAmount).cmp(D(a.taxableAmount)));
  }
}
