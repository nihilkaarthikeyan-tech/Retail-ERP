// Copyright (c) 2026, Rademics. All rights reserved.
// E-invoice and e-way bill files (plan 08 §4). Exports the services for prints.
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { EInvoicesService } from './einvoices.service.js';
import { EWayBillsService } from './eway-bills.service.js';
import { GstPortalController } from './gst-portal.controller.js';

@Module({
  imports: [CompanyModule, InventoryModule],
  controllers: [GstPortalController],
  providers: [EInvoicesService, EWayBillsService],
  exports: [EInvoicesService, EWayBillsService],
})
export class GstPortalModule {}
