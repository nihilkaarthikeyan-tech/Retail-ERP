// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { CompanyModule } from './company/company.module.js';
import { FinancialYearsModule } from './financial-years/financial-years.module.js';
import { HealthModule } from './health/health.module.js';
import { ItemsModule } from './items/items.module.js';
import { NumberingModule } from './numbering/numbering.module.js';
import { PartiesModule } from './parties/parties.module.js';
import { PricingModule } from './pricing/pricing.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RolesModule } from './roles/roles.module.js';
import { SetupModule } from './setup/setup.module.js';
import { StoresModule } from './stores/stores.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    SetupModule,
    RolesModule,
    CompanyModule,
    StoresModule,
    FinancialYearsModule,
    NumberingModule,
    UsersModule,
    CatalogueModule,
    ItemsModule,
    PricingModule,
    PartiesModule,
  ],
})
export class AppModule {}
