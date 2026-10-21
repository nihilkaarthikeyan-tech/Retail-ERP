// Copyright (c) 2026, Rademics. All rights reserved.
// Sales reports (plan 09 §1.2; blueprint 14 daily and weekly lists). Sales are
// read from the till bills, so they are current before a shift closes; returns
// count on the day they happen; cancelled bills are left out. Net sales are
// before GST. Cost is the stock value that left for each line (the cost at the
// time of sale plus later corrections), so margins agree with the accounts.
import { Injectable } from '@nestjs/common';
import { averageBill, type CurrentUser, Decimal, grossMarginPercent, itemsPerBill, type ReportQuery } from 'shared';
import { Prisma } from '../generated/prisma/client.js';
import { assertModuleOn } from '../modules/module-map.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, fromIso, iso, money, pctText, qty, ReportsCommon, type StoreScope, ZERO } from './reports-common.service.js';

export interface SaleLineRow {
  lineId: string;
  billId: string;
  number: string;
  kind: 'sale' | 'return';
  businessDate: Date;
  soldAt: Date;
  storeId: string;
  cashierId: string;
  customerId: string;
  itemId: string;
  itemGroupId: string;
  brandId: string | null;
  quantity: Prisma.Decimal;
  basicQuantity: Prisma.Decimal;
  listPrice: Prisma.Decimal;
  price: Prisma.Decimal;
  discountPercent: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  offerDiscount: Prisma.Decimal;
  offerId: string | null;
  isFree: boolean;
  taxableAmount: Prisma.Decimal;
  tax: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  approvedById: string | null;
  cost: Prisma.Decimal | null;
}

interface Totals {
  saleBills: number;
  returnBills: number;
  quantity: Decimal;
  grossSales: Decimal;
  returns: Decimal;
  net: Decimal;
  tax: Decimal;
  discounts: Decimal;
  cost: Decimal;
}

const emptyTotals = (): Totals => ({ saleBills: 0, returnBills: 0, quantity: ZERO, grossSales: ZERO, returns: ZERO, net: ZERO, tax: ZERO, discounts: ZERO, cost: ZERO });

