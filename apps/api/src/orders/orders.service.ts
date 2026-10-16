// Copyright (c) 2026, Rademics. All rights reserved.
// Customer orders with an advance (plan 11 part 2 §1; blueprint 10; decision 49).
// An order does not move stock. Its advance is a customer receipt (a Payment
// with orderId) posted at once through LedgerService, so the customer's balance
// shows a credit (blueprint 12). At the till, cash taken as an advance also goes
// into the drawer as a "cash in" of the shift, so the expected cash at closing
// stays right; the receipt itself is posted to the store's cash in hand, and the
// shift's drawer entry moves that cash in to the till, as for the starting float.
// Marking an order ready sets its goods aside at the store's selling location.
// It is collected on a till bill (PosBillsService) that uses the advance;
// cancelling refunds the advance (manager PIN, refund-allowed methods) or keeps
// it as the customer's credit.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type CancelOrderInput,
  type CurrentUser,
  type CustomerOrderInput,
  type CustomerOrderQuery,
  Decimal,
  hasPermission,
  type OfficeAdvanceInput,
  type TillAdvanceInput,
  type TillCancelOrderInput,
} from 'shared';
import { ACCOUNTING_NUMBER_SERIES } from '../accounting/accounting-common.service.js';
import { AuditService, type Db } from '../audit/audit.service.js';
import { allowedStoreIds, assertStoreAccess } from '../auth/store-access.js';
import type { Actor } from '../common/request-context.js';
import type { Payment, Prisma } from '../generated/prisma/client.js';
import { ItemsService } from '../items/items.service.js';
import { AccountingSetup } from '../ledger/accounting-setup.service.js';
import { type LedgerLineInput, LedgerService } from '../ledger/ledger.service.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { D, fromIso, iso, type PendingApproval, PosCommon, type TillWithRefs } from '../pos/pos-common.service.js';
import { PosCredit } from '../pos/pos-credit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Company-wide number series of plan 11 part 2 (store-wise series may be added on the numbering screen). */
export const ORDER_NUMBER_SERIES: Record<string, string> = {
  customer_order: 'CO-{FY}-',
  alteration: 'ALT-{FY}-',
};

const orderInclude = { lines: { orderBy: { lineNo: 'asc' } } } satisfies Prisma.CustomerOrderInclude;
type OrderRow = Prisma.CustomerOrderGetPayload<{ include: typeof orderInclude }>;

