// Copyright (c) 2026, Rademics. All rights reserved.
// Supplier sale-or-return (plan 11 part 2 §3; scenario 11.23). Sale-or-return
// goods are our stock, held against a separate "owed to suppliers on
// consignment" balance. A statement for a supplier, store and period lists what
// was received, sold, returned and is still held; making its bill moves the sold
// amount to the supplier's normal balance in the same transaction (rule 5).
//
// Which sales are the supplier's: see packages/shared/src/consignment.ts (the
// shop's sale-or-return goods of an item are sold first, oldest receipt first).
// A statement bills every sold unit not billed by an earlier statement, so
// later statements never count the same units twice.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  businessDate,
  consignmentAmount,
  type ConsignmentBillInput,
  type ConsignmentStatementQuery,
  type ConsignmentStockQuery,
  type CreateConsignmentStatementInput,
  type CurrentUser,
  Decimal,
  hasPermission,
  unsettledSold,
} from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import { assertStoreAccess } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConsignmentStock, type ConsignmentLayerRow } from './consignment-stock.service.js';
import { D, fromIso, iso, PurchaseCommon } from './purchase-common.service.js';
import { SupplierBillsService } from './supplier-bills.service.js';

const ZERO = new Decimal(0);
const statementInclude = {
  lines: true,
} satisfies Prisma.ConsignmentStatementInclude;
type StatementRow = Prisma.ConsignmentStatementGetPayload<{ include: typeof statementInclude }>;

/** One statement line (an item at one agreed rate) and the receipt lines whose sold units it bills. */
interface ComputedLine {
  itemId: string;
  received: Decimal;
  sold: Decimal;
  returned: Decimal;
  held: Decimal;
  rate: Decimal;
  amount: Decimal;
  toBill: { receiptLineId: string; quantity: Decimal; rate: Decimal }[];
}

