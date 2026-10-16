// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { CompanyModule } from '../company/company.module.js';
import { DashboardsService } from './dashboards.service.js';
import { MailerService } from './mailer.service.js';
import { MoneyReportsService } from './money-reports.service.js';
import { ReportsCommon } from './reports-common.service.js';
import { ReportsController } from './reports.controller.js';
import { SalesReportsService } from './sales-reports.service.js';
import { StockAnalysisService } from './stock-analysis.service.js';
import { SummaryEmailService } from './summary-email.service.js';

@Module({
  imports: [CompanyModule, AccountingModule],
  controllers: [ReportsController],
  providers: [ReportsCommon, SalesReportsService, StockAnalysisService, MoneyReportsService, DashboardsService, MailerService, SummaryEmailService],
})
export class ReportsModule {}
