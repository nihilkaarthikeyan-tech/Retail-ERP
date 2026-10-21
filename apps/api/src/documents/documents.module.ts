// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { CompanyModule } from '../company/company.module.js';
import { GstPortalModule } from '../gst-portal/gst-portal.module.js';
import { ImportKindsService } from '../imports/kinds.service.js';
import { ImportsService } from '../imports/imports.service.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ItemsModule } from '../items/items.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PartiesModule } from '../parties/parties.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { DocumentsController } from './documents.controller.js';
import { GoLiveService } from './go-live.service.js';
import { LabelsService } from './labels.service.js';
import { PrintService } from './print.service.js';

@Module({
  imports: [CompanyModule, GstPortalModule, AccountingModule, CatalogueModule, InventoryModule, ItemsModule, OrdersModule, PartiesModule, PricingModule],
  controllers: [DocumentsController],
  providers: [PrintService, LabelsService, GoLiveService, ImportsService, ImportKindsService],
})
export class DocumentsModule {}
