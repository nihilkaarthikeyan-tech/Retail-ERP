// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { CompanyModule } from '../company/company.module.js';
import { FinancialYearsModule } from '../financial-years/financial-years.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ItemsModule } from '../items/items.module.js';
import { PartiesModule } from '../parties/parties.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { OffersService } from './offers.service.js';
import { PinService } from './pin.service.js';
import { PosBillsService } from './pos-bills.service.js';
import { PosCommon } from './pos-common.service.js';
import { PosController } from './pos.controller.js';
import { PosReportsService } from './pos-reports.service.js';
import { PosSetupService } from './pos-setup.service.js';
import { PosSnapshotService } from './pos-snapshot.service.js';
import { ShiftsService } from './shifts.service.js';

@Module({
  imports: [CatalogueModule, CompanyModule, FinancialYearsModule, ItemsModule, InventoryModule, PartiesModule, PricingModule],
  controllers: [PosController],
  providers: [PosCommon, PosSetupService, PinService, OffersService, ShiftsService, PosBillsService, PosSnapshotService, PosReportsService],
  exports: [PosBillsService],
})
export class PosModule {}
