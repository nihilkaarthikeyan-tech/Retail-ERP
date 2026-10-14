// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module.js';
import { FinancialYearsController } from './financial-years.controller.js';
import { FinancialYearsService } from './financial-years.service.js';

@Module({
  imports: [CompanyModule],
  controllers: [FinancialYearsController],
  providers: [FinancialYearsService],
  exports: [FinancialYearsService],
})
export class FinancialYearsModule {}
