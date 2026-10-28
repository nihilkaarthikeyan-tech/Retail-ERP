// Copyright (c) 2026, Rademics. All rights reserved.
// Till reports (blueprint 09 "Reports"; decision 66; plan 06 §1 item 12).
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type CurrentUser, Decimal, type PosReportQuery, type SalespersonReportQuery } from 'shared';
import type { Prisma } from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, fromIso, iso, PosCommon } from './pos-common.service.js';

interface SalespersonRow {
  period: string;
  salesStaffId: string | null;
  bills: Set<string>;
  returns: Set<string>;
  sales: Decimal;
  returnsAmount: Decimal;
}

@Injectable()
export class PosReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: PosCommon,
    private readonly audit: AuditService,
  ) {}

  private async where(q: PosReportQuery, user: CurrentUser): Promise<Prisma.PosBillWhereInput> {
    const company = await this.common.currentCompany();
    const stores = user.allStores ? undefined : user.stores.map((s) => s.id);
    return {
      companyId: company.id,
      status: 'completed',
      ...(q.tillId ? { tillId: q.tillId } : {}),
      ...(q.cashierId ? { cashierId: q.cashierId } : {}),
      // A chosen store must be one of the user's own.
      ...(q.storeId || stores ? { till: { storeId: q.storeId ? (stores && !stores.includes(q.storeId) ? { in: [] } : q.storeId) : { in: stores } } } : {}),
      ...(q.from || q.to ? { businessDate: { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } } : {}),
    };
  }

  /** Every bill: date, number, till, cashier, kind, total, payments. */
  async register(q: PosReportQuery, user: CurrentUser) {
    const where = await this.where(q, user);
    // Audit 2 (28 October 2026): never cut off silently (plan 11 A4).
    const count = await this.prisma.posBill.count({ where });
    if (count > 5000) throw new BadRequestException(`There are ${count} bills in this period; choose a shorter period (up to 5,000 bills)`);
    const bills = await this.prisma.posBill.findMany({
      where,
      include: { till: { select: { code: true } }, payments: { include: { paymentMethod: { select: { name: true } } } } },
      orderBy: { soldAt: 'asc' },
      take: 5000,
    });
    return bills.map((b) => ({
      id: b.id,
      number: b.number,
      kind: b.kind,
      soldAt: b.soldAt,
      businessDate: iso(b.businessDate),
      till: b.till.code,
      cashierId: b.cashierId,
      customerId: b.customerId,
      total: b.total.toFixed(2),
      // As handed over, with the change given back (launch check, 27 October 2026: "Cash 2000.00" on a ₹1,597 bill).
      payments: b.payments.map((p) => `${p.paymentMethod.name} ${p.amount.toFixed(2)}`).join(', ') + (D(b.changeAmount).isZero() ? '' : `, change given ${b.changeAmount.toFixed(2)}`),
      offline: b.offline,
      flags: b.checkFlags,
    }));
  }

  /** Amount by payment method per day. */
  async payments(q: PosReportQuery, user: CurrentUser) {
    const pays = await this.prisma.posPayment.findMany({ where: { bill: await this.where(q, user) }, include: { paymentMethod: { select: { code: true, name: true, kind: true } }, bill: { select: { id: true, businessDate: true, changeAmount: true } } } });
    const groups = new Map<string, { date: string; method: string; kind: string; amount: Decimal; count: number }>();
    // The change given back comes out of the bill's (first) cash payment, as at the shift close (decision 41).
    const changeTaken = new Set<string>();
    for (const p of pays) {
      const key = `${iso(p.bill.businessDate)}|${p.paymentMethod.code}`;
      const g = groups.get(key) ?? { date: iso(p.bill.businessDate)!, method: p.paymentMethod.name, kind: p.paymentMethod.kind, amount: new Decimal(0), count: 0 };
      g.amount = g.amount.add(D(p.amount));
      if (p.paymentMethod.kind === 'cash' && !changeTaken.has(p.bill.id)) {
        g.amount = g.amount.sub(D(p.bill.changeAmount));
        changeTaken.add(p.bill.id);
      }
      g.count++;
      groups.set(key, g);
    }
    // Audit 2 (28 October 2026): money taken at the till for gift cards (not a bill) is in the drawer and
    // the card settlement too. A cashier's own report leaves it out (loads keep no cashier).
    if (!q.cashierId) {
      const stores = user.allStores ? undefined : user.stores.map((s) => s.id);
      const storeIds = q.storeId ? (stores && !stores.includes(q.storeId) ? [] : [q.storeId]) : stores;
      const loads = await this.prisma.giftCardEntry.findMany({
        where: {
          kind: 'load',
          paymentMethodId: { not: null },
          tillId: q.tillId ? q.tillId : { not: null },
          ...(storeIds ? { storeId: { in: storeIds } } : {}),
          ...(q.from || q.to ? { entryDate: { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } } : {}),
        },
        select: { amount: true, entryDate: true, paymentMethodId: true },
      });
      const methods = new Map((await this.prisma.paymentMethod.findMany({ where: { id: { in: [...new Set(loads.map((l) => l.paymentMethodId!))] } }, select: { id: true, code: true, name: true, kind: true } })).map((m) => [m.id, m]));
      for (const l of loads) {
        const m = methods.get(l.paymentMethodId!);
        if (!m) continue;
        const key = `${iso(l.entryDate)}|${m.code}`;
        const g = groups.get(key) ?? { date: iso(l.entryDate)!, method: m.name, kind: m.kind, amount: new Decimal(0), count: 0 };
        g.amount = g.amount.add(D(l.amount));
        g.count++;
        groups.set(key, g);
      }
    }
    return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.method.localeCompare(b.method)).map((g) => ({ ...g, amount: g.amount.toFixed(2) }));
  }

  /** Sales per hour of the day (Indian time; decision 66). */
  async hourly(q: PosReportQuery, user: CurrentUser) {
    const bills = await this.prisma.posBill.findMany({ where: await this.where(q, user), select: { soldAt: true, total: true, kind: true } });
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, bills: 0, total: new Decimal(0) }));
    for (const b of bills) {
      const h = new Date(b.soldAt.getTime() + 330 * 60_000).getUTCHours();
      if (b.kind === 'sale') hours[h].bills++;
      hours[h].total = hours[h].total.add(D(b.total));
    }
    return hours.filter((h) => h.bills > 0 || !h.total.eq(0)).map((h) => ({ hour: h.hour, bills: h.bills, total: h.total.toFixed(2) }));
  }

  /** Sales per cashier. */
  async byCashier(q: PosReportQuery, user: CurrentUser) {
    const bills = await this.prisma.posBill.findMany({ where: await this.where(q, user), select: { cashierId: true, total: true, kind: true } });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(bills.map((b) => b.cashierId))] } }, select: { id: true, firstName: true, lastName: true } });
    const name = new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(' ')]));
    const groups = new Map<string, { cashierId: string; name: string; bills: number; returns: number; total: Decimal }>();
    for (const b of bills) {
      const g = groups.get(b.cashierId) ?? { cashierId: b.cashierId, name: name.get(b.cashierId) ?? '—', bills: 0, returns: 0, total: new Decimal(0) };
      if (b.kind === 'sale') g.bills++;
      else g.returns++;
      g.total = g.total.add(D(b.total));
      groups.set(b.cashierId, g);
    }
    return [...groups.values()].map((g) => ({ ...g, total: g.total.toFixed(2) }));
  }

  /**
   * Plan 11 C1: sales by salesperson, net of returns, by day or by month. Each
   * line counts for its own salesperson (a return for the original line's).
   * A bill's rounding goes with its salesperson, so the total equals the
   * till's net sales for the period.
   */
  async bySalesperson(q: SalespersonReportQuery, user: CurrentUser) {
    const bills = await this.prisma.posBill.findMany({
      where: await this.where(q, user),
      select: { id: true, kind: true, businessDate: true, salesStaffId: true, roundingAdjustment: true, lines: { select: { salesStaffId: true, lineTotal: true }, orderBy: { lineNo: 'asc' } } },
    });
    const groups = new Map<string, SalespersonRow>();
    const row = (period: string, staffId: string | null) => {
      const key = `${period}|${staffId ?? ''}`;
      const g = groups.get(key) ?? { period, salesStaffId: staffId, bills: new Set<string>(), returns: new Set<string>(), sales: new Decimal(0), returnsAmount: new Decimal(0) };
      groups.set(key, g);
      return g;
    };
    const add = (g: SalespersonRow, kind: string, billId: string, amount: Decimal) => {
      if (kind === 'sale') {
        g.bills.add(billId);
        g.sales = g.sales.add(amount);
      } else {
        g.returns.add(billId);
        g.returnsAmount = g.returnsAmount.add(amount);
      }
    };
    for (const b of bills) {
      const date = iso(b.businessDate)!;
      const period = q.groupBy === 'month' ? date.slice(0, 7) : date;
      for (const l of b.lines) add(row(period, l.salesStaffId), b.kind, b.id, D(l.lineTotal));
      // The rounding to the rupee goes with the bill's salesperson (else its first named line's).
      const holder = b.salesStaffId ?? b.lines.find((l) => l.salesStaffId)?.salesStaffId ?? null;
      if (!D(b.roundingAdjustment).isZero()) add(row(period, holder), b.kind, b.id, D(b.roundingAdjustment));
    }
    const ids = [...new Set([...groups.values()].map((g) => g.salesStaffId).filter((x): x is string => !!x))];
    const staff = await this.prisma.salesStaff.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } });
    const who = new Map(staff.map((s) => [s.id, s]));
    return [...groups.values()]
      .filter((g) => !q.salesStaffId || g.salesStaffId === q.salesStaffId)
      .map((g) => ({
        period: g.period,
        salesStaffId: g.salesStaffId,
        code: g.salesStaffId ? (who.get(g.salesStaffId)?.code ?? '') : '',
        name: g.salesStaffId ? (who.get(g.salesStaffId)?.name ?? '-') : 'No salesperson',
        bills: g.bills.size,
        returns: g.returns.size,
        sales: g.sales.toFixed(2),
        returnsAmount: g.returnsAmount.toFixed(2),
        net: g.sales.add(g.returnsAmount).toFixed(2),
      }))
      .sort((a, b) => a.period.localeCompare(b.period) || Number(!a.salesStaffId) - Number(!b.salesStaffId) || a.name.localeCompare(b.name));
  }

  /** Bills made offline whose prices, offers, GST or stock differ from what the server would have done (pos-offline §5). */
  async offlineCheck(q: PosReportQuery, user: CurrentUser) {
    const bills = await this.prisma.posBill.findMany({ where: { ...(await this.where(q, user)), NOT: { checkFlags: { isEmpty: true } } }, include: { till: { select: { code: true } } }, orderBy: { soldAt: 'desc' }, take: 1000 });
    return bills.map((b) => ({ id: b.id, number: b.number, till: b.till.code, soldAt: b.soldAt, offline: b.offline, total: b.total.toFixed(2), flags: b.checkFlags }));
  }

  async syncProblems(user: CurrentUser, includeResolved = false) {
    const company = await this.common.currentCompany();
    const tills = await this.prisma.till.findMany({ where: { companyId: company.id, ...(user.allStores ? {} : { storeId: { in: user.stores.map((s) => s.id) } }) }, select: { id: true, code: true } });
    const code = new Map(tills.map((t) => [t.id, t.code]));
    const rows = await this.prisma.posSyncProblem.findMany({ where: { tillId: { in: tills.map((t) => t.id) }, ...(includeResolved ? {} : { resolvedAt: null }) }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({ id: r.id, till: code.get(r.tillId), clientId: r.clientId, kind: r.kind, error: r.error, payload: r.payload, createdAt: r.createdAt, resolvedAt: r.resolvedAt, resolution: r.resolution }));
  }

  /** Code audit, 27 October 2026: only for a till in one of the person's stores, and kept in the history. */
  async resolveSyncProblem(id: string, resolution: string, actor: Actor, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const problem = await this.prisma.posSyncProblem.findFirst({ where: { id, companyId: company.id } });
    const till = problem && (await this.prisma.till.findFirst({ where: { id: problem.tillId, ...(user.allStores ? {} : { storeId: { in: user.stores.map((s) => s.id) } }) }, select: { id: true } }));
    if (!problem || !till) throw new NotFoundException('Till problem not found');
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.posSyncProblem.update({ where: { id }, data: { resolvedAt: new Date(), resolvedById: actor.userId, resolution } });
      await this.audit.record(tx, actor, { action: 'update', entityType: 'pos_sync_problem', entityId: id, changes: { resolvedAt: { old: null, new: r.resolvedAt } }, reason: resolution });
      return { id: r.id, resolvedAt: r.resolvedAt };
    });
  }

  /** Closed and open shifts with their closing figures. */
  async shifts(q: PosReportQuery, user: CurrentUser) {
    const company = await this.common.currentCompany();
    const stores = user.allStores ? undefined : user.stores.map((s) => s.id);
    const rows = await this.prisma.shift.findMany({
      where: {
        companyId: company.id,
        ...(q.tillId ? { tillId: q.tillId } : {}),
        ...(stores ? { till: { storeId: { in: stores } } } : {}),
        ...(q.from || q.to ? { businessDate: { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } } : {}),
      },
      include: { till: { select: { code: true } }, closing: { include: { lines: true } } },
      orderBy: { openedAt: 'desc' },
      take: 500,
    });
    return rows.map((s) => ({
      id: s.id,
      till: s.till.code,
      businessDate: iso(s.businessDate),
      status: s.status,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      salesTotal: s.closing?.salesTotal.toFixed(2) ?? null,
      returnsTotal: s.closing?.returnsTotal.toFixed(2) ?? null,
      difference: s.closing ? s.closing.lines.reduce((t, l) => t.add(D(l.difference)), new Decimal(0)).toFixed(2) : null,
    }));
  }
}
