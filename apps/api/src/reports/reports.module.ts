// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { CompanyModule } from '../company/company.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PurchasingModule } from '../purchasing/purchasing.module.js';
import { AttentionService } from './attention.service.js';
import { DashboardsService } from './dashboards.service.js';
import { GstReturnsController } from './gst-returns.controller.js';
import { GstReturnsService } from './gst-returns.service.js';
import { MailerService } from './mailer.service.js';
import { MoneyReportsService } from './money-reports.service.js';
import { ReportsCommon } from './reports-common.service.js';
import { ReportsController } from './reports.controller.js';
import { SalesReportsService } from './sales-reports.service.js';
import { SeasonReportsService } from './season-reports.service.js';
import { StockAnalysisService } from './stock-analysis.service.js';
import { SummaryEmailService } from './summary-email.service.js';

@Module({
  imports: [CompanyModule, AccountingModule, InventoryModule, PurchasingModule],
  controllers: [ReportsController, GstReturnsController],
  providers: [ReportsCommon, GstReturnsService, SalesReportsService, SeasonReportsService, StockAnalysisService, MoneyReportsService, DashboardsService, AttentionService, MailerService, SummaryEmailService],
})
export class ReportsModule {}
