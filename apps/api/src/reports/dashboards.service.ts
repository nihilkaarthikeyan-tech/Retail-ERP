// Copyright (c) 2026, Rademics. All rights reserved.
// Dashboards (plan 09 §1.1; blueprint 14 "Dashboards"): headline figures with
// a comparison and simple chart series, worked out when the page opens and
// limited to the viewer's stores. Each figure comes from the same code as the
// matching report, so they always agree (scenario 9.9).
import { ForbiddenException, Injectable } from '@nestjs/common';
import { addDays, businessDate, changePercent, type CurrentUser, Decimal, grossMarginPercent, hasPermission, previousPeriod } from 'shared';
import type { Prisma } from '../generated/prisma/client.js';
import { LedgerReportsService } from '../accounting/ledger-reports.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GstReturnsService } from './gst-returns.service.js';
import { MoneyReportsService } from './money-reports.service.js';
import { D, fromIso, iso, money, pctText, qty, ReportsCommon, ZERO } from './reports-common.service.js';
import { type SaleLineRow, SalesReportsService, type TotalsRow } from './sales-reports.service.js';

const IST_OFFSET_MS = 330 * 60_000;

export interface Tile {
  key: string;
  label: string;
  value: string;
  /** "money", "count", "percent", "quantity" */
  format: string;
  previous?: string | null;
  changePercent?: string | null;
  hint?: string;
}

