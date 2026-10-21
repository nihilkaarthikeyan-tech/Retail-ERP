// Copyright (c) 2026, Rademics. All rights reserved.
// Plan 13 endpoints in the back office: the loyalty scheme and its tiers, a
// customer's points, gift cards (list, history, block), the reports, and
// running the nightly expiry by hand. Every route belongs to its optional
// module (plan 12: refused with a plain message while the module is off).
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  expiryRunSchema,
  type GiftCardBlockInput,
  giftCardBlockSchema,
  type GiftCardQuery,
  giftCardQuerySchema,
  type LoyaltyReportQuery,
  loyaltyReportQuerySchema,
  type LoyaltySettingsInput,
  loyaltySettingsSchema,
  type LoyaltyTierInput,
  loyaltyTierSchema,
} from 'shared';
import { RequireAnyPermission, RequirePermission } from '../auth/decorators.js';
import { type Actor, type AuthUser, ReqActor, ReqUser } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod.pipe.js';
import { RequireModule } from '../modules/require-module.js';
import { GiftCardsService } from './gift-cards.service.js';
import { LoyaltyService } from './loyalty.service.js';

const id = () => new ParseUUIDPipe();
const zod = <T>(schema: { parse: (v: unknown) => T }) => new ZodValidationPipe(schema as never);

@Controller('loyalty')
@RequireModule('loyalty')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('settings') @RequireAnyPermission('loyalty.view', 'loyalty.manage', 'pos.setup', 'pos.sell') settings() {
    return this.loyalty.getSettings();
  }
  @Patch('settings') @RequirePermission('loyalty.manage') updateSettings(@Body(zod(loyaltySettingsSchema)) input: LoyaltySettingsInput, @ReqActor() actor: Actor) {
    return this.loyalty.updateSettings(input, actor);
  }
  @Post('tiers') @RequirePermission('loyalty.manage') createTier(@Body(zod(loyaltyTierSchema)) input: LoyaltyTierInput, @ReqActor() actor: Actor) {
    return this.loyalty.createTier(input, actor);
  }
  @Patch('tiers/:id') @RequirePermission('loyalty.manage') updateTier(@Param('id', id()) tierId: string, @Body(zod(loyaltyTierSchema)) input: LoyaltyTierInput, @ReqActor() actor: Actor) {
    return this.loyalty.updateTier(tierId, input, actor);
  }
  @Delete('tiers/:id') @RequirePermission('loyalty.manage') deleteTier(@Param('id', id()) tierId: string, @ReqActor() actor: Actor) {
    return this.loyalty.deleteTier(tierId, actor);
  }

  /** The customer page: balance, tier, expiring soon and the history. */
  @Get('customers/:id') @RequireAnyPermission('customers.view', 'loyalty.view') customer(@Param('id', id()) customerId: string, @ReqUser() user: AuthUser) {
    return this.loyalty.customerSummary(customerId, user, true);
  }

  @Get('reports/liability') @RequirePermission('loyalty.view') liability() {
    return this.loyalty.liability();
  }
  @Get('reports/by-month') @RequirePermission('loyalty.view') byMonth(@Query(zod(loyaltyReportQuerySchema)) q: LoyaltyReportQuery, @ReqUser() user: AuthUser) {
    return this.loyalty.byMonth(q, user);
  }
  @Get('reports/expiring') @RequirePermission('loyalty.view') expiring(@Query(zod(loyaltyReportQuerySchema)) q: LoyaltyReportQuery) {
    return this.loyalty.expiring(q);
  }

  /** The Owner runs today's expiry now (the night run does the same; running twice changes nothing). */
  @Post('expiry/run') @HttpCode(200) @RequirePermission('loyalty.manage') runExpiry(@Body(zod(expiryRunSchema)) _input: unknown, @ReqActor() actor: Actor) {
    return this.loyalty.runExpiry(actor);
  }
}

@Controller('gift-cards')
@RequireModule('gift_cards')
export class GiftCardsController {
  constructor(private readonly cards: GiftCardsService) {}

  @Get('settings') @RequireAnyPermission('giftcards.view', 'giftcards.sell', 'giftcards.manage') settings() {
    return this.cards.settings();
  }
  @Get('reports/liability') @RequirePermission('giftcards.view') liability() {
    return this.cards.liability();
  }
  @Get('reports/by-month') @RequirePermission('giftcards.view') byMonth(@Query(zod(loyaltyReportQuerySchema)) q: LoyaltyReportQuery, @ReqUser() user: AuthUser) {
    return this.cards.byMonth(q, user);
  }
  @Get('reports/expiring') @RequirePermission('giftcards.view') expiring(@Query(zod(loyaltyReportQuerySchema)) q: LoyaltyReportQuery, @ReqUser() user: AuthUser) {
    return this.cards.expiring(q, user);
  }
  @Post('expiry/run') @HttpCode(200) @RequirePermission('giftcards.manage') runExpiry(@Body(zod(expiryRunSchema)) _input: unknown, @ReqActor() actor: Actor) {
    return this.cards.runExpiry(actor);
  }

  @Get() @RequireAnyPermission('giftcards.view', 'giftcards.manage') list(@Query(zod(giftCardQuerySchema)) q: GiftCardQuery, @ReqUser() user: AuthUser) {
    return this.cards.list(q, user);
  }
  @Get(':id') @RequireAnyPermission('giftcards.view', 'giftcards.manage') get(@Param('id', id()) cardId: string, @ReqUser() user: AuthUser) {
    return this.cards.get(cardId, user);
  }
  @Post(':id/block') @HttpCode(200) @RequirePermission('giftcards.manage') block(@Param('id', id()) cardId: string, @Body(zod(giftCardBlockSchema)) input: GiftCardBlockInput, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.cards.block(cardId, input.reason, actor, user);
  }
  @Post(':id/unblock') @HttpCode(200) @RequirePermission('giftcards.manage') unblock(@Param('id', id()) cardId: string, @ReqActor() actor: Actor, @ReqUser() user: AuthUser) {
    return this.cards.unblock(cardId, actor, user);
  }
}
