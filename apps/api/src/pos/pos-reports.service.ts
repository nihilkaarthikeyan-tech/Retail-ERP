// Copyright (c) 2026, Rademics. All rights reserved.
// Till reports (blueprint 09 "Reports"; decision 66; plan 06 §1 item 12).
import { Injectable } from '@nestjs/common';
import { type CurrentUser, Decimal, type PosReportQuery } from 'shared';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { D, fromIso, iso, PosCommon } from './pos-common.service.js';

@Injectable()
export class PosReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: PosCommon,
  ) {}

  private async where(q: PosReportQuery, user: CurrentUser): Promise<Prisma.PosBillWhereInput> {
    const company = await this.common.currentCompany();
    const stores = user.allStores ? undefined : user.stores.map((s) => s.id);
    return {
      companyId: company.id,
      status: 'completed',
      ...(q.tillId ? { tillId: q.tillId } : {}),
      ...(q.cashierId ? { cashierId: q.cashierId } : {}),
      ...(q.storeId ? { till: { storeId: q.storeId } } : {}),
      ...(stores ? { till: { storeId: { in: stores } } } : {}),
      ...(q.from || q.to ? { businessDate: { ...(q.from ? { gte: fromIso(q.from) } : {}), ...(q.to ? { lte: fromIso(q.to) } : {}) } } : {}),
    };
  }

  /** Every bill: date, number, till, cashier, kind, total, payments. */
  async register(q: PosReportQuery, user: CurrentUser) {
    const bills = await this.prisma.posBill.findMany({
      where: await this.where(q, user),
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
      payments: b.payments.map((p) => `${p.paymentMethod.name} ${p.amount.toFixed(2)}`).join(', '),
      offline: b.offline,
      flags: b.checkFlags,
    }));
  }

  /** Amount by payment method per day. */
  async payments(q: PosReportQuery, user: CurrentUser) {
    const pays = await this.prisma.posPayment.findMany({ where: { bill: await this.where(q, user) }, include: { paymentMethod: { select: { code: true, name: true, kind: true } }, bill: { select: { businessDate: true } } } });
    const groups = new Map<string, { date: string; method: string; kind: string; amount: Decimal; count: number }>();
    for (const p of pays) {
      const key = `${iso(p.bill.businessDate)}|${p.paymentMethod.code}`;
      const g = groups.get(key) ?? { date: iso(p.bill.businessDate)!, method: p.paymentMethod.name, kind: p.paymentMethod.kind, amount: new Decimal(0), count: 0 };
      g.amount = g.amount.add(D(p.amount));
      g.count++;
      groups.set(key, g);
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

  async resolveSyncProblem(id: string, resolution: string, userId: string) {
    const r = await this.prisma.posSyncProblem.update({ where: { id }, data: { resolvedAt: new Date(), resolvedById: userId, resolution } });
    return { id: r.id, resolvedAt: r.resolvedAt };
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
