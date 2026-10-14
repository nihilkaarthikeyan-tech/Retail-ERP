// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module.js';
import { FinancialYearsModule } from '../financial-years/financial-years.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { StoresModule } from '../stores/stores.module.js';
import { SetupController } from './setup.controller.js';
import { SetupService } from './setup.service.js';

@Module({
  imports: [RolesModule, CompanyModule, FinancialYearsModule, StoresModule],
  controllers: [SetupController],
  providers: [SetupService],
})
export class SetupModule {}
