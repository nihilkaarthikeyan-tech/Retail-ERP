// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { CompanyModule } from '../company/company.module.js';
import { NumberingModule } from '../numbering/numbering.module.js';
import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';
import { SeasonsService } from './seasons.service.js';

@Module({
  imports: [CompanyModule, CatalogueModule, NumberingModule],
  controllers: [ItemsController],
  providers: [ItemsService, SeasonsService],
  exports: [ItemsService, SeasonsService],
})
export class ItemsModule {}
