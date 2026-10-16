// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module.js';
import { NumberingModule } from '../numbering/numbering.module.js';
import { PosModule } from '../pos/pos.module.js';
import { AlterationsService } from './alterations.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

/** Plan 11 part 2: customer orders with an advance, and alteration jobs. */
@Module({
  imports: [ItemsModule, NumberingModule, PosModule],
  controllers: [OrdersController],
  providers: [OrdersService, AlterationsService],
  exports: [OrdersService, AlterationsService],
})
export class OrdersModule {}
