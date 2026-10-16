// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { CompanyModule } from '../company/company.module.js';
import { FinancialYearsModule } from '../financial-years/financial-years.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ItemsModule } from '../items/items.module.js';
import { NumberingModule } from '../numbering/numbering.module.js';
import { PartiesModule } from '../parties/parties.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { GoodsReceiptsService } from './goods-receipts.service.js';
import { LandedChargesService } from './landed-charges.service.js';
import { PurchaseCommon } from './purchase-common.service.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { PurchasePostings } from './purchase-postings.service.js';
import { PurchaseReportsService } from './purchase-reports.service.js';
import { PurchaseSettingsService } from './purchase-settings.service.js';
import { PurchasingController } from './purchasing.controller.js';
import { ReorderService } from './reorder.service.js';
import { SupplierBillsService } from './supplier-bills.service.js';

@Module({
  imports: [CompanyModule, NumberingModule, FinancialYearsModule, ItemsModule, InventoryModule, PartiesModule, PricingModule, CatalogueModule],
  controllers: [PurchasingController],
  providers: [PurchaseCommon, PurchasePostings, PurchaseOrdersService, GoodsReceiptsService, SupplierBillsService, LandedChargesService, ReorderService, PurchaseReportsService, PurchaseSettingsService],
  exports: [PurchaseOrdersService, GoodsReceiptsService, SupplierBillsService, PurchasePostings],
})
export class PurchasingModule {}
