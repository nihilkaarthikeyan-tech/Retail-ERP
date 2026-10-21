// Copyright (c) 2026, Rademics. All rights reserved.
import { Module } from '@nestjs/common';
import { CompanyModule } from '../company/company.module.js';
import { GiftCardsService } from './gift-cards.service.js';
import { GiftCardsController, LoyaltyController } from './loyalty.controller.js';
import { LoyaltyService } from './loyalty.service.js';

/**
 * Plan 13: loyalty points and gift cards. The till's side (paying with points
 * and cards, selling cards) lives in the point-of-sale module, which uses the
 * services exported here.
 */
@Module({
  imports: [CompanyModule],
  controllers: [LoyaltyController, GiftCardsController],
  providers: [LoyaltyService, GiftCardsService],
  exports: [LoyaltyService, GiftCardsService],
})
export class LoyaltyModule {}