@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: ReportsCommon,
    private readonly sales: SalesReportsService,
    private readonly money: MoneyReportsService,
    private readonly ledgerReports: LedgerReportsService,
    private readonly ledger: LedgerService,
    private readonly gst: GstReturnsService,
  ) {}

  /** Which dashboards this user may open. */
  available(user: CurrentUser) {
    const out: string[] = [];
    if (hasPermission(user, 'pos.reports')) out.push('store');
    if (hasPermission(user, 'pos.reports') && (user.allStores || user.isOwnerAdmin) && (hasPermission(user, 'cost_price.view') || hasPermission(user, 'accounts.view'))) out.push('owner');
    if (hasPermission(user, 'purchase.view')) out.push('purchasing');
    if (hasPermission(user, 'accounts.view')) out.push('accounts');
    return out;
  }

  private salesTotals(lines: SaleLineRow[]) {
    let net = ZERO;
    let cost = ZERO;
    let returns = ZERO;
    const bills = new Set<string>();
    for (const l of lines) {
      net = net.add(D(l.taxableAmount));
      cost = cost.add(D(l.cost));
      if (l.kind === 'sale') bills.add(l.billId);
      else returns = returns.add(D(l.taxableAmount));
    }
    return { net, cost, returns, bills: bills.size };
  }

  /** The same figures as salesTotals, from the database's totals. */
  private fromTotals(rows: TotalsRow[]) {
    const t = rows.find((r) => r.total)?.totals;
    return { net: t?.net ?? ZERO, cost: t?.cost ?? ZERO, returns: t?.returns ?? ZERO, bills: t?.saleBills ?? 0 };
  }

  private tile(key: string, label: string, value: Decimal | number, format: string, previous?: Decimal | number | null, hint?: string): Tile {
    const v = typeof value === 'number' ? new Decimal(value) : value;
    const p = previous === undefined || previous === null ? null : typeof previous === 'number' ? new Decimal(previous) : previous;
    const text = (d: Decimal) => (format === 'count' ? d.toFixed(0) : format === 'quantity' ? qty(d) : d.toFixed(2));
    return { key, label, value: text(v), format, ...(p ? { previous: text(p), changePercent: pctText(changePercent(v, p)) } : {}), ...(hint ? { hint } : {}) };
  }

  /** Items whose stock in a store is at or below their reorder level. */
  async belowReorder(companyId: string, storeIds: string[] | null) {
    const companyStores = (await this.prisma.store.findMany({ where: { companyId }, select: { id: true } })).map((st) => st.id);
    const stores = storeIds ? storeIds.filter((id) => companyStores.includes(id)) : companyStores;
    const levels = await this.prisma.reorderLevel.findMany({ where: { active: true, storeId: { in: stores } }, select: { itemId: true, storeId: true, level: true } });
    if (!levels.length) return [];
    const locs = await this.prisma.stockLocation.findMany({ where: { companyId, kind: 'shelf', storeId: { in: [...new Set(levels.map((l) => l.storeId))] } }, select: { id: true, storeId: true } });
    const storeOf = new Map(locs.map((l) => [l.id, l.storeId!]));
    const positions = await this.prisma.stockPosition.findMany({ where: { locationId: { in: locs.map((l) => l.id) }, itemId: { in: levels.map((l) => l.itemId) } }, select: { itemId: true, locationId: true, quantity: true } });
    const onHand = new Map<string, Decimal>();
    for (const p of positions) {
      const k = `${p.itemId}|${storeOf.get(p.locationId)}`;
      onHand.set(k, (onHand.get(k) ?? ZERO).add(D(p.quantity)));
    }
    return levels.filter((l) => (onHand.get(`${l.itemId}|${l.storeId}`) ?? ZERO).lte(D(l.level))).map((l) => ({ ...l, onHand: onHand.get(`${l.itemId}|${l.storeId}`) ?? ZERO }));
  }

  /** Store dashboard (store manager, own stores): today against yesterday. */
  async store(user: CurrentUser, storeId?: string) {
    this.common.require(user, 'pos.reports');
    const company = await this.common.current();
    const scope = this.common.scope(user, storeId);
    const today = businessDate();
    const yesterday = addDays(today, -1);
    // Audit 8: today's lines (for the hours) and totals from the database for the rest.
    const [todayLines, ySums, monthSums, weekSums] = await Promise.all([
      this.sales.lines(company.id, today, today, scope),
      this.sales.totalsBy(company.id, yesterday, yesterday, scope, {}, 'all'),
      this.sales.totalsBy(company.id, addDays(today, -29), today, scope, {}, 'date'),
      this.sales.totalsBy(company.id, addDays(today, -6), today, scope, {}, 'item'),
    ]);
    const t = this.salesTotals(todayLines);
    const y = this.fromTotals(ySums);
    const avg = (s: { net: Decimal; bills: number }) => (s.bills ? s.net.div(s.bills).toDecimalPlaces(2) : ZERO);
    const cash = await this.money.cashInOpenTills(company.id, scope.ids);
    const reorder = await this.belowReorder(company.id, scope.ids);
    const tiles: Tile[] = [
      this.tile('sales_today', 'Sales today (before GST)', t.net, 'money', y.net),
      this.tile('bills_today', 'Bills today', t.bills, 'count', y.bills),
      this.tile('average_bill', 'Average bill', avg(t), 'money', avg(y)),
      this.tile('returns_today', 'Returns today', t.returns.neg(), 'money', y.returns.neg()),
      this.tile('cash_expected', 'Cash expected in open tills', cash, 'money'),
      this.tile('below_reorder', 'Items at or below reorder level', reorder.length, 'count'),
    ];
    // Sales by hour today, Indian time.
    const hours = new Map<number, Decimal>();
    for (const l of todayLines) {
      const h = new Date(l.soldAt.getTime() + IST_OFFSET_MS).getUTCHours();
      hours.set(h, (hours.get(h) ?? ZERO).add(D(l.taxableAmount)));
    }
    const days = new Map<string, Decimal>();
    for (let i = 29; i >= 0; i--) days.set(addDays(today, -i), ZERO);
    for (const r of monthSums) if (!r.total) days.set(r.key, (days.get(r.key) ?? ZERO).add(r.totals.net));
    const billsToday: Prisma.PosBillWhereInput = { companyId: company.id, status: 'completed', businessDate: fromIso(today), ...(scope.ids ? { till: { storeId: { in: scope.ids } } } : {}) };
    const payments = await this.prisma.posPayment.groupBy({ by: ['paymentMethodId'], where: { bill: billsToday }, _sum: { amount: true } });
    const methodRows = await this.prisma.paymentMethod.findMany({ where: { companyId: company.id }, select: { id: true, name: true, kind: true } });
    const methods = new Map(methodRows.map((m) => [m.id, m.name]));
    // Payments are stored as handed over; the change given back comes out of the cash
    // method the bill was paid with, as at the shift close (decision 41).
    const received = new Map(payments.map((p) => [p.paymentMethodId, D(p._sum?.amount)]));
    const cashIds = new Set(methodRows.filter((m) => m.kind === 'cash').map((m) => m.id));
    const withChange = await this.prisma.posBill.findMany({ where: { ...billsToday, changeAmount: { gt: 0 } }, select: { changeAmount: true, payments: { select: { paymentMethodId: true } } } });
    for (const b of withChange) {
      const cashId = b.payments.find((p) => cashIds.has(p.paymentMethodId))?.paymentMethodId;
      if (cashId && received.has(cashId)) received.set(cashId, received.get(cashId)!.sub(D(b.changeAmount)));
    }
    const top = new Map<string, Decimal>();
    for (const r of weekSums) if (!r.total) top.set(r.key, r.allQuantity);
    const topIds = [...top.entries()].sort((a, b) => b[1].cmp(a[1])).slice(0, 10);
    const items = await this.common.items(topIds.map(([id]) => id));
    return {
      dashboard: 'store',
      date: today,
      workedOutAt: new Date().toISOString(),
      tiles,
      charts: {
        salesByHour: [...hours.entries()].sort((a, b) => a[0] - b[0]).map(([hour, v]) => ({ label: `${String(hour).padStart(2, '0')}:00`, value: money(v) })),
        salesLast30Days: [...days.entries()].map(([date, v]) => ({ label: date, value: money(v) })),
        paymentMix: [...received.entries()].map(([id, v]) => ({ label: methods.get(id) ?? id, value: money(v) })),
        topItemsThisWeek: topIds.map(([id, v]) => ({ label: items.get(id)?.name ?? id, value: qty(v) })),
      },
    };
  }

  /** Owner dashboard (all stores): month to date against the previous period of the same length. */
  async owner(user: CurrentUser) {
    this.common.require(user, 'pos.reports');
    // Audit 1 (28 October 2026): it shows the whole company (stock value, dues), so the same rule as the menu.
    if (!this.available(user).includes('owner')) throw new ForbiddenException('The owner dashboard covers every store; it is for people who work in all stores');
    const company = await this.common.current();
    const scope = this.common.scope(user);
    const seesCost = this.common.seesCost(user);
    const today = businessDate();
    const monthStart = `${today.slice(0, 7)}-01`;
    const prev = previousPeriod(monthStart, today);
    // Audit 8: totals from the database (two months of lines were read into memory).
    const [mtd, before] = await Promise.all([this.sales.totalsBy(company.id, monthStart, today, scope, {}, 'all'), this.sales.totalsBy(company.id, prev.from, prev.to, scope, {}, 'all')]);
    const m = this.fromTotals(mtd);
    const p = this.fromTotals(before);
    const tiles: Tile[] = [this.tile('sales_mtd', 'Sales this month (before GST)', m.net, 'money', p.net, `Against ${prev.from} to ${prev.to}`)];
    if (seesCost) {
      tiles.push(this.tile('margin_mtd', 'Gross margin this month', grossMarginPercent(m.net, m.cost) ?? ZERO, 'percent', grossMarginPercent(p.net, p.cost)));
      const stock = await this.prisma.stockPosition.aggregate({ where: { companyId: company.id }, _sum: { value: true } });
      tiles.push(this.tile('stock_value', 'Stock value', D(stock._sum.value), 'money'));
    }
    if (hasPermission(user, 'accounts.view')) {
      const dues = await this.dues();
      tiles.push(this.tile('customer_dues', 'Customers owe', dues.customers, 'money', null, `₹${money(dues.customersOverdue)} overdue`));
      tiles.push(this.tile('supplier_dues', 'The shop owes suppliers', dues.suppliers, 'money', null, `₹${money(dues.suppliersOverdue)} overdue`));
    }
    // Plan 08 §3: the GST payable position for this return period (module 8), from the same code as GSTR-3B.
    if (hasPermission(user, 'gst.returns')) {
      const gst = await this.gst.payable(user).catch(() => null);
      if (gst && gst.registrations.length) tiles.push(this.tile('gst_payable', `GST to pay for ${gst.label}`, D(gst.payable), 'money', null, `₹${gst.creditCarriedForward} input credit carried forward`));
    }
    // Sales by store per month, the last six months.
    const sixStart = `${addDays(monthStart, -150).slice(0, 7)}-01`;
    // Audit 8: totals from the database (it read every bill line of six months into memory).
    const six = await this.sales.taxableByMonthAndStore(company.id, sixStart, today, scope);
    const stores = await this.common.stores(company.id);
    const byStoreMonth = new Map<string, Map<string, Decimal>>();
    for (const l of six) {
      const row = byStoreMonth.get(l.month) ?? new Map<string, Decimal>();
      const sc = stores.get(l.storeId)?.code ?? l.storeId;
      row.set(sc, (row.get(sc) ?? ZERO).add(D(l.taxable)));
      byStoreMonth.set(l.month, row);
    }
    const charts: Record<string, unknown> = {
      salesByStoreByMonth: [...byStoreMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, row]) => ({ label: month, values: Object.fromEntries([...row.entries()].map(([k, v]) => [k, money(v)])) })),
    };
    if (seesCost) {
      const groups = new Map((await this.sales.totalsBy(company.id, monthStart, today, scope, {}, 'group')).filter((r) => !r.total).map((r) => [r.key, { net: r.totals.net, cost: r.totals.cost }]));
      const names = await this.common.groups([...groups.keys()]);
      charts.marginByGroup = [...groups.entries()].map(([id, g]) => ({ label: names.get(id)?.name ?? id, value: pctText(grossMarginPercent(g.net, g.cost)) ?? '0.00', sales: money(g.net) })).sort((a, b) => D(b.sales).cmp(D(a.sales)));
    }
    if (hasPermission(user, 'accounts.view')) {
      charts.stockValueByMonth = await this.stockValueByMonth(company.id, today);
      const ageing = await this.ledgerReports.ageing({ asOf: today, partyType: 'customer' }, user);
      charts.customerDuesByAge = ageing.labels.map((l) => ({ label: l, value: ageing.totals[l] }));
    }
    return { dashboard: 'owner', date: today, workedOutAt: new Date().toISOString(), tiles, charts };
  }

  /** Purchasing dashboard: open orders, late deliveries, items short; purchases by supplier; suggestions by group. */
  async purchasing(user: CurrentUser) {
    this.common.require(user, 'purchase.view');
    const company = await this.common.current();
    const scope = this.common.scope(user);
    const today = businessDate();
    const lines = await this.prisma.purchaseOrderLine.findMany({
      where: { order: { companyId: company.id, status: { in: ['to_receive_and_bill', 'to_receive'] }, ...(scope.ids ? { storeId: { in: scope.ids } } : {}) } },
      select: { basicQuantity: true, receivedQuantity: true, taxableAmount: true, neededBy: true, orderId: true },
    });
    let openValue = ZERO;
    const late = new Set<string>();
    for (const l of lines) {
      const pending = Decimal.max(ZERO, D(l.basicQuantity).sub(D(l.receivedQuantity)));
      if (pending.isZero() || D(l.basicQuantity).isZero()) continue;
      openValue = openValue.add(D(l.taxableAmount).mul(pending).div(D(l.basicQuantity)));
      if (iso(l.neededBy)! < today) late.add(l.orderId);
    }
    const reorder = await this.belowReorder(company.id, scope.ids);
    const tiles = [
      this.tile('open_orders', 'Still to come on open orders (before GST)', openValue.toDecimalPlaces(2), 'money'),
      this.tile('late_orders', 'Orders past their needed-by date', late.size, 'count'),
      this.tile('short_items', 'Items at or below reorder level', reorder.length, 'count'),
    ];
    const from = addDays(today, -29);
    const bills = await this.prisma.supplierBill.findMany({
      where: { companyId: company.id, status: 'unpaid', postingDate: { gte: fromIso(from), lte: fromIso(today) }, ...(scope.ids ? { storeId: { in: scope.ids } } : {}) },
      select: { supplierId: true, taxableAmount: true, supplier: { select: { name: true } } },
    });
    const bySupplier = new Map<string, { name: string; value: Decimal }>();
    for (const b of bills) {
      const r = bySupplier.get(b.supplierId) ?? { name: b.supplier.name, value: ZERO };
      r.value = r.value.add(D(b.taxableAmount));
      bySupplier.set(b.supplierId, r);
    }
    const suggestions = await this.prisma.reorderSuggestion.findMany({ where: { companyId: company.id, status: 'open', ...(scope.ids ? { storeId: { in: scope.ids } } : {}) }, select: { itemId: true } });
    const items = await this.common.items([...new Set(suggestions.map((s) => s.itemId))]);
    const byGroup = new Map<string, number>();
    for (const s of suggestions) {
      const g = items.get(s.itemId)?.itemGroupId ?? 'none';
      byGroup.set(g, (byGroup.get(g) ?? 0) + 1);
    }
    const groups = await this.common.groups([...byGroup.keys()]);
    return {
      dashboard: 'purchasing',
      date: today,
      workedOutAt: new Date().toISOString(),
      tiles,
      charts: {
        purchasesBySupplier30Days: [...bySupplier.values()].sort((a, b) => b.value.cmp(a.value)).slice(0, 10).map((r) => ({ label: r.name, value: money(r.value) })),
        reorderSuggestionsByGroup: [...byGroup.entries()].map(([g, n]) => ({ label: groups.get(g)?.name ?? 'Other', value: String(n) })),
      },
    };
  }

  /** Accounts dashboard: bank and cash, cash in tills, overdue dues; income against expenses; this month's cash flow. */
  async accounts(user: CurrentUser) {
    this.common.require(user, 'accounts.view');
    const company = await this.common.current();
    const scope = this.common.scope(user);
    const today = businessDate();
    const position = await this.money.cashPosition({ asOf: today }, user);
    const sum = (kind: string) => position.rows.filter((r) => r.kind === kind).reduce((s, r) => s.add(D(r.balance)), ZERO);
    const tiles: Tile[] = [
      this.tile('bank', 'In the bank', sum('Bank'), 'money'),
      this.tile('cash_in_hand', 'Cash in hand', sum('Cash'), 'money'),
      this.tile('cash_in_tills', 'Cash in open tills now', await this.money.cashInOpenTills(company.id, scope.ids), 'money'),
    ];
    if (!scope.ids) {
      const dues = await this.dues();
      tiles.push(this.tile('customers_overdue', 'Customer dues overdue', dues.customersOverdue, 'money', null, `of ₹${money(dues.customers)} owed`));
    }
    const monthStart = `${today.slice(0, 7)}-01`;
    const flow = await this.money.cashFlow({ from: monthStart, to: today }, user);
    return {
      dashboard: 'accounts',
      date: today,
      workedOutAt: new Date().toISOString(),
      tiles,
      charts: {
        incomeVsExpensesByMonth: await this.money.incomeVsExpenses(company.id, `${addDays(monthStart, -150).slice(0, 7)}-01`, today, scope.ids),
        cashFlowThisMonth: [
          { label: 'Trading', value: flow.trading.total },
          { label: 'Investing', value: flow.investing.total },
          { label: 'Financing', value: flow.financing.total },
          ...(D(flow.transfers.total).isZero() ? [] : [{ label: 'To or from other accounts', value: flow.transfers.total }]),
        ],
      },
    };
  }

  /** What customers owe and what the shop owes suppliers, with the overdue parts (from the ledger; the shop is the current one). */
  async dues() {
    const today = businessDate();
    const out = { customers: ZERO, customersOverdue: ZERO, suppliers: ZERO, suppliersOverdue: ZERO };
    // Audit 8: all parties at once (it asked once per customer and supplier).
    for (const [key, items] of await this.ledger.openItemsByParty(this.prisma)) {
      const type = key.split('|')[0] as 'customer' | 'supplier';
      for (const i of items) {
        if (i.owed.lte(0)) {
          if (type === 'customer') out.customers = out.customers.add(i.owed);
          else out.suppliers = out.suppliers.add(i.owed);
          continue;
        }
        const overdue = (i.dueDate ?? i.date) < today;
        if (type === 'customer') {
          out.customers = out.customers.add(i.owed);
          if (overdue) out.customersOverdue = out.customersOverdue.add(i.owed);
        } else {
          out.suppliers = out.suppliers.add(i.owed);
          if (overdue) out.suppliersOverdue = out.suppliersOverdue.add(i.owed);
        }
      }
    }
    return out;
  }

  /** Stock and goods-in-transit account balances at each of the last six month ends. */
  private async stockValueByMonth(companyId: string, today: string) {
    const defaults = await this.prisma.accountDefault.findMany({ where: { companyId, role: { in: ['stock', 'goods_in_transit'] } }, select: { accountId: true } });
    const ids = defaults.map((d) => d.accountId);
    const out = [];
    let monthStart = `${today.slice(0, 7)}-01`;
    const ends = [today];
    for (let i = 0; i < 5; i++) {
      ends.unshift(addDays(monthStart, -1));
      monthStart = `${addDays(monthStart, -1).slice(0, 7)}-01`;
    }
    for (const end of ends) {
      const s = await this.prisma.ledgerLine.aggregate({ where: { accountId: { in: ids }, entryDate: { lte: fromIso(end) } }, _sum: { debit: true, credit: true } });
      out.push({ label: end, value: money(D(s._sum.debit).sub(D(s._sum.credit))) });
    }
    return out;
  }
}
