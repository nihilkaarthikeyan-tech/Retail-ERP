// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module.js';
import { FinancialYearsModule } from '../financial-years/financial-years.module.js';
import { ItemsModule } from '../items/items.module.js';
import { NumberingModule } from '../numbering/numbering.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryMastersService } from './inventory-masters.service.js';
import { StockDocumentsService } from './stock-documents.service.js';
import { StockEngine } from './stock-engine.service.js';
import { StockReportsService } from './stock-reports.service.js';
import { TransferGstService } from './transfer-gst.service.js';

@Module({
  imports: [CompanyModule, NumberingModule, FinancialYearsModule, ItemsModule],
  controllers: [InventoryController],
  providers: [StockEngine, StockDocumentsService, InventoryMastersService, StockReportsService, TransferGstService],
  exports: [StockEngine, StockDocumentsService, StockReportsService, InventoryMastersService, TransferGstService],
})
export class InventoryModule {}
