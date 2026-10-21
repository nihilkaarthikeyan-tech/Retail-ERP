// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module.js';
import { LoyaltyModule } from '../loyalty/loyalty.module.js';
import { NumberingModule } from '../numbering/numbering.module.js';
import { PosModule } from '../pos/pos.module.js';
import { PurchasingModule } from '../purchasing/purchasing.module.js';
import { AccountingCommon } from './accounting-common.service.js';
import { AccountingController } from './accounting.controller.js';
import { CashBookService } from './cash-book.service.js';
import { CatchUpService } from './catch-up.service.js';
import { ChartService } from './chart.service.js';
import { ClosingService } from './closing.service.js';
import { ExpensesService } from './expenses.service.js';
import { JournalsService } from './journals.service.js';
import { LedgerReportsService } from './ledger-reports.service.js';
import { PaymentsService } from './payments.service.js';
import { TallyExportService } from './tally-export.service.js';

@Module({
  imports: [CompanyModule, NumberingModule, PurchasingModule, PosModule, LoyaltyModule],
  controllers: [AccountingController],
  providers: [AccountingCommon, CatchUpService, ChartService, JournalsService, PaymentsService, ClosingService, LedgerReportsService, ExpensesService, CashBookService, TallyExportService],
  exports: [AccountingCommon, LedgerReportsService, ClosingService],
})
export class AccountingModule {}
