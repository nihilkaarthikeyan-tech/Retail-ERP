// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { CompanyModule } from '../company/company.module.js';
import { FinancialYearsModule } from '../financial-years/financial-years.module.js';
import { GstCoreModule } from '../gst/gst-core.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ItemsModule } from '../items/items.module.js';
import { PartiesModule } from '../parties/parties.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { DeliveriesService } from './deliveries.service.js';
import { OffersService } from './offers.service.js';
import { PinService } from './pin.service.js';
import { PosBillsService } from './pos-bills.service.js';
import { PosCommon } from './pos-common.service.js';
import { PosCredit } from './pos-credit.service.js';
import { PosController } from './pos.controller.js';
import { PosPostings } from './pos-postings.service.js';
import { PosReportsService } from './pos-reports.service.js';
import { PosSetupService } from './pos-setup.service.js';
import { PosSnapshotService } from './pos-snapshot.service.js';
import { SalesStaffController } from './sales-staff.controller.js';
import { SalesStaffService } from './sales-staff.service.js';
import { ShiftsService } from './shifts.service.js';

@Module({
  imports: [CatalogueModule, CompanyModule, FinancialYearsModule, GstCoreModule, ItemsModule, InventoryModule, PartiesModule, PricingModule],
  controllers: [PosController, SalesStaffController],
  providers: [PosCommon, PosCredit, PosPostings, PosSetupService, PinService, OffersService, ShiftsService, PosBillsService, PosSnapshotService, PosReportsService, SalesStaffService, DeliveriesService],
  exports: [PosBillsService, PosPostings, PosCommon, PosCredit, PosSetupService],
})
export class PosModule {}
