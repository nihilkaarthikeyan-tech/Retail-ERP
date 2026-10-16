// Copyright (c) 2026, Rademics. All rights reserved.
// Cash book and bank book (plan 11 C8): for one cash or bank account (or a
// store's cash in hand), day by day — opening, money in, money out, closing —
// with the entries listed a page at a time, as the general ledger does (A4).
// Day totals and balances always come from every line, not only the page shown,
// so the closing balance equals the ledger.
import { BadRequestException, Injectable } from '@nestjs/common';
import { type CashBookQuery, type CurrentUser, Decimal } from 'shared';
import type { Account, Prisma } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountingCommon, D, fromIso, iso } from './accounting-common.service.js';

const money = (d: Decimal) => d.toFixed(2);

@Injectable()
export class CashBookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: AccountingCommon,
    private readonly ledger: LedgerService,
  ) {}

  async cashBook(q: CashBookQuery, user: CurrentUser) {
    const company = await this.common.ready();
    let account: Account;
    if (q.accountId) {
      account = await this.common.account(this.prisma, company.id, q.accountId);
    } else {
      this.common.assertStore(user, q.storeId);
      const store = await this.prisma.store.findFirst({ where: { id: q.storeId, companyId: company.id } });
      if (!store) throw new BadRequestException('Store not found');
      account = await this.ledger.accountFor(this.prisma, company.id, { role: 'cash_in_hand', storeId: store.id });
    }
    if (account.isGroup || (account.kind !== 'cash' && account.kind !== 'bank')) throw new BadRequestException(`${account.name} is not a cash or bank account; a cash book or bank book is kept only for those`);
    // A store's own cash account is seen whole by those allowed in that store; a shared
    // account (a bank) shows store-limited users only their stores' lines (plan 07 §8).
    if (account.storeId) this.common.assertStore(user, account.storeId);
    const allowed = account.storeId ? undefined : this.common.storeFilter(user);
    const scope: Prisma.LedgerLineWhereInput = { companyId: company.id, accountId: account.id, ...(allowed ? { storeId: { in: allowed } } : {}) };
    // Cancelled entries and their cancellations cancel out; they are left out unless asked for, as on the general ledger.
    const where: Prisma.LedgerLineWhereInput = { ...scope, ...(q.includeCancelled ? {} : { entry: { cancelsId: null, cancelledBy: null } }) };
    const inPeriod: Prisma.LedgerLineWhereInput = { ...where, entryDate: { gte: fromIso(q.from), lte: fromIso(q.to) } };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 500;

    const [opening, rows, total, byDay, ledgerClosing] = await Promise.all([
      this.prisma.ledgerLine.aggregate({ where: { ...where, entryDate: { lt: fromIso(q.from) } }, _sum: { debit: true, credit: true } }),
      this.prisma.ledgerLine.findMany({ where: inPeriod, include: { entry: true }, orderBy: [{ entryDate: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.ledgerLine.count({ where: inPeriod }),
      this.prisma.ledgerLine.groupBy({ by: ['entryDate'], where: inPeriod, _sum: { debit: true, credit: true }, _count: { _all: true }, orderBy: { entryDate: 'asc' } }),
      // The account's balance in the ledger on the last day, every line counted: the book must end on it.
      this.prisma.ledgerLine.aggregate({ where: { ...scope, entryDate: { lte: fromIso(q.to) } }, _sum: { debit: true, credit: true } }),
    ]);
    const openingBalance = D(opening._sum.debit ?? 0).sub(D(opening._sum.credit ?? 0));

    // Day by day, from every line of the period.
    let running = openingBalance;
    let moneyIn = new Decimal(0);
    let moneyOut = new Decimal(0);
    const days = byDay.map((d) => {
      const dayIn = D(d._sum.debit ?? 0);
      const dayOut = D(d._sum.credit ?? 0);
      const dayOpening = running;
      running = running.add(dayIn).sub(dayOut);
      moneyIn = moneyIn.add(dayIn);
      moneyOut = moneyOut.add(dayOut);
      return { date: iso(d.entryDate), entries: d._count._all, opening: money(dayOpening), moneyIn: money(dayIn), moneyOut: money(dayOut), closing: money(running) };
    });
    const closing = running;

    // The page's running balance carries on from the lines before it.
    const first = rows[0];
    const before =
      first && page > 1
        ? await this.prisma.ledgerLine.aggregate({
            where: { AND: [inPeriod, { OR: [{ entryDate: { lt: first.entryDate } }, { entryDate: first.entryDate, id: { lt: first.id } }] }] },
            _sum: { debit: true, credit: true },
          })
        : { _sum: { debit: null, credit: null } };
    let balance = openingBalance.add(D(before._sum.debit ?? 0)).sub(D(before._sum.credit ?? 0));
    const pageOpening = balance;

    // What each entry was for: the other accounts in the same entry (rent, sales, a bank…).
    const entryIds = [...new Set(rows.map((r) => r.entryId))];
    const others = await this.prisma.ledgerLine.findMany({ where: { entryId: { in: entryIds }, accountId: { not: account.id } }, select: { entryId: true, accountId: true, partyType: true, partyId: true } });
    const accounts = new Map((await this.prisma.account.findMany({ where: { id: { in: [...new Set(others.map((o) => o.accountId))] } }, select: { id: true, number: true, name: true } })).map((a) => [a.id, a]));
    const partyIds = [...new Set(others.map((o) => o.partyId).filter((x): x is string => !!x))];
    const [customers, suppliers, stores] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: partyIds } }, select: { id: true, name: true } }),
      this.prisma.supplier.findMany({ where: { id: { in: partyIds } }, select: { id: true, name: true } }),
      this.prisma.store.findMany({ where: { companyId: company.id }, select: { id: true, code: true } }),
    ]);
    const partyName = new Map([...customers, ...suppliers].map((p) => [p.id, p.name]));
    const storeCode = new Map(stores.map((s) => [s.id, s.code]));
    const against = new Map<string, string[]>();
    for (const o of others) {
      const list = against.get(o.entryId) ?? [];
      const a = accounts.get(o.accountId);
      const text = o.partyId && partyName.has(o.partyId) ? `${a?.name ?? ''} (${partyName.get(o.partyId)})` : (a?.name ?? '');
      if (text && !list.includes(text)) list.push(text);
      against.set(o.entryId, list);
    }

    const ledger = D(ledgerClosing._sum.debit ?? 0).sub(D(ledgerClosing._sum.credit ?? 0));
    return {
      book: account.kind === 'bank' ? ('bank' as const) : ('cash' as const),
      account: { id: account.id, number: account.number, name: account.name, kind: account.kind, storeId: account.storeId },
      from: q.from,
      to: q.to,
      /** True when a store-limited user sees only their stores' lines of a shared account. */
      limitedToStores: !!allowed,
      opening: money(openingBalance),
      moneyIn: money(moneyIn),
      moneyOut: money(moneyOut),
      closing: money(closing),
      ledgerClosing: money(ledger),
      matchesLedger: closing.eq(ledger),
      days,
      page,
      pageSize,
      total,
      pageOpening: money(pageOpening),
      rows: rows.map((l) => {
        balance = balance.add(D(l.debit)).sub(D(l.credit));
        return {
          id: l.id.toString(),
          date: iso(l.entryDate),
          documentType: l.entry.documentType,
          documentId: l.entry.documentId,
          documentNumber: l.entry.documentNumber,
          against: (against.get(l.entryId) ?? []).join(', '),
          store: l.storeId ? (storeCode.get(l.storeId) ?? null) : null,
          remark: l.remark ?? l.entry.remark,
          moneyIn: money(D(l.debit)),
          moneyOut: money(D(l.credit)),
          balance: money(balance),
          cancelled: !!l.entry.cancelsId,
        };
      }),
    };
  }
}
