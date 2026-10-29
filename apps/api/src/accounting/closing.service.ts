// Copyright (c) 2026, Rademics. All rights reserved.
// Protecting the books (plan 07 §1.6–1.7; blueprint 11 processes 6 and 7):
// the books-locked date, opening bills for going live, and year-end closing.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type CurrentUser, Decimal, type OpeningBillInput, type YearEndClosingInput } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { type LedgerLineInput, LedgerService } from '../ledger/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountingCommon, D, fromIso, iso } from './accounting-common.service.js';

@Injectable()
export class ClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: AccountingCommon,
    private readonly ledger: LedgerService,
  ) {}

  // ---- Books locked up to a date ----

  async setLockDate(lockDate: string | null, reason: string, actor: Actor) {
    const company = await this.common.ready();
    // Audit 2 (28 October 2026): a till shift still open from on or before the date would post its bills
    // after the lock, on the next open day, so the period's sales and GST would differ from its bills.
    if (lockDate) {
      const open = await this.prisma.shift.findMany({ where: { status: 'open', businessDate: { lte: fromIso(lockDate) } }, select: { businessDate: true, till: { select: { code: true } } } });
      if (open.length) {
        const list = open.map((s) => `${s.till.code} (${iso(s.businessDate)})`).join(', ');
        throw new BadRequestException(`Close these till shifts first, so their bills are in the accounts before the lock: ${list}`);
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({ where: { id: company.id }, data: { lockDate: lockDate ? fromIso(lockDate) : null, updatedById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'company', entityId: company.id, changes: { booksLockedTo: { old: iso(company.lockDate), new: lockDate } }, reason });
    });
    return { lockDate };
  }

  // ---- Opening bills (blueprint 11 "Opening balances") ----

  async openingBills() {
    const company = await this.common.ready();
    const rows = await this.prisma.openingBill.findMany({ where: { companyId: company.id }, orderBy: [{ billDate: 'asc' }, { billNumber: 'asc' }] });
    return Promise.all(
      rows.map(async (b) => ({
        id: b.id,
        partyType: b.partyType,
        partyId: b.partyId,
        storeId: b.storeId,
        billNumber: b.billNumber,
        billDate: iso(b.billDate),
        dueDate: iso(b.dueDate),
        amount: b.amount.toFixed(2),
        owed: b.status === 'posted' ? (await this.ledger.openAmount(this.prisma, 'opening_bill', b.id)).toFixed(2) : '0.00',
        status: b.status,
      })),
    );
  }

  /** One unpaid bill from before going live, against the temporary opening account, so ageing works from day one. */
  async createOpeningBill(input: OpeningBillInput, actor: Actor, user: CurrentUser) {
    const company = await this.common.ready();
    this.common.assertStore(user, input.storeId);
    if (await this.prisma.yearEndClosing.count({ where: { companyId: company.id, status: 'posted' } })) throw new BadRequestException('Opening entries are refused once a year has been closed');
    const party = input.partyType === 'customer' ? await this.prisma.customer.findFirst({ where: { id: input.partyId, companyId: company.id } }) : await this.prisma.supplier.findFirst({ where: { id: input.partyId, companyId: company.id } });
    if (!party) throw new BadRequestException(`${input.partyType === 'customer' ? 'Customer' : 'Supplier'} not found`);
    if (input.dueDate && input.dueDate < input.billDate) throw new BadRequestException('The due date cannot be before the bill date');
    const dup = await this.prisma.openingBill.findFirst({ where: { companyId: company.id, partyType: input.partyType, partyId: input.partyId, billNumber: input.billNumber, status: 'posted' } });
    if (dup) throw new BadRequestException(`Opening bill ${input.billNumber} is already entered for this party`);
    // Posted on the day before go-live is the usual practice; the bill keeps its own date for ageing.
    const created = await this.prisma.$transaction(async (tx) => {
      const b = await tx.openingBill.create({
        data: {
          companyId: company.id,
          partyType: input.partyType,
          partyId: input.partyId,
          storeId: input.storeId ?? null,
          billNumber: input.billNumber,
          billDate: fromIso(input.billDate),
          dueDate: input.dueDate ? fromIso(input.dueDate) : null,
          amount: D(input.amount).toFixed(2),
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      const amount = D(input.amount);
      const partyLine: LedgerLineInput = {
        role: input.partyType === 'customer' ? 'customer_receivable' : 'supplier_payable',
        storeId: input.storeId ?? null,
        partyType: input.partyType,
        partyId: input.partyId,
        itemType: 'opening_bill',
        itemId: b.id,
        itemNumber: input.billNumber,
        dueDate: input.dueDate ?? input.billDate,
        ...(input.partyType === 'customer' ? { debit: amount } : { credit: amount }),
      };
      const other: LedgerLineInput = { role: 'temporary_opening', storeId: input.storeId ?? null, ...(input.partyType === 'customer' ? { credit: amount } : { debit: amount }) };
      const entry = await this.ledger.post(tx, {
        companyId: company.id,
        date: input.billDate,
        documentType: 'opening_bill',
        documentId: b.id,
        documentNumber: input.billNumber,
        storeId: input.storeId ?? null,
        isOpening: true,
        tolerance: 'journal',
        actorId: actor.userId,
        lines: [partyLine, other],
        remark: `Opening bill ${input.billNumber}`,
      });
      await tx.openingBill.update({ where: { id: b.id }, data: { ledgerEntryId: entry?.id ?? null } });
      await this.audit.record(tx, actor, { action: 'create', entityType: 'opening_bill', entityId: b.id, changes: { partyType: input.partyType, billNumber: input.billNumber, amount: amount.toFixed(2) } });
      return b;
    });
    return { id: created.id };
  }

  async cancelOpeningBill(id: string, reason: string, actor: Actor) {
    const company = await this.common.ready();
    const b = await this.prisma.openingBill.findUnique({ where: { id } });
    if (!b || b.companyId !== company.id) throw new NotFoundException('Opening bill not found');
    if (b.status !== 'posted') throw new BadRequestException('Already cancelled');
    if (await this.prisma.settlement.count({ where: { billType: 'opening_bill', billId: id, undone: false } })) throw new BadRequestException('Payments are linked to this bill; undo the links first');
    await this.prisma.$transaction(async (tx) => {
      await this.ledger.reverseDocument(tx, 'opening_bill', id, actor.userId, `Cancelled: ${reason}`);
      await tx.openingBill.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'opening_bill', entityId: id, changes: { status: { old: 'posted', new: 'cancelled' } }, reason });
    });
    return { id };
  }

  /** After going live the temporary opening account must be at zero (blueprint 11 process 6 step 5). */
  async openingCheck() {
    const company = await this.common.ready();
    const d = await this.prisma.accountDefault.findUniqueOrThrow({ where: { companyId_role: { companyId: company.id, role: 'temporary_opening' } }, include: { account: true } });
    const sum = await this.prisma.ledgerLine.aggregate({ where: { accountId: d.accountId }, _sum: { debit: true, credit: true } });
    const balance = D(sum._sum.debit ?? 0).sub(D(sum._sum.credit ?? 0));
    return { account: { id: d.account.id, name: d.account.name }, debit: D(sum._sum.debit ?? 0).toFixed(2), credit: D(sum._sum.credit ?? 0).toFixed(2), difference: balance.toFixed(2), ok: balance.isZero() };
  }

  // ---- Year-end closing (blueprint 11 process 7; plan 07 answer 4) ----

  async closings() {
    const company = await this.common.ready();
    const rows = await this.prisma.yearEndClosing.findMany({ where: { companyId: company.id }, orderBy: { periodEnd: 'desc' } });
    const years = new Map((await this.prisma.financialYear.findMany({ where: { companyId: company.id } })).map((y) => [y.id, y.name]));
    return rows.map((c) => ({ id: c.id, financialYearId: c.financialYearId, financialYear: years.get(c.financialYearId), periodEnd: iso(c.periodEnd), closingAccountId: c.closingAccountId, remark: c.remark, status: c.status, ledgerEntryId: c.ledgerEntryId, createdAt: c.createdAt }));
  }

  /**
   * Moves every income and expense balance of the year into the closing account,
   * per store, so the new year starts at zero. The previous year must be closed
   * first; the closing account is a capital or liability account.
   */
  async close(input: YearEndClosingInput, actor: Actor) {
    const company = await this.common.ready();
    const fy = await this.prisma.financialYear.findUnique({ where: { id: input.financialYearId } });
    if (!fy || fy.companyId !== company.id) throw new BadRequestException('Financial year not found');
    const closingAccount = await this.common.account(this.prisma, company.id, input.closingAccountId);
    if (closingAccount.isGroup || (closingAccount.family !== 'equity' && closingAccount.family !== 'liability')) throw new BadRequestException('The closing account must be a capital or liability account (for example Retained earnings)');
    if (await this.prisma.yearEndClosing.findFirst({ where: { companyId: company.id, financialYearId: fy.id, status: 'posted' } })) throw new BadRequestException(`${fy.name} is already closed`);
    const earlier = await this.prisma.financialYear.findMany({ where: { companyId: company.id, endDate: { lt: fy.startDate } } });
    for (const y of earlier) {
      const used = await this.prisma.ledgerLine.count({ where: { companyId: company.id, entryDate: { gte: y.startDate, lte: y.endDate } } });
      const closed = await this.prisma.yearEndClosing.count({ where: { financialYearId: y.id, status: 'posted' } });
      if (used && !closed) throw new BadRequestException(`Close ${y.name} first`);
    }
    const later = await this.prisma.yearEndClosing.count({ where: { companyId: company.id, status: 'posted', periodEnd: { gt: fy.endDate } } });
    if (later) throw new BadRequestException('A later year is already closed');
    const periodEnd = iso(fy.endDate)!;
    await this.checkReadyToClose(company, fy.name, fy.endDate);

    const sums = await this.prisma.ledgerLine.groupBy({
      by: ['accountId', 'storeId'],
      where: { companyId: company.id, entryDate: { gte: fy.startDate, lte: fy.endDate }, account: { family: { in: ['income', 'expense'] } } },
      _sum: { debit: true, credit: true },
    });
    const lines: LedgerLineInput[] = [];
    const netByStore = new Map<string, Decimal>();
    for (const s of sums) {
      const dr = D(s._sum.debit ?? 0).sub(D(s._sum.credit ?? 0));
      if (dr.isZero()) continue;
      lines.push({ accountId: s.accountId, storeId: s.storeId, credit: dr, remark: 'Year-end closing' });
      const k = s.storeId ?? '';
      netByStore.set(k, (netByStore.get(k) ?? new Decimal(0)).add(dr));
    }
    for (const [store, dr] of netByStore) lines.push({ accountId: closingAccount.id, storeId: store || null, debit: dr, remark: dr.gt(0) ? 'Loss for the year' : 'Profit for the year' });

    const closing = await this.prisma.$transaction(
      async (tx) => {
        const c = await tx.yearEndClosing.create({
          data: { companyId: company.id, financialYearId: fy.id, closingAccountId: closingAccount.id, periodEnd: fy.endDate, remark: input.remark ?? null, createdById: actor.userId, updatedById: actor.userId },
        });
        const entry = await this.ledger.post(tx, { companyId: company.id, date: periodEnd, documentType: 'year_end_closing', documentId: c.id, documentNumber: fy.name, tolerance: 'journal', actorId: actor.userId, lines, remark: `Year-end closing ${fy.name}` });
        await tx.yearEndClosing.update({ where: { id: c.id }, data: { ledgerEntryId: entry?.id ?? null } });
        await this.audit.record(tx, actor, { action: 'create', entityType: 'year_end_closing', entityId: c.id, changes: { year: fy.name, closingAccount: closingAccount.name } });
        return c;
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return { id: closing.id, financialYear: fy.name, periodEnd };
  }

  /**
   * Plan 11 A10 (blueprint 11 process 7): the year's books must be locked up to its last day,
   * and the stock value on that day must equal the stock accounts, store by store.
   */
  private async checkReadyToClose(company: { id: string; lockDate: Date | null }, yearName: string, end: Date) {
    if (!company.lockDate || company.lockDate < end) {
      throw new BadRequestException(`Lock the books up to ${iso(end)} first (Accounts → Lock books), so nothing more can be posted into ${yearName}`);
    }
    const locations = new Map((await this.prisma.stockLocation.findMany({ where: { companyId: company.id }, select: { id: true, storeId: true, kind: true } })).map((l) => [l.id, l]));
    const keyOf = (locationId: string) => {
      const l = locations.get(locationId);
      return l?.kind === 'transit' ? 'transit' : (l?.storeId ?? 'none');
    };
    const stock = new Map<string, Decimal>();
    for (const r of await this.prisma.stockLedgerEntry.groupBy({ by: ['locationId'], where: { companyId: company.id, postingDate: { lte: end } }, _sum: { valueChange: true } })) {
      const k = keyOf(r.locationId);
      stock.set(k, (stock.get(k) ?? new Decimal(0)).add(D(r._sum.valueChange ?? 0)));
    }
    const roles = await this.prisma.accountDefault.findMany({ where: { companyId: company.id, role: { in: ['stock', 'goods_in_transit'] } } });
    const transitId = roles.find((r) => r.role === 'goods_in_transit')?.accountId;
    const books = new Map<string, Decimal>();
    const sums = await this.prisma.ledgerLine.groupBy({ by: ['accountId', 'storeId'], where: { companyId: company.id, accountId: { in: roles.map((r) => r.accountId) }, entryDate: { lte: end } }, _sum: { debit: true, credit: true } });
    for (const s of sums) {
      const k = s.accountId === transitId ? 'transit' : (s.storeId ?? 'none');
      books.set(k, (books.get(k) ?? new Decimal(0)).add(D(s._sum.debit ?? 0)).sub(D(s._sum.credit ?? 0)));
    }
    const stores = new Map((await this.prisma.store.findMany({ where: { companyId: company.id }, select: { id: true, code: true } })).map((s) => [s.id, s.code]));
    const off = [...new Set([...stock.keys(), ...books.keys()])]
      .map((k) => ({ k, diff: (books.get(k) ?? new Decimal(0)).sub(stock.get(k) ?? new Decimal(0)) }))
      .filter((d) => d.diff.abs().gt(new Decimal('0.05')));
    if (off.length) {
      const list = off.map((d) => `${d.k === 'transit' ? 'goods in transit' : (stores.get(d.k) ?? 'no store')}: accounts differ from stock by ₹${d.diff.toFixed(2)}`).join('; ');
      throw new BadRequestException(`The stock value on ${iso(end)} does not match the stock accounts (${list}). Check "Stock against accounts" and close any open till shifts of the year first`);
    }
  }

  /** Allowed only while no later year is closed (blueprint 11 process 7). */
  async cancelClosing(id: string, reason: string, actor: Actor) {
    const company = await this.common.ready();
    const c = await this.prisma.yearEndClosing.findUnique({ where: { id } });
    if (!c || c.companyId !== company.id) throw new NotFoundException('Closing not found');
    if (c.status !== 'posted') throw new BadRequestException('Already cancelled');
    if (await this.prisma.yearEndClosing.count({ where: { companyId: company.id, status: 'posted', periodEnd: { gt: c.periodEnd } } })) throw new BadRequestException('Cancel the later year’s closing first');
    await this.prisma.$transaction(async (tx) => {
      await this.ledger.reverseDocument(tx, 'year_end_closing', id, actor.userId, `Closing cancelled: ${reason}`);
      await tx.yearEndClosing.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'year_end_closing', entityId: id, changes: { status: { old: 'posted', new: 'cancelled' } }, reason });
    });
    return { id };
  }
}
