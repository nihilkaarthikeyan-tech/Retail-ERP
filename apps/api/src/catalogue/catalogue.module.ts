// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module.js';
import { CatalogueController } from './catalogue.controller.js';
import { CatalogueSettingsService } from './catalogue-settings.service.js';
import { MastersService } from './masters.service.js';
import { UnitsService } from './units.service.js';

@Module({
  imports: [CompanyModule],
  controllers: [CatalogueController],
  providers: [UnitsService, MastersService, CatalogueSettingsService],
  exports: [UnitsService, MastersService, CatalogueSettingsService],
})
export class CatalogueModule {}
