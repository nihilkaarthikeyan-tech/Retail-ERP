// Copyright (c) 2026, Rademics. All rights reserved.
// "Needs your attention" on the dashboard (owner, 23 October 2026): a short
// list of things to do today, each linking to the screen that deals with it.
// Every line is built from the same data as the matching report, and a line
// shows only to someone with the right to see that report.
import { Injectable } from '@nestjs/common';
import { addDays, businessDate, type CurrentUser, gstReturnPeriod, hasPermission, previousReturnPeriod, returnPeriodOf, startOfBusinessDay } from 'shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { DashboardsService } from './dashboards.service.js';
import { fromIso, ReportsCommon } from './reports-common.service.js';

export interface AttentionItem {
  key: string;
  label: string;
  detail?: string;
  href: string;
  /** "warn" needs doing; "ok" is ready and waiting. */
  tone: 'warn' | 'ok';
  action: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "11 November" from "2026-11-11". */
function dayMonth(date: string): string {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

/**
 * When GSTR-1 for a period is due (gst.gov.in): monthly filers by the 11th of
 * the next month; quarterly (QRMP) filers by the 13th of the month after the
 * quarter ends.
 */
export function gstr1DueDate(periodTo: string, frequency: string): string {
  const y = Number(periodTo.slice(0, 4));
  const m = Number(periodTo.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${frequency === 'quarterly' ? '13' : '11'}`;
}

@Injectable()
export class AttentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: ReportsCommon,
    private readonly dashboards: DashboardsService,
  ) {}

  async list(user: CurrentUser): Promise<{ items: AttentionItem[] }> {
    const company = await this.common.current();
    const scope = this.common.scope(user);
    const today = businessDate();
    const items: AttentionItem[] = [];

    // Audit 2 #18 (owner, 28 October 2026): until the go-live date is recorded, "Clear trial data" can
    // still empty the books; remind the Owner from three days before the trial ends.
    if (user.isOwnerAdmin && !company.goLiveDate && company.trialEndsAt && company.trialEndsAt.getTime() - Date.now() < 3 * 86_400_000) {
      items.push({ key: 'go-live', label: 'Record your go-live date', detail: 'Until it is recorded, the trial data (and the books) can still be cleared', href: '/go-live', tone: 'warn', action: 'Go live' });
    }

    if (hasPermission(user, 'stock.view')) {
      const low = await this.dashboards.belowReorder(company.id, scope.ids);
      if (low.length) items.push({ key: 'reorder', label: `${low.length} item${low.length === 1 ? '' : 's'} at or below reorder level`, href: '/purchases/reorder', tone: 'warn', action: 'Reorder' });
    }

    if (hasPermission(user, 'pos.reports')) {
      const shifts = await this.prisma.shift.findMany({
        where: { status: 'open', openedAt: { lt: startOfBusinessDay(today) }, till: { companyId: company.id, ...(scope.ids ? { storeId: { in: scope.ids } } : {}) } },
        select: { openedAt: true, openedById: true, till: { select: { code: true } } },
        orderBy: { openedAt: 'asc' },
        take: 3,
      });
      const people = new Map((await this.prisma.user.findMany({ where: { id: { in: shifts.map((s) => s.openedById) } }, select: { id: true, firstName: true } })).map((u) => [u.id, u.firstName]));
      for (const s of shifts) {
        const opened = businessDate(s.openedAt);
        items.push({ key: `shift-${s.till.code}-${opened}`, label: `Till ${s.till.code} shift from ${dayMonth(opened)} still open`, detail: `Opened by ${people.get(s.openedById) ?? 'someone'}`, href: '/pos/reports', tone: 'warn', action: 'Close' });
      }
    }

    if (hasPermission(user, 'purchase.view')) {
      const by = addDays(today, 7);
      const due = await this.prisma.supplierBill.findMany({
        where: { companyId: company.id, status: 'unpaid', dueDate: { lte: fromIso(by) } },
        select: { dueDate: true, supplier: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
      });
      if (due.length) {
        const overdue = due.filter((b) => businessDate(b.dueDate) < today).length;
        const names = [...new Set(due.map((b) => b.supplier.name))];
        items.push({
          key: 'supplier-bills',
          label: overdue ? `${overdue} supplier bill${overdue === 1 ? ' is' : 's are'} overdue` : `${due.length} supplier bill${due.length === 1 ? '' : 's'} due by ${dayMonth(by)}`,
          detail: names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(', '),
          href: '/purchases/bills',
          tone: 'warn',
          action: 'Pay',
        });
      }
    }

    if (hasPermission(user, 'gst.returns')) {
      const frequency = (await this.prisma.gstSettings.findUnique({ where: { companyId: company.id }, select: { filingFrequency: true } }))?.filingFrequency ?? 'quarterly';
      // The period just closed, from its end until its due date.
      const period = gstReturnPeriod(previousReturnPeriod(returnPeriodOf(today, frequency)));
      if (period) {
        const due = gstr1DueDate(period.to, frequency);
        if (today > period.to && today <= due) {
          items.push({ key: `gstr1-${period.period}`, label: `GSTR-1 for ${period.label}`, detail: `Due ${dayMonth(due)}`, href: '/reports/gst', tone: 'ok', action: 'Ready' });
        }
      }
    }

    return { items };
  }
}