/** The ledger account role a till payment method's money goes to; cash is received into the store's cash in hand (see above). */
function roleForMethod(m: { kind: string; accountRole: string }): string {
  return m.kind === 'cash' ? 'cash_in_hand' : m.accountRole;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: PosCommon,
    private readonly credit: PosCredit,
    private readonly ledger: LedgerService,
    private readonly numbering: NumberingService,
    private readonly items: ItemsService,
    private readonly setup: AccountingSetup,
  ) {}

  /** The company with the number series this module uses (race-safe: existing rows are skipped). */
  async ready(db: Db = this.prisma) {
    const company = await this.common.currentCompany(db);
    // The chart of accounts and its default accounts (as the accounting module makes sure of).
    await this.setup.ensure(db, company.id);
    const series = { ...ACCOUNTING_NUMBER_SERIES, ...ORDER_NUMBER_SERIES };
    await db.numberSeries.createMany({ data: Object.entries(series).map(([documentKind, pattern]) => ({ companyId: company.id, documentKind, pattern, counterLength: 5 })), skipDuplicates: true });
    return company;
  }

  // ---- Reading ----

  async list(q: CustomerOrderQuery, user: CurrentUser) {
    const company = await this.ready();
    if (q.storeId) assertStoreAccess(user, q.storeId);
    const own = allowedStoreIds(user);
    const today = fromIso(businessDate());
    const view = q.view;
    const where: Prisma.CustomerOrderWhereInput = {
      companyId: company.id,
      ...(q.storeId ? { storeId: q.storeId } : own ? { storeId: { in: own } } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(view === 'open' || view === 'ready' || view === 'collected' || view === 'cancelled' ? { status: view } : {}),
      ...(view === 'overdue' ? { status: { in: ['open', 'ready'] }, expectedOn: { lt: today } } : {}),
      ...(view === 'advances' ? { status: { in: ['open', 'ready'] }, id: { in: await this.ordersWithReceipts(company.id) } } : {}),
      ...(q.search
        ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { customerId: { in: await this.customersMatching(company.id, q.search) } }] }
        : {}),
    };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const byDate = view === 'open' || view === 'ready' || view === 'overdue' || view === 'advances';
    let rows = await this.prisma.customerOrder.findMany({
      where,
      include: orderInclude,
      orderBy: byDate ? [{ expectedOn: { sort: 'asc', nulls: 'last' } }, { number: 'asc' }] : [{ createdAt: 'desc' }],
      ...(view === 'advances' ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
    });
    let total = view === 'advances' ? 0 : await this.prisma.customerOrder.count({ where });
    const money = await this.advanceFigures(rows.map((r) => r.id));
    if (view === 'advances') {
      rows = rows.filter((r) => money.get(r.id)!.held.gt(0));
      total = rows.length;
      rows = rows.slice((page - 1) * pageSize, page * pageSize);
    }
    const names = await this.names(rows);
    return {
      rows: rows.map((o) => this.summaryDto(o, names, money.get(o.id)!)),
      total,
      page,
      pageSize,
      // Plan 11 part 2 "advances held": the total of the list's view.
      ...(view === 'advances' ? { advancesHeld: [...money.values()].reduce((s, m) => s.add(m.held), new Decimal(0)).toFixed(2) } : {}),
    };
  }

  async get(id: string, user: CurrentUser) {
    const o = await this.row(this.prisma, id);
    assertStoreAccess(user, o.storeId);
    return this.dto(o);
  }

  /** The customer's credit free to use on a bill (advances kept from cancelled orders, unused receipts). */
  async customerCredit(customerId: string) {
    const company = await this.ready();
    const c = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!c || c.companyId !== company.id) throw new NotFoundException('Customer not found');
    const free = await this.credit.freeCredit(this.prisma, customerId);
    return { customerId, available: PosCredit.total(free).toFixed(2), receipts: free.map((r) => ({ paymentId: r.paymentId, number: r.number, unused: r.unused.toFixed(2) })) };
  }

  // ---- Taking and changing an order ----

  async create(input: CustomerOrderInput, actor: Actor, user: CurrentUser) {
    const company = await this.ready();
    assertStoreAccess(user, input.storeId);
    const lines = await this.checkInput(company.id, input);
    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.numbering.allocate(tx, { companyId: company.id, documentKind: 'customer_order', date: businessDate() });
      const o = await tx.customerOrder.create({
        data: {
          companyId: company.id,
          storeId: input.storeId,
          number,
          customerId: input.customerId,
          expectedOn: input.expectedOn ? fromIso(input.expectedOn) : null,
          remarks: input.remarks ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
          lines: { create: lines },
        },
        include: orderInclude,
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'customer_order', entityId: o.id, changes: { number, customerId: o.customerId, lines: lines.length, total: this.total(o).toFixed(2) } });
      return o;
    });
    return this.dto(created);
  }

  /** Only an open order changes (once ready, its goods are set aside as ordered). */
  async update(id: string, input: CustomerOrderInput, actor: Actor, user: CurrentUser) {
    const company = await this.ready();
    const before = await this.row(this.prisma, id);
    assertStoreAccess(user, before.storeId);
    if (before.status !== 'open') throw new BadRequestException(`Order ${before.number} is ${before.status}; only an open order can be changed`);
    if (input.storeId !== before.storeId) throw new BadRequestException('An order stays with its store');
    if (input.customerId !== before.customerId && (await this.receipts(this.prisma, id)).length) throw new BadRequestException('An advance was taken from this customer; the order stays with them');
    const lines = await this.checkInput(company.id, input);
    const after = await this.prisma.$transaction(async (tx) => {
      const done = await tx.customerOrder.updateMany({ where: { id, status: 'open' }, data: { customerId: input.customerId, expectedOn: input.expectedOn ? fromIso(input.expectedOn) : null, remarks: input.remarks ?? null, updatedById: actor.userId } });
      if (done.count !== 1) throw new BadRequestException(`Order ${before.number} changed a moment ago; open it again`);
      await tx.customerOrderLine.deleteMany({ where: { orderId: id } });
      await tx.customerOrderLine.createMany({ data: lines.map((l) => ({ ...l, orderId: id })) });
      const o = await this.row(tx, id);
      await this.audit.record(tx, actor, { action: 'update', entityType: 'customer_order', entityId: id, changes: { number: o.number, total: { old: this.total(before).toFixed(2), new: this.total(o).toFixed(2) }, expectedOn: iso(o.expectedOn) } });
      return o;
    });
    return this.dto(after);
  }

  /** The goods arrived: one unit per ordered unit is set aside at the store's selling location. */
  async markReady(id: string, actor: Actor, user: CurrentUser) {
    const o = await this.row(this.prisma, id);
    assertStoreAccess(user, o.storeId);
    if (o.status !== 'open') throw new BadRequestException(`Order ${o.number} is ${o.status}`);
    const locationId = await this.sellingLocation(o.storeId);
    const after = await this.prisma.$transaction(async (tx) => {
      const done = await tx.customerOrder.updateMany({ where: { id, status: 'open' }, data: { status: 'ready', readyAt: new Date(), updatedById: actor.userId } });
      if (done.count !== 1) throw new BadRequestException(`Order ${o.number} changed a moment ago; open it again`);
      await this.credit.reserve(tx, { companyId: o.companyId, orderId: id, locationId, actorId: actor.userId });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'customer_order', entityId: id, changes: { status: { old: 'open', new: 'ready' }, number: o.number } });
      return this.row(tx, id);
    });
    return this.dto(after);
  }

  /** Cancelling in the back office: the goods are no longer set aside; any advance stays as the customer's credit. */
  async cancel(id: string, input: CancelOrderInput, actor: Actor, user: CurrentUser) {
    const o = await this.row(this.prisma, id);
    assertStoreAccess(user, o.storeId);
    return this.dto(await this.cancelKeepingCredit(o, input.reason, actor));
  }

  private async cancelKeepingCredit(o: OrderRow, reason: string, actor: Actor) {
    if (o.status !== 'open' && o.status !== 'ready') throw new BadRequestException(`Order ${o.number} is already ${o.status}`);
    const held = PosCredit.total(await this.credit.orderAdvances(this.prisma, o.customerId, o.id));
    return this.prisma.$transaction(async (tx) => {
      const done = await tx.customerOrder.updateMany({
        where: { id: o.id, status: { in: ['open', 'ready'] } },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, advanceOutcome: held.gt(0) ? 'keep_credit' : null, updatedById: actor.userId },
      });
      if (done.count !== 1) throw new BadRequestException(`Order ${o.number} changed a moment ago; open it again`);
      await this.credit.release(tx, o.id);
      await this.audit.record(tx, actor, { action: 'update', entityType: 'customer_order', entityId: o.id, changes: { status: { old: o.status, new: 'cancelled' }, number: o.number, ...(held.gt(0) ? { creditKept: held.toFixed(2) } : {}) }, reason });
      return this.row(tx, o.id);
    });
  }

  // ---- Advances ----

  /** An advance at the till: by one of the till's methods; cash also goes into the shift's drawer. */
  async tillAdvance(orderId: string, input: TillAdvanceInput, actor: Actor, user: CurrentUser, deviceToken: string | undefined) {
    this.common.requireRight(user, 'pos.sell');
    const company = await this.ready();
    const till = await this.common.usableTill(this.prisma, input.tillId, user);
    await this.common.assertDevice(this.prisma, till.id, deviceToken);
    // Sent twice (a retry after a dropped connection): the advance saved the first time.
    const again = await this.byClientId(input.clientId);
    if (again) return this.dto(await this.row(this.prisma, again.orderId!));
    const o = await this.row(this.prisma, orderId);
    if (o.storeId !== till.storeId) throw new BadRequestException(`Order ${o.number} is for another store`);
    if (o.status !== 'open' && o.status !== 'ready') throw new BadRequestException(`Order ${o.number} is ${o.status}; no advance can be taken`);
    const shift = await this.prisma.shift.findFirst({ where: { tillId: till.id, status: 'open' } });
    if (!shift) throw new BadRequestException('Open a shift on this till first');
    const method = this.tillMethod(till, input.paymentMethodId);
    if (method.kind === 'on_account') throw new BadRequestException('An advance is money received; it cannot be taken on account');
    if (method.needsReference && !input.reference?.trim()) throw new BadRequestException(`${method.name} needs the approval code or reference`);
    const date = businessDate();
    if (iso(shift.businessDate) !== date) throw new BadRequestException(`This till’s shift is from ${iso(shift.businessDate)}; close it and open a new one`);
    const amount = D(input.amount);
    await this.prisma.$transaction(
      async (tx) => {
        const account = await this.ledger.accountFor(tx, company.id, { role: roleForMethod(method), storeId: till.storeId });
        const p = await this.postReceipt(tx, { companyId: company.id, order: o, date, storeId: till.storeId, accountId: account.id, amount, reference: input.reference ?? null, referenceDate: null, remark: `Advance for order ${o.number} at till ${till.code} (${method.name})`, actor });
        if (method.kind === 'cash') {
          await tx.cashMovement.create({ data: { shiftId: shift.id, clientId: input.clientId, direction: 'in', amount: amount.toFixed(2), reason: `Advance for order ${o.number} (${p.number})`, byId: user.id, at: new Date() } });
        }
        await this.audit.record(tx, actor, { action: 'create', entityType: 'payment', entityId: p.id, changes: { kind: 'receipt', number: p.number, amount: amount.toFixed(2), order: o.number, till: till.code, method: method.code, clientId: input.clientId } });
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.dto(await this.row(this.prisma, orderId));
  }

  /** An advance in the back office, into a cash or bank account. */
  async officeAdvance(orderId: string, input: OfficeAdvanceInput, actor: Actor, user: CurrentUser) {
    const company = await this.ready();
    const o = await this.row(this.prisma, orderId);
    assertStoreAccess(user, o.storeId);
    if (o.status !== 'open' && o.status !== 'ready') throw new BadRequestException(`Order ${o.number} is ${o.status}; no advance can be taken`);
    const account = await this.prisma.account.findUnique({ where: { id: input.accountId } });
    if (!account || account.companyId !== company.id) throw new BadRequestException('Account not found');
    if (account.isGroup || !account.active || (account.kind !== 'cash' && account.kind !== 'bank')) throw new BadRequestException('Choose a cash or bank account in use');
    if (account.storeId) assertStoreAccess(user, account.storeId);
    // Bank receipts are the accountant's; a store's own cash account is enough for the store's staff.
    if (!hasPermission(user, 'payments.post') && (account.kind !== 'cash' || !account.storeId)) throw new ForbiddenException('You may take an advance only into your store’s cash; ask the accountant for a bank receipt');
    if (account.kind === 'bank' && (!input.reference?.trim() || !input.referenceDate)) throw new BadRequestException('A bank receipt needs the cheque or transfer number and its date');
    const date = input.paymentDate ?? businessDate();
    await this.prisma.$transaction(
      async (tx) => {
        const p = await this.postReceipt(tx, { companyId: company.id, order: o, date, storeId: o.storeId, accountId: account.id, amount: D(input.amount), reference: input.reference ?? null, referenceDate: input.referenceDate ?? null, remark: input.remark ?? `Advance for order ${o.number}`, actor });
        await this.audit.record(tx, actor, { action: 'create', entityType: 'payment', entityId: p.id, changes: { kind: 'receipt', number: p.number, amount: p.amount.toFixed(2), order: o.number } });
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.dto(await this.row(this.prisma, orderId));
  }

  /** A posted customer receipt against the order: debit the cash or bank account, credit the customer's balance. */
  private async postReceipt(
    tx: Db,
    s: { companyId: string; order: OrderRow; date: string; storeId: string; accountId: string; amount: Decimal; reference: string | null; referenceDate: string | null; remark: string; actor: Actor },
  ): Promise<Payment> {
    const fy = await tx.financialYear.findFirst({ where: { companyId: s.companyId, startDate: { lte: fromIso(s.date) }, endDate: { gte: fromIso(s.date) } } });
    if (!fy) throw new BadRequestException(`No financial year covers ${s.date}`);
    const number = await this.numbering.allocate(tx, { companyId: s.companyId, documentKind: 'receipt', date: s.date });
    const p = await tx.payment.create({
      data: {
        companyId: s.companyId,
        number,
        kind: 'receipt',
        paymentDate: fromIso(s.date),
        financialYearId: fy.id,
        storeId: s.storeId,
        partyType: 'customer',
        partyId: s.order.customerId,
        orderId: s.order.id,
        toAccountId: s.accountId,
        amount: s.amount.toFixed(2),
        reference: s.reference,
        referenceDate: s.referenceDate ? fromIso(s.referenceDate) : null,
        remark: s.remark,
        createdById: s.actor.userId,
        updatedById: s.actor.userId,
      },
    });
    const lines: LedgerLineInput[] = [
      { accountId: s.accountId, storeId: s.storeId, debit: s.amount },
      { role: 'customer_receivable', storeId: s.storeId, partyType: 'customer', partyId: s.order.customerId, credit: s.amount, itemType: 'payment', itemId: p.id, itemNumber: number },
    ];
    const entry = await this.ledger.post(tx, { companyId: s.companyId, date: s.date, documentType: 'payment', documentId: p.id, documentNumber: number, storeId: s.storeId, actorId: s.actor.userId, lines, remark: s.remark });
    return tx.payment.update({ where: { id: p.id }, data: { status: 'posted', ledgerEntryId: entry?.id ?? null, postedAt: new Date(), postedById: s.actor.userId } });
  }

  /**
   * Cancelling at the till: the advance is refunded by a refund-allowed method
   * with a manager's PIN, or kept as the customer's credit.
   */
  async tillCancel(orderId: string, input: TillCancelOrderInput, actor: Actor, user: CurrentUser, deviceToken: string | undefined) {
    this.common.requireRight(user, 'pos.sell');
    const company = await this.ready();
    const till = await this.common.usableTill(this.prisma, input.tillId, user);
    await this.common.assertDevice(this.prisma, till.id, deviceToken);
    const o = await this.row(this.prisma, orderId);
    if (o.storeId !== till.storeId) throw new BadRequestException(`Order ${o.number} is for another store`);
    // Sent twice: the first one cancelled it already.
    if (o.status === 'cancelled' && (await this.byClientId(input.clientId))) return this.dto(o);
    if (input.outcome === 'keep_credit') return this.dto(await this.cancelKeepingCredit(o, input.reason, actor));

    if (o.status !== 'open' && o.status !== 'ready') throw new BadRequestException(`Order ${o.number} is already ${o.status}`);
    const method = this.tillMethod(till, input.paymentMethodId!);
    if (method.kind === 'on_account' || !method.allowRefund) throw new BadRequestException(`${method.name} cannot be used for refunds`);
    if (method.needsReference && !input.reference?.trim()) throw new BadRequestException(`${method.name} needs the approval code or reference`);
    const shift = await this.prisma.shift.findFirst({ where: { tillId: till.id, status: 'open' } });
    if (!shift) throw new BadRequestException('Open a shift on this till first');
    const date = businessDate();
    if (iso(shift.businessDate) !== date) throw new BadRequestException(`This till’s shift is from ${iso(shift.businessDate)}; close it and open a new one`);
    const advances = await this.credit.orderAdvances(this.prisma, o.customerId, o.id);
    const held = PosCredit.total(advances);
    if (held.lte(0)) throw new BadRequestException(`Order ${o.number} has no advance to refund; cancel it keeping no credit`);
    const pending: PendingApproval[] = [];
    const managerId = await this.common.useApproval(this.prisma, input.approvalToken, till.id, ['order_refund'], `order ${o.number}`, pending);
    const after = await this.prisma.$transaction(
      async (tx) => {
        await this.credit.lock(tx, o.customerId);
        const fresh = await this.credit.orderAdvances(tx, o.customerId, o.id);
        const amount = PosCredit.total(fresh);
        if (!amount.eq(held)) throw new BadRequestException('The advance changed a moment ago; open the order again');
        const done = await tx.customerOrder.updateMany({
          where: { id: o.id, status: { in: ['open', 'ready'] } },
          data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: input.reason, advanceOutcome: 'refund', updatedById: actor.userId },
        });
        if (done.count !== 1) throw new BadRequestException(`Order ${o.number} changed a moment ago; open it again`);
        await this.credit.release(tx, o.id);
        const account = await this.ledger.accountFor(tx, company.id, { role: roleForMethod(method), storeId: till.storeId });
        const fy = await tx.financialYear.findFirst({ where: { companyId: company.id, startDate: { lte: fromIso(date) }, endDate: { gte: fromIso(date) } } });
        if (!fy) throw new BadRequestException(`No financial year covers ${date}`);
        const number = await this.numbering.allocate(tx, { companyId: company.id, documentKind: 'payment', date });
        const remark = `Advance of order ${o.number} refunded at till ${till.code} (${method.name})`;
        const p = await tx.payment.create({
          data: { companyId: company.id, number, kind: 'payment', paymentDate: fromIso(date), financialYearId: fy.id, storeId: till.storeId, partyType: 'customer', partyId: o.customerId, orderId: o.id, fromAccountId: account.id, amount: amount.toFixed(2), reference: input.reference ?? null, remark, createdById: actor.userId, updatedById: actor.userId },
        });
        const entry = await this.ledger.post(tx, {
          companyId: company.id,
          date,
          documentType: 'payment',
          documentId: p.id,
          documentNumber: number,
          storeId: till.storeId,
          actorId: actor.userId,
          remark,
          lines: [
            { role: 'customer_receivable', storeId: till.storeId, partyType: 'customer', partyId: o.customerId, debit: amount, itemType: 'payment', itemId: p.id, itemNumber: number },
            { accountId: account.id, storeId: till.storeId, credit: amount },
          ],
        });
        await tx.payment.update({ where: { id: p.id }, data: { status: 'posted', ledgerEntryId: entry?.id ?? null, postedAt: new Date(), postedById: actor.userId } });
        // The refund settles the advances, so neither stays open.
        for (const a of fresh) await this.ledger.link(tx, { companyId: company.id, partyType: 'customer', partyId: o.customerId, billType: 'payment', billId: p.id, byType: 'payment', byId: a.paymentId, amount: a.unused, date, actorId: actor.userId });
        if (method.kind === 'cash') await tx.cashMovement.create({ data: { shiftId: shift.id, clientId: input.clientId, direction: 'out', amount: amount.toFixed(2), reason: `Advance of order ${o.number} refunded (${number})`, byId: user.id, at: new Date() } });
        await this.common.markApprovalsUsed(tx, pending);
        await this.audit.record(tx, actor, { action: 'create', entityType: 'payment', entityId: p.id, changes: { kind: 'payment', number, amount: amount.toFixed(2), order: o.number, refund: true, clientId: input.clientId } });
        await this.audit.record(tx, actor, { action: 'update', entityType: 'customer_order', entityId: o.id, changes: { status: { old: o.status, new: 'cancelled' }, number: o.number, refunded: amount.toFixed(2), approvedBy: managerId }, reason: input.reason });
        return this.row(tx, o.id);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.dto(after);
  }

  // ---- Helpers ----

  private tillMethod(till: TillWithRefs, methodId: string) {
    const m = till.paymentMethods.find((x) => x.paymentMethodId === methodId)?.paymentMethod;
    if (!m || !m.active) throw new BadRequestException('That payment method is not used on this till');
    return m as typeof m & { accountRole: string };
  }

  /** A till advance or refund already saved under this client id (idempotency, pos-offline §4). */
  private async byClientId(clientId: string): Promise<Payment | null> {
    const log = await this.prisma.auditLog.findFirst({ where: { entityType: 'payment', changes: { path: ['clientId'], equals: clientId } }, select: { entityId: true } });
    return log?.entityId ? this.prisma.payment.findUnique({ where: { id: log.entityId } }) : null;
  }

  /** Where a store's tills sell from: its goods are set aside there. */
  private async sellingLocation(storeId: string): Promise<string> {
    const tills = await this.prisma.till.findMany({ where: { storeId, active: true }, orderBy: { code: 'asc' }, select: { locationId: true } });
    if (!tills.length) throw new BadRequestException('Set up a till for this store first: ordered goods are set aside where the till sells from');
    const count = new Map<string, number>();
    for (const t of tills) count.set(t.locationId, (count.get(t.locationId) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  private async checkInput(companyId: string, input: CustomerOrderInput) {
    const c = await this.prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!c || c.companyId !== companyId) throw new BadRequestException('Customer not found');
    if (c.isWalkIn) throw new BadRequestException('An order needs a named customer, not the walk-in customer');
    if (c.status === 'off') throw new BadRequestException(`${c.name} is switched off`);
    const store = await this.prisma.store.findUnique({ where: { id: input.storeId } });
    if (!store || store.companyId !== companyId) throw new BadRequestException('Store not found');
    const today = businessDate();
    if (input.expectedOn && input.expectedOn < today) throw new BadRequestException('The expected date cannot be in the past');
    const out: { lineNo: number; itemId: string; unitId: string; quantity: string; price: string; remarks: string | null }[] = [];
    for (const [i, l] of input.lines.entries()) {
      const item = await this.items.assertItemUsable(this.prisma, l.itemId, 'sale');
      const unitId = l.unitId ?? item.baseUnitId;
      const iu = await this.prisma.itemUnit.findUnique({ where: { itemId_unitId: { itemId: item.id, unitId } } });
      if (!iu) throw new BadRequestException(`${item.code}: the unit must be one of the item’s units`);
      out.push({ lineNo: i + 1, itemId: item.id, unitId, quantity: D(l.quantity).toDecimalPlaces(3).toString(), price: D(l.price).toDecimalPlaces(4).toString(), remarks: l.remarks ?? null });
    }
    return out;
  }

  private async row(db: Db, id: string): Promise<OrderRow> {
    const o = await db.customerOrder.findUnique({ where: { id }, include: orderInclude });
    if (!o) throw new NotFoundException('Order not found');
    return o;
  }

  private total(o: OrderRow): Decimal {
    return o.lines.reduce((s, l) => s.add(D(l.quantity).mul(D(l.price)).toDecimalPlaces(2)), new Decimal(0));
  }

  private receipts(db: Db, orderId: string) {
    return db.payment.findMany({ where: { orderId, status: 'posted' }, orderBy: { createdAt: 'asc' } });
  }

  private async ordersWithReceipts(companyId: string): Promise<string[]> {
    const rows = await this.prisma.payment.findMany({ where: { companyId, orderId: { not: null }, kind: 'receipt', status: 'posted' }, select: { orderId: true }, distinct: ['orderId'] });
    return rows.map((r) => r.orderId!);
  }

  private async customersMatching(companyId: string, text: string): Promise<string[]> {
    const rows = await this.prisma.customer.findMany({ where: { companyId, OR: [{ name: { contains: text, mode: 'insensitive' } }, { mobile: { contains: text } }, { code: { contains: text, mode: 'insensitive' } }] }, select: { id: true }, take: 200 });
    return rows.map((r) => r.id);
  }

  /** Per order: advance received, refunded, used on the bill, and still held (unused). */
  private async advanceFigures(orderIds: string[]) {
    const out = new Map<string, { received: Decimal; refunded: Decimal; held: Decimal }>();
    for (const id of orderIds) out.set(id, { received: new Decimal(0), refunded: new Decimal(0), held: new Decimal(0) });
    if (!orderIds.length) return out;
    const pays = await this.prisma.payment.findMany({ where: { orderId: { in: orderIds }, status: 'posted' }, select: { id: true, orderId: true, kind: true, amount: true } });
    const open = await this.ledger.openAmounts(this.prisma, 'payment', pays.filter((p) => p.kind === 'receipt').map((p) => p.id));
    for (const p of pays) {
      const f = out.get(p.orderId!)!;
      if (p.kind === 'receipt') {
        f.received = f.received.add(D(p.amount));
        f.held = f.held.add(open.get(p.id) ?? new Decimal(0));
      } else f.refunded = f.refunded.add(D(p.amount));
    }
    return out;
  }

  private async names(rows: OrderRow[]) {
    const [customers, stores, bills] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } }, select: { id: true, code: true, name: true, mobile: true } }),
      this.prisma.store.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.storeId))] } }, select: { id: true, code: true, name: true } }),
      this.prisma.posBill.findMany({ where: { id: { in: rows.map((r) => r.collectedBillId).filter((x): x is string => !!x) } }, select: { id: true, number: true } }),
    ]);
    return { customers: new Map(customers.map((c) => [c.id, c])), stores: new Map(stores.map((s) => [s.id, s])), bills: new Map(bills.map((b) => [b.id, b.number])) };
  }

  private summaryDto(o: OrderRow, names: Awaited<ReturnType<OrdersService['names']>>, money: { received: Decimal; refunded: Decimal; held: Decimal }) {
    const today = businessDate();
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      store: names.stores.get(o.storeId) ?? null,
      customer: names.customers.get(o.customerId) ?? null,
      expectedOn: iso(o.expectedOn),
      overdue: (o.status === 'open' || o.status === 'ready') && !!o.expectedOn && iso(o.expectedOn)! < today,
      total: this.total(o).toFixed(2),
      advanceReceived: money.received.toFixed(2),
      advanceRefunded: money.refunded.toFixed(2),
      advanceHeld: money.held.toFixed(2),
      readyAt: o.readyAt,
      collectedAt: o.collectedAt,
      collectedBill: o.collectedBillId ? { id: o.collectedBillId, number: names.bills.get(o.collectedBillId) ?? null } : null,
      cancelledAt: o.cancelledAt,
      cancelReason: o.cancelReason,
      advanceOutcome: o.advanceOutcome,
      remarks: o.remarks,
      createdAt: o.createdAt,
    };
  }

  async dto(o: OrderRow) {
    const names = await this.names([o]);
    const money = (await this.advanceFigures([o.id])).get(o.id)!;
    const items = await this.prisma.item.findMany({ where: { id: { in: o.lines.map((l) => l.itemId) } }, select: { id: true, code: true, name: true, isStockItem: true } });
    const units = await this.prisma.unit.findMany({ where: { id: { in: o.lines.map((l) => l.unitId) } }, select: { id: true, code: true } });
    const reservations = await this.prisma.stockReservation.findMany({ where: { orderLineId: { in: o.lines.map((l) => l.id) } }, orderBy: { createdAt: 'asc' } });
    const pays = await this.receipts(this.prisma, o.id);
    const open = await this.ledger.openAmounts(this.prisma, 'payment', pays.map((p) => p.id));
    return {
      ...this.summaryDto(o, names, money),
      customerId: o.customerId,
      storeId: o.storeId,
      lines: o.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        item: items.find((i) => i.id === l.itemId) ?? { id: l.itemId, code: '', name: '', isStockItem: true },
        unitId: l.unitId,
        unitCode: units.find((u) => u.id === l.unitId)?.code ?? '',
        quantity: D(l.quantity).toString(),
        price: D(l.price).toFixed(2),
        amount: D(l.quantity).mul(D(l.price)).toDecimalPlaces(2).toFixed(2),
        remarks: l.remarks,
        setAside: reservations.filter((r) => r.orderLineId === l.id && !r.releasedAt).reduce((s, r) => s.add(D(r.quantity)), new Decimal(0)).toString(),
      })),
      payments: pays.map((p) => ({ id: p.id, number: p.number, kind: p.kind, date: iso(p.paymentDate), amount: p.amount.toFixed(2), reference: p.reference, unused: p.kind === 'receipt' ? (open.get(p.id) ?? new Decimal(0)).toFixed(2) : null, remark: p.remark })),
    };
  }
}
