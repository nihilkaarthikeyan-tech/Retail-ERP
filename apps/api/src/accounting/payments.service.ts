// Copyright (c) 2026, Rademics. All rights reserved.
// Receipts from customers, payments to suppliers and transfers between the
// shop's own accounts (blueprint 11 process 2; plan 07 §1.3). `amount` is the
// money that moves through the cash or bank account; deductions (bank charges,
// card commission, a short payment written off) settle more of the party's
// bills on a receipt, or take part of a transfer.
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { type CurrentUser, type DocListQuery, Decimal, hasPermission, type PaymentInput, settleOldestFirst, type SettleInput } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { type LedgerLineInput, LedgerService } from '../ledger/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountingCommon, D, fromIso, iso } from './accounting-common.service.js';

const paymentInclude = { allocations: true, deductions: true } satisfies Prisma.PaymentInclude;
type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: AccountingCommon,
    private readonly ledger: LedgerService,
  ) {}

  async list(q: DocListQuery, user: CurrentUser) {
    const company = await this.common.ready();
    // Audit 1 (28 October 2026): a person working in some stores sees only theirs (and the ones without a store).
    const allowed = this.common.storeFilter(user);
    const rows = await this.prisma.payment.findMany({
      where: {
        companyId: company.id,
        ...(allowed ? { OR: [{ storeId: null }, { storeId: { in: allowed } }] } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.partyId ? { partyId: q.partyId } : {}),
        ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { reference: { contains: q.search, mode: 'insensitive' } }] } : {}),
        ...(q.from || q.to ? { paymentDate: { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } } : {}),
      },
      include: paymentInclude,
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return Promise.all(rows.map((p) => this.dto(this.prisma, p)));
  }

  async get(id: string, user?: CurrentUser) {
    const p = await this.row(this.prisma, id);
    if (user) this.common.assertStore(user, p.storeId);
    return this.dto(this.prisma, p);
  }

  /** A customer's or supplier's open bills and unused payments, oldest first. */
  async openItems(partyType: 'customer' | 'supplier', partyId: string) {
    await this.common.ready();
    const items = await this.ledger.openItems(this.prisma, partyType, partyId);
    return items
      .sort((a, b) => oldestFirst(a).localeCompare(oldestFirst(b)))
      .map((i) => ({ itemType: i.itemType, itemId: i.itemId, number: i.number, date: i.date, dueDate: i.dueDate, amount: i.amount.toFixed(2), settled: i.settled.toFixed(2), owed: i.owed.toFixed(2) }));
  }

  async create(input: PaymentInput, actor: Actor, user: CurrentUser) {
    const company = await this.common.ready();
    await this.validate(this.prisma, company.id, input, user);
    const fy = await this.common.yearFor(this.prisma, company.id, input.paymentDate);
    const created = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          companyId: company.id,
          kind: input.kind,
          paymentDate: fromIso(input.paymentDate),
          financialYearId: fy.id,
          storeId: input.storeId ?? null,
          partyType: input.kind === 'transfer' ? null : input.partyType!,
          partyId: input.kind === 'transfer' ? null : input.partyId!,
          fromAccountId: input.fromAccountId ?? null,
          toAccountId: input.toAccountId ?? null,
          amount: D(input.amount).toFixed(2),
          reference: input.reference ?? null,
          referenceDate: input.referenceDate ? fromIso(input.referenceDate) : null,
          clearedOn: input.clearedOn ? fromIso(input.clearedOn) : null,
          remark: input.remark ?? null,
          createdById: actor.userId,
          updatedById: actor.userId,
          allocations: { create: (input.allocations ?? []).map((a) => ({ billType: a.billType, billId: a.billId, amount: D(a.amount).toFixed(2) })) },
          deductions: { create: input.deductions.map((d) => ({ accountId: d.accountId, amount: D(d.amount).toFixed(2), remark: d.remark ?? null })) },
        },
        include: paymentInclude,
      });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'payment', entityId: p.id, changes: { kind: p.kind, amount: p.amount.toString(), date: input.paymentDate } });
      return p;
    });
    // Without bills chosen, settle the oldest first (blueprint 11 process 2).
    if (input.kind !== 'transfer' && input.autoSettle && !(input.allocations ?? []).length) await this.autoAllocate(created.id);
    return this.get(created.id);
  }

  async update(id: string, input: PaymentInput, actor: Actor, user: CurrentUser) {
    const company = await this.common.ready();
    const before = await this.row(this.prisma, id);
    this.common.assertStore(user, before.storeId);
    if (before.status !== 'draft') throw new BadRequestException(`A ${before.status} payment cannot be changed; cancel it and make a new one`);
    await this.validate(this.prisma, company.id, input, user);
    const fy = await this.common.yearFor(this.prisma, company.id, input.paymentDate);
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentAllocation.deleteMany({ where: { paymentId: id } });
      await tx.paymentDeduction.deleteMany({ where: { paymentId: id } });
      await tx.payment.update({
        where: { id },
        data: {
          kind: input.kind,
          paymentDate: fromIso(input.paymentDate),
          financialYearId: fy.id,
          storeId: input.storeId ?? null,
          partyType: input.kind === 'transfer' ? null : input.partyType!,
          partyId: input.kind === 'transfer' ? null : input.partyId!,
          fromAccountId: input.fromAccountId ?? null,
          toAccountId: input.toAccountId ?? null,
          amount: D(input.amount).toFixed(2),
          reference: input.reference ?? null,
          referenceDate: input.referenceDate ? fromIso(input.referenceDate) : null,
          clearedOn: input.clearedOn ? fromIso(input.clearedOn) : null,
          remark: input.remark ?? null,
          updatedById: actor.userId,
          allocations: { create: (input.allocations ?? []).map((a) => ({ billType: a.billType, billId: a.billId, amount: D(a.amount).toFixed(2) })) },
          deductions: { create: input.deductions.map((d) => ({ accountId: d.accountId, amount: D(d.amount).toFixed(2), remark: d.remark ?? null })) },
        },
      });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'payment', entityId: id, changes: { amount: input.amount, date: input.paymentDate } });
    });
    if (input.kind !== 'transfer' && input.autoSettle && !(input.allocations ?? []).length) await this.autoAllocate(id);
    return this.get(id);
  }

  async post(id: string, actor: Actor, user: CurrentUser) {
    const company = await this.common.ready();
    const p = await this.row(this.prisma, id);
    if (p.status !== 'draft') throw new BadRequestException(`The payment is already ${p.status}`);
    await this.validate(this.prisma, company.id, this.inputOf(p), user);
    const posted = await this.prisma.$transaction(
      async (tx) => {
        const fresh = await tx.payment.findUniqueOrThrow({ where: { id } });
        if (fresh.status !== 'draft') throw new BadRequestException(`The payment is already ${fresh.status}`);
        const date = iso(p.paymentDate)!;
        const number = await this.common.allocate(tx, company.id, p.kind, date);
        const deductions = p.deductions.reduce((s, d) => s.add(D(d.amount)), new Decimal(0));
        const amount = D(p.amount);
        const lines: LedgerLineInput[] = [];
        const store = p.storeId ?? (await this.ledger.firstStore(tx, company.id));
        const item = { itemType: 'payment', itemId: p.id, itemNumber: number };
        if (p.kind === 'receipt') {
          lines.push({ accountId: p.toAccountId!, storeId: store, debit: amount });
          for (const d of p.deductions) lines.push({ accountId: d.accountId, storeId: store, debit: D(d.amount), remark: d.remark });
          lines.push({ role: 'customer_receivable', storeId: store, partyType: 'customer', partyId: p.partyId!, credit: amount.add(deductions), ...item });
        } else if (p.kind === 'payment') {
          lines.push({ accountId: p.fromAccountId!, storeId: store, credit: amount });
          for (const d of p.deductions) lines.push({ accountId: d.accountId, storeId: store, credit: D(d.amount), remark: d.remark });
          lines.push({ role: 'supplier_payable', storeId: store, partyType: 'supplier', partyId: p.partyId!, debit: amount.add(deductions), ...item });
        } else {
          lines.push({ accountId: p.fromAccountId!, storeId: store, credit: amount });
          for (const d of p.deductions) lines.push({ accountId: d.accountId, storeId: store, debit: D(d.amount), remark: d.remark });
          lines.push({ accountId: p.toAccountId!, storeId: store, debit: amount.sub(deductions) });
        }
        const entry = await this.ledger.post(tx, { companyId: company.id, date, documentType: 'payment', documentId: p.id, documentNumber: number, storeId: store, tolerance: 'journal', actorId: actor.userId, lines, remark: p.remark });
        // Links to the bills it settles, checked again with what is owed now.
        if (p.kind !== 'transfer') {
          let used = new Decimal(0);
          for (const a of p.allocations) {
            const owed = await this.ledger.openAmount(tx, a.billType, a.billId);
            if (D(a.amount).gt(owed)) throw new BadRequestException(`A bill owes only ₹${owed.toFixed(2)}; settle less against it`);
            used = used.add(D(a.amount));
            await this.ledger.link(tx, { companyId: company.id, partyType: p.partyType!, partyId: p.partyId!, billType: a.billType, billId: a.billId, byType: 'payment', byId: p.id, amount: D(a.amount), date, actorId: actor.userId });
          }
          if (used.gt(amount.add(deductions))) throw new BadRequestException('More is settled against bills than the payment covers');
        }
        await tx.payment.update({ where: { id }, data: { status: 'posted', number, ledgerEntryId: entry?.id ?? null, postedAt: new Date(), postedById: actor.userId, updatedById: actor.userId } });
        await this.audit.record(tx, actor, { action: 'update', entityType: 'payment', entityId: id, changes: { status: { old: 'draft', new: 'posted' }, number, amount: p.amount.toString() } });
        return this.row(tx, id);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.dto(this.prisma, posted);
  }

  /** Cancelling: the links to bills are undone and equal and opposite entries written (bills owe again). */
  async cancel(id: string, reason: string, actor: Actor, user: CurrentUser) {
    await this.common.ready();
    const p = await this.row(this.prisma, id);
    if (p.status === 'cancelled') throw new BadRequestException('Already cancelled');
    this.checkRights(p.kind as PaymentInput['kind'], user);
    this.common.assertStore(user, p.storeId);
    const after = await this.prisma.$transaction(async (tx) => {
      if (p.status === 'posted') {
        await this.ledger.undoLinks(tx, 'payment', id, actor.userId);
        await this.ledger.reverseDocument(tx, 'payment', id, actor.userId, `Cancelled: ${reason}`);
      }
      await tx.payment.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'payment', entityId: id, changes: { status: { old: p.status, new: 'cancelled' }, number: p.number }, reason });
      return this.row(tx, id);
    });
    return this.dto(this.prisma, after);
  }

  /** Links an unused payment, journal or credit to a bill of the same party (blueprint 11 "payment matching tool"). */
  async settle(input: SettleInput, actor: Actor, user: CurrentUser) {
    const company = await this.common.ready();
    if (!hasPermission(user, 'payments.post')) throw new ForbiddenException('You are not allowed to link payments to bills');
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settle|${input.partyType}|${input.partyId}`}))`;
      const items = await this.ledger.openItems(tx, input.partyType, input.partyId);
      const bill = items.find((i) => i.itemType === input.billType && i.itemId === input.billId);
      const by = items.find((i) => i.itemType === input.byType && i.itemId === input.byId);
      if (!bill || bill.owed.lte(0)) throw new BadRequestException('That bill has nothing left to settle');
      if (!by || by.owed.gte(0)) throw new BadRequestException('That payment or credit has nothing left to use');
      const amount = D(input.amount);
      if (amount.gt(bill.owed)) throw new BadRequestException(`The bill owes only ₹${bill.owed.toFixed(2)}`);
      if (amount.gt(by.owed.neg())) throw new BadRequestException(`Only ₹${by.owed.neg().toFixed(2)} of it is unused`);
      const s = await this.ledger.link(tx, { companyId: company.id, partyType: input.partyType, partyId: input.partyId, billType: input.billType, billId: input.billId, byType: input.byType, byId: input.byId, amount, date: iso(new Date())!, actorId: actor.userId });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'settlement', entityId: s.id, changes: { bill: bill.number, by: by.number, amount: amount.toFixed(2) } });
    });
    return this.openItems(input.partyType, input.partyId);
  }

  /** A party's links between payments and bills, with the numbers of both sides (newest first). */
  async settlements(partyType: 'customer' | 'supplier', partyId: string) {
    const company = await this.common.ready();
    const rows = await this.prisma.settlement.findMany({ where: { companyId: company.id, partyType, partyId }, orderBy: { createdAt: 'desc' }, take: 500 });
    const ids = [...new Set(rows.flatMap((r) => [r.billId, r.byId]))];
    const numbers = new Map(
      (await this.prisma.ledgerLine.findMany({ where: { itemId: { in: ids }, itemNumber: { not: null } }, select: { itemId: true, itemNumber: true }, distinct: ['itemId'] })).map((l) => [l.itemId!, l.itemNumber]),
    );
    return rows.map((r) => ({
      id: r.id,
      billType: r.billType,
      billId: r.billId,
      billNumber: numbers.get(r.billId) ?? null,
      byType: r.byType,
      byId: r.byId,
      byNumber: numbers.get(r.byId) ?? null,
      amount: r.amount.toFixed(2),
      settledOn: iso(r.settledOn),
      undone: r.undone,
    }));
  }

  async undoSettlement(id: string, actor: Actor, user: CurrentUser) {
    const company = await this.common.ready();
    if (!hasPermission(user, 'payments.post')) throw new ForbiddenException('You are not allowed to undo links');
    const s = await this.prisma.settlement.findUnique({ where: { id } });
    if (!s || s.companyId !== company.id) throw new NotFoundException('Link not found');
    if (s.undone) throw new BadRequestException('Already undone');
    await this.prisma.$transaction(async (tx) => {
      await tx.settlement.update({ where: { id }, data: { undone: true, undoneAt: new Date(), undoneById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'settlement', entityId: id, changes: { undone: true, amount: s.amount.toString() } });
    });
    return this.openItems(s.partyType as 'customer' | 'supplier', s.partyId);
  }

  // ---- Checks ----

  private checkRights(kind: PaymentInput['kind'], user: CurrentUser) {
    if (hasPermission(user, 'payments.post')) return;
    if (kind === 'transfer' && hasPermission(user, 'cash.deposit')) return;
    throw new ForbiddenException(kind === 'transfer' ? 'You are not allowed to move money between accounts' : 'You are not allowed to record receipts and payments');
  }

  private async validate(db: Db, companyId: string, input: PaymentInput, user: CurrentUser) {
    this.checkRights(input.kind, user);
    this.common.assertStore(user, input.storeId);
    const cashOrBank = async (id: string | null | undefined, label: string) => {
      if (!id) return null;
      const a = await this.common.account(db, companyId, id);
      if (a.isGroup || !a.active) throw new BadRequestException(`${label}: choose an account in use, not a folder`);
      if (input.kind !== 'transfer' && a.kind !== 'cash' && a.kind !== 'bank') throw new BadRequestException(`${label}: choose a cash or bank account`);
      if (a.storeId) this.common.assertStore(user, a.storeId);
      return a;
    };
    const from = await cashOrBank(input.fromAccountId, 'From');
    const to = await cashOrBank(input.toAccountId, 'To');
    if (input.kind === 'transfer') {
      for (const a of [from, to]) if (a && (a.kind === 'receivable' || a.kind === 'payable')) throw new BadRequestException('Use a receipt or payment for customer and supplier balances');
      // Store managers move cash only between their own stores' cash accounts and the bank (cash deposits).
      if (!hasPermission(user, 'payments.post') && [from, to].some((a) => a && a.kind !== 'cash' && a.kind !== 'bank')) throw new ForbiddenException('Store managers can only move cash to the bank or between cash accounts');
    }
    const bank = [from, to].find((a) => a?.kind === 'bank');
    if (bank && input.kind !== 'transfer' && (!input.reference?.trim() || !input.referenceDate)) throw new BadRequestException('A bank receipt or payment needs the cheque or transfer number and its date');
    for (const d of input.deductions) {
      const a = await this.common.account(db, companyId, d.accountId);
      if (a.isGroup || !a.active) throw new BadRequestException('Deduction: choose an account in use, not a folder');
      if (a.kind === 'receivable' || a.kind === 'payable') throw new BadRequestException('Deduction: choose an expense or income account');
    }
    if (input.kind === 'transfer') {
      const ded = input.deductions.reduce((s, d) => s.add(D(d.amount)), new Decimal(0));
      if (ded.gte(D(input.amount))) throw new BadRequestException('The deductions are more than the transfer');
      return;
    }
    if (input.partyType === 'customer') {
      const c = await db.customer.findFirst({ where: { id: input.partyId!, companyId } });
      if (!c) throw new BadRequestException('Customer not found');
    } else {
      const s = await db.supplier.findFirst({ where: { id: input.partyId!, companyId } });
      if (!s) throw new BadRequestException('Supplier not found');
      // A supplier held for payments cannot be paid (blueprint 06 / 11).
      if (input.kind === 'payment' && (s.holdType === 'payments' || s.holdType === 'all') && (!s.holdUntil || iso(s.holdUntil)! >= input.paymentDate)) {
        throw new BadRequestException(`${s.name} is on hold for payments${s.holdReason ? `: ${s.holdReason}` : ''}`);
      }
      if (s.status === 'blocked' && input.kind === 'payment') throw new BadRequestException(`${s.name} is blocked`);
    }
    const items = await this.ledger.openItems(db, input.partyType!, input.partyId!);
    const seen = new Set<string>();
    let total = new Decimal(0);
    for (const a of input.allocations ?? []) {
      const k = `${a.billType}|${a.billId}`;
      if (seen.has(k)) throw new BadRequestException('A bill may be listed only once');
      seen.add(k);
      const bill = items.find((i) => i.itemType === a.billType && i.itemId === a.billId);
      if (!bill || bill.owed.lte(0)) throw new BadRequestException('A bill listed is not an open bill of this party');
      if (D(a.amount).gt(bill.owed)) throw new BadRequestException(`Bill ${bill.number ?? ''} owes only ₹${bill.owed.toFixed(2)}`);
      if (a.billType === 'supplier_bill') {
        const sb = await db.supplierBill.findUnique({ where: { id: a.billId } });
        if (sb?.holdReason && (!sb.holdUntil || iso(sb.holdUntil)! >= input.paymentDate)) throw new BadRequestException(`Bill ${sb.supplierBillNo} is on hold: ${sb.holdReason}`);
      }
      total = total.add(D(a.amount));
    }
    const covers = D(input.amount).add(input.deductions.reduce((s, d) => s.add(D(d.amount)), new Decimal(0)));
    if (total.gt(covers)) throw new BadRequestException(`₹${total.toFixed(2)} is settled against bills but the payment covers only ₹${covers.toFixed(2)}`);
  }

  /** Oldest bills first, up to what the payment covers (blueprint 11 process 2). */
  private async autoAllocate(id: string) {
    const p = await this.row(this.prisma, id);
    if (!p.partyType || !p.partyId) return;
    const items = await this.ledger.openItems(this.prisma, p.partyType as 'customer' | 'supplier', p.partyId);
    // Oldest due first; bills due the same day in number order.
    const bills = items.filter((i) => i.owed.gt(0)).map((i) => ({ id: `${i.itemType}|${i.itemId}`, open: i.owed.toString(), date: oldestFirst(i) }));
    const covers = D(p.amount).add(p.deductions.reduce((s, d) => s.add(D(d.amount)), new Decimal(0)));
    const { allocations } = settleOldestFirst(covers, bills);
    await this.prisma.paymentAllocation.createMany({
      data: allocations.map((a) => {
        const [billType, billId] = a.id.split('|');
        return { paymentId: id, billType, billId, amount: a.amount.toFixed(2) };
      }),
    });
  }

  private inputOf(p: PaymentRow): PaymentInput {
    return {
      kind: p.kind as PaymentInput['kind'],
      paymentDate: iso(p.paymentDate)!,
      storeId: p.storeId,
      partyType: p.partyType as 'customer' | 'supplier' | null,
      partyId: p.partyId,
      fromAccountId: p.fromAccountId,
      toAccountId: p.toAccountId,
      amount: p.amount.toString(),
      reference: p.reference,
      referenceDate: iso(p.referenceDate),
      clearedOn: iso(p.clearedOn),
      remark: p.remark,
      allocations: p.allocations.map((a) => ({ billType: a.billType, billId: a.billId, amount: a.amount.toString() })),
      autoSettle: false,
      deductions: p.deductions.map((d) => ({ accountId: d.accountId, amount: d.amount.toString(), remark: d.remark })),
    };
  }

  private async row(db: Db, id: string): Promise<PaymentRow> {
    const company = await this.common.ready(db);
    const p = await db.payment.findUnique({ where: { id }, include: paymentInclude });
    if (!p || p.companyId !== company.id) throw new NotFoundException('Payment not found');
    return p;
  }

  private async dto(db: Db, p: PaymentRow) {
    const deductions = p.deductions.reduce((s, d) => s.add(D(d.amount)), new Decimal(0));
    const allocated = p.allocations.reduce((s, a) => s.add(D(a.amount)), new Decimal(0));
    const unused = p.status === 'posted' && p.partyType ? (await this.ledger.openAmount(db, 'payment', p.id)).toFixed(2) : D(p.amount).add(deductions).sub(allocated).toFixed(2);
    return {
      id: p.id,
      number: p.number,
      kind: p.kind,
      paymentDate: iso(p.paymentDate),
      storeId: p.storeId,
      partyType: p.partyType,
      partyId: p.partyId,
      fromAccountId: p.fromAccountId,
      toAccountId: p.toAccountId,
      amount: p.amount.toFixed(2),
      deductions: p.deductions.map((d) => ({ accountId: d.accountId, amount: d.amount.toFixed(2), remark: d.remark })),
      allocations: p.allocations.map((a) => ({ billType: a.billType, billId: a.billId, amount: a.amount.toFixed(2) })),
      unused,
      reference: p.reference,
      referenceDate: iso(p.referenceDate),
      clearedOn: iso(p.clearedOn),
      remark: p.remark,
      status: p.status,
      ledgerEntryId: p.ledgerEntryId,
      postedAt: p.postedAt,
      cancelledAt: p.cancelledAt,
      cancelReason: p.cancelReason,
    };
  }
}

/** Sort key for "oldest first": due date (or bill date), then the bill's own date and number. */
function oldestFirst(i: { dueDate: string | null; date: string; number: string | null }): string {
  return `${i.dueDate ?? i.date}|${i.date}|${i.number ?? ''}`;
}