@Injectable()
export class ConsignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: PurchaseCommon,
    private readonly stock: ConsignmentStock,
    private readonly bills: SupplierBillsService,
  ) {}

  // ---- Statements ----

  async list(q: ConsignmentStatementQuery, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const stores = this.common.storeFilter(user);
    const rows = await this.prisma.consignmentStatement.findMany({
      where: {
        companyId: company.id,
        ...(q.supplierId ? { supplierId: q.supplierId } : {}),
        ...(q.storeId ? { storeId: q.storeId } : {}),
        ...(stores ? { storeId: { in: stores } } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      include: statementInclude,
      orderBy: [{ toDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return this.decorate(rows, user);
  }

  async get(id: string, user: CurrentUser) {
    const s = await this.getRow(this.prisma, id);
    assertStoreAccess(user, s.storeId);
    return (await this.decorate([s], user))[0];
  }

  private async getRow(db: Db, id: string): Promise<StatementRow> {
    const s = await db.consignmentStatement.findUnique({ where: { id }, include: statementInclude });
    if (!s) throw new NotFoundException('Consignment statement not found');
    return s;
  }

  async create(input: CreateConsignmentStatementInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.bill');
    const company = await this.common.currentCompany();
    const supplier = await this.prisma.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw new BadRequestException('Supplier not found');
    await this.common.store(this.prisma, company.id, input.storeId);
    assertStoreAccess(user, input.storeId);
    if (input.toDate > businessDate()) throw new BadRequestException('A statement cannot end in the future');

    const created = await this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, input.supplierId, input.storeId);
        const fromDate = await this.periodStart(tx, input.supplierId, input.storeId, input.fromDate, input.toDate);
        const lines = await this.compute(tx, input.supplierId, input.storeId, fromDate, input.toDate);
        if (!lines.length) throw new BadRequestException(`Nothing was received on sale or return from ${supplier.name} at this store up to ${input.toDate}`);
        const number = await this.common.allocate(tx, { companyId: company.id, documentKind: 'consignment_statement', storeId: input.storeId, date: input.toDate });
        const s = await tx.consignmentStatement.create({
          data: {
            companyId: company.id,
            supplierId: input.supplierId,
            storeId: input.storeId,
            number,
            fromDate: fromIso(fromDate),
            toDate: fromIso(input.toDate),
            remarks: input.remarks ?? null,
            lines: { create: lines.map(lineData) },
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        const total = lines.reduce((t, l) => t.add(l.amount), ZERO);
        await this.audit.record(tx, actor, { action: 'create', entityType: 'consignment_statement', entityId: s.id, changes: { number, supplier: supplier.name, fromDate, toDate: input.toDate, amount: total.toFixed(2) } });
        return this.getRow(tx, s.id);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return (await this.decorate([created], user))[0];
  }

  /** Make bill: the sold units become the supplier's bill; the statement is billed. */
  async makeBill(id: string, input: ConsignmentBillInput, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.bill');
    const s = await this.getRow(this.prisma, id);
    assertStoreAccess(user, s.storeId);
    if (s.status !== 'draft') throw new BadRequestException(`The statement is already ${s.status}`);
    const postingDate = input.postingDate ?? businessDate();
    const billDate = input.supplierBillDate ?? postingDate;
    if (postingDate < iso(s.toDate)!) throw new BadRequestException('The bill cannot be dated before the end of the statement period');

    const after = await this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, s.supplierId, s.storeId);
        const fresh = await this.getRow(tx, id);
        if (fresh.status !== 'draft') throw new BadRequestException(`The statement is already ${fresh.status}`);
        const fromDate = iso(fresh.fromDate)!;
        const toDate = iso(fresh.toDate)!;
        const overlap = await tx.consignmentStatement.findFirst({ where: { supplierId: s.supplierId, storeId: s.storeId, status: 'billed', toDate: { gte: fresh.fromDate } }, orderBy: { toDate: 'desc' } });
        if (overlap) throw new BadRequestException(`Statement ${overlap.number} already settled sales up to ${iso(overlap.toDate)}; cancel this one and make a new statement from ${addDays(iso(overlap.toDate)!, 1)}`);
        // Sales may have arrived since the draft (tills working offline): work it out again.
        const lines = await this.compute(tx, s.supplierId, s.storeId, fromDate, toDate);
        const toBill = lines.flatMap((l) => l.toBill);
        if (!toBill.length) throw new BadRequestException('Nothing was sold in this period, so there is nothing to bill');
        await tx.consignmentStatementLine.deleteMany({ where: { statementId: id } });
        await tx.consignmentStatementLine.createMany({ data: lines.map((l) => ({ statementId: id, ...lineData(l) })) });
        const bill = await this.bills.createConsignmentBill(
          tx,
          {
            companyId: s.companyId,
            supplierId: s.supplierId,
            storeId: s.storeId,
            supplierBillNo: input.supplierBillNo?.trim() || s.number,
            supplierBillDate: billDate,
            postingDate,
            remarks: `Sale-or-return statement ${s.number} (${fromDate} to ${toDate})`,
            lines: toBill,
          },
          actor,
          user,
        );
        await tx.consignmentStatement.update({ where: { id }, data: { status: 'billed', supplierBillId: bill.id, updatedById: actor.userId } });
        await this.audit.record(tx, actor, { action: 'update', entityType: 'consignment_statement', entityId: id, changes: { status: { old: 'draft', new: 'billed' }, number: s.number, bill: bill.number, amount: bill.taxableAmount.toFixed(2) } });
        return this.getRow(tx, id);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return (await this.decorate([after], user))[0];
  }

  /** A draft is simply cancelled; a billed statement goes with its bill (normal bill rules: unlink payments first). */
  async cancel(id: string, reason: string, actor: Actor, user: CurrentUser) {
    this.common.requireRight(user, 'purchase.bill');
    const s = await this.getRow(this.prisma, id);
    assertStoreAccess(user, s.storeId);
    if (s.status === 'cancelled') throw new BadRequestException('Already cancelled');
    if (s.status === 'billed' && s.supplierBillId) {
      await this.bills.cancel(s.supplierBillId, reason, actor, user);
    } else {
      await this.prisma.$transaction(async (tx) => {
        await tx.consignmentStatement.update({ where: { id }, data: { status: 'cancelled', updatedById: actor.userId } });
        await this.audit.record(tx, actor, { action: 'update', entityType: 'consignment_statement', entityId: id, changes: { status: { old: s.status, new: 'cancelled' }, number: s.number }, reason });
      });
    }
    return this.get(id, user);
  }

  /** One statement change at a time per supplier and store (rule 7). */
  private async lock(tx: Db, supplierId: string, storeId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`consignment|${supplierId}|${storeId}`}))`;
  }

  /** Later statements start after the last billed one. */
  private async periodStart(db: Db, supplierId: string, storeId: string, given: string | undefined, toDate: string): Promise<string> {
    const last = await db.consignmentStatement.findFirst({ where: { supplierId, storeId, status: 'billed' }, orderBy: { toDate: 'desc' } });
    const after = last ? addDays(iso(last.toDate)!, 1) : null;
    if (given && after && given < after) {
      throw new BadRequestException(`Statement ${last!.number} already settled sales up to ${iso(last!.toDate)}; start the next statement from ${after}`);
    }
    if (!given && after && after > toDate) throw new BadRequestException(`Statement ${last!.number} already settled sales up to ${iso(last!.toDate)}`);
    if (given) return given;
    if (after) return after;
    const first = await db.goodsReceipt.findFirst({ where: { supplierId, storeId, isConsignment: true, isReturn: false, status: { notIn: ['draft', 'cancelled'] } }, orderBy: { postingDate: 'asc' } });
    const start = first ? iso(first.postingDate)! : toDate;
    return start < toDate ? start : toDate;
  }

  /** The statement lines for a supplier, store and period, from the receipts, returns and till sales. */
  private async compute(db: Db, supplierId: string, storeId: string, fromDate: string, toDate: string): Promise<ComputedLine[]> {
    const itemIds = (
      await db.goodsReceiptLine.findMany({
        where: { receipt: { supplierId, storeId, isConsignment: true, isReturn: false, status: { notIn: ['draft', 'cancelled'] }, postingDate: { lte: fromIso(toDate) } } },
        select: { itemId: true },
        distinct: ['itemId'],
      })
    ).map((r) => r.itemId);
    const picture = await this.stock.picture(db, storeId, itemIds, toDate);
    const inPeriod = (d: string) => d >= fromDate && d <= toDate;
    const groups = new Map<string, ConsignmentLayerRow[]>();
    for (const l of picture.layers.filter((x) => x.supplierId === supplierId)) {
      const k = `${l.itemId}|${l.rate.toFixed(4)}`;
      groups.set(k, [...(groups.get(k) ?? []), l]);
    }
    const out: ComputedLine[] = [];
    for (const layers of groups.values()) {
      const ids = new Set(layers.map((l) => l.lineId));
      const received = picture.receipts.filter((r) => ids.has(r.lineId) && inPeriod(r.postingDate)).reduce((s, r) => s.add(r.quantity), ZERO);
      const returned = picture.returns.filter((r) => ids.has(r.originalLineId) && inPeriod(r.postingDate)).reduce((s, r) => s.add(r.quantity), ZERO);
      const toBill = layers.map((l) => ({ receiptLineId: l.lineId, quantity: unsettledSold(l.sold, l.billed), rate: l.rate })).filter((x) => x.quantity.gt(0));
      const sold = toBill.reduce((s, x) => s.add(x.quantity), ZERO);
      const held = layers.reduce((s, l) => s.add(l.held), ZERO);
      if (received.isZero() && returned.isZero() && sold.isZero() && held.isZero()) continue;
      const amount = toBill.reduce((s, x) => s.add(consignmentAmount(x.quantity, x.rate)), ZERO);
      out.push({ itemId: layers[0].itemId, received, sold, returned, held, rate: layers[0].rate, amount, toBill });
    }
    return out;
  }

  // ---- Lists and the balance check ----

  /**
   * Sale-or-return stock by supplier and store: units held and their value,
   * sold but not yet settled by a statement, and what is owed on consignment
   * (held plus sold-not-settled, at the agreed rates).
   */
  async stockBySupplier(q: ConsignmentStockQuery, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const stores = this.common.storeFilter(user);
    if (q.storeId) assertStoreAccess(user, q.storeId);
    const layers = await this.allLayers(company.id, { supplierId: q.supplierId, storeId: q.storeId, stores });
    const [suppliers, storeRows, items] = await Promise.all([
      this.prisma.supplier.findMany({ where: { id: { in: [...new Set(layers.map((l) => l.supplierId))] } }, select: { id: true, code: true, name: true } }),
      this.prisma.store.findMany({ where: { id: { in: [...new Set(layers.map((l) => l.storeId))] } }, select: { id: true, code: true, name: true } }),
      this.prisma.item.findMany({ where: { id: { in: [...new Set(layers.map((l) => l.itemId))] } }, select: { id: true, code: true, name: true } }),
    ]);
    const prices = hasPermission(user, 'buying_prices.view');
    type Totals = { heldQuantity: Decimal; heldValue: Decimal; soldNotSettledQuantity: Decimal; soldNotSettledAmount: Decimal; owed: Decimal };
    const zero = (): Totals => ({ heldQuantity: ZERO, heldValue: ZERO, soldNotSettledQuantity: ZERO, soldNotSettledAmount: ZERO, owed: ZERO });
    const add = (t: Totals, l: (typeof layers)[number]) => {
      const unsettled = unsettledSold(l.sold, l.billed);
      t.heldQuantity = t.heldQuantity.add(l.held);
      t.heldValue = t.heldValue.add(consignmentAmount(l.held, l.rate));
      t.soldNotSettledQuantity = t.soldNotSettledQuantity.add(unsettled);
      t.soldNotSettledAmount = t.soldNotSettledAmount.add(consignmentAmount(unsettled, l.rate));
      t.owed = t.owed.add(owedOn(l));
    };
    const show = (t: Totals) => ({
      heldQuantity: t.heldQuantity.toString(),
      soldNotSettledQuantity: t.soldNotSettledQuantity.toString(),
      ...(prices ? { heldValue: t.heldValue.toFixed(2), soldNotSettledAmount: t.soldNotSettledAmount.toFixed(2), owed: t.owed.toFixed(2) } : {}),
    });
    const bySupplier = new Map<string, { totals: Totals; items: Map<string, Totals> }>();
    const all = zero();
    for (const l of layers) {
      const k = `${l.supplierId}|${l.storeId}`;
      const g = bySupplier.get(k) ?? { totals: zero(), items: new Map<string, Totals>() };
      bySupplier.set(k, g);
      add(g.totals, l);
      const it = g.items.get(l.itemId) ?? zero();
      g.items.set(l.itemId, it);
      add(it, l);
      add(all, l);
    }
    const rows = [...bySupplier.entries()]
      .map(([k, g]) => {
        const [supplierId, storeId] = k.split('|');
        return {
          supplier: suppliers.find((s) => s.id === supplierId)!,
          store: storeRows.find((s) => s.id === storeId)!,
          ...show(g.totals),
          items: [...g.items.entries()].map(([itemId, t]) => ({ item: items.find((i) => i.id === itemId)!, ...show(t) })).sort((a, b) => a.item.code.localeCompare(b.item.code)),
        };
      })
      .sort((a, b) => a.supplier.name.localeCompare(b.supplier.name) || a.store.code.localeCompare(b.store.code));
    return { rows, totals: show(all), ...(prices && !q.supplierId && !q.storeId && !stores ? { check: await this.balanceCheck() } : {}) };
  }

  /**
   * The consignment balance worked out from the goods (received − returned −
   * billed, at the agreed rates) must equal the "Owed to suppliers on
   * consignment" account.
   */
  async balanceCheck() {
    const company = await this.common.currentCompany();
    const layers = await this.allLayers(company.id, {});
    const fromGoods = layers.reduce((s, l) => s.add(owedOn(l)), ZERO);
    const account = await this.prisma.accountDefault.findUnique({ where: { companyId_role: { companyId: company.id, role: 'consignment_payable' } } });
    let ledger = ZERO;
    if (account) {
      const sum = await this.prisma.ledgerLine.aggregate({ where: { accountId: account.accountId }, _sum: { debit: true, credit: true } });
      ledger = D(sum._sum.credit ?? 0).sub(D(sum._sum.debit ?? 0));
    }
    const difference = ledger.sub(fromGoods);
    return { fromGoods: fromGoods.toFixed(2), ledger: ledger.toFixed(2), difference: difference.toFixed(2), ok: difference.isZero() };
  }

  /** Every sale-or-return layer of the company (optionally one supplier or store), store by store. */
  private async allLayers(companyId: string, f: { supplierId?: string; storeId?: string; stores?: string[] }) {
    const lines = await this.prisma.goodsReceiptLine.findMany({
      where: {
        receipt: {
          companyId,
          isConsignment: true,
          isReturn: false,
          status: { notIn: ['draft', 'cancelled'] },
          ...(f.storeId ? { storeId: f.storeId } : f.stores ? { storeId: { in: f.stores } } : {}),
        },
      },
      select: { itemId: true, receipt: { select: { storeId: true } } },
    });
    const byStore = new Map<string, Set<string>>();
    for (const l of lines) byStore.set(l.receipt.storeId, (byStore.get(l.receipt.storeId) ?? new Set()).add(l.itemId));
    const out: (ConsignmentLayerRow & { storeId: string })[] = [];
    for (const [storeId, itemIds] of byStore) {
      // Every supplier's layers count in the allocation; only the asked supplier's are listed.
      const p = await this.stock.picture(this.prisma, storeId, [...itemIds]);
      for (const l of p.layers) if (!f.supplierId || l.supplierId === f.supplierId) out.push({ ...l, storeId });
    }
    return out;
  }

  // ---- Output ----

  private async decorate(rows: StatementRow[], user: CurrentUser) {
    const prices = hasPermission(user, 'buying_prices.view');
    const [suppliers, stores, items, bills] = await Promise.all([
      this.prisma.supplier.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.supplierId))] } }, select: { id: true, code: true, name: true } }),
      this.prisma.store.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.storeId))] } }, select: { id: true, code: true, name: true } }),
      this.prisma.item.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.lines.map((l) => l.itemId)))] } }, select: { id: true, code: true, name: true } }),
      this.prisma.supplierBill.findMany({ where: { id: { in: rows.map((r) => r.supplierBillId).filter((x): x is string => !!x) } }, select: { id: true, number: true, status: true, total: true } }),
    ]);
    return rows.map((s) => {
      const bill = bills.find((b) => b.id === s.supplierBillId);
      const amount = s.lines.reduce((t, l) => t.add(D(l.amount)), ZERO);
      return {
        id: s.id,
        number: s.number,
        status: s.status,
        supplier: suppliers.find((x) => x.id === s.supplierId)!,
        store: stores.find((x) => x.id === s.storeId)!,
        fromDate: iso(s.fromDate),
        toDate: iso(s.toDate),
        remarks: s.remarks,
        bill: bill ? { id: bill.id, number: bill.number, status: bill.status, ...(prices ? { total: bill.total.toFixed(2) } : {}) } : null,
        ...(prices ? { amount: amount.toFixed(2) } : {}),
        createdAt: s.createdAt,
        lines: s.lines
          .map((l) => ({
            item: items.find((i) => i.id === l.itemId)!,
            received: l.received.toString(),
            sold: l.sold.toString(),
            returned: l.returned.toString(),
            held: l.held.toString(),
            ...(prices ? { rate: l.rate.toFixed(2), amount: l.amount.toFixed(2) } : {}),
          }))
          .sort((a, b) => a.item.code.localeCompare(b.item.code)),
      };
    });
  }
}

/** Owed on consignment for one layer: units not returned and not yet billed, at the agreed rate. */
function owedOn(l: ConsignmentLayerRow): Decimal {
  return consignmentAmount(Decimal.max(0, l.received.sub(l.returned).sub(l.billed)), l.rate);
}

function lineData(l: ComputedLine) {
  return {
    itemId: l.itemId,
    received: l.received.toString(),
    sold: l.sold.toString(),
    returned: l.returned.toString(),
    held: l.held.toString(),
    rate: l.rate.toFixed(4),
    amount: l.amount.toFixed(2),
  };
}
