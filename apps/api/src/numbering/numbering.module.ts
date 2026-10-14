// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module.js';
import { FinancialYearsModule } from '../financial-years/financial-years.module.js';
import { NumberingController } from './numbering.controller.js';
import { NumberingService } from './numbering.service.js';

@Module({
  imports: [CompanyModule, FinancialYearsModule],
  controllers: [NumberingController],
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
