// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { CompanyModule } from './company/company.module.js';
import { FinancialYearsModule } from './financial-years/financial-years.module.js';
import { GstCoreModule } from './gst/gst-core.module.js';
import { GstPortalModule } from './gst-portal/gst-portal.module.js';
import { HealthModule } from './health/health.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { AccountingModule } from './accounting/accounting.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { LedgerModule } from './ledger/ledger.module.js';
import { LoyaltyModule } from './loyalty/loyalty.module.js';
import { ModulesModule } from './modules/modules.module.js';
import { PosModule } from './pos/pos.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { PurchasingModule } from './purchasing/purchasing.module.js';
import { ItemsModule } from './items/items.module.js';
import { NumberingModule } from './numbering/numbering.module.js';
import { OrdersModule } from './orders/orders.module.js';
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
    ModulesModule,
    LedgerModule,
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
    InventoryModule,
    PurchasingModule,
    GstCoreModule,
    GstPortalModule,
    PosModule,
    LoyaltyModule,
    AccountingModule,
    ReportsModule,
    DocumentsModule,
    OrdersModule,
  ],
})
export class AppModule {}
