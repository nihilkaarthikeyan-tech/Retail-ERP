// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { CompanyModule } from '../company/company.module.js';
import { MarkdownsService } from './markdowns.service.js';
import { PricingController } from './pricing.controller.js';
import { PricingService } from './pricing.service.js';

@Module({
  imports: [CompanyModule, CatalogueModule],
  controllers: [PricingController],
  providers: [PricingService, MarkdownsService],
  exports: [PricingService, MarkdownsService],
})
export class PricingModule {}
