// Copyright (c) 2026, Rademics. All rights reserved.
// Cash and bank position and the cash flow statement (plan 09 §1.2 and §3),
// read from the ledger (decision 51). Store managers see their own stores'
// cash accounts only; bank accounts belong to the company.
import { Injectable } from '@nestjs/common';
import { type CurrentUser, Decimal, type ReportQuery } from 'shared';
import type { Account } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, fromIso, iso, money, ReportsCommon, ZERO } from './reports-common.service.js';

/** transfers: moves to or from cash and bank accounts the viewer does not see (a store manager's bank deposits). */
export type FlowSection = 'trading' | 'investing' | 'financing' | 'transfers';

@Injectable()
export class MoneyReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: ReportsCommon,
  ) {}

  /** Cash, till and bank accounts the user may see. */
  async cashAccounts(companyId: string, user: CurrentUser, storeId?: string): Promise<Account[]> {
    const scope = this.common.scope(user, storeId);
    const all = await this.prisma.account.findMany({ where: { companyId, isGroup: false, kind: { in: ['cash', 'bank'] } }, orderBy: [{ number: 'asc' }, { name: 'asc' }] });
    if (!scope.ids) return all;
    return all.filter((a) => a.storeId && scope.ids!.includes(a.storeId));
  }

  /** Balances of every cash, till and bank account on a date (blueprint 14 daily list). */
  async cashPosition(q: ReportQuery, user: CurrentUser) {
    this.common.require(user, 'accounts.view');
    const company = await this.common.current();
    const asOf = q.asOf ?? q.to ?? this.common.period(undefined, undefined).to;
    const accounts = await this.cashAccounts(company.id, user, q.storeId);
    const sums = await this.prisma.ledgerLine.groupBy({ by: ['accountId'], where: { accountId: { in: accounts.map((a) => a.id) }, entryDate: { lte: fromIso(asOf) } }, _sum: { debit: true, credit: true } });
    const bal = new Map(sums.map((s) => [s.accountId, D(s._sum.debit).sub(D(s._sum.credit))]));
    const stores = await this.common.stores(company.id);
    let total = ZERO;
    const rows = accounts.map((a) => {
      const b = bal.get(a.id) ?? ZERO;
      total = total.add(b);
      const kind = a.kind === 'bank' ? 'Bank' : a.systemKey?.startsWith('cash_in_till:') ? 'Till' : 'Cash';
      return { accountId: a.id, number: a.number, name: a.name, kind, store: a.storeId ? (stores.get(a.storeId)?.code ?? null) : null, balance: money(b) };
    });
    return { asOf, workedOutAt: new Date().toISOString(), rows, total: money(total) };
  }

  /**
   * Cash flow (plan 09 §3): every movement in a cash, till or bank account,
   * put under the kind of account on the other side of its entry. Moves
   * between the shop's own cash and bank accounts are left out, so
   * opening cash + trading + investing + financing = closing cash.
   */
  async cashFlow(q: ReportQuery, user: CurrentUser) {
    this.common.require(user, 'accounts.view');
    const company = await this.common.current();
    const { from, to } = this.common.period(q.from, q.to, 30);
    const cashAccounts = await this.cashAccounts(company.id, user, q.storeId);
    const cashIds = new Set(cashAccounts.map((a) => a.id));
    const chart = await this.prisma.account.findMany({ where: { companyId: company.id } });
    const byId = new Map(chart.map((a) => [a.id, a]));
    const sectionOf = (a: Account): FlowSection => {
      if (a.kind === 'cash' || a.kind === 'bank') return 'transfers';
      if (a.family === 'equity') return 'financing';
      for (let p: Account | undefined = a; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
        if (p.systemKey === 'fixed_assets' || p.systemKey === 'investments') return 'investing';
        if (p.systemKey === 'loans_overdraft') return 'financing';
      }
      return 'trading';
    };
    const [openingSum, closingSum] = await Promise.all([
      this.prisma.ledgerLine.aggregate({ where: { accountId: { in: [...cashIds] }, entryDate: { lt: fromIso(from) } }, _sum: { debit: true, credit: true } }),
      this.prisma.ledgerLine.aggregate({ where: { accountId: { in: [...cashIds] }, entryDate: { lte: fromIso(to) } }, _sum: { debit: true, credit: true } }),
    ]);
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { companyId: company.id, entryDate: { gte: fromIso(from), lte: fromIso(to) }, lines: { some: { accountId: { in: [...cashIds] } } } },
      include: { lines: true },
    });
    const sections: Record<FlowSection, Map<string, Decimal>> = { trading: new Map(), investing: new Map(), financing: new Map(), transfers: new Map() };
    for (const e of entries) {
      const cash = e.lines.filter((l) => cashIds.has(l.accountId)).reduce((s, l) => s.add(D(l.debit)).sub(D(l.credit)), ZERO);
      if (cash.isZero()) continue;
      // The other side: each account's net in the entry, only those on the opposite side to the cash,
      // weighted by size. A till shift's one entry also holds pairs that are not cash at all (stock
      // against cost of goods, points owed against points expense); they are left out. Found in the
      // launch check of 27 October 2026: cost of goods and stock showed as cash coming in.
      const net = new Map<string, Decimal>();
      for (const l of e.lines) if (!cashIds.has(l.accountId)) net.set(l.accountId, (net.get(l.accountId) ?? ZERO).add(D(l.debit)).sub(D(l.credit)));
      const keyOf = (id: string) => byId.get(id)?.systemKey ?? null;
      const keys = new Set([...net.keys()].map(keyOf));
      const pairs = [['stock', 'cost_of_goods_sold'], ['loyalty_liability', 'loyalty_expense']].filter(([a, b]) => keys.has(a) && keys.has(b)).flat();
      const opposite = [...net.entries()].filter(([id, v]) => !v.isZero() && !pairs.includes(keyOf(id) ?? '') && v.isNegative() === cash.isPositive());
      // Nothing on the other side (rare): share over every account, so the totals still add up.
      const others = opposite.length ? opposite : [...net.entries()].filter(([, v]) => !v.isZero());
      const weight = others.reduce((sum, [, v]) => sum.add(v.abs()), ZERO);
      if (weight.isZero()) continue;
      let left = cash;
      for (const [i, [id, v]] of others.entries()) {
        const share = i === others.length - 1 ? left : cash.mul(v.abs()).div(weight).toDecimalPlaces(2);
        left = left.sub(share);
        const a = byId.get(id)!;
        const m = sections[sectionOf(a)];
        m.set(a.id, (m.get(a.id) ?? ZERO).add(share));
      }
    }
    const section = (s: FlowSection) => {
      const rows = [...sections[s].entries()].map(([id, v]) => ({ accountId: id, name: `${byId.get(id)?.number ?? ''} ${byId.get(id)?.name ?? id}`.trim(), amount: money(v) })).sort((a, b) => D(b.amount).abs().cmp(D(a.amount).abs()));
      return { rows, total: money([...sections[s].values()].reduce((a, v) => a.add(v), ZERO)) };
    };
    const opening = D(openingSum._sum.debit).sub(D(openingSum._sum.credit));
    const closing = D(closingSum._sum.debit).sub(D(closingSum._sum.credit));
    const trading = section('trading');
    const investing = section('investing');
    const financing = section('financing');
    const transfers = section('transfers');
    const net = D(trading.total).add(D(investing.total)).add(D(financing.total)).add(D(transfers.total));
    return { from, to, workedOutAt: new Date().toISOString(), opening: money(opening), trading, investing, financing, transfers, netChange: money(net), closing: money(closing), agrees: opening.add(net).eq(closing) };
  }

  /** Expected cash in the drawers of open till shifts now (store dashboard). */
  async cashInOpenTills(companyId: string, storeIds: string[] | null): Promise<Decimal> {
    const shifts = await this.prisma.shift.findMany({
      where: { companyId, status: 'open', ...(storeIds ? { till: { storeId: { in: storeIds } } } : {}) },
      include: { openingCash: true, cashMovements: true },
    });
    if (!shifts.length) return ZERO;
    const cashMethods = new Set((await this.prisma.paymentMethod.findMany({ where: { companyId, kind: 'cash' }, select: { id: true } })).map((m) => m.id));
    const ids = shifts.map((s) => s.id);
    const payments = await this.prisma.posPayment.aggregate({ where: { paymentMethodId: { in: [...cashMethods] }, bill: { shiftId: { in: ids }, status: 'completed' } }, _sum: { amount: true } });
    const change = await this.prisma.posBill.aggregate({ where: { shiftId: { in: ids }, status: 'completed' }, _sum: { changeAmount: true } });
    let total = D(payments._sum.amount).sub(D(change._sum.changeAmount));
    for (const s of shifts) {
      for (const c of s.openingCash) if (cashMethods.has(c.paymentMethodId)) total = total.add(D(c.amount));
      for (const m of s.cashMovements) total = total.add(D(m.amount).mul(m.direction === 'in' ? 1 : -1));
    }
    return total;
  }

  /** Income and expenses per month from the ledger (accounts dashboard), year-end closing left out. */
  async incomeVsExpenses(companyId: string, from: string, to: string, storeIds: string[] | null) {
    const lines = await this.prisma.ledgerLine.findMany({
      where: { companyId, entryDate: { gte: fromIso(from), lte: fromIso(to) }, account: { family: { in: ['income', 'expense'] } }, entry: { documentType: { not: 'year_end_closing' } }, ...(storeIds ? { storeId: { in: storeIds } } : {}) },
      select: { entryDate: true, debit: true, credit: true, account: { select: { family: true } } },
    });
    const months = new Map<string, { income: Decimal; expenses: Decimal }>();
    for (const l of lines) {
      const m = iso(l.entryDate)!.slice(0, 7);
      const r = months.get(m) ?? { income: ZERO, expenses: ZERO };
      if (l.account.family === 'income') r.income = r.income.add(D(l.credit)).sub(D(l.debit));
      else r.expenses = r.expenses.add(D(l.debit)).sub(D(l.credit));
      months.set(m, r);
    }
    return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, r]) => ({ month, income: money(r.income), expenses: money(r.expenses), net: money(r.income.sub(r.expenses)) }));
  }
}