@Injectable()
export class SalesReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: ReportsCommon,
  ) {}

  /** Every completed till bill line in a period, with its cost from the stock records. */
  async lines(companyId: string, from: string, to: string, scope: StoreScope, q: Partial<ReportQuery> = {}): Promise<SaleLineRow[]> {
    const conds: Prisma.Sql[] = [];
    if (scope.ids) conds.push(scope.ids.length ? Prisma.sql`AND t."storeId" IN (${Prisma.join(scope.ids.map((s) => Prisma.sql`${s}::uuid`))})` : Prisma.sql`AND false`);
    if (q.itemId) conds.push(Prisma.sql`AND l."itemId" = ${q.itemId}::uuid`);
    if (q.itemGroupId) conds.push(Prisma.sql`AND i."itemGroupId" = ${q.itemGroupId}::uuid`);
    if (q.brandId) conds.push(Prisma.sql`AND i."brandId" = ${q.brandId}::uuid`);
    if (q.customerId) conds.push(Prisma.sql`AND b."customerId" = ${q.customerId}::uuid`);
    if (q.cashierId) conds.push(Prisma.sql`AND b."cashierId" = ${q.cashierId}::uuid`);
    if (q.tillId) conds.push(Prisma.sql`AND b."tillId" = ${q.tillId}::uuid`);
    // Plan 11 C4: a variant without its own season takes its style's.
    if (q.seasonId) conds.push(Prisma.sql`AND COALESCE(i."seasonId", (SELECT p."seasonId" FROM "Item" p WHERE p.id = i."parentItemId")) = ${q.seasonId}::uuid`);
    return this.prisma.$queryRaw<SaleLineRow[]>`
      SELECT l.id AS "lineId", l."billId", b.number, b.kind::text AS kind, b."businessDate", b."soldAt", t."storeId", b."cashierId", b."customerId",
             l."itemId", i."itemGroupId", i."brandId", l.quantity, l."basicQuantity", l."listPrice", l.price, l."discountPercent",
             l."discountAmount", l."offerDiscount", l."offerId", l."isFree", l."taxableAmount", (l.cgst + l.sgst + l.igst) AS tax, l."lineTotal",
             l."approvedById",
             (SELECT -SUM(e."valueChange") FROM "StockLedgerEntry" e WHERE e."documentLineId" = l.id AND e."documentType" = 'pos_bill') AS cost
      FROM "PosBillLine" l
      JOIN "PosBill" b ON b.id = l."billId"
      JOIN "Till" t ON t.id = b."tillId"
      JOIN "Item" i ON i.id = l."itemId"
      WHERE b."companyId" = ${companyId}::uuid AND b.status = 'completed'
        AND b."businessDate" BETWEEN ${fromIso(from)} AND ${fromIso(to)}
        ${conds.length ? Prisma.join(conds, ' ') : Prisma.empty}
      ORDER BY b."soldAt", l."lineNo"`;
  }

  private add(t: Totals, l: SaleLineRow) {
    const taxable = D(l.taxableAmount);
    t.net = t.net.add(taxable);
    t.tax = t.tax.add(D(l.tax));
    t.cost = t.cost.add(D(l.cost));
    if (l.kind === 'sale') {
      t.grossSales = t.grossSales.add(taxable);
      t.quantity = t.quantity.add(D(l.basicQuantity));
      // A line's discount already includes its offer saving and its share of the bill discount.
      t.discounts = t.discounts.add(D(l.discountAmount));
    } else {
      t.returns = t.returns.add(taxable);
    }
  }

  private totalsDto(t: Totals, seesCost: boolean) {
    return {
      saleBills: t.saleBills,
      returnBills: t.returnBills,
      quantity: qty(t.quantity),
      grossSales: money(t.grossSales),
      returns: money(t.returns),
      netSales: money(t.net),
      tax: money(t.tax),
      discounts: money(t.discounts),
      averageBill: money(averageBill(t.net, t.saleBills)),
      itemsPerBill: itemsPerBill(t.quantity, t.saleBills).toFixed(2),
      ...(seesCost ? { cost: money(t.cost), grossProfit: money(t.net.sub(t.cost)), marginPercent: pctText(grossMarginPercent(t.net, t.cost)) } : {}),
    };
  }

  /** Daily sales by store (blueprint 14): bills, quantity, net sales, tax, discounts, returns, average bill. */
  async dailySales(q: ReportQuery, user: CurrentUser) {
    this.common.require(user, 'pos.reports');
    const company = await this.common.current();
    const { from, to } = this.common.period(q.from, q.to);
    const scope = this.common.scope(user, q.storeId);
    const seesCost = this.common.seesCost(user);
    const lines = await this.lines(company.id, from, to, scope);
    const bills = await this.prisma.posBill.groupBy({
      by: ['businessDate', 'kind', 'tillId'],
      where: { companyId: company.id, status: 'completed', businessDate: { gte: fromIso(from), lte: fromIso(to) }, ...(scope.ids ? { till: { storeId: { in: scope.ids } } } : {}) },
      _count: { _all: true },
    });
    const tillStore = new Map((await this.prisma.till.findMany({ where: { companyId: company.id }, select: { id: true, storeId: true } })).map((t) => [t.id, t.storeId]));
    const stores = await this.common.stores(company.id);
    const groups = new Map<string, Totals>();
    const key = (date: string, store: string) => `${date}|${store}`;
    const get = (k: string) => groups.get(k) ?? (groups.set(k, emptyTotals()), groups.get(k)!);
    for (const b of bills) {
      const t = get(key(iso(b.businessDate)!, tillStore.get(b.tillId)!));
      if (b.kind === 'sale') t.saleBills += b._count._all;
      else t.returnBills += b._count._all;
    }
    for (const l of lines) this.add(get(key(iso(l.businessDate)!, l.storeId)), l);
    const total = emptyTotals();
    const rows = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, t]) => {
        const [date, storeId] = k.split('|');
        total.saleBills += t.saleBills;
        total.returnBills += t.returnBills;
        for (const f of ['quantity', 'grossSales', 'returns', 'net', 'tax', 'discounts', 'cost'] as const) total[f] = total[f].add(t[f]);
        const s = stores.get(storeId);
        return { date, storeId, store: s ? `${s.code} — ${s.name}` : storeId, ...this.totalsDto(t, seesCost) };
      });
    return { from, to, workedOutAt: new Date().toISOString(), rows, totals: this.totalsDto(total, seesCost) };
  }

  /**
   * Item-wise sales, grouped by item, group, brand, customer, store or cashier.
   * The same rows ranked give the best and worst sellers and the gross profit report.
   */
  async grouped(q: ReportQuery, user: CurrentUser, defaultGroup: NonNullable<ReportQuery['groupBy']> = 'item') {
    this.common.require(user, 'pos.reports');
    const company = await this.common.current();
    const { from, to } = this.common.period(q.from, q.to);
    const scope = this.common.scope(user, q.storeId);
    const seesCost = this.common.seesCost(user);
    const by = q.groupBy ?? defaultGroup;
    // Plan 12: grouping by style or size and colour, or by season, belongs to those optional modules.
    if (by === 'style' || by === 'attribute') await assertModuleOn(this.prisma, 'variants');
    if (by === 'season' || q.seasonId) await assertModuleOn(this.prisma, 'seasons');
    const lines = await this.lines(company.id, from, to, scope, q);
    // Plan 11 C3, C4: style, size or colour, and season come from the item's style and values.
    const styled = by === 'style' || by === 'attribute' || by === 'season' ? await this.styleKeys([...new Set(lines.map((l) => l.itemId))], q.attributeId) : null;
    const keyOf = (l: SaleLineRow) =>
      styled
        ? styled.get(l.itemId)![by as 'style' | 'attribute' | 'season']
        : by === 'item' ? l.itemId : by === 'group' ? l.itemGroupId : by === 'brand' ? (l.brandId ?? 'none') : by === 'customer' ? l.customerId : by === 'store' ? l.storeId : by === 'cashier' ? l.cashierId : iso(l.businessDate)!;
    const groups = new Map<string, Totals & { bills: Set<string> }>();
    for (const l of lines) {
      const k = keyOf(l);
      const t = groups.get(k) ?? { ...emptyTotals(), bills: new Set<string>() };
      this.add(t, l);
      if (l.kind === 'sale') t.bills.add(l.billId);
      groups.set(k, t);
    }
    const names = await this.namesFor(by, [...groups.keys()], company.id);
    const total = emptyTotals();
    const rows = [...groups.entries()].map(([k, t]) => {
      t.saleBills = t.bills.size;
      for (const f of ['quantity', 'grossSales', 'returns', 'net', 'tax', 'discounts', 'cost'] as const) total[f] = total[f].add(t[f]);
      return { key: k, ...names(k), ...this.totalsDto(t, seesCost), _q: t.quantity, _net: t.net, _margin: t.net.sub(t.cost) };
    });
    total.saleBills = new Set(lines.filter((l) => l.kind === 'sale').map((l) => l.billId)).size;
    return { from, to, groupBy: by, workedOutAt: new Date().toISOString(), rows, totals: this.totalsDto(total, seesCost), seesCost };
  }

  async itemSales(q: ReportQuery, user: CurrentUser) {
    const r = await this.grouped(q, user, 'item');
    r.rows.sort((a, b) => b._net.cmp(a._net));
    return { ...r, rows: r.rows.map(strip) };
  }

  /** Best and worst sellers (decision 66): ranked by quantity, sales or margin. */
  async bestSellers(q: ReportQuery, user: CurrentUser) {
    const r = await this.grouped({ ...q, groupBy: q.groupBy ?? 'item' }, user, 'item');
    const rankBy = q.rankBy === 'margin' && !r.seesCost ? 'sales' : (q.rankBy ?? 'sales');
    const value = (row: (typeof r.rows)[number]) => (rankBy === 'quantity' ? row._q : rankBy === 'margin' ? row._margin : row._net);
    const sorted = [...r.rows].sort((a, b) => (q.worst ? value(a).cmp(value(b)) : value(b).cmp(value(a))));
    const limit = q.limit ?? 20;
    return { ...r, rankBy, worst: !!q.worst, rows: sorted.slice(0, limit).map((row, i) => ({ rank: i + 1, ...strip(row) })) };
  }

  /** Gross profit by item, group, brand, customer or store (blueprint 14 monthly list). */
  async grossProfit(q: ReportQuery, user: CurrentUser) {
    this.common.require(user, 'cost_price.view', 'stock.cost.view');
    const r = await this.grouped(q, user, 'group');
    r.rows.sort((a, b) => b._margin.cmp(a._margin));
    return { ...r, rows: r.rows.map(strip) };
  }

  /** Sales by group or brand per week (blueprint 14 weekly list). */
  async salesByGroup(q: ReportQuery, user: CurrentUser) {
    this.common.require(user, 'pos.reports');
    const company = await this.common.current();
    const { from, to } = this.common.period(q.from, q.to, 28);
    const scope = this.common.scope(user, q.storeId);
    const by = q.groupBy === 'brand' ? 'brand' : 'group';
    const lines = await this.lines(company.id, from, to, scope, q);
    const weekOf = (d: Date) => {
      // Weeks start on Monday.
      const day = (d.getUTCDay() + 6) % 7;
      return iso(new Date(d.getTime() - day * 86_400_000))!;
    };
    const weeks = [...new Set(lines.map((l) => weekOf(l.businessDate)))].sort();
    const table = new Map<string, Map<string, { net: Decimal; quantity: Decimal }>>();
    for (const l of lines) {
      const k = by === 'brand' ? (l.brandId ?? 'none') : l.itemGroupId;
      const row = table.get(k) ?? new Map();
      const w = weekOf(l.businessDate);
      const cell = row.get(w) ?? { net: ZERO, quantity: ZERO };
      cell.net = cell.net.add(D(l.taxableAmount));
      cell.quantity = cell.quantity.add(D(l.basicQuantity));
      row.set(w, cell);
      table.set(k, row);
    }
    const names = await this.namesFor(by, [...table.keys()], company.id);
    const rows = [...table.entries()]
      .map(([k, row]) => ({
        key: k,
        ...names(k),
        weeks: Object.fromEntries(weeks.map((w) => [w, { netSales: money(row.get(w)?.net ?? ZERO), quantity: qty(row.get(w)?.quantity ?? ZERO) }])),
        netSales: money([...row.values()].reduce((s, c) => s.add(c.net), ZERO)),
        quantity: qty([...row.values()].reduce((s, c) => s.add(c.quantity), ZERO)),
      }))
      .sort((a, b) => D(b.netSales).cmp(D(a.netSales)));
    return { from, to, groupBy: by, weeks, workedOutAt: new Date().toISOString(), rows };
  }

  /** Returns and cancelled bills (blueprint 14 daily list). */
  async returns(q: ReportQuery, user: CurrentUser) {
    this.common.require(user, 'pos.reports');
    const company = await this.common.current();
    const { from, to } = this.common.period(q.from, q.to, 7);
    const scope = this.common.scope(user, q.storeId);
    const bills = await this.prisma.posBill.findMany({
      where: {
        companyId: company.id,
        businessDate: { gte: fromIso(from), lte: fromIso(to) },
        OR: [{ kind: 'return', status: 'completed' }, { status: 'cancelled' }],
        ...(scope.ids ? { till: { storeId: { in: scope.ids } } } : {}),
        ...(q.cashierId ? { cashierId: q.cashierId } : {}),
      },
      include: { lines: { select: { itemId: true, basicQuantity: true, taxableAmount: true, lineTotal: true } }, returnOf: { select: { number: true } }, till: { select: { code: true, storeId: true } } },
      orderBy: { soldAt: 'asc' },
    });
    const items = await this.common.items([...new Set(bills.flatMap((b) => b.lines.map((l) => l.itemId)))]);
    const users = await this.common.users([...new Set(bills.flatMap((b) => [b.cashierId, b.approvedById, b.cancelledById].filter((x): x is string => !!x)))]);
    const stores = await this.common.stores(company.id);
    let total = ZERO;
    const rows = bills.map((b) => {
      const value = b.lines.reduce((s, l) => s.add(D(l.lineTotal)), ZERO);
      if (b.status !== 'cancelled') total = total.add(value);
      return {
        billId: b.id,
        number: b.number,
        date: iso(b.businessDate),
        store: stores.get(b.till.storeId)?.code ?? null,
        till: b.till.code,
        what: b.status === 'cancelled' ? (b.kind === 'return' ? 'Return cancelled' : 'Sale cancelled') : 'Return',
        originalBill: b.returnOf?.number ?? null,
        items: b.lines.map((l) => `${items.get(l.itemId)?.name ?? l.itemId} × ${qty(D(l.basicQuantity).abs())}`).join(', '),
        value: money(value),
        reason: b.status === 'cancelled' ? b.cancelReason : b.returnReason,
        cashier: users.get(b.cashierId) ?? null,
        approvedBy: b.approvedById ? (users.get(b.approvedById) ?? null) : null,
        cancelledBy: b.cancelledById ? (users.get(b.cancelledById) ?? null) : null,
      };
    });
    return { from, to, workedOutAt: new Date().toISOString(), rows, totals: { returns: money(total), count: rows.length } };
  }

  /** Discounts given (blueprint 14): line and bill discounts, offers, coupons, price changes, who approved. All amounts include GST, as charged. */
  async discounts(q: ReportQuery, user: CurrentUser) {
    this.common.require(user, 'pos.reports');
    const company = await this.common.current();
    const { from, to } = this.common.period(q.from, q.to, 7);
    const scope = this.common.scope(user, q.storeId);
    const lines = (await this.lines(company.id, from, to, scope, q)).filter((l) => l.kind === 'sale');
    const billIds = [...new Set(lines.map((l) => l.billId))];
    const bills = new Map(
      (await this.prisma.posBill.findMany({ where: { id: { in: billIds } }, select: { id: true, billDiscount: true, couponId: true, approvedById: true } })).map((b) => [b.id, b]),
    );
    const offers = new Map((await this.prisma.offer.findMany({ where: { companyId: company.id }, select: { id: true, code: true, name: true } })).map((o) => [o.id, o]));
    const coupons = new Map((await this.prisma.coupon.findMany({ where: { companyId: company.id }, select: { id: true, code: true } })).map((c) => [c.id, c]));
    const items = await this.common.items([...new Set(lines.map((l) => l.itemId))]);
    const users = await this.common.users([...new Set(lines.flatMap((l) => [l.cashierId, l.approvedById].filter((x): x is string => !!x)))]);
    const totals = { manual: ZERO, bill: ZERO, offers: ZERO, priceChanges: ZERO };
    const rows = [];
    for (const l of lines) {
      const bill = bills.get(l.billId)!;
      const priceChange = D(l.listPrice).sub(D(l.price)).mul(D(l.quantity));
      const offer = D(l.offerDiscount);
      // The stored discount includes the offer saving; what is left is the manual line discount and the bill discount share.
      const lineAndBill = D(l.discountAmount).sub(offer);
      if (lineAndBill.isZero() && offer.isZero() && priceChange.lte(0)) continue;
      // The bill discount was shared over the lines; its share is in the line's discount.
      rows.push({
        billId: l.billId,
        number: l.number,
        date: iso(l.businessDate),
        item: items.get(l.itemId)?.name ?? l.itemId,
        quantity: qty(D(l.quantity)),
        listPrice: money(D(l.listPrice)),
        price: money(D(l.price)),
        priceChange: money(Decimal.max(ZERO, priceChange)),
        discountPercent: D(l.discountPercent).toFixed(2),
        lineAndBillDiscount: money(lineAndBill),
        offerDiscount: money(offer),
        offer: l.offerId ? (offers.get(l.offerId)?.name ?? null) : null,
        coupon: bill.couponId ? (coupons.get(bill.couponId)?.code ?? null) : null,
        cashier: users.get(l.cashierId) ?? null,
        approvedBy: l.approvedById ? (users.get(l.approvedById) ?? null) : null,
      });
      totals.manual = totals.manual.add(lineAndBill);
      totals.offers = totals.offers.add(offer);
      totals.priceChanges = totals.priceChanges.add(Decimal.max(ZERO, priceChange));
    }
    for (const b of bills.values()) totals.bill = totals.bill.add(D(b.billDiscount));
    return {
      from,
      to,
      workedOutAt: new Date().toISOString(),
      rows,
      totals: { lineAndBillDiscounts: money(totals.manual), ofWhichBillDiscounts: money(totals.bill), offers: money(totals.offers), priceChanges: money(totals.priceChanges), all: money(totals.manual.add(totals.offers).add(totals.priceChanges)) },
    };
  }

  private async namesFor(by: string, keys: string[], companyId: string): Promise<(k: string) => { code: string | null; name: string }> {
    if (by === 'item') {
      const m = await this.common.items(keys);
      return (k) => ({ code: m.get(k)?.code ?? null, name: m.get(k)?.name ?? k });
    }
    if (by === 'group') {
      const m = await this.common.groups(keys);
      return (k) => ({ code: m.get(k)?.code ?? null, name: m.get(k)?.name ?? k });
    }
    if (by === 'brand') {
      const m = await this.common.brands(keys.filter((k) => k !== 'none'));
      return (k) => ({ code: null, name: k === 'none' ? 'No brand' : (m.get(k)?.name ?? k) });
    }
    if (by === 'customer') {
      const m = await this.common.customers(keys);
      return (k) => ({ code: m.get(k)?.code ?? null, name: m.get(k)?.name ?? k });
    }
    if (by === 'store') {
      const m = await this.common.stores(companyId);
      return (k) => ({ code: m.get(k)?.code ?? null, name: m.get(k)?.name ?? k });
    }
    if (by === 'cashier') {
      const m = await this.common.users(keys);
      return (k) => ({ code: null, name: m.get(k) ?? k });
    }
    if (by === 'style') {
      const m = await this.common.items(keys);
      return (k) => ({ code: m.get(k)?.code ?? null, name: m.get(k)?.name ?? k });
    }
    if (by === 'season') {
      const m = new Map((await this.prisma.season.findMany({ where: { id: { in: keys.filter((k) => k !== 'none') } }, select: { id: true, code: true, name: true } })).map((s) => [s.id, s]));
      return (k) => ({ code: m.get(k)?.code ?? null, name: k === 'none' ? 'No season' : (m.get(k)?.name ?? k) });
    }
    if (by === 'attribute') return (k) => ({ code: null, name: k === 'none' ? 'Not given' : k });
    return (k) => ({ code: null, name: k });
  }

  /**
   * Plan 11 C3, C4: for each item, the style it belongs to (itself when it has
   * none), its value of one attribute (e.g. its size) and its season (a variant
   * without its own season takes its style's). "none" when there is nothing.
   */
  private async styleKeys(itemIds: string[], attributeId?: string): Promise<Map<string, { style: string; attribute: string; season: string }>> {
    const items = await this.prisma.item.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, parentItemId: true, seasonId: true, parent: { select: { seasonId: true } }, variantValues: attributeId ? { where: { attributeId }, select: { value: true } } : false },
    });
    return new Map(
      items.map((i) => [i.id, { style: i.parentItemId ?? i.id, attribute: (i.variantValues as { value: string }[] | undefined)?.[0]?.value ?? 'none', season: i.seasonId ?? i.parent?.seasonId ?? 'none' }]),
    );
  }
}

function strip<T extends { _q: unknown; _net: unknown; _margin: unknown }>(row: T): Omit<T, '_q' | '_net' | '_margin'> {
  const { _q, _net, _margin, ...rest } = row;
  void _q;
  void _net;
  void _margin;
  return rest;
}
