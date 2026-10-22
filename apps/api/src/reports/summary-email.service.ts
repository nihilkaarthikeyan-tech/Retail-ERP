// Copyright (c) 2026, Rademics. All rights reserved.
// The owner's daily summary email (decision 67; plan 09 §1.5). Every five
// minutes the server checks whether the chosen time (Indian time) has passed;
// a database rule allows only one scheduled email per company per day, so it is
// never sent twice, even after a restart. Switched-off users get nothing.
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { addDays, businessDate, type CurrentUser, Decimal, grossMarginPercent, hasPermission, INDIA_TIME_ZONE, SUMMARY_FIGURES, type SummaryEmailSettingsInput, type SummaryFigure } from 'shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DashboardsService } from './dashboards.service.js';
import { MailerService } from './mailer.service.js';
import { MoneyReportsService } from './money-reports.service.js';
import { D, fromIso, iso, ReportsCommon, ZERO } from './reports-common.service.js';
import { SalesReportsService } from './sales-reports.service.js';

const DEFAULT_FIGURES = Object.keys(SUMMARY_FIGURES) as SummaryFigure[];

/** The current time in India as HH:MM. */
function indiaTime(now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: INDIA_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const rupees = (v: string | Decimal) => `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v.toString()))}`;

@Injectable()
export class SummaryEmailService {
  private readonly log = new Logger(SummaryEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly common: ReportsCommon,
    private readonly sales: SalesReportsService,
    private readonly money: MoneyReportsService,
    private readonly dashboards: DashboardsService,
    private readonly mailer: MailerService,
  ) {}

  private check(user: CurrentUser) {
    if (!hasPermission(user, 'reports.summary_email')) throw new ForbiddenException('Only the Owner sets up the daily summary email');
  }

  async settings(user: CurrentUser) {
    this.check(user);
    const company = await this.common.current();
    const s = await this.prisma.summaryEmailSettings.findUnique({ where: { companyId: company.id } });
    return {
      enabled: s?.enabled ?? false,
      sendAt: s?.sendAt ?? '21:00',
      recipientIds: s?.recipientIds ?? [],
      figures: s?.figures ?? DEFAULT_FIGURES,
      mail: { configured: this.mailer.configured(), account: this.mailer.describe() },
      figureLabels: SUMMARY_FIGURES,
    };
  }

  async saveSettings(input: SummaryEmailSettingsInput, actor: Actor, user: CurrentUser) {
    this.check(user);
    const company = await this.common.current();
    const users = await this.prisma.user.findMany({ where: { id: { in: input.recipientIds } }, select: { id: true } });
    if (users.length !== new Set(input.recipientIds).size) throw new BadRequestException('A recipient was not found');
    if (input.enabled && input.recipientIds.length === 0) throw new BadRequestException('Choose who receives the email');
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.summaryEmailSettings.findUnique({ where: { companyId: company.id } });
      await tx.summaryEmailSettings.upsert({
        where: { companyId: company.id },
        create: { companyId: company.id, ...input, createdById: actor.userId, updatedById: actor.userId },
        update: { ...input, updatedById: actor.userId },
      });
      await this.audit.record(tx, actor, {
        action: before ? 'update' : 'create',
        entityType: 'summary_email_settings',
        entityId: company.id,
        changes: { enabled: input.enabled, sendAt: input.sendAt, recipients: input.recipientIds.length, figures: input.figures },
      });
    });
    return this.settings(user);
  }

  async runs(user: CurrentUser) {
    this.check(user);
    const company = await this.common.current();
    const rows = await this.prisma.summaryEmailRun.findMany({ where: { companyId: company.id }, orderBy: { startedAt: 'desc' }, take: 30 });
    return rows.map((r) => ({ id: r.id, businessDate: iso(r.businessDate), kind: r.kind, startedAt: r.startedAt, sentAt: r.sentAt, recipients: r.recipients, error: r.error }));
  }

  /** "Send a test now": to the chosen recipients (or the Owner alone), outside the once-a-day rule. */
  async sendTest(actor: Actor, user: CurrentUser) {
    this.check(user);
    const company = await this.common.current();
    const s = await this.prisma.summaryEmailSettings.findUnique({ where: { companyId: company.id } });
    const recipientIds = s?.recipientIds.length ? s.recipientIds : [user.id];
    const run = await this.prisma.summaryEmailRun.create({ data: { companyId: company.id, businessDate: fromIso(businessDate()), kind: 'test', recipients: [] } });
    await this.deliver(run.id, company.id, recipientIds, (s?.figures ?? DEFAULT_FIGURES) as SummaryFigure[]);
    void actor;
    return (await this.runs(user))[0];
  }

  /** Every five minutes: send today's email once the chosen time has passed. */
  @Cron('*/5 * * * *', { timeZone: INDIA_TIME_ZONE })
  async onSchedule(): Promise<void> {
    // The automated tests drive tick() themselves.
    if (process.env.SUMMARY_EMAIL_SCHEDULE === 'off') return;
    await this.tick();
  }

  async tick(now = new Date()): Promise<number> {
    let sent = 0;
    const due = await this.prisma.summaryEmailSettings.findMany({ where: { enabled: true } });
    for (const s of due) {
      if (indiaTime(now) < s.sendAt) continue;
      const today = businessDate(now);
      // The database allows one scheduled run per company per day; a second attempt stops here.
      const claimed = await this.prisma.$executeRaw`
        INSERT INTO "SummaryEmailRun" ("id", "companyId", "businessDate", "kind", "startedAt", "recipients")
        VALUES (gen_random_uuid(), ${s.companyId}::uuid, ${fromIso(today)}, 'scheduled', now(), '{}')
        ON CONFLICT DO NOTHING`;
      if (!claimed) continue;
      const run = await this.prisma.summaryEmailRun.findFirstOrThrow({ where: { companyId: s.companyId, businessDate: fromIso(today), kind: 'scheduled' } });
      await this.deliver(run.id, s.companyId, s.recipientIds, s.figures as SummaryFigure[], now);
      sent++;
    }
    return sent;
  }

  private async deliver(runId: string, companyId: string, recipientIds: string[], figures: SummaryFigure[], now = new Date()) {
    try {
      const people = await this.prisma.user.findMany({ where: { id: { in: recipientIds }, active: true }, select: { email: true } });
      const to = people.map((p) => p.email);
      const content = await this.compose(companyId, figures, now);
      await this.mailer.send({ to, ...content });
      await this.prisma.summaryEmailRun.update({ where: { id: runId }, data: { sentAt: new Date(), recipients: to } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`Daily summary email failed: ${message}`);
      await this.prisma.summaryEmailRun.update({ where: { id: runId }, data: { error: message.slice(0, 500) } });
    }
  }

  /** The email's figures, worked out with company-wide rights (the Owner's view). */
  async compose(companyId: string, figures: SummaryFigure[], now: Date): Promise<{ subject: string; html: string; text: string }> {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const owner: CurrentUser = { id: '00000000-0000-0000-0000-000000000000', firstName: 'Summary', lastName: null, email: '', isOwnerAdmin: true, permissions: [], allStores: true, stores: [], mustChangePassword: false, roles: [] };
    const today = businessDate(now);
    // Sent in the evening it covers the same day; sent in the morning, the day before.
    const day = indiaTime(now) >= '12:00' ? today : addDays(today, -1);
    const sections: { title: string; rows: [string, string][] }[] = [];

    if (figures.includes('sales_by_store')) {
      const [d, w] = await Promise.all([this.sales.dailySales({ from: day, to: day }, owner), this.sales.dailySales({ from: addDays(day, -7), to: addDays(day, -7) }, owner)]);
      const before = new Map(w.rows.map((r) => [r.storeId, r.netSales]));
      sections.push({
        title: `Sales on ${day} (before GST)`,
        rows: [
          ...d.rows.map((r): [string, string] => [r.store, `${rupees(r.netSales)} from ${r.saleBills} bills (same day last week ${rupees(before.get(r.storeId) ?? '0')})`]),
          ['All stores', `${rupees(d.totals.netSales)} from ${d.totals.saleBills} bills, returns ${rupees(d.totals.returns)}`],
        ],
      });
    }
    if (figures.includes('month_to_date')) {
      const lines = await this.sales.lines(companyId, `${day.slice(0, 7)}-01`, day, { ids: null });
      const net = lines.reduce((s, l) => s.add(D(l.taxableAmount)), ZERO);
      const cost = lines.reduce((s, l) => s.add(D(l.cost)), ZERO);
      sections.push({ title: 'This month so far', rows: [['Sales (before GST)', rupees(net)], ['Gross margin', `${grossMarginPercent(net, cost)?.toFixed(2) ?? '—'}%`]] });
    }
    if (figures.includes('cash_and_bank')) {
      const pos = await this.money.cashPosition({ asOf: day }, owner);
      const sum = (k: string) => pos.rows.filter((r) => r.kind === k).reduce((s, r) => s.add(D(r.balance)), ZERO);
      sections.push({ title: 'Cash and bank', rows: [['Bank', rupees(sum('Bank'))], ['Cash in hand', rupees(sum('Cash'))], ['Cash in open tills now', rupees(await this.money.cashInOpenTills(companyId, null))]] });
    }
    if (figures.includes('dues')) {
      const d = await this.dashboards.dues(companyId);
      sections.push({ title: 'Dues', rows: [['Customers owe', `${rupees(d.customers)} (${rupees(d.customersOverdue)} overdue)`], ['The shop owes suppliers', `${rupees(d.suppliers)} (${rupees(d.suppliersOverdue)} overdue)`]] });
    }
    if (figures.includes('reorder')) {
      const below = await this.dashboards.belowReorder(companyId, null);
      const items = await this.common.items(below.slice(0, 10).map((b) => b.itemId));
      sections.push({ title: `Items at or below reorder level: ${below.length}`, rows: below.slice(0, 10).map((b): [string, string] => [items.get(b.itemId)?.name ?? b.itemId, `${b.onHand.toString()} left (reorder at ${D(b.level).toString()})`]) });
    }
    if (figures.includes('negative_stock')) {
      const n = await this.prisma.stockPosition.count({ where: { companyId, quantity: { lt: 0 } } });
      sections.push({ title: 'Sold beyond stock', rows: [['Items below zero', String(n)]] });
    }
    if (figures.includes('sync_problems')) {
      const n = await this.prisma.posSyncProblem.count({ where: { companyId, resolvedAt: null } });
      sections.push({ title: 'Till bills that could not be sent', rows: [['Waiting for a manager', String(n)]] });
    }

    const subject = `${company.tradeName ?? company.legalName}: daily summary for ${day}`;
    const html = [
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">`,
      `<h2 style="margin:0 0 12px">${esc(subject)}</h2>`,
      ...sections.map(
        (s) =>
          `<h3 style="margin:16px 0 6px">${esc(s.title)}</h3><table style="border-collapse:collapse">${s.rows.map(([a, b]) => `<tr><td style="padding:3px 16px 3px 0">${esc(a)}</td><td style="padding:3px 0">${esc(b)}</td></tr>`).join('')}</table>`,
      ),
      `<p style="color:#777;margin-top:20px">Worked out at ${esc(now.toISOString())}. Figures change if bills or stock entries are added later.</p></div>`,
    ].join('');
    const text = [subject, '', ...sections.flatMap((s) => [s.title, ...s.rows.map(([a, b]) => `  ${a}: ${b}`), ''])].join('\n');
    return { subject, html, text };
  }
}

export { indiaTime };
