// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module.js';
import { NumberingModule } from '../numbering/numbering.module.js';
import { ContactsService } from './contacts.service.js';
import { CustomersService } from './customers.service.js';
import { CustomersController, PartyMastersController, SuppliersController } from './parties.controller.js';
import { PartyMastersService } from './party-masters.service.js';
import { PartySettingsService } from './party-settings.service.js';
import { SuppliersService } from './suppliers.service.js';

@Module({
  imports: [CompanyModule, NumberingModule],
  controllers: [CustomersController, SuppliersController, PartyMastersController],
  providers: [PartySettingsService, PartyMastersService, ContactsService, CustomersService, SuppliersService],
  exports: [PartySettingsService, PartyMastersService, ContactsService, CustomersService, SuppliersService],
})
export class PartiesModule {}
