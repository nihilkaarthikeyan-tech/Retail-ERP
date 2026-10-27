// Copyright (c) 2026, Rademics. All rights reserved.
// Financial reports from the ledger (blueprint 11 "Reports"; plan 07 §1.8).
// Store managers see only their own stores' lines (plan 07 §8).
import { BadRequestException, Injectable } from '@nestjs/common';
import { ageBand, ageBandLabels, type AsOfQuery, type CurrentUser, Decimal, type LedgerQuery, naturalBalance, type PeriodQuery } from 'shared';
import type { Account, Prisma } from '../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { GiftCardsService } from '../loyalty/gift-cards.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountingCommon, D, fromIso, iso } from './accounting-common.service.js';

const ZERO = new Decimal(0);
const money = (d: Decimal) => d.toFixed(2);

@Injectable()
export class LedgerReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: AccountingCommon,
    private readonly ledger: LedgerService,
    private readonly loyalty: LoyaltyService,
    private readonly giftCards: GiftCardsService,
  ) {}

  /** Lines of entries that are not cancelled and are not cancellations (unless asked for). */
  private liveEntries(includeCancelled: boolean | undefined): Prisma.LedgerLineWhereInput {
    return includeCancelled ? {} : { entry: { cancelsId: null, cancelledBy: null } };
  }

  private storeWhere(user: CurrentUser, storeId: string | undefined): Prisma.LedgerLineWhereInput {
    const allowed = this.common.storeFilter(user);
    if (storeId) {
      this.common.assertStore(user, storeId);
      return { storeId };
    }
    return allowed ? { storeId: { in: allowed } } : {};
  }

  private async accounts(companyId: string) {
    const list = await this.prisma.account.findMany({ where: { companyId }, orderBy: [{ number: 'asc' }, { name: 'asc' }] });
    return { list, byId: new Map(list.map((a) => [a.id, a])) };
  }

  private descendants(list: Account[], rootId: string): string[] {
    const out = [rootId];
    for (let i = 0; i < out.length; i++) for (const a of list) if (a.parentId === out[i]) out.push(a.id);
    return out;
  }

  private async names(lines: { partyType: string | null; partyId: string | null; storeId: string | null }[]) {
    const customerIds = [...new Set(lines.filter((l) => l.partyType === 'customer' && l.partyId).map((l) => l.partyId!))];
    const supplierIds = [...new Set(lines.filter((l) => l.partyType === 'supplier' && l.partyId).map((l) => l.partyId!))];
    const storeIds = [...new Set(lines.map((l) => l.storeId).filter((x): x is string => !!x))];
    const [customers, suppliers, stores] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, code: true, name: true } }),
      this.prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, code: true, name: true } }),
      this.prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, code: true } }),
    ]);
    const party = new Map([...customers, ...suppliers].map((p) => [p.id, `${p.name}`]));
    const store = new Map(stores.map((s) => [s.id, s.code]));
    return { party: (id: string | null) => (id ? (party.get(id) ?? null) : null), store: (id: string | null) => (id ? (store.get(id) ?? null) : null) };
  }

  // ---- General ledger ----

  async generalLedger(q: LedgerQuery, user: CurrentUser) {
    const company = await this.common.ready();
    const { list, byId } = await this.accounts(company.id);
    const where: Prisma.LedgerLineWhereInput = {
      companyId: company.id,
      ...this.storeWhere(user, q.storeId),
      ...this.liveEntries(q.includeCancelled),
      ...(q.accountId ? { accountId: { in: this.descendants(list, q.accountId) } } : {}),
      ...(q.partyId ? { partyId: q.partyId, ...(q.partyType ? { partyType: q.partyType } : {}) } : {}),
      ...(q.documentId ? { entry: { documentId: q.documentId, ...(q.documentType ? { documentType: q.documentType } : {}) } } : {}),
    };
    const opening = q.from
      ? await this.prisma.ledgerLine.aggregate({ where: { ...where, entryDate: { lt: fromIso(q.from) } }, _sum: { debit: true, credit: true } })
      : { _sum: { debit: null, credit: null } };
    const inPeriod: Prisma.LedgerLineWhereInput = { ...where, ...(q.from || q.to ? { entryDate: { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } } : {}) };
    // Plan 11 A4: page through every line; totals and balances always come from all of them.
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 1000;
    const [rows, total, period] = await Promise.all([
      this.prisma.ledgerLine.findMany({ where: inPeriod, include: { entry: true }, orderBy: [{ entryDate: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.ledgerLine.count({ where: inPeriod }),
      this.prisma.ledgerLine.aggregate({ where: inPeriod, _sum: { debit: true, credit: true } }),
    ]);
    const openingBalance = D(opening._sum.debit ?? 0).sub(D(opening._sum.credit ?? 0));
    // The lines of the period before this page, so the running balance carries on from the previous page.
    const first = rows[0];
    const before =
      first && page > 1
        ? await this.prisma.ledgerLine.aggregate({
            where: { AND: [inPeriod, { OR: [{ entryDate: { lt: first.entryDate } }, { entryDate: first.entryDate, id: { lt: first.id } }] }] },
            _sum: { debit: true, credit: true },
          })
        : { _sum: { debit: null, credit: null } };
    let running = openingBalance.add(D(before._sum.debit ?? 0)).sub(D(before._sum.credit ?? 0));
    const pageOpening = running;
    const n = await this.names(rows);
    const debit = D(period._sum.debit ?? 0);
    const credit = D(period._sum.credit ?? 0);
    return {
      opening: money(openingBalance),
      pageOpening: money(pageOpening),
      page,
      pageSize,
      total,
      rows: rows.map((l) => {
        running = running.add(D(l.debit)).sub(D(l.credit));
        const a = byId.get(l.accountId)!;
        return {
          id: l.id.toString(),
          date: iso(l.entryDate),
          account: this.common.accountName(a),
          accountId: a.id,
          documentType: l.entry.documentType,
          documentId: l.entry.documentId,
          documentNumber: l.entry.documentNumber,
          party: n.party(l.partyId),
          partyType: l.partyType,
          store: n.store(l.storeId),
          debit: money(D(l.debit)),
          credit: money(D(l.credit)),
          balance: money(running),
          remark: l.remark ?? l.entry.remark,
          cancelled: !!l.entry.cancelsId,
        };
      }),
      totals: { debit: money(debit), credit: money(credit), closing: money(openingBalance.add(debit).sub(credit)) },
    };
  }

  /** Every entry in a period with its lines (the day book). */
  async dayBook(q: PeriodQuery, user: CurrentUser) {
    const company = await this.common.ready();
    const { byId } = await this.accounts(company.id);
    const allowed = this.common.storeFilter(user);
    const where: Prisma.LedgerEntryWhereInput = { companyId: company.id, entryDate: { gte: fromIso(q.from), lte: fromIso(q.to) }, ...(q.storeId ? { storeId: q.storeId } : allowed ? { storeId: { in: allowed } } : {}) };
    // Plan 11 A4: every entry, a page at a time, never cut off silently.
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 500;
    const [entries, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where, include: { lines: true }, orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.ledgerEntry.count({ where }),
    ]);
    const n = await this.names(entries.flatMap((e) => e.lines));
    const rows = entries.map((e) => ({
      id: e.id,
      date: iso(e.entryDate),
      documentType: e.documentType,
      documentId: e.documentId,
      documentNumber: e.documentNumber,
      store: n.store(e.storeId),
      remark: e.remark,
      isCancellation: !!e.cancelsId,
      lines: e.lines.map((l) => ({ account: this.common.accountName(byId.get(l.accountId)!), party: n.party(l.partyId), store: n.store(l.storeId), debit: money(D(l.debit)), credit: money(D(l.credit)), remark: l.remark })),
    }));
    return { rows, total, page, pageSize };
  }

  /** The ledger entries of one document (the "View ledger entry" link on every document). */
  async forDocument(documentType: string, documentId: string, user: CurrentUser) {
    const company = await this.common.ready();
    const { byId } = await this.accounts(company.id);
    const entries = await this.prisma.ledgerEntry.findMany({ where: { companyId: company.id, documentType, documentId }, include: { lines: true }, orderBy: { createdAt: 'asc' } });
    for (const e of entries) this.common.assertStore(user, e.storeId);
    const n = await this.names(entries.flatMap((e) => e.lines));
    return entries.map((e) => ({
      id: e.id,
      date: iso(e.entryDate),
      documentNumber: e.documentNumber,
      remark: e.remark,
      cancels: e.cancelsId,
      lines: e.lines.map((l) => ({ account: this.common.accountName(byId.get(l.accountId)!), party: n.party(l.partyId), store: n.store(l.storeId), debit: money(D(l.debit)), credit: money(D(l.credit)), remark: l.remark })),
    }));
  }

  // ---- Trial balance, profit and loss, balance sheet ----

  async trialBalance(q: PeriodQuery, user: CurrentUser) {
    const company = await this.common.ready();
    const { list } = await this.accounts(company.id);
    const base: Prisma.LedgerLineWhereInput = { companyId: company.id, ...this.storeWhere(user, q.storeId) };
    const [before, during] = await Promise.all([
      this.prisma.ledgerLine.groupBy({ by: ['accountId'], where: { ...base, entryDate: { lt: fromIso(q.from) } }, _sum: { debit: true, credit: true } }),
      this.prisma.ledgerLine.groupBy({ by: ['accountId'], where: { ...base, entryDate: { gte: fromIso(q.from), lte: fromIso(q.to) } }, _sum: { debit: true, credit: true } }),
    ]);
    const opening = new Map(before.map((s) => [s.accountId, D(s._sum.debit ?? 0).sub(D(s._sum.credit ?? 0))]));
    const period = new Map(during.map((s) => [s.accountId, { dr: D(s._sum.debit ?? 0), cr: D(s._sum.credit ?? 0) }]));
    const totals = { openingDebit: ZERO, openingCredit: ZERO, debit: ZERO, credit: ZERO, closingDebit: ZERO, closingCredit: ZERO };
    const rows = [];
    for (const a of list.filter((x) => !x.isGroup)) {
      // Income and expenses start each financial year at zero only through the year-end closing entry.
      const o = opening.get(a.id) ?? ZERO;
      const p = period.get(a.id) ?? { dr: ZERO, cr: ZERO };
      const c = o.add(p.dr).sub(p.cr);
      if (!q.showZero && o.isZero() && p.dr.isZero() && p.cr.isZero()) continue;
      const side = (v: Decimal) => ({ debit: v.gt(0) ? v : ZERO, credit: v.lt(0) ? v.neg() : ZERO });
      const os = side(o);
      const cs = side(c);
      totals.openingDebit = totals.openingDebit.add(os.debit);
      totals.openingCredit = totals.openingCredit.add(os.credit);
      totals.debit = totals.debit.add(p.dr);
      totals.credit = totals.credit.add(p.cr);
      totals.closingDebit = totals.closingDebit.add(cs.debit);
      totals.closingCredit = totals.closingCredit.add(cs.credit);
      rows.push({ accountId: a.id, number: a.number, name: a.name, family: a.family, openingDebit: money(os.debit), openingCredit: money(os.credit), debit: money(p.dr), credit: money(p.cr), closingDebit: money(cs.debit), closingCredit: money(cs.credit) });
    }
    return { rows, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, money(v)])), balanced: totals.debit.eq(totals.credit) && totals.closingDebit.eq(totals.closingCredit) };
  }

  /** Income, expenses and net profit, by month or for the whole period, for one store or all (decision 52). */
  async profitAndLoss(q: PeriodQuery, user: CurrentUser) {
    const company = await this.common.ready();
    const { list, byId } = await this.accounts(company.id);
    const lines = await this.prisma.ledgerLine.findMany({
      where: {
        companyId: company.id,
        ...this.storeWhere(user, q.storeId),
        entryDate: { gte: fromIso(q.from), lte: fromIso(q.to) },
        account: { family: { in: ['income', 'expense'] } },
        // The year-end closing entry is left out so the year's figures still show.
        entry: { documentType: { not: 'year_end_closing' } },
      },
      select: { accountId: true, entryDate: true, debit: true, credit: true },
    });
    const periodOf = (d: Date) => (q.groupBy === 'month' ? iso(d)!.slice(0, 7) : 'total');
    const periods = q.groupBy === 'month' ? [...new Set(lines.map((l) => periodOf(l.entryDate)))].sort() : ['total'];
    const amounts = new Map<string, Map<string, Decimal>>();
    for (const l of lines) {
      const a = byId.get(l.accountId)!;
      const v = naturalBalance(a.family, l.debit.toString(), l.credit.toString());
      const per = amounts.get(a.id) ?? new Map<string, Decimal>();
      const p = periodOf(l.entryDate);
      per.set(p, (per.get(p) ?? ZERO).add(v));
      amounts.set(a.id, per);
    }
    const section = (family: 'income' | 'expense') => {
      const rows = list
        .filter((a) => a.family === family && !a.isGroup && amounts.has(a.id))
        .map((a) => ({ accountId: a.id, number: a.number, name: a.name, amounts: Object.fromEntries(periods.map((p) => [p, money(amounts.get(a.id)!.get(p) ?? ZERO)])), total: money([...amounts.get(a.id)!.values()].reduce((s, v) => s.add(v), ZERO)) }));
      const totals = Object.fromEntries(periods.map((p) => [p, money(rows.reduce((s, r) => s.add(D(r.amounts[p])), ZERO))]));
      return { rows, totals, total: money(rows.reduce((s, r) => s.add(D(r.total)), ZERO)) };
    };
    const income = section('income');
    const expenses = section('expense');
    const net = Object.fromEntries(periods.map((p) => [p, money(D(income.totals[p]).sub(D(expenses.totals[p])))]));
    return { periods, income, expenses, net, netTotal: money(D(income.total).sub(D(expenses.total))) };
  }

  /** Assets, liabilities and capital on a date, with this year's profit so far. */
  async balanceSheet(q: AsOfQuery, user: CurrentUser) {
    const company = await this.common.ready();
    const { list } = await this.accounts(company.id);
    const sums = await this.prisma.ledgerLine.groupBy({ by: ['accountId'], where: { companyId: company.id, ...this.storeWhere(user, q.storeId), entryDate: { lte: fromIso(q.asOf) } }, _sum: { debit: true, credit: true } });
    const bal = new Map(sums.map((s) => [s.accountId, D(s._sum.debit ?? 0).sub(D(s._sum.credit ?? 0))]));
    const family = (f: 'asset' | 'liability' | 'equity') => {
      const rows = list.filter((a) => a.family === f && !a.isGroup && !(bal.get(a.id) ?? ZERO).isZero()).map((a) => ({ accountId: a.id, number: a.number, name: a.name, kind: a.kind, amount: money(naturalBalance(f, (bal.get(a.id) ?? ZERO).toString(), '0')) }));
      return { rows, total: money(rows.reduce((s, r) => s.add(D(r.amount)), ZERO)) };
    };
    const profit = list.filter((a) => a.family === 'income' || a.family === 'expense').reduce((s, a) => s.sub(bal.get(a.id) ?? ZERO), ZERO);
    const assets = family('asset');
    const liabilities = family('liability');
    const equity = family('equity');
    const totalCapital = D(equity.total).add(profit);
    return {
      asOf: q.asOf,
      assets,
      liabilities,
      equity,
      profitNotClosed: money(profit),
      totalLiabilitiesAndCapital: money(D(liabilities.total).add(totalCapital)),
      balanced: D(assets.total).eq(D(liabilities.total).add(totalCapital)),
    };
  }

  // ---- Customers and suppliers ----

  async partyStatement(partyType: 'customer' | 'supplier', partyId: string, q: { from?: string; to?: string }, user: CurrentUser) {
    const company = await this.common.ready();
    const gl = await this.generalLedger({ partyType, partyId, from: q.from, to: q.to, includeCancelled: false, pageSize: 100_000 }, user);
    const sign = partyType === 'customer' ? 1 : -1;
    const flip = (v: string) => money(D(v).mul(sign));
    const items = await this.ledger.openItems(this.prisma, partyType, partyId);
    void company;
    return {
      opening: flip(gl.opening),
      rows: gl.rows.map((r) => ({ ...r, balance: flip(r.balance) })),
      closing: flip(gl.totals.closing),
      openItems: items.map((i) => ({ itemType: i.itemType, itemId: i.itemId, number: i.number, date: i.date, dueDate: i.dueDate, amount: money(i.amount), owed: money(i.owed) })),
    };
  }

  /** Unpaid bills by age band (blueprint 11 "Age band"). */
  async ageing(q: AsOfQuery, user: CurrentUser) {
    const company = await this.common.ready();
    const partyType = q.partyType ?? 'customer';
    const settings = await this.prisma.accountingSettings.findUnique({ where: { companyId: company.id } });
    const bands = settings?.ageingBands?.length ? settings.ageingBands : [30, 60, 90, 120];
    const labels = ageBandLabels(bands);
    const allowed = this.common.storeFilter(user);
    const parties = await this.prisma.ledgerLine.groupBy({
      by: ['partyId'],
      where: { companyId: company.id, partyType, partyId: { not: null }, entryDate: { lte: fromIso(q.asOf) }, ...(q.storeId ? { storeId: q.storeId } : allowed ? { storeId: { in: allowed } } : {}) },
    });
    const n = await this.names(parties.map((p) => ({ partyType, partyId: p.partyId, storeId: null })));
    const rows = [];
    const totals = new Map(labels.map((l) => [l, ZERO]));
    let unused = ZERO;
    for (const p of parties) {
      const items = await this.ledger.openItems(this.prisma, partyType, p.partyId!, q.asOf);
      if (!items.length) continue;
      const byBand = new Map(labels.map((l) => [l, ZERO]));
      let advance = ZERO;
      for (const i of items) {
        if (i.owed.lt(0)) {
          advance = advance.add(i.owed);
          continue;
        }
        const band = ageBand(i.dueDate ?? i.date, q.asOf, bands);
        byBand.set(band, byBand.get(band)!.add(i.owed));
        totals.set(band, totals.get(band)!.add(i.owed));
      }
      unused = unused.add(advance);
      const owed = [...byBand.values()].reduce((s, v) => s.add(v), ZERO);
      rows.push({ partyId: p.partyId, name: n.party(p.partyId), bands: Object.fromEntries([...byBand].map(([k, v]) => [k, money(v)])), owed: money(owed), unused: money(advance.neg()), net: money(owed.add(advance)) });
    }
    rows.sort((a, b) => D(b.owed).cmp(D(a.owed)));
    return { asOf: q.asOf, partyType, labels, rows, totals: Object.fromEntries([...totals].map(([k, v]) => [k, money(v)])), unused: money(unused.neg()) };
  }

  // ---- Checks ----

  /** Stock value per store against the stock account (accounting effects map check 5). */
  async stockVsAccounts(user: CurrentUser) {
    const company = await this.common.ready();
    const allowed = this.common.storeFilter(user);
    const positions = await this.prisma.stockPosition.findMany({ where: { companyId: company.id }, select: { value: true, locationId: true } });
    const locations = new Map((await this.prisma.stockLocation.findMany({ where: { companyId: company.id }, select: { id: true, storeId: true, kind: true } })).map((l) => [l.id, l]));
    const stockValue = new Map<string, Decimal>();
    for (const p of positions) {
      const loc = locations.get(p.locationId);
      const k = loc?.kind === 'transit' ? 'transit' : (loc?.storeId ?? 'none');
      stockValue.set(k, (stockValue.get(k) ?? ZERO).add(D(p.value)));
    }
    const stockAcc = await this.prisma.accountDefault.findMany({ where: { companyId: company.id, role: { in: ['stock', 'goods_in_transit'] } } });
    const stockId = stockAcc.find((a) => a.role === 'stock')?.accountId;
    const transitId = stockAcc.find((a) => a.role === 'goods_in_transit')?.accountId;
    const sums = await this.prisma.ledgerLine.groupBy({ by: ['accountId', 'storeId'], where: { companyId: company.id, accountId: { in: [stockId, transitId].filter((x): x is string => !!x) } }, _sum: { debit: true, credit: true } });
    const books = new Map<string, Decimal>();
    for (const s of sums) {
      const k = s.accountId === transitId ? 'transit' : (s.storeId ?? 'none');
      books.set(k, (books.get(k) ?? ZERO).add(D(s._sum.debit ?? 0)).sub(D(s._sum.credit ?? 0)));
    }
    const stores = await this.prisma.store.findMany({ where: { companyId: company.id }, select: { id: true, code: true, name: true } });
    const keys = [...new Set([...stockValue.keys(), ...books.keys()])].filter((k) => k === 'transit' || k === 'none' || !allowed || allowed.includes(k));
    const rows = keys.map((k) => {
      const s = stores.find((x) => x.id === k);
      const v = stockValue.get(k) ?? ZERO;
      const b = books.get(k) ?? ZERO;
      return { key: k, name: k === 'transit' ? 'Goods in transit' : k === 'none' ? 'No store' : `${s?.code} — ${s?.name}`, stockValue: money(v), accounts: money(b), difference: money(b.sub(v)) };
    });
    return { rows, ok: rows.every((r) => D(r.difference).isZero()) };
  }

  /** The ledger agrees with itself: debits equal credits, and each party's balance equals their open items. */
  async bookHealth() {
    const company = await this.common.ready();
    const problems: string[] = [];
    const total = await this.prisma.ledgerLine.aggregate({ where: { companyId: company.id }, _sum: { debit: true, credit: true } });
    const dr = D(total._sum.debit ?? 0);
    const cr = D(total._sum.credit ?? 0);
    if (!dr.eq(cr)) problems.push(`Total debits ₹${money(dr)} and credits ₹${money(cr)} differ`);
    const parties = await this.prisma.ledgerLine.groupBy({ by: ['partyType', 'partyId'], where: { companyId: company.id, partyId: { not: null } } });
    let checked = 0;
    for (const p of parties) {
      const type = p.partyType as 'customer' | 'supplier';
      const balance = await this.ledger.partyBalance(this.prisma, type, p.partyId!);
      const items = await this.ledger.openItems(this.prisma, type, p.partyId!);
      const open = items.reduce((s, i) => s.add(i.owed), ZERO);
      // Party lines without an open item (none expected) would show here as a difference.
      if (!balance.eq(open)) problems.push(`${type} ${p.partyId}: ledger balance ₹${money(balance)} but open items ₹${money(open)}`);
      checked++;
    }
    const clearing = await this.prisma.accountDefault.findUnique({ where: { companyId_role: { companyId: company.id, role: 'stock_transfer_clearing' } } });
    if (clearing) {
      const s = await this.prisma.ledgerLine.aggregate({ where: { accountId: clearing.accountId }, _sum: { debit: true, credit: true } });
      const b = D(s._sum.debit ?? 0).sub(D(s._sum.credit ?? 0));
      if (!b.isZero()) problems.push(`Stock transfer clearing is ₹${money(b)}, not zero`);
    }
    // Plan 13: the points liability equals points held × point value; the gift card liability equals the cards' balances.
    problems.push(...(await this.loyalty.liabilityProblems()), ...(await this.giftCards.liabilityProblems()));
    return { totalDebit: money(dr), totalCredit: money(cr), partiesChecked: checked, problems, ok: problems.length === 0 };
  }

  assertPeriod(q: PeriodQuery) {
    if (q.from > q.to) throw new BadRequestException('The start date is after the end date');
  }
}
