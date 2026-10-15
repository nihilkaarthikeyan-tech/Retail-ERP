// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { CompanyModule } from '../company/company.module.js';
import { FinancialYearsModule } from '../financial-years/financial-years.module.js';
import { PartiesModule } from '../parties/parties.module.js';
import { RolesModule } from '../roles/roles.module.js';
import { StoresModule } from '../stores/stores.module.js';
import { SetupController } from './setup.controller.js';
import { SetupService } from './setup.service.js';

@Module({
  imports: [RolesModule, CompanyModule, FinancialYearsModule, StoresModule, CatalogueModule, PartiesModule],
  controllers: [SetupController],
  providers: [SetupService],
})
export class SetupModule {}
