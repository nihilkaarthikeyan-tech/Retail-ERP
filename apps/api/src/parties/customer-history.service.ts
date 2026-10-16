// Copyright (c) 2026, Rademics. All rights reserved.
// A customer's purchase history (plan 11 C9) and the birthdays and anniversaries
// list (plan 11 C10). Purchases are read from the till bills, like the sales
// reports: net sales are before GST and returns count against them, so this
// year's total equals the item-sales report filtered by the customer.
import { Injectable, NotFoundException } from '@nestjs/common';
import { businessDate, type CurrentUser, Decimal, dayMonthsInWindow, occurrenceInWindow } from 'shared';
import { CompanyService } from '../company/company.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Amount = { toString(): string } | null | undefined;
const D = (v: Amount) => new Decimal(v ? v.toString() : '0');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fromIso = (s: string) => new Date(`${s}T00:00:00Z`);

@Injectable()
export class CustomerHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly company: CompanyService,
  ) {}

  /** Store-limited users see only bills of their own stores (blueprint 15). */
  private billScope(user: CurrentUser): Prisma.PosBillWhereInput {
    return user.allStores || user.isOwnerAdmin ? {} : { till: { storeId: { in: user.stores.map((s) => s.id) } } };
  }

  /** Till bills and returns, newest first, a page at a time, with this and last financial year's totals. */
  async purchases(customerId: string, q: { page?: number; pageSize?: number }, user: CurrentUser) {
    const company = await this.company.current();
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, companyId: company.id }, select: { id: true, isWalkIn: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    const where: Prisma.PosBillWhereInput = { companyId: company.id, customerId, ...this.billScope(user) };
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const [bills, total] = await Promise.all([
      this.prisma.posBill.findMany({
        where,
        orderBy: [{ soldAt: 'desc' }, { number: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, number: true, kind: true, status: true, businessDate: true, soldAt: true, total: true, taxableAmount: true, returnOfId: true, till: { select: { store: { select: { id: true, code: true, name: true } } } } },
      }),
      this.prisma.posBill.count({ where }),
    ]);
    const lines = bills.length ? await this.prisma.posBillLine.groupBy({ by: ['billId'], where: { billId: { in: bills.map((b) => b.id) } }, _sum: { basicQuantity: true }, _count: { _all: true } }) : [];
    const perBill = new Map(lines.map((l) => [l.billId, l]));

    const today = businessDate();
    const thisYear = await this.prisma.financialYear.findFirst({ where: { companyId: company.id, startDate: { lte: fromIso(today) }, endDate: { gte: fromIso(today) } } });
    const lastYear = thisYear ? await this.prisma.financialYear.findFirst({ where: { companyId: company.id, endDate: { lt: thisYear.startDate } }, orderBy: { endDate: 'desc' } }) : null;
    const yearTotals = async (fy: { name: string; startDate: Date; endDate: Date } | null) => {
      if (!fy) return null;
      const billWhere: Prisma.PosBillWhereInput = { ...where, status: 'completed', businessDate: { gte: fy.startDate, lte: fy.endDate } };
      const [byKind, sums] = await Promise.all([
        this.prisma.posBill.groupBy({ by: ['kind'], where: billWhere, _count: { _all: true }, _sum: { total: true } }),
        // Line amounts, as the item-sales report adds them up.
        this.prisma.posBillLine.aggregate({ where: { bill: billWhere }, _sum: { taxableAmount: true, basicQuantity: true } }),
      ]);
      const kind = (k: 'sale' | 'return') => byKind.find((b) => b.kind === k);
      return {
        name: fy.name,
        from: iso(fy.startDate),
        to: iso(fy.endDate),
        bills: kind('sale')?._count._all ?? 0,
        returns: kind('return')?._count._all ?? 0,
        /** Before GST, returns taken off. */
        netSales: D(sums._sum.taxableAmount).toFixed(2),
        /** What the customer paid, with GST, returns taken off. */
        total: D(kind('sale')?._sum.total).add(D(kind('return')?._sum.total)).toFixed(2),
        quantity: D(sums._sum.basicQuantity).toDecimalPlaces(3).toString(),
      };
    };
    const [thisTotals, lastTotals] = await Promise.all([yearTotals(thisYear), yearTotals(lastYear)]);

    return {
      customerId,
      isWalkIn: customer.isWalkIn,
      thisYear: thisTotals,
      lastYear: lastTotals,
      page,
      pageSize,
      total,
      rows: bills.map((b) => {
        const l = perBill.get(b.id);
        return {
          id: b.id,
          number: b.number,
          kind: b.kind,
          status: b.status,
          date: iso(b.businessDate),
          soldAt: b.soldAt,
          store: b.till.store,
          returnOfId: b.returnOfId,
          lines: l?._count._all ?? 0,
          quantity: D(l?._sum.basicQuantity).toDecimalPlaces(3).toString(),
          netAmount: D(b.taxableAmount).toFixed(2),
          amount: D(b.total).toFixed(2),
        };
      }),
    };
  }

  /**
   * Birthdays and anniversaries in the next `days` days from today (Indian date),
   * wrapping across the year end. Switched-off customers are left out; those who
   * do not want promotional messages are shown, marked "no promotions" (decision 74).
   */
  async upcoming(days: number) {
    const company = await this.company.current();
    const today = businessDate();
    const dayMonths = dayMonthsInWindow(today, days);
    const customers = await this.prisma.customer.findMany({
      where: { companyId: company.id, isWalkIn: false, status: { not: 'off' }, OR: [{ birthday: { in: dayMonths } }, { anniversary: { in: dayMonths } }] },
      select: { id: true, code: true, name: true, mobile: true, email: true, status: true, birthday: true, birthYear: true, anniversary: true, anniversaryYear: true },
    });
    const optedOut = new Set(
      (
        await this.prisma.contactPerson.findMany({
          where: { partyType: 'customer', partyId: { in: customers.map((c) => c.id) }, active: true, noPromotions: true },
          select: { partyId: true },
        })
      ).map((c) => c.partyId),
    );
    const rows = [];
    for (const c of customers) {
      for (const [kind, dayMonth, year] of [
        ['birthday', c.birthday, c.birthYear],
        ['anniversary', c.anniversary, c.anniversaryYear],
      ] as const) {
        if (!dayMonth) continue;
        const on = occurrenceInWindow(dayMonth, today, days);
        if (!on) continue;
        rows.push({
          customerId: c.id,
          code: c.code,
          name: c.name,
          mobile: c.mobile,
          email: c.email,
          status: c.status,
          kind,
          dayMonth,
          on,
          daysAway: Math.round((fromIso(on).getTime() - fromIso(today).getTime()) / 86_400_000),
          /** The age they turn, or the years married, when the year is known. */
          years: year ? Number(on.slice(0, 4)) - year : null,
          noPromotions: optedOut.has(c.id),
        });
      }
    }
    rows.sort((a, b) => a.on.localeCompare(b.on) || a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
    return { from: today, days, rows };
  }
}
