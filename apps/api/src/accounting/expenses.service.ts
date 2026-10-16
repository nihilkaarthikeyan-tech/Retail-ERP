// Copyright (c) 2026, Rademics. All rights reserved.
// Simple expense entry for owners without an accountant (plan 11 C8). Behind
// each expense is a normal posted journal of kind "expense": the expense head
// debited with the store as cost centre, the store's cash in hand or a bank
// account credited. It posts when saved; a mistake is cancelled with
// reversing entries on the same date (decision 50, plan 07 answer 3).
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type CurrentUser, Decimal, type ExpenseInput, type ExpenseListQuery } from 'shared';
import { AuditService, type Db } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import type { Account, Prisma } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountingCommon, D, fromIso, iso } from './accounting-common.service.js';

/** Expense accounts the system posts to on its own: not offered as expense heads. */
const NOT_EXPENSE_HEADS = new Set(['stock_adjustment', 'write_off', 'samples_expense', 'shop_use_expense', 'cash_short_over', 'bad_debts']);

const expenseInclude = { lines: { orderBy: { lineNo: 'asc' as const } } } satisfies Prisma.JournalInclude;
type ExpenseRow = Prisma.JournalGetPayload<{ include: typeof expenseInclude }>;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: AccountingCommon,
    private readonly ledger: LedgerService,
  ) {}

  /** What the expense screen offers: the user's stores with their cash in hand, the expense heads and the bank accounts. */
  async options(user: CurrentUser) {
    const company = await this.common.ready();
    const allowed = this.common.storeFilter(user);
    const stores = await this.prisma.store.findMany({ where: { companyId: company.id, active: true, ...(allowed ? { id: { in: allowed } } : {}) }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true } });
    const cash = [];
    for (const s of stores) {
      const a = await this.ledger.accountFor(this.prisma, company.id, { role: 'cash_in_hand', storeId: s.id });
      cash.push({ storeId: s.id, account: this.accountDto(a) });
    }
    const accounts = await this.prisma.account.findMany({ where: { companyId: company.id, isGroup: false, active: true, OR: [{ family: 'expense', kind: 'expense' }, { kind: 'bank' }] }, orderBy: [{ number: 'asc' }, { name: 'asc' }] });
    return {
      stores,
      cashInHand: cash,
      heads: accounts.filter((a) => this.isHead(a)).map((a) => this.accountDto(a)),
      banks: accounts.filter((a) => a.kind === 'bank').map((a) => this.accountDto(a)),
    };
  }

  async list(q: ExpenseListQuery, user: CurrentUser) {
    const company = await this.common.ready();
    const allowed = this.common.storeFilter(user);
    if (q.storeId) this.common.assertStore(user, q.storeId);
    // Line 1 is the expense head with the store; line 2 is where the money came from.
    const headLine: Prisma.JournalLineWhereInput = {
      lineNo: 1,
      ...(q.storeId ? { storeId: q.storeId } : allowed ? { storeId: { in: allowed } } : {}),
      ...(q.expenseAccountId ? { accountId: q.expenseAccountId } : {}),
    };
    const where: Prisma.JournalWhereInput = {
      companyId: company.id,
      kind: 'expense',
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to ? { journalDate: { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } } : {}),
      lines: { some: headLine },
    };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 100;
    const [rows, total, posted] = await Promise.all([
      this.prisma.journal.findMany({ where, include: expenseInclude, orderBy: [{ journalDate: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.journal.count({ where }),
      // The total of every posted expense that matches, not only this page.
      this.prisma.journalLine.aggregate({ where: { ...headLine, journal: { ...where, lines: undefined, status: 'posted' } }, _sum: { debit: true } }),
    ]);
    const names = await this.names(rows);
    return { rows: rows.map((r) => this.dto(r, names)), total, page, pageSize, postedTotal: D(posted._sum.debit ?? 0).toFixed(2) };
  }

  async get(id: string, user: CurrentUser) {
    const row = await this.row(this.prisma, id);
    this.common.assertStore(user, row.lines[0]?.storeId);
    return this.dto(row, await this.names([row]));
  }

  async create(input: ExpenseInput, actor: Actor, user: CurrentUser) {
    const company = await this.common.ready();
    this.common.assertStore(user, input.storeId);
    const store = await this.prisma.store.findFirst({ where: { id: input.storeId, companyId: company.id } });
    if (!store) throw new BadRequestException('Store not found');
    if (!store.active) throw new BadRequestException(`Store ${store.code} is switched off`);
    const head = await this.common.account(this.prisma, company.id, input.expenseAccountId);
    if (!this.isHead(head)) throw new BadRequestException(`${head.name} is not an expense head; choose an expense account such as rent or salaries`);
    if (!head.active) throw new BadRequestException(`${head.name} is switched off`);
    const paidFrom = await this.common.account(this.prisma, company.id, input.paidFromAccountId);
    const cashInHand = await this.ledger.accountFor(this.prisma, company.id, { role: 'cash_in_hand', storeId: store.id });
    if (paidFrom.id !== cashInHand.id && paidFrom.kind !== 'bank') throw new BadRequestException(`An expense is paid from ${store.code}'s cash in hand or from a bank account`);
    if (paidFrom.isGroup || !paidFrom.active) throw new BadRequestException(`${paidFrom.name} is switched off`);
    if (paidFrom.storeId) this.common.assertStore(user, paidFrom.storeId);
    const amount = new Decimal(input.amount);
    const fy = await this.common.yearFor(this.prisma, company.id, input.expenseDate);
    const created = await this.prisma.$transaction(
      async (tx) => {
        const number = await this.common.allocate(tx, company.id, 'expense', input.expenseDate);
        const j = await tx.journal.create({
          data: {
            companyId: company.id,
            kind: 'expense',
            number,
            journalDate: fromIso(input.expenseDate),
            financialYearId: fy.id,
            reference: input.reference ?? null,
            remark: input.remark ?? null,
            status: 'posted',
            postedAt: new Date(),
            postedById: actor.userId,
            createdById: actor.userId,
            updatedById: actor.userId,
            lines: {
              create: [
                { lineNo: 1, accountId: head.id, storeId: store.id, debit: amount.toFixed(2), credit: '0.00', remark: input.remark ?? null },
                { lineNo: 2, accountId: paidFrom.id, storeId: store.id, debit: '0.00', credit: amount.toFixed(2), remark: input.remark ?? null },
              ],
            },
          },
        });
        // The ledger checks the books lock, the open year, locked accounts and wrong-side balances (cash in hand stays debit).
        const entry = await this.ledger.post(tx, {
          companyId: company.id,
          date: input.expenseDate,
          documentType: 'journal',
          documentId: j.id,
          documentNumber: number,
          storeId: store.id,
          tolerance: 'journal',
          actorId: actor.userId,
          remark: input.remark ?? `${head.name} paid from ${paidFrom.name}`,
          lines: [
            { accountId: head.id, storeId: store.id, debit: amount, remark: input.remark ?? null },
            { accountId: paidFrom.id, storeId: store.id, credit: amount, remark: input.remark ?? null },
          ],
        });
        await tx.journal.update({ where: { id: j.id }, data: { ledgerEntryId: entry?.id ?? null } });
        await this.audit.record(tx, actor, {
          action: 'create',
          entityType: 'expense',
          entityId: j.id,
          changes: { number, date: input.expenseDate, store: store.code, head: head.name, paidFrom: paidFrom.name, amount: amount.toFixed(2), reference: input.reference ?? null },
        });
        return this.row(tx, j.id);
      },
      { timeout: 30_000, maxWait: 15_000 },
    );
    return this.dto(created, await this.names([created]));
  }

  /** Cancelling writes equal and opposite entries on the expense's own date; the reason is kept. */
  async cancel(id: string, reason: string, actor: Actor, user: CurrentUser) {
    await this.common.ready();
    const before = await this.row(this.prisma, id);
    this.common.assertStore(user, before.lines[0]?.storeId);
    if (before.status !== 'posted') throw new BadRequestException(`The expense is already ${before.status}`);
    const after = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.journal.updateMany({ where: { id, status: 'posted' }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason, updatedById: actor.userId } });
      if (fresh.count !== 1) throw new BadRequestException('The expense was changed by someone else; reload it');
      await this.ledger.reverseDocument(tx, 'journal', id, actor.userId, `Cancelled: ${reason}`);
      await this.audit.record(tx, actor, { action: 'update', entityType: 'expense', entityId: id, changes: { status: { old: 'posted', new: 'cancelled' }, number: before.number }, reason });
      return this.row(tx, id);
    });
    return this.dto(after, await this.names([after]));
  }

  // ---- Helpers ----

  private isHead(a: Account) {
    return !a.isGroup && a.family === 'expense' && a.kind === 'expense' && !(a.systemKey && NOT_EXPENSE_HEADS.has(a.systemKey));
  }

  private accountDto(a: Account) {
    return { id: a.id, number: a.number, name: a.name, kind: a.kind, storeId: a.storeId, locked: a.locked };
  }

  private async row(db: Db, id: string): Promise<ExpenseRow> {
    const company = await this.common.ready(db);
    const j = await db.journal.findUnique({ where: { id }, include: expenseInclude });
    if (!j || j.companyId !== company.id || j.kind !== 'expense') throw new NotFoundException('Expense not found');
    return j;
  }

  private async names(rows: ExpenseRow[]) {
    const accountIds = [...new Set(rows.flatMap((r) => r.lines.map((l) => l.accountId)))];
    const storeIds = [...new Set(rows.flatMap((r) => r.lines.map((l) => l.storeId)).filter((x): x is string => !!x))];
    const userIds = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
    const [accounts, stores, users] = await Promise.all([
      this.prisma.account.findMany({ where: { id: { in: accountIds } } }),
      this.prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, code: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    return {
      account: new Map(accounts.map((a) => [a.id, a])),
      store: new Map(stores.map((s) => [s.id, s])),
      user: new Map(users.map((u) => [u.id, `${u.firstName}${u.lastName ? ` ${u.lastName}` : ''}`])),
    };
  }

  private dto(j: ExpenseRow, n: Awaited<ReturnType<ExpensesService['names']>>) {
    const head = j.lines.find((l) => D(l.debit).gt(0)) ?? j.lines[0];
    const from = j.lines.find((l) => D(l.credit).gt(0)) ?? j.lines[1];
    const headAccount = head ? n.account.get(head.accountId) : undefined;
    const fromAccount = from ? n.account.get(from.accountId) : undefined;
    const store = head?.storeId ? n.store.get(head.storeId) : undefined;
    return {
      id: j.id,
      number: j.number,
      expenseDate: iso(j.journalDate),
      store: store ?? null,
      expenseAccount: headAccount ? this.accountDto(headAccount) : null,
      paidFrom: fromAccount ? this.accountDto(fromAccount) : null,
      paidFromKind: fromAccount?.kind === 'bank' ? ('bank' as const) : ('cash' as const),
      amount: head ? D(head.debit).toFixed(2) : '0.00',
      reference: j.reference,
      remark: j.remark,
      status: j.status,
      ledgerEntryId: j.ledgerEntryId,
      createdAt: j.createdAt,
      createdBy: j.createdById ? (n.user.get(j.createdById) ?? null) : null,
      cancelledAt: j.cancelledAt,
      cancelReason: j.cancelReason,
    };
  }
}
