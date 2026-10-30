// Copyright (c) 2026, Rademics. All rights reserved.
// Module 9 endpoints (plan 09 §7). Each checks the permission here; the store
// limit and cost visibility are applied in the services (rule 11, decision 70).
import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { type ExportLogInput, exportLogSchema, type ReportQuery, reportQuerySchema, type SummaryEmailSettingsInput, summaryEmailSettingsSchema } from 'shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { RateLimit } from '../auth/rate-limit.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AttentionService } from './attention.service.js';
import { DashboardsService } from './dashboards.service.js';
import { MoneyReportsService } from './money-reports.service.js';
import { SalesReportsService } from './sales-reports.service.js';
import { type SeasonSellThroughQuery, seasonSellThroughQuerySchema, SeasonReportsService } from './season-reports.service.js';
import { StockAnalysisService } from './stock-analysis.service.js';
import { SummaryEmailService } from './summary-email.service.js';
import { RequireModule } from '../modules/require-module.js';

const zod = <T>(schema: { parse: (v: unknown) => T }) => new ZodValidationPipe(schema as never);
const storeQuery = z.object({ storeId: z.string().uuid().optional() });

@Controller()
export class ReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sales: SalesReportsService,
    private readonly stock: StockAnalysisService,
    private readonly money: MoneyReportsService,
    private readonly dashboards: DashboardsService,
    private readonly attention: AttentionService,
    private readonly summary: SummaryEmailService,
    private readonly seasons: SeasonReportsService,
  ) {}

  // ---- Dashboards ----
  /** "Needs your attention": each line checks its own right, so anyone logged in may ask. */
  @Get('attention') attentionList(@ReqUser() user: AuthUser) {
    return this.attention.list(user);
  }
  @Get('dashboards') @RequireAnyPermission('pos.reports', 'purchase.view', 'accounts.view') available(@ReqUser() user: AuthUser) {
    return { dashboards: this.dashboards.available(user) };
  }
  @Get('dashboards/store') @RequirePermission('pos.reports') storeDashboard(@Query(zod(storeQuery)) q: { storeId?: string }, @ReqUser() user: AuthUser) {
    return this.dashboards.store(user, q.storeId);
  }
  @Get('dashboards/owner') @RequirePermission('pos.reports') ownerDashboard(@ReqUser() user: AuthUser) {
    return this.dashboards.owner(user);
  }
  @Get('dashboards/purchasing') @RequirePermission('purchase.view') purchasingDashboard(@ReqUser() user: AuthUser) {
    return this.dashboards.purchasing(user);
  }
  @Get('dashboards/accounts') @RequirePermission('accounts.view') accountsDashboard(@ReqUser() user: AuthUser) {
    return this.dashboards.accounts(user);
  }

  // ---- Sales ----
  @Get('reports/daily-sales') @RequirePermission('pos.reports') dailySales(@Query(zod(reportQuerySchema)) q: ReportQuery, @ReqUser() user: AuthUser) {
    return this.sales.dailySales(q, user);
  }
  @Get('reports/item-sales') @RequirePermission('pos.reports') itemSales(@Query(zod(reportQuerySchema)) q: ReportQuery, @ReqUser() user: AuthUser) {
    return this.sales.itemSales(q, user);
  }
  @Get('reports/best-sellers') @RequirePermission('pos.reports') bestSellers(@Query(zod(reportQuerySchema)) q: ReportQuery, @ReqUser() user: AuthUser) {
    return this.sales.bestSellers(q, user);
  }
  @Get('reports/sales-by-group') @RequirePermission('pos.reports') salesByGroup(@Query(zod(reportQuerySchema)) q: ReportQuery, @ReqUser() user: AuthUser) {
    return this.sales.salesByGroup(q, user);
  }
  @Get('reports/returns') @RequirePermission('pos.reports') returns(@Query(zod(reportQuerySchema)) q: ReportQuery, @ReqUser() user: AuthUser) {
    return this.sales.returns(q, user);
  }
  @Get('reports/discounts') @RequirePermission('pos.reports') discounts(@Query(zod(reportQuerySchema)) q: ReportQuery, @ReqUser() user: AuthUser) {
    return this.sales.discounts(q, user);
  }
  @Get('reports/gross-profit') @RequireAnyPermission('cost_price.view', 'stock.cost.view') grossProfit(@Query(zod(reportQuerySchema)) q: ReportQuery, @ReqUser() user: AuthUser) {
    return this.sales.grossProfit(q, user);
  }

  /** Plan 11 C4: bought, sold, in stock and share sold per season, or per style, group or item of one season. */
  @Get('reports/season-sell-through') @RequireModule('seasons') @RequirePermission('pos.reports') seasonSellThrough(@Query(zod(seasonSellThroughQuerySchema)) q: SeasonSellThroughQuery, @ReqUser() user: AuthUser) {
    return this.seasons.sellThrough(q, user);
  }

  // ---- Stock ----
  @Get('reports/stock-movement') @RequirePermission('stock.view') stockMovement(@Query(zod(reportQuerySchema)) q: ReportQuery, @ReqUser() user: AuthUser) {
    return this.stock.movement(q, user);
  }
  @Get('reports/stock-cover') @RequirePermission('stock.view') stockCover(@Query(zod(reportQuerySchema)) q: ReportQuery, @ReqUser() user: AuthUser) {
    return this.stock.cover(q, user);
  }
  @Get('reports/stock-age') @RequirePermission('stock.view') stockAge(@Query(zod(reportQuerySchema)) q: ReportQuery, @ReqUser() user: AuthUser) {
    return this.stock.age(q, user);
  }
  @Get('reports/shrinkage') @RequireAnyPermission('stock.cost.view', 'cost_price.view') shrinkage(@Query(zod(reportQuerySchema)) q: ReportQuery, @ReqUser() user: AuthUser) {
    return this.stock.shrinkage(q, user);
  }

  // ---- Money ----
  @Get('reports/cash-position') @RequirePermission('accounts.view') cashPosition(@Query(zod(reportQuerySchema)) q: ReportQuery, @ReqUser() user: AuthUser) {
    return this.money.cashPosition(q, user);
  }
  @Get('reports/cash-flow') @RequirePermission('accounts.view') cashFlow(@Query(zod(reportQuerySchema)) q: ReportQuery, @ReqUser() user: AuthUser) {
    return this.money.cashFlow(q, user);
  }

  // ---- Downloads are recorded in the history (blueprint 14 process 2) ----
  @Post('reports/export-log') @HttpCode(204) @RequireAnyPermission('pos.reports', 'stock.view', 'stock.cost.view', 'cost_price.view', 'purchase.view', 'accounts.view', 'gst.returns') async exportLog(@Body(zod(exportLogSchema)) input: ExportLogInput, @ReqActor() actor: Actor) {
    await this.audit.record(this.prisma, actor, { action: 'export', entityType: 'report', entityId: null, changes: { report: input.report, filters: input.filters, rows: input.rows ?? null } });
  }

  // ---- The owner's daily summary email ----
  @Get('summary-email/settings') @RequirePermission('reports.summary_email') summarySettings(@ReqUser() user: AuthUser) {
    return this.summary.settings(user);
  }
  @Put('summary-email/settings') @RequirePermission('reports.summary_email') saveSummarySettings(@Body(zod(summaryEmailSettingsSchema)) input: SummaryEmailSettingsInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.summary.saveSettings(input, actor, user);
  }
  @Post('summary-email/test') @HttpCode(200) @RateLimit('testEmail') @RequirePermission('reports.summary_email') sendTest(@ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.summary.sendTest(actor, user);
  }
  @Get('summary-email/runs') @RequirePermission('reports.summary_email') summaryRuns(@ReqUser() user: AuthUser) {
    return this.summary.runs(user);
  }
  @Get('summary-email/preview/:figures') @RequirePermission('reports.summary_email') async preview(@Param('figures') figures: string, @ReqUser() user: AuthUser) {
    const company = await this.prisma.company.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
    void user;
    return this.summary.compose(company.id, figures.split(',').filter(Boolean) as never, new Date());
  }
}
