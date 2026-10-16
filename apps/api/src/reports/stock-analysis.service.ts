// Copyright (c) 2026, Rademics. All rights reserved.
// Stock analysis reports (plan 09 §1.2): stock movement for a period, stock
// cover and sell-through, stock age, and stock variance and loss. Figures come
// from the stock records (module 4); sales quantities from the till bills.
import { Injectable } from '@nestjs/common';
import {
  addDays,
  type CurrentUser,
  daysBetween,
  daysOfStockLeft,
  Decimal,
  type ReportQuery,
  sellThroughPercent,
  shrinkagePercent,
  stockAge,
  stockAgeLabels,
  stockTurnover,
} from 'shared';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, fromIso, iso, money, pctText, qty, ReportsCommon, type StoreScope, ZERO } from './reports-common.service.js';
import { SalesReportsService } from './sales-reports.service.js';

/** Losses for the variance report: write-offs by reason, and stock counts that found less. */
const LOSS_REASONS: Record<string, string> = { damage: 'Damaged', expiry: 'Expired', theft_loss: 'Theft or loss', count_shortfall: 'Stock count shortfall' };

@Injectable()
export class StockAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: ReportsCommon,
    private readonly sales: SalesReportsService,
  ) {}

  /** Shelf and rejected locations of the stores in scope (goods in transit only when every store is in scope). */
  private async locations(companyId: string, scope: StoreScope, locationId?: string) {
    const rows = await this.prisma.stockLocation.findMany({
      where: { companyId, kind: { not: 'folder' }, ...(locationId ? { id: locationId } : {}), ...(scope.ids ? { storeId: { in: scope.ids } } : {}) },
      select: { id: true, storeId: true, kind: true },
    });
    return rows.filter((l) => l.kind !== 'folder');
  }

  /** Stock movement for a period: opening, in, out and closing quantity and value per item (blueprint 14 monthly list). */
  async movement(q: ReportQuery, user: CurrentUser) {
    this.common.require(user, 'stock.view');
    const company = await this.common.current();
    const { from, to } = this.common.period(q.from, q.to, 30);
    const scope = this.common.scope(user, q.storeId);
    const seesCost = this.common.seesCost(user);
    const locs = (await this.locations(company.id, scope, q.locationId)).map((l) => l.id);
    const itemFilter: Prisma.StockLedgerEntryWhereInput = {
      locationId: { in: locs },
      ...(q.itemId ? { itemId: q.itemId } : {}),
      ...(q.itemGroupId ? { item: { itemGroupId: q.itemGroupId } } : {}),
    };
    const [before, during] = await Promise.all([
      this.prisma.stockLedgerEntry.groupBy({ by: ['itemId'], where: { ...itemFilter, postingDate: { lt: fromIso(from) } }, _sum: { quantityChange: true, valueChange: true } }),
      this.prisma.stockLedgerEntry.findMany({ where: { ...itemFilter, postingDate: { gte: fromIso(from), lte: fromIso(to) } }, select: { itemId: true, quantityChange: true, valueChange: true } }),
    ]);
    const rows = new Map<string, { oq: Decimal; ov: Decimal; iq: Decimal; iv: Decimal; xq: Decimal; xv: Decimal }>();
    const get = (id: string) => rows.get(id) ?? (rows.set(id, { oq: ZERO, ov: ZERO, iq: ZERO, iv: ZERO, xq: ZERO, xv: ZERO }), rows.get(id)!);
    for (const b of before) {
      const r = get(b.itemId);
      r.oq = D(b._sum.quantityChange);
      r.ov = D(b._sum.valueChange);
    }
    for (const e of during) {
      const r = get(e.itemId);
      const q1 = D(e.quantityChange);
      if (q1.gte(0)) {
        r.iq = r.iq.add(q1);
        r.iv = r.iv.add(D(e.valueChange));
      } else {
        r.xq = r.xq.add(q1.neg());
        r.xv = r.xv.add(D(e.valueChange).neg());
      }
    }
    const items = await this.common.items([...rows.keys()]);
    const totals = { ov: ZERO, iv: ZERO, xv: ZERO, cv: ZERO };
    const out = [...rows.entries()]
      .filter(([, r]) => !(r.oq.isZero() && r.iq.isZero() && r.xq.isZero()))
      .map(([id, r]) => {
        const cq = r.oq.add(r.iq).sub(r.xq);
        const cv = r.ov.add(r.iv).sub(r.xv);
        totals.ov = totals.ov.add(r.ov);
        totals.iv = totals.iv.add(r.iv);
        totals.xv = totals.xv.add(r.xv);
        totals.cv = totals.cv.add(cv);
        const it = items.get(id);
        return {
          itemId: id,
          code: it?.code ?? null,
          name: it?.name ?? id,
          unit: it?.unit ?? null,
          openingQuantity: qty(r.oq),
          inQuantity: qty(r.iq),
          outQuantity: qty(r.xq),
          closingQuantity: qty(cq),
          ...(seesCost ? { openingValue: money(r.ov), inValue: money(r.iv), outValue: money(r.xv), closingValue: money(cv) } : {}),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      from,
      to,
      workedOutAt: new Date().toISOString(),
      rows: out,
      totals: seesCost ? { openingValue: money(totals.ov), inValue: money(totals.iv), outValue: money(totals.xv), closingValue: money(totals.cv), turnover: stockTurnover(totals.xv, totals.ov, totals.cv)?.toFixed(2) ?? null } : {},
    };
  }

  /**
   * Stock that came in during a period, per item: the net of every document
   * that raised stock (receipts, transfers in, stock-ins, counts that found
   * more, opening stock). Till returns are not counted; a cancelled document
   * nets to nothing.
   */
  private async inflows(locs: string[], from: string, to: string) {
    const entries = await this.prisma.stockLedgerEntry.groupBy({
      by: ['itemId', 'documentId', 'locationId', 'postingDate'],
      where: { locationId: { in: locs }, documentType: { not: 'pos_bill' }, postingDate: { gte: fromIso(from), lte: fromIso(to) } },
      _sum: { quantityChange: true },
    });
    const byDoc = new Map<string, { itemId: string; date: string; quantity: Decimal }>();
    for (const e of entries) {
      const k = `${e.itemId}|${e.documentId}|${e.locationId}`;
      const r = byDoc.get(k) ?? { itemId: e.itemId, date: iso(e.postingDate)!, quantity: ZERO };
      r.quantity = r.quantity.add(D(e._sum.quantityChange));
      if (iso(e.postingDate)! < r.date) r.date = iso(e.postingDate)!;
      byDoc.set(k, r);
    }
    return [...byDoc.values()].filter((r) => r.quantity.gt(0));
  }

  /** Stock cover and sell-through (decision 66): days of stock left at the current rate of sale. */
  async cover(q: ReportQuery, user: CurrentUser) {
    this.common.require(user, 'stock.view');
    const company = await this.common.current();
    const days = q.days ?? 30;
    const to = q.to ?? q.asOf ?? this.common.period(undefined, undefined).to;
    const from = addDays(to, -(days - 1));
    const scope = this.common.scope(user, q.storeId);
    const locs = (await this.locations(company.id, scope, q.locationId)).filter((l) => l.kind !== 'transit').map((l) => l.id);
    const itemWhere = { ...(q.itemId ? { itemId: q.itemId } : {}), ...(q.itemGroupId ? { item: { itemGroupId: q.itemGroupId } } : {}) };
    const [onHand, opening, inflows, lines] = await Promise.all([
      this.prisma.stockLedgerEntry.groupBy({ by: ['itemId'], where: { locationId: { in: locs }, postingDate: { lte: fromIso(to) }, ...itemWhere }, _sum: { quantityChange: true } }),
      this.prisma.stockLedgerEntry.groupBy({ by: ['itemId'], where: { locationId: { in: locs }, postingDate: { lt: fromIso(from) }, ...itemWhere }, _sum: { quantityChange: true } }),
      this.inflows(locs, from, to),
      this.sales.lines(company.id, from, to, scope, q),
    ]);
    const sold = new Map<string, Decimal>();
    for (const l of lines) sold.set(l.itemId, (sold.get(l.itemId) ?? ZERO).add(D(l.basicQuantity)));
    const came = new Map<string, Decimal>();
    for (const r of inflows) came.set(r.itemId, (came.get(r.itemId) ?? ZERO).add(r.quantity));
    const openingMap = new Map(opening.map((o) => [o.itemId, D(o._sum.quantityChange)]));
    const onHandMap = new Map(onHand.map((o) => [o.itemId, D(o._sum.quantityChange)]));
    // Items not kept in stock (a carry bag, a service) have no cover to show.
    const stocked = new Set((await this.prisma.item.findMany({ where: { id: { in: [...new Set([...onHandMap.keys(), ...sold.keys()])] }, isStockItem: true }, select: { id: true } })).map((i) => i.id));
    const ids = [...new Set([...onHandMap.keys(), ...sold.keys()])].filter((id) => stocked.has(id));
    const items = await this.common.items(ids);
    const rows = ids
      .map((id) => {
        const hand = onHandMap.get(id) ?? ZERO;
        const s = sold.get(id) ?? ZERO;
        const left = daysOfStockLeft(hand, s, days);
        return {
          itemId: id,
          code: items.get(id)?.code ?? null,
          name: items.get(id)?.name ?? id,
          unit: items.get(id)?.unit ?? null,
          onHand: qty(hand),
          sold: qty(s),
          perDay: s.div(days).toDecimalPlaces(3).toString(),
          daysLeft: left?.toFixed(1) ?? null,
          opening: qty(openingMap.get(id) ?? ZERO),
          cameIn: qty(came.get(id) ?? ZERO),
          sellThroughPercent: pctText(sellThroughPercent(s, openingMap.get(id) ?? ZERO, came.get(id) ?? ZERO)),
        };
      })
      .filter((r) => !(D(r.onHand).isZero() && D(r.sold).isZero()))
      // Fewest days left first; items that are not selling at the end.
      .sort((a, b) => (a.daysLeft === null ? 1 : b.daysLeft === null ? -1 : D(a.daysLeft).cmp(D(b.daysLeft))));
    return { from, to, days, workedOutAt: new Date().toISOString(), rows };
  }

  /** Stock age (blueprint 14): stock on hand in age bands, assuming the oldest leaves first. */
  async age(q: ReportQuery, user: CurrentUser) {
    this.common.require(user, 'stock.view');
    const company = await this.common.current();
    const asOf = q.asOf ?? this.common.period(undefined, undefined).to;
    const scope = this.common.scope(user, q.storeId);
    const seesCost = this.common.seesCost(user);
    const locs = (await this.locations(company.id, scope, q.locationId)).filter((l) => l.kind !== 'transit').map((l) => l.id);
    const itemWhere = { ...(q.itemId ? { itemId: q.itemId } : {}), ...(q.itemGroupId ? { item: { itemGroupId: q.itemGroupId } } : {}) };
    const onHand = await this.prisma.stockLedgerEntry.groupBy({
      by: ['itemId'],
      where: { locationId: { in: locs }, postingDate: { lte: fromIso(asOf) }, ...itemWhere },
      _sum: { quantityChange: true, valueChange: true },
    });
    const held = onHand.filter((o) => D(o._sum.quantityChange).gt(0));
    const inflows = await this.inflows(locs, '2000-01-01', asOf);
    const labels = stockAgeLabels();
    const items = await this.common.items(held.map((h) => h.itemId));
    const totals = Object.fromEntries(labels.map((l) => [l, { quantity: ZERO, value: ZERO }]));
    const rows = held.map((h) => {
      const quantity = D(h._sum.quantityChange);
      const value = D(h._sum.valueChange);
      const unitCost = quantity.gt(0) ? value.div(quantity) : ZERO;
      const bands = stockAge(quantity, inflows.filter((r) => r.itemId === h.itemId).map((r) => ({ date: r.date, quantity: r.quantity })), asOf);
      const out: Record<string, { quantity: string; value?: string }> = {};
      for (const l of labels) {
        const v = bands[l].mul(unitCost);
        totals[l].quantity = totals[l].quantity.add(bands[l]);
        totals[l].value = totals[l].value.add(v);
        out[l] = { quantity: qty(bands[l]), ...(seesCost ? { value: money(v) } : {}) };
      }
      const it = items.get(h.itemId);
      return { itemId: h.itemId, code: it?.code ?? null, name: it?.name ?? h.itemId, unit: it?.unit ?? null, onHand: qty(quantity), ...(seesCost ? { value: money(value) } : {}), bands: out };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return {
      asOf,
      labels,
      workedOutAt: new Date().toISOString(),
      rows,
      totals: Object.fromEntries(labels.map((l) => [l, { quantity: qty(totals[l].quantity), ...(seesCost ? { value: money(totals[l].value) } : {}) }])),
    };
  }

  /** Stock variance and loss (decision 66): write-offs and count shortfalls, by reason, and as % of net sales. */
  async shrinkage(q: ReportQuery, user: CurrentUser) {
    this.common.require(user, 'stock.cost.view', 'cost_price.view');
    const company = await this.common.current();
    const { from, to } = this.common.period(q.from, q.to, 30);
    const scope = this.common.scope(user, q.storeId);
    const locs = (await this.locations(company.id, scope)).map((l) => l.id);
    const entries = await this.prisma.stockLedgerEntry.groupBy({
      by: ['documentId', 'itemId'],
      where: { locationId: { in: locs }, documentType: 'stock_document', postingDate: { gte: fromIso(from), lte: fromIso(to) } },
      _sum: { quantityChange: true, valueChange: true },
    });
    const docs = new Map(
      (await this.prisma.stockDocument.findMany({ where: { id: { in: [...new Set(entries.map((e) => e.documentId))] } }, select: { id: true, number: true, kind: true, reason: true, postingDate: true, storeId: true } })).map((d) => [d.id, d]),
    );
    const byReason = new Map<string, { quantity: Decimal; value: Decimal }>();
    const rows = [];
    const items = await this.common.items([...new Set(entries.map((e) => e.itemId))]);
    for (const e of entries) {
      const d = docs.get(e.documentId);
      if (!d) continue;
      const value = D(e._sum.valueChange);
      if (value.gte(0)) continue;
      const reason = d.kind === 'stock_out' && d.reason && d.reason in LOSS_REASONS ? d.reason : d.kind === 'count' ? 'count_shortfall' : null;
      if (!reason) continue;
      const r = byReason.get(reason) ?? { quantity: ZERO, value: ZERO };
      r.quantity = r.quantity.add(D(e._sum.quantityChange).neg());
      r.value = r.value.add(value.neg());
      byReason.set(reason, r);
      rows.push({ documentId: d.id, number: d.number, date: iso(d.postingDate), reason: LOSS_REASONS[reason], item: items.get(e.itemId)?.name ?? e.itemId, quantity: qty(D(e._sum.quantityChange).neg()), value: money(value.neg()) });
    }
    const loss = [...byReason.values()].reduce((s, r) => s.add(r.value), ZERO);
    const lines = await this.sales.lines(company.id, from, to, scope);
    const netSales = lines.reduce((s, l) => s.add(D(l.taxableAmount)), ZERO);
    return {
      from,
      to,
      workedOutAt: new Date().toISOString(),
      byReason: Object.entries(LOSS_REASONS).map(([k, label]) => ({ reason: label, quantity: qty(byReason.get(k)?.quantity ?? ZERO), value: money(byReason.get(k)?.value ?? ZERO) })),
      rows: rows.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
      totals: { loss: money(loss), netSales: money(netSales), shrinkagePercent: pctText(shrinkagePercent(loss, netSales)) },
    };
  }

  /** Days between two dates, for callers that show ages. */
  ageInDays(from: string, to: string) {
    return daysBetween(from, to);
  }
}
